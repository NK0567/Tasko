import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { statsApi, transactionsApi } from '../api/admin';
import type { TransactionStatus, TransactionType } from '../api/types';
import { Badge, Empty, Pagination, QueryState } from '../components/ui';
import { formatDateTime, formatMoney, formatNumber } from '../lib/format';
import { TX_METHOD, TX_OUTFLOW, TX_REVENUE, TX_STATUS, TX_TYPE } from '../lib/labels';
import { providerLabel } from '../lib/providers';

const LIMIT = 25;

function HeaderTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card card-pad">
      <div className="muted small">{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-title)' }}>
        {value}
      </div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export default function TransactionsPage() {
  const [search] = useSearchParams();
  const [type, setType] = useState<TransactionType | ''>(() => {
    const v = search.get('type');
    return v && v in TX_TYPE ? (v as TransactionType) : '';
  });
  const [status, setStatus] = useState<TransactionStatus | ''>(() => {
    const v = search.get('status');
    return v && v in TX_STATUS ? (v as TransactionStatus) : '';
  });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [type, status]);

  const params = { type, status, page, limit: LIMIT };
  const query = useQuery({
    queryKey: ['transactions', params],
    queryFn: () => transactionsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const stats = useQuery({ queryKey: ['stats'], queryFn: statsApi.overview, refetchInterval: 30_000 });
  const commissions = useQuery({
    queryKey: ['transactions', 'commission-count'],
    queryFn: () => transactionsApi.list({ type: 'commission', status: 'success', page: 1, limit: 1 }),
  });

  const pageCommissions = (query.data?.items ?? [])
    .filter((t) => t.type === 'commission' && t.status === 'success')
    .reduce((a, t) => a + t.amount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p>Séquestre, versements, commissions, remboursements, abonnements et boosts.</p>
        </div>
      </div>

      <div className="grid grid-kpi">
        <HeaderTile label="Revenus Tasko — aujourd'hui" value={stats.data ? formatMoney(stats.data.revenue_today) : '…'} />
        <HeaderTile label="Revenus Tasko — ce mois" value={stats.data ? formatMoney(stats.data.revenue_month) : '…'} />
        <HeaderTile
          label="Commissions sur cette page"
          value={formatMoney(pageCommissions)}
          sub={commissions.data ? `${formatNumber(commissions.data.total)} transactions de commission réussies au total` : undefined}
        />
      </div>

      <div className="card">
        <div className="card-body toolbar" style={{ borderBottom: '1px solid var(--gray-200)' }}>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as TransactionType | '')} aria-label="Filtrer par type">
            <option value="">Tous les types</option>
            {(Object.keys(TX_TYPE) as TransactionType[]).map((k) => (
              <option key={k} value={k}>
                {TX_TYPE[k].label}
              </option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TransactionStatus | '')} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {(Object.keys(TX_STATUS) as TransactionStatus[]).map((k) => (
              <option key={k} value={k}>
                {TX_STATUS[k].label}
              </option>
            ))}
          </select>
          {query.data && <span className="muted small">{formatNumber(query.data.total)} transactions</span>}
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <Empty title="Aucune transaction" icon={<ArrowLeftRight size={24} />}>
              <span>{type || status ? 'Aucune transaction pour ces filtres.' : 'Les paiements, versements et remboursements apparaîtront ici.'}</span>
            </Empty>
          }
        >
          {(d) => (
            <>
              <div className="table-wrap" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Utilisateur</th>
                      <th>Moyen</th>
                      <th>Référence</th>
                      <th>Statut</th>
                      <th className="right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((t) => {
                      const ty = TX_TYPE[t.type] ?? { label: t.type, tone: 'gray' as const };
                      const st = TX_STATUS[t.status] ?? { label: t.status, tone: 'gray' as const };
                      const outflow = TX_OUTFLOW.has(t.type);
                      return (
                        <tr key={t.id}>
                          <td className="num muted">{formatDateTime(t.created_at)}</td>
                          <td>
                            <Badge tone={ty.tone}>{ty.label}</Badge>
                          </td>
                          <td>
                            <div className="who-name">{t.user_name ?? '—'}</div>
                            {t.phone && <div className="who-sub">{t.phone}</div>}
                          </td>
                          <td>
                            {t.method ? TX_METHOD[t.method] ?? t.method : '—'}
                            <div className="who-sub">{t.provider === 'mock' ? 'Simulé (mock)' : providerLabel(t.provider)}</div>
                          </td>
                          <td className="small muted" style={{ fontFamily: 'ui-monospace, monospace' }}>
                            {t.external_ref ?? '—'}
                          </td>
                          <td>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </td>
                          <td className="right num strong" style={{ color: TX_REVENUE.has(t.type) ? 'var(--green-700)' : outflow ? 'var(--gray-700)' : undefined }}>
                            {outflow ? '− ' : ''}
                            {formatMoney(t.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={d.page || page} limit={d.limit || LIMIT} total={d.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </div>
    </div>
  );
}
