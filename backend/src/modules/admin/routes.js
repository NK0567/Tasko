import { Router } from 'express';
import { many, one } from '../../db.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { amount, boolString, lat, lng, pagination, parse, uuid, z } from '../../utils/validate.js';
import { phoneSchema } from '../../utils/phone.js';
import * as stats from './stats.js';
import * as categories from '../categories/service.js';
import { getUserById, serializeUserRow } from '../users/service.js';
import { getSettings, settingsSchema, updateSettings } from '../settings/service.js';
import { ALL_STATUSES, fetchJobs } from '../jobs/repo.js';
import { serializeTransaction } from '../payments/service.js';
import { recomputeRating, serializeReview } from '../providers/service.js';
import * as disputes from '../disputes/service.js';
import * as treasury from '../treasury/service.js';
import { audit, clientIp, listAuditLogs } from '../audit/service.js';
import { getProviderStrict, listProviders } from '../../payments/index.js';
import { notify } from '../notifications/service.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const idParam = (req) => parse(uuid(), req.params.id);
/** Réputation « client » (RG-G7) calculée en SQL pour une ligne users u. */
const TRUST_COLUMNS = `
  (SELECT round(avg(r.rating)::numeric, 2) FROM reviews r WHERE r.target_id = u.id AND r.target_role = 'client') AS t_rating,
  (SELECT count(*) FROM reviews r WHERE r.target_id = u.id AND r.target_role = 'client') AS t_count,
  (SELECT count(*) FROM jobs j WHERE j.client_id = u.id AND j.payment_status IN ('held', 'released')) AS t_paid,
  (SELECT count(*) FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE j.client_id = u.id AND d.resolution = 'release') AS t_lost`;
const trustOf = (r) => ({
  rating_avg: Math.round(Number(r?.t_rating || 0) * 10) / 10,
  rating_count: Number(r?.t_count || 0),
  jobs_paid: Number(r?.t_paid || 0),
  disputes_lost: Number(r?.t_lost || 0),
});
const likeEscape = (v) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

// ------------------------------------------------------------------ statistiques
router.get('/stats', async (_req, res) => res.json(await stats.dashboardStats()));
router.get('/stats/timeseries', async (req, res) => res.json({ items: await stats.timeseries(parse(daysQuery, req.query).days) }));
router.get('/stats/categories', async (req, res) => res.json({ items: await stats.byCategory(parse(daysQuery, req.query).days) }));
router.get('/stats/cities', async (req, res) => res.json({ items: await stats.byCity(parse(daysQuery, req.query).days) }));
router.get('/activity', async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  res.json({ items: await stats.activity(limit) });
});

