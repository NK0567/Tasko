import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Clock, Gavel, Handshake, Lock, Star, UserX } from 'lucide-react';
import { disputesApi, settingsApi } from '../../api/admin';
import type { Dispute, DisputeEvidence, DisputeResolution, ResolveDisputeInput } from '../../api/types';
import { useAuth } from '../../auth/context';
import { useConfirm, useToast } from '../../components/feedback-context';
import { TrustLine } from '../../components/trust';
import { Avatar, Badge, Help, Modal, PhotoGrid, Spinner } from '../../components/ui';
import { formatDateTime, formatMoney, formatNumber, parseAmount, timeUntil } from '../../lib/format';
import { DISPUTE_KIND, DISPUTE_STATUS, MILESTONE_STATUS, RESOLUTION, RESOLVED_BY, isUrgent } from '../../lib/labels';
import { JobModeBadge, JobStatusBadge } from '../JobsPage';
import MediationRoom, { ProposalCard } from './MediationRoom';

type Side = 'client' | 'provider' | 'other';
const SIDE_LABEL: Record<Side, string> = { client: 'client', provider: 'prestataire', other: 'équipe Tasko' };

function sideOf(d: Dispute, authorId: string): Side {
  if (authorId === d.job.client.id) return 'client';
  if (d.job.provider && authorId === d.job.provider.id) return 'provider';
  return 'other';
}

/** Montant séquestré concerné par le litige (jalon contesté, sinon la mission). */
function heldAmount(d: Dispute): number {
  const m = d.milestone_id ? d.job.milestones?.find((x) => x.id === d.milestone_id) : undefined;
  return m ? m.amount + m.service_fee : d.job.total;
}

function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="dossier-section">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' }}>
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Choice({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" className="choice" role="radio" aria-checked={active} onClick={onClick}>
      <div className="strong">{title}</div>
      <div className="small muted">{desc}</div>
    </button>
  );
}

