// Planificateur interne (toutes les 60 s) — idempotent, protégé par un verrou consultatif PostgreSQL :
// si plusieurs instances de l'API tournent, une seule exécute un cycle à la fois (pg_try_advisory_lock).
import { many, one, pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { getSettings } from '../modules/settings/service.js';
import { notify } from '../modules/notifications/service.js';
import { executeOutgoing, reconcilePendingTransactions } from '../modules/payments/service.js';
import { emitJobUpdated } from '../modules/jobs/repo.js';
import { releaseJobInTx, releaseMilestoneInTx } from '../modules/jobs/service.js';
import { recomputeProviderStats } from '../modules/providers/service.js';
import { expireTenders } from '../modules/jobs/tenders.js';
import { runRecurring } from '../modules/properties/service.js';
import { autoSettlement } from '../modules/treasury/service.js';
import { retryProviderPayouts } from '../modules/wallet/service.js';
import { alertDecisionsDue, autoResolveNoShows } from '../modules/disputes/service.js';

const LOCK_KEY = 7_250_000;
const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'short', timeStyle: 'short' });

/** RG-G4 : libère les missions `done` et jalons `submitted` échus (jamais en litige : statut `disputed` exclu). */
export async function autoRelease(now) {
  const settings = await getSettings();
  let released = 0;
  const jobs = await many(
    `SELECT id FROM jobs j WHERE j.status = 'done' AND j.payment_status = 'held' AND j.auto_release_at <= $1
        AND NOT EXISTS (SELECT 1 FROM job_milestones m WHERE m.job_id = j.id)
        AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.job_id = j.id AND d.status <> 'resolved')
      ORDER BY j.auto_release_at LIMIT 200`,
    [now],
  );
  for (const { id } of jobs) {
    const payoutId = await withTransaction(async (client) => {
      const job = await one(`SELECT * FROM jobs WHERE id = $1 AND status = 'done' AND auto_release_at <= $2 FOR UPDATE SKIP LOCKED`, [id, now], client);
      if (!job || job.payment_status !== 'held') return undefined;
      const pid = await releaseJobInTx(client, job, 'auto', settings);
      await recomputeProviderStats(job.provider_id, client);
      return pid;
    });
    if (payoutId === undefined) continue;
    released++;
    await executeOutgoing(payoutId);
    const job = await emitJobUpdated(id);
    await notify(job.client.id, { type: 'job', title: 'Paiement libéré', body: `Sans contestation de votre part, le paiement de « ${job.title} » a été libéré au prestataire.`, data: { job_id: id } });
    await notify(job.provider.id, { type: 'payment', title: 'Paiement libéré', body: `Le paiement de « ${job.title} » vous a été libéré automatiquement.`, data: { job_id: id } });
  }
  const ms = await many(
    `SELECT m.id, m.job_id FROM job_milestones m JOIN jobs j ON j.id = m.job_id
      WHERE m.status = 'submitted' AND m.auto_release_at <= $1 AND j.status <> 'disputed'
      ORDER BY m.auto_release_at LIMIT 200`,
    [now],
  );
  for (const { id, job_id } of ms) {
    const payoutId = await withTransaction(async (client) => {
      const job = await one('SELECT * FROM jobs WHERE id = $1 FOR UPDATE SKIP LOCKED', [job_id], client);
      if (!job || job.status === 'disputed') return undefined;
      const m = await one(`SELECT * FROM job_milestones WHERE id = $1 AND status = 'submitted' AND auto_release_at <= $2 FOR UPDATE`, [id, now], client);
      if (!m) return undefined;
      const pid = await releaseMilestoneInTx(client, job, m, 'auto', settings);
      await recomputeProviderStats(job.provider_id, client);
      return pid;
    });
    if (payoutId === undefined) continue;
    released++;
    await executeOutgoing(payoutId);
    const job = await emitJobUpdated(job_id);
    await notify(job.provider.id, { type: 'payment', title: 'Jalon libéré', body: `Un jalon de « ${job.title} » vous a été libéré automatiquement.`, data: { job_id, milestone_id: id } });
  }
  return released;
}

