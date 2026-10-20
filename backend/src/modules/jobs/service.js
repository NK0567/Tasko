import { many, one, withTransaction } from '../../db.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../utils/errors.js';
import { safeEqual } from '../../utils/crypto.js';
import { emitToUser } from '../../realtime/hub.js';
import { computeQuote, getSettings } from '../settings/service.js';
import { notify } from '../notifications/service.js';
import { recomputeRating, recomputeProviderStats, serializeReview } from '../providers/service.js';
import {
  cancellationFeeInTx, executeOutgoing, fmt, newStartCode, refundUnitInTx, releaseUnitInTx,
} from '../payments/service.js';
import {
  ACTIVE_STATUSES, ALL_STATUSES, FUNDED_STATUSES, HELD_MILESTONE_STATUSES, HISTORY_STATUSES,
  emitJobClosed, emitJobUpdated, fetchJobRow, fetchJobRows, getJobView, serializeJob, serializeRows,
} from './repo.js';

/** Transitions « terrain » du prestataire : strictement séquentielles. */
const FIELD_TRANSITIONS = { funded: 'en_route', en_route: 'arrived', arrived: 'in_progress', in_progress: 'done' };
const FIELD_LABELS = {
  en_route: ['Prestataire en route', 'est en route vers vous'],
  arrived: ['Prestataire arrivé', 'est arrivé sur place. Donnez-lui votre code de démarrage quand il commence'],
  in_progress: ['Mission démarrée', 'a commencé le travail'],
  done: ['Travail terminé', 'a terminé le travail'],
};
const START_CODE_MAX_ATTEMPTS = 5; // puis le code est régénéré et renvoyé au client
const START_CODE_MAX_FAILURES = 20; // puis blocage (support)

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '');
const hoursFrom = (h, base = Date.now()) => new Date(base + Number(h) * 3600e3);
const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'short', timeStyle: 'short' });

