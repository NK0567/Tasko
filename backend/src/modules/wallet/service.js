import { many, one, withTransaction } from '../../db.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { resolvePayoutProviderName } from '../../payments/index.js';
import { getSettings } from '../settings/service.js';
import { executeOutgoing, serializeTransaction } from '../payments/service.js';

/**
 * Portefeuille prestataire (calculé à partir des transactions) :
 * - crédits non versés = payout / cancellation_fee en `failed` (envoi échoué ou auto_payout désactivé) ;
 * - available = crédits non versés − retraits (pending + success).
 */
const AVAILABLE_SQL = `
  SELECT coalesce((SELECT sum(amount) FROM transactions WHERE user_id = $1 AND type IN ('payout', 'cancellation_fee') AND status = 'failed'), 0)
       - coalesce((SELECT sum(amount) FROM transactions WHERE user_id = $1 AND type = 'withdrawal' AND status IN ('pending', 'success')), 0)
       AS available`;

export async function walletAvailable(userId, client) {
  const r = await one(AVAILABLE_SQL, [userId], client);
  return Math.max(0, Number(r.available || 0));
}

export async function getWallet(user) {
  const [held, available, paid, pending, items] = await Promise.all([
    one(
      `SELECT coalesce((SELECT sum(provider_payout) FROM jobs j WHERE j.provider_id = $1 AND j.payment_status = 'held'
                          AND NOT EXISTS (SELECT 1 FROM job_milestones m WHERE m.job_id = j.id)), 0)
            + coalesce((SELECT sum(m.provider_payout) FROM job_milestones m JOIN jobs j ON j.id = m.job_id
                         WHERE j.provider_id = $1 AND m.status IN ('funded', 'submitted', 'disputed')), 0) AS held`,
      [user.id],
    ),
    walletAvailable(user.id),
    one(
      `SELECT coalesce(sum(amount), 0) AS total FROM transactions
        WHERE user_id = $1 AND status = 'success' AND type IN ('payout', 'cancellation_fee', 'withdrawal')`,
      [user.id],
    ),
    many(
      `SELECT j.id AS job_id, j.title, j.provider_payout AS amount, j.auto_release_at, NULL::uuid AS milestone_id
         FROM jobs j WHERE j.provider_id = $1 AND j.status = 'done' AND j.payment_status = 'held'
          AND NOT EXISTS (SELECT 1 FROM job_milestones m WHERE m.job_id = j.id)
       UNION ALL
       SELECT j.id, j.title || ' — ' || m.title, m.provider_payout, m.auto_release_at, m.id
         FROM job_milestones m JOIN jobs j ON j.id = m.job_id WHERE j.provider_id = $1 AND m.status = 'submitted'
       ORDER BY auto_release_at NULLS LAST`,
      [user.id],
    ),
    many(
      `SELECT * FROM transactions WHERE user_id = $1 AND type IN ('payout', 'cancellation_fee', 'withdrawal', 'subscription', 'boost')
        ORDER BY created_at DESC LIMIT 50`,
      [user.id],
    ),
  ]);
  return {
    held: Number(held.held || 0),
    available,
    paid_out_total: Number(paid.total || 0),
    pending_release: pending.map((p) => ({ job_id: p.job_id, milestone_id: p.milestone_id, title: p.title, amount: p.amount, auto_release_at: p.auto_release_at })),
    items: items.map(serializeTransaction),
  };
}

/**
 * Retrait manuel (ou relance automatique) du solde disponible vers le Mobile Money du prestataire.
 * Verrou sur le profil prestataire : deux retraits simultanés ne peuvent pas dépasser le disponible.
 * Par sécurité, le numéro doit être celui du compte ou le numéro Mobile Money enregistré.
 */
export async function withdraw(user, { amount, method, phone }, { auto = false } = {}) {
  const settings = await getSettings();
  const txId = await withTransaction(async (client) => {
    const pp = await one(
      `SELECT pp.momo_number, u.phone FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE pp.user_id = $1 FOR UPDATE OF pp`,
      [user.id],
      client,
    );
    if (!pp) throw notFound('Profil prestataire introuvable');
    if (phone !== pp.momo_number && phone !== pp.phone) {
      throw badRequest('Le retrait doit être envoyé sur votre numéro Mobile Money enregistré', { phone: 'Non autorisé' });
    }
    const available = await walletAvailable(user.id, client);
    if (amount > available) throw conflict(`Montant supérieur au solde disponible (${available} FCFA)`, { available });
    const t = await one(
      `INSERT INTO transactions (user_id, type, amount, method, phone, provider, status, meta)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, 'pending', $6::jsonb) RETURNING id`,
      [user.id, amount, method, phone, resolvePayoutProviderName(settings), JSON.stringify({ auto })],
      client,
    );
    return t.id;
  });
  await executeOutgoing(txId);
  return { transaction: serializeTransaction(await one('SELECT * FROM transactions WHERE id = $1', [txId])) };
}

/**
 * Planificateur : relance les versements prestataires en échec (auto_payout actif) sous forme de retrait automatique
 * du solde disponible. Au plus une tentative / 30 min et 5 échecs consécutifs par prestataire.
 */
export async function retryProviderPayouts(now) {
  const settings = await getSettings();
  if (settings.auto_payout === false) return 0;
  const rows = await many(
    `SELECT u.id, u.full_name, pp.momo_number, pp.momo_operator FROM users u JOIN provider_profiles pp ON pp.user_id = u.id
      WHERE u.status = 'active' AND pp.momo_number IS NOT NULL
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.type IN ('payout', 'cancellation_fee') AND t.status = 'failed'
                     AND coalesce(t.meta->>'wallet', '') <> 'auto_payout_off')
        AND NOT EXISTS (SELECT 1 FROM transactions w WHERE w.user_id = u.id AND w.type = 'withdrawal'
                         AND (w.status = 'pending' OR w.created_at > $1::timestamptz - interval '30 minutes'))
        AND (SELECT count(*) FROM transactions w WHERE w.user_id = u.id AND w.type = 'withdrawal' AND w.status = 'failed'
              AND (w.meta->>'auto')::boolean IS TRUE
              AND w.created_at > coalesce((SELECT max(s.created_at) FROM transactions s WHERE s.user_id = u.id AND s.type = 'withdrawal' AND s.status = 'success'), 'epoch')) < 5
      LIMIT 50`,
    [now],
  );
  let n = 0;
  for (const p of rows) {
    const available = await walletAvailable(p.id);
    if (available <= 0) continue;
    try {
      await withdraw({ id: p.id }, { amount: available, method: p.momo_operator === 'orange' ? 'orange_money' : 'mtn_momo', phone: p.momo_number }, { auto: true });
      n++;
    } catch (err) {
      console.warn('[scheduler] relance versement', p.id, err.message);
    }
  }
  return n;
}
