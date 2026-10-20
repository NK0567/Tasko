import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Clock, Gavel, KeyRound, MapPin, ShieldCheck, Star } from 'lucide-react';
import { jobsApi } from '../api/admin';
import { ApiError } from '../api/client';
import type { Job, JobClient, JobMode, JobProvider, JobStatus } from '../api/types';
import { TrustAlert, TrustLine } from '../components/trust';
import { Avatar, Badge, CatIcon, Empty, Loading, Modal, Pagination, PhotoGrid, QueryState, SearchInput } from '../components/ui';
import { rowActivate } from '../lib/a11y';
import { useDebounced } from '../lib/hooks';
import { formatDateTime, formatMoney, formatNumber, timeUntil } from '../lib/format';
import { BID_STATUS, CANCELLED_BY, COMPLETED_BY, JOB_MODE, JOB_STATUS, MILESTONE_STATUS, PAYMENT_STATUS, URGENCY } from '../lib/labels';

const LIMIT = 20;

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const m = JOB_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function JobModeBadge({ mode }: { mode: JobMode | undefined }) {
  if (!mode) return null;
  const m = JOB_MODE[mode] ?? { label: mode, tone: 'gray' as const, hint: '' };
  return (
    <span title={m.hint}>
      <Badge tone={m.tone}>{m.label}</Badge>
    </span>
  );
}

function Party({ title, client, provider }: { title: string; client?: JobClient; provider?: JobProvider | null }) {
  const p = client ?? provider ?? null;
  return (
    <div className="card card-pad" style={{ boxShadow: 'none', flex: '1 1 220px', minWidth: 0 }}>
      <div className="muted small" style={{ marginBottom: 8 }}>
        {title}
      </div>
      {p ? (
        <>
          <div className="who">
            <Avatar name={p.full_name} url={p.avatar_url} />
            <div style={{ minWidth: 0 }}>
              <div className="who-name">{p.full_name}</div>
              <div className="who-sub">
                {p.phone ?? 'Numéro masqué (paiement non sécurisé)'}
                {provider?.public_code ? ` · ${provider.public_code}` : ''}
              </div>
            </div>
          </div>
          {client && (
            <div style={{ marginTop: 8 }}>
              <TrustLine trust={client.trust} />
            </div>
          )}
          {provider && provider.rating_avg > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              <Star size={13} fill="#F5B700" color="#F5B700" aria-hidden /> {Number(provider.rating_avg).toFixed(1)}
              {provider.headline ? ` · ${provider.headline}` : ''}
            </div>
          )}
        </>
      ) : (
        <span className="muted">Pas encore attribué (demande diffusée ou appel d'offres ouvert)</span>
      )}
    </div>
  );
}

