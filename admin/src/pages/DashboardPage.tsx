import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  CheckCircle2,
  CreditCard,
  FolderPlus,
  Hourglass,
  PiggyBank,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { jobsApi, statsApi, treasuryApi } from '../api/admin';
import type { ActivityType, TimeseriesPoint } from '../api/types';
import { Avatar, CatIcon, Empty, ErrorState, QueryState } from '../components/ui';
import { formatCompact, formatDay, formatMoney, formatNumber, formatPct, timeAgo } from '../lib/format';
import RevenueSimulator from './dashboard/RevenueSimulator';
import TodoBanner from './dashboard/TodoBanner';

const REFRESH = 30_000;

function Growth({ pct }: { pct: number | undefined }) {
  if (pct === undefined || pct === null || Number.isNaN(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={`badge ${up ? 'tone-green' : 'tone-red'}`} title="Variation vs période précédente">
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? '+' : ''}
      {formatPct(pct)}
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  growth,
  sub,
  help,
  to,
  accent = 'var(--green-700)',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  growth?: number;
  sub?: string;
  help?: string;
  to?: string;
  accent?: string;
}) {
  const body = (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: `color-mix(in srgb, ${accent} 12%, white)`,
            color: accent,
          }}
        >
          {icon}
        </span>
        <Growth pct={growth} />
      </div>
      <div>
        <div className="muted small">
          {label}
          {help && to && <span className="sr-only"> — {help}</span>}
        </div>
        <div className="num" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-title)' }}>
          {value}
        </div>
        {sub && <div className="muted small">{sub}</div>}
      </div>
    </>
  );
  const style = { display: 'flex', flexDirection: 'column' as const, gap: 10 };
  return to ? (
    <Link to={to} className="card card-pad kpi-link" style={style}>
      {body}
    </Link>
  ) : (
    <div className="card card-pad" style={style}>
      {body}
      {help && <span className="sr-only">{help}</span>}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="card card-pad" style={{ height: 128 }}>
      <div className="skeleton" style={{ width: 36, height: 36 }} />
      <div className="skeleton" style={{ width: '60%', height: 12, marginTop: 14 }} />
      <div className="skeleton" style={{ width: '80%', height: 22, marginTop: 8 }} />
    </div>
  );
}

type Metric = 'revenue' | 'gmv' | 'jobs' | 'new_users';
const METRICS: Record<Metric, { label: string; money: boolean }> = {
  revenue: { label: 'Revenus Tasko', money: true },
  gmv: { label: 'Volume des paiements clients', money: true },
  jobs: { label: 'Jobs', money: false },
  new_users: { label: 'Nouveaux utilisateurs', money: false },
};

