import bcrypt from 'bcryptjs';
import { many, one, withTransaction } from '../../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { encrypt, last4, maskTail } from '../../utils/crypto.js';
import { getPaymentProvider, resolvePayoutProviderName, resolveProviderName } from '../../payments/index.js';
import { getSettings } from '../settings/service.js';
import { executeOutgoing } from '../payments/service.js';
import { audit } from '../audit/service.js';
import { notifyAdmins } from '../notifications/service.js';

const TZ = 'Africa/Douala';
/** Clé du verrou consultatif de trésorerie (sérialise les retraits admin). */
const TREASURY_LOCK = 7_250_001;

/**
 * Grand livre (calculé à partir des transactions et de l'état des séquestres) :
 * - escrow_held : fonds bloqués des missions / jalons en cours (intouchables) ;
 * - providers_available : fonds libérés non encore versés aux prestataires (payout/frais d'annulation pending ou failed − retraits réussis) ;
 * - revenue_total : commissions (frais de service + commissions prestataires) + abonnements + boosts (aucune remise appliquée à ce jour) ;
 * - revenue_available = revenue_total − retraits réussis − retraits en cours.
 */
export async function treasurySummary(client) {
  const r = await one(
    `WITH m AS (SELECT date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}' AS month)
     SELECT
       coalesce((SELECT sum(j.total) FROM jobs j WHERE j.payment_status = 'held'
                  AND NOT EXISTS (SELECT 1 FROM job_milestones x WHERE x.job_id = j.id)), 0)
       + coalesce((SELECT sum(total) FROM job_milestones WHERE status IN ('funded', 'submitted', 'disputed')), 0) AS escrow_held,
       coalesce((SELECT sum(amount) FROM transactions WHERE type IN ('payout', 'cancellation_fee') AND status IN ('pending', 'failed')), 0)
       - coalesce((SELECT sum(amount) FROM transactions WHERE type = 'withdrawal' AND status = 'success'), 0) AS providers_available,
       coalesce((SELECT sum(coalesce((meta->>'service_fee')::int, amount)) FROM transactions
                  WHERE type = 'commission' AND status = 'success' AND coalesce(meta->>'kind', 'job') = 'job'), 0) AS service_fees,
       coalesce((SELECT sum(coalesce((meta->>'provider_commission')::int, 0)) FROM transactions
                  WHERE type = 'commission' AND status = 'success' AND coalesce(meta->>'kind', 'job') = 'job'), 0)
       + coalesce((SELECT sum(amount) FROM transactions WHERE type = 'commission' AND status = 'success' AND meta->>'kind' = 'split'), 0) AS commissions,
       coalesce((SELECT sum(amount) FROM transactions WHERE type = 'commission' AND status = 'success' AND meta->>'kind' = 'cancellation_fee'), 0) AS cancellation_fees_kept,
       coalesce((SELECT sum(amount) FROM transactions WHERE type = 'subscription' AND status = 'success'), 0) AS subscriptions,
       coalesce((SELECT sum(amount) FROM transactions WHERE type = 'boost' AND status = 'success'), 0) AS boosts,
       coalesce((SELECT sum(amount) FROM transactions, m WHERE type IN ('commission', 'subscription', 'boost') AND status = 'success' AND created_at >= m.month), 0) AS revenue_month,
       coalesce((SELECT sum(amount + fee) FROM admin_withdrawals WHERE status = 'success'), 0) AS revenue_withdrawn,
       coalesce((SELECT sum(amount + fee) FROM admin_withdrawals WHERE status = 'pending'), 0) AS revenue_pending_withdrawal`,
    [],
    client,
  );
  const revenue_total = r.service_fees + r.commissions + r.cancellation_fees_kept + r.subscriptions + r.boosts;
  return {
    escrow_held: r.escrow_held,
    providers_available: Math.max(0, r.providers_available),
    revenue_total,
    revenue_withdrawn: r.revenue_withdrawn,
    revenue_pending_withdrawal: r.revenue_pending_withdrawal,
    revenue_available: revenue_total - r.revenue_withdrawn - r.revenue_pending_withdrawal,
    revenue_month: r.revenue_month,
    breakdown: {
      service_fees: r.service_fees,
      commissions: r.commissions,
      subscriptions: r.subscriptions,
      boosts: r.boosts,
      cancellation_fees_kept: r.cancellation_fees_kept,
    },
  };
}

