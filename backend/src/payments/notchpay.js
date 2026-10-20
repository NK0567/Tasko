import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError, paymentFailed } from '../utils/errors.js';

/**
 * Intégration Notch Pay (https://notchpay.co) — paiements Mobile Money Cameroun (MTN MoMo, Orange Money).
 *
 * ⚠️ Écrit d'après la documentation publique de Notch Pay ; À VÉRIFIER contre https://developer.notchpay.co
 * avant la mise en production (noms de champs, canaux, événements webhook, API de transfert, virements bancaires,
 * frais, solde). Rien ici n'a été testé contre l'API réelle : aucune garantie n'est donnée sur le comportement.
 */
const { baseUrl, publicKey, privateKey, hashKey } = config.notchpay;

const CHANNELS = { mtn_momo: 'cm.mtn', orange_money: 'cm.orange', mtn: 'cm.mtn', orange: 'cm.orange' };

async function call(method, path, body, { grant = false } = {}) {
  if (!publicKey) throw new AppError('INTERNAL', 'Fournisseur de paiement non configuré', 500);
  const headers = { Authorization: publicKey, Accept: 'application/json', 'Content-Type': 'application/json' };
  // TODO(notchpay) : vérifier que les opérations sensibles (transferts, solde) exigent bien l'en-tête X-Grant = clé privée.
  if (grant) headers['X-Grant'] = privateKey;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Le message du fournisseur est journalisé mais pas renvoyé tel quel au client.
    console.warn('[notchpay]', method, path, res.status, data?.message);
    throw paymentFailed('Le fournisseur de paiement a refusé l\'opération', { status: res.status });
  }
  return data;
}

const normalizeStatus = (s) => {
  const st = String(s || 'pending').toLowerCase();
  if (/complete|success|sent/.test(st)) return 'success';
  if (/fail|reject|cancel|expire/.test(st)) return 'failed';
  return 'pending';
};

export const notchpayProvider = {
  name: 'notchpay',
  meta: {
    id: 'notchpay',
    name: 'NotchPay',
    docs_url: 'https://developer.notchpay.co',
    // TODO(notchpay) : virements bancaires et solde non confirmés (cf. payout / balance ci-dessous).
    supports: { collect: true, payout_momo: true, payout_bank: true, balance: true },
    // Encaissement 2 % (https://notchpay.co/pricing) ; frais de transfert non confirmés → 0 (à vérifier).
    fees: { collect_rate: 0.02, payout_rate: 0, bank_flat: 0 },
  },

  isConfigured() {
    return !!(publicKey && privateKey && hashKey);
  },

  /** TODO(notchpay) : re-vérification GET /payments/{reference} à brancher après confirmation du format de réponse. */
  async checkStatus() {
    return null;
  },

  /**
   * 1) POST /payments : crée le paiement (montant XAF, référence marchande, callback).
   * 2) Pour Mobile Money, POST /payments/{reference} avec le canal + téléphone déclenche la demande USSD/push.
   * Si l'étape 2 échoue, on renvoie l'URL de paiement hébergée (authorization_url) au client.
   */
  async initiate({ amount, phone, method, reference, email, description }) {
    const created = await call('POST', '/payments', {
      amount,
      currency: 'XAF',
      reference, // notre référence (id de transaction Tasko)
      phone,
      email: email || undefined, // TODO(notchpay) : vérifier si email ou phone suffit comme identifiant client
      description: description || 'Paiement Tasko',
      callback: `${config.publicUrl}/api/v1/payments/notchpay/return`,
    });
    // TODO(notchpay) : confirmer la forme exacte de la réponse (transaction.reference / authorization_url)
    const external_ref = created?.transaction?.reference || created?.reference;
    const checkout_url = created?.authorization_url || null;
    if (!external_ref) throw paymentFailed('Réponse inattendue du fournisseur de paiement');

    const channel = CHANNELS[method];
    if (channel && phone) {
      try {
        // TODO(notchpay) : vérifier le format attendu de `data` (phone avec/sans indicatif +237).
        await call('POST', `/payments/${encodeURIComponent(external_ref)}`, { channel, data: { phone } });
      } catch (err) {
        console.warn('[notchpay] charge direct échoué, repli sur la page hébergée :', err.message);
      }
    }
    return { external_ref, checkout_url, status: 'pending' };
  },

  /**
   * Vérifie la signature HMAC SHA-256 (clé NOTCHPAY_HASH_KEY) du corps brut envoyée dans `x-notch-signature`.
   * Retourne { kind: 'payment'|'transfer', external_ref, reference, status, event } ou lève une erreur 401.
   */
  verifyWebhook(req) {
    const signature = req.headers['x-notch-signature'];
    if (!hashKey || !signature || !req.rawBody) throw new AppError('UNAUTHORIZED', 'Signature webhook manquante', 401);
    const expected = crypto.createHmac('sha256', hashKey).update(req.rawBody).digest('hex');
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError('UNAUTHORIZED', 'Signature webhook invalide', 401);
    }
    const event = String(req.body?.event || req.body?.type || '');
    const data = req.body?.data || {};
    // TODO(notchpay) : confirmer la liste des événements (payment.complete, payment.failed, payment.canceled,
    // payment.expired, transfer.complete, transfer.failed…) et les champs de référence marchande.
    let status = null;
    if (/complete|success/i.test(event)) status = 'success';
    else if (/fail|cancel|expire|reject/i.test(event)) status = 'failed';
    return {
      kind: /^transfer/i.test(event) ? 'transfer' : 'payment',
      external_ref: data.reference || data.id || null,
      reference: data.merchant_reference || data.trxref || null,
      status,
      event,
    };
  },

  /**
   * Transfert sortant : Mobile Money (payout prestataire, remboursement, retrait admin MoMo) ou virement bancaire
   * (retrait admin vers Ecobank…).
   * TODO(notchpay) : vérifier l'endpoint (/transfers), la création préalable éventuelle d'un bénéficiaire (/recipients),
   * le champ `channel` (cm.mtn / cm.orange / cm.mobile), et SURTOUT la disponibilité et le format des virements
   * bancaires (canal, champs IBAN/RIB, délais) — non garantis ici.
   */
  async payout({ amount, phone, operator, bank, reference }) {
    const beneficiary = bank
      ? {
          // TODO(notchpay) : format bénéficiaire bancaire à confirmer dans la documentation officielle.
          name: bank.account_holder,
          bank_name: bank.bank_name,
          account_number: bank.account_number,
          country: 'CM',
        }
      : { phone, country: 'CM' };
    const data = await call(
      'POST',
      '/transfers',
      {
        amount,
        currency: 'XAF',
        description: `Tasko ${reference}`,
        reference,
        channel: bank ? 'cm.bank' /* TODO(notchpay) : canal bancaire à confirmer */ : CHANNELS[operator] || 'cm.mobile',
        beneficiary,
      },
      { grant: true },
    );
    return {
      external_ref: data?.transfer?.reference || data?.reference || null,
      status: normalizeStatus(data?.transfer?.status || data?.status),
    };
  },

  /** Solde du compte marchand. TODO(notchpay) : endpoint et champ à confirmer ; renvoie null en cas de doute. */
  async balance() {
    try {
      const data = await call('GET', '/balance', null, { grant: true });
      const v = data?.balance?.available ?? data?.balance ?? null;
      return Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
    } catch {
      return null;
    }
  },

  /** Frais de transfert. TODO(notchpay) : grille tarifaire à confirmer ; 0 par défaut (aucune garantie). */
  transferFee() {
    return 0;
  },
};
