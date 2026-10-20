import crypto from 'node:crypto';
import { many, one, withTransaction } from '../../db.js';
import {
  getPaymentProvider, getProviderStrict, operatorFromMethod, resolvePayoutProviderName, resolveProviderName, resolveRefundProviderName,
} from '../../payments/index.js';
import { onPaymentResult, onPayoutResult } from '../../payments/events.js';
import { badRequest, conflict, forbidden, invalidState, notFound, paymentFailed } from '../../utils/errors.js';
import { decrypt } from '../../utils/crypto.js';
import { commissionOn, getSettings } from '../settings/service.js';
import { notify, notifyAdmins } from '../notifications/service.js';
import { emitJobUpdated, FUNDED_STATUSES } from '../jobs/repo.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fmt = (n) => `${Number(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
/** Un encaissement resté `pending` plus longtemps est considéré abandonné (un nouveau peut être lancé). */
const PENDING_COLLECTION_TTL_MS = 30 * 60 * 1000;

export const newStartCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

export function serializeTransaction(t) {
  return {
    id: t.id,
    job_id: t.job_id,
    milestone_id: t.milestone_id ?? null,
    user_id: t.user_id,
    type: t.type,
    amount: t.amount,
    method: t.method,
    phone: t.phone,
    provider: t.provider,
    external_ref: t.external_ref,
    status: t.status,
    created_at: t.created_at,
    ...(t.user_name !== undefined ? { user_name: t.user_name } : {}),
  };
}

/** GET /transactions/:id — uniquement le titulaire de la transaction (ou un admin). */
export async function getTransaction(id, user) {
  const t = await one('SELECT * FROM transactions WHERE id = $1', [id]);
  if (!t) throw notFound('Transaction introuvable');
  if (!user.is_admin && t.user_id !== user.id) throw notFound('Transaction introuvable');
  return serializeTransaction(t);
}

