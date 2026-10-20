import type { ApiErrorBody, ApiErrorCode } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
const TOKEN_KEY = 'tasko_admin_token';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* stockage indisponible */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized: (() => void) | null = null;
/** Appelé sur toute réponse 401 (hors login) : déconnexion. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(
  method: Method,
  path: string,
  opts: { query?: Query; body?: unknown; skipAuthRedirect?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Impossible de joindre le serveur Tasko. Vérifiez que l'API est démarrée.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const apiErr = new ApiError(
      res.status,
      err?.code ?? (res.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL'),
      err?.message ?? `Erreur serveur (${res.status})`,
      err?.details,
    );
    if (res.status === 401 && !opts.skipAuthRedirect) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    throw apiErr;
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Envoi multipart d'un fichier (champ `file`). */
export async function upload(path: string, file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method: 'POST', headers, body: fd });
  } catch {
    throw new ApiError(0, 'NETWORK', "Impossible d'envoyer le fichier : serveur injoignable.");
  }
  const data = (await res.json().catch(() => null)) as ({ url: string } & Partial<ApiErrorBody>) | null;
  if (!res.ok || !data?.url) {
    if (res.status === 401) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? `Envoi du fichier impossible (${res.status})`);
  }
  return { url: data.url };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Une erreur inattendue est survenue.';
}
