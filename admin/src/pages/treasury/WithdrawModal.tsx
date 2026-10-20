import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Lock, Send } from 'lucide-react';
import { payoutAccountsApi, settingsApi, treasuryApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { Treasury, WithdrawalInput } from '../../api/types';
import { useToast } from '../../components/feedback-context';
import { Loading, Modal, Spinner } from '../../components/ui';
import { formatMoney, formatNumber, parseAmount } from '../../lib/format';
import { PAYOUT_TYPE } from '../../lib/labels';
import { estimateWithdrawalFee } from '../../lib/providers';
import { accountSummary } from './account-utils';

/** Au-delà de ce montant, on recommande la banque plutôt que Mobile Money (plafonds opérateurs). */
const MOMO_SOFT_LIMIT = 500_000;

export default function WithdrawModal({ treasury, onClose, onAddAccount }: { treasury: Treasury; onClose: () => void; onAddAccount: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['payout-accounts'], queryFn: payoutAccountsApi.list });
  const providers = useQuery({ queryKey: ['payment-providers'], queryFn: settingsApi.providers });
  const available = Math.max(0, treasury.revenue_available);

  const [amountRaw, setAmountRaw] = useState('');
  const [accountId, setAccountId] = useState<string>('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<{ field: 'amount' | 'password' | null; message: string } | null>(null);

  const list = accounts.data?.items ?? [];
  const effectiveAccountId = accountId || list.find((a) => a.is_default)?.id || list[0]?.id || '';
  const account = list.find((a) => a.id === effectiveAccountId) ?? null;
  const amount = parseAmount(amountRaw);
  const payoutProvider = providers.data?.items.find((p) => p.id === treasury.payout_provider) ?? null;
  const estimate = account
    ? estimateWithdrawalFee(payoutProvider, amount ?? 0, account.type, account.type === 'bank' ? account.bank_name ?? 'bancaire' : PAYOUT_TYPE[account.type])
    : null;
  const fee = estimate?.fee ?? 0;
  /** Montant maximal retirable une fois les frais du fournisseur déduits. */
  const maxAmount = (() => {
    if (!account || !payoutProvider) return available;
    if (account.type === 'bank') return Math.max(0, available - (payoutProvider.fees.bank_flat ?? 0));
    const rate = payoutProvider.fees.payout_rate ?? 0;
    let m = Math.floor(available / (1 + rate));
    while (m > 0 && m + Math.ceil(m * rate) > available) m -= 1;
    return Math.max(0, m);
  })();

  const errors: { amount?: string; account?: string; password?: string } = {};
  if (amount === null || amount <= 0) errors.amount = 'Saisissez un montant entier en FCFA.';
  else if (amount + fee > available) errors.amount = `Montant + frais (${formatMoney(amount + fee)}) supérieur à vos revenus disponibles (${formatMoney(available)}).`;
  if (!account) errors.account = 'Choisissez un compte de destination.';
  else if (estimate && !estimate.supported) errors.account = estimate.message;
  if (!password) errors.password = 'Re-saisissez votre mot de passe pour confirmer votre identité.';
  const invalid = Object.keys(errors).length > 0;

  const mut = useMutation({
    mutationFn: (input: WithdrawalInput) => treasuryApi.withdraw(input),
    onSuccess: (w) => {
      setPassword('');
      toast.success(
        w.status === 'success'
          ? `Retrait de ${formatMoney(w.amount)} effectué.`
          : `Retrait de ${formatMoney(w.amount)} demandé — en cours de traitement.`,
      );
      void qc.invalidateQueries({ queryKey: ['treasury'] });
      onClose();
    },
    onError: (e) => {
      setPassword('');
      if (e instanceof ApiError && e.status === 401) {
        setServerError({ field: 'password', message: 'Mot de passe incorrect. Le retrait n’a pas été effectué.' });
      } else if (e instanceof ApiError && e.status === 409) {
        setServerError({
          field: 'amount',
          message: `Montant refusé : il dépasse vos revenus disponibles au moment de la demande. ${e.message ? `(${e.message}) ` : ''}Le solde a été actualisé.`,
        });
        void qc.invalidateQueries({ queryKey: ['treasury'] });
      } else {
        setServerError({ field: null, message: e instanceof Error ? e.message : 'Le retrait a échoué.' });
      }
      setStep('form');
    },
  });

  function next(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (!invalid) setStep('confirm');
  }

  const showErr = (k: keyof typeof errors) => (serverError?.field === k ? serverError.message : touched && errors[k] ? errors[k] : null);
  const isMomo = account?.type === 'mtn_momo' || account?.type === 'orange_money';

  return (
    <Modal
      title={step === 'form' ? 'Retirer mes revenus' : 'Confirmer le retrait'}
      onClose={mut.isPending ? () => undefined : onClose}
      footer={
        step === 'form' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" form="withdraw-form" className="btn" disabled={list.length === 0 || available <= 0}>
              Continuer
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setStep('form')} disabled={mut.isPending}>
              <ArrowLeft size={16} /> Modifier
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={mut.isPending}
              onClick={() => account && amount !== null && mut.mutate({ amount, payout_account_id: account.id, password })}
            >
              {mut.isPending ? <Spinner small /> : <Send size={16} />} Confirmer le retrait de {formatMoney(amount)}
            </button>
          </>
        )
      }
    >
      {accounts.isLoading ? (
        <Loading label="Chargement des comptes…" />
      ) : step === 'form' ? (
        <form id="withdraw-form" onSubmit={next} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="notice green">
            <span>
              Revenus disponibles : <strong className="num">{formatMoney(available)}</strong>. L'argent bloqué des clients et celui dû aux prestataires n'est jamais retirable.
            </span>
          </div>
          {serverError && serverError.field === null && (
            <div className="notice" role="alert" style={{ background: 'var(--red-100)', color: 'var(--red)' }}>
              {serverError.message}
            </div>
          )}
          {list.length === 0 && (
            <div className="notice" role="alert">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>
                Aucun compte de versement.{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={onAddAccount}>
                  Ajouter un compte
                </button>
              </span>
            </div>
          )}
          <div className="field">
            <label htmlFor="wd-amount">
              Montant (FCFA) <span className="req">*</span>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="wd-amount"
                className={`input${showErr('amount') ? ' invalid' : ''}`}
                inputMode="numeric"
                autoComplete="off"
                value={amountRaw}
                onChange={(e) => {
                  setAmountRaw(e.target.value);
                  if (serverError?.field === 'amount') setServerError(null);
                }}
                placeholder="0"
                aria-invalid={!!showErr('amount')}
                aria-describedby="wd-amount-help"
                autoFocus
              />
              <button type="button" className="btn btn-secondary" onClick={() => setAmountRaw(String(maxAmount))} disabled={available <= 0}>
                Tout retirer
              </button>
            </div>
            <span id="wd-amount-help" className={showErr('amount') ? 'field-error' : 'hint'} role={showErr('amount') ? 'alert' : undefined}>
              {showErr('amount') ?? (amount ? `= ${formatMoney(amount)} · reste après retrait et frais : ${formatMoney(Math.max(0, available - amount - fee))}` : `Maximum : ${formatNumber(available)} FCFA (frais compris)`)}
            </span>
          </div>
          <div className="field">
            <label htmlFor="wd-account">
              Compte de destination <span className="req">*</span>
            </label>
            <select
              id="wd-account"
              className={`input${showErr('account') ? ' invalid' : ''}`}
              value={effectiveAccountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={list.length === 0}
            >
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountSummary(a)} · {PAYOUT_TYPE[a.type]}
                  {a.is_default ? ' (par défaut)' : ''}
                </option>
              ))}
            </select>
            {showErr('account') && <span className="field-error">{showErr('account')}</span>}
            {estimate && estimate.supported && (
              <span className="hint" data-testid="withdraw-fee-estimate" style={estimate.fee && estimate.fee >= 1000 ? { color: '#8a6600' } : undefined}>
                Frais estimés : {estimate.message}
              </span>
            )}
            {estimate && !estimate.supported && !showErr('account') && (
              <span className="field-error" role="alert">{estimate.message}</span>
            )}
            {isMomo && amount !== null && amount > MOMO_SOFT_LIMIT && (
              <span className="hint" style={{ color: '#8a6600' }}>
                Montant élevé pour Mobile Money : les opérateurs appliquent des plafonds par opération et par jour. Préférez le compte bancaire.
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="wd-password">
              Mot de passe administrateur <span className="req">*</span>
            </label>
            <div className="search" style={{ minWidth: 0 }}>
              <Lock size={16} />
              <input
                id="wd-password"
                type="password"
                autoComplete="current-password"
                className={`input${showErr('password') ? ' invalid' : ''}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (serverError?.field === 'password') setServerError(null);
                }}
                aria-invalid={!!showErr('password')}
                aria-describedby="wd-password-help"
              />
            </div>
            <span id="wd-password-help" className={showErr('password') ? 'field-error' : 'hint'} role={showErr('password') ? 'alert' : undefined}>
              {showErr('password') ?? 'Obligatoire pour tout retrait (journalisé dans l’audit).'}
            </span>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <dl className="dl">
            <dt>Montant retiré</dt>
            <dd className="num strong" style={{ fontSize: 18, color: 'var(--green-700)' }}>
              {formatMoney(amount)}
            </dd>
            <dt>Vers</dt>
            <dd>
              {account ? accountSummary(account) : '—'}
              <div className="small muted">
                {account?.type === 'bank' ? account.bank_name ?? PAYOUT_TYPE.bank : account ? PAYOUT_TYPE[account.type] : ''}
                {account?.account_holder ? ` · ${account.account_holder}` : ''}
              </div>
            </dd>
            <dt>Frais estimés ({treasury.payout_provider ? payoutProvider?.name ?? treasury.payout_provider : 'agrégateur'})</dt>
            <dd className="num">{estimate?.fee === null || estimate?.fee === undefined ? 'non publiés' : formatMoney(estimate.fee)}</dd>
            <dt>Disponible avant</dt>
            <dd className="num">{formatMoney(available)}</dd>
            <dt>Disponible après</dt>
            <dd className="num">{formatMoney(Math.max(0, available - (amount ?? 0) - fee))}</dd>
          </dl>
          <div className="notice">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              Opération financière irréversible une fois acceptée par l'agrégateur. Des frais de transfert de l'agrégateur peuvent s'appliquer ; ils
              apparaîtront dans l'historique.
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
