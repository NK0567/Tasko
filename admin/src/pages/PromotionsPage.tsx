import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { promotionsApi } from '../api/admin';
import type { Promotion, PromotionInput } from '../api/types';
import { useConfirm, useToast } from '../components/feedback-context';
import { Badge, Empty, Modal, QueryState, Spinner, Switch } from '../components/ui';
import { formatDate, formatNumber } from '../lib/format';

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function PromoForm({ promo, onClose }: { promo: Promotion | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(promo?.code ?? '');
  const [description, setDescription] = useState(promo?.description ?? '');
  const [discount, setDiscount] = useState(String(promo?.discount_percent ?? 10));
  const [maxUses, setMaxUses] = useState(promo?.max_uses != null ? String(promo.max_uses) : '');
  const [expires, setExpires] = useState(toDateInput(promo?.expires_at ?? null));
  const [active, setActive] = useState(promo?.is_active ?? true);
  const [touched, setTouched] = useState(false);

  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) errors.code = '3 à 30 caractères : lettres majuscules, chiffres, - ou _.';
  const disc = Number(discount);
  if (!Number.isInteger(disc) || disc < 1 || disc > 100) errors.discount = 'Entier entre 1 et 100 %.';
  if (maxUses !== '' && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1)) errors.maxUses = 'Entier ≥ 1, ou vide pour illimité.';

  const mut = useMutation({
    mutationFn: (input: PromotionInput) => (promo ? promotionsApi.update(promo.id, input) : promotionsApi.create(input)),
    onSuccess: (p) => {
      toast.success(promo ? `Code ${p.code} mis à jour.` : `Code ${p.code} créé.`);
      void qc.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    mut.mutate({
      code,
      description: description.trim() || null,
      discount_percent: disc,
      max_uses: maxUses === '' ? null : Number(maxUses),
      expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      is_active: active,
    });
  }

  return (
    <Modal
      title={promo ? `Modifier ${promo.code}` : 'Nouveau code promo'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn" type="submit" form="promo-form" disabled={mut.isPending}>
            {mut.isPending ? <Spinner small /> : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id="promo-form" onSubmit={submit} noValidate className="form-grid">
        <div className="field">
          <label htmlFor="p-code">
            Code <span className="req">*</span>
          </label>
          <input
            id="p-code"
            className={`input${touched && errors.code ? ' invalid' : ''}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
            placeholder="BIENVENUE10"
            autoFocus
          />
          {touched && errors.code && <span className="field-error">{errors.code}</span>}
        </div>
        <div className="field">
          <label htmlFor="p-disc">
            Réduction (%) <span className="req">*</span>
          </label>
          <input id="p-disc" type="number" min={1} max={100} className={`input${touched && errors.discount ? ' invalid' : ''}`} value={discount} onChange={(e) => setDiscount(e.target.value)} />
          {touched && errors.discount && <span className="field-error">{errors.discount}</span>}
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="p-desc">Description</label>
          <input id="p-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Offre de lancement Douala" />
        </div>
        <div className="field">
          <label htmlFor="p-max">Utilisations max.</label>
          <input id="p-max" type="number" min={1} className={`input${touched && errors.maxUses ? ' invalid' : ''}`} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Illimité" />
          {touched && errors.maxUses && <span className="field-error">{errors.maxUses}</span>}
        </div>
        <div className="field">
          <label htmlFor="p-exp">Expire le</label>
          <input id="p-exp" type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Statut</span>
          <div className="row" style={{ height: 40 }}>
            <Switch checked={active} onChange={setActive} label="Code actif" />
            {active ? 'Actif' : 'Inactif'}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function PromotionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(p: Promotion, v: boolean) {
    setBusy(p.id);
    try {
      await promotionsApi.update(p.id, { is_active: v });
      toast.success(`Code ${p.code} ${v ? 'activé' : 'désactivé'}.`);
      void qc.invalidateQueries({ queryKey: ['promotions'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function remove(p: Promotion) {
    const ok = await confirm({
      title: `Supprimer le code ${p.code} ?`,
      message: 'Les clients ne pourront plus l’utiliser. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      await promotionsApi.remove(p.id);
      toast.success(`Code ${p.code} supprimé.`);
      void qc.invalidateQueries({ queryKey: ['promotions'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Promotions</h1>
          <p>Codes promo appliqués sur les frais de service.</p>
        </div>
        <button className="btn" onClick={() => setEditing('new')}>
          <Plus size={16} /> Nouveau code
        </button>
      </div>
      <div className="card">
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <Empty title="Aucun code promo" icon={<Tag size={24} />}>
              <button className="btn btn-sm" onClick={() => setEditing('new')}>
                <Plus size={14} /> Créer un code
              </button>
            </Empty>
          }
        >
          {(d) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th className="right">Réduction</th>
                    <th className="right">Utilisations</th>
                    <th>Expiration</th>
                    <th>Actif</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((p) => {
                    const expired = p.expires_at ? new Date(p.expires_at) < new Date() : false;
                    return (
                      <tr key={p.id}>
                        <td>
                          <span className="badge tone-yellow" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                            {p.code}
                          </span>
                        </td>
                        <td>{p.description || <span className="muted">—</span>}</td>
                        <td className="right num strong">{p.discount_percent} %</td>
                        <td className="right num">
                          {p.used_count !== undefined ? formatNumber(p.used_count) : '—'} / {p.max_uses != null ? formatNumber(p.max_uses) : '∞'}
                        </td>
                        <td>
                          {p.expires_at ? (
                            <span className="row" style={{ gap: 6 }}>
                              {formatDate(p.expires_at)} {expired && <Badge tone="red">Expiré</Badge>}
                            </span>
                          ) : (
                            <span className="muted">Jamais</span>
                          )}
                        </td>
                        <td>
                          <Switch checked={p.is_active} disabled={busy === p.id} onChange={(v) => void toggle(p, v)} label={`Activer ${p.code}`} />
                        </td>
                        <td>
                          <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                            <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`Modifier ${p.code}`} title="Modifier">
                              <Pencil size={16} />
                            </button>
                            <button className="icon-btn" disabled={busy === p.id} onClick={() => void remove(p)} aria-label={`Supprimer ${p.code}`} title="Supprimer">
                              <Trash2 size={16} color="var(--red)" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>
      {editing && <PromoForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