/** Rappels au client : à mi-parcours du délai de libération, puis 2 h avant. */
export async function sendReminders(now) {
  let n = 0;
  const due = await many(
    `UPDATE jobs SET reminder_final_at = CASE WHEN $1 >= auto_release_at - interval '2 hours' THEN $1 ELSE reminder_final_at END,
                     reminder_mid_at = coalesce(reminder_mid_at, $1)
      WHERE status = 'done' AND auto_release_at > $1
        AND ((reminder_mid_at IS NULL AND $1 >= done_at + (auto_release_at - done_at) / 2)
          OR (reminder_final_at IS NULL AND $1 >= auto_release_at - interval '2 hours'))
      RETURNING id, client_id, title, auto_release_at, reminder_final_at = $1 AS is_final`,
    [now],
  );
  for (const j of due) {
    n++;
    await notify(j.client_id, {
      type: 'job',
      title: j.is_final ? 'Dernier rappel : validation' : 'Rappel : validez la mission',
      body: `« ${j.title} » : validez ou signalez un problème avant le ${fmtDate(j.auto_release_at)}. Sans réponse, le paiement sera libéré au prestataire.`,
      data: { job_id: j.id },
    });
  }
  const ms = await many(
    `UPDATE job_milestones m SET reminder_final_at = CASE WHEN $1 >= m.auto_release_at - interval '2 hours' THEN $1 ELSE m.reminder_final_at END,
                                 reminder_mid_at = coalesce(m.reminder_mid_at, $1)
       FROM jobs j
      WHERE j.id = m.job_id AND m.status = 'submitted' AND m.auto_release_at > $1
        AND ((m.reminder_mid_at IS NULL AND $1 >= m.submitted_at + (m.auto_release_at - m.submitted_at) / 2)
          OR (m.reminder_final_at IS NULL AND $1 >= m.auto_release_at - interval '2 hours'))
      RETURNING m.id, m.job_id, m.title, m.auto_release_at, j.client_id`,
    [now],
  );
  for (const m of ms) {
    n++;
    await notify(m.client_id, {
      type: 'job', title: 'Rappel : jalon à valider',
      body: `Jalon « ${m.title} » : validez ou signalez un problème avant le ${fmtDate(m.auto_release_at)}, sinon il sera libéré automatiquement.`,
      data: { job_id: m.job_id, milestone_id: m.id },
    });
  }
  return n;
}

/** Relance des remboursements en échec (5 tentatives max, espacées d'au moins 10 min). */
export async function retryFailedRefunds(now) {
  const rows = await many(
    `UPDATE transactions SET status = 'pending', meta = meta || jsonb_build_object('retries', coalesce((meta->>'retries')::int, 0) + 1), updated_at = now()
      WHERE id IN (SELECT id FROM transactions WHERE type IN ('refund', 'partial_refund') AND status = 'failed'
                     AND coalesce((meta->>'retries')::int, 0) < 5 AND updated_at <= $1::timestamptz - interval '10 minutes' LIMIT 50)
      RETURNING id`,
    [now],
  );
  for (const r of rows) await executeOutgoing(r.id);
  return rows.length;
}

const TASKS = [
  ['auto_release', autoRelease],
  ['reminders', sendReminders],
  ['no_shows', autoResolveNoShows],
  ['dispute_alerts', alertDecisionsDue],
  ['tenders', expireTenders],
  ['recurring', runRecurring],
  ['provider_payouts', retryProviderPayouts],
  ['refund_retries', retryFailedRefunds],
  ['provider_reconciliation', reconcilePendingTransactions],
  ['auto_settlement', autoSettlement],
];

/**
 * Un cycle complet. `now` injectable (horloge simulée pour les tests). Retourne { ran, results } ;
 * ran = false si une autre instance détient le verrou.
 */
export async function runSchedulerOnce({ now = new Date(), only = null } = {}) {
  const client = await pool.connect();
  const results = {};
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return { ran: false, results };
    try {
      for (const [name, fn] of TASKS) {
        if (only && !only.includes(name)) continue;
        try {
          results[name] = await fn(now);
        } catch (err) {
          results[name] = { error: err.message };
          console.error(`[scheduler] ${name}`, err);
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
    return { ran: true, results };
  } finally {
    client.release();
  }
}

let timer = null;
let running = false;

export function startScheduler() {
  if (!config.schedulerEnabled || timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerOnce();
    } catch (err) {
      console.error('[scheduler]', err.message);
    } finally {
      running = false;
    }
  }, config.schedulerIntervalMs);
  timer.unref?.();
  console.log(`Planificateur actif (toutes les ${Math.round(config.schedulerIntervalMs / 1000)} s)`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
