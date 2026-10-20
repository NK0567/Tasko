import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { requireAuth, requireProvider } from '../../middleware/auth.js';
import { parse, uuid, z } from '../../utils/validate.js';
import { phoneSchema } from '../../utils/phone.js';
import { listTenders } from '../jobs/tenders.js';
import { one } from '../../db.js';

const router = Router();

router.get('/tenders', requireAuth, requireProvider, async (req, res) => {
  const q = parse(z.object({ category_id: uuid().optional(), q: z.string().trim().max(80).optional() }), req.query);
  res.json({ items: await listTenders(req.user, { category_id: q.category_id, q: q.q || null }) });
});

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  skip: () => config.isTest,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop d\'invitations, réessayez plus tard' } }),
});

/** Invitation SMS d'un client sans compte. TODO(sms) : brancher un fournisseur SMS (aucun envoi réel aujourd'hui). */
router.post('/invitations', requireAuth, inviteLimiter, async (req, res) => {
  const { phone } = parse(z.strictObject({ phone: phoneSchema() }), req.body);
  const exists = await one('SELECT 1 FROM users WHERE phone = $1', [phone]);
  if (!exists) console.info(`[invitation] TODO(sms) : inviter un numéro (demandé par ${req.user.id})`);
  res.json({ ok: true });
});

export default router;