// ------------------------------------------------------------------ utilisateurs
router.get('/users', async (req, res) => {
  const q = parse(
    pagination.extend({
      q: z.string().trim().max(80).optional(),
      role: z.enum(['client', 'provider', 'admin']).optional(),
      status: z.enum(['active', 'suspended']).optional(),
    }),
    req.query,
  );
  const where = `($1::text IS NULL OR u.full_name ILIKE $1 OR u.phone ILIKE $1 OR u.email ILIKE $1)
    AND ($2::text IS NULL OR ($2 = 'admin' AND u.is_admin) OR ($2 = 'provider' AND u.is_provider) OR ($2 = 'client' AND NOT u.is_provider AND NOT u.is_admin))
    AND ($3::text IS NULL OR u.status = $3)`;
  const params = [q.q ? `%${likeEscape(q.q)}%` : null, q.role || null, q.status || null];
  const [rows, total] = await Promise.all([
    many(
      `SELECT u.*, row_to_json(pp.*) AS pp, ${TRUST_COLUMNS} FROM users u LEFT JOIN provider_profiles pp ON pp.user_id = u.id
        WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
      [...params, q.limit, (q.page - 1) * q.limit],
    ),
    one(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, params),
  ]);
  const items = rows.map((u) =>
    serializeUserRow(
      u,
      u.pp
        ? {
            user_id: u.id, headline: u.pp.headline, provider_type: u.pp.provider_type, is_online: u.pp.is_online,
            rating_avg: Number(u.pp.rating_avg), rating_count: u.pp.rating_count, missions_completed: u.pp.missions_completed,
            completion_rate: u.pp.completion_rate, plan: u.pp.plan, pro_until: u.pp.pro_until, featured_until: u.pp.featured_until,
            lat: u.pp.lat, lng: u.pp.lng, momo_number: u.pp.momo_number, momo_operator: u.pp.momo_operator,
            public_code: u.pp.public_code, cancellations: u.pp.cancellations, no_shows: u.pp.no_shows, disputes_lost: u.pp.disputes_lost,
          }
        : null,
    ),
  ).map((x, i) => ({ ...x, trust: trustOf(rows[i]) }));
  res.json({ items, total: total.n, page: q.page, limit: q.limit });
});

router.get('/users/:id', async (req, res) => {
  const id = idParam(req);
  const t = await one(`SELECT ${TRUST_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  if (!t) throw notFound('Utilisateur introuvable');
  res.json({ ...(await getUserById(id)), trust: trustOf(t) });
});

router.patch('/users/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(
    z.object({
      status: z.enum(['active', 'suspended']).optional(),
      verification_level: z.coerce.number().int().min(1).max(5).optional(),
      is_admin: z.boolean().optional(),
    }),
    req.body,
  );
  if (id === req.user.id && (b.is_admin === false || b.status === 'suspended')) {
    throw forbidden('Vous ne pouvez pas retirer vos propres droits ni suspendre votre compte');
  }
  const u = await one(
    `UPDATE users SET status = coalesce($2, status), verification_level = coalesce($3, verification_level),
            is_admin = coalesce($4, is_admin), updated_at = now() WHERE id = $1 RETURNING id`,
    [id, b.status ?? null, b.verification_level ?? null, b.is_admin ?? null],
  );
  if (!u) throw notFound('Utilisateur introuvable');
  await audit({ actorId: req.user.id, action: 'user.update', target: `user:${id}`, details: b, ip: clientIp(req) });
  if (b.verification_level) {
    await notify(id, { type: 'system', title: 'Profil vérifié', body: `Votre niveau de vérification est maintenant ${b.verification_level}/5.`, data: {} });
  }
  const t = await one(`SELECT ${TRUST_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  res.json({ ...(await getUserById(id)), trust: trustOf(t) });
});

// ------------------------------------------------------------------ catégories
router.get('/categories', async (_req, res) => res.json({ items: await categories.listCategoryTree({ includeInactive: true }) }));
router.post('/categories', async (req, res) => {
  const c = await categories.createCategory(parse(categories.categoryInput, req.body));
  await audit({ actorId: req.user.id, action: 'category.create', target: `category:${c.id}`, details: { name: c.name }, ip: clientIp(req) });
  res.status(201).json(c);
});
router.post('/categories/reorder', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(uuid()).min(1) }), req.body);
  await categories.reorderCategories(ids);
  await audit({ actorId: req.user.id, action: 'category.reorder', target: 'categories', details: { ids }, ip: clientIp(req) });
  res.json({ ok: true });
});
router.patch('/categories/:id', async (req, res) => {
  const patch = parse(categories.categoryInput.partial(), req.body);
  const c = await categories.updateCategory(idParam(req), patch);
  await audit({ actorId: req.user.id, action: 'category.update', target: `category:${c.id}`, details: patch, ip: clientIp(req) });
  res.json(c);
});
router.delete('/categories/:id', async (req, res) => {
  await categories.deleteCategory(idParam(req));
  await audit({ actorId: req.user.id, action: 'category.delete', target: `category:${req.params.id}`, ip: clientIp(req) });
  res.json({ ok: true });
});
router.get('/category-suggestions', async (_req, res) => res.json({ items: await categories.listSuggestions() }));

// ------------------------------------------------------------------ missions & transactions
router.get('/jobs', async (req, res) => {
  const q = parse(pagination.extend({ status: z.enum(ALL_STATUSES).optional(), mode: z.enum(['instant', 'direct', 'tender']).optional(), q: z.string().trim().max(80).optional() }), req.query);
  const where = `($1::text IS NULL OR j.status = $1) AND ($3::text IS NULL OR j.mode = $3)
    AND ($2::text IS NULL OR j.title ILIKE $2 OR j.address ILIKE $2 OR cu.full_name ILIKE $2 OR pu.full_name ILIKE $2 OR j.city ILIKE $2)`;
  const params = [q.status || null, q.q ? `%${likeEscape(q.q)}%` : null, q.mode || null];
  const [items, total] = await Promise.all([
    fetchJobs(where, params, { limit: q.limit, offset: (q.page - 1) * q.limit, viewer: req.user }),
    one(
      `SELECT count(*)::int AS n FROM jobs j JOIN users cu ON cu.id = j.client_id LEFT JOIN users pu ON pu.id = j.provider_id WHERE ${where}`,
      params,
    ),
  ]);
  res.json({ items, total: total.n, page: q.page, limit: q.limit });
});

router.get('/transactions', async (req, res) => {
  const q = parse(
    pagination.extend({
      type: z.enum(['escrow_in', 'payout', 'commission', 'refund', 'subscription', 'boost', 'cancellation_fee', 'partial_refund', 'withdrawal', 'revenue_withdrawal']).optional(),
      status: z.enum(['pending', 'success', 'failed']).optional(),
    }),
    req.query,
  );
  const where = '($1::text IS NULL OR t.type = $1) AND ($2::text IS NULL OR t.status = $2)';
  const params = [q.type || null, q.status || null];
  const [rows, total] = await Promise.all([
    many(
      `SELECT t.*, u.full_name AS user_name FROM transactions t LEFT JOIN users u ON u.id = t.user_id
        WHERE ${where} ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
      [...params, q.limit, (q.page - 1) * q.limit],
    ),
    one(`SELECT count(*)::int AS n FROM transactions t WHERE ${where}`, params),
  ]);
  res.json({ items: rows.map(serializeTransaction), total: total.n, page: q.page, limit: q.limit });
});