export async function lockJob(client, id) {
  const job = await one('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id], client);
  if (!job) throw notFound('Mission introuvable');
  return job;
}
export const lockMilestones = (client, jobId) =>
  many('SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY position FOR UPDATE', [jobId], client);

/** Masque l'existence d'une mission aux non-participants (anti-IDOR : 404 plutôt que 403). */
function assertParty(job, user, message = 'Mission introuvable') {
  if (job.client_id !== user.id && job.provider_id !== user.id) throw notFound(message);
}

// ------------------------------------------------------------------ devis
export async function quote(price) {
  return computeQuote(price, await getSettings());
}

async function activeCategory(categoryId, client) {
  const cat = await one(
    `SELECT c.*, p.slug AS parent_slug, p.is_active AS parent_active FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = $1`,
    [categoryId],
    client,
  );
  if (!cat || !cat.is_active || cat.parent_active === false) throw badRequest('Service introuvable ou inactif', { category_id: 'Invalide' });
  return cat;
}

async function assertActiveProvider(id, client) {
  const p = await one(
    `SELECT u.id, u.full_name FROM users u JOIN provider_profiles pp ON pp.user_id = u.id WHERE u.id = $1 AND u.is_provider AND u.status = 'active'`,
    [id],
    client,
  );
  if (!p) throw badRequest('Prestataire introuvable ou indisponible', { provider_id: 'Invalide' });
  return p;
}

async function nearestCity(lat, lng, userId) {
  const city = await one(
    `SELECT name FROM cities WHERE is_active AND haversine_km($1, $2, lat, lng) <= 60 ORDER BY haversine_km($1, $2, lat, lng) LIMIT 1`,
    [lat, lng],
  );
  if (city) return city.name;
  const u = await one('SELECT city FROM users WHERE id = $1', [userId]);
  return u?.city || null;
}

/** Jalons : tarification par jalon ; prix, frais et total de la mission = sommes des jalons. */
export function quoteMilestones(milestones, settings) {
  const items = milestones.map((m, i) => ({ position: i + 1, title: m.title, ...computeQuote(m.amount, settings) }));
  const sum = (k) => items.reduce((s, m) => s + m[k], 0);
  return {
    items,
    totals: {
      price: sum('price'), service_fee: sum('service_fee'), total: sum('total'),
      provider_commission: sum('provider_commission'), provider_payout: sum('provider_payout'),
    },
  };
}

export async function insertMilestones(client, jobId, items) {
  for (const m of items) {
    await client.query(
      `INSERT INTO job_milestones (job_id, position, title, amount, service_fee, provider_commission, provider_payout, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [jobId, m.position, m.title, m.price, m.service_fee, m.provider_commission, m.provider_payout, m.total],
    );
  }
}

async function insertJob(client, f) {
  const row = await one(
    `INSERT INTO jobs (client_id, provider_id, category_id, title, description, photo_url, address, city, lat, lng,
                       urgency, scheduled_at, budget, price, service_fee, total, provider_commission, provider_payout,
                       mode, origin, visibility, invited_provider_ids, bid_deadline, budget_min, budget_max, property_id,
                       recurring_job_id, status, accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
             coalesce($28, 'requested'), CASE WHEN $28 = 'accepted' THEN now() END)
     RETURNING id`,
    [
      f.client_id, f.provider_id || null, f.category_id, f.title, f.description || null, f.photo_url || null, f.address || null,
      f.city || null, f.lat, f.lng, f.urgency || 'now', f.scheduled_at || null, f.budget, f.q.price, f.q.service_fee, f.q.total,
      f.q.provider_commission, f.q.provider_payout, f.mode, f.origin || 'client', f.visibility || null, f.invited_provider_ids || [],
      f.bid_deadline || null, f.budget_min ?? null, f.budget_max ?? null, f.property_id || null, f.recurring_job_id || null,
      f.status || null,
    ],
    client,
  );
  return row.id;
}

// ------------------------------------------------------------------ création + diffusion
export async function createJob(user, body) {
  const settings = await getSettings();
  const cat = await activeCategory(body.category_id);
  const isOther = cat.slug === 'autre' || cat.parent_slug === 'autre';
  const mode = body.mode || (body.provider_id ? 'direct' : 'instant');
  const milestones = body.milestones || [];

  if (mode === 'direct' && !body.provider_id) throw badRequest('Prestataire requis pour une demande directe', { provider_id: 'Requis' });
  if (mode !== 'direct' && body.provider_id) throw badRequest('provider_id n\'est accepté qu\'en mode direct', { provider_id: 'Non autorisé' });
  if (mode === 'instant' && milestones.length) throw badRequest('Les jalons sont réservés aux demandes directes et appels d\'offres', { milestones: 'Non autorisé' });
  if (body.provider_id) {
    if (body.provider_id === user.id) throw badRequest('Vous ne pouvez pas vous commander une mission à vous-même');
    await assertActiveProvider(body.provider_id);
  }
  if (body.property_id) {
    const p = await one('SELECT 1 FROM properties WHERE id = $1 AND owner_id = $2', [body.property_id, user.id]);
    if (!p) throw badRequest('Bien immobilier introuvable', { property_id: 'Invalide' });
  }

  let q;
  let msQuote = null;
  let budget = body.budget;
  const tender = {};
  if (mode === 'tender') {
    const deadline = body.bid_deadline ? new Date(body.bid_deadline) : hoursFrom(24 * Number(settings.tender_default_days || 7));
    if (deadline.getTime() < Date.now() + 3600e3) throw badRequest('La date limite doit être au moins 1 h dans le futur', { bid_deadline: 'Invalide' });
    if (deadline.getTime() > Date.now() + 90 * 86400e3) throw badRequest('Date limite trop lointaine (90 jours maximum)', { bid_deadline: 'Invalide' });
    tender.bid_deadline = deadline;
    tender.visibility = body.visibility || 'public';
    tender.invited_provider_ids = [...new Set(body.invited_provider_ids || [])];
    if (tender.visibility === 'invited') {
      if (!tender.invited_provider_ids.length) throw badRequest('Invitez au moins un prestataire', { invited_provider_ids: 'Requis' });
      if (tender.invited_provider_ids.includes(user.id)) throw badRequest('Vous ne pouvez pas vous inviter vous-même');
      const found = await many(
        `SELECT u.id FROM users u JOIN provider_profiles pp ON pp.user_id = u.id WHERE u.id = ANY($1) AND u.is_provider AND u.status = 'active'`,
        [tender.invited_provider_ids],
      );
      if (found.length !== tender.invited_provider_ids.length) throw badRequest('Prestataire invité introuvable', { invited_provider_ids: 'Invalide' });
    }
    tender.budget_min = body.budget_min ?? null;
    tender.budget_max = body.budget_max ?? null;
    if (tender.budget_min !== null && tender.budget_max !== null && tender.budget_min > tender.budget_max) {
      throw badRequest('Budget minimum supérieur au maximum', { budget_min: 'Invalide' });
    }
    budget = body.budget ?? tender.budget_max ?? tender.budget_min ?? 0;
    q = computeQuote(0, settings); // le prix est fixé à l'attribution
  } else if (milestones.length) {
    msQuote = quoteMilestones(milestones, settings);
    q = msQuote.totals;
    budget = q.price;
  } else {
    if (budget === undefined || budget === null) throw badRequest('Budget requis', { budget: 'Requis' });
    if (budget < 100) throw badRequest('Budget minimum : 100 FCFA', { budget: 'Invalide' });
    q = computeQuote(budget, settings);
  }

  const label = isOther && body.other_label ? body.other_label.trim() : null;
  const title = body.title?.trim() || `${label || cat.name}${body.description ? ` - ${truncate(body.description, 50)}` : ''}`;
  const city = await nearestCity(body.lat, body.lng, user.id);

  const jobId = await withTransaction(async (client) => {
    const id = await insertJob(client, {
      client_id: user.id, provider_id: body.provider_id, category_id: cat.id, title, description: body.description,
      photo_url: body.photo_url, address: body.address, city, lat: body.lat, lng: body.lng, urgency: body.urgency,
      scheduled_at: body.scheduled_at, budget, q, mode, property_id: body.property_id, ...tender,
    });
    if (msQuote) await insertMilestones(client, id, msQuote.items);
    if (isOther) {
      await client.query('INSERT INTO category_suggestions (label, user_id, job_id) VALUES ($1, $2, $3)', [
        truncate(label || body.description || 'Service non précisé', 120), user.id, id,
      ]);
    }
    return id;
  });

  const jobRow = await fetchJobRow(jobId);
  if (mode === 'instant') await broadcastInstant(jobRow, { settings, isOther });
  else if (mode === 'direct') await sendToProvider(jobRow, jobRow.provider_id, settings, 'Nouvelle demande directe');
  else await broadcastTender(jobRow, settings);
  return getJobView(jobId, user);
}

async function recordAndSend(jobRow, targets, settings, title) {
  if (!targets.length) return 0;
  await one(
    `INSERT INTO job_broadcasts (job_id, provider_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING RETURNING 1`,
    [jobRow.id, targets.map((t) => t.id)],
  );
  const [base] = await serializeRows([jobRow], null, { settings });
  await Promise.all(
    targets.map(async (t) => {
      const job = t.lat !== null && t.lat !== undefined
        ? serializeJob(jobRow, { viewer: { id: t.id, is_provider: true }, settings, milestones: [], origin: { lat: t.lat, lng: t.lng } })
        : base;
      job.milestones = base.milestones;
      emitToUser(t.id, 'job:new', job);
      const price = jobRow.mode === 'tender'
        ? (jobRow.budget_max ? `budget jusqu'à ${fmt(jobRow.budget_max)}` : 'budget à proposer')
        : fmt(jobRow.price || jobRow.budget);
      await notify(t.id, {
        type: 'job', title,
        body: `${jobRow.title} — ${price}${job.distance_km !== null ? ` · à ${job.distance_km} km` : ''}`,
        data: { job_id: jobRow.id },
      });
    }),
  );
  return targets.length;
}

/** Mode instantané : prestataires en ligne dans le rayon ayant la compétence (ou tous si « Autre service »). */
async function broadcastInstant(jobRow, { settings, isOther }) {
  const targets = await many(
    `SELECT pp.user_id AS id, pp.lat, pp.lng
       FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
      WHERE u.is_provider AND u.status = 'active' AND pp.is_online AND pp.lat IS NOT NULL
        AND u.id <> $1
        AND haversine_km($2, $3, pp.lat, pp.lng) <= $4
        AND ($6::boolean OR EXISTS (
              SELECT 1 FROM provider_skills ps
               WHERE ps.provider_id = pp.user_id
                 AND (ps.category_id = $5 OR ps.category_id = (SELECT parent_id FROM categories WHERE id = $5) OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = $5))))
      LIMIT 200`,
    [jobRow.client_id, jobRow.lat, jobRow.lng, Number(settings.search_radius_km) || 10, jobRow.category_id, isOther],
  );
  return recordAndSend(jobRow, targets, settings, 'Nouvelle mission près de vous');
}

/** Mode direct (et offres, récurrences) : jamais diffusé, uniquement le prestataire ciblé. */
async function sendToProvider(jobRow, providerId, settings, title) {
  const targets = await many('SELECT user_id AS id, lat, lng FROM provider_profiles WHERE user_id = $1', [providerId]);
  return recordAndSend(jobRow, targets, settings, title);
}

/** Appel d'offres : invités, ou prestataires de la compétence dans la ville (≤ 50 km). */
async function broadcastTender(jobRow, settings) {
  const targets = jobRow.visibility === 'invited'
    ? await many('SELECT user_id AS id, lat, lng FROM provider_profiles WHERE user_id = ANY($1)', [jobRow.invited_provider_ids])
    : await many(
      `SELECT pp.user_id AS id, pp.lat, pp.lng
         FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
        WHERE u.is_provider AND u.status = 'active' AND u.id <> $1
          AND ((u.city IS NOT NULL AND u.city = $4) OR (pp.lat IS NOT NULL AND haversine_km($2, $3, pp.lat, pp.lng) <= 50))
          AND ($6::boolean OR EXISTS (SELECT 1 FROM provider_skills ps WHERE ps.provider_id = pp.user_id
                 AND (ps.category_id = $5 OR ps.category_id = (SELECT parent_id FROM categories WHERE id = $5) OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = $5))))
        LIMIT 500`,
      [jobRow.client_id, jobRow.lat, jobRow.lng, jobRow.city, jobRow.category_id, jobRow.cat_slug === 'autre'],
    );
  return recordAndSend(jobRow, targets, settings, 'Nouvel appel d\'offres');
}

// ------------------------------------------------------------------ offre créée par le prestataire
export async function createOffer(user, body) {
  const settings = await getSettings();
  const clientUser = await one(`SELECT id, full_name, status, city FROM users WHERE phone = $1`, [body.client_phone]);
  if (!clientUser || clientUser.status !== 'active') {
    throw notFound('Aucun compte Tasko pour ce numéro. Invitez votre client à rejoindre Tasko.', { can_invite: true });
  }
  if (clientUser.id === user.id) throw badRequest('Vous ne pouvez pas vous proposer une mission à vous-même');
  const cat = await activeCategory(body.category_id);
  const milestones = body.milestones || [];
  let q;
  let msQuote = null;
  if (milestones.length) {
    msQuote = quoteMilestones(milestones, settings);
    q = msQuote.totals;
    if (body.price !== undefined && body.price !== q.price) throw badRequest('Le prix doit être égal à la somme des jalons', { price: 'Invalide' });
  } else {
    if (body.price === undefined) throw badRequest('Prix requis', { price: 'Requis' });
    q = computeQuote(body.price, settings);
  }
  const pp = await one('SELECT lat, lng FROM provider_profiles WHERE user_id = $1', [user.id]);
  const lat = body.lat ?? pp?.lat ?? 3.848;
  const lng = body.lng ?? pp?.lng ?? 11.5021;
  const title = body.title?.trim() || `${cat.name}${body.description ? ` - ${truncate(body.description, 50)}` : ''}`;
  const city = await nearestCity(lat, lng, clientUser.id);
  const jobId = await withTransaction(async (client) => {
    const id = await insertJob(client, {
      client_id: clientUser.id, provider_id: user.id, category_id: cat.id, title, description: body.description,
      address: body.address, city, lat, lng, urgency: body.scheduled_at ? 'scheduled' : 'now', scheduled_at: body.scheduled_at,
      budget: q.price, q, mode: 'direct', origin: 'provider_offer', status: 'accepted',
    });
    if (msQuote) await insertMilestones(client, id, msQuote.items);
    return id;
  });
  await emitJobUpdated(jobId);
  const due = msQuote ? msQuote.items[0].total : q.total;
  await notify(clientUser.id, {
    type: 'job',
    title: `${user.full_name} vous propose une mission`,
    body: `${title} — ${fmt(q.price)}. Payez ${fmt(due)} pour confirmer (fonds bloqués par Tasko jusqu'à la fin), ou refusez.`,
    data: { job_id: jobId },
  });
  return getJobView(jobId, user);
}

// ------------------------------------------------------------------ lecture
export async function listJobs(user, { as, status, mode }) {
  const role = as || 'client';
  const col = role === 'provider' ? 'j.provider_id' : 'j.client_id';
  let statuses = null;
  if (status === 'active') statuses = ACTIVE_STATUSES;
  else if (status === 'history') statuses = HISTORY_STATUSES;
  else if (status) statuses = [status];
  const rows = await fetchJobRows(
    `${col} = $1 AND ($2::text[] IS NULL OR j.status = ANY($2)) AND ($3::text IS NULL OR j.mode = $3)`,
    [user.id, statuses, mode || null],
  );
  return serializeRows(rows, user);
}

export async function nearbyJobs(user, { lat, lng }) {
  const settings = await getSettings();
  const pp = await one('SELECT lat, lng FROM provider_profiles WHERE user_id = $1', [user.id]);
  const origin = { lat: lat ?? pp?.lat, lng: lng ?? pp?.lng };
  if (origin.lat === null || origin.lat === undefined) throw badRequest('Position requise (lat, lng)');
  const rows = await fetchJobRows(
    `j.mode = 'instant' AND j.status = 'requested' AND j.provider_id IS NULL AND j.client_id <> $1
     AND haversine_km($2, $3, j.lat, j.lng) <= $4
     AND NOT EXISTS (SELECT 1 FROM job_declines d WHERE d.job_id = j.id AND d.provider_id = $1)
     AND (cat.slug = 'autre' OR EXISTS (
           SELECT 1 FROM provider_skills ps WHERE ps.provider_id = $1 AND (ps.category_id = j.category_id OR ps.category_id = cat.parent_id OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = j.category_id))))`,
    [user.id, origin.lat, origin.lng, Number(settings.search_radius_km) || 10],
    { order: 'haversine_km($2, $3, j.lat, j.lng)', limit: 50 },
  );
  return serializeRows(rows, user, { origin, settings });
}

/** Un prestataire peut-il voir une mission qui ne lui est pas (encore) attribuée ? */
async function providerCanSee(row, user) {
  if (!user.is_provider || row.client_id === user.id) return false;
  if (row.mode === 'instant' && row.status === 'requested' && !row.provider_id) return true;
  if (row.mode === 'tender') {
    if ((row.invited_provider_ids || []).includes(user.id)) return true;
    if (row.visibility === 'public' && row.status === 'requested') return true;
    const bid = await one('SELECT 1 FROM bids WHERE job_id = $1 AND provider_id = $2', [row.id, user.id]);
    return !!bid;
  }
  return false;
}

export async function canViewJob(row, user) {
  if (user.is_admin || row.client_id === user.id || row.provider_id === user.id) return true;
  return providerCanSee(row, user);
}

export async function getJob(id, user) {
  const row = await fetchJobRow(id);
  if (!row || !(await canViewJob(row, user))) throw notFound('Mission introuvable');
  const [job] = await serializeRows([row], user);
  return job;
}

// ------------------------------------------------------------------ prestataire
/**
 * Acceptation. Mode instantané : le premier gagne (verrou + UPDATE conditionnel), les suivants reçoivent 409 CONFLICT,
 * les autres prestataires notifiés reçoivent `job:closed`. Mode direct : seul le prestataire ciblé.
 */
export async function acceptJob(id, user, { price }) {
  const settings = await getSettings();
  let mode;
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    mode = job.mode;
    if (job.client_id === user.id) throw forbidden('Vous ne pouvez pas accepter votre propre demande');
    if (job.mode === 'tender') throw invalidState('Appel d\'offres : soumettez une offre');
    if (job.mode === 'direct' && job.provider_id !== user.id) throw notFound('Mission introuvable');
    if (job.mode === 'instant' && (job.provider_id || job.status !== 'requested')) {
      throw conflict('Cette mission a déjà été attribuée');
    }
    if (job.status !== 'requested') throw invalidState(`Mission déjà « ${job.status} » : acceptation impossible`);
    if (job.mode === 'instant') {
      const ok = await one(
        `SELECT 1 FROM categories c WHERE c.id = $1 AND (c.slug = 'autre' OR EXISTS (
            SELECT 1 FROM provider_skills ps WHERE ps.provider_id = $2 AND (ps.category_id = c.id OR ps.category_id = c.parent_id OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = c.id))))`,
        [job.category_id, user.id],
        client,
      );
      if (!ok) throw forbidden('Cette mission ne correspond pas à vos compétences');
    }
    const hasMs = await one('SELECT 1 FROM job_milestones WHERE job_id = $1 LIMIT 1', [id], client);
    if (hasMs && price !== undefined) throw badRequest('Le prix d\'une mission par jalons ne peut pas être modifié', { price: 'Non autorisé' });
    const q = hasMs
      ? { price: job.price, service_fee: job.service_fee, total: job.total, provider_commission: job.provider_commission, provider_payout: job.provider_payout }
      : computeQuote(price ?? job.price ?? job.budget, settings);
    const updated = await one(
      `UPDATE jobs SET provider_id = $2, status = 'accepted', accepted_at = now(), price = $3, service_fee = $4, total = $5,
              provider_commission = $6, provider_payout = $7, updated_at = now()
        WHERE id = $1 AND status = 'requested' AND (provider_id IS NULL OR provider_id = $2) RETURNING id`,
      [id, user.id, q.price, q.service_fee, q.total, q.provider_commission, q.provider_payout],
      client,
    );
    if (!updated) throw conflict('Cette mission a déjà été attribuée');
  });
  const job = await emitJobUpdated(id);
  if (mode === 'instant') await emitJobClosed(id, 'assigned', [user.id]);
  await notify(job.client.id, {
    type: 'job',
    title: 'Mission acceptée',
    body: `${job.provider.full_name} a accepté « ${job.title} » pour ${fmt(job.total)}. Payez pour sécuriser la mission : l'argent reste bloqué par Tasko jusqu'à la fin.`,
    data: { job_id: id },
  });
  return getJobView(id, user);
}

