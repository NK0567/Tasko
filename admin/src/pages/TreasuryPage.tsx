import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, Info, Landmark, Lock, PiggyBank, Save, Users, Vault, Wallet } from 'lucide-react';
import { payoutAccountsApi, settingsApi, treasuryApi } from '../api/admin';
import type { AutoSettlement, Settings, Treasury } from '../api/types';
import { useConfirm, useToast } from '../components/feedback-context';
import { Badge, Empty, ErrorState, Help, Pagination, QueryState, Spinner, StatTile } from '../components/ui';
import { formatDateTime, formatMoney, parseAmount } from '../lib/format';
import { AUTO_SETTLEMENT, PAYOUT_TYPE, WITHDRAWAL_STATUS } from '../lib/labels';
import LedgerChart from './treasury/LedgerChart';
import PayoutAccounts from './treasury/PayoutAccounts';
import WithdrawModal from './treasury/WithdrawModal';
import { accountSummary } from './treasury/account-utils';
import { estimateWithdrawalFee, providerLabel, suggestedSettlementThreshold } from '../lib/providers';

function TileSkeleton() {
  return (
    <div className="card card-pad" style={{ height: 110 }}>
      <div className="skeleton" style={{ width: '60%', height: 12 }} />
      <div className="skeleton" style={{ width: '80%', height: 24, marginTop: 12 }} />
    </div>
  );
}

function Tiles({ t }: { t: Treasury }) {
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
        <StatTile
          big
          tone="green"
          icon={<PiggyBank size={18} color="var(--green-700)" />}
          label="Revenus disponibles (à vous)"
          value={formatMoney(t.revenue_available)}
          sub="Seul montant que vous pouvez retirer."
          help="Vos frais de service, commissions, abonnements et boosts encaissés, moins ce que vous avez déjà retiré ou êtes en train de retirer."
        />
        <StatTile
          icon={<Lock size={18} color="var(--blue)" />}
          tone="blue"
          label="Argent bloqué des clients (intouchable)"
          value={formatMoney(t.escrow_held)}
          sub="Missions en cours : payé d'avance, gardé en garantie."
          help="Le client a payé avant le début du travail. Cet argent ira au prestataire quand la mission sera validée (ou remboursé au client). Il n'est pas à Tasko."
        />
        <StatTile
          icon={<Users size={18} color="var(--gray-700)" />}
          tone="gray"
          label="Dus aux prestataires (intouchable)"
          value={formatMoney(t.providers_available)}
          sub="Missions validées, versement Mobile Money en attente ou échoué."
          help="Argent qui appartient déjà aux prestataires : l'envoi sur leur Mobile Money n'a pas encore réussi. Il leur sera versé (ou ils le retireront eux-mêmes)."
        />
      </div>
      <div className="grid grid-kpi">
        <StatTile label="Déjà retirés" help="Total de vos retraits réussis vers vos comptes." value={formatMoney(t.revenue_withdrawn)} icon={<Landmark size={16} color="var(--gray-500)" />} />
        <StatTile
          label="Retraits en cours"
          help="Retraits demandés mais pas encore confirmés par l'agrégateur. Ils sont déjà déduits de vos revenus disponibles."
          value={formatMoney(t.revenue_pending_withdrawal)}
          tone={t.revenue_pending_withdrawal > 0 ? 'yellow' : undefined}
          icon={<Banknote size={16} color="var(--gray-500)" />}
        />
        <StatTile label="Revenus du mois" help="Revenus Tasko gagnés depuis le 1er du mois." value={formatMoney(t.revenue_month)} icon={<Wallet size={16} color="var(--gray-500)" />} />
        <StatTile label="Revenus cumulés" help="Tous les revenus Tasko depuis le lancement (avant retraits)." value={formatMoney(t.revenue_total)} icon={<Wallet size={16} color="var(--gray-500)" />} />
        <StatTile
          label={`Solde du coffre (${[...new Set([t.collect_provider, t.payout_provider].filter(Boolean))].map(providerLabel).join(' + ') || 'agrégateur'})`}
          help="Argent réellement présent sur le(s) compte(s) marchand(s) Tasko chez l'agrégateur d'encaissement et celui des versements. Il doit couvrir : argent bloqué + dus aux prestataires + vos revenus disponibles."
          value={t.aggregator_balance === null ? 'Non disponible' : formatMoney(t.aggregator_balance)}
          sub={
            t.aggregator_balance === null
              ? 'Mode simulé, solde non fourni par l’agrégateur (Monetbil, NotchPay) ou API indisponible.'
              : 'Doit couvrir séquestre + dus prestataires + vos revenus disponibles.'
          }
          icon={<Vault size={16} color="var(--gray-500)" />}
        />
      </div>
    </>
  );
}

