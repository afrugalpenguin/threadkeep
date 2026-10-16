import { MARK_CLOSE, MARK_OPEN } from '../../shared/marks.js';

export interface Segment {
  text: string;
  hit: boolean;
}

export function segments(snippet: string): Segment[] {
  const out: Segment[] = [];
  let buffer = '';
  let hit = false;
  for (const ch of snippet) {
    if (ch === MARK_OPEN || ch === MARK_CLOSE) {
      if (buffer) out.push({ text: buffer, hit });
      buffer = '';
      hit = ch === MARK_OPEN;
    } else buffer += ch;
  }
  if (buffer) out.push({ text: buffer, hit });
  return out;
}
