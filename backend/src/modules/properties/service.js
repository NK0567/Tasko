import { many, one, withTransaction } from '../../db.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { computeQuote, getSettings } from '../settings/service.js';
import { notify } from '../notifications/service.js';
import { emitToUser } from '../../realtime/hub.js';
import { fetchJobRows, getJobView, serializeRows } from '../jobs/repo.js';
import { fmt } from '../payments/service.js';

// ------------------------------------------------------------------ biens immobiliers (propriétaire uniquement)
const PROPERTY_SELECT = `
  SELECT p.*,
         (SELECT count(*) FROM jobs j WHERE j.property_id = p.id) AS jobs_count,
         (SELECT coalesce(sum(j.total), 0) FROM jobs j WHERE j.property_id = p.id AND j.payment_status IN ('held', 'released')) AS total_spent
    FROM properties p`;

export function serializeProperty(p) {
  return {
    id: p.id, name: p.name, kind: p.kind, address: p.address, lat: p.lat, lng: p.lng, units_count: p.units_count, notes: p.notes,
    jobs_count: Number(p.jobs_count || 0), total_spent: Number(p.total_spent || 0), created_at: p.created_at,
  };
}

export async function listProperties(user) {
  const rows = await many(`${PROPERTY_SELECT} WHERE p.owner_id = $1 ORDER BY p.created_at DESC`, [user.id]);
  return rows.map(serializeProperty);
}

async function ownProperty(id, user) {
  const p = await one(`${PROPERTY_SELECT} WHERE p.id = $1 AND p.owner_id = $2`, [id, user.id]);
  if (!p) throw notFound('Bien introuvable');
  return p;
}

export async function getProperty(id, user) {
  const p = await ownProperty(id, user);
  const [jobRows, recurring] = await Promise.all([
    fetchJobRows('j.property_id = $1 AND j.client_id = $2', [id, user.id], { limit: 100 }),
    listRecurring(user, { property_id: id }),
  ]);
  return { ...serializeProperty(p), jobs: await serializeRows(jobRows, user), recurring };
}

export async function createProperty(user, b) {
  const r = await one(
    `INSERT INTO properties (owner_id, name, kind, address, lat, lng, units_count, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id, b.name, b.kind, b.address ?? null, b.lat ?? null, b.lng ?? null, b.units_count ?? null, b.notes ?? null],
  );
  return serializeProperty(await ownProperty(r.id, user));
}

export async function updateProperty(id, user, b) {
  await ownProperty(id, user);
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    const sets = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
    await one(`UPDATE properties SET ${sets}, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, user.id, ...fields.map(([, v]) => v)]);
  }
  return getProperty(id, user);
}

export async function deleteProperty(id, user) {
  const r = await one('DELETE FROM properties WHERE id = $1 AND owner_id = $2 RETURNING id', [id, user.id]);
  if (!r) throw notFound('Bien introuvable');
  return { ok: true };
}

// ------------------------------------------------------------------ missions récurrentes
const RECURRING_SELECT = `
  SELECT r.*, pu.full_name AS provider_name, pp.public_code AS provider_code, c.name AS category_name, p.name AS property_name
    FROM recurring_jobs r
    JOIN users pu ON pu.id = r.provider_id
    LEFT JOIN provider_profiles pp ON pp.user_id = r.provider_id
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN properties p ON p.id = r.property_id`;

export function serializeRecurring(r) {
  return {
    id: r.id,
    property_id: r.property_id,
    property: r.property_id ? { id: r.property_id, name: r.property_name } : null,
    category_id: r.category_id,
    category_name: r.category_name,
    provider_id: r.provider_id,
    provider: { id: r.provider_id, full_name: r.provider_name, public_code: r.provider_code },
    title: r.title,
    description: r.description,
    price: r.price,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    frequency: r.frequency,
    next_run_at: r.next_run_at,
    last_run_at: r.last_run_at,
    is_active: r.is_active,
    created_at: r.created_at,
  };
}

export async function listRecurring(user, { property_id } = {}) {
  const rows = await many(
    `${RECURRING_SELECT} WHERE r.client_id = $1 AND ($2::uuid IS NULL OR r.property_id = $2) ORDER BY r.next_run_at`,
    [user.id, property_id || null],
  );
  return rows.map(serializeRecurring);
}

async function ownRecurring(id, user) {
  const r = await one(`${RECURRING_SELECT} WHERE r.id = $1 AND r.client_id = $2`, [id, user.id]);
  if (!r) throw notFound('Mission récurrente introuvable');
  return r;
}

async function checkRefs(user, b) {
  let prop = null;
  if (b.property_id) {
    prop = await one('SELECT * FROM properties WHERE id = $1 AND owner_id = $2', [b.property_id, user.id]);
    if (!prop) throw badRequest('Bien introuvable', { property_id: 'Invalide' });
  }
  if (b.provider_id) {
    if (b.provider_id === user.id) throw badRequest('Vous ne pouvez pas être votre propre prestataire', { provider_id: 'Invalide' });
    const p = await one(`SELECT 1 FROM users WHERE id = $1 AND is_provider AND status = 'active'`, [b.provider_id]);
    if (!p) throw badRequest('Prestataire introuvable', { provider_id: 'Invalide' });
  }
  if (b.category_id) {
    const c = await one('SELECT 1 FROM categories WHERE id = $1 AND is_active', [b.category_id]);
    if (!c) throw badRequest('Service introuvable', { category_id: 'Invalide' });
  }
  return prop;
}

