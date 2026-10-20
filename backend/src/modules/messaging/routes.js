import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { isoDate, lat, lng, parse, uuid, z } from '../../utils/validate.js';
import * as messaging from './service.js';
import * as notifications from '../notifications/service.js';

const router = Router();

router.get('/conversations', requireAuth, async (req, res) => {
  res.json({ items: await messaging.listConversations(req.user.id) });
});

router.post('/conversations', requireAuth, async (req, res) => {
  const b = parse(z.object({ user_id: uuid(), job_id: uuid().nullable().optional() }), req.body);
  res.json(await messaging.openConversation(req.user.id, b.user_id, b.job_id));
});

router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const q = parse(
    z.object({
      before: isoDate().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query,
  );
  res.json({ items: await messaging.listMessages(req.user, parse(uuid(), req.params.id), q) });
});

router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const b = parse(
    z
      .object({
        type: z.enum(['text', 'location', 'image']).default('text'),
        body: z.string().trim().max(4000).optional(),
        lat: lat().optional(),
        lng: lng().optional(),
      })
      .refine((m) => m.type !== 'image' || (m.body && /^\/uploads\/[A-Za-z0-9._-]+$|^https:\/\//.test(m.body)), {
        message: 'Image invalide (utilisez l\'URL renvoyée par /uploads)', path: ['body'],
      }),
    req.body,
  );
  res.status(201).json(await messaging.sendMessage(req.user, parse(uuid(), req.params.id), b));
});

router.post('/conversations/:id/read', requireAuth, async (req, res) => {
  await messaging.markRead(req.user, parse(uuid(), req.params.id));
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, async (req, res) => {
  const { type } = parse(z.object({ type: z.enum(['job', 'payment', 'message', 'system']).optional() }), req.query);
  res.json(await notifications.listNotifications(req.user.id, type));
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await notifications.markAllRead(req.user.id);
  res.json({ ok: true });
});

export default router;
