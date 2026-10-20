import { useMemo, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { Category, CategoryInput } from '../../api/types';
import { CatIcon, Modal, MSym, Spinner, Switch } from '../../components/ui';
import { ALLOWED_ICONS, COLOR_PRESETS } from '../../lib/labels';

export interface CategoryFormInitial {
  /** Catégorie éditée (absente en création). */
  category?: Category;
  name?: string;
  parent_id?: string | null;
  position?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export default function CategoryForm({
  initial,
  parents,
  saving,
  onSubmit,
  onClose,
}: {
  initial: CategoryFormInitial;
  parents: Category[];
  saving: boolean;
  onSubmit: (input: CategoryInput) => void;
  onClose: () => void;
}) {
  const c = initial.category;
  const [name, setName] = useState(c?.name ?? initial.name ?? '');
  const [description, setDescription] = useState(c?.description ?? '');
  const [icon, setIcon] = useState(c?.icon ?? '');
  const [color, setColor] = useState(c?.color ?? COLOR_PRESETS[0]);
  const [parentId, setParentId] = useState<string>(c ? c.parent_id ?? '' : initial.parent_id ?? '');
  const [active, setActive] = useState(c?.is_active ?? true);
  const [position, setPosition] = useState<string>(String(c?.position ?? initial.position ?? 1));
  const [iconFilter, setIconFilter] = useState('');
  const [touched, setTouched] = useState(false);

  const hasChildren = (c?.children?.length ?? 0) > 0;
  const parentOptions = parents.filter((p) => p.id !== c?.id);

  const errors = useMemo(() => {
    const e: Partial<Record<'name' | 'description' | 'icon' | 'color' | 'position', string>> = {};
    if (!name.trim()) e.name = 'Le nom est obligatoire.';
    else if (name.trim().length > 80) e.name = '80 caractères maximum.';
    if (!description.trim()) e.description = 'La description est obligatoire.';
    if (!icon) e.icon = 'Choisissez une icône.';
    if (color && !HEX.test(color)) e.color = 'Format attendu : #RRGGBB.';
    if (position !== '' && (!Number.isInteger(Number(position)) || Number(position) < 0)) e.position = 'Entier positif attendu.';
    return e;
  }, [name, description, icon, color, position]);

  const icons = ALLOWED_ICONS.filter((k) => k.includes(iconFilter.trim().toLowerCase().replace(/\s+/g, '_')));

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      icon,
      color: color || undefined,
      parent_id: parentId || null,
      is_active: active,
      ...(position !== '' ? { position: Number(position) } : {}),
    });
  }

  const title = c
    ? c.parent_id
      ? 'Modifier le sous-service'
      : 'Modifier la catégorie'
    : parentId
      ? 'Ajouter un sous-service'
      : 'Ajouter une catégorie';

  return (
    <Modal
      title={title}
      onClose={onClose}
      large
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="category-form" className="btn" disabled={saving}>
            {saving ? <Spinner small /> : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row" style={{ gap: 14, alignItems: 'center', padding: 12, background: 'var(--gray-100)', borderRadius: 12 }}>
          <CatIcon icon={icon || 'more_horiz'} color={HEX.test(color) ? color : undefined} size={48} />
          <div>
            <div className="strong">{name || 'Nom de la catégorie'}</div>
            <div className="small muted">{description || 'Aperçu tel que vu dans l’application'}</div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="cat-name">
            Nom de la catégorie <span className="req">*</span>
          </label>
          <input
            id="cat-name"
            className={`input${touched && errors.name ? ' invalid' : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Tresses & Coiffure"
            autoFocus
          />
          {touched && errors.name && <span className="field-error">{errors.name}</span>}
        </div>

        <div className="field">
          <label htmlFor="cat-desc">
            Description <span className="req">*</span>
          </label>
          <textarea
            id="cat-desc"
            className={`input${touched && errors.description ? ' invalid' : ''}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex. Services de coiffure à domicile ou en salon."
          />
          {touched && errors.description && <span className="field-error">{errors.description}</span>}
        </div>

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">
              Icône <span className="req">*</span>
            </span>
            <input
              className="input"
              style={{ width: 200, height: 32 }}
              placeholder="Filtrer les icônes…"
              value={iconFilter}
              onChange={(e) => setIconFilter(e.target.value)}
              aria-label="Filtrer les icônes"
            />
          </div>
          <div
            role="radiogroup"
            aria-label="Icône"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
              gap: 6,
              maxHeight: 190,
              overflowY: 'auto',
              padding: 6,
              border: `1px solid ${touched && errors.icon ? 'var(--red)' : 'var(--gray-200)'}`,
              borderRadius: 12,
            }}
          >
            {icons.map((k) => {
              const sel = k === icon;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  title={k}
                  onClick={() => setIcon(k)}
                  style={{
                    height: 48,
                    borderRadius: 10,
                    border: sel ? '2px solid var(--green-700)' : '1px solid transparent',
                    background: sel ? 'var(--green-50)' : 'transparent',
                    color: sel ? 'var(--green-700)' : 'var(--gray-700)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <MSym name={k} size={24} />
                </button>
              );
            })}
            {icons.length === 0 && <span className="muted small">Aucune icône ne correspond.</span>}
          </div>
          {touched && errors.icon && <span className="field-error">{errors.icon}</span>}
        </div>

        <div className="form-grid">
          <div className="field">
            <span className="label">Couleur</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {COLOR_PRESETS.map((col) => (
                <button
                  key={col}
                  type="button"
                  title={col}
                  aria-label={`Couleur ${col}`}
                  onClick={() => setColor(col)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: col,
                    border: '2px solid #fff',
                    boxShadow: color.toLowerCase() === col.toLowerCase() ? `0 0 0 2px ${col}` : '0 0 0 1px var(--gray-300)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                  }}
                >
                  {color.toLowerCase() === col.toLowerCase() && <Check size={14} />}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="color"
                value={HEX.test(color) ? color : '#0F7A3D'}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                aria-label="Couleur personnalisée"
                style={{ width: 40, height: 34, border: 'none', background: 'none', padding: 0 }}
              />
              <input className={`input${errors.color ? ' invalid' : ''}`} style={{ width: 120, height: 34 }} value={color} onChange={(e) => setColor(e.target.value)} aria-label="Code couleur" />
            </div>
            {errors.color && <span className="field-error">{errors.color}</span>}
          </div>

          <div className="field">
            <label htmlFor="cat-parent">Catégorie parente</label>
            <select id="cat-parent" className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={hasChildren}>
              <option value="">— Aucune (catégorie principale)</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="hint">
              {hasChildren
                ? 'Cette catégorie contient des sous-services : elle reste principale.'
                : 'Choisir une parente en fait un sous-service (un seul niveau).'}
            </span>
          </div>

          <div className="field">
            <span className="label">Statut</span>
            <div className="row" style={{ height: 40 }}>
              <Switch checked={active} onChange={setActive} label="Catégorie active" />
              <span>{active ? 'Actif — visible dans l’application' : 'Inactif — masqué'}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="cat-pos">Position</label>
            <input
              id="cat-pos"
              className={`input${errors.position ? ' invalid' : ''}`}
              type="number"
              min={0}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
            {errors.position ? <span className="field-error">{errors.position}</span> : <span className="hint">Ordre d'affichage (plus petit = en premier).</span>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
