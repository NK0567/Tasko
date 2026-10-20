import { many, one, query, withTransaction } from '../../db.js';
import { badRequest, forbidden, invalidState, notFound } from '../../utils/errors.js';
import { maskPhones } from '../../utils/mask.js';
import { emitPerViewer, emitToRooms, isConnected } from '../../realtime/hub.js';
import { notify } from '../notifications/service.js';
import { getSettings } from '../settings/service.js';

export const MEDIATOR_NAME = 'Médiateur Tasko';

/** Rôle d'un utilisateur dans une conversation (client / prestataire du job lié, admin, ou participant direct). */
function roleIn(conv, userId, isAdmin) {
  if (conv.job_client_id && userId === conv.job_client_id) return 'client';
  if (conv.job_provider_id && userId === conv.job_provider_id) return 'provider';
  if (isAdmin && conv.kind === 'mediation') return 'admin';
  return null;
}

/** Rôle d'un expéditeur quand il n'a pas été stocké (messages directs V1) : selon la mission liée, sinon son profil. */
const SENDER_ROLE_SQL = `coalesce(m.sender_role,
  CASE WHEN m.sender_id IS NULL THEN 'system' WHEN m.sender_id = jj.client_id THEN 'client' WHEN m.sender_id = jj.provider_id THEN 'provider'
       WHEN su.is_provider THEN 'provider' ELSE 'client' END)`;

export function serializeMessage(m, { mask = false } = {}) {
  const body = mask && (m.type === 'text' || m.type === 'system') ? maskPhones(m.body) : m.body;
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_role: m.sender_role || null,
    sender_name: m.sender_role === 'admin' ? MEDIATOR_NAME : m.sender_role === 'system' ? 'Tasko' : m.sender_name ?? null,
    type: m.type,
    body,
    lat: m.lat,
    lng: m.lng,
    created_at: m.created_at,
    read_at: m.read_at,
  };
}

// Fonds sécurisés : conversation directe → au moins une mission entre les deux avec séquestre ; médiation → mission financée.
const SECURED_SQL = `CASE WHEN c.kind = 'mediation' THEN coalesce(jj.funded_at IS NOT NULL, false)
  ELSE EXISTS (SELECT 1 FROM jobs sj WHERE ((sj.client_id = c.user_a AND sj.provider_id = c.user_b) OR (sj.client_id = c.user_b AND sj.provider_id = c.user_a))
                AND sj.payment_status IN ('held', 'released')) END`;

const CONV_SELECT = `
  SELECT c.*, jj.client_id AS job_client_id, jj.provider_id AS job_provider_id, ${SECURED_SQL} AS secured,
         o.id AS o_id, o.full_name AS o_name, o.avatar_url AS o_avatar, pp.headline AS o_headline, coalesce(pp.is_online, false) AS o_online,
         lm.id AS lm_id, lm.sender_id AS lm_sender, lm.role AS lm_role, lm.sender_name AS lm_name, lm.type AS lm_type, lm.body AS lm_body, lm.lat AS lm_lat, lm.lng AS lm_lng,
         lm.created_at AS lm_created, lm.read_at AS lm_read,
         (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM $1 AND m.read_at IS NULL) AS unread_count
    FROM conversations c
    LEFT JOIN jobs jj ON jj.id = c.job_id
    JOIN users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
    LEFT JOIN provider_profiles pp ON pp.user_id = o.id
    LEFT JOIN LATERAL (SELECT m.*, su.full_name AS sender_name, ${SENDER_ROLE_SQL} AS role FROM messages m LEFT JOIN users su ON su.id = m.sender_id
                        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
   WHERE (c.user_a = $1 OR c.user_b = $1)`;

async function participants(conv) {
  const rows = await many(
    `SELECT u.id, u.full_name, u.avatar_url FROM users u WHERE u.id = ANY($1)`,
    [[conv.user_a, conv.user_b]],
  );
  const list = rows.map((u) => ({
    ...u,
    role: conv.job_client_id === u.id ? 'client' : conv.job_provider_id === u.id ? 'provider' : null,
  }));
  if (conv.kind === 'mediation') list.push({ id: null, full_name: MEDIATOR_NAME, avatar_url: null, role: 'admin' });
  return list;
}