export async function declineJob(id, user) {
  let directDecline = false;
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    if (job.mode === 'tender') throw invalidState('Appel d\'offres : retirez simplement votre offre');
    if (job.provider_id && job.provider_id !== user.id) throw notFound('Mission introuvable');
    if (job.status !== 'requested') throw invalidState('Seule une demande en attente peut être refusée');
    if (job.provider_id === user.id) {
      directDecline = true;
      await client.query(
        `UPDATE jobs SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancelled_role = 'provider',
                cancel_reason = 'Refusée par le prestataire', updated_at = now() WHERE id = $1`,
        [id, user.id],
      );
    }
    await client.query('INSERT INTO job_declines (job_id, provider_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, user.id]);
  });
  if (directDecline) {
    const job = await emitJobUpdated(id);
    await notify(job.client.id, {
      type: 'job', title: 'Demande refusée',
      body: `Le prestataire n'est pas disponible pour « ${job.title} ». Essayez un autre prestataire.`,
      data: { job_id: id },
    });
  }
  return { ok: true };
}

/**
 * Statuts terrain (prestataire assigné). RG-G1 : rien ne démarre sans séquestre. RG-G2 : `in_progress` exige le code
 * de démarrage du client. RG-G3/G4 : `done` enregistre les preuves et fixe `auto_release_at`.
 */
