import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Star, Trash2 } from 'lucide-react';
import { payoutAccountsApi } from '../../api/admin';
import type { PayoutAccount, PayoutAccountInput, PayoutAccountType } from '../../api/types';
import { useConfirm, useToast } from '../../components/feedback-context';
import { Badge, Empty, Modal, QueryState, Spinner } from '../../components/ui';
import { normalizePhone } from '../../lib/format';
import { PAYOUT_TYPE } from '../../lib/labels';
import { accountIcon, accountSummary } from './account-utils';

const BANK_SUGGESTIONS = [
  'Ecobank Cameroun',
  'Afriland First Bank',
  'Société Générale Cameroun',
  'UBA Cameroun',
  'BICEC',
  'Commercial Bank Cameroun',
  'CCA Bank',
];

function AddAccountModal({ onClose, hasDefault }: { onClose: () => void; hasDefault: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<PayoutAccountType>('bank');
  const [label, setLabel] = useState('');
  const [bankName, setBankName] = useState('Ecobank Cameroun');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [isDefault, setIsDefault] = useState(!hasDefault);
  const [touched, setTouched] = useState(false);

  const cleanNumber = number.replace(/[\s-]/g, '').toUpperCase();
  const normPhone = normalizePhone(phone);
  const errors: Record<string, string> = {};
  if (!label.trim()) errors.label = 'Donnez un nom à ce compte (ex. « Ecobank pro »).';
  if (type === 'bank') {
    if (!bankName.trim()) errors.bank_name = 'Nom de la banque requis.';
    if (holder.trim().length < 2) errors.account_holder = 'Titulaire du compte requis.';
    if (!/^[A-Z0-9]{10,34}$/.test(cleanNumber))
      errors.account_number = 'Numéro de compte / RIB invalide (10 à 34 caractères, chiffres et lettres).';
  } else if (!normPhone) {
    errors.phone = 'Numéro invalide : 9 chiffres commençant par 6 (ex. 690 00 00 01).';
  }
  const invalid = Object.keys(errors).length > 0;

  const mut = useMutation({
    mutationFn: (input: PayoutAccountInput) => payoutAccountsApi.create(input),
    onSuccess: (a) => {
      toast.success(`Compte « ${a.label} » ajouté.`);
      void qc.invalidateQueries({ queryKey: ['payout-accounts'] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    const input: PayoutAccountInput =
      type === 'bank'
        ? { type, label: label.trim(), bank_name: bankName.trim(), account_holder: holder.trim(), account_number: cleanNumber, is_default: isDefault }
        : { type, label: label.trim(), phone: normPhone!, account_holder: holder.trim() || undefined, is_default: isDefault };
    mut.mutate(input);
  }

  const err = (k: string) =>
    touched && errors[k] ? (
      <span className="field-error" id={`pa-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;
  const invalidProps = (k: string) => ({
    'aria-invalid': touched && !!errors[k],
    'aria-describedby': touched && errors[k] ? `pa-${k}-err` : undefined,
    className: `input${touched && errors[k] ? ' invalid' : ''}`,
  });

  return (
    <Modal
      title="Ajouter un compte de versement"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="payout-account-form" className="btn" disabled={mut.isPending}>
            {mut.isPending ? <Spinner small /> : <Plus size={16} />} Ajouter le compte
          </button>
        </>
      }
    >
      <form id="payout-account-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div role="radiogroup" aria-label="Type de compte" className="row wrap" style={{ alignItems: 'stretch', gap: 8 }}>
          {(Object.keys(PAYOUT_TYPE) as PayoutAccountType[]).map((t) => (
            <button
              type="button"
              key={t}
              role="radio"
              aria-checked={type === t}
              className="choice row"
              style={{ gap: 8, flexBasis: 140 }}
              onClick={() => setType(t)}
            >
              {accountIcon(t)} <span className="strong">{PAYOUT_TYPE[t]}</span>
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="pa-label">
            Nom du compte <span className="req">*</span>
          </label>
          <input
            id="pa-label"
            {...invalidProps('label')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={type === 'bank' ? 'Ecobank — compte pro' : 'MoMo perso'}
          />
          {err('label')}
        </div>

        {type === 'bank' ? (
          <>
            <div className="field">
              <label htmlFor="pa-bank">
                Banque <span className="req">*</span>
              </label>
              <input id="pa-bank" list="pa-bank-list" {...invalidProps('bank_name')} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              <datalist id="pa-bank-list">
                {BANK_SUGGESTIONS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              {err('bank_name') ?? <span className="hint">Suggestion : un compte professionnel Ecobank pour les gros montants.</span>}
            </div>
            <div className="field">
              <label htmlFor="pa-holder">
                Titulaire du compte <span className="req">*</span>
              </label>
              <input id="pa-holder" autoComplete="off" {...invalidProps('account_holder')} value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="TASKO SARL" />
              {err('account_holder')}
            </div>
            <div className="field">
              <label htmlFor="pa-number">
                Numéro de compte / RIB <span className="req">*</span>
              </label>
              <input
                id="pa-number"
                autoComplete="off"
                spellCheck={false}
                inputMode="numeric"
                {...invalidProps('account_number')}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="10005 00001 01234567890 12"
              />
              {err('account_number') ?? (
                <span className="hint">RIB camerounais : 23 chiffres. Chiffré par le serveur, jamais réaffiché en clair.</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pa-phone">
                Numéro {type === 'mtn_momo' ? 'MTN MoMo' : 'Orange Money'} <span className="req">*</span>
              </label>
              <input
                id="pa-phone"
                inputMode="tel"
                autoComplete="off"
                {...invalidProps('phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="6XX XX XX XX"
              />
              {err('phone') ?? <span className="hint">Chiffré par le serveur, affiché ensuite masqué.</span>}
            </div>
            <div className="field">
              <label htmlFor="pa-holder2">Nom du titulaire (facultatif)</label>
              <input id="pa-holder2" className="input" autoComplete="off" value={holder} onChange={(e) => setHolder(e.target.value)} />
            </div>
          </>
        )}

        <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Compte par défaut (utilisé aussi pour le reversement automatique)
        </label>
      </form>
    </Modal>
  );
}

export default function PayoutAccounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: ['payout-accounts'], queryFn: payoutAccountsApi.list });

  const setDefault = useMutation({
    mutationFn: (a: PayoutAccount) => payoutAccountsApi.update(a.id, { is_default: true }),
    onSuccess: (_r, a) => {
      toast.success(`« ${a.label} » est maintenant le compte par défaut.`);
      void qc.invalidateQueries({ queryKey: ['payout-accounts'] });
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (a: PayoutAccount) => payoutAccountsApi.remove(a.id),
    onSuccess: (_r, a) => {
      toast.success(`Compte « ${a.label} » supprimé.`);
      void qc.invalidateQueries({ queryKey: ['payout-accounts'] });
    },
    onError: (e) => toast.error(e),
  });

  async function askRemove(a: PayoutAccount) {
    const ok = await confirm({
      title: 'Supprimer ce compte de versement ?',
      message: (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{accountSummary(a)}</strong> ne pourra plus recevoir de retraits. Les retraits passés restent dans l'historique.
          </p>
          {a.is_default && <p style={{ marginBottom: 0 }}>C'est votre compte par défaut : le reversement automatique sera suspendu tant qu'aucun autre compte n'est défini par défaut.</p>}
        </>
      ),
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) remove.mutate(a);
  }

  const items = query.data?.items ?? [];
  const hasDefault = items.some((a) => a.is_default);

  return (
    <div className="card" id="payout-accounts">
      <div className="card-head">
        <div>
          <h2>Comptes de versement</h2>
          <div className="muted small">Où vos revenus sont envoyés. Les numéros sont protégés et affichés masqués.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
          <Plus size={14} /> Ajouter
        </button>
      </div>
      <div className="card-body">
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={
            <Empty title="Aucun compte de versement" icon={<Landmark size={24} />}>
              <span>Ajoutez votre compte Ecobank (ou un numéro Mobile Money) pour pouvoir retirer vos revenus.</span>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
                <Plus size={14} /> Ajouter un compte
              </button>
            </Empty>
          }
        >
          {(d) => (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.items.map((a) => (
                <li key={a.id} className="row wrap" style={{ padding: 12, border: '1px solid var(--gray-200)', borderRadius: 12, alignItems: 'flex-start' }}>
                  <span className="cat-icon" style={{ width: 38, height: 38, background: 'var(--green-100)', color: 'var(--green-700)' }}>
                    {accountIcon(a.type)}
                  </span>
                  <div className="grow" style={{ minWidth: 160 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className="strong">{a.label}</span>
                      {a.is_default && <Badge tone="green">Par défaut</Badge>}
                    </div>
                    <div className="small muted">
                      {a.type === 'bank' ? a.bank_name ?? PAYOUT_TYPE.bank : PAYOUT_TYPE[a.type]}
                      {a.account_holder ? ` · ${a.account_holder}` : ''}
                    </div>
                    <div className="num small" style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {(a.type === 'bank' ? a.account_number_masked : a.phone_masked) ?? '—'}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {!a.is_default && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={setDefault.isPending}
                        onClick={() => setDefault.mutate(a)}
                        aria-label={`Définir ${a.label} comme compte par défaut`}
                      >
                        <Star size={14} /> Par défaut
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={remove.isPending && remove.variables?.id === a.id}
                      onClick={() => void askRemove(a)}
                      aria-label={`Supprimer le compte ${a.label}`}
                      title="Supprimer"
                    >
                      <Trash2 size={16} color="var(--red)" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
      {adding && <AddAccountModal onClose={() => setAdding(false)} hasDefault={hasDefault} />}
    </div>
  );
}
