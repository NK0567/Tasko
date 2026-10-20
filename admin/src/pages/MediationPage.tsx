import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, FolderOpen } from 'lucide-react';
import { disputesApi } from '../api/admin';
import type { Dispute, DisputeKind, DisputeStatus } from '../api/types';
import { TrustAlert } from '../components/trust';
import { Badge, CatIcon, Empty, Help, QueryState } from '../components/ui';
import { formatDateTime, formatMoney, timeUntil } from '../lib/format';
import { DISPUTE_KIND, DISPUTE_STATUS, RESOLUTION, isUrgent } from '../lib/labels';
import DisputeFile from './mediation/DisputeFile';
import Reviews from './mediation/Reviews';

type Tab = 'open' | 'pending_confirmation' | 'resolved' | 'reviews';
const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'À traiter' },
  { key: 'pending_confirmation', label: 'À confirmer' },
  { key: 'resolved', label: 'Clos' },
  { key: 'reviews', label: 'Avis' },
];

/** Tri par urgence : échéance de décision la plus proche d'abord (sans échéance : à la fin). */
function byUrgency(a: Dispute, b: Dispute) {
  const ta = a.decision_due_at ? new Date(a.decision_due_at).getTime() : Infinity;
  const tb = b.decision_due_at ? new Date(b.decision_due_at).getTime() : Infinity;
  return ta - tb || a.created_at.localeCompare(b.created_at);
}

function DisputeList({ status, kind, onOpen }: { status: DisputeStatus; kind: DisputeKind | ''; onOpen: (d: Dispute) => void }) {
  const query = useQuery({ queryKey: ['disputes', status, kind], queryFn: () => disputesApi.list(status, kind), refetchInterval: 30_000 });
  const emptyText: Record<DisputeStatus, string> = {
    open: 'Aucun litige à traiter. L’argent bloqué suit son cours normal.',
    pending_confirmation: 'Aucune décision n’attend de second avis.',
    resolved: 'Aucun litige clos pour ce filtre.',
  };
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.items.length === 0}
      empty={
        <Empty title={status === 'open' ? 'Rien à traiter' : 'Aucun dossier'} icon={<CheckCircle2 size={24} />}>
          <span>{emptyText[status]}</span>
        </Empty>
      }
    >
      {(data) => (
        <ul className="dispute-list">
          {[...data.items].sort(status === 'resolved' ? (a, b) => b.created_at.localeCompare(a.created_at) : byUrgency).map((d) => {
            const urgent = d.status !== 'resolved' && isUrgent(d.decision_due_at);
            const kindMeta = d.kind ? DISPUTE_KIND[d.kind] : null;
            const pending = d.proposals?.find((p) => p.status === 'pending');
            return (
              <li key={d.id} className={urgent ? 'urgent' : undefined}>
                <CatIcon icon={d.job.category.icon} />
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="strong">{d.job.title}</span>
                    {kindMeta && (
                      <span title={kindMeta.hint}>
                        <Badge tone="purple">{kindMeta.label}</Badge>
                      </span>
                    )}
                    {d.status === 'resolved' && d.resolution && <Badge tone={RESOLUTION[d.resolution].tone}>{RESOLUTION[d.resolution].label}</Badge>}
                    {pending && <Badge tone="orange">Proposition en attente</Badge>}
                    <TrustAlert trust={d.job.client.trust} />
                  </div>
                  <div className="small muted">
                    {d.job.client.full_name} (client) · {d.job.provider?.full_name ?? '—'} (prestataire) · <strong className="num">{formatMoney(d.job.total)}</strong> bloqués
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    « {d.reason} » <span className="muted">— {d.opened_by.full_name}, {formatDateTime(d.created_at)}</span>
                  </div>
                  {d.status === 'pending_confirmation' && d.decided_by && (
                    <div className="small" style={{ marginTop: 4 }}>
                      Décision de {d.decided_by.full_name} : <strong>{d.resolution ? RESOLUTION[d.resolution].label : '—'}</strong>
                    </div>
                  )}
                </div>
                <div className="dispute-actions">
                  {d.status !== 'resolved' && d.decision_due_at && (
                    <span className={`countdown${urgent ? ' urgent' : ''}`} title={`Échéance : ${formatDateTime(d.decision_due_at)}`}>
                      <Clock size={14} aria-hidden /> {timeUntil(d.decision_due_at)}
                    </span>
                  )}
                  <button type="button" className={`btn btn-sm${d.status === 'resolved' ? ' btn-secondary' : ''}`} onClick={() => onOpen(d)}>
                    <FolderOpen size={14} /> {d.status === 'open' ? 'Traiter' : d.status === 'pending_confirmation' ? 'Vérifier' : 'Consulter'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </QueryState>
  );
}

export default function MediationPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('onglet'))?.key ?? 'open') as Tab;
  const [kind, setKind] = useState<DisputeKind | ''>('');
  const [open, setOpen] = useState<Dispute | null>(null);
  const openQ = useQuery({ queryKey: ['disputes', 'open', ''], queryFn: () => disputesApi.list('open'), refetchInterval: 30_000 });
  const confirmQ = useQuery({ queryKey: ['disputes', 'pending_confirmation', ''], queryFn: () => disputesApi.list('pending_confirmation'), refetchInterval: 30_000 });
  const counts: Partial<Record<Tab, number>> = { open: openQ.data?.items.length, pending_confirmation: confirmQ.data?.items.length };
  const urgentCount = (openQ.data?.items ?? []).filter((d) => isUrgent(d.decision_due_at)).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Médiation <Help label="Médiation">Quand un client et un prestataire ne sont pas d'accord, l'argent reste bloqué. Vous échangez avec eux dans un salon à trois, proposez un accord ou tranchez avant l'échéance.</Help>
          </h1>
          <p>Litiges entre clients et prestataires : écoutez les deux parties, proposez un accord ou décidez.</p>
        </div>
        {urgentCount > 0 && (
          <Badge tone="red">
            <Clock size={12} aria-hidden /> {urgentCount} urgent{urgentCount > 1 ? 's' : ''} (moins de 12 h)
          </Badge>
        )}
      </div>

      <div className="card">
        <div className="card-body toolbar" style={{ borderBottom: '1px solid var(--gray-200)' }}>
          <div className="tabs" role="tablist" aria-label="Dossiers">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setParams(t.key === 'open' ? {} : { onglet: t.key }, { replace: true })}
              >
                {t.label}
                {(counts[t.key] ?? 0) > 0 && <span className={`chip-count${t.key === 'pending_confirmation' ? ' orange' : ''}`}>{counts[t.key]}</span>}
              </button>
            ))}
          </div>
          {tab !== 'reviews' && (
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DisputeKind | '')} aria-label="Filtrer par type de litige">
              <option value="">Tous les types</option>
              {(Object.keys(DISPUTE_KIND) as DisputeKind[]).map((k) => (
                <option key={k} value={k}>
                  {DISPUTE_KIND[k].label}
                </option>
              ))}
            </select>
          )}
        </div>
        {tab === 'reviews' ? (
          <Reviews />
        ) : (
          <>
            {tab === 'pending_confirmation' && (
              <p className="small muted" style={{ margin: '12px 18px 0' }}>
                Décisions au-delà du seuil de double validation : elles doivent être confirmées par un administrateur différent de celui qui a décidé. Statut : {DISPUTE_STATUS.pending_confirmation.label}.
              </p>
            )}
            <DisputeList status={tab} kind={kind} onOpen={setOpen} />
          </>
        )}
      </div>
      {open && <DisputeFile dispute={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
