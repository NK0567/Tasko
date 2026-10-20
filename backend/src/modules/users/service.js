import { many, one } from '../../db.js';
import { notFound } from '../../utils/errors.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

export function serializeProviderProfile(pp, skills = [], portfolio = [], extra = {}) {
  if (!pp) return null;
  return {
    user_id: pp.user_id,
    headline: pp.headline,
    bio: pp.bio,
    provider_type: pp.provider_type,
    years_experience: pp.years_experience,
    is_online: pp.is_online,
    lat: num(pp.lat),
    lng: num(pp.lng),
    rating_avg: Math.round(Number(pp.rating_avg || 0) * 10) / 10,
    rating_count: pp.rating_count,
    missions_completed: pp.missions_completed,
    completion_rate: pp.completion_rate,
    momo_number: pp.momo_number,
    momo_operator: pp.momo_operator,
    plan: pp.plan,
    pro_until: pp.pro_until,
    featured_until: pp.featured_until,
    available_days: (pp.available_days || []).map(Number),
    public_code: pp.public_code ?? null,
    cancellations: pp.cancellations ?? 0,
    no_shows: pp.no_shows ?? 0,
    disputes_lost: pp.disputes_lost ?? 0,
    wallet_available: extra.wallet_available ?? 0,
    skills,
    portfolio,
  };
}

export async function getProviderSkills(providerId, client) {
  return many(
    `SELECT ps.category_id, c.name, p.name AS parent_name, c.icon, ps.base_price
       FROM provider_skills ps
       JOIN categories c ON c.id = ps.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
      WHERE ps.provider_id = $1
      ORDER BY p.position NULLS FIRST, c.position, c.name`,
    [providerId],
    client,
  );
}

export async function getPortfolio(providerId, client) {
  return many(
    'SELECT id, title, image_url FROM portfolio_items WHERE provider_id = $1 ORDER BY created_at DESC',
    [providerId],
    client,
  );
}

const WALLET_SQL = `SELECT coalesce((SELECT sum(amount) FROM transactions WHERE user_id = $1 AND type IN ('payout', 'cancellation_fee') AND status = 'failed'), 0)
  - coalesce((SELECT sum(amount) FROM transactions WHERE user_id = $1 AND type = 'withdrawal' AND status IN ('pending', 'success')), 0) AS available`;

export async function getProviderProfile(userId, client) {
  const pp = await one('SELECT * FROM provider_profiles WHERE user_id = $1', [userId], client);
  if (!pp) return null;
  const [skills, portfolio, wallet] = await Promise.all([
    getProviderSkills(userId, client),
    getPortfolio(userId, client),
    one(WALLET_SQL, [userId], client),
  ]);
  return serializeProviderProfile(pp, skills, portfolio, { wallet_available: Math.max(0, Number(wallet?.available || 0)) });
}

export function serializeUserRow(u, provider = null) {
  return {
    id: u.id,
    full_name: u.full_name,
    phone: u.phone,
    email: u.email,
    avatar_url: u.avatar_url,
    city: u.city,
    is_provider: u.is_provider,
    is_admin: u.is_admin,
    status: u.status,
    verification_level: u.verification_level,
    account_type: u.account_type || 'individual',
    business: u.business || null,
    created_at: u.created_at,
    provider,
  };
}

/** Retourne l'objet User complet du contrat (avec ProviderProfile si prestataire). */
export async function getUserById(id, client) {
  const u = await one('SELECT * FROM users WHERE id = $1', [id], client);
  if (!u) throw notFound('Utilisateur introuvable');
  const provider = u.is_provider ? await getProviderProfile(id, client) : null;
  return serializeUserRow(u, provider);
}
