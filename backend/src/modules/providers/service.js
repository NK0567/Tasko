import { many, one } from '../../db.js';
import { notFound } from '../../utils/errors.js';
import { YAOUNDE, etaMin, round1, round2 } from '../../utils/geo.js';
import { getSettings } from '../settings/service.js';
import { expandCategoryIds } from '../categories/service.js';
import { getPortfolio, getProviderSkills } from '../users/service.js';

/**
 * Score de matching (0–1) du contrat :
 * 0.35·(1 − d/radius) + 0.25·(rating/5) + 0.15·min(missions/50,1) + 0.10·online + 0.10·featured + 0.05·pro
 */
export function matchingScore({ distance_km, radius_km, rating_avg, missions_completed, is_online, is_featured, is_pro }) {
  const d = distance_km === null || distance_km === undefined ? radius_km : Math.min(distance_km, radius_km);
  const proximity = radius_km > 0 ? 1 - d / radius_km : 0;
  return (
    0.35 * Math.max(0, proximity) +
    0.25 * (Number(rating_avg || 0) / 5) +
    0.15 * Math.min((missions_completed || 0) / 50, 1) +
    0.1 * (is_online ? 1 : 0) +
    0.1 * (is_featured ? 1 : 0) +
    0.05 * (is_pro ? 1 : 0)
  );
}

const isFuture = (d) => !!d && new Date(d).getTime() > Date.now();

export function toProviderCard(row, { radius_km, avg_speed_kmh }) {
  const distance_km = row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km);
  const is_featured = isFuture(row.featured_until);
  const is_pro = row.plan === 'pro' && (!row.pro_until || isFuture(row.pro_until));
  const rating_avg = Math.round(Number(row.rating_avg || 0) * 10) / 10;
  return {
    id: row.id,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    headline: row.headline,
    provider_type: row.provider_type,
    public_code: row.public_code ?? null,
    rating_avg,
    rating_count: row.rating_count,
    missions_completed: row.missions_completed,
    distance_km: round1(distance_km),
    eta_min: etaMin(distance_km, avg_speed_kmh),
    min_price: row.min_price ?? null,
    is_online: row.is_online,
    is_featured,
    is_pro,
    verification_level: row.verification_level,
    lat: row.lat,
    lng: row.lng,
    skills: row.skill_names || [],
    score: round2(
      matchingScore({
        distance_km,
        radius_km,
        rating_avg,
        missions_completed: row.missions_completed,
        is_online: row.is_online,
        is_featured,
        is_pro,
      }),
    ),
  };
}

const SORTERS = {
  score: (a, b) => b.score - a.score || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9),
  distance: (a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || b.score - a.score,
  rating: (a, b) => b.rating_avg - a.rating_avg || b.rating_count - a.rating_count || b.score - a.score,
  price: (a, b) => (a.min_price ?? 1e12) - (b.min_price ?? 1e12) || b.score - a.score,
};

const CARD_COLUMNS = `u.id, u.full_name, u.avatar_url, u.verification_level,
            pp.headline, pp.provider_type, pp.public_code, pp.rating_avg, pp.rating_count, pp.missions_completed, pp.is_online,
            pp.lat, pp.lng, pp.plan, pp.pro_until, pp.featured_until`;

/**
 * Recherche de prestataires.
 * - lat/lng absents : position par défaut Yaoundé.
 * - ids : restreint à une liste (favoris, offres) et désactive le filtre de rayon.
 */
