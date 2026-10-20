import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, Crown, ShieldCheck, ShieldOff, Star, UserCheck, Users } from 'lucide-react';
import { usersApi } from '../api/admin';
import type { User, UserPatch, UserRole, UserStatus, VerificationLevel } from '../api/types';
import { useConfirm, useToast } from '../components/feedback-context';
import { Avatar, Badge, Empty, KebabMenu, Modal, Pagination, QueryState, SearchInput } from '../components/ui';
import { useDebounced } from '../lib/hooks';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import { rowActivate } from '../lib/a11y';
import { ACCOUNT_TYPE, BUSINESS_KIND, PROVIDER_TYPE_LABELS, VERIFICATION_LABELS } from '../lib/labels';
import { TrustAlert, TrustLine } from '../components/trust';

const LIMIT = 20;
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function isPro(u: User) {
  const p = u.provider;
  if (!p) return false;
  return p.plan === 'pro' && (!p.pro_until || new Date(p.pro_until) > new Date());
}

function RoleBadges({ u }: { u: User }) {
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {u.is_admin && <Badge tone="purple">Admin</Badge>}
      {u.is_provider ? <Badge tone="green">Prestataire</Badge> : <Badge tone="gray">Client</Badge>}
    </span>
  );
}

function AccountType({ u }: { u: User }) {
  if (u.account_type === 'business') {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
        <Badge tone="blue">
          <Building2 size={12} aria-hidden /> {ACCOUNT_TYPE.business}
        </Badge>
        {u.business?.name && <span className="who-sub ellipsis" style={{ maxWidth: 180 }}>{u.business.name}</span>}
      </span>
    );
  }
  return <span className="small">{u.account_type ? ACCOUNT_TYPE[u.account_type] : '—'}</span>;
}

