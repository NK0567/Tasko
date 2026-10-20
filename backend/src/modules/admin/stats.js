import { many, one } from '../../db.js';

const TZ = 'Africa/Douala';
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0);

/**
 * Indicateurs du tableau de bord.
 * - *_growth_pct utilisateurs/prestataires : inscriptions des 30 derniers jours vs les 30 jours précédents.
 * - jobs/revenue growth : aujourd'hui (depuis minuit) vs hier sur la même plage horaire (fuseau Africa/Douala).
 * - gmv = encaissements escrow_in réussis ; revenue = transactions commission réussies.
 */
export async function dashboardStats() {
  const r = await one(
    `WITH b AS (
       SELECT (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS today,
              (date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS month
     )
     SELECT
       (SELECT count(*) FROM users WHERE NOT is_admin) AS users_total,
       (SELECT count(*) FROM users WHERE NOT is_admin AND created_at >= now() - interval '30 days') AS users_30,
       (SELECT count(*) FROM users WHERE NOT is_admin AND created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days') AS users_prev30,
       (SELECT count(*) FROM users WHERE is_provider) AS providers_total,
       (SELECT count(*) FROM provider_profiles WHERE created_at >= now() - interval '30 days') AS providers_30,
       (SELECT count(*) FROM provider_profiles WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days') AS providers_prev30,
       (SELECT count(*) FROM jobs, b WHERE created_at >= b.today) AS jobs_today,
       (SELECT count(*) FROM jobs, b WHERE created_at >= b.today - interval '1 day' AND created_at < now() - interval '1 day') AS jobs_yesterday,
       (SELECT coalesce(sum(amount), 0) FROM transactions, b WHERE type = 'escrow_in' AND status = 'success' AND created_at >= b.today) AS gmv_today,
       (SELECT coalesce(sum(amount), 0) FROM transactions, b WHERE type = 'commission' AND status = 'success' AND created_at >= b.today) AS revenue_today,
       (SELECT coalesce(sum(amount), 0) FROM transactions, b WHERE type = 'commission' AND status = 'success'
           AND created_at >= b.today - interval '1 day' AND created_at < now() - interval '1 day') AS revenue_yesterday,
       (SELECT coalesce(sum(amount), 0) FROM transactions, b WHERE type = 'escrow_in' AND status = 'success' AND created_at >= b.month) AS gmv_month,
       (SELECT coalesce(sum(amount), 0) FROM transactions, b WHERE type = 'commission' AND status = 'success' AND created_at >= b.month) AS revenue_month,
       (SELECT count(*) FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE pp.is_online AND u.status = 'active') AS active_providers,
       (SELECT count(*) FILTER (WHERE status = 'cancelled')::float / nullif(count(*), 0) FROM jobs WHERE created_at >= now() - interval '30 days') AS cancel_ratio,
       (SELECT round(avg(total)) FROM jobs WHERE status = 'completed' AND completed_at >= now() - interval '30 days') AS avg_basket,
       (SELECT count(*) FROM disputes WHERE status = 'open') AS disputes_open`,
  );
  return {
    users_total: r.users_total,
    users_growth_pct: pct(r.users_30, r.users_prev30),
    providers_total: r.providers_total,
    providers_growth_pct: pct(r.providers_30, r.providers_prev30),
    jobs_today: r.jobs_today,
    jobs_growth_pct: pct(r.jobs_today, r.jobs_yesterday),
    gmv_today: r.gmv_today,
    revenue_today: r.revenue_today,
    revenue_growth_pct: pct(r.revenue_today, r.revenue_yesterday),
    gmv_month: r.gmv_month,
    revenue_month: r.revenue_month,
    active_providers: r.active_providers,
    cancellation_rate: Math.round((r.cancel_ratio || 0) * 1000) / 10,
    avg_basket: r.avg_basket || 0,
    disputes_open: r.disputes_open,
  };
}