function Breakdown({ t }: { t: Treasury }) {
  const rows: { label: string; value: number; hint: string }[] = [
    { label: 'Frais de service (clients)', value: t.breakdown.service_fees, hint: 'Ajoutés au prix payé par le client.' },
    { label: 'Commissions prestataires', value: t.breakdown.commissions, hint: 'Retenues sur le montant versé.' },
    { label: 'Abonnements Tasko Pro', value: t.breakdown.subscriptions, hint: '' },
    { label: 'Boosts (mise en avant)', value: t.breakdown.boosts, hint: '' },
    { label: "Frais d'annulation conservés", value: t.breakdown.cancellation_fees_kept, hint: 'Part des frais non reversée au prestataire.' },
  ];
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          D'où viennent vos revenus <Help label="Origine des revenus">Répartition de vos revenus cumulés par source.</Help>
        </h2>
        <span className="muted small">Cumul : {formatMoney(total)}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
              <span className="strong">{r.label}</span>
              <span className="num small strong">
                {formatMoney(r.value)}
                <span className="muted"> · {total > 0 ? Math.round((r.value / total) * 100) : 0} %</span>
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4 }} aria-hidden>
              <div style={{ width: `${r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0}%`, height: '100%', background: 'var(--green-700)', borderRadius: 4 }} />
            </div>
            {r.hint && <div className="muted small" style={{ marginTop: 2 }}>{r.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowNode({ title, sub, kind }: { title: string; sub: string; kind?: 'vault' | 'mine' }) {
  return (
    <div className={`flow-node${kind ? ` ${kind}` : ''}`}>
      <strong>{title}</strong>
      <span>{sub}</span>
    </div>
  );
}
const Arrow = () => (
  <span className="flow-arrow" aria-hidden>
    <ArrowRight size={20} />
  </span>
);

function MoneyFlow() {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Comment circule l'argent</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="flow">
          <span className="sr-only">Flux principal :</span>
          <FlowNode title="1. Client" sub="Paie avant le début du travail (MoMo, Orange Money, carte)." />
          <Arrow />
          <FlowNode kind="vault" title="2. Coffre Tasko" sub="Compte marchand chez l'agrégateur NotchPay. Fonds bloqués (séquestre)." />
          <Arrow />
          <FlowNode title="3. Prestataire" sub="Versement automatique sur son MoMo à la libération." />
        </div>
        <div className="flow">
          <span className="sr-only">Vos revenus :</span>
          <FlowNode kind="vault" title="Reliquat du coffre" sub="Frais de service + commissions + abonnements + boosts." />
          <Arrow />
          <FlowNode kind="mine" title="Vos revenus" sub="« Revenus disponibles » ci-dessus." />
          <Arrow />
          <FlowNode kind="mine" title="Ecobank / MoMo" sub="Via « Retirer mes revenus » ou le reversement automatique." />
        </div>
      </div>
    </div>
  );
}

function Guidance() {
  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <Info size={18} color="var(--green-700)" />
          <h2>Bon à savoir</h2>
        </div>
      </div>
      <div className="card-body">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--gray-700)' }}>
          <li>
            <strong>L'argent bloqué des clients n'est pas à vous.</strong> C'est l'argent des clients, gardé en garantie jusqu'à la fin de la mission ; il
            revient au prestataire (ou au client en cas de remboursement). Le retirer mettrait Tasko en défaut de paiement : le serveur l'interdit.
          </li>
          <li>
            <strong>Gros montants : compte bancaire professionnel</strong> (ex. Ecobank) au nom de la société — traçabilité, pas de plafond MoMo,
            justificatifs pour la comptabilité.
          </li>
          <li>
            <strong>Petits retraits rapides : Mobile Money</strong> (MTN MoMo / Orange Money), dans la limite des plafonds par opération et par jour de
            l'opérateur.
          </li>
          <li>
            <strong>TVA et comptabilité</strong> : le traitement fiscal des frais et commissions (TVA, déclaration du chiffre d'affaires) est à faire
            valider par un comptable / expert-comptable.
          </li>
        </ul>
      </div>
    </div>
  );
}

