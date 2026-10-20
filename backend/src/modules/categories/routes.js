import { Router } from 'express';
import { optionalAuth } from '../../middleware/auth.js';
import { parse, uuid } from '../../utils/validate.js';
import { getSettings, publicSettings } from '../settings/service.js';
import * as categories from './service.js';

const router = Router();

router.get('/categories', optionalAuth, async (req, res) => {
  const includeInactive = req.query.all === 'true' && !!req.user?.is_admin;
  res.json({ items: await categories.listCategoryTree({ includeInactive }) });
});

router.get('/categories/:id', optionalAuth, async (req, res) => {
  const id = parse(uuid(), req.params.id);
  res.json(await categories.getCategory(id, { includeInactive: !!req.user?.is_admin }));
});

router.get('/cities', async (_req, res) => {
  res.json({ items: await categories.listCities({ includeInactive: true }) });
});

router.get('/settings/public', async (_req, res) => {
  res.json(publicSettings(await getSettings()));
});

export default router;
