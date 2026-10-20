import { Router } from 'express';
import { many, one, query, withTransaction } from '../../db.js';
import { requireAuth, requireProvider } from '../../middleware/auth.js';
import { fileUrl, requireFile, uploadImage } from '../../middleware/upload.js';
import { badRequest } from '../../utils/errors.js';
import { amount, fileRef, lat, lng, parse, paymentMethod, uuid, z } from '../../utils/validate.js';
import { phoneSchema } from '../../utils/phone.js';
import { getUserById } from './service.js';
import { getSettings } from '../settings/service.js';
import { updateProviderLocation } from '../../realtime/location.js';
import { listFavorites } from '../providers/service.js';
import { purchaseProviderService, serializeTransaction } from '../payments/service.js';
import { notifyAdmins } from '../notifications/service.js';
import { getWallet, withdraw } from '../wallet/service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await getUserById(req.user.id));
});

router.patch('/', async (req, res) => {
  const b = parse(
    z.strictObject({
      full_name: z.string().trim().min(2, 'Nom trop court').max(80).optional(),
      email: z.email({ error: 'Adresse e-mail invalide' }).max(200).nullable().optional(),
      city: z.string().trim().max(60).nullable().optional(),
      avatar_url: fileRef().nullable().optional(),
    }),
    req.body,
  );
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    await query(`UPDATE users SET ${sets}, updated_at = now() WHERE id = $1`, [req.user.id, ...fields.map(([, v]) => v)]);
  }
  res.json(await getUserById(req.user.id));
});

router.post('/avatar', ...uploadImage.single('file'), async (req, res) => {
  const file = requireFile(req);
  await query('UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1', [req.user.id, fileUrl(file)]);
  res.json(await getUserById(req.user.id));
});

/** Compte entreprise (V2) : {name, kind, niu?, rccm?, address?} ou null / {} pour revenir en compte individuel. */
router.put('/business', async (req, res) => {
  const raw = req.body;
  const reset = raw === null || raw === undefined || (typeof raw === 'object' && (raw.business === null || Object.keys(raw).length === 0));
  if (reset) {
    await query(`UPDATE users SET account_type = 'individual', business = NULL, updated_at = now() WHERE id = $1`, [req.user.id]);
  } else {
    const b = parse(
      z.strictObject({
        name: z.string({ error: 'Raison sociale requise' }).trim().min(2).max(160),
        kind: z.enum(['company', 'real_estate', 'ngo', 'administration', 'other'], { error: 'Type d\'entreprise invalide' }),
        niu: z.string().trim().max(40).nullable().optional(),
        rccm: z.string().trim().max(60).nullable().optional(),
        address: z.string().trim().max(300).nullable().optional(),
      }),
      raw.business && typeof raw.business === 'object' ? raw.business : raw,
    );
    const business = { name: b.name, kind: b.kind, niu: b.niu ?? null, rccm: b.rccm ?? null, address: b.address ?? null };
    await query(`UPDATE users SET account_type = 'business', business = $2::jsonb, updated_at = now() WHERE id = $1`, [req.user.id, JSON.stringify(business)]);
  }
  res.json(await getUserById(req.user.id));
});

/** Active / met à jour le mode prestataire (le code Tasko public est attribué automatiquement). */
router.put('/provider', async (req, res) => {
  const b = parse(
    z.object({
      headline: z.string({ error: 'Titre requis' }).trim().min(2, 'Titre trop court').max(80),
      bio: z.string().trim().max(1500).nullable().optional(),
      provider_type: z.enum(['artisan', 'student', 'professional', 'freelancer', 'company'], { error: 'Type de prestataire invalide' }),
      years_experience: z.coerce.number().int().min(0).max(70).default(0),
      momo_number: phoneSchema(),
      momo_operator: z.enum(['mtn', 'orange'], { error: 'Opérateur invalide (mtn, orange)' }),
      available_days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5, 6]),
    }),
    req.body,
  );
  const wasProvider = await withTransaction(async (client) => {
    const before = await one('SELECT is_provider FROM users WHERE id = $1 FOR UPDATE', [req.user.id], client);
    await client.query(
      `INSERT INTO provider_profiles (user_id, headline, bio, provider_type, years_experience, momo_number, momo_operator, available_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET headline = EXCLUDED.headline, bio = EXCLUDED.bio, provider_type = EXCLUDED.provider_type,
         years_experience = EXCLUDED.years_experience, momo_number = EXCLUDED.momo_number, momo_operator = EXCLUDED.momo_operator,
         available_days = EXCLUDED.available_days, updated_at = now()`,
      [req.user.id, b.headline, b.bio ?? null, b.provider_type, b.years_experience, b.momo_number, b.momo_operator, [...new Set(b.available_days)].sort()],
    );
    await client.query('UPDATE users SET is_provider = true, updated_at = now() WHERE id = $1', [req.user.id]);
    return before.is_provider;
  });
  if (!wasProvider) {
    await notifyAdmins({
      type: 'system',
      title: 'Nouveau prestataire inscrit',
      body: `${req.user.full_name} — ${b.headline}`,
      data: { user_id: req.user.id },
    });
  }
  res.json(await getUserById(req.user.id));
});