// =================================================================== encaissements
async function initiateCollection(tx, { method, phone }) {
  const provider = getPaymentProvider(tx.provider);
  try {
    const r = await provider.initiate({ amount: tx.amount, phone, method, reference: tx.id });
    const updated = await one(
      `UPDATE transactions SET external_ref = coalesce(external_ref, $2), meta = meta || $3::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
      [tx.id, r.external_ref, JSON.stringify({ checkout_url: r.checkout_url || null })],
    );
    return { transaction: serializeTransaction(updated), checkout_url: r.checkout_url || null };
  } catch (err) {
    await handlePaymentResult({ provider: tx.provider, reference: tx.id, status: 'failed' });
    throw err.code === 'PAYMENT_FAILED' ? err : paymentFailed('Le paiement n\'a pas pu être initié');
  }
}

/**
 * POST /jobs/:id/pay — client uniquement. Sans jalons : mission `accepted`, montant `total`.
 * Avec jalons : jalon `milestone_id` (ou prochain jalon `pending`), montant `total` du jalon (RG-G1 par jalon).
 * Idempotent : renvoie l'encaissement en cours pour la même cible s'il existe.
 */
export async function payJob(jobId, user, { method, phone, milestone_id }) {
  const settings = await getSettings();
  const providerName = resolveProviderName(settings);
  const res = await withTransaction(async (client) => {
    const job = await one('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId], client);
    if (!job) throw notFound('Mission introuvable');
    if (job.client_id !== user.id) {
      if (job.provider_id === user.id || user.is_admin) throw forbidden('Seul le client de la mission peut payer');
      throw notFound('Mission introuvable');
    }
    const ms = await many('SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY position FOR UPDATE', [jobId], client);
    let target = null;
    let amount;
    if (ms.length) {
      if (!['accepted', ...FUNDED_STATUSES].includes(job.status)) {
        throw invalidState(`Paiement impossible : la mission est « ${job.status} »`);
      }
      target = milestone_id ? ms.find((m) => m.id === milestone_id) : ms.find((m) => m.status === 'pending');
      if (milestone_id && !target) throw notFound('Jalon introuvable');
      if (!target) throw invalidState('Tous les jalons sont déjà payés');
      if (target.status !== 'pending') throw invalidState(`Jalon « ${target.status} » : paiement impossible`);
      amount = target.total;
    } else {
      if (milestone_id) throw badRequest('Cette mission n\'a pas de jalons', { milestone_id: 'Invalide' });
      if (job.status !== 'accepted') throw invalidState(`Paiement impossible : la mission est « ${job.status} » (attendu : accepted)`);
      amount = job.total;
    }
    if (!(amount > 0)) throw invalidState('Montant à payer nul');
    const pending = await one(
      `SELECT * FROM transactions WHERE job_id = $1 AND type = 'escrow_in' AND status = 'pending'
          AND milestone_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1`,
      [jobId, target?.id ?? null],
      client,
    );
    if (pending) {
      if (Date.now() - new Date(pending.created_at).getTime() < PENDING_COLLECTION_TTL_MS) return { existing: pending };
      // Encaissement abandonné : marqué expiré (un succès tardif sera quand même pris en compte, cf. handlePaymentResult)
      await client.query(
        `UPDATE transactions SET status = 'failed', meta = meta || '{"expired": true}'::jsonb, updated_at = now() WHERE id = $1`,
        [pending.id],
      );
    }
    const tx = await one(
      `INSERT INTO transactions (job_id, milestone_id, user_id, type, amount, method, phone, provider, status)
       VALUES ($1, $2, $3, 'escrow_in', $4, $5, $6, $7, 'pending') RETURNING *`,
      [jobId, target?.id ?? null, user.id, amount, method, phone, providerName],
      client,
    );
    if (!ms.length) await client.query(`UPDATE jobs SET payment_status = 'pending', updated_at = now() WHERE id = $1`, [jobId]);
    return { tx };
  });
  if (res.existing) {
    return { transaction: serializeTransaction(res.existing), checkout_url: res.existing.meta?.checkout_url ?? null };
  }
  await emitJobUpdated(jobId);
  return initiateCollection(res.tx, { method, phone });
}

/** Abonnement Pro / mise en avant (boost) : encaissement simple, effet appliqué au succès. */
export async function purchaseProviderService(user, { type, amount, method, phone, meta }) {
  const settings = await getSettings();
  const tx = await one(
    `INSERT INTO transactions (user_id, type, amount, method, phone, provider, status, meta)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb) RETURNING *`,
    [user.id, type, amount, method, phone, resolveProviderName(settings), JSON.stringify(meta || {})],
  );
  return initiateCollection(tx, { method, phone });
}

/** Passe la mission en `funded` : séquestre + code de démarrage (RG-G2). Mission verrouillée par l'appelant. */
async function fundJobInTx(client, job, effects, amount) {
  const code = newStartCode();
  await client.query(
    `UPDATE jobs SET status = 'funded', payment_status = 'held', funded_at = now(), start_code = $2,
            start_code_attempts = 0, updated_at = now() WHERE id = $1`,
    [job.id, code],
  );
  effects.push(() => notify(job.client_id, {
    type: 'payment', title: 'Paiement sécurisé',
    body: `${fmt(amount)} sont bloqués par Tasko. Code de démarrage : ${code} — donnez-le au prestataire à son arrivée, jamais avant.`,
    data: { job_id: job.id },
  }));
  effects.push(() => notify(job.provider_id, {
    type: 'payment', title: 'Fonds sécurisés',
    body: `${fmt(amount)} sécurisés par Tasko pour « ${job.title} » — vous pouvez y aller.`,
    data: { job_id: job.id },
  }));
}

/**
 * Traite le résultat d'un encaissement (mock ou webhook). Idempotent : sans effet si la transaction n'est plus `pending`
 * (exception : succès tardif d'un encaissement marqué expiré). Transition financière atomique, lignes verrouillées.
 */
export async function handlePaymentResult({ provider, external_ref, reference, status }) {
  if (!status) return null;
  const effects = [];
  const tx = await withTransaction(async (client) => {
    let t = null;
    if (reference && UUID_RE.test(reference)) t = await one('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [reference], client);
    if (!t && external_ref) {
      t = await one('SELECT * FROM transactions WHERE provider = $1 AND external_ref = $2 FOR UPDATE', [provider, external_ref], client);
    }
    if (!t || !['escrow_in', 'subscription', 'boost'].includes(t.type)) return null;
    const lateSuccess = t.status === 'failed' && t.meta?.expired && status === 'success';
    if (t.status !== 'pending' && !lateSuccess) return null;
    const updated = await one(
      'UPDATE transactions SET status = $2, external_ref = coalesce(external_ref, $3), updated_at = now() WHERE id = $1 RETURNING *',
      [t.id, status, external_ref || null],
      client,
    );

    if (t.type === 'escrow_in' && t.job_id) {
      const job = await one('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [t.job_id], client);
      const ms = t.milestone_id ? await one('SELECT * FROM job_milestones WHERE id = $1 FOR UPDATE', [t.milestone_id], client) : null;
      if (status === 'success') {
        if (ms) {
          if (ms.status === 'pending' && ['accepted', ...FUNDED_STATUSES].includes(job.status)) {
            await client.query(`UPDATE job_milestones SET status = 'funded', funded_at = now(), updated_at = now() WHERE id = $1`, [ms.id]);
            const { n } = await one('SELECT count(*)::int AS n FROM job_milestones WHERE job_id = $1', [job.id], client);
            if (job.status === 'accepted') await fundJobInTx(client, job, effects, t.amount);
            else {
              await client.query(`UPDATE jobs SET payment_status = 'held', updated_at = now() WHERE id = $1`, [job.id]);
              effects.push(() => notify(job.provider_id, {
                type: 'payment', title: 'Jalon sécurisé',
                body: `Jalon ${ms.position}/${n} : ${fmt(ms.amount)} sécurisés par Tasko — vous pouvez continuer.`,
                data: { job_id: job.id, milestone_id: ms.id },
              }));
            }
          } else {
            const refundId = await refundEscrowInTx(client, updated, job.id);
            if (refundId) effects.push(() => executeOutgoing(refundId));
          }
        } else if (job.status === 'accepted' && job.payment_status !== 'held') {
          await fundJobInTx(client, job, effects, t.amount);
        } else {
          // Paiement arrivé après une annulation (ou en double) : remboursement immédiat.
          const refundId = await refundEscrowInTx(client, updated, job.id);
          if (refundId) effects.push(() => executeOutgoing(refundId));
        }
      } else if (!ms && job.payment_status === 'pending') {
        await client.query(`UPDATE jobs SET payment_status = 'unpaid', updated_at = now() WHERE id = $1`, [job.id]);
      }
      if (status === 'failed') {
        effects.push(() => notify(job.client_id, {
          type: 'payment', title: 'Paiement échoué',
          body: 'Le paiement Mobile Money n\'a pas abouti. Vérifiez votre solde et réessayez.',
          data: { job_id: job.id, transaction_id: t.id },
        }));
      }
      effects.push(() => emitJobUpdated(job.id));
    }

    if (t.type === 'subscription' && status === 'success') {
      await client.query(
        `UPDATE provider_profiles SET plan = 'pro',
           pro_until = greatest(coalesce(pro_until, now()), now()) + interval '30 days', updated_at = now()
         WHERE user_id = $1`,
        [t.user_id],
      );
      effects.push(() => notify(t.user_id, { type: 'payment', title: 'Tasko Pro activé', body: 'Votre abonnement Pro est actif pour 30 jours.', data: { transaction_id: t.id } }));
    }
    if (t.type === 'boost' && status === 'success') {
      const days = t.meta?.duration === 'month' ? 30 : 1;
      await client.query(
        `UPDATE provider_profiles SET featured_until = greatest(coalesce(featured_until, now()), now()) + make_interval(days => $2), updated_at = now()
         WHERE user_id = $1`,
        [t.user_id, days],
      );
      effects.push(() => notify(t.user_id, { type: 'payment', title: 'Profil mis en avant', body: `Votre profil est mis en avant pour ${days === 30 ? '30 jours' : '24 h'}.`, data: { transaction_id: t.id } }));
    }
    if ((t.type === 'subscription' || t.type === 'boost') && status === 'failed') {
      effects.push(() => notify(t.user_id, { type: 'payment', title: 'Paiement échoué', body: 'Le paiement n\'a pas abouti.', data: { transaction_id: t.id } }));
    }
    return updated;
  });
  for (const fx of effects) await fx();
  return tx ? serializeTransaction(tx) : null;
}

onPaymentResult(handlePaymentResult);

// =================================================================== mouvements de séquestre (dans une transaction SQL, lignes verrouillées)
async function providerDestination(client, providerId) {
  const p = await one(
    `SELECT u.phone, pp.momo_number, pp.momo_operator FROM users u LEFT JOIN provider_profiles pp ON pp.user_id = u.id WHERE u.id = $1`,
    [providerId],
    client,
  );
  const operator = p?.momo_operator || 'mtn';
  return { phone: p?.momo_number || p?.phone || null, method: operator === 'orange' ? 'orange_money' : 'mtn_momo' };
}

/** Crédit prestataire (payout / cancellation_fee). auto_payout désactivé : montant crédité au portefeuille (status failed + meta). */
async function insertProviderCredit(client, { job, ms, type, amount, settings, meta = {} }) {
  if (!(amount > 0)) return null;
  const dest = await providerDestination(client, job.provider_id);
  const auto = settings.auto_payout !== false && !!dest.phone;
  const row = await one(
    `INSERT INTO transactions (job_id, milestone_id, user_id, type, amount, method, phone, provider, status, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
    [job.id, ms?.id ?? null, job.provider_id, type, amount, dest.method, dest.phone, resolvePayoutProviderName(settings),
      auto ? 'pending' : 'failed', JSON.stringify(auto ? meta : { ...meta, wallet: 'auto_payout_off' })],
    client,
  );
  return auto ? row.id : null;
}

async function insertCommission(client, { job, ms, amount, settings, meta }) {
  if (!(amount > 0)) return;
  await client.query(
    `INSERT INTO transactions (job_id, milestone_id, user_id, type, amount, provider, status, meta)
     VALUES ($1, $2, $3, 'commission', $4, $5, 'success', $6::jsonb)`,
    [job.id, ms?.id ?? null, job.provider_id, amount, resolveProviderName(settings), JSON.stringify(meta)],
  );
}

/**
 * Libère une unité de séquestre (mission sans jalons, ou un jalon) : payout prestataire + commission Tasko.
 * Retourne l'id du payout à exécuter après COMMIT (ou null). L'index unique empêche toute double libération (RG-G9).
 */
export async function releaseUnitInTx(client, job, ms, settings) {
  const unit = ms || job;
  const payoutId = await insertProviderCredit(client, { job, ms, type: 'payout', amount: unit.provider_payout, settings });
  await insertCommission(client, {
    job, ms, amount: unit.service_fee + unit.provider_commission, settings,
    meta: { kind: 'job', service_fee: unit.service_fee, provider_commission: unit.provider_commission },
  });
  return payoutId;
}

async function escrowFor(client, jobId, msId) {
  return one(
    `SELECT * FROM transactions WHERE job_id = $1 AND type = 'escrow_in' AND status = 'success'
        AND milestone_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1`,
    [jobId, msId ?? null],
    client,
  );
}

/** Remboursement (intégral ou partiel) d'une unité de séquestre au client. */
export async function refundUnitInTx(client, job, ms, { amount, type = 'refund' } = {}) {
  const unit = ms || job;
  const escrow = await escrowFor(client, job.id, ms?.id);
  const value = amount ?? unit.total;
  if (!(value > 0)) return null;
  const settings = await getSettings(client);
  const r = await one(
    `INSERT INTO transactions (job_id, milestone_id, user_id, type, amount, method, phone, provider, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
    [job.id, ms?.id ?? null, job.client_id, type, value, escrow?.method || 'mtn_momo', escrow?.phone || null,
      resolveRefundProviderName(settings, escrow?.provider || resolveProviderName(settings))],
    client,
  );
  return r.id;
}

/** Remboursement d'un encaissement orphelin (paiement arrivé après annulation, ou en double). */
async function refundEscrowInTx(client, escrow, jobId) {
  const settings = await getSettings(client);
  const r = await one(
    `INSERT INTO transactions (job_id, user_id, type, amount, method, phone, provider, status, meta)
     VALUES (NULL, $1, 'refund', $2, $3, $4, $5, 'pending', $6::jsonb) RETURNING id`,
    [escrow.user_id, escrow.amount, escrow.method, escrow.phone, resolveRefundProviderName(settings, escrow.provider),
      JSON.stringify({ orphan_job_id: jobId, escrow_id: escrow.id })],
    client,
  );
  return r.id;
}

/** RG-G5 — annulation client en `en_route` : frais de déplacement au prestataire, reste remboursé. */
export async function cancellationFeeInTx(client, job, ms, fee, settings) {
  const unit = ms || job;
  const commission = commissionOn(fee, settings);
  const payoutId = await insertProviderCredit(client, { job, ms, type: 'cancellation_fee', amount: fee - commission, settings, meta: { gross: fee } });
  await insertCommission(client, { job, ms, amount: commission, settings, meta: { kind: 'cancellation_fee', gross: fee } });
  const refundId = await refundUnitInTx(client, job, ms, { amount: unit.total - fee, type: 'partial_refund' });
  return [payoutId, refundId];
}

/** RG-G6 — résolution `split` : provider_amount (brut, moins commission) au prestataire, le reste remboursé au client. */
export async function splitInTx(client, job, ms, providerAmount, settings) {
  const unit = ms || job;
  const commission = commissionOn(providerAmount, settings);
  const payoutId = await insertProviderCredit(client, { job, ms, type: 'payout', amount: providerAmount - commission, settings, meta: { split: true, gross: providerAmount } });
  await insertCommission(client, { job, ms, amount: commission, settings, meta: { kind: 'split', gross: providerAmount } });
  const refundId = await refundUnitInTx(client, job, ms, { amount: unit.total - providerAmount, type: 'partial_refund' });
  return [payoutId, refundId];
}

// =================================================================== versements sortants
const OUTGOING_TYPES = ['payout', 'cancellation_fee', 'refund', 'partial_refund', 'withdrawal', 'revenue_withdrawal'];

/** Exécute un versement sortant via le fournisseur, après COMMIT. Le résultat peut arriver plus tard (mock : ~3 s). */
export async function executeOutgoing(txId) {
  if (!txId) return;
  const t = await one('SELECT * FROM transactions WHERE id = $1', [txId]);
  if (!t || t.status !== 'pending' || !OUTGOING_TYPES.includes(t.type)) return;
  try {
    let dest = { phone: t.phone, operator: operatorFromMethod(t.method), bank: null };
    if (t.type === 'revenue_withdrawal') {
      const acc = await one(
        `SELECT pa.* FROM admin_withdrawals w JOIN payout_accounts pa ON pa.id = w.payout_account_id WHERE w.transaction_id = $1`,
        [t.id],
      );
      if (!acc) throw new Error('Compte de versement introuvable');
      dest = acc.type === 'bank'
        ? { phone: null, operator: null, bank: { bank_name: acc.bank_name, account_holder: acc.account_holder, account_number: decrypt(acc.account_number_enc) } }
        : { phone: decrypt(acc.phone_enc), operator: acc.type === 'orange_money' ? 'orange' : 'mtn', bank: null };
    }
    if (!dest.phone && !dest.bank) throw new Error('Destinataire du versement inconnu');
    const r = await getPaymentProvider(t.provider).payout({ amount: t.amount, ...dest, reference: t.id });
    if (r.external_ref) {
      await one(`UPDATE transactions SET external_ref = coalesce(external_ref, $2), updated_at = now() WHERE id = $1 RETURNING id`, [t.id, r.external_ref]);
      if (t.type === 'revenue_withdrawal') await one('UPDATE admin_withdrawals SET external_ref = $2 WHERE transaction_id = $1 RETURNING id', [t.id, r.external_ref]);
    }
    if (r.status === 'success' || r.status === 'failed') await applyOutgoingResult({ txId: t.id, status: r.status, external_ref: r.external_ref });
  } catch (err) {
    console.error('[versement]', t.id, err.message);
    if (err.code === 'PAYOUT_UNSUPPORTED') {
      // Fournisseur sans versement automatique (ex. Monetbil) : échec propre (crédit portefeuille pour un prestataire) + alerte admin.
      await applyOutgoingResult({ txId: t.id, status: 'failed', reason: err.message });
      await notifyAdmins({
        type: 'system', title: 'Versement non effectué',
        body: `${fmt(t.amount)} (${t.type}) : ${err.message}. Choisissez un « Fournisseur pour les versements » qui le permet (Paramètres).`,
        data: { transaction_id: t.id, job_id: t.job_id },
      });
      return;
    }
    await applyOutgoingResult({ txId: t.id, status: 'failed', reason: 'Le fournisseur a refusé le versement' });
  }
}

/** Applique le résultat d'un versement (idempotent : sans effet si la transaction n'est plus `pending`). */
export async function applyOutgoingResult({ txId, status, external_ref = null, reason = null }) {
  if (!['success', 'failed'].includes(status)) return null;
  const t = await withTransaction(async (client) => {
    const row = await one('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [txId], client);
    if (!row || row.status !== 'pending' || !OUTGOING_TYPES.includes(row.type)) return null;
    const meta = reason ? { failure_reason: reason, retries: (row.meta?.retries || 0) } : {};
    const updated = await one(
      `UPDATE transactions SET status = $2, external_ref = coalesce(external_ref, $3), meta = meta || $4::jsonb, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [txId, status, external_ref, JSON.stringify(meta)],
      client,
    );
    if (row.type === 'revenue_withdrawal') {
      await client.query(
        `UPDATE admin_withdrawals SET status = $2, external_ref = coalesce(external_ref, $3),
                completed_at = CASE WHEN $2 = 'success' THEN now() ELSE completed_at END, failure_reason = $4
          WHERE transaction_id = $1`,
        [txId, status, external_ref, status === 'failed' ? reason || 'Échec du versement' : null],
      );
    }
    return updated;
  });
  if (!t) return null;
  const ok = status === 'success';
  const amount = fmt(t.amount);
  const data = { job_id: t.job_id, transaction_id: t.id };
  if (t.type === 'payout' || t.type === 'cancellation_fee') {
    await notify(t.user_id, ok
      ? { type: 'payment', title: 'Paiement reçu', body: `${amount} ont été versés sur votre Mobile Money.`, data }
      : { type: 'payment', title: 'Versement en attente', body: `Le versement de ${amount} a échoué. Le montant reste disponible dans votre portefeuille Tasko.`, data });
  } else if (t.type === 'refund' || t.type === 'partial_refund') {
    if (ok) await notify(t.user_id, { type: 'payment', title: 'Remboursement effectué', body: `${amount} vous ont été remboursés.`, data });
    else await notifyAdmins({ type: 'system', title: 'Remboursement échoué', body: `${amount} — nouvelle tentative automatique programmée.`, data });
  } else if (t.type === 'withdrawal') {
    await notify(t.user_id, ok
      ? { type: 'payment', title: 'Retrait effectué', body: `${amount} ont été envoyés sur votre Mobile Money.`, data }
      : { type: 'payment', title: 'Retrait échoué', body: `Le retrait de ${amount} a échoué ; le montant reste dans votre portefeuille.`, data });
  } else if (t.type === 'revenue_withdrawal' && t.user_id) {
    await notify(t.user_id, { type: 'payment', title: ok ? 'Retrait de revenus effectué' : 'Retrait de revenus échoué', body: amount, data: { transaction_id: t.id } });
  }
  return serializeTransaction(t);
}

