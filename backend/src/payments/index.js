import { config } from '../config.js';
import { mockProvider } from './mock.js';
import { notchpayProvider } from './notchpay.js';
import { campayProvider } from './campay.js';
import { monetbilProvider } from './monetbil.js';

/**
 * Interface commune des fournisseurs :
 *   initiate({ amount, phone, method, reference }) -> { external_ref, checkout_url, status }
 *   verifyWebhook(req) -> { kind, external_ref, reference, status, amount? } | null   (lève 401 si signature invalide)
 *   checkStatus(external_ref) -> { status, amount, currency, external_ref, reference } | null
 *       (re-vérification serveur à serveur avant tout crédit — on ne fait jamais confiance au seul corps du webhook)
 *   payout({ amount, phone, operator, bank?, reference }) -> { external_ref, status }  (status pending → résultat asynchrone)
 *   balance() -> number | null ; transferFee(amount, type, { destination: 'momo'|'bank' }) -> number
 *   meta : { id, name, docs_url, supports: {collect, payout_momo, payout_bank, balance}, fees: {collect_rate, payout_rate, bank_flat} }
 *   isConfigured() -> boolean (clés présentes dans l'environnement)
 */
const providers = { mock: mockProvider, notchpay: notchpayProvider, campay: campayProvider, monetbil: monetbilProvider };

export const PROVIDER_IDS = Object.freeze(['mock', 'notchpay', 'campay', 'monetbil']);

/** Fournisseur d'encaissement : variable d'env PAYMENT_PROVIDER > paramètre `payment_provider` en base > mock. */
export function resolveProviderName(settings) {
  const name = config.paymentProviderOverride || settings?.payment_provider || 'mock';
  return providers[name] ? name : 'mock';
}

/**
 * Fournisseur des versements (prestataires, retraits portefeuille, retraits admin) :
 * variable d'env PAYOUT_PROVIDER > paramètre `payout_provider` (`same` = fournisseur d'encaissement).
 */
export function resolvePayoutProviderName(settings) {
  const name = config.payoutProviderOverride || settings?.payout_provider || 'same';
  if (name === 'same' || !providers[name]) return resolveProviderName(settings);
  return name;
}

/**
 * Fournisseur d'un remboursement client : celui qui a encaissé s'il sait verser (même compte marchand),
 * sinon le fournisseur des versements.
 */
export function resolveRefundProviderName(settings, collectedWith) {
  const p = providers[collectedWith];
  if (p && p.meta.supports.payout_momo) return collectedWith;
  return resolvePayoutProviderName(settings);
}

export function getPaymentProvider(name) {
  return providers[name] || mockProvider;
}

/** Fournisseur exact (sans repli sur le simulateur) — webhooks : jamais traiter avec un autre fournisseur. */
export function getProviderStrict(name) {
  return Object.hasOwn(providers, name) ? providers[name] : null;
}

export function isProviderConfigured(name) {
  return !!getProviderStrict(name)?.isConfigured();
}

/** GET /admin/payment-providers */
export function listProviders() {
  return PROVIDER_IDS.map((id) => {
    const p = providers[id];
    return {
      id: p.meta.id,
      name: p.meta.name,
      configured: p.isConfigured(),
      supports: { ...p.meta.supports },
      fees: { ...p.meta.fees },
      docs_url: p.meta.docs_url,
    };
  });
}

export const operatorFromMethod = (method) => (method === 'orange_money' ? 'orange' : 'mtn');
export const methodFromOperator = (op) => (op === 'orange' ? 'orange_money' : 'mtn_momo');
