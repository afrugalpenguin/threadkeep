import { patterns as defaultPatterns, type RedactionPattern } from './patterns.js';

export { patterns, type RedactionPattern } from './patterns.js';

export function redactText(text: string | null, patterns: RedactionPattern[] = defaultPatterns): string | null {
  if (text === null || text === '') return text;
  let out = text;
  for (const { name, pattern, replacement } of patterns) {
    out = out.replace(pattern, () => replacement ?? `[REDACTED:${name}]`);
  }
  return out;
}
