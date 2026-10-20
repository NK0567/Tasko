import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { auditApi } from '../api/admin';
import type { AuditLog } from '../api/types';
import { Empty, Help, Pagination, QueryState } from '../components/ui';
import { formatDateTime, formatMoney } from '../lib/format';

const LIMIT = 30;

/** Libellés lisibles des actions courantes ; les autres sont affichées telles quelles. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Connexion',
  'treasury.withdrawal': 'Retrait des revenus',
  'treasury.withdrawal.request': 'Demande de retrait',
  'payout_account.create': 'Ajout d’un compte de versement',
  'payout_account.update': 'Modification d’un compte de versement',
  'payout_account.delete': 'Suppression d’un compte de versement',
  'dispute.resolve': 'Décision sur un litige',
  'dispute.confirm': 'Confirmation d’une décision',
  'dispute.proposal': 'Proposition d’accord',
  'settings.update': 'Modification des paramètres',
  'user.update': 'Modification d’un utilisateur',
  'category.create': 'Création de catégorie',
  'category.update': 'Modification de catégorie',
  'category.delete': 'Suppression de catégorie',
};

/** Résumé lisible des détails JSON ; les montants (clés amount / *_amount) sont formatés en FCFA. */
function renderDetails(details: AuditLog['details']): string {
  if (details == null) return '—';
  if (typeof details === 'string') return details;
  return Object.entries(details)
    .filter(([k]) => !/password|token|secret|account_number|phone/i.test(k))
    .map(([k, v]) => {
      const val = typeof v === 'number' && /amount|fee|price|min/i.test(k) ? formatMoney(v) : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k} : ${val}`;
    })
    .join(' · ');
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => auditApi.list({ page, limit: LIMIT }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Journal d'audit{' '}
            <Help label="Journal d'audit">
              Trace non modifiable de toutes les actions sensibles des administrateurs (retraits, décisions de litige, réglages…), avec l'auteur, l'heure et l'adresse IP.
            </Help>
          </h1>
          <p>Qui a fait quoi, et quand, dans le back-office.</p>
        </div>
      </div>
      <div className="card">
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <Empty title="Journal vide" icon={<ScrollText size={24} />}>
              <span>Les actions sensibles (retraits, décisions, réglages) apparaîtront ici automatiquement.</span>
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
                      <th>Administrateur</th>
                      <th>Action</th>
                      <th>Cible</th>
                      <th>Détails</th>
                      <th>Adresse IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((l) => (
                      <tr key={l.id}>
                        <td className="num muted">{formatDateTime(l.created_at)}</td>
                        <td className="strong">{l.actor?.full_name ?? 'Système'}</td>
                        <td>
                          {ACTION_LABELS[l.action] ?? l.action}
                          {ACTION_LABELS[l.action] && <div className="who-sub" style={{ fontFamily: 'ui-monospace, monospace' }}>{l.action}</div>}
                        </td>
                        <td className="small">{l.target ?? '—'}</td>
                        <td className="small" style={{ maxWidth: 360, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                          {renderDetails(l.details)}
                        </td>
                        <td className="small muted" style={{ fontFamily: 'ui-monospace, monospace' }}>
                          {l.ip ?? '—'}
                        </td>
                      </tr>
                    ))}
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
