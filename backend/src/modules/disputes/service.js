import { many, one, withTransaction } from '../../db.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../utils/errors.js';
import { emitToUsers } from '../../realtime/hub.js';
import { getSettings } from '../settings/service.js';
import { notify, notifyAdmins } from '../notifications/service.js';
import { recomputeProviderStats } from '../providers/service.js';
import { executeOutgoing, fmt, refundUnitInTx, releaseUnitInTx, splitInTx } from '../payments/service.js';
import { FUNDED_STATUSES, canReportNoShow, emitJobUpdated, fetchJobRow, getJobView, serializeRows } from '../jobs/repo.js';
import { finalizeMilestoneJob, lockJob } from '../jobs/service.js';
import { audit } from '../audit/service.js';
import { broadcastMessage, loadConversationFor, postSystemMessage, sendMessage, serializeMessage } from '../messaging/service.js';

const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'short', timeStyle: 'short' });

const DISPUTE_SELECT = `
  SELECT d.*, ou.full_name AS opened_by_name, db.full_name AS decided_by_name, cb.full_name AS confirmed_by_name,
         j.client_id, j.provider_id
    FROM disputes d
    JOIN jobs j ON j.id = d.job_id
    JOIN users ou ON ou.id = d.opened_by
    LEFT JOIN users db ON db.id = d.decided_by
    LEFT JOIN users cb ON cb.id = d.confirmed_by`;

function serializeProposal(p) {
  return {
    id: p.id,
    author: { id: p.author_id, full_name: p.author_role === 'admin' ? 'Médiateur Tasko' : p.author_name, role: p.author_role },
    provider_amount: p.provider_amount,
    client_refund: p.client_refund,
    message: p.message,
    client_accepted: p.client_accepted,
    provider_accepted: p.provider_accepted,
    status: p.status,
    created_at: p.created_at,
  };
}

/** Sérialise des litiges en lot (missions, propositions, preuves : une requête chacune — pas de N+1). */
async function serializeDisputes(rows, viewer, { withEvidence = true } = {}) {
  if (!rows.length) return [];
  const jobIds = [...new Set(rows.map((d) => d.job_id))];
  const disputeIds = rows.map((d) => d.id);
  const convIds = rows.map((d) => d.conversation_id).filter(Boolean);
  const [jobRows, proposals, evidence] = await Promise.all([
    import('../jobs/repo.js').then(({ fetchJobRows }) => fetchJobRows('j.id = ANY($1)', [jobIds], { limit: jobIds.length })),
    many(
      `SELECT p.*, u.full_name AS author_name FROM dispute_proposals p JOIN users u ON u.id = p.author_id
        WHERE p.dispute_id = ANY($1) ORDER BY p.created_at DESC`,
      [disputeIds],
    ),
    withEvidence && convIds.length
      ? many(
        `SELECT m.*, u.full_name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = ANY($1) AND m.type IN ('text', 'image') AND m.sender_role IN ('client', 'provider')
          ORDER BY m.created_at`,
        [convIds],
      )
      : [],
  ]);
  const jobs = new Map((await serializeRows(jobRows, viewer)).map((j) => [j.id, j]));
  return rows.map((d) => {
    const ev = evidence.filter((m) => m.conversation_id === d.conversation_id);
    return {
      id: d.id,
      job: jobs.get(d.job_id) || null,
      kind: d.kind,
      milestone_id: d.milestone_id,
      opened_by: { id: d.opened_by, full_name: d.opened_by_name, role: d.opened_role },
      reason: d.reason,
      photos: d.photos || [],
      status: d.status,
      conversation_id: d.conversation_id,
      respond_before: d.respond_before,
      decision_due_at: d.decision_due_at,
      proposals: proposals.filter((p) => p.dispute_id === d.id).map(serializeProposal),
      evidence: ev.map((m) => ({
        author: { id: m.sender_id, full_name: m.sender_name, role: m.sender_role },
        message: m.type === 'text' ? m.body : null,
        photos: m.type === 'image' ? [m.body] : [],
        created_at: m.created_at,
      })),
      resolution: d.resolution,
      provider_amount: d.provider_amount,
      resolved_by: d.resolved_via,
      resolution_note: d.note,
      note: d.note,
      pending_decision: d.status === 'pending_confirmation'
        ? { resolution: d.pending_resolution, provider_amount: d.pending_provider_amount, note: d.pending_note }
        : null,
      decided_by: d.decided_by ? { id: d.decided_by, full_name: d.decided_by_name } : null,
      confirmed_by: d.confirmed_by ? { id: d.confirmed_by, full_name: d.confirmed_by_name } : null,
      created_at: d.created_at,
      resolved_at: d.resolved_at,
    };
  });
}

