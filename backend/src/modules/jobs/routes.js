import { Router } from 'express';
import { requireAuth, requireProvider } from '../../middleware/auth.js';
import { amount, fileList, fileRef, isoDate, lat, lng, parse, paymentMethod, uuid, z } from '../../utils/validate.js';
import { phoneSchema } from '../../utils/phone.js';
import * as jobs from './service.js';
import * as tenders from './tenders.js';
import { getReceipt, receiptHtml } from './receipt.js';
import { payJob } from '../payments/service.js';
import { openDispute } from '../disputes/service.js';

const router = Router();
const idParam = (req) => parse(uuid(), req.params.id);
const param = (req, name) => parse(uuid(), req.params[name]);

const rating = () => z.coerce.number().int().min(1, 'Note entre 1 et 5').max(5, 'Note entre 1 et 5');
const reviewBody = z.object({
  rating: rating(),
  comment: z.string().trim().max(1000).optional(),
  punctuality: rating().optional(),
  quality: rating().optional(),
  behavior: rating().optional(),
  value: rating().optional(),
});
const milestoneInput = z.strictObject({
  title: z.string({ error: 'Titre du jalon requis' }).trim().min(2, 'Titre trop court').max(120),
  amount: amount(100, 'Montant minimum d\'un jalon : 100 FCFA'),
});
const milestonesInput = z.array(milestoneInput).min(1).max(20, '20 jalons maximum');
const proofBody = z.strictObject({ proof_photos: fileList(10).optional(), note: z.string().trim().max(1000).optional() });

router.get('/quote', async (req, res) => {
  const { price } = parse(z.object({ price: amount() }), req.query);
  res.json(await jobs.quote(price));
});

router.use(requireAuth);

router.post('/', async (req, res) => {
  const body = parse(
    z
      .object({
        mode: z.enum(['instant', 'direct', 'tender'], { error: 'Mode invalide (instant, direct, tender)' }).optional(),
        category_id: uuid(),
        title: z.string().trim().max(120).optional(),
        other_label: z.string().trim().max(120).optional(),
        description: z.string().trim().max(4000).optional().default(''),
        address: z.string().trim().max(300).optional(),
        lat: lat(),
        lng: lng(),
        urgency: z.enum(['now', 'today', 'scheduled']).default('now'),
        scheduled_at: isoDate().nullable().optional(),
        budget: amount().optional(),
        provider_id: uuid().nullable().optional(),
        photo_url: fileRef().nullable().optional(),
        bid_deadline: isoDate().optional(),
        visibility: z.enum(['public', 'invited']).optional(),
        invited_provider_ids: z.array(uuid()).max(50).optional(),
        budget_min: amount().optional(),
        budget_max: amount().optional(),
        property_id: uuid().nullable().optional(),
        milestones: milestonesInput.optional(),
      })
      .refine((b) => b.urgency !== 'scheduled' || b.scheduled_at, { message: 'Date requise pour une mission programmée', path: ['scheduled_at'] }),
    req.body,
  );
  res.status(201).json(await jobs.createJob(req.user, body));
});

/** Offre créée par le prestataire pour un client identifié par téléphone (accord conclu hors de l'app). */
router.post('/offer', requireProvider, async (req, res) => {
  const body = parse(
    z.strictObject({
      client_phone: phoneSchema(),
      category_id: uuid(),
      title: z.string().trim().max(120).optional(),
      description: z.string({ error: 'Description requise' }).trim().min(2).max(4000),
      price: amount(100, 'Prix minimum : 100 FCFA').optional(),
      address: z.string().trim().max(300).optional(),
      lat: lat().optional(),
      lng: lng().optional(),
      scheduled_at: isoDate().nullable().optional(),
      milestones: milestonesInput.optional(),
    }),
    req.body,
  );
  res.status(201).json(await jobs.createOffer(req.user, body));
});

router.get('/', async (req, res) => {
  const q = parse(
    z.object({
      as: z.enum(['client', 'provider']).optional(),
      status: z.enum(['active', 'history', ...jobs.ALL_STATUSES]).optional(),
      mode: z.enum(['instant', 'direct', 'tender']).optional(),
    }),
    req.query,
  );
  res.json({ items: await jobs.listJobs(req.user, q) });
});

router.get('/nearby', requireProvider, async (req, res) => {
  const q = parse(z.object({ lat: lat().optional(), lng: lng().optional() }), req.query);
  res.json({ items: await jobs.nearbyJobs(req.user, q) });
});

