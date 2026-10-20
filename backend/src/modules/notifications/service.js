import { many, one, query } from '../../db.js';
import { emitToUser } from '../../realtime/hub.js';

export function serializeNotification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data || {},
    read_at: n.read_at,
    created_at: n.created_at,
  };
}

/** Crée une notification en base et l'émet en temps réel (`notification:new`). Ne lève jamais. */
export async function notify(userId, { type, title, body = null, data = {} }) {
  try {
    const n = await one(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [userId, type, title, body, JSON.stringify(data)],
    );
    const out = serializeNotification(n);
    emitToUser(userId, 'notification:new', out);
    return out;
  } catch (err) {
    console.error('[notify]', err.message);
    return null;
  }
}

export async function notifyMany(userIds, payload) {
  await Promise.all([...new Set(userIds)].map((id) => notify(id, payload)));
}

export async function notifyAdmins(payload) {
  const admins = await many("SELECT id FROM users WHERE is_admin AND status = 'active'");
  await notifyMany(admins.map((a) => a.id), payload);
}

export async function listNotifications(userId, type) {
  const items = await many(
    `SELECT * FROM notifications WHERE user_id = $1 AND ($2::text IS NULL OR type = $2)
     ORDER BY created_at DESC LIMIT 100`,
    [userId, type || null],
  );
  const { count } = await one('SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return { items: items.map(serializeNotification), unread_count: count };
}

export async function markAllRead(userId) {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}
