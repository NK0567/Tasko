import { many, one } from '../../db.js';
import { emitPerViewer, emitToUsers } from '../../realtime/hub.js';
import { haversineKm, round1 } from '../../utils/geo.js';
import { getSettings } from '../settings/service.js';

export const ACTIVE_STATUSES = ['requested', 'accepted', 'funded', 'en_route', 'arrived', 'in_progress', 'done', 'disputed'];
export const HISTORY_STATUSES = ['completed', 'cancelled'];
export const ALL_STATUSES = [...ACTIVE_STATUSES, ...HISTORY_STATUSES];
/** Statuts « terrain » où le prestataire est engagé (fonds en séquestre). */
export const FUNDED_STATUSES = ['funded', 'en_route', 'arrived', 'in_progress', 'done'];
/** Statuts de jalon dont les fonds sont en séquestre. */
export const HELD_MILESTONE_STATUSES = ['funded', 'submitted', 'disputed'];

export const JOB_SELECT = `
  SELECT j.*,
         cu.full_name AS c_name, cu.avatar_url AS c_avatar, cu.phone AS c_phone,
         pu.full_name AS p_name, pu.avatar_url AS p_avatar, pu.phone AS p_phone,
         pp.headline AS p_headline, pp.rating_avg AS p_rating, pp.lat AS p_lat, pp.lng AS p_lng, pp.public_code AS p_code, pp.no_shows AS p_no_shows, pp.disputes_lost AS p_disputes_lost,
         cat.name AS cat_name, cat.icon AS cat_icon, cat.slug AS cat_slug, cat.parent_id AS cat_parent_id, pcat.name AS cat_parent_name,
         rv.rating AS rv_rating, rv.comment AS rv_comment,
         prop.name AS prop_name,
         ct.rating_avg AS ct_rating, ct.rating_count AS ct_count,
         (SELECT count(*) FROM jobs j2 WHERE j2.client_id = j.client_id AND j2.payment_status IN ('held', 'released')) AS ct_jobs_paid,
         (SELECT count(*) FROM disputes d2 JOIN jobs j3 ON j3.id = d2.job_id
           WHERE j3.client_id = j.client_id AND d2.resolution = 'release') AS ct_disputes_lost,
         (SELECT count(*) FROM bids b WHERE b.job_id = j.id AND b.status <> 'withdrawn') AS bids_count,
         dsp.id AS d_id, dsp.status AS d_status, dsp.reason AS d_reason, dsp.kind AS d_kind
    FROM jobs j
    JOIN users cu ON cu.id = j.client_id
    LEFT JOIN users pu ON pu.id = j.provider_id
    LEFT JOIN provider_profiles pp ON pp.user_id = j.provider_id
    JOIN categories cat ON cat.id = j.category_id
    LEFT JOIN categories pcat ON pcat.id = cat.parent_id
    LEFT JOIN reviews rv ON rv.job_id = j.id AND rv.author_id = j.client_id
    LEFT JOIN properties prop ON prop.id = j.property_id
    LEFT JOIN LATERAL (SELECT round(avg(r.rating)::numeric, 2) AS rating_avg, count(*) AS rating_count
                         FROM reviews r WHERE r.target_id = j.client_id AND r.target_role = 'client') ct ON true
    LEFT JOIN LATERAL (SELECT d.id, d.status, d.reason, d.kind FROM disputes d WHERE d.job_id = j.id
                        ORDER BY (d.status <> 'resolved') DESC, d.created_at DESC LIMIT 1) dsp ON true`;

export function serializeMilestone(m) {
  return {
    id: m.id,
    position: m.position,
    title: m.title,
    amount: m.amount,
    service_fee: m.service_fee,
    total: m.total,
    provider_commission: m.provider_commission,
    provider_payout: m.provider_payout,
    status: m.status,
    funded_at: m.funded_at,
    submitted_at: m.submitted_at,
    auto_release_at: m.auto_release_at,
    released_at: m.released_at,
    proof_photos: m.proof_photos || [],
    note: m.note,
  };
}

