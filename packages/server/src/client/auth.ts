import { DEFAULT_HASH, TOKEN_KEY, takeTokenFromHash } from './lib/token.js';

// Fallback when localStorage is unavailable (blocked or throwing).
let memory = '';
const listeners = new Set<() => void>();

function readStored(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function store(token: string): void {
  memory = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Memory copy above is enough for this page load.
  }
}

export const currentToken = (): string => readStored();

export function clearToken(): void {
  memory = '';
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to clear.
  }
  for (const listener of listeners) listener();
}

// Called before the first render and on every hash change: moves a token from the address bar
// into storage and rewrites the URL so it does not stay in the address bar and session history.
export function captureTokenFromLocation(): boolean {
  const taken = takeTokenFromHash(location.hash);
  if (!taken) return false;
  store(taken.token);
  history.replaceState(null, '', location.pathname + (taken.rest || DEFAULT_HASH));
  return true;
}

export function onTokenCleared(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