router.get('/:id/receipt.html', async (req, res) => {
  const r = await getReceipt(idParam(req), req.user);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.type('html').send(receiptHtml(r));
});
router.get('/:id/receipt', async (req, res) => {
  res.json(await getReceipt(idParam(req), req.user));
});

router.get('/:id', async (req, res) => {
  res.json(await jobs.getJob(idParam(req), req.user));
});

router.post('/:id/accept', requireProvider, async (req, res) => {
  const body = parse(z.object({ price: amount(100, 'Prix minimum : 100 FCFA').optional() }), req.body);
  res.json(await jobs.acceptJob(idParam(req), req.user, body));
});

router.post('/:id/decline', requireProvider, async (req, res) => {
  res.json(await jobs.declineJob(idParam(req), req.user));
});

router.post('/:id/pay', async (req, res) => {
  const body = parse(z.object({ method: paymentMethod(), phone: phoneSchema(), milestone_id: uuid().optional() }), req.body);
  res.json(await payJob(idParam(req), req.user, body));
});

router.post('/:id/status', async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['en_route', 'arrived', 'in_progress', 'done'], { error: 'Statut invalide' }),
      start_code: z.string().trim().regex(/^\d{4}$/, 'Code à 4 chiffres').optional(),
      proof_photos: fileList(10).optional(),
      note: z.string().trim().max(1000).optional(),
    }),
    req.body,
  );
  res.json(await jobs.updateFieldStatus(idParam(req), req.user, body));
});

router.post('/:id/complete', async (req, res) => {
  const body = parse(reviewBody.partial(), req.body);
  res.json(await jobs.completeJob(idParam(req), req.user, body));
});

router.post('/:id/review', async (req, res) => {
  res.status(201).json(await jobs.reviewJob(idParam(req), req.user, parse(reviewBody, req.body)));
});

router.post('/:id/cancel', async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body);
  res.json(await jobs.cancelJob(idParam(req), req.user, body));
});

router.post('/:id/dispute', async (req, res) => {
  const body = parse(
    z.object({
      reason: z.string({ error: 'Motif requis' }).trim().min(5, 'Décrivez le problème (5 caractères minimum)').max(2000),
      kind: z.enum(['quality', 'no_show', 'not_validated', 'other']).optional(),
      photos: fileList(10).optional(),
      milestone_id: uuid().optional(),
    }),
    req.body,
  );
  res.json(await openDispute(idParam(req), req.user, body));
});

/** RG-G11 — « Le prestataire n'est pas venu » (client). */
router.post('/:id/no-show', async (req, res) => {
  const body = parse(z.object({ message: z.string().trim().max(2000).optional() }), req.body);
  res.json(await openDispute(idParam(req), req.user, {
    kind: 'no_show',
    reason: body.message?.length >= 5 ? body.message : 'Le prestataire ne s\'est pas présenté. Je demande le remboursement.',
  }));
});

// ------------------------------------------------------------------ jalons
router.post('/:id/milestones/:mid/submit', requireProvider, async (req, res) => {
  res.json(await jobs.submitMilestone(idParam(req), param(req, 'mid'), req.user, parse(proofBody, req.body)));
});
router.post('/:id/milestones/:mid/release', async (req, res) => {
  res.json(await jobs.releaseMilestone(idParam(req), param(req, 'mid'), req.user));
});

// ------------------------------------------------------------------ appels d'offres
router.post('/:id/bids', requireProvider, async (req, res) => {
  const body = parse(
    z.strictObject({
      amount: amount(100, 'Montant minimum : 100 FCFA'),
      duration_days: z.coerce.number().int().min(1).max(3650).optional(),
      message: z.string().trim().max(4000).optional(),
      attachments: fileList(10).optional(),
      milestones: milestonesInput.optional(),
    }),
    req.body,
  );
  res.status(201).json(await tenders.submitBid(idParam(req), req.user, body));
});
router.get('/:id/bids', async (req, res) => {
  res.json({ items: await tenders.listBids(idParam(req), req.user) });
});
router.delete('/:id/bids/:bidId', requireProvider, async (req, res) => {
  res.json(await tenders.withdrawBid(idParam(req), param(req, 'bidId'), req.user));
});
router.post('/:id/bids/:bidId/award', async (req, res) => {
  res.json(await tenders.awardBid(idParam(req), param(req, 'bidId'), req.user));
});

export default router;
