import { describe, expect, it } from 'vitest';
import { filesUpTo, groupTurns, turnOfEvent } from '../src/client/lib/turns.js';
import { segments } from '../src/client/lib/highlight.js';
import { buildHash, parseHash } from '../src/client/lib/route.js';
import { MARK_CLOSE as C, MARK_OPEN as O } from '../src/shared/marks.js';

const ev = (id: string, role: string, kind = 'text', files: string[] = []) => ({ id, role, kind, files_touched: files });

describe('groupTurns', () => {
  it('starts a turn at each user text event and keeps leading events in turn 0', () => {
    const turns = groupTurns([ev('a', 'assistant'), ev('u1', 'user'), ev('t1', 'tool', 'tool'), ev('u2', 'user'), ev('x', 'assistant')]);
    expect(turns.map((t) => t.events.map((e) => e.id))).toEqual([['a'], ['u1', 't1'], ['u2', 'x']]);
    expect(groupTurns([])).toEqual([]);
  });

  it('finds the turn holding an event, defaulting to 0', () => {
    const turns = groupTurns([ev('u1', 'user'), ev('a1', 'assistant'), ev('u2', 'user')]);
    expect(turnOfEvent(turns, 'a1')).toBe(0);
    expect(turnOfEvent(turns, 'u2')).toBe(1);
    expect(turnOfEvent(turns, 'missing')).toBe(0);
  });
});

describe('filesUpTo', () => {
  it('counts files touched through a turn with the first turn that touched each', () => {
    const turns = groupTurns([
      ev('u1', 'user'),
      ev('t1', 'tool', 'tool', ['a.ts']),
      ev('u2', 'user'),
      ev('t2', 'tool', 'tool', ['a.ts', 'b.ts']),
    ]);
    expect(filesUpTo(turns, 0)).toEqual([{ file: 'a.ts', count: 1, firstTurn: 0 }]);
    expect(filesUpTo(turns, 1)).toEqual([
      { file: 'a.ts', count: 2, firstTurn: 0 },
      { file: 'b.ts', count: 1, firstTurn: 1 },
    ]);
  });
});

describe('segments', () => {
  it('splits a marked snippet and leaves brackets alone', () => {
    expect(segments(`a [b] ${O}hit${C} c ${O}two${C}`)).toEqual([
      { text: 'a [b] ', hit: false },
      { text: 'hit', hit: true },
      { text: ' c ', hit: false },
      { text: 'two', hit: true },
    ]);
    expect(segments('')).toEqual([]);
  });
});

describe('routes', () => {
  it('round trips each view through the hash', () => {
    const cases = [
      { view: 'sessions', params: { sort: 'length', project: 'demo' } },
      { view: 'search', params: { q: 'two words', role: 'user' } },
      { view: 'session', id: 'abc', params: { event: 'e1' } },
      { view: 'decisions', params: { status: 'proposed' } },
    ] as const;
    for (const route of cases) expect(parseHash(buildHash(route))).toEqual(route);
  });

  it('falls back to sessions for unknown or empty hashes', () => {
    expect(parseHash('')).toEqual({ view: 'sessions', params: {} });
    expect(parseHash('#/nope')).toEqual({ view: 'sessions', params: {} });
    expect(parseHash('#/session/')).toEqual({ view: 'sessions', params: {} });
  });

  it('falls back instead of throwing on malformed percent escapes', () => {
    expect(parseHash('#/session/%zz')).toEqual({ view: 'sessions', params: {} });
    expect(parseHash('#/%E0%A4%A')).toEqual({ view: 'sessions', params: {} });
  });

  it('keeps everything after the first question mark as the query', () => {
    expect(parseHash('#/search?q=a?b&role=user')).toEqual({ view: 'search', params: { q: 'a?b', role: 'user' } });
    const route = { view: 'search', params: { q: 'what? why?' } } as const;
    expect(parseHash(buildHash(route))).toEqual(route);
  });
});