export function serializeBidBase(b) {
  return {
    id: b.id,
    job_id: b.job_id,
    amount: b.amount,
    duration_days: b.duration_days,
    message: b.message,
    attachments: b.attachments || [],
    milestones: b.milestones || [],
    status: b.status,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

/** RG-G11 : échéance d'arrivée du prestataire (null tant que les fonds ne sont pas sécurisés). */
export function arrivalDeadline(r, settings) {
  if (!r.funded_at) return null;
  const s = settings || {};
  if (r.urgency !== 'now' && r.scheduled_at) {
    return new Date(new Date(r.scheduled_at).getTime() + Number(s.no_show_grace_hours ?? 2) * 3600e3);
  }
  return new Date(new Date(r.funded_at).getTime() + Number(s.no_show_hours ?? 3) * 3600e3);
}

/** Le client peut signaler « le prestataire n'est pas venu » : fonds sécurisés, code non saisi, échéance dépassée, pas de litige actif. */
export function canReportNoShow(r, settings, now = Date.now()) {
  const deadline = arrivalDeadline(r, settings);
  return (
    !!deadline &&
    ['funded', 'en_route', 'arrived'].includes(r.status) &&
    !r.started_at &&
    r.payment_status === 'held' &&
    now >= deadline.getTime()
  );
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Sérialise une ligne JOB_SELECT au format Job du contrat, selon l'utilisateur qui regarde (`viewer`) :
 * - `start_code` : uniquement pour le client du job (RG-G2) ;
 * - téléphones : null tant que les fonds ne sont pas sécurisés (RG-G8), et toujours null pour les tiers ;
 * - `dispute`, `invited_provider_ids` : parties / admin uniquement.
 */
export function serializeJob(r, { viewer = null, settings = null, milestones = [], myBid = null, origin = null } = {}) {
  const isAdmin = !!viewer?.is_admin;
  const isClient = !!viewer && viewer.id === r.client_id;
  const isProvider = !!viewer && !!r.provider_id && viewer.id === r.provider_id;
  const isParty = isClient || isProvider;
  const fundsSecured = r.payment_status === 'held' || r.payment_status === 'released';
  const mask = settings ? settings.mask_contacts_until_funded !== false : true;
  const contactsVisible = isAdmin || (isParty && (fundsSecured || !mask));

  const from = origin || (r.provider_id && r.p_lat !== null ? { lat: r.p_lat, lng: r.p_lng } : null);
  const distance = from ? haversineKm(from.lat, from.lng, r.lat, r.lng) : null;
  return {
    id: r.id,
    mode: r.mode,
    origin: r.origin,
    visibility: r.visibility,
    invited_provider_ids: isClient || isAdmin ? r.invited_provider_ids || [] : undefined,
    bid_deadline: r.bid_deadline,
    budget_min: r.budget_min,
    budget_max: r.budget_max,
    bids_count: r.mode === 'tender' ? Number(r.bids_count || 0) : 0,
    my_bid: myBid,
    client: {
      id: r.client_id,
      full_name: r.c_name,
      avatar_url: r.c_avatar,
      phone: contactsVisible ? r.c_phone : null,
      trust: {
        rating_avg: Math.round(Number(r.ct_rating || 0) * 10) / 10,
        rating_count: Number(r.ct_count || 0),
        jobs_paid: Number(r.ct_jobs_paid || 0),
        disputes_lost: Number(r.ct_disputes_lost || 0),
      },
    },
    provider: r.provider_id
      ? {
          id: r.provider_id,
          full_name: r.p_name,
          avatar_url: r.p_avatar,
          phone: contactsVisible ? r.p_phone : null,
          headline: r.p_headline,
          rating_avg: Math.round(Number(r.p_rating || 0) * 10) / 10,
          public_code: r.p_code,
          no_shows: Number(r.p_no_shows || 0),
          disputes_lost: Number(r.p_disputes_lost || 0),
          lat: num(r.p_lat),
          lng: num(r.p_lng),
        }
      : null,
    category: { id: r.category_id, name: r.cat_name, icon: r.cat_icon, parent_name: r.cat_parent_name },
    title: r.title,
    description: r.description,
    photo_url: r.photo_url,
    address: r.address,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    urgency: r.urgency,
    scheduled_at: r.scheduled_at,
    budget: r.budget,
    price: r.price,
    service_fee: r.service_fee,
    total: r.total,
    provider_commission: r.provider_commission,
    provider_payout: r.provider_payout,
    status: r.status,
    payment_status: r.payment_status,
    funds_secured: fundsSecured,
    funded_at: r.funded_at,
    arrival_deadline: arrivalDeadline(r, settings),
    can_report_no_show: isClient ? canReportNoShow(r, settings) : false,
    start_code: isClient ? r.start_code : null,
    distance_km: round1(distance),
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    started_at: r.started_at,
    done_at: r.done_at,
    auto_release_at: r.auto_release_at,
    completed_at: r.completed_at,
    completed_by: r.completed_by,
    cancelled_at: r.cancelled_at,
    completion_proof: r.done_at || (r.proof_photos && r.proof_photos.length) ? { photos: r.proof_photos || [], note: r.completion_note } : null,
    cancellation_fee: r.cancellation_fee || 0,
    cancel_reason: r.cancel_reason,
    cancelled_by: r.cancelled_role || null,
    milestones: milestones.map(serializeMilestone),
    property: r.property_id ? { id: r.property_id, name: r.prop_name } : null,
    dispute: r.d_id && (isParty || isAdmin) ? { id: r.d_id, kind: r.d_kind, status: r.d_status, reason: r.d_reason } : null,
    review: r.rv_rating ? { rating: r.rv_rating, comment: r.rv_comment } : null,
  };
}

/** Charge en une requête les jalons (et l'offre du prestataire courant) d'une liste de jobs : pas de N+1. */
export async function hydrate(rows, viewer, client) {
  const ids = rows.map((r) => r.id);
  const milestones = new Map();
  const bids = new Map();
  if (!ids.length) return { milestones, bids };
  const ms = await many('SELECT * FROM job_milestones WHERE job_id = ANY($1) ORDER BY job_id, position', [ids], client);
  for (const m of ms) {
    if (!milestones.has(m.job_id)) milestones.set(m.job_id, []);
    milestones.get(m.job_id).push(m);
  }
  const tenderIds = rows.filter((r) => r.mode === 'tender').map((r) => r.id);
  if (viewer?.is_provider && tenderIds.length) {
    const bs = await many('SELECT * FROM bids WHERE provider_id = $1 AND job_id = ANY($2)', [viewer.id, tenderIds], client);
    for (const b of bs) bids.set(b.job_id, serializeBidBase(b));
  }
  return { milestones, bids };
}

export async function serializeRows(rows, viewer, { origin = null, settings = null, client } = {}) {
  const s = settings || (await getSettings(client));
  const { milestones, bids } = await hydrate(rows, viewer, client);
  return rows.map((r) =>
    serializeJob(r, { viewer, settings: s, origin, milestones: milestones.get(r.id) || [], myBid: bids.get(r.id) || null }),
  );
}

export async function fetchJobRow(id, client) {
  return one(`${JOB_SELECT} WHERE j.id = $1`, [id], client);
}

/** Job sérialisé pour `viewer` (null = vue neutre : téléphones et code masqués). */
export async function getJobView(id, viewer, { origin = null, client } = {}) {
  const r = await fetchJobRow(id, client);
  if (!r) return null;
  const [job] = await serializeRows([r], viewer, { origin, client });
  return job;
}
export const fetchJob = (id, viewer = null) => getJobView(id, viewer);

export async function fetchJobRows(where, params, { order = 'j.created_at DESC', limit = 100, offset = 0 } = {}) {
  return many(`${JOB_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit) | 0} OFFSET ${Number(offset) | 0}`, params);
}

export async function fetchJobs(where, params, { order, limit, offset, origin, viewer = null } = {}) {
  const rows = await fetchJobRows(where, params, { order, limit, offset });
  return serializeRows(rows, viewer, { origin });
}

/**
 * Émet `job:updated` vers job:<id>, user:<client>, user:<provider> — chaque socket reçoit la vue correspondant à son
 * utilisateur (start_code pour le client seulement, téléphones selon RG-G8). Retourne la vue neutre (sans données sensibles).
 */
export async function emitJobUpdated(jobId) {
  const r = await fetchJobRow(jobId);
  if (!r) return null;
  const settings = await getSettings();
  const { milestones } = await hydrate([r], null);
  const ms = milestones.get(r.id) || [];
  await emitPerViewer([`job:${jobId}`, `user:${r.client_id}`, r.provider_id ? `user:${r.provider_id}` : null], 'job:updated', (viewer) =>
    serializeJob(r, { viewer, settings, milestones: ms }),
  );
  return serializeJob(r, { viewer: null, settings, milestones: ms });
}

/** `job:closed` aux prestataires ayant reçu `job:new` (sauf `exceptIds`). */
export async function emitJobClosed(jobId, reason, exceptIds = []) {
  const rows = await many('SELECT provider_id FROM job_broadcasts WHERE job_id = $1', [jobId]);
  const targets = rows.map((r) => r.provider_id).filter((id) => !exceptIds.includes(id));
  emitToUsers(targets, 'job:closed', { job_id: jobId, reason });
  return targets;
}