export async function createRecurring(user, b) {
  const prop = await checkRefs(user, b);
  const lat = b.lat ?? prop?.lat;
  const lng = b.lng ?? prop?.lng;
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    throw badRequest('Position requise (lat, lng) ou bien immobilier géolocalisé', { lat: 'Requis' });
  }
  const r = await one(
    `INSERT INTO recurring_jobs (client_id, property_id, category_id, provider_id, title, description, price, address, lat, lng, frequency, next_run_at, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13, true)) RETURNING id`,
    [user.id, b.property_id ?? null, b.category_id, b.provider_id, b.title, b.description ?? null, b.price, b.address ?? prop?.address ?? null,
      lat, lng, b.frequency, b.next_run_at ?? new Date(Date.now() + 86400e3), b.is_active ?? null],
  );
  return serializeRecurring(await ownRecurring(r.id, user));
}

export async function updateRecurring(id, user, b) {
  await ownRecurring(id, user);
  await checkRefs(user, b);
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    const sets = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
    await one(`UPDATE recurring_jobs SET ${sets}, updated_at = now() WHERE id = $1 AND client_id = $2 RETURNING id`, [id, user.id, ...fields.map(([, v]) => v)]);
  }
  return serializeRecurring(await ownRecurring(id, user));
}

export async function deleteRecurring(id, user) {
  const r = await one('DELETE FROM recurring_jobs WHERE id = $1 AND client_id = $2 RETURNING id', [id, user.id]);
  if (!r) throw notFound('Mission récurrente introuvable');
  return { ok: true };
}

const STEP = { weekly: "interval '7 days'", biweekly: "interval '14 days'", monthly: "interval '1 month'" };

/** Planificateur : crée la mission `direct` (requested) du prestataire attitré à `next_run_at`, puis avance l'échéance. */
export async function runRecurring(now) {
  const settings = await getSettings();
  const created = [];
  for (let i = 0; i < 100; i++) {
    const res = await withTransaction(async (client) => {
      const r = await one(
        `SELECT r.* FROM recurring_jobs r JOIN users pu ON pu.id = r.provider_id AND pu.status = 'active' AND pu.is_provider
          WHERE r.is_active AND r.next_run_at <= $1 ORDER BY r.next_run_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        [now],
        client,
      );
      if (!r) return null;
      const q = computeQuote(r.price, settings);
      const city = await one(
        `SELECT name FROM cities WHERE is_active AND haversine_km($1, $2, lat, lng) <= 60 ORDER BY haversine_km($1, $2, lat, lng) LIMIT 1`,
        [r.lat, r.lng],
        client,
      );
      const job = await one(
        `INSERT INTO jobs (client_id, provider_id, category_id, title, description, address, city, lat, lng, urgency, scheduled_at,
                           budget, price, service_fee, total, provider_commission, provider_payout, mode, origin, property_id, recurring_job_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$11,$12,$13,$14,$15,'direct','recurring',$16,$17) RETURNING id`,
        [r.client_id, r.provider_id, r.category_id, r.title, r.description, r.address, city?.name || null, r.lat, r.lng,
          r.next_run_at, r.price, q.service_fee, q.total, q.provider_commission, q.provider_payout, r.property_id, r.id],
        client,
      );
      await client.query('INSERT INTO job_broadcasts (job_id, provider_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [job.id, r.provider_id]);
      // avance jusqu'à la prochaine échéance future (une seule mission créée même après une longue interruption)
      await client.query(
        `UPDATE recurring_jobs SET last_run_at = $2,
                next_run_at = (SELECT min(t) FROM generate_series(next_run_at + ${STEP[r.frequency]}, $2::timestamptz + ${STEP[r.frequency]}, ${STEP[r.frequency]}) t WHERE t > $2),
                updated_at = now()
          WHERE id = $1`,
        [r.id, now],
      );
      return { r, jobId: job.id, total: q.total };
    });
    if (!res) break;
    created.push(res.jobId);
    const job = await getJobView(res.jobId, { id: res.r.provider_id, is_provider: true });
    emitToUser(res.r.provider_id, 'job:new', job);
    await notify(res.r.provider_id, {
      type: 'job', title: 'Mission récurrente', body: `${res.r.title} — ${fmt(res.r.price)}. Acceptez pour la confirmer.`, data: { job_id: res.jobId },
    });
    await notify(res.r.client_id, {
      type: 'job', title: 'Mission récurrente créée',
      body: `« ${res.r.title} » a été programmée avec votre prestataire attitré. Payez ${fmt(res.total)} après son acceptation pour la sécuriser.`,
      data: { job_id: res.jobId },
    });
  }
  return created.length;
}
