// RG-G8 — anti-contournement : masque les numéros de téléphone écrits dans le chat tant que les fonds ne sont pas sécurisés.
export const MASKED_PHONE = '6•• •• •• •• — visible après paiement sécurisé';

// +237 / 00237 / 237 optionnel, puis 9 chiffres commençant par 6 ou 2, séparateurs espace . - autorisés.
const PHONE_RE = /(?:(?:\+|00)\s?237[\s.-]?|\b237[\s.-]?)?\b[62](?:[\s.-]?\d){8}\b/g;

export function maskPhones(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(PHONE_RE, MASKED_PHONE);
}