export async function getTreasury() {
  const settings = await getSettings();
  const summary = await treasurySummary();
  const collect_provider = resolveProviderName(settings);
  const payout_provider = resolvePayoutProviderName(settings);
  // Solde chez chaque agrégateur utilisé (encaissement et versement peuvent être deux comptes différents).
  const names = [...new Set([collect_provider, payout_provider])];
  const aggregator_balances = await Promise.all(
    names.map(async (provider) => ({ provider, balance: (await getPaymentProvider(provider).balance().catch(() => null)) ?? null })),
  );
  const known = aggregator_balances.filter((b) => b.balance !== null);
  const aggregator_balance = known.length ? known.reduce((s, b) => s + b.balance, 0) : null;
  return { ...summary, aggregator_balance, aggregator_balances, collect_provider, payout_provider };
}

/** Frais facturés par l'agrégateur de versement pour un retrait admin vers ce type de compte. */
export function withdrawalFee(settings, amount, accountType) {
  const provider = getPaymentProvider(resolvePayoutProviderName(settings));
  const destination = accountType === 'bank' ? 'bank' : 'momo';
  return Math.max(0, Math.round(provider.transferFee(amount, 'revenue_withdrawal', { destination }) || 0));
}

/** Refus clair si l'agrégateur de versement ne sait pas servir ce type de compte (ex. banque avec Campay). */
function assertPayoutSupported(settings, accountType) {
  const provider = getPaymentProvider(resolvePayoutProviderName(settings));
  if (accountType === 'bank' && !provider.meta.supports.payout_bank) {
    const msg = provider.meta.id === 'campay'
      ? 'Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay'
      : `${provider.meta.name} ne permet pas le virement bancaire automatique`;
    throw badRequest(msg, { payout_account_id: 'Virement bancaire non supporté par le fournisseur' });
  }
  if (accountType !== 'bank' && !provider.meta.supports.payout_momo) {
    throw badRequest(`${provider.meta.name} ne propose pas de versement automatique dans cette intégration`, { payout_account_id: 'Versement non supporté par le fournisseur' });
  }
}

export async function ledger(days) {
  return many(
    `WITH d AS (
       SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - ($1::int - 1), (now() AT TIME ZONE '${TZ}')::date, interval '1 day')::date AS day
     ), t AS (
       SELECT (created_at AT TIME ZONE '${TZ}')::date AS day, type, amount FROM transactions
        WHERE status = 'success' AND created_at >= now() - make_interval(days => $1::int + 1)
     ), w AS (
       SELECT (coalesce(completed_at, created_at) AT TIME ZONE '${TZ}')::date AS day, amount + fee AS amount FROM admin_withdrawals
        WHERE status = 'success' AND created_at >= now() - make_interval(days => $1::int + 1)
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
       coalesce((SELECT sum(amount) FROM t WHERE t.day = d.day AND t.type = 'escrow_in'), 0)::int AS escrow_in,
       coalesce((SELECT sum(amount) FROM t WHERE t.day = d.day AND t.type IN ('payout', 'cancellation_fee', 'withdrawal')), 0)::int AS payouts,
       coalesce((SELECT sum(amount) FROM t WHERE t.day = d.day AND t.type IN ('refund', 'partial_refund')), 0)::int AS refunds,
       coalesce((SELECT sum(amount) FROM t WHERE t.day = d.day AND t.type IN ('commission', 'subscription', 'boost')), 0)::int AS revenue,
       coalesce((SELECT sum(amount) FROM w WHERE w.day = d.day), 0)::int AS withdrawals
     FROM d ORDER BY d.day`,
    [days],
  );
}

// ------------------------------------------------------------------ comptes de versement (chiffrés au repos)
export function serializePayoutAccount(a) {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    bank_name: a.bank_name,
    account_holder: a.account_holder,
    account_number_masked: maskTail(a.account_number_last4),
    phone_masked: maskTail(a.phone_last4),
    is_default: a.is_default,
    created_at: a.created_at,
  };
}

export async function listPayoutAccounts() {
  const rows = await many('SELECT * FROM payout_accounts WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at');
  return rows.map(serializePayoutAccount);
}