// ------------------------------------------------------------------ litiges (médiation : RG-G6, RG-G13, RG-G14)
router.get('/disputes', async (req, res) => {
  const q = parse(z.object({
    status: z.enum(['open', 'pending_confirmation', 'resolved']).optional(),
    kind: z.enum(['quality', 'no_show', 'not_validated', 'other']).optional(),
  }), req.query);
  res.json({ items: await disputes.listDisputes(q, req.user) });
});

router.post('/disputes/:id/resolve', async (req, res) => {
  const b = parse(
    z.strictObject({
      resolution: z.enum(['release', 'refund', 'split'], { error: 'Résolution invalide (release, refund, split)' }),
      provider_amount: amount().optional(),
      note: z.string({ error: 'Motif obligatoire' }).trim().min(5, 'Motif obligatoire (5 caractères minimum)').max(2000),
    }),
    req.body,
  );
  res.json(await disputes.resolveDispute(idParam(req), req.user, b, clientIp(req)));
});

router.post('/disputes/:id/confirm', async (req, res) => {
  res.json(await disputes.confirmDispute(idParam(req), req.user, clientIp(req)));
});

// ------------------------------------------------------------------ avis
router.get('/reviews', async (req, res) => {
  const q = parse(pagination, req.query);
  const [rows, total] = await Promise.all([
    many(
      `SELECT r.*, a.full_name AS author_name, a.avatar_url AS author_avatar, t.full_name AS target_name
         FROM reviews r JOIN users a ON a.id = r.author_id JOIN users t ON t.id = r.target_id
        ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
      [q.limit, (q.page - 1) * q.limit],
    ),
    one('SELECT count(*)::int AS n FROM reviews'),
  ]);
  res.json({ items: rows.map((r) => ({ ...serializeReview(r), target_id: r.target_id, target_name: r.target_name })), total: total.n, page: q.page, limit: q.limit });
});

router.delete('/reviews/:id', async (req, res) => {
  const r = await one('DELETE FROM reviews WHERE id = $1 RETURNING target_id', [idParam(req)]);
  if (!r) throw notFound('Avis introuvable');
  await recomputeRating(r.target_id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ paramètres
router.get('/settings', async (_req, res) => res.json(await getSettings()));
/** Fournisseurs de paiement : configuration détectée (clés présentes dans l'env), capacités, frais publiés. */
router.get('/payment-providers', (_req, res) => res.json({ items: listProviders() }));

router.put('/settings', async (req, res) => {
  const patch = parse(settingsSchema, req.body);
  // Refus explicite d'un fournisseur dont les clés ne sont pas configurées sur le serveur.
  for (const key of ['payment_provider', 'payout_provider']) {
    const name = patch[key];
    if (!name || name === 'same') continue;
    const p = getProviderStrict(name);
    if (!p.isConfigured()) {
      throw badRequest(`Fournisseur « ${p.meta.name} » non configuré : renseignez ses clés dans les variables d'environnement du serveur`, { [key]: 'Non configuré' });
    }
    if (key === 'payment_provider' && !p.meta.supports.collect) {
      throw badRequest(`« ${p.meta.name} » ne permet pas l'encaissement`, { [key]: 'Non supporté' });
    }
  }
  const out = await updateSettings(patch);
  await audit({ actorId: req.user.id, action: 'settings.update', target: 'settings', details: patch, ip: clientIp(req) });
  res.json(out);
});

// ------------------------------------------------------------------ promotions
const promoInput = z.object({
  code: z.string().trim().min(3).max(30).transform((s) => s.toUpperCase()),
  description: z.string().trim().max(300).nullable().optional(),
  discount_percent: z.coerce.number().int().min(1).max(100),
  max_uses: z.coerce.number().int().positive().nullable().optional(),
  expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
  is_active: z.boolean().optional(),
});
router.get('/promotions', async (_req, res) => res.json({ items: await many('SELECT * FROM promotions ORDER BY created_at DESC') }));
router.post('/promotions', async (req, res) => {
  const b = parse(promoInput, req.body);
  res.status(201).json(
    await one(
      `INSERT INTO promotions (code, description, discount_percent, max_uses, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, coalesce($6, true)) RETURNING *`,
      [b.code, b.description ?? null, b.discount_percent, b.max_uses ?? null, b.expires_at ?? null, b.is_active ?? null],
    ),
  );
});
router.patch('/promotions/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(promoInput.partial(), req.body);
  const cur = await one('SELECT * FROM promotions WHERE id = $1', [id]);
  if (!cur) throw notFound('Promotion introuvable');
  const m = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
  res.json(
    await one(
      `UPDATE promotions SET code = $2, description = $3, discount_percent = $4, max_uses = $5, expires_at = $6, is_active = $7
       WHERE id = $1 RETURNING *`,
      [id, m.code, m.description, m.discount_percent, m.max_uses, m.expires_at, m.is_active],
    ),
  );
});
router.delete('/promotions/:id', async (req, res) => {
  const r = await one('DELETE FROM promotions WHERE id = $1 RETURNING id', [idParam(req)]);
  if (!r) throw notFound('Promotion introuvable');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ villes
const cityInput = z.object({ name: z.string().trim().min(2).max(60), lat: lat(), lng: lng(), is_active: boolString().optional() });
router.get('/cities', async (_req, res) => res.json({ items: await categories.listCities({ includeInactive: true }) }));
router.post('/cities', async (req, res) => {
  const b = parse(cityInput, req.body);
  res.status(201).json(
    await one('INSERT INTO cities (name, lat, lng, is_active) VALUES ($1, $2, $3, coalesce($4, true)) RETURNING id, name, lat, lng, is_active', [
      b.name, b.lat, b.lng, b.is_active ?? null,
    ]),
  );
});
router.patch('/cities/:id', async (req, res) => {
  const b = parse(cityInput.partial(), req.body);
  const c = await one(
    `UPDATE cities SET name = coalesce($2, name), lat = coalesce($3, lat), lng = coalesce($4, lng), is_active = coalesce($5, is_active)
     WHERE id = $1 RETURNING id, name, lat, lng, is_active`,
    [idParam(req), b.name ?? null, b.lat ?? null, b.lng ?? null, b.is_active ?? null],
  );
  if (!c) throw notFound('Ville introuvable');
  res.json(c);
});

// ------------------------------------------------------------------ trésorerie (§5.5)
router.get('/treasury', async (_req, res) => res.json(await treasury.getTreasury()));
router.get('/treasury/ledger', async (req, res) => res.json({ items: await treasury.ledger(parse(daysQuery, req.query).days) }));

const accountInput = z.strictObject({
  type: z.enum(['bank', 'mtn_momo', 'orange_money'], { error: 'Type invalide (bank, mtn_momo, orange_money)' }),
  label: z.string({ error: 'Libellé requis' }).trim().min(2).max(80),
  bank_name: z.string().trim().min(2).max(80).optional(),
  account_holder: z.string().trim().min(2).max(120).optional(),
  account_number: z.string().trim().regex(/^[A-Za-z0-9 -]{6,40}$/, 'Numéro de compte invalide').optional(),
  phone: phoneSchema().optional(),
  is_default: z.boolean().optional(),
});
router.get('/payout-accounts', async (_req, res) => res.json({ items: await treasury.listPayoutAccounts() }));
router.post('/payout-accounts', async (req, res) => {
  res.status(201).json(await treasury.createPayoutAccount(req.user, parse(accountInput, req.body), clientIp(req)));
});
router.patch('/payout-accounts/:id', async (req, res) => {
  const b = parse(accountInput.omit({ type: true }).partial(), req.body);
  res.json(await treasury.updatePayoutAccount(req.user, idParam(req), b, clientIp(req)));
});
router.delete('/payout-accounts/:id', async (req, res) => res.json(await treasury.deletePayoutAccount(req.user, idParam(req), clientIp(req))));

router.get('/treasury/withdrawals', async (req, res) => res.json(await treasury.listWithdrawals(parse(pagination, req.query))));
router.post('/treasury/withdrawals', async (req, res) => {
  const b = parse(
    z.strictObject({
      amount: amount(100, 'Montant minimum : 100 FCFA'),
      payout_account_id: uuid(),
      password: z.string({ error: 'Mot de passe requis' }).min(1, 'Mot de passe requis').max(200),
    }),
    req.body,
  );
  res.status(201).json(await treasury.createWithdrawal({ admin: req.user, ...b, ip: clientIp(req) }));
});

// ------------------------------------------------------------------ journal d'audit
router.get('/audit-logs', async (req, res) => {
  const q = parse(pagination.extend({ action: z.string().trim().max(60).optional(), actor_id: uuid().optional() }), req.query);
  res.json(await listAuditLogs(q));
});

export default router;
