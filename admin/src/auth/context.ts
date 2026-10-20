import { createContext, useContext } from 'react';
import type { User } from '../api/types';

/** `unreachable` : jeton présent mais serveur injoignable — on ne déconnecte pas. */
export type Status = 'checking' | 'authenticated' | 'anonymous' | 'unreachable';
export interface AuthState {
  status: Status;
  user: User | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  retry: () => void;
}
export const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