function serializeConversation(r, mask) {
  const hide = mask && !r.secured;
  return {
    id: r.id,
    kind: r.kind,
    dispute_id: r.dispute_id,
    other_user: {
      id: r.o_id,
      full_name: r.o_name,
      avatar_url: r.o_avatar,
      headline: r.o_headline,
      is_online: r.o_online || isConnected(r.o_id),
    },
    job_id: r.job_id,
    last_message: r.lm_id
      ? serializeMessage(
          {
            id: r.lm_id, conversation_id: r.id, sender_id: r.lm_sender, sender_role: r.lm_role, sender_name: r.lm_name, type: r.lm_type, body: r.lm_body,
            lat: r.lm_lat, lng: r.lm_lng, created_at: r.lm_created, read_at: r.lm_read,
          },
          { mask: hide },
        )
      : null,
    unread_count: r.unread_count,
    updated_at: r.updated_at,
  };
}

const maskEnabled = async () => (await getSettings()).mask_contacts_until_funded !== false;

export async function listConversations(userId) {
  const [rows, mask] = await Promise.all([many(`${CONV_SELECT} ORDER BY c.updated_at DESC LIMIT 200`, [userId]), maskEnabled()]);
  return rows.map((r) => serializeConversation(r, mask));
}

export async function getConversation(userId, id) {
  const r = await one(`${CONV_SELECT} AND c.id = $2`, [userId, id]);
  if (!r) throw notFound('Conversation introuvable');
  const out = serializeConversation(r, await maskEnabled());
  out.participants = await participants(r);
  return out;
}

export async function openConversation(userId, otherId, jobId) {
  if (userId === otherId) throw badRequest('Impossible de démarrer une conversation avec vous-même');
  const other = await one(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [otherId]);
  if (!other) throw notFound('Utilisateur introuvable');
  if (jobId) {
    // anti-IDOR : la mission liée doit concerner les deux interlocuteurs
    const j = await one(
      'SELECT 1 FROM jobs WHERE id = $1 AND ((client_id = $2 AND provider_id = $3) OR (client_id = $3 AND provider_id = $2))',
      [jobId, userId, otherId],
    );
    if (!j) throw badRequest('Mission sans rapport avec cette conversation', { job_id: 'Invalide' });
  }
  const [a, b] = userId < otherId ? [userId, otherId] : [otherId, userId];
  const c = await one(
    `INSERT INTO conversations (user_a, user_b, job_id, kind) VALUES ($1, $2, $3, 'direct')
     ON CONFLICT (user_a, user_b) WHERE kind = 'direct' DO UPDATE SET job_id = coalesce(EXCLUDED.job_id, conversations.job_id)
     RETURNING id`,
    [a, b, jobId || null],
  );
  return getConversation(userId, c.id);
}

/** Charge la conversation + contexte (mission liée, fonds sécurisés) et vérifie l'accès. */
export async function loadConversationFor(user, conversationId) {
  const c = await one(
    `SELECT c.*, jj.client_id AS job_client_id, jj.provider_id AS job_provider_id, ${SECURED_SQL} AS secured
       FROM conversations c LEFT JOIN jobs jj ON jj.id = c.job_id WHERE c.id = $1`,
    [conversationId],
  );
  const member = c && (c.user_a === user.id || c.user_b === user.id);
  const adminMediation = c && c.kind === 'mediation' && user.is_admin;
  if (!c || (!member && !adminMediation)) throw notFound('Conversation introuvable');
  const role = roleIn(c, user.id, user.is_admin) || (member ? 'member' : null);
  return { conv: c, role, other_id: member ? (c.user_a === user.id ? c.user_b : c.user_a) : null };
}

/** Compat V1 : vérifie l'appartenance et retourne { id, other_id }. */
export async function assertMember(userId, conversationId) {
  const { conv, other_id } = await loadConversationFor({ id: userId, is_admin: false }, conversationId);
  return { id: conv.id, other_id };
}

