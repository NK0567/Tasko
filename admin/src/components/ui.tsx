import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, MoreVertical, RefreshCw, Search, X } from 'lucide-react';
import { errorMessage } from '../api/client';
import { initials } from '../lib/format';
import type { Tone } from '../lib/labels';

export function MSym({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="msr" style={{ fontSize: size, width: size, height: size, color }} aria-hidden>
      {name}
    </span>
  );
}

export function CatIcon({ icon, color, size = 38 }: { icon: string; color?: string | null; size?: number }) {
  const c = color || '#0F7A3D';
  return (
    <span className="cat-icon" style={{ background: `${c}1F`, color: c, width: size, height: size }}>
      <MSym name={icon || 'more_horiz'} size={Math.round(size * 0.58)} />
    </span>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`switch${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner${small ? ' spinner-sm' : ''}`} role="status" aria-label="Chargement" />;
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="state">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state error">
      <div className="state-icon">
        <AlertTriangle size={24} />
      </div>
      <h3>Impossible de charger les données</h3>
      <span>{errorMessage(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} /> Réessayer
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon">{icon ?? <Inbox size={24} />}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Rend loading / erreur / vide / contenu selon l'état d'une requête. */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <Loading />;
  if (query.isError || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty && isEmpty(query.data)) return <>{empty ?? <Empty title="Aucun élément" />}</>;
  return <>{children(query.data)}</>;
}

export function Avatar({ name, url, size = 34 }: { name: string | null | undefined; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img className="avatar" src={url} alt="" style={{ width: size, height: size }} onError={() => setBroken(true)} />
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {initials(name)}
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <Search size={16} />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="pagination">
      <span>
        {from}–{to} sur {total}
      </span>
      <div className="row">
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {page} / {pages}
        </span>
        <button
          type="button"
          className="icon-btn"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Page suivante"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  large,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  large?: boolean;
  size?: 'lg' | 'xl';
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus : place le focus dans la boîte (sauf si un champ autoFocus l'a déjà) et le restaure à la fermeture.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, []);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    // Piège à focus minimal : le Tab reste dans la boîte de dialogue.
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal${size === 'xl' ? ' modal-xl' : large || size === 'lg' ? ' modal-lg' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Galerie de photos (preuves) : vignettes cliquables ouvrant l'image en grand dans un nouvel onglet. */
export function PhotoGrid({ photos, label }: { photos: string[]; label: string }) {
  if (photos.length === 0) return null;
  return (
    <div className="photo-grid">
      {photos.map((src, i) => (
        <a key={`${src}-${i}`} href={src} target="_blank" rel="noopener noreferrer" aria-label={`${label} — photo ${i + 1} (ouvrir en grand)`}>
          <img src={src} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

/** Tuile de montant (trésorerie, tableau de bord). */
export function StatTile({
  label,
  value,
  sub,
  tone,
  icon,
  big,
  help,
}: {
  help?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'green' | 'gray' | 'blue' | 'yellow' | 'red';
  icon?: ReactNode;
  big?: boolean;
}) {
  return (
    <div className={`card card-pad stat-tile${tone ? ' stat-' + tone : ''}${big ? ' stat-big' : ''}`}>
      <div className="row" style={{ gap: 8 }}>
        {icon}
        <span className="stat-label">{label}</span>
        {help && <Help label={typeof label === 'string' ? label : 'Indicateur'}>{help}</Help>}
      </div>
      <div className="num stat-value">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}
export function KebabMenu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button
              type="button"
              key={it.label}
              role="menuitem"
              className={it.danger ? 'danger' : undefined}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Infobulle « ? » accessible : survol, focus clavier ou clic. Le texte est relié au bouton
 * par aria-describedby (lu par les lecteurs d'écran même fermé). Positionnée en `fixed`
 * et bornée à la fenêtre pour ne jamais créer de défilement horizontal.
 */
export function Help({ children, label = 'Aide' }: { children: ReactNode; label?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    const below = r.bottom + 8;
    setPos({ top: below + 120 > window.innerHeight ? Math.max(12, r.top - 8 - 120) : below, left });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);
  return (
    <span className="help" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={btn}
        type="button"
        className="help-btn"
        aria-label={`${label} : explication`}
        aria-describedby={id}
        aria-expanded={!!pos}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && pos) {
            e.stopPropagation();
            hide();
          }
        }}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="help-tip" style={pos ? { display: 'block', top: pos.top, left: pos.left } : undefined}>
        {children}
      </span>
    </span>
  );
}
