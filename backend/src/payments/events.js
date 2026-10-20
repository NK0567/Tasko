// Découple les fournisseurs de paiement (mock/notchpay) du service métier qui traite les résultats.
let paymentHandler = null;
let payoutHandler = null;

/** Encaissements (escrow_in, subscription, boost) : fn({provider, external_ref, reference, status}) */
export function onPaymentResult(fn) {
  paymentHandler = fn;
}
export async function reportPaymentResult(result) {
  if (!paymentHandler) throw new Error('Aucun gestionnaire de résultat de paiement enregistré');
  return paymentHandler(result);
}

/** Versements sortants (payout, refund, withdrawal, revenue_withdrawal…) : fn({provider, external_ref, reference, status, reason}) */
export function onPayoutResult(fn) {
  payoutHandler = fn;
}
export async function reportPayoutResult(result) {
  if (!payoutHandler) throw new Error('Aucun gestionnaire de résultat de versement enregistré');
  return payoutHandler(result);
}