export async function createPayoutAccount(admin, b, ip) {
  if (b.type === 'bank' && !b.account_number) throw badRequest('Numéro de compte requis', { account_number: 'Requis' });
  if (b.type === 'bank' && !b.bank_name) throw badRequest('Nom de la banque requis', { bank_name: 'Requis' });
  if (b.type !== 'bank' && !b.phone) throw badRequest('Numéro Mobile Money requis', { phone: 'Requis' });
  const row = await withTransaction(async (client) => {
    const { n } = await one('SELECT count(*)::int AS n FROM payout_accounts WHERE deleted_at IS NULL', [], client);
    const makeDefault = b.is_default || n === 0;
    if (makeDefault) await client.query('UPDATE payout_accounts SET is_default = false WHERE is_default');
    const a = await one(
      `INSERT INTO payout_accounts (type, label, bank_name, account_holder, account_number_enc, account_number_last4, phone_enc, phone_last4, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [b.type, b.label, b.type === 'bank' ? b.bank_name : null, b.account_holder ?? null,
        b.type === 'bank' ? encrypt(b.account_number) : null, b.type === 'bank' ? last4(b.account_number) : null,
        b.type !== 'bank' ? encrypt(b.phone) : null, b.type !== 'bank' ? last4(b.phone) : null, makeDefault, admin.id],
      client,
    );
    await audit({ actorId: admin.id, action: 'payout_account.create', target: `payout_account:${a.id}`, details: { type: a.type, label: a.label, last4: a.account_number_last4 || a.phone_last4 }, ip }, client);
    return a;
  });
  return serializePayoutAccount(row);
}

export async function updatePayoutAccount(admin, id, b, ip) {
  const row = await withTransaction(async (client) => {
    const cur = await one('SELECT * FROM payout_accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id], client);
    if (!cur) throw notFound('Compte de versement introuvable');
    if (b.is_default) await client.query('UPDATE payout_accounts SET is_default = false WHERE is_default AND id <> $1', [id]);
    const a = await one(
      `UPDATE payout_accounts SET label = coalesce($2, label), bank_name = coalesce($3, bank_name), account_holder = coalesce($4, account_holder),
              account_number_enc = coalesce($5, account_number_enc), account_number_last4 = coalesce($6, account_number_last4),
              phone_enc = coalesce($7, phone_enc), phone_last4 = coalesce($8, phone_last4),
              is_default = coalesce($9, is_default), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, b.label ?? null, b.bank_name ?? null, b.account_holder ?? null,
        cur.type === 'bank' && b.account_number ? encrypt(b.account_number) : null, cur.type === 'bank' && b.account_number ? last4(b.account_number) : null,
        cur.type !== 'bank' && b.phone ? encrypt(b.phone) : null, cur.type !== 'bank' && b.phone ? last4(b.phone) : null, b.is_default ?? null],
      client,
    );
    await audit({ actorId: admin.id, action: 'payout_account.update', target: `payout_account:${id}`, details: { fields: Object.keys(b).filter((k) => !['account_number', 'phone'].includes(k)), number_changed: !!(b.account_number || b.phone) }, ip }, client);
    return a;
  });
  return serializePayoutAccount(row);
}