export async function listMessages(user, conversationId, { before, limit }) {
  const { conv } = await loadConversationFor(user, conversationId);
  const mask = !user.is_admin && !conv.secured && (await maskEnabled());
  const rows = await many(
    `SELECT m.*, su.full_name AS sender_name, ${SENDER_ROLE_SQL} AS sender_role
       FROM messages m LEFT JOIN users su ON su.id = m.sender_id
       LEFT JOIN jobs jj ON jj.id = $4::uuid
      WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
      ORDER BY m.created_at DESC LIMIT $3`,
    [conversationId, before || null, limit, conv.job_id],
  );
  return rows.reverse().map((m) => serializeMessage(m, { mask }));
}

/** Diffuse un message : chaque destinataire reçoit la version masquée ou non selon ses droits. */
export async function broadcastMessage(conv, msg, { excludeUserId = null } = {}) {
  const mask = !conv.secured && (await maskEnabled());
  const rooms = [`conversation:${conv.id}`, `user:${conv.user_a}`, `user:${conv.user_b}`];
  await emitPerViewer(rooms, 'message:new', (viewer) =>
    viewer && viewer.id === excludeUserId ? null : serializeMessage(msg, { mask: mask && !viewer?.is_admin }),
  );
  return serializeMessage(msg, { mask });
}

/** Message système (ouverture de litige, échéances, propositions, décision). */
export async function postSystemMessage(conversationId, body, { type = 'system', client } = {}) {
  const m = await one(
    `INSERT INTO messages (conversation_id, sender_id, sender_role, type, body) VALUES ($1, NULL, 'system', $2, $3) RETURNING *`,
    [conversationId, type, body],
    client,
  );
  await (client || { query }).query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  return m;
}

export async function sendMessage(user, conversationId, { type, body, lat, lng }) {
  const { conv, role, other_id } = await loadConversationFor(user, conversationId);
  if (type === 'location' && (lat === undefined || lng === undefined)) throw badRequest('Position requise (lat, lng) pour un message de localisation');
  if (type !== 'location' && !body) throw badRequest('Le message est vide');
  if (conv.kind === 'mediation') {
    if (type === 'location') throw badRequest('Type de message non accepté dans un salon de médiation');
    const d = await one('SELECT status FROM disputes WHERE id = $1', [conv.dispute_id]);
    if (d?.status === 'resolved') throw invalidState('Ce litige est clos : le salon est en lecture seule');
  } else if (role === 'admin' || !other_id) {
    throw forbidden('Accès refusé');
  }
  const senderRole = role === 'client' || role === 'provider' || role === 'admin' ? role : user.is_provider ? 'provider' : 'client';
  const m = await withTransaction(async (client) => {
    const msg = await one(
      `INSERT INTO messages (conversation_id, sender_id, sender_role, type, body, lat, lng) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [conversationId, user.id, senderRole, type, body ?? null, lat ?? null, lng ?? null],
      client,
    );
    await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
    return msg;
  });
  m.sender_name = user.full_name;
  const out = await broadcastMessage(conv, m, { excludeUserId: user.id });
  const preview = type === 'location' ? '📍 Position partagée' : type === 'image' ? '📷 Photo' : out.body.length > 80 ? `${out.body.slice(0, 79)}…` : out.body;
  const recipients = conv.kind === 'mediation' ? [conv.user_a, conv.user_b].filter((id) => id !== user.id) : [other_id];
  for (const rid of recipients) {
    await notify(rid, {
      type: 'message',
      title: conv.kind === 'mediation' ? `Médiation — ${role === 'admin' ? MEDIATOR_NAME : user.full_name}` : user.full_name,
      body: preview,
      data: { conversation_id: conversationId, sender_id: user.id, ...(conv.dispute_id ? { dispute_id: conv.dispute_id } : {}) },
    });
  }
  // l'expéditeur reçoit la version brute de son propre message
  return serializeMessage(m, { mask: false });
}

export async function markRead(user, conversationId) {
  await loadConversationFor(user, conversationId);
  await query('UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND sender_id IS DISTINCT FROM $2 AND read_at IS NULL', [
    conversationId, user.id,
  ]);
}

export { emitToRooms };