function Bids({ job }: { job: Job }) {
  const q = useQuery({ queryKey: ['jobs', job.id, 'bids'], queryFn: () => jobsApi.bids(job.id), retry: false });
  if (q.isLoading) return <Loading label="Chargement des offres…" />;
  if (q.isError) {
    const forbidden = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404);
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {forbidden
          ? `${formatNumber(job.bids_count ?? 0)} offre(s) reçue(s) — le détail des offres n'est pas exposé à l'admin par l'API.`
          : `Impossible de charger les offres : ${q.error instanceof Error ? q.error.message : ''}`}
      </p>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return <p className="muted small" style={{ margin: 0 }}>Aucune offre reçue pour l'instant.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Prestataire</th>
            <th className="right">Montant</th>
            <th className="right">Délai</th>
            <th>Jalons</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b) => {
            const st = BID_STATUS[b.status] ?? { label: b.status, tone: 'gray' as const };
            return (
              <tr key={b.id}>
                <td>
                  <div className="who">
                    <Avatar name={b.provider.full_name} url={b.provider.avatar_url} size={28} />
                    <div style={{ minWidth: 0 }}>
                      <div className="who-name">{b.provider.full_name}</div>
                      <div className="who-sub">
                        {b.provider.rating_avg ? `${Number(b.provider.rating_avg).toFixed(1)} ★ · ` : ''}
                        {b.provider.missions_completed != null ? `${formatNumber(b.provider.missions_completed)} missions` : ''}
                      </div>
                      {b.message && <div className="small muted" style={{ whiteSpace: 'normal' }}>« {b.message} »</div>}
                    </div>
                  </div>
                </td>
                <td className="right num strong">{formatMoney(b.amount)}</td>
                <td className="right num">{b.duration_days ? `${b.duration_days} j` : '—'}</td>
                <td className="small">{b.milestones.length > 0 ? b.milestones.map((m) => `${m.title} (${formatMoney(m.amount)})`).join(' · ') : '—'}</td>
                <td>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  const pay = PAYMENT_STATUS[job.payment_status] ?? { label: job.payment_status, tone: 'gray' as const };
  const milestones = [...(job.milestones ?? [])].sort((a, b) => a.position - b.position);
  return (
    <Modal title="Détail de la mission" onClose={onClose} large>
      <div className="row" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <CatIcon icon={job.category.icon} size={46} />
        <div className="grow">
          <h3 style={{ fontSize: 17 }}>{job.title}</h3>
          <div className="muted small">
            {job.category.parent_name ? `${job.category.parent_name} › ` : ''}
            {job.category.name} · créée le {formatDateTime(job.created_at)}
            {job.origin === 'provider_offer' ? ' · proposée par le prestataire' : ''}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <JobStatusBadge status={job.status} />
            <JobModeBadge mode={job.mode} />
            <Badge tone={pay.tone}>Paiement : {pay.label}</Badge>
            <Badge tone="gray">{URGENCY[job.urgency] ?? job.urgency}</Badge>
            {job.funds_secured && (
              <Badge tone="green">
                <ShieldCheck size={12} aria-hidden /> Fonds sécurisés
              </Badge>
            )}
          </div>
        </div>
      </div>
      {job.description && <p style={{ color: 'var(--gray-700)', marginTop: 0 }}>{job.description}</p>}
      <div className="row wrap muted small" style={{ marginBottom: 14, gap: 6 }}>
        <MapPin size={14} aria-hidden /> {job.address}
        {job.scheduled_at && <> · planifiée le {formatDateTime(job.scheduled_at)}</>}
        {job.property && (
          <>
            {' · '}
            <Building2 size={14} aria-hidden /> {job.property.name}
          </>
        )}
      </div>
      {job.photo_url && <PhotoGrid photos={[job.photo_url]} label="Photo de la demande" />}

      <div className="row wrap" style={{ alignItems: 'stretch', margin: '14px 0 16px' }}>
        <Party title="Client" client={job.client} />
        <Party title="Prestataire" provider={job.provider} />
      </div>

      {job.dispute && (
        <div className="notice" style={{ marginBottom: 14, background: 'var(--red-100)', color: 'var(--red)' }}>
          <Gavel size={16} style={{ flexShrink: 0 }} aria-hidden />
          <span>
            Litige {job.dispute.status === 'open' ? 'ouvert' : 'résolu'} : « {job.dispute.reason} » — à traiter dans Avis & Litiges.
          </span>
        </div>
      )}

      <div className="card card-pad" style={{ boxShadow: 'none' }}>
        <h3 style={{ marginBottom: 10 }}>Montants</h3>
        <dl className="dl">
          {job.mode === 'tender' && (job.budget_min != null || job.budget_max != null) ? (
            <>
              <dt>Budget indicatif</dt>
              <dd className="num">
                {formatMoney(job.budget_min)} – {formatMoney(job.budget_max)}
              </dd>
            </>
          ) : (
            <>
              <dt>Budget annoncé</dt>
              <dd className="num">{formatMoney(job.budget)}</dd>
            </>
          )}
          <dt>Prix de la prestation</dt>
          <dd className="num">{formatMoney(job.price)}</dd>
          <dt>Frais de service (client)</dt>
          <dd className="num">+ {formatMoney(job.service_fee)}</dd>
          <dt className="strong">Total payé par le client</dt>
          <dd className="num strong">{formatMoney(job.total)}</dd>
          <dt>Commission prestataire</dt>
          <dd className="num">− {formatMoney(job.provider_commission)}</dd>
          <dt className="strong">Versé au prestataire</dt>
          <dd className="num strong">{formatMoney(job.provider_payout)}</dd>
          {(job.cancellation_fee ?? 0) > 0 && (
            <>
              <dt>Frais d'annulation</dt>
              <dd className="num">{formatMoney(job.cancellation_fee)}</dd>
            </>
          )}
          <dt className="strong" style={{ color: 'var(--green-700)' }}>
            Revenu Tasko
          </dt>
          <dd className="num strong" style={{ color: 'var(--green-700)' }}>
            {formatMoney(job.service_fee + job.provider_commission)}
          </dd>
        </dl>
      </div>

      {milestones.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Jalons ({milestones.length})</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Jalon</th>
                  <th className="right">Montant</th>
                  <th>Statut</th>
                  <th>Libération auto</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const st = MILESTONE_STATUS[m.status] ?? { label: m.status, tone: 'gray' as const };
                  return (
                    <tr key={m.id}>
                      <td className="num">{m.position}</td>
                      <td>
                        {m.title}
                        {m.note && <div className="small muted">{m.note}</div>}
                        {m.proof_photos.length > 0 && <PhotoGrid photos={m.proof_photos} label={`Preuves du jalon ${m.title}`} />}
                      </td>
                      <td className="right num">{formatMoney(m.amount)}</td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="num small">
                        {m.released_at
                          ? `libéré ${formatDateTime(m.released_at)}`
                          : m.auto_release_at
                            ? `${formatDateTime(m.auto_release_at)} (${timeUntil(m.auto_release_at)})`
                            : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 style={{ margin: '16px 0 8px' }}>Chronologie & garanties</h3>
      <dl className="dl">
        <dt>Acceptée</dt>
        <dd>{formatDateTime(job.accepted_at)}</dd>
        <dt>Payée (séquestre)</dt>
        <dd>{formatDateTime(job.funded_at)}</dd>
        <dt>
          <KeyRound size={13} aria-hidden /> Code de démarrage
        </dt>
        <dd className="muted">Confidentiel (visible uniquement par le client)</dd>
        <dt>Démarrée</dt>
        <dd>{formatDateTime(job.started_at)}</dd>
        <dt>Terminée par le prestataire</dt>
        <dd>{formatDateTime(job.done_at)}</dd>
        <dt>
          <Clock size={13} aria-hidden /> Libération automatique
        </dt>
        <dd>
          {job.auto_release_at ? (
            <>
              {formatDateTime(job.auto_release_at)}
              {job.status === 'done' && <span className="muted"> ({timeUntil(job.auto_release_at)})</span>}
              {job.status === 'disputed' && <span style={{ color: 'var(--red)' }}> — gelée (litige)</span>}
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>Clôturée</dt>
        <dd>
          {formatDateTime(job.completed_at)}
          {job.completed_by && <div className="small muted">{COMPLETED_BY[job.completed_by] ?? job.completed_by}</div>}
        </dd>
        {job.status === 'cancelled' && (
          <>
            <dt>Annulée par</dt>
            <dd>
              {job.cancelled_by ? CANCELLED_BY[job.cancelled_by] ?? job.cancelled_by : '—'}
              {job.cancel_reason && <div className="small muted">« {job.cancel_reason} »</div>}
            </dd>
          </>
        )}
        {job.mode === 'tender' && (
          <>
            <dt>Clôture des offres</dt>
            <dd>
              {formatDateTime(job.bid_deadline)}
              {job.visibility && <div className="small muted">{job.visibility === 'public' ? 'Public' : 'Sur invitation'}</div>}
            </dd>
          </>
        )}
      </dl>

      {job.completion_proof && (job.completion_proof.photos.length > 0 || job.completion_proof.note) && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 6 }}>Preuve de fin</h3>
          {job.completion_proof.note && <p style={{ margin: 0 }}>{job.completion_proof.note}</p>}
          <PhotoGrid photos={job.completion_proof.photos} label="Preuve de fin" />
        </div>
      )}

      {job.mode === 'tender' && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Offres reçues ({formatNumber(job.bids_count ?? 0)})</h3>
          <Bids job={job} />
        </div>
      )}

      {job.review && (
        <div className="notice green" style={{ marginTop: 14 }}>
          <Star size={16} fill="#F5B700" color="#F5B700" aria-hidden />
          <span>
            <strong>{job.review.rating}/5</strong> {job.review.comment ? `— « ${job.review.comment} »` : ''}
          </span>
        </div>
      )}
    </Modal>
  );
}

export default function JobsPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<JobStatus | ''>(() => {
    const v = params.get('statut');
    return v && v in JOB_STATUS ? (v as JobStatus) : '';
  });
  const [mode, setMode] = useState<JobMode | ''>(() => {
    const v = params.get('mode');
    return v && v in JOB_MODE ? (v as JobMode) : '';
  });
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Job | null>(null);
  useEffect(() => setPage(1), [status, mode, q]);

  const filters = { status, mode, q, page, limit: LIMIT };
  const query = useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => jobsApi.list(filters),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Missions</h1>
          <p>Toutes les demandes et missions, du devis au paiement libéré.</p>
        </div>
        {query.data && <span className="badge tone-green" style={{ fontSize: 13 }}>{formatNumber(query.data.total)} missions</span>}
      </div>
      <div className="card">
        <div className="card-body toolbar" style={{ borderBottom: '1px solid var(--gray-200)' }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher (titre, adresse, client…)" />
          </div>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as JobMode | '')} aria-label="Filtrer par mode">
            <option value="">Tous les modes</option>
            {(Object.keys(JOB_MODE) as JobMode[]).map((k) => (
              <option key={k} value={k}>
                {JOB_MODE[k].label}
              </option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {(Object.keys(JOB_STATUS) as JobStatus[]).map((k) => (
              <option key={k} value={k}>
                {JOB_STATUS[k].label}
              </option>
            ))}
          </select>
        </div>
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={
            <Empty title="Aucune mission" icon={<Briefcase size={24} />}>
              <span>{status || mode || q ? 'Aucune mission ne correspond à ces filtres : élargissez la recherche.' : 'Les demandes des clients apparaîtront ici dès leur création.'}</span>
            </Empty>
          }>
          {(d) => (
            <>
              <div className="table-wrap" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mission</th>
                      <th>Mode</th>
                      <th>Client</th>
                      <th>Prestataire</th>
                      <th className="right">Total</th>
                      <th className="right">Revenu Tasko</th>
                      <th>Statut</th>
                      <th>Paiement</th>
                      <th>Libération</th>
                      <th>Créée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((j) => {
                      const pay = PAYMENT_STATUS[j.payment_status] ?? { label: j.payment_status, tone: 'gray' as const };
                      const nbMilestones = j.milestones?.length ?? 0;
                      return (
                        <tr key={j.id} className="clickable" {...rowActivate(() => setDetail(j))}>
                          <td>
                            <div className="who">
                              <CatIcon icon={j.category.icon} size={32} />
                              <div style={{ minWidth: 0, maxWidth: 260 }}>
                                <div className="who-name ellipsis">{j.title}</div>
                                <div className="who-sub ellipsis">
                                  {j.address}
                                  {nbMilestones > 0 ? ` · ${nbMilestones} jalons` : ''}
                                  {j.mode === 'tender' ? ` · ${formatNumber(j.bids_count ?? 0)} offre(s)` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <JobModeBadge mode={j.mode} />
                          </td>
                          <td>
                            <div className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                              {j.client.full_name}
                              <TrustAlert trust={j.client.trust} />
                            </div>
                          </td>
                          <td>{j.provider?.full_name ?? <span className="muted">—</span>}</td>
                          <td className="right num">{formatMoney(j.total)}</td>
                          <td className="right num" style={{ color: 'var(--green-700)', fontWeight: 600 }}>
                            {formatMoney(j.service_fee + j.provider_commission)}
                          </td>
                          <td>
                            <JobStatusBadge status={j.status} />
                          </td>
                          <td>
                            <Badge tone={pay.tone}>{pay.label}</Badge>
                          </td>
                          <td className="num small">
                            {j.status === 'done' && j.auto_release_at ? (
                              <span title={formatDateTime(j.auto_release_at)}>auto {timeUntil(j.auto_release_at)}</span>
                            ) : j.completed_by ? (
                              <span className="muted">{COMPLETED_BY[j.completed_by] ?? j.completed_by}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="num muted">{formatDateTime(j.created_at)}</td>
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
      {detail && <JobDetail job={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