export async function timeseries(days) {
  return many(
    `WITH d AS (
       SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - ($1::int - 1), (now() AT TIME ZONE '${TZ}')::date, interval '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
       (SELECT count(*) FROM jobs j WHERE (j.created_at AT TIME ZONE '${TZ}')::date = d.day)::int AS jobs,
       (SELECT coalesce(sum(amount), 0) FROM transactions t WHERE t.type = 'escrow_in' AND t.status = 'success'
          AND (t.created_at AT TIME ZONE '${TZ}')::date = d.day)::int AS gmv,
       (SELECT coalesce(sum(amount), 0) FROM transactions t WHERE t.type = 'commission' AND t.status = 'success'
          AND (t.created_at AT TIME ZONE '${TZ}')::date = d.day)::int AS revenue,
       (SELECT count(*) FROM users u WHERE NOT u.is_admin AND (u.created_at AT TIME ZONE '${TZ}')::date = d.day)::int AS new_users
     FROM d ORDER BY d.day`,
    [days],
  );
}

/** Par catégorie racine. gmv = total des missions payées (séquestre ou libéré) ; revenue = frais + commission des missions libérées. */
export async function byCategory(days) {
  return many(
    `SELECT root.id AS category_id, root.name, root.icon,
            count(j.id)::int AS jobs,
            coalesce(sum(j.total) FILTER (WHERE j.payment_status IN ('held', 'released')), 0)::int AS gmv,
            coalesce(sum(j.service_fee + j.provider_commission) FILTER (WHERE j.payment_status = 'released'), 0)::int AS revenue
       FROM jobs j
       JOIN categories c ON c.id = j.category_id
       JOIN categories root ON root.id = coalesce(c.parent_id, c.id)
      WHERE j.created_at >= now() - make_interval(days => $1)
      GROUP BY root.id, root.name, root.icon
      ORDER BY jobs DESC`,
    [days],
  );
}

export async function byCity(days) {
  return many(
    `SELECT coalesce(j.city, 'Autre') AS city, count(*)::int AS jobs,
            coalesce(sum(j.total) FILTER (WHERE j.payment_status IN ('held', 'released')), 0)::int AS gmv,
            coalesce(sum(j.service_fee + j.provider_commission) FILTER (WHERE j.payment_status = 'released'), 0)::int AS revenue
       FROM jobs j
      WHERE j.created_at >= now() - make_interval(days => $1)
      GROUP BY 1 ORDER BY jobs DESC`,
    [days],
  );
}

export async function activity(limit) {
  return many(
    `SELECT * FROM (
       SELECT 'provider_signup' AS type, u.full_name || ' a rejoint Tasko' AS title,
              coalesce(pp.headline, 'Prestataire') || coalesce(' · ' || u.city, '') AS subtitle, u.avatar_url, pp.created_at
         FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
       UNION ALL
       SELECT 'category_created', 'Nouveau service : ' || c.name, coalesce(p.name, 'Catégorie'), NULL, c.created_at
         FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       UNION ALL
       SELECT 'job_completed', 'Mission terminée : ' || j.title, coalesce(pu.full_name, '') || ' · ' || j.total || ' FCFA', pu.avatar_url, j.completed_at
         FROM jobs j LEFT JOIN users pu ON pu.id = j.provider_id WHERE j.status = 'completed'
       UNION ALL
       SELECT 'payment', 'Paiement reçu : ' || t.amount || ' FCFA', u.full_name || ' · ' || coalesce(t.method, ''), u.avatar_url, t.created_at
         FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.type = 'escrow_in' AND t.status = 'success'
       UNION ALL
       SELECT 'dispute', 'Litige ouvert : ' || j.title, u.full_name || ' · ' || left(d.reason, 80), u.avatar_url, d.created_at
         FROM disputes d JOIN jobs j ON j.id = d.job_id JOIN users u ON u.id = d.opened_by
     ) a
     WHERE created_at IS NOT NULL
     ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
}
