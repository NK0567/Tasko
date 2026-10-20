import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Briefcase,
  Gavel,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Tag,
  UserCog,
  Users,
  Vault,
  type LucideIcon,
} from 'lucide-react';
import { disputesApi } from '../api/admin';
import { useAuth } from '../auth/context';
import { isUrgent } from '../lib/labels';
import { LogoMark } from './Logo';
import { Avatar } from './ui';
import s from './Layout.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: 'mediation';
}
/** Menu groupé par grands usages. */
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/tresorerie', label: 'Trésorerie', icon: Vault },
    ],
  },
  {
    group: 'Opérations',
    items: [
      { to: '/missions', label: 'Missions', icon: Briefcase },
      { to: '/mediation', label: 'Médiation', icon: Gavel, badge: 'mediation' },
      { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { to: '/categories', label: 'Catégories', icon: LayoutGrid },
      { to: '/promotions', label: 'Promotions', icon: Tag },
    ],
  },
  {
    group: 'Utilisateurs',
    items: [
      { to: '/utilisateurs', label: 'Utilisateurs', icon: Users },
      { to: '/prestataires', label: 'Prestataires', icon: UserCog },
    ],
  },
  {
    group: 'Système',
    items: [
      { to: '/parametres', label: 'Paramètres', icon: Settings },
      { to: '/journal', label: "Journal d'audit", icon: ScrollText },
    ],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const openDisputes = useQuery({ queryKey: ['disputes', 'open', ''], queryFn: () => disputesApi.list('open'), refetchInterval: 30_000 });
  const toConfirm = useQuery({ queryKey: ['disputes', 'pending_confirmation', ''], queryFn: () => disputesApi.list('pending_confirmation'), refetchInterval: 30_000 });
  const urgent = (openDisputes.data?.items ?? []).filter((d) => isUrgent(d.decision_due_at)).length;
  const waiting = (openDisputes.data?.items.length ?? 0) + (toConfirm.data?.items.length ?? 0);

  return (
    <div className={s.shell}>
      {open && <div className={s.backdrop} onClick={() => setOpen(false)} />}
      <aside className={`${s.sidebar} ${open ? s.open : ''}`} aria-label="Navigation principale">
        <div className={s.brand}>
          <LogoMark />
          <div className={s.brandText}>
            <span className={s.brandName}>
              Tasko<span>Admin</span>
            </span>
            <span className={s.brandSub}>Back-office</span>
          </div>
        </div>
        <nav className={s.nav}>
          {NAV.map(({ group, items }) => (
            <div key={group} className={s.group} role="group" aria-labelledby={`nav-${group}`}>
              <div className={s.groupTitle} id={`nav-${group}`}>
                {group}
              </div>
              {items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => `${s.link} ${isActive ? s.active : ''}`}>
                  <Icon size={18} aria-hidden />
                  {label}
                  {badge === 'mediation' && urgent > 0 && (
                    <span className={`${s.count} ${s.countUrgent}`} title={`${urgent} litige(s) urgent(s)`}>
                      {urgent}
                      <span className="sr-only"> litige(s) urgent(s)</span>
                    </span>
                  )}
                  {badge === 'mediation' && urgent === 0 && waiting > 0 && (
                    <span className={s.count} title={`${waiting} dossier(s) en attente`}>
                      {waiting}
                      <span className="sr-only"> dossier(s) en attente</span>
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className={s.userBox}>
          <Avatar name={user?.full_name} url={user?.avatar_url} size={32} />
          <div style={{ minWidth: 0 }}>
            <div className={`${s.userName} ellipsis`}>{user?.full_name}</div>
            <div className={s.userRole}>Administrateur</div>
          </div>
          <button className={s.logout} onClick={logout} title="Se déconnecter" aria-label="Se déconnecter">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className={s.main}>
        <header className={s.topbar}>
          <button className={s.burger} onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu size={24} />
          </button>
          <LogoMark size={28} />
          <strong style={{ fontFamily: 'var(--font-title)' }}>Tasko Admin</strong>
        </header>
        <main className={s.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
