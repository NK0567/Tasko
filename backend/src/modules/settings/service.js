import { many, query } from '../../db.js';
import { z } from '../../utils/validate.js';

export const DEFAULT_SETTINGS = Object.freeze({
  client_fee_rate: 0.05,
  provider_commission_rate: 0,
  min_service_fee: 100,
  search_radius_km: 10,
  avg_speed_kmh: 20,
  pro_plan_price: 3000,
  boost_day_price: 500,
  boost_month_price: 5000,
  currency: 'XAF',
  otp_dev_mode: true,
  payment_provider: 'mock',
  // Fournisseur des versements (prestataires, retraits) : `same` = celui des encaissements.
  payout_provider: 'same',
  support_phone: '+237600000000',
  // V2 — garantie de paiement, appels d'offres, trésorerie
  auto_release_hours: 48,
  require_start_code: true,
  require_completion_proof: false,
  cancellation_fee_en_route: 1000,
  dispute_response_hours: 48,
  mask_contacts_until_funded: true,
  tender_default_days: 7,
  max_bids_per_tender: 30,
  auto_payout: true,
  auto_settlement: 'off',
  auto_settlement_min: 50000,
  // §5.9 — médiation, prestataire absent
  no_show_hours: 3,
  no_show_grace_hours: 2,
  no_show_response_hours: 12,
  dispute_decision_hours: 72,
  four_eyes_threshold: 100000,
  suspension_threshold: 3,
});

export const settingsSchema = z
  .object({
    client_fee_rate: z.number().min(0).max(1),
    provider_commission_rate: z.number().min(0).max(1),
    min_service_fee: z.number().int().min(0).max(1_000_000),
    search_radius_km: z.number().positive().max(200),
    avg_speed_kmh: z.number().positive().max(200),
    pro_plan_price: z.number().int().min(0).max(10_000_000),
    boost_day_price: z.number().int().min(0).max(10_000_000),
    boost_month_price: z.number().int().min(0).max(10_000_000),
    currency: z.string().min(3).max(3),
    otp_dev_mode: z.boolean(),
    payment_provider: z.enum(['mock', 'notchpay', 'campay', 'monetbil']),
    payout_provider: z.enum(['same', 'mock', 'notchpay', 'campay', 'monetbil']),
    support_phone: z.string().min(6).max(20),
    auto_release_hours: z.number().int().min(1).max(24 * 30),
    require_start_code: z.boolean(),
    require_completion_proof: z.boolean(),
    cancellation_fee_en_route: z.number().int().min(0).max(1_000_000),
    dispute_response_hours: z.number().int().min(1).max(24 * 30),
    mask_contacts_until_funded: z.boolean(),
    tender_default_days: z.number().int().min(1).max(90),
    max_bids_per_tender: z.number().int().min(1).max(500),
    auto_payout: z.boolean(),
    auto_settlement: z.enum(['off', 'daily', 'weekly']),
    auto_settlement_min: z.number().int().min(0).max(1_000_000_000),
    no_show_hours: z.number().int().min(1).max(72),
    no_show_grace_hours: z.number().int().min(0).max(72),
    no_show_response_hours: z.number().int().min(1).max(168),
    dispute_decision_hours: z.number().int().min(1).max(24 * 30),
    four_eyes_threshold: z.number().int().min(0).max(1_000_000_000),
    suspension_threshold: z.number().int().min(1).max(100),
  })
  .partial()
  .strict();

export async function getSettings(client) {
  const rows = await many('SELECT key, value FROM settings', [], client);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out;
}

export async function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  return getSettings();
}

export async function ensureDefaultSettings(client) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await (client || { query }).query(
      'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING',
      [key, JSON.stringify(value)],
    );
  }
}

/** Sous-ensemble exposé publiquement (GET /settings/public). */
export function publicSettings(s) {
  return {
    client_fee_rate: s.client_fee_rate,
    provider_commission_rate: s.provider_commission_rate,
    min_service_fee: s.min_service_fee,
    currency: s.currency,
    search_radius_km: s.search_radius_km,
    auto_release_hours: s.auto_release_hours,
    require_start_code: s.require_start_code,
    require_completion_proof: s.require_completion_proof,
    cancellation_fee_en_route: s.cancellation_fee_en_route,
    pro_plan_price: s.pro_plan_price,
    boost_day_price: s.boost_day_price,
    boost_month_price: s.boost_month_price,
    support_phone: s.support_phone,
    no_show_hours: s.no_show_hours,
    no_show_grace_hours: s.no_show_grace_hours,
    no_show_response_hours: s.no_show_response_hours,
    dispute_decision_hours: s.dispute_decision_hours,
  };
}

/**
 * Tarification (contrat §Tarification) — arithmétique entière en FCFA :
 * service_fee = max(min_service_fee, round(price × client_fee_rate)) ; provider_commission = round(price × provider_commission_rate)
 * total = price + service_fee ; provider_payout = price − provider_commission
 */
export function computeQuote(price, settings) {
  const p = Math.max(0, Math.round(Number(price) || 0));
  const service_fee = p === 0 ? 0 : Math.max(Number(settings.min_service_fee) || 0, Math.round(p * Number(settings.client_fee_rate || 0)));
  const provider_commission = Math.min(p, Math.round(p * Number(settings.provider_commission_rate || 0)));
  return {
    price: p,
    service_fee,
    total: p + service_fee,
    provider_commission,
    provider_payout: p - provider_commission,
  };
}

/** Commission Tasko sur un montant versé au prestataire hors tarification standard (frais d'annulation, split). */
export const commissionOn = (amount, settings) => Math.min(amount, Math.round(amount * Number(settings.provider_commission_rate || 0)));
