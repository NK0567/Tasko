import { z } from './validate.js';

/** Normalise un numéro camerounais en +237XXXXXXXXX (9 chiffres commençant par 6 ou 2). Retourne null si invalide. */
export function normalizePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let digits = String(input).replace(/[^\d]/g, '');
  if (digits.startsWith('00237')) digits = digits.slice(5);
  else if (digits.startsWith('237') && digits.length === 12) digits = digits.slice(3);
  if (!/^[62]\d{8}$/.test(digits)) return null;
  return `+237${digits}`;
}

export const phoneSchema = () =>
  z.string({ error: 'Numéro de téléphone requis' }).transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Numéro invalide : 9 chiffres commençant par 6 ou 2 (ex. 690000001)' });
      return z.NEVER;
    }
    return p;
  });
