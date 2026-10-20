import { many, one, withTransaction } from '../../db.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../utils/errors.js';
import { emitToUser } from '../../realtime/hub.js';
import { getSettings } from '../settings/service.js';
import { notify } from '../notifications/service.js';
import { providerCardsByIds } from '../providers/service.js';
import { expandCategoryIds } from '../categories/service.js';
import { fmt } from '../payments/service.js';
import { emitJobClosed, emitJobUpdated, fetchJobRows, getJobView, serializeBidBase, serializeRows } from './repo.js';
import { insertMilestones, lockJob, quoteMilestones } from './service.js';
import { computeQuote } from '../settings/service.js';

/**
 * Score d'une offre (0–1) pour aider le client à comparer :
 * 0.40·(prix le plus bas / prix) + 0.25·(note/5) + 0.15·min(missions/50,1) + 0.10·(délai le plus court / délai) + 0.10·jalons proposés
 */
function bidScore(b, card, { minAmount, minDuration }) {
  const price = minAmount && b.amount ? minAmount / b.amount : 0;
  const rating = Number(card?.rating_avg || 0) / 5;
  const missions = Math.min((card?.missions_completed || 0) / 50, 1);
  const delay = b.duration_days && minDuration ? minDuration / b.duration_days : 0.5;
  const ms = (b.milestones || []).length ? 1 : 0;
  return Math.round((0.4 * price + 0.25 * rating + 0.15 * missions + 0.1 * delay + 0.1 * ms) * 100) / 100;
}

async function serializeBids(rows, job) {
  const cards = await providerCardsByIds(rows.map((b) => b.provider_id), { lat: job.lat, lng: job.lng });
  const active = rows.filter((b) => b.status !== 'withdrawn');
  const minAmount = Math.min(...active.map((b) => b.amount), Infinity);
  const durations = active.map((b) => b.duration_days).filter(Boolean);
  const minDuration = durations.length ? Math.min(...durations) : null;
  return rows
    .map((b) => {
      const card = cards.get(b.provider_id) || { id: b.provider_id };
      return { ...serializeBidBase(b), provider: card, score: bidScore(b, card, { minAmount: Number.isFinite(minAmount) ? minAmount : null, minDuration }) };
    })
    .sort((a, b) => (a.status === 'withdrawn') - (b.status === 'withdrawn') || b.score - a.score);
}

/** Le prestataire est-il éligible à cet appel d'offres (invité, ou compétence pour un appel public) ? */
async function eligible(job, user, client) {
  if ((job.invited_provider_ids || []).includes(user.id)) return true;
  if (job.visibility !== 'public') return false;
  const ok = await one(
    `SELECT 1 FROM categories c WHERE c.id = $1 AND (c.slug = 'autre' OR EXISTS (
        SELECT 1 FROM provider_skills ps WHERE ps.provider_id = $2 AND (ps.category_id = c.id OR ps.category_id = c.parent_id OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = c.id))))`,
    [job.category_id, user.id],
    client,
  );
  return !!ok;
}

/** GET /tenders — appels d'offres ouverts accessibles au prestataire. */
export async function listTenders(user, { category_id, q }) {
  const me = await one('SELECT u.city, pp.lat, pp.lng FROM users u LEFT JOIN provider_profiles pp ON pp.user_id = u.id WHERE u.id = $1', [user.id]);
  const catIds = category_id ? await expandCategoryIds(category_id) : null;
  const rows = await fetchJobRows(
    `j.mode = 'tender' AND j.status = 'requested' AND j.bid_deadline > now() AND j.tender_closed_at IS NULL AND j.client_id <> $1
     AND ( $1 = ANY(j.invited_provider_ids)
        OR (j.visibility = 'public'
            AND (cat.slug = 'autre' OR EXISTS (SELECT 1 FROM provider_skills ps WHERE ps.provider_id = $1
                  AND (ps.category_id = j.category_id OR ps.category_id = cat.parent_id OR ps.category_id IN (SELECT id FROM categories WHERE parent_id = j.category_id))))
            AND (j.city IS NULL OR j.city = $2 OR ($3::float8 IS NOT NULL AND haversine_km($3, $4, j.lat, j.lng) <= 50))) )
     AND ($5::uuid[] IS NULL OR j.category_id = ANY($5))
     AND ($6::text IS NULL OR j.title ILIKE $6 OR j.description ILIKE $6)`,
    [user.id, me?.city || null, me?.lat ?? null, me?.lng ?? null, catIds, q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null],
    { order: 'j.bid_deadline ASC', limit: 100 },
  );
  const origin = me?.lat !== null && me?.lat !== undefined ? { lat: me.lat, lng: me.lng } : null;
  return serializeRows(rows, user, { origin });
}

