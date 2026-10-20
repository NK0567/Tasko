import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { treasuryApi } from '../../api/admin';
import type { LedgerPoint } from '../../api/types';
import { Empty, QueryState } from '../../components/ui';
import { formatCompact, formatDay, formatMoney } from '../../lib/format';

type Serie = Exclude<keyof LedgerPoint, 'date'>;
/** Ordre catégoriel fixe (palette validée daltonisme) — la couleur suit la série, jamais son rang. */
const SERIES: { key: Serie; label: string; color: string }[] = [
  { key: 'escrow_in', label: 'Paiements clients reçus', color: '#2a78d6' },
  { key: 'payouts', label: 'Versements aux prestataires', color: '#eb6834' },
  { key: 'refunds', label: 'Remboursements clients', color: '#1baf7a' },
  { key: 'revenue', label: 'Revenus Tasko', color: '#eda100' },
  { key: 'withdrawals', label: 'Vos retraits', color: '#e87ba4' },
];
const LABEL: Record<string, string> = Object.fromEntries(SERIES.map((s) => [s.key, s.label]));

export default function LedgerChart() {
  const q = useQuery({ queryKey: ['treasury', 'ledger', 30], queryFn: () => treasuryApi.ledger(30), refetchInterval: 60_000 });
  const [table, setTable] = useState(false);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Mouvements d'argent — 30 derniers jours</h2>
          <div className="muted small">Ce qui entre et sort du coffre Tasko chaque jour.</div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'Voir le graphique' : 'Voir en tableau'}
        </button>
      </div>
      <div className="card-body">
        <QueryState query={q} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucun mouvement sur la période" />}>
          {(d) =>
            table ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Jour</th>
                      {SERIES.map((s) => (
                        <th key={s.key} className="right">
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((p) => (
                      <tr key={p.date}>
                        <td className="num">{formatDay(p.date)}</td>
                        {SERIES.map((s) => (
                          <td key={s.key} className="right num">
                            {formatMoney(p[s.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={d.items} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                      formatter={(v: number, name: string) => [formatMoney(v), LABEL[name] ?? name]}
                    />
                    <Legend
                      formatter={(value: string) => <span style={{ color: '#3C4A43', fontSize: 12 }}>{LABEL[value] ?? value}</span>}
                      iconType="plainline"
                    />
                    {SERIES.map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        stroke={s.color}
                        strokeWidth={s.key === 'revenue' ? 2.5 : 2}
                        dot={false}
                        activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          }
        </QueryState>
      </div>
    </div>
  );
}