export async function updateFieldStatus(id, user, { status, start_code, proof_photos, note }) {
  const settings = await getSettings();
  const outcome = await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    if (job.provider_id !== user.id) {
      if (job.client_id === user.id) throw forbidden('Seul le prestataire assigné peut modifier ce statut');
      throw notFound('Mission introuvable');
    }
    if (['requested', 'accepted'].includes(job.status) && status !== 'done') {
      throw invalidState('Fonds non sécurisés : attendez que le client paie avant de vous déplacer', { from: job.status, to: status });
    }
    if (FIELD_TRANSITIONS[job.status] !== status) {
      throw invalidState(`Transition interdite : ${job.status} → ${status}`, { from: job.status, to: status, expected: FIELD_TRANSITIONS[job.status] ?? null });
    }
    if (job.payment_status !== 'held') throw invalidState('Fonds non sécurisés');
    const hasMs = await one('SELECT 1 FROM job_milestones WHERE job_id = $1 LIMIT 1', [id], client);
    if (status === 'done' && hasMs) throw invalidState('Mission par jalons : déclarez chaque jalon terminé (milestones/:mid/submit)');

    if (status === 'in_progress' && settings.require_start_code !== false) {
      if (job.start_code_failures >= START_CODE_MAX_FAILURES) throw forbidden('Trop de codes erronés : contactez le support Tasko');
      if (!start_code) throw badRequest('Code de démarrage requis (demandez-le au client)', { start_code: 'Requis' });
      if (!job.start_code || !safeEqual(start_code, job.start_code)) {
        const attempts = job.start_code_attempts + 1;
        const regenerate = attempts >= START_CODE_MAX_ATTEMPTS;
        const code = regenerate ? newStartCode() : job.start_code;
        await client.query(
          `UPDATE jobs SET start_code_attempts = $2, start_code_failures = start_code_failures + 1, start_code = $3, updated_at = now() WHERE id = $1`,
          [id, regenerate ? 0 : attempts, code],
        );
        return { badCode: true, regenerate, code, clientId: job.client_id, title: job.title };
      }
    }
    if (status === 'done' && settings.require_completion_proof && !(proof_photos && proof_photos.length)) {
      throw badRequest('Photos de fin de travail obligatoires', { proof_photos: 'Requis' });
    }
    if (status === 'in_progress') {
      await client.query(`UPDATE jobs SET status = 'in_progress', started_at = now(), start_code_attempts = 0, updated_at = now() WHERE id = $1`, [id]);
    } else if (status === 'done') {
      await client.query(
        `UPDATE jobs SET status = 'done', done_at = now(), auto_release_at = now() + make_interval(hours => $2),
                proof_photos = $3, completion_note = $4, updated_at = now() WHERE id = $1`,
        [id, Number(settings.auto_release_hours) || 48, proof_photos || [], note || null],
      );
    } else {
      await client.query('UPDATE jobs SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    }
    return { ok: true };
  });
  if (outcome.badCode) {
    if (outcome.regenerate) {
      await notify(outcome.clientId, {
        type: 'job', title: 'Nouveau code de démarrage',
        body: `Plusieurs codes erronés ont été saisis pour « ${outcome.title} ». Nouveau code : ${outcome.code} — ne le donnez qu'au prestataire présent.`,
        data: { job_id: id },
      });
    }
    throw badRequest('Code de démarrage incorrect', { start_code: 'Incorrect' });
  }
  const job = await emitJobUpdated(id);
  const [title, verb] = FIELD_LABELS[status];
  const body = status === 'done'
    ? `${job.provider.full_name} a terminé « ${job.title} ». Validez, ou signalez un problème avant le ${fmtDate(job.auto_release_at)} : sans réponse, le paiement sera libéré automatiquement.`
    : `${job.provider.full_name} ${verb}.`;
  await notify(job.client.id, { type: 'job', title, body, data: { job_id: id } });
  return getJobView(id, user);
}

