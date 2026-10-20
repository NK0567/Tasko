import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, Clock, PiggyBank, Users } from 'lucide-react';
import { disputesApi, treasuryApi } from '../../api/admin';
import { formatDateTime, formatMoney, timeUntil } from '../../lib/format';
import { isUrgent } from '../../lib/labels';

interface Todo {
  key: string;
  tone: 'red' | 'orange' | 'green';
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  to: string;
  cta: string;
}

/** Bandeau « À faire maintenant » : ce qui demande une action de l'admin, avec lien direct. */
export default function TodoBanner() {
  const open = useQuery({ queryKey: ['disputes', 'open', ''], queryFn: () => disputesApi.list('open'), refetchInterval: 30_000 });
  const toConfirm = useQuery({ queryKey: ['disputes', 'pending_confirmation', ''], queryFn: () => disputesApi.list('pending_confirmation'), refetchInterval: 30_000 });
  const treasury = useQuery({ queryKey: ['treasury', 'overview'], queryFn: treasuryApi.overview, refetchInterval: 30_000 });

  const loading = open.isLoading || toConfirm.isLoading || treasury.isLoading;
  const todos: Todo[] = [];

  const openItems = [...(open.data?.items ?? [])].sort((a, b) => (a.decision_due_at ?? '9').localeCompare(b.decision_due_at ?? '9'));
  const urgent = openItems.filter((d) => isUrgent(d.decision_due_at));
  if (urgent.length > 0) {
    const first = urgent[0]!;
    todos.push({
      key: 'urgent',
      tone: 'red',
      icon: <Clock size={18} />,
      title: `${urgent.length} litige${urgent.length > 1 ? 's' : ''} à trancher en urgence`,
      sub: `Le plus proche : « ${first.job.title} » — décision ${timeUntil(first.decision_due_at)} (${formatDateTime(first.decision_due_at)})`,
      to: '/mediation',
      cta: 'Traiter',
    });
  } else if (openItems.length > 0) {
    todos.push({
      key: 'open',
      tone: 'orange',
      icon: <AlertTriangle size={18} />,
      title: `${openItems.length} litige${openItems.length > 1 ? 's' : ''} en cours de médiation`,
      sub: openItems[0]?.decision_due_at ? `Prochaine échéance ${timeUntil(openItems[0].decision_due_at)}` : undefined,
      to: '/mediation',
      cta: 'Voir',
    });
  }
  const nConfirm = toConfirm.data?.items.length ?? 0;
  if (nConfirm > 0) {
    todos.push({
      key: 'confirm',
      tone: 'orange',
      icon: <CheckCheck size={18} />,
      title: `${nConfirm} décision${nConfirm > 1 ? 's' : ''} à confirmer (second avis)`,
      sub: 'Montants élevés : un autre administrateur doit valider.',
      to: '/mediation?onglet=pending_confirmation',
      cta: 'Vérifier',
    });
  }
  const t = treasury.data;
  if (t && t.providers_available > 0) {
    todos.push({
      key: 'payouts',
      tone: 'red',
      icon: <Users size={18} />,
      title: `${formatMoney(t.providers_available)} dus aux prestataires non versés`,
      sub: 'Versements Mobile Money en échec ou en attente : vérifiez les numéros des prestataires.',
      to: '/transactions?type=payout&status=failed',
      cta: 'Voir les échecs',
    });
  }
  if (t && t.revenue_available > 0) {
    todos.push({
      key: 'revenue',
      tone: 'green',
      icon: <PiggyBank size={18} />,
      title: `${formatMoney(t.revenue_available)} de revenus disponibles à retirer`,
      sub: 'Virez-les vers votre compte Ecobank ou Mobile Money.',
      to: '/tresorerie',
      cta: 'Retirer',
    });
  }

  return (
    <section className="card todo" aria-labelledby="todo-title">
      <div className="card-head">
        <h2 id="todo-title">À faire maintenant</h2>
      </div>
      <div className="card-body">
        {loading ? (
          <div className="skeleton" style={{ height: 56 }} />
        ) : todos.length === 0 ? (
          <div className="row" style={{ color: 'var(--green-800)' }}>
            <CheckCircle2 size={20} aria-hidden /> Rien d'urgent : aucun litige, aucun versement en échec. Tout est en ordre.
          </div>
        ) : (
          <ul className="todo-list">
            {todos.map((x) => (
              <li key={x.key} className={`todo-item todo-${x.tone}`}>
                <span className="todo-icon" aria-hidden>
                  {x.icon}
                </span>
                <div className="grow">
                  <div className="strong">{x.title}</div>
                  {x.sub && <div className="small">{x.sub}</div>}
                </div>
                <Link to={x.to} className="btn btn-sm btn-secondary">
                  {x.cta} <ArrowRight size={14} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
