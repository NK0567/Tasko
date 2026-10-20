import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { parse, z } from '../../utils/validate.js';
import { phoneSchema } from '../../utils/phone.js';
import * as auth from './service.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop de tentatives, réessayez dans quelques minutes' } }),
});

// OTP : envoi de SMS coûteux → limite par IP plus stricte (en plus de la limite par numéro côté service)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop de codes demandés, réessayez dans quelques minutes' } }),
});

router.post('/otp/request', otpLimiter, authLimiter, async (req, res) => {
  const { phone } = parse(z.object({ phone: phoneSchema() }), req.body);
  res.json(await auth.requestOtp(phone));
});

router.post('/register', authLimiter, async (req, res) => {
  const body = parse(
    z.object({
      full_name: z.string({ error: 'Nom complet requis' }).trim().min(2, 'Nom trop court').max(80),
      phone: phoneSchema(),
      password: z.string({ error: 'Mot de passe requis' }).min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(100),
      otp_code: z.string().regex(/^\d{4,8}$/, 'Code invalide').optional(),
      city: z.string().trim().max(60).optional(),
    }),
    req.body,
  );
  res.status(201).json(await auth.register(body));
});

router.post('/login', authLimiter, async (req, res) => {
  const body = parse(
    z.object({ phone: phoneSchema(), password: z.string({ error: 'Mot de passe requis' }).min(1, 'Mot de passe requis').max(200) }),
    req.body,
  );
  res.json(await auth.login(body));
});

export default router;