// ------------------------------------------------------------------ libération (client, auto, admin)
/**
 * Clôture une mission par jalons si tous les jalons sont terminés (released/refunded) ; passe en `done` quand
 * plus aucun jalon n'est à exécuter. Retourne le nouveau statut éventuel.
 */
export async function finalizeMilestoneJob(client, jobId, by) {
  const job = await one('SELECT * FROM jobs WHERE id = $1', [jobId], client);
  const ms = await many('SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY position', [jobId], client);
  if (!ms.length) return null;
  if (ms.every((m) => ['released', 'refunded'].includes(m.status))) {
    if (ms.some((m) => m.status === 'released')) {
      await client.query(
        `UPDATE jobs SET status = 'completed', payment_status = 'released', completed_at = now(), completed_by = $2, updated_at = now() WHERE id = $1`,
        [jobId, by],
      );
      return 'completed';
    }
    await client.query(
      `UPDATE jobs SET status = 'cancelled', payment_status = 'refunded', cancelled_at = now(), cancelled_role = $2, updated_at = now() WHERE id = $1`,
      [jobId, by === 'admin' ? 'admin' : 'system'],
    );
    return 'cancelled';
  }
  const open = ms.filter((m) => !['released', 'refunded'].includes(m.status));
  if (job.status === 'in_progress' && open.every((m) => m.status === 'submitted')) {
    const due = open.reduce((max, m) => (m.auto_release_at && (!max || m.auto_release_at > max) ? m.auto_release_at : max), null);
    await client.query(`UPDATE jobs SET status = 'done', done_at = now(), auto_release_at = $2, updated_at = now() WHERE id = $1`, [jobId, due]);
    return 'done';
  }
  return null;
}

