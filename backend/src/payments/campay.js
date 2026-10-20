import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError, paymentFailed, unauthorized } from '../utils/errors.js';

/**
 * Intégration Campay (https://www.campay.net) — Mobile Money Cameroun (MTN MoMo, Orange Money).
 *
 * Documentation officielle (consultée le 16/10/2026) :
 *   - API (Postman, liée depuis campay.net) : https://documenter.getpostman.com/view/2391374/T1LV8PVA
 *   - SDK Python officiel : https://github.com/CamPay/campay-python-sdk (src/campay/sdk.py)
 *   - Tarifs : https://www.campay.net/ (2 % encaissement, 1 % retrait, 5 000 FCFA par virement bancaire)
 *
 * Confirmé par la doc : base démo https://demo.campay.net/api / prod https://www.campay.net/api ; en-tête
 * `Authorization: Token <jeton>` ; POST /token/ {username, password} → {token, expires_in: 3600} ou jeton permanent ;
 * POST /collect/ {amount, currency, from, description, external_reference} → {reference, ussd_code, operator} ;
 * GET /transaction/{reference}/ → {reference, status: PENDING|SUCCESSFUL|FAILED, amount, currency, operator, code,
 * operator_reference, endpoint, external_reference, reason, app_amount…} ; POST /withdraw/ {amount, to, description,
 * external_reference} → {reference, status} ; GET /balance/ → {total_balance, mtn_balance, orange_balance, currency} ;
 * callback GET (query) ou POST (JSON) selon le réglage de l'application, champ `signature` = JWT HS256 signé avec la
 * « webhook key » de l'application ; numéros au format 2376XXXXXXXX (sans +) ; montants entiers.
 *
 * Non disponible dans l'API : virement vers un compte bancaire (uniquement depuis le tableau de bord Campay).
 */
const cfg = () => config.campay;
const TIMEOUT_MS = 20_000;

let cachedToken = null; // { token, expiresAt }

/** Réinitialise le jeton mis en cache (tests). */
export function resetCampayToken() {
  cachedToken = null;
}

function unsupported(message) {
  return new AppError('PAYOUT_UNSUPPORTED', message, 400);
}

/** +237 6XX XX XX XX / 6XXXXXXXX → 2376XXXXXXXX (format attendu par Campay, sans « + »). */
export function campayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 9) return `237${digits}`;
  return digits;
}

async function getToken() {
  const { token, username, password, baseUrl } = cfg();
  if (token) return token; // jeton permanent (APP KEYS)
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (!username || !password) throw new AppError('INTERNAL', 'Fournisseur de paiement non configuré', 500);
  const res = await fetch(`${baseUrl}/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) {
    console.warn('[campay] /token/', res.status);
    throw paymentFailed('Authentification auprès du fournisseur de paiement impossible', { status: res.status });
  }
  const ttl = Math.max(60, Number(data.expires_in) || 3600);
  cachedToken = { token: data.token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return data.token;
}

async function call(method, path, body, { retry = true } = {}) {
  const token = await getToken();
  const res = await fetch(`${cfg().baseUrl}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retry && !cfg().token) {
    cachedToken = null; // jeton expiré : on en redemande un une fois
    return call(method, path, body, { retry: false });
  }
  if (!res.ok) {
    // Codes documentés : ER101 (numéro), ER102 (opérateur non supporté), ER201 (montant), ER301 (solde insuffisant).
    console.warn('[campay]', method, path, res.status, data?.error_code || data?.message || '');
    throw paymentFailed('Le fournisseur de paiement a refusé l\'opération', { status: res.status, code: data?.error_code || null });
  }
  return data;
}

export const normalizeCampayStatus = (s) => {
  const st = String(s || '').toUpperCase();
  if (st === 'SUCCESSFUL') return 'success';
  if (st === 'FAILED') return 'failed';
  return 'pending';
};