async function loadDisputeFor(id, user) {
  const d = await one(`${DISPUTE_SELECT} WHERE d.id = $1`, [id]);
  if (!d) throw notFound('Litige introuvable');
  if (!user.is_admin && d.client_id !== user.id && d.provider_id !== user.id) throw notFound('Litige introuvable');
  return d;
}

const partyRole = (d, userId) => (userId === d.client_id ? 'client' : userId === d.provider_id ? 'provider' : null);

export async function getDispute(id, user) {
  const d = await loadDisputeFor(id, user);
  const [out] = await serializeDisputes([d], user);
  return out;
}

async function emitDisputeUpdated(id) {
  const d = await one(`${DISPUTE_SELECT} WHERE d.id = $1`, [id]);
  if (!d) return null;
  const [out] = await serializeDisputes([d], null, { withEvidence: false });
  emitToUsers([d.client_id, d.provider_id], 'dispute:updated', out);
  return out;
}

// ------------------------------------------------------------------ ouverture (RG-G6, RG-G11, RG-G12)
/**
 * Ouvre un litige : gèle la libération automatique, crée le salon de médiation à trois (client, prestataire, admins).
 * `kind = no_show` : réservé au client quand `can_report_no_show` (RG-G11) ; le prestataire a `no_show_response_hours`.
 */