/** Libère un jalon (client, auto ou admin). Jalon et mission verrouillés par l'appelant. */
export async function releaseMilestoneInTx(client, job, m, by, settings) {
  const payoutId = await releaseUnitInTx(client, job, m, settings);
  await client.query(`UPDATE job_milestones SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1`, [m.id]);
  await finalizeMilestoneJob(client, job.id, by);
  return payoutId;
}

/** Libère une mission sans jalons (client, auto, admin). Mission verrouillée par l'appelant. */
export async function releaseJobInTx(client, job, by, settings) {
  if (job.payment_status !== 'held') throw invalidState('Aucun fonds en séquestre pour cette mission');
  const payoutId = await releaseUnitInTx(client, job, null, settings);
  await client.query(
    `UPDATE jobs SET status = 'completed', payment_status = 'released', completed_at = now(), completed_by = $2, updated_at = now() WHERE id = $1`,
    [job.id, by],
  );
  return payoutId;
}

async function insertReview(client, job, author, { rating, comment, punctuality, quality, behavior, value }) {
  const toClient = author !== job.client_id;
  const target = toClient ? job.client_id : job.provider_id;
  const r = await one(
    `INSERT INTO reviews (job_id, author_id, target_id, target_role, rating, comment, punctuality, quality, behavior, value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (job_id, author_id) DO NOTHING RETURNING *`,
    [job.id, author, target, toClient ? 'client' : 'provider', rating, comment || null, punctuality ?? null, quality ?? null, behavior ?? null, value ?? null],
    client,
  );
  if (r && !toClient) await recomputeRating(target, client);
  return r;
}

