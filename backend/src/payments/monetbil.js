import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError, paymentFailed, unauthorized } from '../utils/errors.js';

/**
 * Intégration Monetbil (https://www.monetbil.com) — encaissement Mobile Money Cameroun (MTN MoMo, Orange Money).
 *
 * Sources officielles (consultées le 16/10/2026 ; les PDF de monetbil.com sont derrière un CAPTCHA, lus partiellement) :
 *   - SDK PHP officiel : https://github.com/Monetbil/monetbil-php (monetbil.php, notify.php, return.php) — CONFIRMÉ :
 *     URL checkPayment, codes de statut, champs de notification, algorithme de signature.
 *   - Encaissement direct (placePayment) : https://monetbil.company/doc/sandbox/collection
 *   - Widget v2.1 : https://www.monetbil.com/docs/monetbil-payment-widget-v2.1-en.pdf
 *   - Notification : https://www.monetbil.com/docs/monetbil-payment-notification-en.pdf
 *   - Versement : https://www.monetbil.company/doc/sandbox/disbursement (partiellement lisible — voir payout)
 *
 * Aucun tarif public : les frais sont négociés à l'ouverture du compte (https://monetbil.company/terms?lang=fr).
 */
const cfg = () => config.monetbil;
const TIMEOUT_MS = 20_000;

// Codes de statut de checkPayment (constantes du SDK PHP officiel).
const ST = { SUCCESS: 1, FAILED: 0, CANCELLED: -1, SUCCESS_TESTMODE: 7, FAILED_TESTMODE: 8, CANCELLED_TESTMODE: 9 };

const OPERATORS = { mtn_momo: 'CM_MTNMOBILEMONEY', orange_money: 'CM_ORANGEMONEY', mtn: 'CM_MTNMOBILEMONEY', orange: 'CM_ORANGEMONEY' };

/** 6XXXXXXXX / +2376XXXXXXXX → 2376XXXXXXXX. TODO(monetbil) : format exact de `phonenumber` à confirmer (https://monetbil.company/doc/sandbox/collection). */
export function monetbilPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 9 ? `237${digits}` : digits;
}

/**
 * Signature Monetbil (SDK PHP officiel, Monetbil::sign) : ksort(params) puis md5(service_secret . implode('', values)).
 * `params` exclut `sign`.
 */
export function monetbilSign(secret, params) {
  const keys = Object.keys(params).sort();
  const concat = keys.map((k) => (params[k] === undefined || params[k] === null ? '' : String(params[k]))).join('');
  return crypto.createHash('md5').update(`${secret}${concat}`, 'utf8').digest('hex');
}

function unsupported() {
  return new AppError('PAYOUT_UNSUPPORTED', 'Monetbil ne propose pas de versement automatique dans cette intégration', 400);
}

async function postForm(url, fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) body.set(k, String(v));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Statut d'une notification (texte ou code numérique) → success | failed | pending. */
function normalizeNotifyStatus(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (v === '1' || v === 'success' || v === 'successful') return 'success';
  if (['0', '-1', 'failed', 'cancelled', 'canceled'].includes(v)) return 'failed';
  return 'pending';
}

function normalizeCheckStatus(code) {
  const n = Number(code);
  if (n === ST.SUCCESS) return 'success';
  if (n === ST.SUCCESS_TESTMODE) return cfg().allowTestMode ? 'success' : 'failed';
  if ([ST.FAILED, ST.CANCELLED, ST.FAILED_TESTMODE, ST.CANCELLED_TESTMODE].includes(n)) return 'failed';
  return 'pending';
}

