import { useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, LayoutGrid, Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react';
import { categoriesApi } from '../api/admin';
import { ApiError } from '../api/client';
import type { Category, CategoryInput, ListResponse } from '../api/types';
import { useConfirm, useToast } from '../components/feedback-context';
import { CatIcon, Empty, KebabMenu, Loading, ErrorState, SearchInput, Switch } from '../components/ui';
import { formatNumber, timeAgo } from '../lib/format';
import CategoryForm, { type CategoryFormInitial } from './categories/CategoryForm';
import s from './categories/Categories.module.css';

const KEY = ['admin-categories'];

function sortTree(items: Category[]): Category[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ ...c, children: c.children ? [...c.children].sort((a, b) => a.position - b.position) : [] }));
}

function normalize(t: string) {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Ordre des frères (siblings) d'un niveau, après déplacement de `id` vers l'index `to`. */
function moveId(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

export default function CategoriesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: KEY, queryFn: categoriesApi.list });
  const suggestions = useQuery({ queryKey: ['category-suggestions'], queryFn: categoriesApi.suggestions });

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<CategoryFormInitial | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; parent: string | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

  const tree = useMemo(() => sortTree(query.data?.items ?? []), [query.data]);
  const term = normalize(search.trim());
  const searching = term.length > 0;

  const visible = useMemo(() => {
    if (!searching) return tree;
    return tree
      .map((c) => {
        const selfMatch = normalize(c.name).includes(term) || normalize(c.description ?? '').includes(term);
        const kids = (c.children ?? []).filter((k) => normalize(k.name).includes(term));
        if (selfMatch) return c;
        if (kids.length) return { ...c, children: kids };
        return null;
      })
      .filter((c): c is Category => c !== null);
  }, [tree, term, searching]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const save = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CategoryInput }) =>
      id ? categoriesApi.update(id, input) : categoriesApi.create(input),
    onSuccess: (cat, v) => {
      toast.success(v.id ? `« ${cat.name} » a été mise à jour.` : `« ${cat.name} » a été créée.`);
      if (cat.parent_id) setExpanded((e) => new Set(e).add(cat.parent_id!));
      setForm(null);
      invalidate();
      void qc.invalidateQueries({ queryKey: ['category-suggestions'] });
    },
    onError: (e) => toast.error(e),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => categoriesApi.reorder(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<ListResponse<Category>>(KEY);
      if (prev) {
        const pos = new Map(ids.map((id, i) => [id, i + 1]));
        const apply = (c: Category): Category => ({
          ...c,
          position: pos.get(c.id) ?? c.position,
          children: c.children?.map(apply),
        });
        qc.setQueryData<ListResponse<Category>>(KEY, { items: prev.items.map(apply) });
      }
      return { prev };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error(e);
    },
    onSuccess: () => toast.success('Nouvel ordre enregistré.'),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  async function toggleActive(c: Category, v: boolean) {
    setTogglingId(c.id);
    try {
      await categoriesApi.update(c.id, { is_active: v });
      toast.success(`« ${c.name} » est maintenant ${v ? 'active' : 'inactive'}.`);
      invalidate();
    } catch (e) {
      toast.error(e);
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(c: Category) {
    const kids = c.children?.length ?? 0;
    const ok = await confirm({
      title: `Supprimer « ${c.name} » ?`,
      message: (
        <>
          Cette action est définitive.
          {kids > 0 && (
            <>
              {' '}
              Ses <strong>{kids} sous-service(s)</strong> seront également concernés.
            </>
          )}{' '}
          Si des missions y sont liées, la suppression sera refusée : désactivez-la plutôt.
        </>
      ),
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await categoriesApi.remove(c.id);
      toast.success(`« ${c.name} » a été supprimée.`);
      invalidate();
    } catch (e) {
      toast.error(e);
      if (e instanceof ApiError && e.code === 'CONFLICT' && c.is_active) {
        const deactivate = await confirm({
          title: 'Désactiver plutôt ?',
          message: `« ${c.name} » est liée à des missions. La désactiver la masquera dans l'application sans perdre l'historique.`,
          confirmLabel: 'Désactiver',
        });
        if (deactivate) await toggleActive(c, false);
      }
    }
  }

  function siblingsOf(parent: string | null): Category[] {
    if (!parent) return tree;
    return tree.find((t) => t.id === parent)?.children ?? [];
  }

  function move(c: Category, delta: number) {
    const ids = siblingsOf(c.parent_id).map((x) => x.id);
    const idx = ids.indexOf(c.id);
    const next = moveId(ids, c.id, idx + delta);
    if (next.join() !== ids.join()) reorder.mutate(next);
  }

  function nextPosition(parent: string | null) {
    const sib = siblingsOf(parent);
    return sib.length ? Math.max(...sib.map((x) => x.position)) + 1 : 1;
  }

  // ---- Glisser-déposer (HTML5) : uniquement entre frères d'un même niveau ----
  function onDragStart(e: DragEvent, c: Category) {
    setDrag({ id: c.id, parent: c.parent_id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', c.id);
  }
  function onDragOver(e: DragEvent, c: Category) {
    if (!drag || drag.parent !== c.parent_id || drag.id === c.id) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (dropTarget?.id !== c.id || dropTarget.after !== after) setDropTarget({ id: c.id, after });
  }
  function onDrop(e: DragEvent, c: Category) {
    e.preventDefault();
    if (drag && dropTarget && drag.parent === c.parent_id) {
      const ids = siblingsOf(c.parent_id).map((x) => x.id);
      const without = ids.filter((id) => id !== drag.id);
      let to = without.indexOf(c.id) + (dropTarget.after ? 1 : 0);
      if (to < 0) to = without.length;
      without.splice(to, 0, drag.id);
      if (without.join() !== ids.join()) reorder.mutate(without);
    }
    setDrag(null);
    setDropTarget(null);
  }
  function onDragEnd() {
    setDrag(null);
    setDropTarget(null);
  }

  function renderRow(c: Category, index: number, count: number) {
    const isChild = !!c.parent_id;
    const isOpen = searching || expanded.has(c.id);
    const kids = c.children ?? [];
    const canDrag = !searching && !reorder.isPending;
    const cls = [
      s.row,
      isChild ? s.child : '',
      !c.is_active ? s.inactive : '',
      drag?.id === c.id ? s.dragging : '',
      dropTarget?.id === c.id ? (dropTarget.after ? s.dropAfter : s.dropBefore) : '',
    ].join(' ');

    return (
      <div
        key={c.id}
        className={cls}
        draggable={canDrag}
        onDragStart={(e) => onDragStart(e, c)}
        onDragOver={(e) => onDragOver(e, c)}
        onDrop={(e) => onDrop(e, c)}
        onDragEnd={onDragEnd}
      >
        <span className={`${s.handle} ${canDrag ? '' : s.handleDisabled}`} title="Glisser pour réordonner" aria-hidden>
          <GripVertical size={16} />
        </span>
        <div className={s.arrows}>
          <button
            className="icon-btn"
            disabled={!canDrag || index === 0}
            onClick={() => move(c, -1)}
            aria-label={`Monter ${c.name}`}
            title="Monter"
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="icon-btn"
            disabled={!canDrag || index === count - 1}
            onClick={() => move(c, 1)}
            aria-label={`Descendre ${c.name}`}
            title="Descendre"
          >
            <ChevronDown size={16} />
          </button>
        </div>
        <CatIcon icon={c.icon} color={c.color} size={isChild ? 32 : 40} />
        <div className={s.info}>
          <div className={s.name}>
            {c.name}
            {!isChild && kids.length > 0 && (
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                onClick={() =>
                  setExpanded((e) => {
                    const n = new Set(e);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })
                }
                aria-expanded={isOpen}
                aria-label={isOpen ? 'Replier les sous-services' : 'Déplier les sous-services'}
              >
                <ChevronRight size={16} className={`${s.expand} ${isOpen ? s.expanded : ''}`} />
              </button>
            )}
          </div>
          {c.description && <div className={s.desc}>{c.description}</div>}
        </div>
        <div className={s.meta}>
          {formatNumber(c.providers_count)} prestataire{c.providers_count > 1 ? 's' : ''}
          {!isChild && <> · {kids.length} sous-service{kids.length > 1 ? 's' : ''}</>}
        </div>
        <div className={s.status}>
          <span className={s.statusLabel} style={{ color: c.is_active ? 'var(--green-700)' : undefined, fontWeight: 600 }}>
            {c.is_active ? 'Actif' : 'Inactif'}
          </span>
          <Switch
            checked={c.is_active}
            disabled={togglingId === c.id}
            onChange={(v) => void toggleActive(c, v)}
            label={`${c.is_active ? 'Désactiver' : 'Activer'} ${c.name}`}
          />
        </div>
        <KebabMenu
          label={`Actions pour ${c.name}`}
          items={[
            { label: 'Modifier', icon: <Pencil size={16} />, onClick: () => setForm({ category: c }) },
            ...(!isChild
              ? [
                  {
                    label: 'Ajouter un sous-service',
                    icon: <Plus size={16} />,
                    onClick: () => setForm({ parent_id: c.id, position: nextPosition(c.id) }),
                  },
                ]
              : []),
            { label: 'Supprimer', icon: <Trash2 size={16} />, danger: true, onClick: () => void remove(c) },
          ]}
        />
      </div>
    );
  }

  const totalSub = tree.reduce((a, c) => a + (c.children?.length ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Gestion des catégories</h1>
          <p>
            Catégories et sous-services proposés dans l'application — ajoutez-en de nouveaux sans mise à jour de l'app.
          </p>
        </div>
        <button className="btn" onClick={() => setForm({ parent_id: null, position: nextPosition(null) })}>
          <Plus size={16} /> Ajouter une catégorie
        </button>
      </div>

      <div className={s.layout}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-body toolbar" style={{ borderBottom: '1px solid var(--gray-200)' }}>
            <div className="grow" style={{ minWidth: 220 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Rechercher une catégorie…" />
            </div>
            {query.data && (
              <span className="muted small">
                {tree.length} catégories · {totalSub} sous-services
              </span>
            )}
          </div>
          {searching && (
            <div className="muted small" style={{ padding: '8px 16px', background: 'var(--gray-100)' }}>
              Réordonnancement désactivé pendant la recherche.
            </div>
          )}
          {query.isLoading ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : visible.length === 0 ? (
            searching ? (
              <Empty title="Aucune catégorie ne correspond" />
            ) : (
              <Empty title="Aucune catégorie" icon={<LayoutGrid size={24} />}>
                <span>Créez la première catégorie de services.</span>
                <button className="btn btn-sm" onClick={() => setForm({ parent_id: null, position: 1 })}>
                  <Plus size={14} /> Ajouter une catégorie
                </button>
              </Empty>
            )
          ) : (
            <div className={s.list} style={{ opacity: reorder.isPending ? 0.7 : 1 }}>
              {visible.map((c, i) => {
                const kids = c.children ?? [];
                const open = searching || expanded.has(c.id);
                return (
                  <div key={c.id}>
                    {renderRow(c, i, visible.length)}
                    {open && kids.map((k, j) => renderRow(k, j, kids.length))}
                    {open && !searching && (
                      <div className={`${s.row} ${s.child}`} style={{ paddingTop: 6, paddingBottom: 8 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setForm({ parent_id: c.id, position: nextPosition(c.id) })}
                        >
                          <Plus size={14} /> Ajouter un sous-service à « {c.name} »
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="row">
              <Lightbulb size={18} color="#B98900" />
              <h2>Services suggérés</h2>
            </div>
          </div>
          <div className="card-body">
            <p className="muted small" style={{ marginTop: 0 }}>
              Services saisis par les utilisateurs dans « Autre service ». Les plus demandés méritent peut-être leur propre
              catégorie.
            </p>
            {suggestions.isLoading ? (
              <Loading />
            ) : suggestions.isError ? (
              <ErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} />
            ) : (suggestions.data?.items.length ?? 0) === 0 ? (
              <Empty title="Aucune suggestion pour l'instant" />
            ) : (
              [...suggestions.data!.items]
                .sort((a, b) => b.count - a.count)
                .map((sug) => (
                  <div key={sug.label} className={s.suggestion}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="strong">{sug.label}</span>
                      <span className="badge tone-yellow">{formatNumber(sug.count)} demande{sug.count > 1 ? 's' : ''}</span>
                    </div>
                    <span className="muted small">Dernière demande {timeAgo(sug.last_at)}</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => setForm({ name: sug.label, parent_id: null, position: nextPosition(null) })}
                    >
                      <Plus size={14} /> Créer cette catégorie
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {form && (
        <CategoryForm
          key={form.category?.id ?? `new-${form.parent_id ?? 'root'}-${form.name ?? ''}`}
          initial={form}
          parents={tree}
          saving={save.isPending}
          onClose={() => setForm(null)}
          onSubmit={(input) => save.mutate({ id: form.category?.id, input })}
        />
      )}
    </div>
  );
}