/** Résultat asynchrone d'un versement (mock / webhook transfer.*). */
export async function handlePayoutResult({ provider, external_ref, reference, status, reason }) {
  let t = null;
  if (reference && UUID_RE.test(reference)) t = await one('SELECT id FROM transactions WHERE id = $1', [reference]);
  if (!t && external_ref) t = await one('SELECT id FROM transactions WHERE provider = $1 AND external_ref = $2', [provider, external_ref]);
  if (!t) return null;
  return applyOutgoingResult({ txId: t.id, status, external_ref, reason });
}

onPayoutResult(handlePayoutResult);

// =================================================================== webhooks et re-vérification (Campay, Monetbil…)
const COLLECTION_TYPES = ['escrow_in', 'subscription', 'boost'];

/**
 * Re-vérifie une transaction `pending` auprès de SON fournisseur (celui enregistré sur la transaction, même si l'admin
 * a changé de fournisseur entre-temps) puis applique le résultat. On ne fait jamais confiance au seul corps d'un webhook :
 * statut, montant et devise viennent de l'API du fournisseur. Idempotent (transaction déjà traitée → sans effet).
 */
export async function reconcileTransaction(t, { externalRef = null, signedAmount = null, signedCurrency = null } = {}) {
  const provider = getProviderStrict(t.provider);
  if (!provider) return { ok: true, ignored: 'unknown_provider' };
  const isCollection = COLLECTION_TYPES.includes(t.type);
  const lateSuccessPossible = isCollection && t.status === 'failed' && t.meta?.expired;
  if (t.status !== 'pending' && !lateSuccessPossible) return { ok: true, ignored: 'already_processed' };
  const ref = t.external_ref || externalRef;
  if (!ref) return { ok: true, ignored: 'no_external_ref' };
  const check = await provider.checkStatus(ref);
  if (!check || check.status === 'pending') return { ok: true, status: 'pending' };
  if (check.reference && check.reference !== t.id) {
    console.warn(`[${t.provider}] référence incohérente`, t.id, check.reference);
    return { ok: true, ignored: 'reference_mismatch' };
  }
  // Montant : celui de l'API du fournisseur ; à défaut (Monetbil), celui de la notification, couvert par la signature.
  const amount = check.amount ?? signedAmount;
  const currency = check.currency || signedCurrency;
  if (isCollection && check.status === 'success' && (amount === null || amount === undefined)) {
    return { ok: true, status: 'pending', ignored: 'amount_unverified' };
  }
  const badAmount = check.status === 'success'
    && ((amount !== null && amount !== undefined && Number(amount) !== Number(t.amount)) || (currency && currency !== 'XAF'));
  if (badAmount) {
    // Montant (ou devise) différent de celui attendu : jamais de crédit. Transaction en échec + alerte admin.
    await one(
      `UPDATE transactions SET meta = meta || $2::jsonb, updated_at = now() WHERE id = $1 RETURNING id`,
      [t.id, JSON.stringify({ amount_mismatch: { expected: t.amount, received: amount, currency } })],
    );
    if (isCollection) await handlePaymentResult({ provider: t.provider, external_ref: ref, reference: t.id, status: 'failed' });
    await notifyAdmins({
      type: 'system', title: 'Montant de paiement incohérent',
      body: `Transaction ${t.id} (${t.provider}) : attendu ${fmt(t.amount)}, reçu ${amount ?? '?'} ${currency || ''}. Vérifiez chez le fournisseur.`,
      data: { transaction_id: t.id, job_id: t.job_id },
    });
    throw conflict('Montant du paiement différent du montant attendu', { expected: t.amount, received: amount });
  }
  if (isCollection) {
    const r = await handlePaymentResult({ provider: t.provider, external_ref: ref, reference: t.id, status: check.status });
    return { ok: true, status: r?.status ?? check.status };
  }
  const r = await applyOutgoingResult({ txId: t.id, status: check.status, external_ref: ref, reason: check.reason || null });
  return { ok: true, status: r?.status ?? check.status };
}