export async function openDispute(jobId, user, { reason, kind, photos = [], milestone_id }) {
  const settings = await getSettings();
  const now = Date.now();
  const res = await withTransaction(async (client) => {
    const job = await lockJob(client, jobId);
    const role = job.client_id === user.id ? 'client' : job.provider_id === user.id ? 'provider' : null;
    if (!role) throw notFound('Mission introuvable');
    const k = kind || (role === 'client' ? 'quality' : 'not_validated');
    if (k === 'no_show') {
      if (role !== 'client') throw forbidden('Seul le client peut signaler l\'absence du prestataire');
      const row = await fetchJobRow(jobId, client);
      if (!canReportNoShow(row, settings, now)) {
        throw invalidState('Signalement impossible : le délai d\'arrivée du prestataire n\'est pas dépassé ou la mission a démarré');
      }
    }
    const active = await one(`SELECT id FROM disputes WHERE job_id = $1 AND status <> 'resolved'`, [jobId], client);
    if (active) throw conflict('Un litige est déjà ouvert sur cette mission');

    let milestone = null;
    const ms = await many('SELECT * FROM job_milestones WHERE job_id = $1 ORDER BY position FOR UPDATE', [jobId], client);
    if (!FUNDED_STATUSES.includes(job.status)) throw invalidState(`Mission « ${job.status} » : litige impossible`);
    if (ms.length) {
      milestone = milestone_id ? ms.find((m) => m.id === milestone_id) : ms.find((m) => ['funded', 'submitted'].includes(m.status));
      if (milestone_id && !milestone) throw notFound('Jalon introuvable');
      if (!milestone || !['funded', 'submitted'].includes(milestone.status)) throw invalidState('Aucun jalon séquestré à contester');
      if (milestone.status === 'submitted' && milestone.auto_release_at && new Date(milestone.auto_release_at).getTime() <= now) {
        throw invalidState('Délai de contestation dépassé : le jalon est en cours de libération');
      }
      await client.query(`UPDATE job_milestones SET status = 'disputed', updated_at = now() WHERE id = $1`, [milestone.id]);
    } else {
      if (milestone_id) throw badRequest('Cette mission n\'a pas de jalons', { milestone_id: 'Invalide' });
      if (job.status === 'done' && job.auto_release_at && new Date(job.auto_release_at).getTime() <= now) {
        throw invalidState('Délai de contestation dépassé : les fonds sont en cours de libération');
      }
    }
    const respondHours = k === 'no_show' ? Number(settings.no_show_response_hours) || 12 : Number(settings.dispute_response_hours) || 48;
    const d = await one(
      `INSERT INTO disputes (job_id, opened_by, opened_role, kind, reason, photos, milestone_id, respond_before, decision_due_at, prev_job_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8), now() + make_interval(hours => $9), $10) RETURNING *`,
      [jobId, user.id, role, k, reason, photos, milestone?.id ?? null, respondHours, Number(settings.dispute_decision_hours) || 72, job.status],
      client,
    );
    const [a, b] = job.client_id < job.provider_id ? [job.client_id, job.provider_id] : [job.provider_id, job.client_id];
    const conv = await one(
      `INSERT INTO conversations (user_a, user_b, job_id, kind, dispute_id) VALUES ($1, $2, $3, 'mediation', $4) RETURNING id`,
      [a, b, jobId, d.id],
      client,
    );
    await client.query('UPDATE disputes SET conversation_id = $2 WHERE id = $1', [d.id, conv.id]);
    await client.query(`UPDATE jobs SET status = 'disputed', updated_at = now() WHERE id = $1`, [jobId]);

    const opener = role === 'client' ? 'le client' : 'le prestataire';
    const intro = k === 'no_show'
      ? `Litige ouvert par le client : le prestataire ne s'est pas présenté. Le prestataire doit répondre avant le ${fmtDate(d.respond_before)}, sinon le client sera remboursé automatiquement.`
      : `Litige ouvert par ${opener} : ${reason}. Chaque partie peut déposer ses preuves ici. Décision de Tasko au plus tard le ${fmtDate(d.decision_due_at)}.`;
    await postSystemMessage(conv.id, intro, { client });
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, sender_role, type, body) VALUES ($1, $2, $3, 'text', $4)`,
      [conv.id, user.id, role, reason],
    );
    for (const p of photos) {
      await client.query(`INSERT INTO messages (conversation_id, sender_id, sender_role, type, body) VALUES ($1, $2, $3, 'image', $4)`, [conv.id, user.id, role, p]);
    }
    return { d, other: role === 'client' ? job.provider_id : job.client_id, title: job.title };
  });
  await emitJobUpdated(jobId);
  await emitDisputeUpdated(res.d.id);
  await notify(res.other, {
    type: 'job',
    title: res.d.kind === 'no_show' ? 'Absence signalée' : 'Litige ouvert',
    body: res.d.kind === 'no_show'
      ? `Le client signale que vous n'êtes pas venu pour « ${res.title} ». Répondez dans le salon de médiation avant le ${fmtDate(res.d.respond_before)}, sinon il sera remboursé.`
      : `Un litige a été ouvert sur « ${res.title} ». Échangez dans le salon de médiation avec l'équipe Tasko.`,
    data: { job_id: jobId, dispute_id: res.d.id, conversation_id: res.d.conversation_id },
  });
  await notifyAdmins({
    type: 'system', title: res.d.kind === 'no_show' ? 'Prestataire absent signalé' : 'Nouveau litige',
    body: `${res.title} — ${reason}`, data: { job_id: jobId, dispute_id: res.d.id },
  });
  return getJobView(jobId, user);
}

