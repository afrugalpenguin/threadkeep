import { describe, expect, it } from 'vitest';
import { copyFixtures, sandbox } from './helpers.js';

const fileLines = (out: string, status: string) => out.split('\n').filter((l) => l.startsWith(`${status}  `));

describe('ingest output on the fixture sessions', () => {
  it('lists each ingested file and a scan summary, then reports everything unchanged on a rerun', async () => {
    const box = sandbox();
    copyFixtures(box);

    const first = await box.cli('ingest');
    expect(first.code).toBe(0);
    expect(first.out).toContain('scanned 3 source files, 3 archive files: 3 ingested, 0 unchanged, 0 skipped, 0 failed');
    const ingested = fileLines(first.out, 'ingested');
    expect(ingested).toHaveLength(3);
    expect(ingested.join('\n')).toContain('aaaaaaaa-0000-4000-8000-000000000002.jsonl  +5 events  +8 records');
    expect(first.out + first.err).not.toContain(box.base);

    const again = await box.cli('ingest');
    expect(again.code).toBe(0);
    expect(again.out).toContain('3 archive files: 0 ingested, 3 unchanged, 0 skipped, 0 failed');
    expect(fileLines(again.out, 'ingested')).toEqual([]);
    expect(fileLines(again.out, 'unchanged')).toEqual([]);

    const verbose = await box.cli('ingest', '--verbose');
    expect(fileLines(verbose.out, 'unchanged')).toHaveLength(3);
  });
});