router.patch('/provider/status', requireProvider, async (req, res) => {
  const { is_online } = parse(z.object({ is_online: z.boolean({ error: 'is_online (booléen) requis' }) }), req.body);
  await query('UPDATE provider_profiles SET is_online = $2, updated_at = now() WHERE user_id = $1', [req.user.id, is_online]);
  res.json(await getUserById(req.user.id));
});

router.post('/location', async (req, res) => {
  const b = parse(z.object({ lat: lat(), lng: lng() }), req.body);
  await updateProviderLocation(req.user.id, b.lat, b.lng);
  res.json({ ok: true });
});

router.put('/skills', requireProvider, async (req, res) => {
  const { skills } = parse(
    z.object({
      skills: z.array(z.object({ category_id: uuid(), base_price: amount(0, undefined, 10_000_000) })).max(30, '30 compétences maximum'),
    }),
    req.body,
  );
  const ids = [...new Set(skills.map((s) => s.category_id))];
  if (ids.length) {
    const found = await many('SELECT id FROM categories WHERE id = ANY($1)', [ids]);
    if (found.length !== ids.length) throw badRequest('Un ou plusieurs services sont introuvables', { skills: 'Invalide' });
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM provider_skills WHERE provider_id = $1', [req.user.id]);
    for (const s of skills) {
      await client.query(
        `INSERT INTO provider_skills (provider_id, category_id, base_price) VALUES ($1, $2, $3)
         ON CONFLICT (provider_id, category_id) DO UPDATE SET base_price = EXCLUDED.base_price`,
        [req.user.id, s.category_id, s.base_price],
      );
    }
  });
  res.json(await getUserById(req.user.id));
});

router.post('/portfolio', requireProvider, ...uploadImage.single('file'), async (req, res) => {
  const file = requireFile(req);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : null;
  const { n } = await one('SELECT count(*)::int AS n FROM portfolio_items WHERE provider_id = $1', [req.user.id]);
  if (n >= 50) throw badRequest('50 réalisations maximum');
  await query('INSERT INTO portfolio_items (provider_id, title, image_url) VALUES ($1, $2, $3)', [req.user.id, title || null, fileUrl(file)]);
  res.status(201).json((await getUserById(req.user.id)).provider);
});

router.get('/earnings', requireProvider, async (req, res) => {
  const id = req.user.id;
  const [held, earned, items] = await Promise.all([
    one(
      `SELECT coalesce(sum(provider_payout), 0)::int AS balance_held FROM jobs
        WHERE provider_id = $1 AND payment_status = 'held'`,
      [id],
    ),
    one(
      `SELECT coalesce(sum(amount), 0)::int AS total_earned,
              coalesce(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Douala') AT TIME ZONE 'Africa/Douala'), 0)::int AS month_earned,
              (SELECT count(*)::int FROM jobs WHERE provider_id = $1 AND status = 'completed') AS jobs_completed
         FROM transactions WHERE user_id = $1 AND type IN ('payout', 'cancellation_fee')`, // crédits gagnés (versés, en cours ou en portefeuille)
      [id],
    ),
    many(
      `SELECT * FROM transactions WHERE user_id = $1 AND type IN ('payout', 'cancellation_fee', 'withdrawal', 'subscription', 'boost')
        ORDER BY created_at DESC LIMIT 50`,
      [id],
    ),
  ]);
  res.json({ ...held, ...earned, items: items.map(serializeTransaction) });
});

router.get('/wallet', requireProvider, async (req, res) => {
  res.json(await getWallet(req.user));
});

router.post('/wallet/withdraw', requireProvider, async (req, res) => {
  const b = parse(
    z.strictObject({
      amount: amount(100, 'Montant minimum : 100 FCFA'),
      method: z.enum(['mtn_momo', 'orange_money'], { error: 'Moyen invalide (mtn_momo, orange_money)' }),
      phone: phoneSchema(),
    }),
    req.body,
  );
  res.status(201).json(await withdraw(req.user, b));
});

router.post('/subscription', requireProvider, async (req, res) => {
  const b = parse(z.object({ plan: z.literal('pro', { error: 'Seul le plan « pro » est disponible' }), method: paymentMethod(), phone: phoneSchema() }), req.body);
  const s = await getSettings();
  const r = await purchaseProviderService(req.user, { type: 'subscription', amount: s.pro_plan_price, method: b.method, phone: b.phone, meta: { plan: 'pro' } });
  res.json(r);
});

router.post('/boost', requireProvider, async (req, res) => {
  const b = parse(z.object({ duration: z.enum(['day', 'month'], { error: 'Durée invalide (day, month)' }), method: paymentMethod(), phone: phoneSchema() }), req.body);
  const s = await getSettings();
  const price = b.duration === 'month' ? s.boost_month_price : s.boost_day_price;
  res.json(await purchaseProviderService(req.user, { type: 'boost', amount: price, method: b.method, phone: b.phone, meta: { duration: b.duration } }));
});

router.get('/favorites', async (req, res) => {
  const q = parse(z.object({ lat: lat().optional(), lng: lng().optional() }), req.query);
  res.json({ items: await listFavorites(req.user.id, q) });
});

router.post('/push-token', async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(4096), platform: z.enum(['android', 'ios', 'web']).default('android') }), req.body);
  await query(
    `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [req.user.id, b.token, b.platform],
  );
  res.json({ ok: true });
});

export default router;