function validateBidMilestones(amount, milestones) {
  if (!milestones?.length) return [];
  const sum = milestones.reduce((s, m) => s + m.amount, 0);
  if (sum !== amount) throw badRequest(`La somme des jalons (${sum} FCFA) doit être égale au montant de l'offre`, { milestones: 'Invalide' });
  return milestones.map((m) => ({ title: m.title, amount: m.amount }));
}

/** POST /jobs/:id/bids — crée ou met à jour l'offre du prestataire (une par prestataire). */
export async function submitBid(jobId, user, body) {
  const settings = await getSettings();
  const milestones = validateBidMilestones(body.amount, body.milestones);
  const { bid, clientId, title } = await withTransaction(async (client) => {
    const job = await lockJob(client, jobId);
    if (job.mode !== 'tender') throw notFound('Appel d\'offres introuvable');
    if (job.client_id === user.id) throw forbidden('Vous ne pouvez pas répondre à votre propre appel d\'offres');
    if (!(await eligible(job, user, client))) throw notFound('Appel d\'offres introuvable');
    if (job.status !== 'requested' || job.provider_id) throw conflict('Cet appel d\'offres a déjà été attribué');
    if (job.tender_closed_at || new Date(job.bid_deadline).getTime() <= Date.now()) throw conflict('La date limite de dépôt des offres est dépassée');
    const { n } = await one(
      `SELECT count(*)::int AS n FROM bids WHERE job_id = $1 AND status <> 'withdrawn' AND provider_id <> $2`,
      [jobId, user.id],
      client,
    );
    if (n >= Number(settings.max_bids_per_tender || 30)) throw conflict('Nombre maximal d\'offres atteint pour cet appel d\'offres');
    const row = await one(
      `INSERT INTO bids (job_id, provider_id, amount, duration_days, message, attachments, milestones)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (job_id, provider_id) DO UPDATE SET amount = EXCLUDED.amount, duration_days = EXCLUDED.duration_days,
         message = EXCLUDED.message, attachments = EXCLUDED.attachments, milestones = EXCLUDED.milestones,
         status = 'pending', updated_at = now()
       WHERE bids.status IN ('pending', 'withdrawn')
       RETURNING *`,
      [jobId, user.id, body.amount, body.duration_days ?? null, body.message ?? null, body.attachments || [], JSON.stringify(milestones)],
      client,
    );
    if (!row) throw conflict('Votre offre ne peut plus être modifiée');
    return { bid: row, clientId: job.client_id, title: job.title, job };
  });
  const job = await one('SELECT lat, lng FROM jobs WHERE id = $1', [jobId]);
  const [out] = await serializeBids([bid], job);
  emitToUser(clientId, 'bid:new', out);
  await notify(clientId, {
    type: 'job', title: 'Nouvelle offre reçue',
    body: `${out.provider.full_name || 'Un prestataire'} propose ${fmt(bid.amount)} pour « ${title} ».`,
    data: { job_id: jobId, bid_id: bid.id },
  });
  return out;
}

/** GET /jobs/:id/bids — client propriétaire (ou admin) : toutes ; prestataire : la sienne. */
export async function listBids(jobId, user) {
  const job = await one('SELECT id, client_id, mode, lat, lng FROM jobs WHERE id = $1', [jobId]);
  if (!job || job.mode !== 'tender') throw notFound('Appel d\'offres introuvable');
  if (job.client_id === user.id || user.is_admin) {
    return serializeBids(await many('SELECT * FROM bids WHERE job_id = $1', [jobId]), job);
  }
  const mine = await many('SELECT * FROM bids WHERE job_id = $1 AND provider_id = $2', [jobId, user.id]);
  if (!user.is_provider) throw notFound('Appel d\'offres introuvable');
  return serializeBids(mine, job);
}

export async function withdrawBid(jobId, bidId, user) {
  const b = await one(
    `UPDATE bids SET status = 'withdrawn', updated_at = now()
      WHERE id = $1 AND job_id = $2 AND provider_id = $3 AND status = 'pending' RETURNING id`,
    [bidId, jobId, user.id],
  );
  if (!b) {
    const exists = await one('SELECT status FROM bids WHERE id = $1 AND job_id = $2 AND provider_id = $3', [bidId, jobId, user.id]);
    if (!exists) throw notFound('Offre introuvable');
    throw invalidState(`Offre « ${exists.status} » : retrait impossible`);
  }
  return { ok: true };
}

