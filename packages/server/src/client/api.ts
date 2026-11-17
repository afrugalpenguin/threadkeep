import type { DecisionRow, Facets, SearchHit, SessionRow, ShownSession } from 'threadkeep-core';

import { clearToken, currentToken } from './auth.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, params: Record<string, string> = {}, init?: RequestInit): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  const sent = currentToken();
  const res = await fetch(query ? `${path}?${query}` : path, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), 'x-hansard-token': sent },
  });
  // Another tab may have stored a newer token meanwhile; only drop the one this request used.
  if (res.status === 401 && currentToken() === sent) clearToken();
  let body: { error?: string };
  try {
    body = (await res.json()) as { error?: string };
  } catch {
    if (res.ok) throw new ApiError(res.status, 'invalid response');
    body = {};
  }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `request failed (${res.status})`);
  return body as T;
}

export const api = {
  sessions: (p: Record<string, string>) => call<SessionRow[]>('/api/sessions', p),
  search: (p: Record<string, string>) => call<SearchHit[]>('/api/search', p),
  session: (id: string, p: Record<string, string>) => call<ShownSession>(`/api/sessions/${encodeURIComponent(id)}`, p),
  facets: () => call<Facets>('/api/facets'),
  decisions: (p: Record<string, string>) => call<DecisionRow[]>('/api/decisions', p),
  setDecision: (id: string, status: 'confirmed' | 'dismissed') =>
    call<DecisionRow>(
      `/api/decisions/${encodeURIComponent(id)}/status`,
      {},
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    ),
};

// Keeps only the listed keys so each endpoint gets clean URLs.
export function pick(params: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => keys.includes(k) && v !== ''));
}
