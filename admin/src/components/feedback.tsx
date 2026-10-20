import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { errorMessage } from '../api/client';
import { ConfirmCtx, ToastCtx, type ConfirmFn, type ConfirmOptions, type ToastApi } from './feedback-context';
import { Modal } from './ui';

type ToastKind = 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6500 : 3500);
    },
    [dismiss],
  );
  const toastApi = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (e) => push('error', typeof e === 'string' ? e : errorMessage(e)),
    }),
    [push],
  );

  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );
  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <ToastCtx.Provider value={toastApi}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        {pending && (
          <Modal
            title={pending.title}
            onClose={() => close(false)}
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => close(false)}>
                  Annuler
                </button>
                <button className={`btn${pending.danger ? ' btn-danger' : ''}`} onClick={() => close(true)} autoFocus>
                  {pending.confirmLabel ?? 'Confirmer'}
                </button>
              </>
            }
          >
            <div style={{ color: 'var(--gray-700)' }}>{pending.message}</div>
          </Modal>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              {t.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span className="grow">{t.message}</span>
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => dismiss(t.id)} aria-label="Fermer">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