export async function searchProviders({ lat, lng, radius_km, category_id, q, sort = 'score', online, limit = 50, ids = null }) {
  const settings = await getSettings();
  const radius = radius_km || Number(settings.search_radius_km) || 10;
  const origin = { lat: lat ?? YAOUNDE.lat, lng: lng ?? YAOUNDE.lng };
  const catIds = category_id ? await expandCategoryIds(category_id) : null;
  if (category_id && catIds.length === 0) return [];
  const rows = await many(
    `SELECT ${CARD_COLUMNS},
            haversine_km($1, $2, pp.lat, pp.lng) AS distance_km,
            (SELECT min(ps.base_price) FROM provider_skills ps
              WHERE ps.provider_id = u.id AND ($4::uuid[] IS NULL OR ps.category_id = ANY($4))) AS min_price,
            (SELECT array_agg(c.name ORDER BY c.position, c.name) FROM provider_skills ps JOIN categories c ON c.id = ps.category_id
              WHERE ps.provider_id = u.id) AS skill_names
       FROM users u
       JOIN provider_profiles pp ON pp.user_id = u.id
      WHERE u.is_provider AND u.status = 'active'
        AND ($7::uuid[] IS NOT NULL OR (pp.lat IS NOT NULL AND haversine_km($1, $2, pp.lat, pp.lng) <= $3))
        AND ($7::uuid[] IS NULL OR u.id = ANY($7))
        AND ($4::uuid[] IS NULL OR EXISTS (SELECT 1 FROM provider_skills ps WHERE ps.provider_id = u.id AND ps.category_id = ANY($4)))
        AND ($5::text IS NULL OR u.full_name ILIKE $5 OR pp.headline ILIKE $5 OR EXISTS (
              SELECT 1 FROM provider_skills ps JOIN categories c ON c.id = ps.category_id
               WHERE ps.provider_id = u.id AND c.name ILIKE $5))
        AND ($6::boolean IS NULL OR pp.is_online = $6)`,
    [origin.lat, origin.lng, radius, catIds, q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null, online ?? null, ids],
  );
  const cards = rows.map((r) => toProviderCard(r, { radius_km: radius, avg_speed_kmh: settings.avg_speed_kmh }));
  cards.sort(SORTERS[sort] || SORTERS.score);
  return cards.slice(0, limit);
}

/** ProviderCards d'une liste d'identifiants (une seule requête), indexées par id. */
export async function providerCardsByIds(ids, origin = null) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const cards = await searchProviders({ lat: origin?.lat, lng: origin?.lng, ids: unique, limit: unique.length });
  return new Map(cards.map((c) => [c.id, c]));
}

/** GET /providers/lookup : par code Tasko (TSK-XXXXX) ou par numéro de téléphone. */
export async function lookupProvider({ code, phone }) {
  const row = await one(
    `SELECT u.id FROM users u JOIN provider_profiles pp ON pp.user_id = u.id
      WHERE u.is_provider AND u.status = 'active'
        AND (($1::text IS NOT NULL AND pp.public_code = $1) OR ($2::text IS NOT NULL AND (u.phone = $2 OR pp.momo_number = $2)))
      LIMIT 1`,
    [code || null, phone || null],
  );
  if (!row) throw notFound('Aucun prestataire ne correspond');
  const cards = await providerCardsByIds([row.id]);
  return cards.get(row.id);
}

export function serializeReview(r) {
  return {
    id: r.id,
    job_id: r.job_id,
    author: { id: r.author_id, full_name: r.author_name, avatar_url: r.author_avatar },
    rating: r.rating,
    comment: r.comment,
    punctuality: r.punctuality,
    quality: r.quality,
    behavior: r.behavior,
    value: r.value,
    target_role: r.target_role,
    created_at: r.created_at,
  };
}

const REVIEW_SELECT = `
  SELECT r.*, a.full_name AS author_name, a.avatar_url AS author_avatar
    FROM reviews r JOIN users a ON a.id = r.author_id`;