/** Montant au prestataire : curseur + champ, borné à [0, max]. */
function AmountPicker({ id, max, value, onChange, error }: { id: string; max: number; value: string; onChange: (v: string) => void; error: string }) {
  const n = parseAmount(value);
  return (
    <div className="field">
      <label htmlFor={id}>Montant versé au prestataire (FCFA)</label>
      <input
        type="range"
        min={0}
        max={max}
        step={Math.max(1, Math.round(max / 100))}
        value={n ?? 0}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Curseur : montant au prestataire"
      />
      <input
        id={id}
        className={`input${error ? ' invalid' : ''}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        style={{ maxWidth: 220 }}
      />
      <span id={`${id}-help`} className={error ? 'field-error' : 'hint'}>
        {error || `Entre 0 et ${formatMoney(max)} (argent bloqué concerné).`}
      </span>
    </div>
  );
}

function Split({ provider, client, providerName, clientName }: { provider: number; client: number; providerName: string; clientName: string }) {
  const total = Math.max(1, provider + client);
  return (
    <div className="card card-pad" style={{ boxShadow: 'none', background: 'var(--gray-100)' }}>
      <div className="split-bar" aria-hidden>
        <span style={{ width: `${(provider / total) * 100}%`, background: 'var(--green-700)' }} />
        <span style={{ width: `${(client / total) * 100}%`, background: 'var(--orange)' }} />
      </div>
      <dl className="dl" style={{ marginTop: 8 }}>
        <dt>
          <span className="dot" style={{ background: 'var(--green-700)' }} /> {providerName} (prestataire)
        </dt>
        <dd className="num strong">{formatMoney(provider)}</dd>
        <dt>
          <span className="dot" style={{ background: 'var(--orange)' }} /> {clientName} (remboursement)
        </dt>
        <dd className="num strong">{formatMoney(client)}</dd>
      </dl>
    </div>
  );
}

function ProposeForm({ d, onDone }: { d: Dispute; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const held = heldAmount(d);
  const [amountRaw, setAmountRaw] = useState(String(Math.round(held / 2)));
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const amount = parseAmount(amountRaw);
  const amountErr = amount === null || amount > held ? `Entre 0 et ${formatMoney(held)}.` : '';
  const msgErr = message.trim().length < 5 ? 'Expliquez la proposition aux deux parties.' : '';

  const mut = useMutation({
    mutationFn: () => disputesApi.propose(d.id, { provider_amount: amount ?? 0, message: message.trim() }),
    onSuccess: () => {
      toast.success('Proposition publiée dans le salon. Elle sera exécutée si les deux parties l’acceptent.');
      void qc.invalidateQueries({ queryKey: ['disputes'] });
      onDone();
    },
    onError: (e) => toast.error(e),
  });

  async function submit() {
    setTouched(true);
    if (amountErr || msgErr) return;
    const ok = await confirm({
      title: 'Publier cette proposition ?',
      message: (
        <>
          <p style={{ marginTop: 0 }}>
            Si le client <strong>et</strong> le prestataire acceptent, l'argent est réparti automatiquement. Elle remplace toute proposition en cours.
          </p>
          <Split provider={amount ?? 0} client={held - (amount ?? 0)} providerName={d.job.provider?.full_name ?? 'Prestataire'} clientName={d.job.client.full_name} />
        </>
      ),
      confirmLabel: 'Publier',
    });
    if (ok) mut.mutate();
  }

  return (
    <div className="card card-pad" style={{ boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <AmountPicker id="prop-amount" max={held} value={amountRaw} onChange={setAmountRaw} error={touched ? amountErr : ''} />
      {!amountErr && <Split provider={amount ?? 0} client={held - (amount ?? 0)} providerName={d.job.provider?.full_name ?? 'Prestataire'} clientName={d.job.client.full_name} />}
      <div className="field">
        <label htmlFor="prop-msg">Message aux parties</label>
        <textarea
          id="prop-msg"
          className={`input${touched && msgErr ? ' invalid' : ''}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ex. : le travail est fait à moitié, je propose 3 000 FCFA au prestataire et 2 000 FCFA remboursés."
        />
        {touched && msgErr && <span className="field-error">{msgErr}</span>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          Annuler
        </button>
        <button type="button" className="btn" onClick={() => void submit()} disabled={mut.isPending}>
          {mut.isPending ? <Spinner small /> : <Handshake size={16} />} Publier la proposition
        </button>
      </div>
    </div>
  );
}

function Decide({ d, onDone, threshold }: { d: Dispute; onDone: () => void; threshold: number | undefined }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const held = heldAmount(d);
  const payout = Math.min(held, d.job.provider_payout);
  const [resolution, setResolution] = useState<DisputeResolution | null>(null);
  const [amountRaw, setAmountRaw] = useState(String(Math.round(held / 2)));
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const amount = parseAmount(amountRaw);
  const amountErr = resolution === 'split' && (amount === null || amount > held) ? `Entre 0 et ${formatMoney(held)}.` : '';
  const noteErr = note.trim().length < 10 ? 'Motif obligatoire (10 caractères minimum) : il est publié dans le salon.' : '';
  const preview =
    resolution === 'release'
      ? { provider: payout, client: 0 }
      : resolution === 'refund'
        ? { provider: 0, client: held }
        : resolution === 'split' && !amountErr
          ? { provider: amount ?? 0, client: held - (amount ?? 0) }
          : null;
  const needsSecond = threshold !== undefined && held > threshold;
  const providerName = d.job.provider?.full_name ?? 'Prestataire';

  const mut = useMutation({
    mutationFn: (input: ResolveDisputeInput) => disputesApi.resolve(d.id, input),
    onSuccess: (r) => {
      toast.success(
        r.status === 'pending_confirmation'
          ? 'Décision enregistrée : elle attend la confirmation d’un second administrateur.'
          : 'Décision appliquée : l’argent a été réparti.',
      );
      void qc.invalidateQueries({ queryKey: ['disputes'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['treasury'] });
      onDone();
    },
    onError: (e) => toast.error(e),
  });

  async function submit() {
    setTouched(true);
    if (!resolution || amountErr || noteErr || !preview) return;
    const ok = await confirm({
      title: 'Appliquer cette décision ?',
      message: (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{RESOLUTION[resolution].label}</strong>. Le motif sera publié dans le salon.{' '}
            {needsSecond ? 'Montant au-delà du seuil : un second administrateur devra confirmer avant tout mouvement d’argent.' : 'L’argent bloqué sera déplacé immédiatement.'}
          </p>
          <Split provider={preview.provider} client={preview.client} providerName={providerName} clientName={d.job.client.full_name} />
        </>
      ),
      confirmLabel: needsSecond ? 'Soumettre à confirmation' : 'Appliquer la décision',
      danger: true,
    });
    if (!ok) return;
    mut.mutate({ resolution, note: note.trim(), ...(resolution === 'split' ? { provider_amount: amount ?? 0 } : {}) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="radiogroup" aria-label="Décision" className="row wrap" style={{ alignItems: 'stretch', gap: 8 }}>
        <Choice active={resolution === 'release'} onClick={() => setResolution('release')} title="Payer le prestataire" desc={`${providerName} reçoit ${formatMoney(payout)}.`} />
        <Choice active={resolution === 'refund'} onClick={() => setResolution('refund')} title="Rembourser le client" desc={`${d.job.client.full_name} récupère ${formatMoney(held)}.`} />
        <Choice active={resolution === 'split'} onClick={() => setResolution('split')} title="Partager" desc="Une part au prestataire, le reste remboursé." />
      </div>
      {touched && !resolution && (
        <div className="field-error" role="alert">
          Choisissez une décision.
        </div>
      )}
      {resolution === 'split' && <AmountPicker id="dec-amount" max={held} value={amountRaw} onChange={setAmountRaw} error={amountErr} />}
      {preview && <Split provider={preview.provider} client={preview.client} providerName={providerName} clientName={d.job.client.full_name} />}
      {needsSecond && (
        <div className="notice">
          <CheckCheck size={16} style={{ flexShrink: 0 }} aria-hidden />
          <span>
            Montant supérieur à {formatMoney(threshold)} : un <strong>second administrateur</strong> devra confirmer la décision (double validation).
          </span>
        </div>
      )}
      <div className="field">
        <label htmlFor="dec-note">
          Motif de la décision <span className="req">*</span>
        </label>
        <textarea
          id="dec-note"
          className={`input${touched && noteErr ? ' invalid' : ''}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ce que vous avez constaté (messages, photos, chronologie) et pourquoi vous tranchez ainsi."
          aria-invalid={touched && !!noteErr}
          aria-describedby="dec-note-help"
        />
        <span id="dec-note-help" className={touched && noteErr ? 'field-error' : 'hint'}>
          {touched && noteErr ? noteErr : 'Visible par le client et le prestataire.'}
        </span>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-danger" disabled={mut.isPending} onClick={() => void submit()}>
          {mut.isPending ? <Spinner small /> : <Gavel size={16} />} {needsSecond ? 'Soumettre la décision' : 'Appliquer la décision'}
        </button>
      </div>
    </div>
  );
}

function ConfirmDecision({ d, onDone }: { d: Dispute; onDone: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const own = !!user && d.decided_by?.id === user.id;
  const held = heldAmount(d);
  const provider = d.resolution === 'release' ? Math.min(held, d.job.provider_payout) : d.resolution === 'refund' ? 0 : d.provider_amount ?? 0;
  const client = d.resolution === 'refund' ? held : d.resolution === 'split' ? held - provider : 0;
  const mut = useMutation({
    mutationFn: () => disputesApi.confirm(d.id),
    onSuccess: () => {
      toast.success('Décision confirmée : l’argent a été réparti.');
      void qc.invalidateQueries({ queryKey: ['disputes'] });
      void qc.invalidateQueries({ queryKey: ['treasury'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      onDone();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0 }}>
        <strong>{d.decided_by?.full_name ?? 'Un administrateur'}</strong> propose : <strong>{d.resolution ? RESOLUTION[d.resolution].label : '—'}</strong>
      </p>
      {d.resolution_note && <blockquote className="quote">{d.resolution_note}</blockquote>}
      <Split provider={provider} client={client} providerName={d.job.provider?.full_name ?? 'Prestataire'} clientName={d.job.client.full_name} />
      {own ? (
        <div className="notice" role="note">
          Vous avez pris cette décision : elle doit être confirmée par un <strong>autre</strong> administrateur (règle des quatre yeux).
        </div>
      ) : (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-danger"
            disabled={mut.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Confirmer la décision ?',
                message: 'L’argent bloqué sera immédiatement réparti comme indiqué. Cette action est définitive.',
                confirmLabel: 'Confirmer et exécuter',
                danger: true,
              });
              if (ok) mut.mutate();
            }}
          >
            {mut.isPending ? <Spinner small /> : <CheckCheck size={16} />} Confirmer la décision
          </button>
        </div>
      )}
    </div>
  );
}

function EvidenceList({ d, items }: { d: Dispute; items: DisputeEvidence[] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Preuves déposées">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((e, i) => (
          <div key={`${e.created_at}-${i}`}>
            <div className="small muted">
              {e.author.full_name} ({SIDE_LABEL[sideOf(d, e.author.id)]}) · {formatDateTime(e.created_at)}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{e.message}</div>
            <PhotoGrid photos={e.photos ?? []} label={`Preuve de ${e.author.full_name}`} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function DisputeFile({ dispute, onClose }: { dispute: Dispute; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['disputes', 'detail', dispute.id], queryFn: () => disputesApi.get(dispute.id), retry: false });
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [panel, setPanel] = useState<'none' | 'propose'>('none');
  const d: Dispute = detail.data ? { ...dispute, ...detail.data, job: { ...dispute.job, ...detail.data.job } } : dispute;
  const job = d.job;
  const held = heldAmount(d);
  const kind = d.kind ? DISPUTE_KIND[d.kind] : null;
  const st = DISPUTE_STATUS[d.status] ?? { label: d.status, tone: 'gray' as const };
  const urgent = d.status !== 'resolved' && isUrgent(d.decision_due_at);
  const proposals = [...(d.proposals ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const current = proposals.find((p) => p.status === 'pending');
  const milestone = d.milestone_id ? job.milestones?.find((m) => m.id === d.milestone_id) : undefined;
  const provider = job.provider;

  const timeline = [
    { at: job.funded_at, label: `Paiement sécurisé : ${formatMoney(job.total)} bloqués` },
    { at: job.arrival_deadline, label: 'Heure limite d’arrivée du prestataire' },
    { at: job.started_at, label: 'Travail démarré (code de démarrage saisi)' },
    { at: job.done_at, label: 'Déclaré terminé par le prestataire' },
    { at: d.created_at, label: `Litige ouvert par ${d.opened_by.full_name}` },
    { at: d.respond_before, label: 'Échéance de réponse des parties' },
    { at: d.decision_due_at, label: 'Échéance de décision Tasko' },
    { at: d.resolved_at, label: 'Litige clos' },
  ]
    .filter((t): t is { at: string; label: string } => !!t.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const now = new Date().toISOString();

  return (
    <Modal title="Dossier de médiation" onClose={onClose} size="xl">
      <div className="dossier">
        <div className="dossier-main">
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span className="cat-icon" style={{ width: 42, height: 42, background: 'var(--red-100)', color: 'var(--red)' }}>
              {d.kind === 'no_show' ? <UserX size={20} aria-hidden /> : <Gavel size={20} aria-hidden />}
            </span>
            <div className="grow">
              <h3 style={{ fontSize: 17 }}>{job.title}</h3>
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <Badge tone={st.tone}>{st.label}</Badge>
                {kind && (
                  <span title={kind.hint}>
                    <Badge tone="purple">{kind.label}</Badge>
                  </span>
                )}
                <JobStatusBadge status={job.status} />
                <JobModeBadge mode={job.mode} />
              </div>
            </div>
          </div>

          {d.status !== 'resolved' && d.decision_due_at && (
            <div className={`deadline${urgent ? ' urgent' : ''}`} role="status">
              <Clock size={18} aria-hidden />
              <div>
                <div className="strong">Décision attendue {timeUntil(d.decision_due_at)}</div>
                <div className="small">Échéance : {formatDateTime(d.decision_due_at)}</div>
              </div>
            </div>
          )}

          <div className="notice" style={{ marginTop: 12 }}>
            <span>
              <strong>{d.opened_by.full_name}</strong> ({SIDE_LABEL[sideOf(d, d.opened_by.id)]}), {formatDateTime(d.created_at)} : « {d.reason} »
            </span>
          </div>
          <PhotoGrid photos={d.photos ?? []} label="Photo jointe au litige" />

          <Section
            title={
              <>
                Argent bloqué <Help label="Argent bloqué">Somme payée par le client et gardée par Tasko. Elle ne bouge qu'après accord des deux parties ou décision de l'équipe Tasko.</Help>
              </>
            }
          >
            <dl className="dl">
              <dt>
                <Lock size={13} aria-hidden /> {milestone ? `Jalon « ${milestone.title} »` : 'Total bloqué'}
              </dt>
              <dd className="num strong">{formatMoney(held)}</dd>
              <dt>Le prestataire recevrait (si payé)</dt>
              <dd className="num">{formatMoney(Math.min(held, job.provider_payout))}</dd>
              {milestone && (
                <>
                  <dt>Statut du jalon</dt>
                  <dd>{MILESTONE_STATUS[milestone.status]?.label ?? milestone.status}</dd>
                </>
              )}
              {d.status === 'resolved' && (
                <>
                  <dt>Issue</dt>
                  <dd>
                    {d.resolution ? RESOLUTION[d.resolution].label : '—'}
                    {d.resolved_by && <div className="small muted">{RESOLVED_BY[d.resolved_by]}</div>}
                  </dd>
                  {d.provider_amount != null && (
                    <>
                      <dt>Versé au prestataire</dt>
                      <dd className="num">{formatMoney(d.provider_amount)}</dd>
                    </>
                  )}
                </>
              )}
            </dl>
          </Section>

          <Section title="Les parties">
            <div className="row wrap" style={{ alignItems: 'stretch' }}>
              <div className="card card-pad" style={{ boxShadow: 'none', flex: '1 1 200px', minWidth: 0 }}>
                <div className="muted small">Client</div>
                <div className="who" style={{ margin: '6px 0' }}>
                  <Avatar name={job.client.full_name} url={job.client.avatar_url} />
                  <span className="who-name">{job.client.full_name}</span>
                </div>
                <TrustLine trust={job.client.trust} />
              </div>
              <div className="card card-pad" style={{ boxShadow: 'none', flex: '1 1 200px', minWidth: 0 }}>
                <div className="muted small">Prestataire</div>
                {provider ? (
                  <>
                    <div className="who" style={{ margin: '6px 0' }}>
                      <Avatar name={provider.full_name} url={provider.avatar_url} />
                      <span className="who-name">{provider.full_name}</span>
                    </div>
                    <span className="row wrap small" style={{ gap: 8 }}>
                      <span className="row" style={{ gap: 3 }}>
                        <Star size={13} fill="#F5B700" color="#F5B700" aria-hidden />
                        {provider.rating_avg ? Number(provider.rating_avg).toFixed(1) : 'non noté'}
                      </span>
                      {provider.no_shows != null && (
                        <span style={{ color: provider.no_shows > 0 ? 'var(--red)' : undefined }}>
                          {formatNumber(provider.no_shows)} absence{provider.no_shows > 1 ? 's' : ''}
                        </span>
                      )}
                      {provider.disputes_lost != null && <span>{formatNumber(provider.disputes_lost)} litige(s) perdu(s)</span>}
                    </span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            </div>
          </Section>

          <Section
            title="Accord amiable"
            right={
              d.status === 'open' && panel === 'none' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel('propose')}>
                  <Handshake size={14} /> Proposer un accord
                </button>
              ) : undefined
            }
          >
            {panel === 'propose' && <ProposeForm d={d} onDone={() => setPanel('none')} />}
            {proposals.length === 0 ? (
              panel === 'none' && <p className="muted small" style={{ margin: 0 }}>Aucune proposition. Un accord accepté par les deux parties clôt le litige sans votre décision.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: panel === 'propose' ? 10 : 0 }}>
                {(current ? [current] : proposals.slice(0, 1)).map((p) => (
                  <ProposalCard key={p.id} p={p} />
                ))}
                {proposals.length > 1 && <span className="small muted">{proposals.length - 1} proposition(s) précédente(s) dans le salon.</span>}
              </div>
            )}
          </Section>

          <EvidenceList d={d} items={d.evidence ?? []} />

          <Section title="Chronologie">
            <ol className="timeline">
              {timeline.map((t, i) => (
                <li key={i} className={t.at > now ? 'pending' : undefined}>
                  <div className="small muted num">{formatDateTime(t.at)}</div>
                  <div>{t.label}</div>
                </li>
              ))}
            </ol>
          </Section>

          {d.status === 'open' && (
            <Section title="Décision de l'équipe Tasko">
              <Decide d={d} onDone={onClose} threshold={settings.data?.four_eyes_threshold} />
            </Section>
          )}
          {d.status === 'pending_confirmation' && (
            <Section title="Décision à confirmer (second administrateur)">
              <ConfirmDecision d={d} onDone={onClose} />
            </Section>
          )}
          {d.status === 'resolved' && (d.resolution_note ?? d.note) && (
            <Section title="Motif de la décision">
              <blockquote className="quote">{d.resolution_note ?? d.note}</blockquote>
              <div className="small muted">
                {d.decided_by ? `Décidé par ${d.decided_by.full_name}` : ''}
                {d.confirmed_by ? ` · confirmé par ${d.confirmed_by.full_name}` : ''}
                {d.resolved_at ? ` · ${formatDateTime(d.resolved_at)}` : ''}
              </div>
            </Section>
          )}
        </div>
        <div className="dossier-chat">
          <MediationRoom dispute={d} readOnly={d.status === 'resolved'} />
        </div>
      </div>
    </Modal>
  );
}
