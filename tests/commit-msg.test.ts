import { describe, expect, it } from 'vitest';
import { checkCommitMessage } from '../scripts/check-commit-msg.mjs';

describe('commit message gate', () => {
  it('accepts a conventional subject with a body and trailer', () => {
    expect(checkCommitMessage('feat(core): add store\n\nBody text.\n\nCo-Authored-By: Someone <x@example.com>\n')).toEqual([]);
  });

  it('rejects a subject without type and scope', () => {
    expect(checkCommitMessage('add store')).toHaveLength(1);
    expect(checkCommitMessage('feat: add store')).toHaveLength(1);
    expect(checkCommitMessage('feature(core): add store')).toHaveLength(1);
  });

  it('rejects a subject over 72 characters', () => {
    const subject = `feat(core): ${'x'.repeat(61)}`;
    expect(subject.length).toBe(73);
    expect(checkCommitMessage(subject)).toEqual(['subject is 73 chars, max 72']);
    expect(checkCommitMessage(subject.slice(0, 72))).toEqual([]);
  });

  it('rejects em and en dashes anywhere in the message', () => {
    expect(checkCommitMessage(`feat(core): add store\n\nfast ${String.fromCodePoint(0x2014)} and safe`)).toHaveLength(1);
  });

  it('ignores git comment lines', () => {
    expect(checkCommitMessage('# comment\nfix(cli): handle empty query\n# more')).toEqual([]);
  });
});