/**
 * Webhook d'un fournisseur : 1) signature vérifiée (401 sinon) ; 2) transaction retrouvée par notre référence ou par la
 * référence fournisseur ET appartenant à ce fournisseur ; 3) re-vérification du statut et du montant via l'API.
 */
export async function processProviderWebhook(providerName, req) {
  const provider = getProviderStrict(providerName);
  if (!provider) throw notFound('Fournisseur inconnu');
  const evt = provider.verifyWebhook(req);
  if (!evt) return { ok: true, ignored: 'event' };
  let t = null;
  if (evt.reference && UUID_RE.test(evt.reference)) t = await one('SELECT * FROM transactions WHERE id = $1', [evt.reference]);
  if (!t && evt.external_ref) {
    t = await one('SELECT * FROM transactions WHERE provider = $1 AND external_ref = $2', [providerName, evt.external_ref]);
  }
  if (!t) return { ok: true, ignored: 'unknown_transaction' };
  if (t.provider !== providerName) return { ok: true, ignored: 'provider_mismatch' };
  if (t.external_ref && evt.external_ref && t.external_ref !== evt.external_ref) return { ok: true, ignored: 'reference_mismatch' };
  return reconcileTransaction(t, { externalRef: evt.external_ref, signedAmount: evt.signed_amount ?? null, signedCurrency: evt.signed_currency ?? null });
}

/**
 * Planificateur : re-vérifie les transactions restées `pending` chez un fournisseur réel (webhook perdu, versement
 * Campay en attente). Au plus 50 par cycle, uniquement après 2 minutes.
 */
export async function reconcilePendingTransactions(now = new Date()) {
  const rows = await many(
    `SELECT * FROM transactions WHERE status = 'pending' AND external_ref IS NOT NULL
        AND (provider = 'campay' OR (provider = 'monetbil' AND type IN ('escrow_in', 'subscription', 'boost')))
        AND updated_at <= $1::timestamptz - interval '2 minutes'
      ORDER BY updated_at LIMIT 50`,
    [now],
  );
  let n = 0;
  for (const t of rows) {
    try {
      const r = await reconcileTransaction(t);
      if (r.status === 'success' || r.status === 'failed') n++;
    } catch (err) {
      console.warn('[reconciliation]', t.id, err.message);
    }
  }
  return n;
}
