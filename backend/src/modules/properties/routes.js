import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { amount, isoDate, lat, lng, parse, uuid, z } from '../../utils/validate.js';
import * as svc from './service.js';

const router = Router();
router.use(['/properties', '/recurring-jobs'], requireAuth);
const idParam = (req) => parse(uuid(), req.params.id);

const propertyInput = z.strictObject({
  name: z.string({ error: 'Nom requis' }).trim().min(2).max(120),
  kind: z.enum(['apartment', 'house', 'building', 'land', 'commercial', 'other'], { error: 'Type de bien invalide' }),
  address: z.string().trim().max(300).nullable().optional(),
  lat: lat().nullable().optional(),
  lng: lng().nullable().optional(),
  units_count: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

router.get('/properties', async (req, res) => res.json({ items: await svc.listProperties(req.user) }));
router.post('/properties', async (req, res) => res.status(201).json(await svc.createProperty(req.user, parse(propertyInput, req.body))));
router.get('/properties/:id', async (req, res) => res.json(await svc.getProperty(idParam(req), req.user)));
router.patch('/properties/:id', async (req, res) => res.json(await svc.updateProperty(idParam(req), req.user, parse(propertyInput.partial(), req.body))));
router.delete('/properties/:id', async (req, res) => res.json(await svc.deleteProperty(idParam(req), req.user)));

const recurringInput = z.strictObject({
  property_id: uuid().nullable().optional(),
  category_id: uuid(),
  provider_id: uuid(),
  title: z.string({ error: 'Titre requis' }).trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  price: amount(100, 'Prix minimum : 100 FCFA'),
  address: z.string().trim().max(300).nullable().optional(),
  lat: lat().optional(),
  lng: lng().optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly'], { error: 'Fréquence invalide (weekly, biweekly, monthly)' }),
  next_run_at: isoDate().optional(),
  is_active: z.boolean().optional(),
});

router.get('/recurring-jobs', async (req, res) => res.json({ items: await svc.listRecurring(req.user) }));
router.post('/recurring-jobs', async (req, res) => res.status(201).json(await svc.createRecurring(req.user, parse(recurringInput, req.body))));
router.patch('/recurring-jobs/:id', async (req, res) => res.json(await svc.updateRecurring(idParam(req), req.user, parse(recurringInput.partial(), req.body))));
router.delete('/recurring-jobs/:id', async (req, res) => res.json(await svc.deleteRecurring(idParam(req), req.user)));

export default router;
