export const TOKEN_KEY = 'hansard-token';
export const DEFAULT_HASH = '#/sessions';

// Pulls the run token out of a `#token=<hex>` fragment. Anything after the first `&` becomes the
// route to land on (`#token=abc&/session/x`), otherwise the sessions list. Returns null when the
// hash does not carry a well-formed token.
export function takeTokenFromHash(hash: string): { token: string; rest: string } | null {
  if (!hash.startsWith('#token=')) return null;
  const body = hash.slice('#token='.length);
  const cut = body.indexOf('&');
  const token = cut === -1 ? body : body.slice(0, cut);
  if (!/^[0-9a-f]+$/.test(token)) return null;
  const route = cut === -1 ? '' : body.slice(cut + 1);
  return { token, rest: route.startsWith('/') ? `#${route}` : DEFAULT_HASH };
}
