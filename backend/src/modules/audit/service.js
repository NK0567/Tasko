import { many, one, pool } from '../../db.js';

/** Adresse IP du client (Express calcule req.ip en tenant compte de `trust proxy`). */
export const clientIp = (req) => (req?.ip ? String(req.ip).slice(0, 64) : null);

/**
 * Journal d'audit des actions sensibles (trésorerie, paramètres, litiges, comptes).
 * Peut être appelé dans une transaction SQL (client) pour être atomique avec l'action.
 */
export async function audit({ actorId = null, action, target = null, details = {}, ip = null }, client = pool) {
  await client.query(
    'INSERT INTO audit_logs (actor_id, action, target, details, ip) VALUES ($1, $2, $3, $4::jsonb, $5)',
    [actorId, action, target, JSON.stringify(details || {}), ip],
  );
}

export async function listAuditLogs({ page, limit, action, actor_id }) {
  const where = '($1::text IS NULL OR a.action = $1) AND ($2::uuid IS NULL OR a.actor_id = $2)';
  const params = [action || null, actor_id || null];
  const [rows, total] = await Promise.all([
    many(
      `SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`,
      [...params, limit, (page - 1) * limit],
    ),
    one(`SELECT count(*)::int AS n FROM audit_logs a WHERE ${where}`, params),
  ]);
  return {
    items: rows.map((a) => ({
      id: a.id,
      actor: a.actor_id ? { id: a.actor_id, full_name: a.actor_name } : null,
      action: a.action,
      target: a.target,
      details: a.details,
      ip: a.ip,
      created_at: a.created_at,
    })),
    total: total.n,
    page,
    limit,
  };
}
