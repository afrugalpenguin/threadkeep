import type { DecisionRow, Facets, SearchHit, SessionRow, ShownSession } from '@hansard/core';

const token = document.querySelector('meta[name="hansard-token"]')?.getAttribute('content') ?? '';

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
  const res = await fetch(query ? `${path}?${query}` : path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
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
        headers: { 'content-type': 'application/json', 'x-hansard-token': token },
        body: JSON.stringify({ status }),
      },
    ),
};

// Keeps only the listed keys so each endpoint gets clean URLs.
export function pick(params: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => keys.includes(k) && v !== ''));
}
