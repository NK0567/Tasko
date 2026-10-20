import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { amount, fileList, parse, uuid, z } from '../../utils/validate.js';
import * as disputes from './service.js';

const router = Router();
router.use(requireAuth);
const idParam = (req) => parse(uuid(), req.params.id);

router.get('/:id', async (req, res) => res.json(await disputes.getDispute(idParam(req), req.user)));

router.get('/:id/messages', async (req, res) => res.json(await disputes.listDisputeMessages(idParam(req), req.user)));

const messageBody = z.strictObject({
  type: z.enum(['text', 'image']).default('text'),
  body: z.string({ error: 'Message requis' }).trim().min(1, 'Le message est vide').max(4000),
}).refine((b) => b.type !== 'image' || /^\/uploads\/[A-Za-z0-9._-]+$|^https:\/\//.test(b.body), {
  message: 'Image invalide (utilisez l\'URL renvoyée par /uploads)', path: ['body'],
});
router.post('/:id/messages', async (req, res) => {
  res.status(201).json(await disputes.postDisputeMessage(idParam(req), req.user, parse(messageBody, req.body)));
});

/** Alias V1 conservé : dépôt de preuves = messages du salon. */
router.post('/:id/evidence', async (req, res) => {
  const b = parse(z.strictObject({ message: z.string().trim().min(1).max(4000), photos: fileList(10).optional() }), req.body);
  res.status(201).json(await disputes.addEvidence(idParam(req), req.user, b));
});

router.post('/:id/proposals', async (req, res) => {
  const b = parse(z.strictObject({ provider_amount: amount(), message: z.string().trim().max(2000).optional() }), req.body);
  res.status(201).json(await disputes.createProposal(idParam(req), req.user, b));
});
router.post('/:id/proposals/:pid/accept', async (req, res) => {
  res.json(await disputes.answerProposal(idParam(req), parse(uuid(), req.params.pid), req.user, true));
});
router.post('/:id/proposals/:pid/reject', async (req, res) => {
  res.json(await disputes.answerProposal(idParam(req), parse(uuid(), req.params.pid), req.user, false));
});

export default router;