export async function deletePayoutAccount(admin, id, ip) {
  await withTransaction(async (client) => {
    const a = await one('UPDATE payout_accounts SET deleted_at = now(), is_default = false WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id], client);
    if (!a) throw notFound('Compte de versement introuvable');
    await audit({ actorId: admin.id, action: 'payout_account.delete', target: `payout_account:${id}`, ip }, client);
  });
  return { ok: true };
}

// ------------------------------------------------------------------ retraits de revenus
const WITHDRAWAL_SELECT = `
  SELECT w.*, pa.type AS pa_type, pa.label AS pa_label, pa.bank_name AS pa_bank_name, pa.account_holder AS pa_holder,
         pa.account_number_last4 AS pa_acc4, pa.phone_last4 AS pa_phone4, pa.is_default AS pa_default, pa.created_at AS pa_created,
         u.full_name AS requested_by_name
    FROM admin_withdrawals w
    JOIN payout_accounts pa ON pa.id = w.payout_account_id
    LEFT JOIN users u ON u.id = w.requested_by`;

export function serializeWithdrawal(w) {
  return {
    id: w.id,
    amount: w.amount,
    fee: w.fee,
    payout_account: serializePayoutAccount({
      id: w.payout_account_id, type: w.pa_type, label: w.pa_label, bank_name: w.pa_bank_name, account_holder: w.pa_holder,
      account_number_last4: w.pa_acc4, phone_last4: w.pa_phone4, is_default: w.pa_default, created_at: w.pa_created,
    }),
    status: w.status,
    external_ref: w.external_ref,
    requested_by: w.requested_by ? { id: w.requested_by, full_name: w.requested_by_name } : null,
    is_auto: w.is_auto,
    created_at: w.created_at,
    completed_at: w.completed_at,
    failure_reason: w.failure_reason,
  };
}

export async function listWithdrawals({ page, limit }) {
  const [rows, total] = await Promise.all([
    many(`${WITHDRAWAL_SELECT} ORDER BY w.created_at DESC LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit]),
    one('SELECT count(*)::int AS n FROM admin_withdrawals'),
  ]);
  return { items: rows.map(serializeWithdrawal), total: total.n, page, limit };
}

/**
 * Retrait de revenus vers un compte de versement. Ne peut JAMAIS dépasser revenue_available :
 * contrôle sous verrou consultatif transactionnel (sérialise tous les retraits). Admin : mot de passe re-saisi.
 */
export async function createWithdrawal({ admin = null, amount, payout_account_id, password, ip = null, auto = false }) {
  if (admin) {
    const u = await one('SELECT password_hash FROM users WHERE id = $1', [admin.id]);
    const ok = u && password && (await bcrypt.compare(password, u.password_hash));
    if (!ok) {
      await audit({ actorId: admin.id, action: 'treasury.withdrawal_denied', target: 'treasury', details: { amount }, ip });
      throw unauthorized('Mot de passe incorrect');
    }
  }
  const settings = await getSettings();
  const providerName = resolvePayoutProviderName(settings);
  const { withdrawalId, txId } = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [TREASURY_LOCK]);
    const acc = await one('SELECT * FROM payout_accounts WHERE id = $1 AND deleted_at IS NULL', [payout_account_id], client);
    if (!acc) throw notFound('Compte de versement introuvable');
    assertPayoutSupported(settings, acc.type);
    const fee = withdrawalFee(settings, amount, acc.type);
    const { revenue_available } = await treasurySummary(client);
    if (amount + fee > revenue_available) {
      throw conflict(`Montant supérieur au revenu disponible (${revenue_available} FCFA)`, { revenue_available, fee });
    }
    const t = await one(
      `INSERT INTO transactions (user_id, type, amount, method, phone, provider, status, meta)
       VALUES ($1, 'revenue_withdrawal', $2, $3, NULL, $4, 'pending', $5::jsonb) RETURNING id`,
      [admin?.id ?? null, amount, acc.type === 'bank' ? 'bank' : acc.type, providerName, JSON.stringify({ payout_account_id: acc.id, fee, auto })],
      client,
    );
    const w = await one(
      `INSERT INTO admin_withdrawals (amount, fee, payout_account_id, requested_by, is_auto, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [amount, fee, acc.id, admin?.id ?? null, auto, t.id],
      client,
    );
    await client.query(`UPDATE transactions SET meta = meta || jsonb_build_object('withdrawal_id', $2::text) WHERE id = $1`, [t.id, w.id]);
    await audit({
      actorId: admin?.id ?? null, action: auto ? 'treasury.auto_settlement' : 'treasury.withdrawal',
      target: `withdrawal:${w.id}`, details: { amount, fee, payout_account: acc.label, revenue_available_before: revenue_available }, ip,
    }, client);
    return { withdrawalId: w.id, txId: t.id };
  });
  await executeOutgoing(txId);
  return serializeWithdrawal(await one(`${WITHDRAWAL_SELECT} WHERE w.id = $1`, [withdrawalId]));
}

/** Planificateur : reversement automatique (quotidien / hebdomadaire) au-delà de `auto_settlement_min`. */
export async function autoSettlement(now) {
  const settings = await getSettings();
  if (!['daily', 'weekly'].includes(settings.auto_settlement)) return 0;
  const period = settings.auto_settlement === 'weekly' ? 7 : 1;
  const last = await one(`SELECT max(created_at) AS at FROM admin_withdrawals WHERE is_auto`);
  if (last?.at && new Date(now).getTime() - new Date(last.at).getTime() < period * 86400e3) return 0;
  const acc = await one('SELECT id, type FROM payout_accounts WHERE is_default AND deleted_at IS NULL');
  if (!acc) return 0;
  const { revenue_available } = await treasurySummary();
  const fee = withdrawalFee(settings, revenue_available, acc.type);
  const amount = revenue_available - fee;
  if (amount < Number(settings.auto_settlement_min || 0) || amount <= 0) return 0;
  try {
    await createWithdrawal({ amount, payout_account_id: acc.id, auto: true });
    return 1;
  } catch (err) {
    await notifyAdmins({ type: 'system', title: 'Reversement automatique échoué', body: err.message, data: {} });
    return 0;
  }
}