function Withdrawals() {
  const [page, setPage] = useState(1);
  const LIMIT = 10;
  const query = useQuery({
    queryKey: ['treasury', 'withdrawals', page],
    queryFn: () => treasuryApi.withdrawals({ page, limit: LIMIT }),
    placeholderData: keepPreviousData,
    // Rafraîchissement rapide tant qu'un retrait est en cours.
    refetchInterval: (q) => (q.state.data?.items.some((w) => w.status === 'pending') ? 4_000 : 30_000),
  });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Historique des retraits</h2>
      </div>
      <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucun retrait pour le moment" icon={<Landmark size={24} />} />}>
        {(d) => (
          <>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="right">Montant</th>
                    <th className="right">Frais</th>
                    <th>Destination</th>
                    <th>Statut</th>
                    <th>Référence</th>
                    <th>Demandé par</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((w) => {
                    const st = WITHDRAWAL_STATUS[w.status] ?? { label: w.status, tone: 'gray' as const };
                    return (
                      <tr key={w.id}>
                        <td className="num muted">
                          {formatDateTime(w.created_at)}
                          {w.completed_at && <div className="small">fini {formatDateTime(w.completed_at)}</div>}
                        </td>
                        <td className="right num strong">{formatMoney(w.amount)}</td>
                        <td className="right num muted">{formatMoney(w.fee)}</td>
                        <td>
                          {w.payout_account ? (
                            <>
                              <div className="who-name">{accountSummary(w.payout_account)}</div>
                              <div className="who-sub">{PAYOUT_TYPE[w.payout_account.type]}</div>
                            </>
                          ) : (
                            <span className="muted">Compte supprimé</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {w.failure_reason && <div className="small" style={{ color: 'var(--red)', marginTop: 2 }}>{w.failure_reason}</div>}
                        </td>
                        <td className="small muted" style={{ fontFamily: 'ui-monospace, monospace' }}>
                          {w.external_ref ?? '—'}
                        </td>
                        <td>{w.requested_by?.full_name ?? '—'}</td>
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
  );
}

function AutoSettlementCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const accounts = useQuery({ queryKey: ['payout-accounts'], queryFn: payoutAccountsApi.list });
  const overview = useQuery({ queryKey: ['treasury', 'overview'], queryFn: treasuryApi.overview });
  const providers = useQuery({ queryKey: ['payment-providers'], queryFn: settingsApi.providers });
  const [mode, setMode] = useState<AutoSettlement>('off');
  const [min, setMin] = useState('');
  const [touched, setTouched] = useState(false);

  const current = settings.data;
  useEffect(() => {
    if (!current) return;
    setMode(current.auto_settlement ?? 'off');
    setMin(String(current.auto_settlement_min ?? 50000));
  }, [current]);

  const minN = parseAmount(min);
  const minErr = minN === null || minN < 1000 ? 'Seuil minimum : 1 000 FCFA (entier).' : '';
  const dirty = !!current && (mode !== (current.auto_settlement ?? 'off') || minN !== (current.auto_settlement_min ?? 50000));
  const def = accounts.data?.items.find((a) => a.is_default) ?? null;
  const payoutProvider = providers.data?.items.find((p) => p.id === overview.data?.payout_provider) ?? null;
  const suggested = suggestedSettlementThreshold(payoutProvider, def?.type ?? null);
  const defEstimate = def && payoutProvider
    ? estimateWithdrawalFee(payoutProvider, minN ?? suggested, def.type, def.type === 'bank' ? def.bank_name ?? 'bancaire' : PAYOUT_TYPE[def.type])
    : null;

  const mut = useMutation({
    mutationFn: (patch: Partial<Settings>) => settingsApi.update(patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast.success('Reversement automatique enregistré.');
    },
    onError: (e) => toast.error(e),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (minErr || !current) return;
    if (mode !== 'off') {
      if (!def) {
        toast.error('Définissez d’abord un compte de versement par défaut.');
        return;
      }
      const ok = await confirm({
        title: 'Activer le reversement automatique ?',
        message: (
          <>
            Chaque {mode === 'daily' ? 'jour' : 'semaine'}, si vos revenus disponibles dépassent <strong>{formatMoney(minN)}</strong>, ils seront
            virés automatiquement vers <strong>{accountSummary(def)}</strong>.
          </>
        ),
        confirmLabel: 'Activer',
      });
      if (!ok) return;
    }
    mut.mutate({ auto_settlement: mode, auto_settlement_min: minN ?? undefined });
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Reversement automatique</h2>
        {current && <Badge tone={current.auto_settlement && current.auto_settlement !== 'off' ? 'green' : 'gray'}>{AUTO_SETTLEMENT[current.auto_settlement ?? 'off']}</Badge>}
      </div>
      <div className="card-body">
        {settings.isLoading ? (
          <Spinner />
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="as-mode">Fréquence</label>
                <select id="as-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as AutoSettlement)}>
                  {(Object.keys(AUTO_SETTLEMENT) as AutoSettlement[]).map((k) => (
                    <option key={k} value={k}>
                      {AUTO_SETTLEMENT[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="as-min">Seuil de déclenchement (FCFA)</label>
                <input
                  id="as-min"
                  className={`input${touched && minErr ? ' invalid' : ''}`}
                  inputMode="numeric"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  disabled={mode === 'off'}
                  aria-invalid={touched && !!minErr}
                  aria-describedby="as-min-help"
                />
                <span id="as-min-help" className={touched && minErr ? 'field-error' : 'hint'}>
                  {touched && minErr ? minErr : 'Aucun virement en dessous de ce montant (limite les frais).'}
                </span>
              </div>
            </div>
            <div className="small muted">
              Destination : {def ? <strong>{accountSummary(def)}</strong> : <span style={{ color: 'var(--red)' }}>aucun compte par défaut</span>}
            </div>
            {defEstimate && (
              <div className={`notice${defEstimate.supported ? '' : ' red'}`} style={defEstimate.supported ? undefined : { background: 'var(--red-100)', color: 'var(--red)' }}>
                <Info size={16} style={{ flexShrink: 0 }} />
                <span>
                  {defEstimate.message}
                  {defEstimate.supported && (
                    <>
                      {' '}Seuil conseillé : <strong>{formatMoney(suggested)}</strong>
                      {def?.type === 'bank' && payoutProvider?.fees.bank_flat ? ' (frais ≤ 2 % du virement)' : ''}.{' '}
                      {minN !== suggested && mode !== 'off' && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMin(String(suggested))}>
                          Utiliser ce seuil
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-sm" disabled={!dirty || mut.isPending}>
                {mut.isPending ? <Spinner small /> : <Save size={14} />} Enregistrer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="grid grid-2-even" style={{ alignItems: 'start' }}>{children}</div>;
}

export default function TreasuryPage() {
  const [withdrawing, setWithdrawing] = useState(false);
  const query = useQuery({
    queryKey: ['treasury', 'overview'],
    queryFn: treasuryApi.overview,
    refetchInterval: (q) => ((q.state.data?.revenue_pending_withdrawal ?? 0) > 0 ? 5_000 : 30_000),
  });
  const t = query.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Trésorerie</h1>
          <p>Ce qui est à vous, ce qui ne l'est pas, et comment récupérer vos revenus.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button type="button" className="btn" onClick={() => setWithdrawing(true)} disabled={!t || t.revenue_available <= 0}>
            <Landmark size={16} /> Retirer mes revenus
          </button>
          {t && t.revenue_available <= 0 && <span className="muted small">Aucun revenu disponible pour l'instant.</span>}
        </div>
      </div>

      {query.isError ? (
        <div className="card">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : !t ? (
        <div className="grid grid-kpi">
          {Array.from({ length: 4 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : (
        <Tiles t={t} />
      )}

      <MoneyFlow />
      {t && (
        <Section>
          <Breakdown t={t} />
          <Guidance />
        </Section>
      )}
      <LedgerChart />
      <Section>
        <PayoutAccounts />
        <AutoSettlementCard />
      </Section>
      <Withdrawals />

      {withdrawing && t && (
        <WithdrawModal
          treasury={t}
          onClose={() => setWithdrawing(false)}
          onAddAccount={() => {
            setWithdrawing(false);
            document.getElementById('payout-accounts')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
}
