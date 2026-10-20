import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { parse, uuid } from '../../utils/validate.js';
import { getPaymentProvider } from '../../payments/index.js';
import { getTransaction, handlePaymentResult, handlePayoutResult, processProviderWebhook } from './service.js';

const router = Router();

router.get('/transactions/:id', requireAuth, async (req, res) => {
  res.json(await getTransaction(parse(uuid(), req.params.id), req.user));
});

/**
 * Webhook Notch Pay : signature HMAC SHA-256 du corps brut dans `x-notch-signature`.
 * Rejouable sans effet : les gestionnaires ne modifient qu'une transaction encore `pending` (verrou de ligne).
 */
router.post('/payments/webhook/notchpay', async (req, res) => {
  const result = getPaymentProvider('notchpay').verifyWebhook(req);
  if (result?.status) {
    const payload = { provider: 'notchpay', external_ref: result.external_ref, reference: result.reference, status: result.status };
    if (result.kind === 'transfer') await handlePayoutResult(payload);
    else await handlePaymentResult(payload);
  }
  // TODO(notchpay) : par sécurité, re-vérifier le statut et le montant via GET /payments/{reference} avant de créditer.
  res.json({ ok: true });
});

/**
 * Webhooks Campay et Monetbil : signature vérifiée par le fournisseur, puis statut ET montant re-vérifiés auprès de son API
 * avant tout crédit (jamais le seul corps du webhook). Idempotents. Campay peut notifier en GET (query) ou POST (JSON) ;
 * Monetbil notifie en POST (formulaire) — les deux méthodes sont acceptées.
 */
for (const name of ['campay', 'monetbil']) {
  const handler = async (req, res) => res.json(await processProviderWebhook(name, req));
  router.get(`/payments/webhook/${name}`, handler);
  router.post(`/payments/webhook/${name}`, handler);
}

/** Page de retour après paiement hébergé (callback navigateur). */
router.get(['/payments/notchpay/return', '/payments/return'], (_req, res) => {
  res.type('html').send('<!doctype html><meta charset="utf-8"><title>Tasko</title><p style="font-family:sans-serif">Paiement en cours de vérification. Vous pouvez revenir dans l\'application Tasko.</p>');
});

export default router;
