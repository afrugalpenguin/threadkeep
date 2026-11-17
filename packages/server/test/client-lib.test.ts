import { describe, expect, it } from 'vitest';
import { filesUpTo, firstLine, groupTurns, turnOfEvent } from '../src/client/lib/turns.js';
import { segments } from '../src/client/lib/highlight.js';
import { buildHash, parseHash } from '../src/client/lib/route.js';
import { takeTokenFromHash } from '../src/client/lib/token.js';
import { TOOL_OUTPUT_SEPARATOR as CORE_SEPARATOR } from 'threadkeep-core';
import { TOOL_OUTPUT_SEPARATOR } from '../src/shared/separator.js';
import { effectiveSort, withValidSort, SEARCH_SORTS, SESSION_SORTS } from '../src/client/lib/sorts.js';
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

describe('system events in turns', () => {
  it('does not start a turn', () => {
    const turns = groupTurns([ev('u1', 'user'), ev('s1', 'system'), ev('a1', 'assistant'), ev('s2', 'system'), ev('u2', 'user')]);
    expect(turns.map((t) => t.events.map((e) => e.id))).toEqual([['u1', 's1', 'a1', 's2'], ['u2']]);
  });
});

describe('firstLine', () => {
  it('takes the first non-empty line and truncates with an ellipsis', () => {
    expect(firstLine('\n  hello world\nsecond', 80)).toBe('hello world');
    expect(firstLine('x'.repeat(100), 80)).toBe(`${'x'.repeat(77)}...`);
    expect(firstLine('x'.repeat(80), 80)).toBe('x'.repeat(80));
    expect(firstLine('', 80)).toBe('');
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

describe('filesUpTo repeats', () => {
  it('counts a file once per event even when the event lists it twice', () => {
    const turns = groupTurns([ev('u1', 'user'), ev('t1', 'tool', 'tool', ['a.ts', 'a.ts'])]);
    expect(filesUpTo(turns, 0)).toEqual([{ file: 'a.ts', count: 1, firstTurn: 0 }]);
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

describe('shared separator', () => {
  it('matches the separator core uses to split tool content', () => {
    expect(TOOL_OUTPUT_SEPARATOR).toBe(CORE_SEPARATOR);
  });
});

describe('sort fallback', () => {
  it('shows the first option for an unsupported sort and does not forward it', () => {
    expect(effectiveSort('rank', SESSION_SORTS)).toBe('time');
    expect(effectiveSort('length', SEARCH_SORTS)).toBe('rank');
    expect(effectiveSort('project', SESSION_SORTS)).toBe('project');
    expect(effectiveSort(undefined, SEARCH_SORTS)).toBe('rank');
    expect(withValidSort({ sort: 'rank', source: 'x' }, SESSION_SORTS)).toEqual({ source: 'x' });
    expect(withValidSort({ sort: 'length' }, SESSION_SORTS)).toEqual({ sort: 'length' });
  });
});

describe('takeTokenFromHash', () => {
  const hex = 'ab12'.repeat(12);
  it('extracts the token and lands on the sessions list by default', () => {
    expect(takeTokenFromHash(`#token=${hex}`)).toEqual({ token: hex, rest: '#/sessions' });
  });

  it('keeps an optional route after an ampersand', () => {
    expect(takeTokenFromHash(`#token=${hex}&/session/abc`)).toEqual({ token: hex, rest: '#/session/abc' });
    expect(takeTokenFromHash(`#token=${hex}&x=1`)).toEqual({ token: hex, rest: '#/sessions' });
  });

  it('returns null for anything that is not a well-formed token fragment', () => {
    for (const hash of ['#token=', '#/sessions', '', '#', '#token', '#token=XYZ', '#token=abc def', '#/token=abc', 'token=abc']) {
      expect(takeTokenFromHash(hash), hash).toBeNull();
    }
  });

  it('does not collide with route parsing', () => {
    expect(parseHash(`#token=${hex}`)).toEqual({ view: 'sessions', params: {} });
  });
});
