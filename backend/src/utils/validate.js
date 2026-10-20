import { z } from 'zod';

// Messages de validation zod en français
z.config(z.locales.fr());

export { z };

/** Plafond des montants (FCFA) : reste largement sous la limite des colonnes integer PostgreSQL. */
export const MAX_AMOUNT = 500_000_000;

export const uuid = () => z.uuid({ error: 'Identifiant invalide' });
export const lat = () => z.coerce.number({ error: 'Latitude invalide' }).min(-90, 'Latitude invalide').max(90, 'Latitude invalide');
export const lng = () => z.coerce.number({ error: 'Longitude invalide' }).min(-180, 'Longitude invalide').max(180, 'Longitude invalide');

/**
 * Montant entier en FCFA. Accepte un nombre ou une chaîne de chiffres (query string) ;
 * refuse null / booléens / chaînes vides (z.coerce les aurait convertis en 0 ou 1).
 */
export const amount = (min = 0, minMessage = 'Montant invalide', max = MAX_AMOUNT) =>
  z
    .union([z.number({ error: 'Montant invalide' }), z.string().trim().regex(/^\d+$/, 'Montant invalide').transform(Number)], {
      error: 'Montant invalide',
    })
    .pipe(
      z
        .number({ error: 'Montant invalide' })
        .int('Le montant doit être un entier en FCFA')
        .min(min, minMessage)
        .max(max, 'Montant trop élevé'),
    );

export const paymentMethod = () =>
  z.enum(['mtn_momo', 'orange_money', 'card'], { error: 'Moyen de paiement invalide (mtn_momo, orange_money, card)' });
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const boolString = () =>
  z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');

/**
 * Référence de fichier : chemin renvoyé par POST /uploads (`/uploads/<uuid>.<ext>`) ou URL https.
 * Interdit `javascript:`, `data:`, chemins relatifs arbitraires, etc.
 */
export const fileRef = () =>
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^\/uploads\/[A-Za-z0-9._-]+$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v), {
      message: 'Fichier invalide (utilisez l\'URL renvoyée par /uploads)',
    });
export const fileList = (max = 10) => z.array(fileRef()).max(max, `${max} fichiers maximum`);

export const isoDate = () => z.iso.datetime({ offset: true, error: 'Date ISO 8601 attendue' });

/** Parse et lève une ZodError (transformée en VALIDATION_ERROR par le middleware d'erreurs). */
export const parse = (schema, data) => schema.parse(data ?? {});
