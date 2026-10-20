import type { PaymentProvider, PaymentProviderInfo, PayoutAccountType } from '../api/types';
import { formatMoney, formatRate } from './format';

export const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  mock: 'Simulateur',
  notchpay: 'NotchPay',
  campay: 'Campay',
  monetbil: 'Monetbil',
};

export const PROVIDER_DESCRIPTION: Record<PaymentProvider, string> = {
  mock: 'Aucun argent ne bouge : paiements et versements simulés (tests, démo).',
  notchpay: 'Mobile Money réel (MTN, Orange) via Notch Pay.',
  campay: 'Mobile Money réel (MTN, Orange) via Campay. Virement bancaire depuis le tableau de bord Campay.',
  monetbil: 'Encaissement Mobile Money réel via Monetbil. Pas de versement automatique dans cette intégration.',
};

export const providerLabel = (id: string | null | undefined) => (id && id in PROVIDER_LABEL ? PROVIDER_LABEL[id as PaymentProvider] : id ?? '—');

/** Taux de frais lisible ; null = non publié (tarif négocié avec le fournisseur). */
export const feeRateLabel = (rate: number | null | undefined) => (rate === null || rate === undefined ? 'non publié' : rate === 0 ? 'aucun' : formatRate(rate));
export const feeFlatLabel = (v: number | null | undefined) => (v === null || v === undefined ? 'non publié' : v === 0 ? 'aucun' : formatMoney(v));

export interface WithdrawalFeeEstimate {
  /** Le fournisseur sait-il verser vers ce type de compte ? */
  supported: boolean;
  /** Frais estimés (FCFA) ; null si non publiés. */
  fee: number | null;
  /** Phrase explicative prête à afficher. */
  message: string;
}

/** Même calcul que le serveur (transferFee) : MoMo = taux × montant (arrondi supérieur), banque = forfait. */
export function estimateWithdrawalFee(p: PaymentProviderInfo | null | undefined, amount: number, accountType: PayoutAccountType, accountName: string): WithdrawalFeeEstimate {
  if (!p) return { supported: true, fee: null, message: 'Fournisseur de versement inconnu : frais non estimés.' };
  const bank = accountType === 'bank';
  if (bank && !p.supports.payout_bank) {
    return {
      supported: false,
      fee: null,
      message: p.id === 'campay'
        ? 'Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay : retirez vers un compte Mobile Money ici, ou faites le virement depuis Campay.'
        : `${p.name} ne permet pas le virement bancaire automatique.`,
    };
  }
  if (!bank && !p.supports.payout_momo) {
    return { supported: false, fee: null, message: `${p.name} ne propose pas de versement automatique : choisissez un autre « Fournisseur pour les versements » dans Paramètres.` };
  }
  if (bank) {
    const flat = p.fees.bank_flat;
    if (flat === null) return { supported: true, fee: null, message: `Virement ${accountName} via ${p.name} : frais non publiés.` };
    if (flat === 0) return { supported: true, fee: 0, message: `Virement ${accountName} via ${p.name} : sans frais.` };
    return { supported: true, fee: flat, message: `Virement ${accountName} via ${p.name} : ${formatMoney(flat)} de frais — regroupez vos retraits.` };
  }
  const rate = p.fees.payout_rate;
  if (rate === null) return { supported: true, fee: null, message: `Mobile Money via ${p.name} : frais non publiés.` };
  const fee = Math.ceil(Math.max(0, amount) * rate);
  return {
    supported: true,
    fee,
    message: rate === 0 ? `Mobile Money via ${p.name} : sans frais.` : `Mobile Money via ${p.name} : ${formatRate(rate)} soit ${formatMoney(fee)} de frais.`,
  };
}

/**
 * Seuil de reversement automatique conseillé : pour un forfait bancaire, le seuil qui ramène les frais à ≤ 2 % du montant
 * (ex. 5 000 FCFA → 250 000 FCFA) ; pour des frais proportionnels, le seuil n'influe pas sur le coût (50 000 par défaut).
 */
export function suggestedSettlementThreshold(p: PaymentProviderInfo | null | undefined, accountType: PayoutAccountType | null): number {
  if (p && accountType === 'bank' && p.fees.bank_flat) return Math.ceil(p.fees.bank_flat / 0.02 / 10_000) * 10_000;
  return 50_000;
}
