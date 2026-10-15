export type Params = Record<string, string>;
export type Route =
  | { view: 'sessions'; params: Params }
  | { view: 'search'; params: Params }
  | { view: 'session'; id: string; params: Params }
  | { view: 'decisions'; params: Params };

const fallback = (): Route => ({ view: 'sessions', params: {} });

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const cut = raw.indexOf('?');
  const pathPart = cut === -1 ? raw : raw.slice(0, cut);
  const query = cut === -1 ? '' : raw.slice(cut + 1);
  const params: Params = Object.fromEntries(new URLSearchParams(query));
  let parts: string[];
  try {
    parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return fallback();
  }
  const [view, id] = parts;
  if (view === 'sessions' || view === 'search' || view === 'decisions') return { view, params };
  if (view === 'session' && id) return { view, id, params };
  return fallback();
}

export function buildHash(route: Route): string {
  const query = new URLSearchParams(Object.entries(route.params).filter(([, v]) => v !== '')).toString();
  const base = route.view === 'session' ? `#/session/${encodeURIComponent(route.id)}` : `#/${route.view}`;
  return query ? `${base}?${query}` : base;
}
