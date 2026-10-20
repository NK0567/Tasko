import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/admin';
import { ApiError, setUnauthorizedHandler, tokenStore } from '../api/client';
import type { User } from '../api/types';
import { closeSocket } from '../lib/socket';
import { AuthCtx, type Status } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? 'checking' : 'anonymous'));

  const logout = useCallback(() => {
    tokenStore.clear();
    closeSocket();
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Validation du jeton stocké au démarrage.
  useEffect(() => {
    if (status !== 'checking') return;
    let cancelled = false;
    authApi
      .me()
      .then((me) => {
        if (cancelled) return;
        if (!me.is_admin) {
          logout();
          return;
        }
        setUser(me);
        setStatus('authenticated');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Serveur injoignable / erreur 5xx : on garde le jeton et on propose de réessayer.
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) setStatus('unreachable');
        else logout();
      });
    return () => {
      cancelled = true;
    };
  }, [status, logout]);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await authApi.login(phone, password);
    if (!res.user.is_admin) {
      throw new ApiError(403, 'FORBIDDEN', "Ce compte n'a pas les droits d'administration Tasko.");
    }
    tokenStore.set(res.token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const retry = useCallback(() => setStatus('checking'), []);
  const value = useMemo(() => ({ status, user, login, logout, retry }), [status, user, login, logout, retry]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