export const monetbilProvider = {
  name: 'monetbil',
  meta: {
    id: 'monetbil',
    name: 'Monetbil',
    docs_url: 'https://github.com/Monetbil/monetbil-php',
    get supports() {
      return { collect: true, payout_momo: !!cfg().payoutEnabled, payout_bank: false, balance: false };
    },
    get fees() {
      return { ...cfg().fees };
    },
  },

  isConfigured() {
    return !!(cfg().serviceKey && cfg().serviceSecret);
  },

  /**
   * 1) Paiement direct (push USSD) : POST {apiUrl}/placePayment {service, phonenumber, amount, operator, currency, country,
   *    item_ref, payment_ref, notify_url} → {status: "REQUEST_ACCEPTED", paymentId, channel…}.
   * 2) Repli : widget v2.1 POST {widgetUrl}/{service_key} (formulaire signé) → {success, payment_url} = checkout_url.
   * payment_ref = id de la transaction Tasko.
   */
  async initiate({ amount, phone, method, reference }) {
    const { serviceKey, serviceSecret, apiUrl, widgetUrl } = cfg();
    if (!serviceKey) throw new AppError('INTERNAL', 'Fournisseur de paiement non configuré', 500);
    const notify_url = `${config.publicUrl}/api/v1/payments/webhook/monetbil`;
    if (phone) {
      try {
        // TODO(monetbil) : noms exacts des champs de réponse `channel*` non lisibles dans la doc (https://monetbil.company/doc/sandbox/collection).
        const { res, data } = await postForm(`${apiUrl}/placePayment`, {
          service: serviceKey,
          phonenumber: monetbilPhone(phone),
          amount: Math.round(amount),
          operator: OPERATORS[method] || undefined,
          currency: 'XAF',
          country: 'CM',
          item_ref: 'tasko',
          payment_ref: reference,
          notify_url,
        });
        if (res.ok && data?.status === 'REQUEST_ACCEPTED' && data?.paymentId) {
          return { external_ref: String(data.paymentId), checkout_url: null, status: 'pending' };
        }
        console.warn('[monetbil] placePayment', res.status, data?.status);
      } catch (err) {
        console.warn('[monetbil] placePayment échoué, repli sur le widget :', err.message);
      }
    }
    // Widget v2.1 : les arguments envoyés sont signés (SDK PHP : sign(service_secret, args)).
    // TODO(monetbil) : hôte du widget à confirmer — SDK PHP : https://www.monetbil.com/widget/ ; PDF v2.1 : https://api.monetbil.com/widget/
    const args = {
      amount: Math.round(amount),
      phone: phone ? monetbilPhone(phone) : undefined,
      country: 'CM',
      currency: 'XAF',
      locale: 'fr',
      item_ref: 'tasko',
      payment_ref: reference,
      notify_url,
      return_url: `${config.publicUrl}/api/v1/payments/return`,
    };
    for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
    const { res, data } = await postForm(`${widgetUrl}/${encodeURIComponent(serviceKey)}`, { ...args, sign: monetbilSign(serviceSecret, args) });
    if (!res.ok || !data?.success || !data?.payment_url) {
      console.warn('[monetbil] widget', res.status);
      throw paymentFailed('Le fournisseur de paiement a refusé l\'opération', { status: res.status });
    }
    // Le paymentId n'est connu qu'à la notification (transaction_id) : external_ref null jusque-là, rapprochement par payment_ref.
    return { external_ref: null, checkout_url: data.payment_url, status: 'pending' };
  },

  /**
   * Notification Monetbil (POST formulaire, ou GET) : signature `sign` = md5(service_secret . valeurs triées par clé)
   * sur tous les champs reçus sauf `sign` (SDK PHP officiel, Monetbil::checkSign). Mauvaise signature → 401.
   * Champs : service, transaction_id (= paymentId), transaction_uuid, msisdn, amount, fee, status, message, currency,
   * item_ref, payment_ref, user, … Le statut est ensuite re-vérifié par checkPayment.
   */
  verifyWebhook(req) {
    const params = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const { serviceSecret, serviceKey } = cfg();
    const received = params.sign;
    if (!serviceSecret || !received) throw unauthorized('Signature webhook manquante');
    const rest = { ...params };
    delete rest.sign;
    const expected = monetbilSign(serviceSecret, rest);
    const a = Buffer.from(String(received).toLowerCase());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw unauthorized('Signature webhook invalide');
    if (rest.service && serviceKey && rest.service !== serviceKey) throw unauthorized('Service Monetbil inconnu');
    return {
      kind: 'payment',
      external_ref: rest.transaction_id ? String(rest.transaction_id) : null,
      reference: rest.payment_ref ? String(rest.payment_ref) : null,
      status: normalizeNotifyStatus(rest.status),
      // Champs couverts par la signature : utilisables si checkPayment ne renvoie pas le montant.
      signed_amount: rest.amount !== undefined && rest.amount !== '' ? Math.round(Number(rest.amount)) : null,
      signed_currency: rest.currency || null,
    };
  },

  /**
   * POST https://api.monetbil.com/payment/v1/checkPayment {paymentId} → {transaction: {status, testmode, …}}.
   * CONFIRMÉ : transaction.status (1 succès, 0 échec, -1 annulé, 7/8/9 = mode test).
   * TODO(monetbil) : autres champs de `transaction` (amount, currency, payment_ref) non confirmés — lus s'ils existent ;
   * à défaut, le montant signé de la notification est utilisé.
   */
  async checkStatus(externalRef) {
    const { res, data } = await postForm(`${cfg().apiUrl}/checkPayment`, { paymentId: externalRef });
    if (!res.ok) {
      console.warn('[monetbil] checkPayment', res.status);
      throw paymentFailed('Vérification du paiement impossible', { status: res.status });
    }
    const tr = data?.transaction;
    if (!tr) return { status: 'pending', amount: null, currency: null, external_ref: externalRef, reference: null };
    const amount = tr.amount !== undefined && tr.amount !== null && tr.amount !== '' ? Math.round(Number(tr.amount)) : null;
    return {
      status: normalizeCheckStatus(tr.status),
      amount: Number.isFinite(amount) ? amount : null,
      currency: tr.currency || null,
      external_ref: externalRef,
      reference: tr.payment_ref || null,
      reason: null,
    };
  },

  /**
   * Versement Mobile Money. Désactivé par défaut : l'API de versement (POST https://api.monetbil.com/v1/payouts/withdrawal,
   * JSON {service_key, service_secret, phonenumber, amount, processing_number, operator}) n'est que partiellement lisible
   * dans la doc officielle (https://www.monetbil.company/doc/sandbox/disbursement) : statuts, endpoint de vérification et
   * notification de versement non confirmés. Activer avec MONETBIL_PAYOUT_ENABLED=true après vérification.
   */
  async payout({ amount, phone, operator, bank, reference }) {
    const { payoutEnabled, payoutUrl, serviceKey, serviceSecret } = cfg();
    if (bank || !payoutEnabled) throw unsupported();
    // TODO(monetbil) : valider contre https://www.monetbil.company/doc/sandbox/disbursement (format de réponse, statuts).
    const res = await fetch(payoutUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        service_key: serviceKey,
        service_secret: serviceSecret,
        phonenumber: monetbilPhone(phone),
        amount: Math.round(amount),
        processing_number: reference,
        operator: OPERATORS[operator] || undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success !== true) {
      console.warn('[monetbil] payout', res.status, data?.message);
      throw paymentFailed('Le fournisseur a refusé le versement', { status: res.status });
    }
    // TODO(monetbil) : statut final du versement (pas d'endpoint de vérification documenté) — `success: true` considéré réussi.
    return { external_ref: data.transaction ? String(data.transaction) : null, status: 'success' };
  },

  /** Pas d'API de solde documentée. */
  async balance() {
    return null;
  },

  /** Frais de versement : non publiés (MONETBIL_PAYOUT_FEE_RATE si votre contrat les précise). */
  transferFee(amount) {
    const rate = cfg().fees.payout_rate;
    return rate ? Math.ceil(Number(amount || 0) * rate) : 0;
  },
};