/** Avis reçus en tant que prestataire (les notes reçues en tant que client sont exclues). */
export async function listReviews(targetId, { page = 1, limit = 20 } = {}) {
  const [items, total] = await Promise.all([
    many(`${REVIEW_SELECT} WHERE r.target_id = $1 AND r.target_role = 'provider' ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [
      targetId, limit, (page - 1) * limit,
    ]),
    one(`SELECT count(*)::int AS n FROM reviews WHERE target_id = $1 AND target_role = 'provider'`, [targetId]),
  ]);
  return { items: items.map(serializeReview), total: total.n, page, limit };
}

export async function getProviderDetail(id, { lat, lng, viewerId }) {
  const settings = await getSettings();
  const origin = { lat: lat ?? YAOUNDE.lat, lng: lng ?? YAOUNDE.lng };
  const row = await one(
    `SELECT ${CARD_COLUMNS}, pp.bio, pp.years_experience, pp.available_days, pp.completion_rate,
            haversine_km($2, $3, pp.lat, pp.lng) AS distance_km,
            (SELECT min(base_price) FROM provider_skills WHERE provider_id = u.id) AS min_price,
            (SELECT array_agg(c.name ORDER BY c.position) FROM provider_skills ps JOIN categories c ON c.id = ps.category_id
              WHERE ps.provider_id = u.id) AS skill_names
       FROM users u JOIN provider_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1 AND u.is_provider AND u.status = 'active'`,
    [id, origin.lat, origin.lng],
  );
  if (!row) throw notFound('Prestataire introuvable');
  const card = toProviderCard(row, { radius_km: Number(settings.search_radius_km) || 10, avg_speed_kmh: settings.avg_speed_kmh });
  const [skills, portfolio, reviews, followed] = await Promise.all([
    getProviderSkills(id),
    getPortfolio(id),
    many(`${REVIEW_SELECT} WHERE r.target_id = $1 AND r.target_role = 'provider' ORDER BY r.created_at DESC LIMIT 5`, [id]),
    viewerId ? one('SELECT 1 FROM favorites WHERE user_id = $1 AND provider_id = $2', [viewerId, id]) : null,
  ]);
  return {
    ...card,
    bio: row.bio,
    years_experience: row.years_experience,
    available_days: (row.available_days || []).map(Number),
    completion_rate: row.completion_rate,
    skill_names: card.skills,
    skills,
    portfolio,
    reviews: reviews.map(serializeReview),
    is_followed: !!followed,
  };
}

export async function toggleFollow(userId, providerId) {
  if (userId === providerId) throw notFound('Prestataire introuvable');
  const p = await one('SELECT 1 FROM provider_profiles WHERE user_id = $1', [providerId]);
  if (!p) throw notFound('Prestataire introuvable');
  const del = await one('DELETE FROM favorites WHERE user_id = $1 AND provider_id = $2 RETURNING 1 AS x', [userId, providerId]);
  if (del) return { is_followed: false };
  await one('INSERT INTO favorites (user_id, provider_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1 AS x', [userId, providerId]);
  return { is_followed: true };
}

export async function listFavorites(userId, { lat, lng } = {}) {
  const rows = await many('SELECT provider_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  if (!rows.length) return [];
  return searchProviders({ lat, lng, ids: rows.map((r) => r.provider_id), limit: 200, sort: 'score' });
}

const runner = (client) => client || { query: (t, p) => one(t, p) };

/** Recalcule rating_avg / rating_count du prestataire à partir des avis reçus EN TANT QUE prestataire. */
export async function recomputeRating(providerId, client) {
  await runner(client).query(
    `UPDATE provider_profiles pp SET
       rating_avg = coalesce((SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE target_id = $1 AND target_role = 'provider'), 0),
       rating_count = (SELECT count(*) FROM reviews WHERE target_id = $1 AND target_role = 'provider'),
       updated_at = now()
     WHERE pp.user_id = $1`,
    [providerId],
  );
}

/** missions_completed, completion_rate (terminées / (terminées + annulées par le prestataire après acceptation)), cancellations. */
export async function recomputeProviderStats(providerId, client) {
  await runner(client).query(
    `WITH s AS (
       SELECT count(*) FILTER (WHERE status = 'completed') AS done,
              count(*) FILTER (WHERE status = 'cancelled' AND accepted_at IS NOT NULL AND cancelled_role = 'provider') AS failed
         FROM jobs WHERE provider_id = $1)
     UPDATE provider_profiles SET
       missions_completed = s.done,
       completion_rate = CASE WHEN s.done + s.failed = 0 THEN 100 ELSE round(100.0 * s.done / (s.done + s.failed)) END,
       cancellations = s.failed,
       updated_at = now()
     FROM s WHERE user_id = $1`,
    [providerId],
  );
}