function TrendChart() {
  const [metric, setMetric] = useState<Metric>('revenue');
  const q = useQuery({ queryKey: ['stats', 'timeseries', 30], queryFn: () => statsApi.timeseries(30), refetchInterval: REFRESH });
  const m = METRICS[metric];
  const fmt = (v: number) => (m.money ? formatMoney(v) : formatNumber(v));
  const total = (q.data?.items ?? []).reduce((acc, p) => acc + (p[metric] ?? 0), 0);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{m.label} — 30 derniers jours</h2>
          <div className="muted small">
            Total : <span className="num strong" style={{ color: 'var(--gray-900)' }}>{fmt(total)}</span>
          </div>
        </div>
        <div className="tabs" role="tablist">
          {(Object.keys(METRICS) as Metric[]).map((k) => (
            <button key={k} role="tab" aria-selected={k === metric} className={`tab${k === metric ? ' active' : ''}`} onClick={() => setMetric(k)}>
              {k === 'revenue' ? 'Revenus' : k === 'gmv' ? 'Paiements' : k === 'jobs' ? 'Missions' : 'Inscriptions'}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body">
        <QueryState
          query={q}
          isEmpty={(d) => d.items.length === 0}
          empty={<Empty title="Pas encore de données sur la période" />}
        >
          {(d) => (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <AreaChart data={d.items} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0F7A3D" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#0F7A3D" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#E4EBE7" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    tick={{ fontSize: 11, fill: '#6B7A72' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCompact(v)}
                    tick={{ fontSize: 11, fill: '#6B7A72' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: '#98A59E', strokeDasharray: '3 3' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #E4EBE7', fontSize: 13 }}
                    labelFormatter={(l: string) => formatDay(l)}
                    formatter={(v: number) => [fmt(v), m.label]}
                  />
                  <Area
                    type="monotone"
                    dataKey={metric satisfies keyof TimeseriesPoint}
                    stroke="#0F7A3D"
                    strokeWidth={2}
                    fill="url(#trendFill)"
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; sub: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <div key={r.key} title={`${r.sub}`}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
            <span className="row" style={{ gap: 8, minWidth: 0 }}>
              {r.label}
            </span>
            <span className="num small strong">{formatMoney(r.value)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4 }}>
            <div
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                height: '100%',
                background: 'var(--green-700)',
                borderRadius: 4,
              }}
            />
          </div>
          <div className="muted small" style={{ marginTop: 3 }}>
            {r.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function TopCategories() {
  const q = useQuery({ queryKey: ['stats', 'categories', 30], queryFn: () => statsApi.categories(30), refetchInterval: REFRESH });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Top catégories (30 j)</h2>
        <span className="muted small">par volume</span>
      </div>
      <div className="card-body">
        <QueryState query={q} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucune mission sur la période" />}>
          {(d) => (
            <BarList
              rows={[...d.items]
                .sort((a, b) => b.gmv - a.gmv)
                .slice(0, 6)
                .map((c) => ({
                  key: c.category_id,
                  label: (
                    <>
                      <CatIcon icon={c.icon} size={26} />
                      <span className="ellipsis strong">{c.name}</span>
                    </>
                  ),
                  value: c.gmv,
                  sub: `${formatNumber(c.jobs)} jobs · ${formatMoney(c.revenue)} de revenus`,
                }))}
            />
          )}
        </QueryState>
      </div>
    </div>
  );
}

function Cities() {
  const q = useQuery({ queryKey: ['stats', 'cities', 30], queryFn: () => statsApi.cities(30), refetchInterval: REFRESH });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Répartition par ville (30 j)</h2>
      </div>
      <div className="card-body">
        <QueryState query={q} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucune donnée par ville" />}>
          {(d) => {
            const totalJobs = d.items.reduce((a, c) => a + c.jobs, 0) || 1;
            return (
              <BarList
                rows={[...d.items]
                  .sort((a, b) => b.gmv - a.gmv)
                  .slice(0, 6)
                  .map((c) => ({
                    key: c.city,
                    label: <span className="strong">{c.city}</span>,
                    value: c.gmv,
                    sub: `${formatNumber(c.jobs)} jobs (${formatPct((c.jobs / totalJobs) * 100)}) · ${formatMoney(c.revenue)} de revenus`,
                  }))}
              />
            );
          }}
        </QueryState>
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityType, { icon: ReactNode; color: string }> = {
  provider_signup: { icon: <UserPlus size={16} />, color: 'var(--green-700)' },
  category_created: { icon: <FolderPlus size={16} />, color: 'var(--purple)' },
  job_completed: { icon: <CheckCircle2 size={16} />, color: 'var(--blue)' },
  payment: { icon: <CreditCard size={16} />, color: '#8a6600' },
  dispute: { icon: <AlertTriangle size={16} />, color: 'var(--red)' },
};

function Activity() {
  const q = useQuery({ queryKey: ['stats', 'activity'], queryFn: () => statsApi.activity(20), refetchInterval: REFRESH });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Activité récente</h2>
        <span className="badge tone-green">En direct</span>
      </div>
      <div className="card-body" style={{ maxHeight: 520, overflowY: 'auto' }}>
        <QueryState query={q} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucune activité pour le moment" />}>
          {(d) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {d.items.map((a, i) => {
                const meta = ACTIVITY_ICON[a.type] ?? ACTIVITY_ICON.payment;
                return (
                  <div key={`${a.created_at}-${i}`} className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative' }}>
                      <Avatar name={a.title} url={a.avatar_url} size={36} />
                      <span
                        style={{
                          position: 'absolute',
                          right: -4,
                          bottom: -4,
                          background: '#fff',
                          borderRadius: '50%',
                          padding: 2,
                          color: meta.color,
                          display: 'flex',
                        }}
                      >
                        {meta.icon}
                      </span>
                    </div>
                    <div className="grow">
                      <div className="strong">{a.title}</div>
                      {a.subtitle && <div className="small muted">{a.subtitle}</div>}
                      <div className="small muted">
                        {timeAgo(a.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: statsApi.overview, refetchInterval: REFRESH });
  const treasury = useQuery({ queryKey: ['treasury', 'overview'], queryFn: treasuryApi.overview, refetchInterval: REFRESH });
  const pendingRelease = useQuery({
    queryKey: ['jobs', { status: 'done', page: 1, limit: 1 }],
    queryFn: () => jobsApi.list({ status: 'done', page: 1, limit: 1 }),
    refetchInterval: REFRESH,
  });
  const s = stats.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>Vue d'ensemble de la plateforme · actualisation automatique toutes les 30 s</p>
        </div>
        {stats.dataUpdatedAt > 0 && (
          <span className="muted small">
            Mis à jour à {new Date(stats.dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      <TodoBanner />

      {stats.isError ? (
        <div className="card">
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </div>
      ) : (
        <div className="grid grid-kpi">
          {!s ? (
            Array.from({ length: 11 }, (_, i) => <KpiSkeleton key={i} />)
          ) : (
            <>
              <Kpi
                icon={<PiggyBank size={18} />}
                label="Revenus disponibles"
                value={treasury.data ? formatMoney(treasury.data.revenue_available) : treasury.isError ? 'Indisponible' : '…'}
                sub="À vous, retirables · voir la Trésorerie"
                help="Ouvre la page Trésorerie"
                to="/tresorerie"
              />
              <Kpi
                icon={<Hourglass size={18} />}
                label="Paiements en attente de libération"
                value={pendingRelease.data ? formatNumber(pendingRelease.data.total) : pendingRelease.isError ? '—' : '…'}
                sub={treasury.data ? `${formatMoney(treasury.data.escrow_held)} d'argent bloqué au total` : 'Missions terminées, en attente de validation client'}
                help="Ouvre la liste des missions à valider"
                to="/missions?statut=done"
                accent="var(--orange)"
              />
              <Kpi icon={<Users size={18} />} label="Utilisateurs" value={formatNumber(s.users_total)} growth={s.users_growth_pct} />
              <Kpi
                icon={<UserCog size={18} />}
                label="Prestataires"
                value={formatNumber(s.providers_total)}
                growth={s.providers_growth_pct}
                sub={`${formatNumber(s.active_providers)} actifs`}
              />
              <Kpi icon={<Briefcase size={18} />} label="Jobs du jour" value={formatNumber(s.jobs_today)} growth={s.jobs_growth_pct} />
              <Kpi
                icon={<Banknote size={18} />}
                label="Paiements clients (jour)"
                value={formatMoney(s.gmv_today)}
                sub={`Mois : ${formatMoney(s.gmv_month)}`}
                accent="var(--blue)"
              />
              <Kpi
                icon={<Wallet size={18} />}
                label="Revenus Tasko (jour)"
                value={formatMoney(s.revenue_today)}
                growth={s.revenue_growth_pct}
                accent="#B98900"
              />
              <Kpi icon={<Wallet size={18} />} label="Revenus Tasko (mois)" value={formatMoney(s.revenue_month)} accent="#B98900" />
              <Kpi icon={<ShoppingBag size={18} />} label="Panier moyen" value={formatMoney(s.avg_basket)} accent="var(--purple)" />
              <Kpi
                icon={<XCircle size={18} />}
                label="Taux d'annulation"
                value={formatPct(s.cancellation_rate)}
                accent="var(--orange)"
              />
              <Kpi
                icon={<AlertTriangle size={18} />}
                label="Litiges ouverts"
                value={formatNumber(s.disputes_open)}
                accent="var(--red)"
                sub={s.disputes_open > 0 ? 'À traiter dans Médiation' : 'Aucun litige en attente'}
                to={s.disputes_open > 0 ? '/mediation' : undefined}
              />
            </>
          )}
        </div>
      )}

      <div className="grid grid-2">
        <TrendChart />
        <Activity />
      </div>

      <div className="grid grid-2-even">
        <TopCategories />
        <Cities />
      </div>

      <RevenueSimulator />
    </div>
  );
}
