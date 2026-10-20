import crypto from 'node:crypto';
import { config } from '../config.js';
import { reportPaymentResult, reportPayoutResult } from './events.js';

const ref = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const endsWith000 = (v) => String(v || '').replace(/\s+/g, '').endsWith('000');

function later(ms, fn) {
  const timer = setTimeout(() => fn().catch((err) => console.error('[mock-payment]', err.message)), ms);
  timer.unref?.();
}

/**
 * Fournisseur de paiement simulé (développement / démo / tests).
 * - initiate : `pending`, puis ~MOCK_PAYMENT_DELAY_MS (3 s) plus tard `success` (ou `failed` si le numéro se termine par 000).
 * - payout : `pending`, puis ~MOCK_PAYOUT_DELAY_MS (3 s) plus tard `success` (ou `failed` si le numéro de téléphone
 *   ou le numéro de compte bancaire se termine par 000).
 */
export const mockProvider = {
  name: 'mock',
  meta: {
    id: 'mock',
    name: 'Simulateur',
    docs_url: null,
    supports: { collect: true, payout_momo: true, payout_bank: true, balance: false },
    fees: { collect_rate: 0, payout_rate: 0, bank_flat: 0 },
  },

  isConfigured() {
    return true;
  },

  /** Re-vérification : sans objet (le simulateur n'a pas de webhook, le résultat est interne). */
  async checkStatus() {
    return null;
  },

  async initiate({ amount, phone, method, reference }) {
    const external_ref = ref('MOCK');
    const willFail = endsWith000(phone);
    later(config.mockPaymentDelayMs, () =>
      reportPaymentResult({ provider: 'mock', external_ref, reference, status: willFail ? 'failed' : 'success' }),
    );
    return { external_ref, checkout_url: null, status: 'pending', raw: { amount, method } };
  },

  verifyWebhook() {
    return null; // pas de webhook pour le mock
  },

  async payout({ amount, phone, bank, reference }) {
    const external_ref = ref('MOCK-PO');
    const willFail = endsWith000(phone) || endsWith000(bank?.account_number);
    later(config.mockPayoutDelayMs, () =>
      reportPayoutResult({
        provider: 'mock',
        external_ref,
        reference,
        status: willFail ? 'failed' : 'success',
        reason: willFail ? 'Destinataire refusé (simulation : numéro se terminant par 000)' : null,
      }),
    );
    return { external_ref, status: 'pending', raw: { amount } };
  },

  /** Solde du compte marchand : sans objet en simulation. */
  async balance() {
    return null;
  },

  /** Frais de transfert facturés par l'agrégateur : 0 en simulation. */
  transferFee() {
    return 0;
  },
};