// ------------------------------------------------------------------ salon de médiation
export async function listDisputeMessages(id, user) {
  const d = await loadDisputeFor(id, user);
  if (!d.conversation_id) return { items: [], job_chat: [] };
  const { listMessages } = await import('../messaging/service.js');
  const items = await listMessages(user, d.conversation_id, { limit: 500 });
  // Le chat normal de la mission est rattaché en lecture (RG-G12)
  const [a, b] = d.client_id < d.provider_id ? [d.client_id, d.provider_id] : [d.provider_id, d.client_id];
  const direct = await one(`SELECT id FROM conversations WHERE kind = 'direct' AND user_a = $1 AND user_b = $2`, [a, b]);
  let job_chat = [];
  if (direct) {
    const rows = await many(
      `SELECT m.*, u.full_name AS sender_name,
              coalesce(m.sender_role, CASE WHEN m.sender_id = $2 THEN 'client' WHEN m.sender_id = $3 THEN 'provider' ELSE 'system' END) AS sender_role
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
      [direct.id, d.client_id, d.provider_id],
    );
    const job = await one('SELECT funded_at FROM jobs WHERE id = $1', [d.job_id]);
    const mask = !user.is_admin && !job.funded_at && (await getSettings()).mask_contacts_until_funded !== false;
    job_chat = rows.reverse().map((m) => serializeMessage(m, { mask }));
  }
  return { items, job_chat };
}

export async function postDisputeMessage(id, user, { type, body }) {
  const d = await loadDisputeFor(id, user);
  if (d.status === 'resolved') throw invalidState('Ce litige est clos : le salon est en lecture seule');
  return sendMessage(user, d.conversation_id, { type, body });
}

/** Alias V1 : POST /disputes/:id/evidence {message, photos} → messages du salon. */
export async function addEvidence(id, user, { message, photos = [] }) {
  await postDisputeMessage(id, user, { type: 'text', body: message });
  for (const p of photos) await postDisputeMessage(id, user, { type: 'image', body: p });
  return getDispute(id, user);
}

// ------------------------------------------------------------------ exécution d'une résolution
async function heldUnit(client, d, job) {
  if (d.milestone_id) {
    const m = await one('SELECT * FROM job_milestones WHERE id = $1 FOR UPDATE', [d.milestone_id], client);
    return { unit: m, ms: m };
  }
  return { unit: job, ms: null };
}

/**
 * Exécute release / refund / split sur l'unité séquestrée du litige, met à jour mission, jalon, litige, compteurs.
 * Litige et mission verrouillés par l'appelant. Retourne les ids de versements à exécuter après COMMIT.
 */
async function executeResolutionInTx(client, d, job, { resolution, provider_amount, note, via, actorId }, settings) {
  const { unit, ms } = await heldUnit(client, d, job);
  const outgoing = [];
  let providerAmount = null;
  if (resolution === 'release') outgoing.push(await releaseUnitInTx(client, job, ms, settings));
  else if (resolution === 'refund') outgoing.push(await refundUnitInTx(client, job, ms));
  else {
    if (!(provider_amount >= 0 && provider_amount <= unit.total)) throw badRequest('Montant prestataire invalide', { provider_amount: 'Invalide' });
    providerAmount = provider_amount;
    outgoing.push(...(await splitInTx(client, job, ms, provider_amount, settings)));
  }
  const by = via === 'admin' ? 'admin' : 'system';
  if (ms) {
    await client.query(
      `UPDATE job_milestones SET status = $2, released_at = CASE WHEN $2 = 'released' THEN now() END,
              refunded_at = CASE WHEN $2 = 'refunded' THEN now() END, updated_at = now() WHERE id = $1`,
      [ms.id, resolution === 'refund' ? 'refunded' : 'released'],
    );
    await client.query(`UPDATE jobs SET status = $2, updated_at = now() WHERE id = $1`, [job.id, d.prev_job_status && d.prev_job_status !== 'disputed' ? d.prev_job_status : 'in_progress']);
    await finalizeMilestoneJob(client, job.id, by === 'admin' ? 'admin' : 'auto');
  } else if (resolution === 'refund') {
    await client.query(
      `UPDATE jobs SET status = 'cancelled', payment_status = 'refunded', cancelled_at = now(), cancelled_by = $2, cancelled_role = $3,
              cancel_reason = $4, updated_at = now() WHERE id = $1`,
      [job.id, actorId, by, `Litige résolu : remboursement${note ? ` — ${note}` : ''}`],
    );
  } else {
    await client.query(
      `UPDATE jobs SET status = 'completed', payment_status = 'released', completed_at = now(), completed_by = $2, updated_at = now() WHERE id = $1`,
      [job.id, by === 'admin' ? 'admin' : 'auto'],
    );
  }
  await client.query(
    `UPDATE disputes SET status = 'resolved', resolution = $2, provider_amount = $3, note = $4, resolved_by = $5, resolved_via = $6,
            resolved_at = now(), pending_resolution = NULL, pending_provider_amount = NULL, pending_note = NULL WHERE id = $1`,
    [d.id, resolution, providerAmount, note || null, actorId, via],
  );
  await client.query(`UPDATE dispute_proposals SET status = 'superseded', updated_at = now() WHERE dispute_id = $1 AND status = 'pending'`, [d.id]);
  // RG-G15 : compteurs du perdant
  if (resolution === 'refund') {
    await client.query(
      `UPDATE provider_profiles SET disputes_lost = disputes_lost + 1, no_shows = no_shows + $2, updated_at = now() WHERE user_id = $1`,
      [job.provider_id, d.kind === 'no_show' ? 1 : 0],
    );
  }
  await recomputeProviderStats(job.provider_id, client);
  const label = resolution === 'release'
    ? `Fonds versés au prestataire (${fmt(unit.total)} séquestrés).`
    : resolution === 'refund'
      ? `Client remboursé (${fmt(unit.total)}).`
      : `Partage : ${fmt(providerAmount)} au prestataire, ${fmt(unit.total - providerAmount)} remboursés au client.`;
  const who = via === 'agreement' ? 'Accord amiable accepté par les deux parties' : via === 'system' ? 'Décision automatique' : 'Décision du Médiateur Tasko';
  await postSystemMessage(d.conversation_id, `${who} : ${label}${note ? ` Motif : ${note}` : ''}`, { client });
  return outgoing.filter(Boolean);
}

async function afterResolution(d, outgoing) {
  for (const id of outgoing) await executeOutgoing(id);
  const job = await emitJobUpdated(d.job_id);
  await emitDisputeUpdated(d.id);
  const fresh = await one('SELECT resolution, provider_amount FROM disputes WHERE id = $1', [d.id]);
  const msg = fresh.resolution === 'release' ? 'Les fonds ont été versés au prestataire.'
    : fresh.resolution === 'refund' ? 'Le client a été remboursé.' : 'Les fonds ont été partagés.';
  for (const uid of [job.client.id, job.provider?.id].filter(Boolean)) {
    await notify(uid, { type: 'job', title: 'Litige résolu', body: `« ${job.title} » : ${msg}`, data: { job_id: d.job_id, dispute_id: d.id } });
  }
  // RG-G15 : alerte de suspension au seuil
  const settings = await getSettings();
  const threshold = Number(settings.suspension_threshold) || 3;
  const stats = await one(
    `SELECT (SELECT count(*) FROM disputes d2 JOIN jobs j2 ON j2.id = d2.job_id WHERE j2.client_id = $1 AND d2.resolution = 'release') AS client_lost,
            pp.disputes_lost AS provider_lost, pp.no_shows, cu.full_name AS client_name, pu.full_name AS provider_name
       FROM users cu, users pu LEFT JOIN provider_profiles pp ON pp.user_id = pu.id WHERE cu.id = $1 AND pu.id = $2`,
    [job.client.id, job.provider.id],
  );
  if (fresh.resolution === 'release' && stats.client_lost >= threshold) {
    await notifyAdmins({ type: 'system', title: 'Alerte suspension (client)', body: `${stats.client_name} a perdu ${stats.client_lost} litiges.`, data: { user_id: job.client.id } });
  }
  if (fresh.resolution === 'refund' && (stats.provider_lost >= threshold || stats.no_shows >= threshold)) {
    await notifyAdmins({
      type: 'system', title: 'Alerte suspension (prestataire)',
      body: `${stats.provider_name} : ${stats.provider_lost} litiges perdus, ${stats.no_shows} absences.`, data: { user_id: job.provider.id },
    });
  }
}

// ------------------------------------------------------------------ accord amiable (RG-G13)
export async function createProposal(id, user, { provider_amount, message }) {
  const d0 = await loadDisputeFor(id, user);
  const role = partyRole(d0, user.id) || (user.is_admin ? 'admin' : null);
  const p = await withTransaction(async (client) => {
    const d = await one('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id], client);
    if (d.status !== 'open') throw invalidState('Ce litige n\'accepte plus de proposition');
    const job = await one('SELECT * FROM jobs WHERE id = $1', [d.job_id], client);
    const { unit } = await heldUnit(client, d, job);
    if (provider_amount > unit.total) throw badRequest(`Montant maximum : ${unit.total} FCFA (montant séquestré)`, { provider_amount: 'Invalide' });
    await client.query(`UPDATE dispute_proposals SET status = 'superseded', updated_at = now() WHERE dispute_id = $1 AND status = 'pending'`, [id]);
    const row = await one(
      `INSERT INTO dispute_proposals (dispute_id, author_id, author_role, provider_amount, client_refund, message, client_accepted, provider_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, user.id, role, provider_amount, unit.total - provider_amount, message || null, role === 'client' ? true : null, role === 'provider' ? true : null],
      client,
    );
    await postSystemMessage(d.conversation_id, row.id, { type: 'proposal', client });
    await postSystemMessage(
      d.conversation_id,
      `Proposition de règlement : ${fmt(provider_amount)} au prestataire, ${fmt(unit.total - provider_amount)} remboursés au client. Les deux parties doivent l'accepter.`,
      { client },
    );
    return row;
  });
  await emitDisputeUpdated(id);
  for (const uid of [d0.client_id, d0.provider_id].filter((x) => x !== user.id)) {
    await notify(uid, { type: 'job', title: 'Proposition de règlement', body: `${fmt(provider_amount)} au prestataire — à accepter ou refuser dans le salon de médiation.`, data: { dispute_id: id } });
  }
  return serializeProposal({ ...p, author_name: user.full_name });
}