/** POST /jobs/:id/bids/:bidId/award — attribution atomique : job `accepted`, offre acceptée, autres rejetées. */
export async function awardBid(jobId, bidId, user) {
  const settings = await getSettings();
  const res = await withTransaction(async (client) => {
    const job = await lockJob(client, jobId);
    if (job.client_id !== user.id) throw notFound('Appel d\'offres introuvable');
    if (job.mode !== 'tender') throw invalidState('Cette mission n\'est pas un appel d\'offres');
    if (job.status !== 'requested' || job.provider_id) throw conflict('Cet appel d\'offres a déjà été attribué');
    const bid = await one('SELECT * FROM bids WHERE id = $1 AND job_id = $2 FOR UPDATE', [bidId, jobId], client);
    if (!bid) throw notFound('Offre introuvable');
    if (bid.status !== 'pending') throw invalidState(`Offre « ${bid.status} » : attribution impossible`);
    const prov = await one(`SELECT 1 FROM users WHERE id = $1 AND status = 'active' AND is_provider`, [bid.provider_id], client);
    if (!prov) throw invalidState('Ce prestataire n\'est plus disponible');

    const ms = bid.milestones || [];
    let q;
    let items = null;
    if (ms.length) {
      const mq = quoteMilestones(ms, settings);
      q = mq.totals;
      items = mq.items;
    } else q = computeQuote(bid.amount, settings);
    const upd = await one(
      `UPDATE jobs SET provider_id = $2, status = 'accepted', accepted_at = now(), price = $3, service_fee = $4, total = $5,
              provider_commission = $6, provider_payout = $7, tender_closed_at = coalesce(tender_closed_at, now()), updated_at = now()
        WHERE id = $1 AND status = 'requested' AND provider_id IS NULL RETURNING id`,
      [jobId, bid.provider_id, q.price, q.service_fee, q.total, q.provider_commission, q.provider_payout],
      client,
    );
    if (!upd) throw conflict('Cet appel d\'offres a déjà été attribué');
    await client.query('DELETE FROM job_milestones WHERE job_id = $1', [jobId]);
    if (items) await insertMilestones(client, jobId, items);
    await client.query(`UPDATE bids SET status = 'accepted', updated_at = now() WHERE id = $1`, [bidId]);
    const rejected = await many(
      `UPDATE bids SET status = 'rejected', updated_at = now() WHERE job_id = $1 AND id <> $2 AND status = 'pending' RETURNING *`,
      [jobId, bidId],
      client,
    );
    return { winner: { ...bid, status: 'accepted' }, rejected, title: job.title, lat: job.lat, lng: job.lng };
  });
  const all = await serializeBids([res.winner, ...res.rejected], { lat: res.lat, lng: res.lng });
  for (const b of all) emitToUser(b.provider.id, 'bid:updated', b);
  await notify(res.winner.provider_id, {
    type: 'job', title: 'Offre retenue 🎉',
    body: `Votre offre de ${fmt(res.winner.amount)} pour « ${res.title} » a été retenue. Le client va sécuriser le paiement.`,
    data: { job_id: jobId, bid_id: res.winner.id },
  });
  await Promise.all(res.rejected.map((b) => notify(b.provider_id, {
    type: 'job', title: 'Offre non retenue', body: `Le client a choisi une autre offre pour « ${res.title} ».`, data: { job_id: jobId, bid_id: b.id },
  })));
  await emitJobUpdated(jobId);
  await emitJobClosed(jobId, 'assigned', [res.winner.provider_id]);
  return getJobView(jobId, user);
}

/** Planificateur : clôture des appels d'offres échus (job:closed reason expired). Sans offre → annulé. */
export async function expireTenders(now) {
  const rows = await many(
    `SELECT id FROM jobs WHERE mode = 'tender' AND status = 'requested' AND tender_closed_at IS NULL AND bid_deadline <= $1 LIMIT 200`,
    [now],
  );
  let n = 0;
  for (const { id } of rows) {
    const r = await withTransaction(async (client) => {
      const job = await one(
        `SELECT * FROM jobs WHERE id = $1 AND status = 'requested' AND tender_closed_at IS NULL FOR UPDATE SKIP LOCKED`,
        [id],
        client,
      );
      if (!job) return null;
      const { c } = await one(`SELECT count(*)::int AS c FROM bids WHERE job_id = $1 AND status = 'pending'`, [id], client);
      if (c === 0) {
        await client.query(
          `UPDATE jobs SET tender_closed_at = $2, status = 'cancelled', cancelled_at = $2, cancelled_role = 'system',
                  cancel_reason = 'Aucune offre reçue avant la date limite', updated_at = now() WHERE id = $1`,
          [id, now],
        );
      } else {
        await client.query('UPDATE jobs SET tender_closed_at = $2, updated_at = now() WHERE id = $1', [id, now]);
      }
      return { job, bids: c };
    });
    if (!r) continue;
    n++;
    await emitJobClosed(id, 'expired');
    await emitJobUpdated(id);
    await notify(r.job.client_id, {
      type: 'job', title: 'Appel d\'offres clos',
      body: r.bids
        ? `« ${r.job.title} » : ${r.bids} offre(s) reçue(s). Comparez-les et choisissez votre prestataire.`
        : `« ${r.job.title} » : aucune offre reçue avant la date limite. Vous pouvez republier votre demande.`,
      data: { job_id: id },
    });
  }
  return n;
}