/** Le client valide la fin : libération des fonds (tous les jalons restants pour une mission par jalons). */
export async function completeJob(id, user, body) {
  const settings = await getSettings();
  const payoutIds = [];
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    if (job.client_id !== user.id) {
      if (job.provider_id === user.id) throw forbidden('Seul le client peut confirmer la fin de la mission');
      throw notFound('Mission introuvable');
    }
    if (!FUNDED_STATUSES.includes(job.status)) throw invalidState(`Mission « ${job.status} » : confirmation impossible`);
    const ms = await lockMilestones(client, id);
    if (ms.length) {
      if (ms.some((m) => m.status === 'pending')) throw invalidState('Des jalons ne sont pas encore payés : libérez les jalons un par un');
      for (const m of ms.filter((x) => ['funded', 'submitted'].includes(x.status))) {
        payoutIds.push(await releaseUnitInTx(client, job, m, settings));
        await client.query(`UPDATE job_milestones SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1`, [m.id]);
      }
      const st = await finalizeMilestoneJob(client, id, 'client');
      if (st !== 'completed') throw invalidState('Un jalon est en litige : la mission ne peut pas être close');
    } else {
      payoutIds.push(await releaseJobInTx(client, job, 'client', settings));
    }
    await recomputeProviderStats(job.provider_id, client);
    if (body.rating) await insertReview(client, job, user.id, body);
  });
  for (const pid of payoutIds) await executeOutgoing(pid);
  const job = await emitJobUpdated(id);
  await notify(job.provider.id, {
    type: 'job', title: 'Mission terminée',
    body: `${job.client.full_name} a confirmé « ${job.title} ». ${fmt(job.provider_payout)} vous sont versés.`,
    data: { job_id: id },
  });
  return getJobView(id, user);
}

// ------------------------------------------------------------------ jalons
export async function submitMilestone(id, mid, user, { proof_photos, note }) {
  const settings = await getSettings();
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    if (job.provider_id !== user.id) {
      if (job.client_id === user.id) throw forbidden('Seul le prestataire peut déclarer un jalon terminé');
      throw notFound('Mission introuvable');
    }
    const m = await one('SELECT * FROM job_milestones WHERE id = $1 AND job_id = $2 FOR UPDATE', [mid, id], client);
    if (!m) throw notFound('Jalon introuvable');
    if (m.status === 'pending') throw invalidState('Jalon non séquestré : attendez que le client le paie avant de l\'exécuter');
    if (m.status !== 'funded') throw invalidState(`Jalon « ${m.status} » : déclaration impossible`);
    if (job.status !== 'in_progress') throw invalidState('Démarrez la mission (code de démarrage) avant de déclarer un jalon');
    if (settings.require_completion_proof && !(proof_photos && proof_photos.length)) {
      throw badRequest('Photos de fin de jalon obligatoires', { proof_photos: 'Requis' });
    }
    await client.query(
      `UPDATE job_milestones SET status = 'submitted', submitted_at = now(), auto_release_at = now() + make_interval(hours => $2),
              proof_photos = $3, note = $4, updated_at = now() WHERE id = $1`,
      [mid, Number(settings.auto_release_hours) || 48, proof_photos || [], note || null],
    );
    await finalizeMilestoneJob(client, id, 'client');
  });
  const job = await emitJobUpdated(id);
  const m = job.milestones.find((x) => x.id === mid);
  await notify(job.client.id, {
    type: 'job', title: 'Jalon terminé',
    body: `${job.provider.full_name} a terminé le jalon « ${m.title} ». Validez, ou signalez un problème avant le ${fmtDate(m.auto_release_at)} : sans réponse, il sera libéré automatiquement.`,
    data: { job_id: id, milestone_id: mid },
  });
  return getJobView(id, user);
}

export async function releaseMilestone(id, mid, user) {
  const settings = await getSettings();
  let payoutId;
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    if (job.client_id !== user.id) {
      if (job.provider_id === user.id) throw forbidden('Seul le client peut libérer un jalon');
      throw notFound('Mission introuvable');
    }
    const m = await one('SELECT * FROM job_milestones WHERE id = $1 AND job_id = $2 FOR UPDATE', [mid, id], client);
    if (!m) throw notFound('Jalon introuvable');
    if (!['funded', 'submitted'].includes(m.status)) throw invalidState(`Jalon « ${m.status} » : libération impossible`);
    payoutId = await releaseMilestoneInTx(client, job, m, 'client', settings);
    await recomputeProviderStats(job.provider_id, client);
  });
  await executeOutgoing(payoutId);
  const job = await emitJobUpdated(id);
  const m = job.milestones.find((x) => x.id === mid);
  await notify(job.provider.id, {
    type: 'payment', title: 'Jalon libéré',
    body: `${job.client.full_name} a validé « ${m.title} » : ${fmt(m.provider_payout)} vous sont versés.`,
    data: { job_id: id, milestone_id: mid },
  });
  return getJobView(id, user);
}