export async function answerProposal(id, pid, user, accept) {
  const d0 = await loadDisputeFor(id, user);
  const role = partyRole(d0, user.id);
  if (!role) throw forbidden('Seules les parties peuvent accepter ou refuser une proposition');
  const settings = await getSettings();
  const result = await withTransaction(async (client) => {
    const job = await lockJob(client, d0.job_id);
    const d = await one('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id], client);
    const p = await one('SELECT * FROM dispute_proposals WHERE id = $1 AND dispute_id = $2 FOR UPDATE', [pid, id], client);
    if (!p) throw notFound('Proposition introuvable');
    if (p.status !== 'pending' || d.status !== 'open') throw invalidState('Cette proposition n\'est plus valable');
    const col = role === 'client' ? 'client_accepted' : 'provider_accepted';
    const updated = await one(
      `UPDATE dispute_proposals SET ${col} = $2, status = CASE WHEN $2 THEN status ELSE 'rejected' END, updated_at = now() WHERE id = $1 RETURNING *`,
      [pid, accept],
      client,
    );
    if (!accept) {
      await postSystemMessage(d.conversation_id, `Proposition refusée par le ${role === 'client' ? 'client' : 'prestataire'}.`, { client });
      return { outgoing: null };
    }
    if (updated.client_accepted && updated.provider_accepted) {
      await client.query(`UPDATE dispute_proposals SET status = 'accepted', updated_at = now() WHERE id = $1`, [pid]);
      const { unit } = await heldUnit(client, d, job);
      const resolution = p.provider_amount === 0 ? 'refund' : p.provider_amount === unit.total ? 'release' : 'split';
      const outgoing = await executeResolutionInTx(
        client, d, job, { resolution, provider_amount: p.provider_amount, note: p.message || 'Accord amiable', via: 'agreement', actorId: null }, settings,
      );
      return { outgoing };
    }
    await postSystemMessage(d.conversation_id, `Proposition acceptée par le ${role === 'client' ? 'client' : 'prestataire'} — en attente de l'autre partie.`, { client });
    return { outgoing: null };
  });
  if (result.outgoing) await afterResolution(d0, result.outgoing);
  else await emitDisputeUpdated(id);
  return getDispute(id, user);
}

// ------------------------------------------------------------------ décision admin (RG-G14)
export async function resolveDispute(id, admin, { resolution, provider_amount, note }, ip) {
  if (resolution === 'split' && provider_amount === undefined) throw badRequest('Montant prestataire requis pour un partage', { provider_amount: 'Requis' });
  const settings = await getSettings();
  const d0 = await one('SELECT * FROM disputes WHERE id = $1', [id]);
  if (!d0) throw notFound('Litige introuvable');
  const result = await withTransaction(async (client) => {
    const job = await lockJob(client, d0.job_id);
    const d = await one('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id], client);
    if (d.status === 'resolved') throw invalidState('Ce litige est déjà résolu');
    if (d.status === 'pending_confirmation') throw invalidState('Une décision attend déjà la confirmation d\'un second administrateur');
    if (job.status !== 'disputed') throw invalidState(`Mission « ${job.status} » : résolution impossible`);
    const { unit } = await heldUnit(client, d, job);
    if (resolution === 'split' && !(provider_amount >= 0 && provider_amount <= unit.total)) {
      throw badRequest(`Montant prestataire entre 0 et ${unit.total} FCFA`, { provider_amount: 'Invalide' });
    }
    await audit({ actorId: admin.id, action: 'dispute.resolve', target: `dispute:${id}`, details: { resolution, provider_amount, note, amount: unit.total }, ip }, client);
    if (unit.total > Number(settings.four_eyes_threshold ?? 100000)) {
      await client.query(
        `UPDATE disputes SET status = 'pending_confirmation', pending_resolution = $2, pending_provider_amount = $3, pending_note = $4,
                decided_by = $5, decided_at = now() WHERE id = $1`,
        [id, resolution, resolution === 'split' ? provider_amount : null, note, admin.id],
      );
      await postSystemMessage(d.conversation_id, `Décision proposée par le Médiateur Tasko (${resolution}) — en attente de confirmation par un second administrateur. Motif : ${note}`, { client });
      return { pending: true };
    }
    await client.query('UPDATE disputes SET decided_by = $2, decided_at = now() WHERE id = $1', [id, admin.id]);
    const outgoing = await executeResolutionInTx(client, d, job, { resolution, provider_amount, note, via: 'admin', actorId: admin.id }, settings);
    return { outgoing };
  });
  if (result.pending) {
    await emitDisputeUpdated(id);
    await notifyAdmins({ type: 'system', title: 'Décision à confirmer', body: `Un litige de plus de ${fmt(settings.four_eyes_threshold)} attend une seconde validation.`, data: { dispute_id: id } });
  } else {
    await afterResolution(d0, result.outgoing);
  }
  return getDispute(id, admin);
}

export async function confirmDispute(id, admin, ip) {
  const settings = await getSettings();
  const d0 = await one('SELECT * FROM disputes WHERE id = $1', [id]);
  if (!d0) throw notFound('Litige introuvable');
  const outgoing = await withTransaction(async (client) => {
    const job = await lockJob(client, d0.job_id);
    const d = await one('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id], client);
    if (d.status !== 'pending_confirmation') throw invalidState('Aucune décision en attente de confirmation');
    if (d.decided_by === admin.id) throw forbidden('La confirmation doit être faite par un autre administrateur (double validation)');
    await client.query('UPDATE disputes SET confirmed_by = $2 WHERE id = $1', [id, admin.id]);
    await audit({ actorId: admin.id, action: 'dispute.confirm', target: `dispute:${id}`, details: { resolution: d.pending_resolution, decided_by: d.decided_by }, ip }, client);
    return executeResolutionInTx(
      client, d, job,
      { resolution: d.pending_resolution, provider_amount: d.pending_provider_amount, note: d.pending_note, via: 'admin', actorId: admin.id },
      settings,
    );
  });
  await afterResolution(d0, outgoing);
  return getDispute(id, admin);
}

export async function listDisputes({ status, kind }, viewer) {
  const rows = await many(
    `${DISPUTE_SELECT} WHERE ($1::text IS NULL OR d.status = $1) AND ($2::text IS NULL OR d.kind = $2)
      ORDER BY (d.status = 'resolved'), CASE WHEN d.status <> 'resolved' THEN d.decision_due_at END ASC NULLS LAST, d.resolved_at DESC NULLS LAST
      LIMIT 200`,
    [status || null, kind || null],
  );
  return serializeDisputes(rows, viewer);
}

// ------------------------------------------------------------------ planificateur
/** RG-G11 : no-show sans réponse du prestataire à `respond_before` → remboursement automatique (resolved_by = system). */
export async function autoResolveNoShows(now) {
  const due = await many(
    `SELECT d.id FROM disputes d JOIN jobs j ON j.id = d.job_id
      WHERE d.kind = 'no_show' AND d.status = 'open' AND d.respond_before <= $1
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = d.conversation_id AND m.sender_id = j.provider_id)
        AND NOT EXISTS (SELECT 1 FROM dispute_proposals p WHERE p.dispute_id = d.id AND p.author_id = j.provider_id)
      LIMIT 100`,
    [now],
  );
  const settings = await getSettings();
  let n = 0;
  for (const { id } of due) {
    const d0 = await one('SELECT * FROM disputes WHERE id = $1', [id]);
    const outgoing = await withTransaction(async (client) => {
      const job = await one('SELECT * FROM jobs WHERE id = $1 FOR UPDATE SKIP LOCKED', [d0.job_id], client);
      if (!job) return null;
      const d = await one(`SELECT * FROM disputes WHERE id = $1 AND status = 'open' FOR UPDATE`, [id], client);
      if (!d || job.status !== 'disputed') return null;
      return executeResolutionInTx(
        client, d, job, { resolution: 'refund', note: 'Le prestataire n\'a pas répondu dans le délai imparti', via: 'system', actorId: null }, settings,
      );
    });
    if (outgoing) {
      await afterResolution(d0, outgoing);
      n++;
    }
  }
  return n;
}

/** RG-G14 : alerte admin 12 h avant l'échéance de décision. */
export async function alertDecisionsDue(now) {
  const rows = await many(
    `UPDATE disputes SET decision_alert_at = $1
      WHERE status <> 'resolved' AND decision_alert_at IS NULL AND decision_due_at - interval '12 hours' <= $1
      RETURNING id, decision_due_at`,
    [now],
  );
  for (const r of rows) {
    await notifyAdmins({ type: 'system', title: 'Litige : échéance proche', body: `Décision attendue avant le ${fmtDate(r.decision_due_at)}.`, data: { dispute_id: r.id } });
  }
  return rows.length;
}

export { broadcastMessage, loadConversationFor };