function VerificationSelect({ u, onChange, busy }: { u: User; onChange: (v: VerificationLevel) => void; busy: boolean }) {
  return (
    <select
      className="input"
      style={{ height: 32, width: 190, fontSize: 13 }}
      value={u.verification_level}
      disabled={busy}
      aria-label={`Niveau de vérification de ${u.full_name}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value) as VerificationLevel)}
    >
      {([1, 2, 3, 4, 5] as VerificationLevel[]).map((l) => (
        <option key={l} value={l}>
          {l} · {VERIFICATION_LABELS[l]}
        </option>
      ))}
    </select>
  );
}

function UserDetail({ u, onClose }: { u: User; onClose: () => void }) {
  const p = u.provider;
  return (
    <Modal title="Fiche utilisateur" onClose={onClose} large>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
        <Avatar name={u.full_name} url={u.avatar_url} size={56} />
        <div style={{ minWidth: 0 }}>
          <h2>{u.full_name}</h2>
          <div className="muted">
            {u.phone} {u.email ? `· ${u.email}` : ''} {u.city ? `· ${u.city}` : ''}
          </div>
          <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
            <RoleBadges u={u} />
            <Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Actif' : 'Suspendu'}</Badge>
            <Badge tone="blue">
              Niveau {u.verification_level} · {VERIFICATION_LABELS[u.verification_level]}
            </Badge>
          </div>
        </div>
      </div>
      <dl className="dl">
        <dt>Inscrit le</dt>
        <dd>{formatDate(u.created_at)}</dd>
        <dt>Type de compte</dt>
        <dd>{u.account_type ? ACCOUNT_TYPE[u.account_type] : '—'}</dd>
        {u.business && (
          <>
            <dt>Entreprise</dt>
            <dd>
              {u.business.name}
              <div className="small muted">
                {BUSINESS_KIND[u.business.kind] ?? u.business.kind}
                {u.business.niu ? ` · NIU ${u.business.niu}` : ''}
                {u.business.rccm ? ` · RCCM ${u.business.rccm}` : ''}
              </div>
              {u.business.address && <div className="small muted">{u.business.address}</div>}
            </dd>
          </>
        )}
        <dt>Réputation client</dt>
        <dd>
          <TrustLine trust={u.trust} />
        </dd>
      </dl>
      {p && (
        <>
          <div className="divider" />
          <h3 style={{ marginBottom: 10 }}>Profil prestataire</h3>
          <dl className="dl">
            <dt>Titre</dt>
            <dd>{p.headline || '—'}</dd>
            <dt>Type</dt>
            <dd>{PROVIDER_TYPE_LABELS[p.provider_type] ?? p.provider_type}</dd>
            <dt>Expérience</dt>
            <dd>{p.years_experience != null ? `${p.years_experience} an(s)` : "—"}</dd>
            <dt>Note</dt>
            <dd>
              {Number(p.rating_avg ?? 0).toFixed(1)} ★ ({p.rating_count ?? 0} avis)
            </dd>
            <dt>Missions réalisées</dt>
            <dd>
              {formatNumber(p.missions_completed)} · taux de réalisation {p.completion_rate} %
            </dd>
            {(p.no_shows != null || p.disputes_lost != null || p.cancellations != null) && (
              <>
                <dt>Incidents</dt>
                <dd>
                  {formatNumber(p.no_shows ?? 0)} absence(s) · {formatNumber(p.disputes_lost ?? 0)} litige(s) perdu(s) · {formatNumber(p.cancellations ?? 0)} annulation(s)
                </dd>
              </>
            )}
            {p.public_code && (
              <>
                <dt>Code Tasko</dt>
                <dd className="num">{p.public_code}</dd>
              </>
            )}
            {(p.wallet_available ?? 0) > 0 && (
              <>
                <dt>Dû, non versé</dt>
                <dd className="num">{formatMoney(p.wallet_available)}</dd>
              </>
            )}
            <dt>Mobile Money</dt>
            <dd>{p.momo_number ? `${p.momo_number} (${p.momo_operator === 'orange' ? 'Orange' : 'MTN'})` : '—'}</dd>
            <dt>Plan</dt>
            <dd>
              {isPro(u) ? `Tasko Pro${p.pro_until ? ` jusqu'au ${formatDate(p.pro_until)}` : ''}` : 'Gratuit'}
              {p.featured_until && new Date(p.featured_until) > new Date() ? ` · Boosté jusqu'au ${formatDate(p.featured_until)}` : ''}
            </dd>
            <dt>Disponibilités</dt>
            <dd>{p.available_days?.length ? p.available_days.map((d) => DAYS[d]).join(', ') : '—'}</dd>
          </dl>
          {p.bio && <p style={{ color: 'var(--gray-700)' }}>{p.bio}</p>}
          {(p.skills?.length ?? 0) > 0 && (
            <>
              <div className="label" style={{ margin: '12px 0 8px' }}>
                Compétences
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {(p.skills ?? []).map((s) => (
                  <Badge key={s.category_id} tone="green">
                    {s.name} · dès {formatMoney(s.base_price)}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export default function UsersPage({ mode }: { mode: 'users' | 'providers' }) {
  const isProviders = mode === 'providers';
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<User | null>(null);

  useEffect(() => setPage(1), [q, role, status, mode]);

  const effectiveRole: UserRole | '' = isProviders ? 'provider' : role;
  const params = { q, role: effectiveRole, status, page, limit: LIMIT };
  const query = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
  });

  const mut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch; msg: string }) => usersApi.update(id, patch),
    onSuccess: (_u, v) => {
      toast.success(v.msg);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(e),
  });

  async function toggleSuspend(u: User) {
    const suspend = u.status === 'active';
    const ok = await confirm({
      title: suspend ? 'Suspendre ce compte ?' : 'Réactiver ce compte ?',
      message: suspend
        ? `${u.full_name} ne pourra plus se connecter ni recevoir de missions tant que le compte est suspendu.`
        : `${u.full_name} pourra de nouveau utiliser Tasko.`,
      confirmLabel: suspend ? 'Suspendre' : 'Réactiver',
      danger: suspend,
    });
    if (ok)
      mut.mutate({
        id: u.id,
        patch: { status: suspend ? 'suspended' : 'active' },
        msg: suspend ? `${u.full_name} a été suspendu.` : `${u.full_name} a été réactivé.`,
      });
  }

  async function toggleAdmin(u: User) {
    const promote = !u.is_admin;
    const ok = await confirm({
      title: promote ? 'Promouvoir administrateur ?' : 'Retirer les droits administrateur ?',
      message: promote
        ? `${u.full_name} aura un accès complet au back-office (paramètres, paiements, utilisateurs).`
        : `${u.full_name} n'aura plus accès au back-office.`,
      confirmLabel: promote ? 'Promouvoir' : 'Retirer',
      danger: !promote,
    });
    if (ok)
      mut.mutate({
        id: u.id,
        patch: { is_admin: promote },
        msg: promote ? `${u.full_name} est maintenant administrateur.` : `Droits admin retirés à ${u.full_name}.`,
      });
  }

  async function setLevel(u: User, level: VerificationLevel) {
    const ok = await confirm({
      title: 'Changer le niveau de vérification ?',
      message: `${u.full_name} : niveau ${u.verification_level} (${VERIFICATION_LABELS[u.verification_level]}) → ${level} (${VERIFICATION_LABELS[level]}). Ce badge est visible par les clients.`,
      confirmLabel: 'Changer',
    });
    if (!ok) return;
    mut.mutate({
      id: u.id,
      patch: { verification_level: level },
      msg: `Niveau de ${u.full_name} : ${level} · ${VERIFICATION_LABELS[level]}.`,
    });
  }

  const busyId = mut.isPending ? mut.variables?.id : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isProviders ? 'Prestataires' : 'Utilisateurs'}</h1>
          <p>
            {isProviders
              ? 'Artisans, étudiants, débrouillards et entreprises qui proposent leurs services.'
              : 'Tous les comptes clients, prestataires et administrateurs.'}
          </p>
        </div>
        {query.data && (
          <span className="badge tone-green" style={{ fontSize: 13 }}>
            {formatNumber(query.data.total)} {isProviders ? 'prestataires' : 'comptes'}
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-body toolbar" style={{ borderBottom: '1px solid var(--gray-200)' }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Rechercher par nom, téléphone…" />
          </div>
          {!isProviders && (
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole | '')} aria-label="Filtrer par rôle">
              <option value="">Tous les rôles</option>
              <option value="client">Clients</option>
              <option value="provider">Prestataires</option>
              <option value="admin">Administrateurs</option>
            </select>
          )}
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as UserStatus | '')} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
          </select>
        </div>

        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <Empty title="Aucun résultat" icon={<Users size={24} />}>
              <span>{q || role || status ? 'Aucun compte ne correspond : modifiez la recherche ou les filtres.' : 'Les comptes apparaîtront ici dès les premières inscriptions.'}</span>
            </Empty>
          }
        >
          {(d) => (
            <>
              <div className="table-wrap" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{isProviders ? 'Prestataire' : 'Utilisateur'}</th>
                      {isProviders ? (
                        <>
                          <th>Type</th>
                          <th className="right">Note</th>
                          <th className="right">Missions</th>
                          <th>Plan</th>
                          <th>En ligne</th>
                        </>
                      ) : (
                        <>
                          <th>Compte</th>
                          <th>Rôle</th>
                          <th>Réputation client</th>
                        </>
                      )}
                      <th>Vérification</th>
                      <th>Statut</th>
                      <th>Inscription</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((u) => {
                      const p = u.provider;
                      return (
                        <tr key={u.id} className="clickable" {...rowActivate(() => setDetail(u))}>
                          <td>
                            <div className="who">
                              <Avatar name={u.full_name} url={u.avatar_url} />
                              <div style={{ minWidth: 0 }}>
                                <div className="who-name ellipsis">
                                  {u.full_name} {u.is_admin && isProviders && <Crown size={12} color="var(--purple)" />}
                                </div>
                                <div className="who-sub">
                                  {isProviders && p?.headline ? p.headline : u.phone}
                                  {!isProviders && u.city ? ` · ${u.city}` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          {isProviders ? (
                            <>
                              <td style={{ whiteSpace: 'nowrap' }}>{p ? PROVIDER_TYPE_LABELS[p.provider_type] ?? p.provider_type : '—'}</td>
                              <td className="right num">
                                {p && p.rating_count > 0 ? (
                                  <span className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
                                    <Star size={13} fill="#F5B700" color="#F5B700" />
                                    {Number(p.rating_avg).toFixed(1)}
                                    <span className="muted small">({p.rating_count})</span>
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="right num">{p ? formatNumber(p.missions_completed) : '—'}</td>
                              <td>{isPro(u) ? <Badge tone="yellow">Pro</Badge> : <Badge tone="gray">Gratuit</Badge>}</td>
                              <td>
                                {p?.is_online ? (
                                  <span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-700)' }} />
                                    En ligne
                                  </span>
                                ) : (
                                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>Hors ligne</span>
                                )}
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <AccountType u={u} />
                              </td>
                              <td>
                                <RoleBadges u={u} />
                              </td>
                              <td className="small" style={{ whiteSpace: 'nowrap' }}>
                                {u.trust ? (
                                  <span className="row" style={{ gap: 6 }}>
                                    <span>
                                      {u.trust.rating_count > 0 && u.trust.rating_avg != null ? `${Number(u.trust.rating_avg).toFixed(1)} ★` : 'non noté'} · {formatNumber(u.trust.jobs_paid)} payés ·{' '}
                                      {formatNumber(u.trust.disputes_lost)} perdus
                                    </span>
                                    <TrustAlert trust={u.trust} />
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </>
                          )}
                          <td>
                            <VerificationSelect u={u} busy={busyId === u.id} onChange={(l) => void setLevel(u, l)} />
                          </td>
                          <td>
                            <Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Actif' : 'Suspendu'}</Badge>
                          </td>
                          <td className="num muted">{formatDate(u.created_at)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <KebabMenu
                              label={`Actions pour ${u.full_name}`}
                              items={[
                                u.status === 'active'
                                  ? { label: 'Suspendre', icon: <Ban size={16} />, danger: true, onClick: () => void toggleSuspend(u) }
                                  : { label: 'Réactiver', icon: <UserCheck size={16} />, onClick: () => void toggleSuspend(u) },
                                u.is_admin
                                  ? { label: 'Retirer les droits admin', icon: <ShieldOff size={16} />, danger: true, onClick: () => void toggleAdmin(u) }
                                  : { label: 'Promouvoir admin', icon: <ShieldCheck size={16} />, onClick: () => void toggleAdmin(u) },
                              ]}
                            />
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
      {detail && <UserDetail u={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