// ------------------------------------------------------------------ avis
export async function reviewJob(id, user, body) {
  const review = await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    assertParty(job, user);
    if (job.status !== 'completed') throw invalidState('Un avis ne peut être laissé que sur une mission terminée');
    const r = await insertReview(client, job, user.id, body);
    if (!r) throw conflict('Vous avez déjà laissé un avis pour cette mission');
    return r;
  });
  const author = await one('SELECT full_name, avatar_url FROM users WHERE id = $1', [user.id]);
  await notify(review.target_id, {
    type: 'system', title: 'Nouvel avis', body: `${author.full_name} vous a donné ${review.rating}/5.`, data: { job_id: id },
  });
  return serializeReview({ ...review, author_name: author.full_name, author_avatar: author.avatar_url });
}

// ------------------------------------------------------------------ annulation (RG-G5, RG-G10)
export async function cancelJob(id, user, { reason }) {
  const settings = await getSettings();
  const outgoing = [];
  let other = null;
  let closeReason = null;
  let rejectedBidders = [];
  let fee = 0;
  await withTransaction(async (client) => {
    const job = await lockJob(client, id);
    const isClient = job.client_id === user.id;
    const isProvider = !!job.provider_id && job.provider_id === user.id;
    if (!isClient && !isProvider) throw notFound('Mission introuvable');
    const ms = await lockMilestones(client, id);
    const heldUnits = ms.length
      ? ms.filter((m) => ['funded', 'submitted'].includes(m.status))
      : job.payment_status === 'held' ? [null] : [];

    if (['requested', 'accepted'].includes(job.status)) {
      // gratuit (un paiement en cours arrivant plus tard sera remboursé automatiquement)
      if (job.status === 'requested' && !job.provider_id) closeReason = 'cancelled';
    } else if (isClient) {
      if (job.status === 'funded') {
        for (const u of heldUnits) outgoing.push(await refundUnitInTx(client, job, u));
      } else if (job.status === 'en_route') {
        const [first, ...rest] = heldUnits;
        const unit = first || job;
        fee = Math.min(Number(settings.cancellation_fee_en_route) || 0, (first ? first.amount : job.price));
        if (heldUnits.length) {
          if (fee > 0) outgoing.push(...(await cancellationFeeInTx(client, job, first, fee, settings)));
          else outgoing.push(await refundUnitInTx(client, job, first));
        }
        for (const u of rest) outgoing.push(await refundUnitInTx(client, job, u));
        void unit;
      } else {
        throw invalidState('Le prestataire est déjà sur place : annulation impossible. Ouvrez un litige si nécessaire.');
      }
    } else if (['funded', 'en_route', 'arrived', 'in_progress'].includes(job.status)) {
      for (const u of heldUnits) outgoing.push(await refundUnitInTx(client, job, u));
    } else {
      throw invalidState(`Mission « ${job.status} » : annulation impossible`);
    }

    if (ms.length) {
      await client.query(
        `UPDATE job_milestones SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE job_id = $1 AND status IN ('funded', 'submitted')`,
        [id],
      );
    }
    await client.query(
      `UPDATE jobs SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancelled_role = $3, cancel_reason = $4,
              cancellation_fee = $5, payment_status = CASE WHEN $6 THEN 'refunded' WHEN payment_status = 'pending' THEN 'unpaid' ELSE payment_status END,
              updated_at = now()
        WHERE id = $1`,
      [id, user.id, isClient ? 'client' : 'provider', reason || null, fee, heldUnits.length > 0],
    );
    if (job.mode === 'tender') {
      const rej = await many(`UPDATE bids SET status = 'rejected', updated_at = now() WHERE job_id = $1 AND status = 'pending' RETURNING *`, [id], client);
      rejectedBidders = rej;
      closeReason = 'cancelled';
    }
    if (job.provider_id) await recomputeProviderStats(job.provider_id, client);
    other = isClient ? job.provider_id : job.client_id;
  });
  for (const oid of outgoing) await executeOutgoing(oid);
  const job = await emitJobUpdated(id);
  if (closeReason) await emitJobClosed(id, closeReason);
  for (const b of rejectedBidders) emitToUser(b.provider_id, 'bid:updated', { id: b.id, job_id: b.job_id, status: 'rejected' });
  if (other) {
    const extra = fee > 0 ? ` Frais de déplacement versés au prestataire : ${fmt(fee)}.` : '';
    await notify(other, { type: 'job', title: 'Mission annulée', body: `« ${job.title} » a été annulée${reason ? ` : ${reason}` : ''}.${extra}`, data: { job_id: id } });
  }
  return getJobView(id, user);
}

export { ALL_STATUSES };
