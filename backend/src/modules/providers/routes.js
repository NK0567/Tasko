import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { badRequest } from '../../utils/errors.js';
import { boolString, lat, lng, pagination, parse, uuid, z } from '../../utils/validate.js';
import { normalizePhone } from '../../utils/phone.js';
import * as providers from './service.js';

const router = Router();

const searchQuery = z.object({
  lat: lat().optional(),
  lng: lng().optional(),
  radius_km: z.coerce.number().positive().max(200).optional(),
  category_id: uuid().optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['score', 'distance', 'rating', 'price']).default('score'),
  online: boolString().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/', async (req, res) => {
  const params = parse(searchQuery, req.query);
  if (params.q === '') delete params.q;
  res.json({ items: await providers.searchProviders(params) });
});

// Anti-énumération des numéros : authentification + 30 recherches / 10 min par utilisateur.
const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => config.isTest,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop de recherches, réessayez dans quelques minutes' } }),
});

/** GET /providers/lookup?code=TSK-XXXXX | ?phone= — « J'ai déjà trouvé mon prestataire ». */
router.get('/lookup', requireAuth, lookupLimiter, async (req, res) => {
  const q = parse(
    z.object({
      code: z.string().trim().toUpperCase().regex(/^TSK-[A-Z0-9]{5}$/, 'Code Tasko invalide (ex. TSK-7F3K9)').optional(),
      phone: z.string().trim().max(20).optional(),
    }),
    req.query,
  );
  if (!q.code && !q.phone) throw badRequest('Indiquez un code Tasko ou un numéro de téléphone');
  const phone = q.phone ? normalizePhone(q.phone) : null;
  if (q.phone && !phone) throw badRequest('Numéro invalide', { phone: 'Invalide' });
  res.json(await providers.lookupProvider({ code: q.code, phone }));
});

router.get('/:id', optionalAuth, async (req, res) => {
  const id = parse(uuid(), req.params.id);
  const { lat: la, lng: ln } = parse(z.object({ lat: lat().optional(), lng: lng().optional() }), req.query);
  res.json(await providers.getProviderDetail(id, { lat: la, lng: ln, viewerId: req.user?.id }));
});

router.get('/:id/reviews', async (req, res) => {
  const id = parse(uuid(), req.params.id);
  res.json(await providers.listReviews(id, parse(pagination, req.query)));
});

router.post('/:id/follow', requireAuth, async (req, res) => {
  const id = parse(uuid(), req.params.id);
  res.json(await providers.toggleFollow(req.user.id, id));
});

export default router;