export const campayProvider = {
  name: 'campay',
  meta: {
    id: 'campay',
    name: 'Campay',
    docs_url: 'https://documenter.getpostman.com/view/2391374/T1LV8PVA',
    // Virement bancaire : pas d'endpoint dans l'API (tableau de bord Campay uniquement).
    supports: { collect: true, payout_momo: true, payout_bank: false, balance: true },
    get fees() {
      return { ...cfg().fees };
    },
  },

  isConfigured() {
    const c = cfg();
    return !!((c.token || (c.username && c.password)) && c.webhookKey);
  },

  /**
   * POST /collect/ : demande de paiement poussée sur le téléphone (MTN/Orange détecté par Campay à partir du numéro).
   * `external_reference` = id de la transaction Tasko (UUID). Pas de page hébergée → checkout_url null.
   */
  async initiate({ amount, phone, reference, description }) {
    if (!phone) throw paymentFailed('Numéro Mobile Money requis');
    const data = await call('POST', '/collect/', {
      amount: String(Math.round(amount)),
      currency: 'XAF',
      from: campayPhone(phone),
      description: description || 'Paiement Tasko',
      external_reference: reference,
    });
    if (!data?.reference) throw paymentFailed('Réponse inattendue du fournisseur de paiement');
    return { external_ref: data.reference, checkout_url: null, status: 'pending', ussd_code: data.ussd_code || null };
  },

  /**
   * Callback Campay (GET query ou POST JSON). La signature est un JWT HS256 signé avec CAMPAY_WEBHOOK_KEY : elle prouve
   * l'origine, mais ne couvre pas les champs de la transaction → statut et montant sont TOUJOURS re-vérifiés via
   * GET /transaction/{reference}/ avant tout crédit (cf. checkStatus).
   */
  verifyWebhook(req) {
    const params = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const { webhookKey } = cfg();
    const signature = params.signature;
    if (!webhookKey || !signature) throw unauthorized('Signature webhook manquante');
    try {
      jwt.verify(String(signature), webhookKey, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Signature webhook invalide');
    }
    // TODO(campay) : le contenu du JWT (iat, source « CamPay ») n'est pas détaillé par la doc — non exploité.
    return {
      kind: params.endpoint === 'withdraw' ? 'transfer' : 'payment',
      external_ref: params.reference ? String(params.reference) : null,
      reference: params.external_reference ? String(params.external_reference) : null,
      status: normalizeCampayStatus(params.status),
      amount: params.amount !== undefined ? Number(params.amount) : null,
    };
  },

  /** GET /transaction/{reference}/ — source de vérité pour le statut et le montant. */
  async checkStatus(externalRef) {
    const data = await call('GET', `/transaction/${encodeURIComponent(externalRef)}/`);
    return {
      status: normalizeCampayStatus(data?.status),
      amount: data?.amount !== undefined && data?.amount !== null ? Math.round(Number(data.amount)) : null,
      currency: data?.currency || null,
      external_ref: data?.reference || externalRef,
      reference: data?.external_reference || null,
      reason: data?.reason || null,
    };
  },

  /**
   * POST /withdraw/ vers un numéro MTN/Orange (versement prestataire, remboursement, retrait admin MoMo).
   * Le retrait par API doit être autorisé dans les réglages de l'application Campay. Résultat : PENDING puis callback
   * (endpoint = withdraw) ou vérification de statut par le planificateur.
   */
  async payout({ amount, phone, bank, reference }) {
    if (bank) {
      // TODO(campay) : aucun endpoint de virement bancaire dans https://documenter.getpostman.com/view/2391374/T1LV8PVA
      throw unsupported('Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay');
    }
    if (!phone) throw paymentFailed('Numéro Mobile Money requis');
    const data = await call('POST', '/withdraw/', {
      amount: String(Math.round(amount)),
      // TODO(campay) : `currency` absent de l'exemple Postman de /withdraw/ (présent dans le SDK Python) — envoyé par prudence.
      currency: 'XAF',
      to: campayPhone(phone),
      description: `Tasko ${reference}`,
      external_reference: reference,
    });
    if (!data?.reference) throw paymentFailed('Réponse inattendue du fournisseur de paiement');
    return { external_ref: data.reference, status: normalizeCampayStatus(data.status) };
  },

  /** GET /balance/ → total_balance (XAF). Les soldes MTN et Orange sont séparés chez Campay (ER301 si insuffisant). */
  async balance() {
    try {
      const data = await call('GET', '/balance/');
      const v = Number(data?.total_balance);
      return Number.isFinite(v) ? Math.round(v) : null;
    } catch {
      return null;
    }
  },

  /** Frais estimés d'un versement : 1 % vers MoMo, 5 000 FCFA fixes vers une banque (tarifs publiés). */
  transferFee(amount, _type, { destination = 'momo' } = {}) {
    const { payout_rate, bank_flat } = cfg().fees;
    if (destination === 'bank') return bank_flat;
    return Math.ceil(Number(amount || 0) * payout_rate);
  },
};
