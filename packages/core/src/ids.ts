import { createHash } from 'node:crypto';

// Stable across machines and rebuilds so decisions and links keep pointing at the same events.
export function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

export const TITLE_MAX = 80;

// Shared title fallback: the first user text, whitespace collapsed, cut to 80 characters.
export function titleFromText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

// Tool events hold "<summary><separator><output>" in content so a result can arrive before or after its call.
export const TOOL_OUTPUT_SEPARATOR = '\n--- output ---\n';

export function splitToolContent(content: string | null): { summary: string; output: string | null } {
  if (content === null) return { summary: '', output: null };
  const at = content.indexOf(TOOL_OUTPUT_SEPARATOR);
  if (at < 0) return { summary: content, output: null };
  return { summary: content.slice(0, at), output: content.slice(at + TOOL_OUTPUT_SEPARATOR.length) };
}
