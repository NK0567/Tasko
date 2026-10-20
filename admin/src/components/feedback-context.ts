import { createContext, useContext, type ReactNode } from 'react';

export interface ToastApi {
  success: (msg: string) => void;
  error: (errOrMsg: unknown) => void;
}
export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export const ToastCtx = createContext<ToastApi | null>(null);
export const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast hors FeedbackProvider');
  return ctx;
}
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm hors FeedbackProvider');
  return ctx;
}
