import { describe, expect, it } from 'vitest';
import { getSession, ingestAll, openDb, redactText, search } from '../src/index.js';
import { assistant, toolResultLine, userText } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, writeSession } from './helpers.js';

// Fake secrets are assembled at runtime so no scanner sees a literal token in this file.
const j = (...parts: string[]) => parts.join('');
const rep = (c: string, n: number) => c.repeat(n);

const cases: { name: string; secret: string; text: (s: string) => string }[] = [
  {
    name: 'private-key',
    secret: j('-----BEGIN RSA PRIVATE ', 'KEY-----\\n', rep('QUJD', 20), '\\n-----END RSA PRIVATE ', 'KEY-----'),
    text: (s) => `before ${s} after`,
  },
  { name: 'jwt', secret: j('eyJ', 'hbGciOiJIUzI1', '.eyJ', 'zdWIiOiJkZW1vIn0', '.', 'c2lnbmF0dXJl'), text: (s) => `jwt ${s} end` },
  { name: 'bearer', secret: j('Bearer ', rep('a1B2', 6)), text: (s) => `Authorization: ${s} end` },
  { name: 'aws-access-key', secret: j('AKIA', rep('A1', 8)), text: (s) => `key ${s} end` },
  {
    name: 'aws-secret',
    secret: j('aws_secret', '_access_key = ', rep('aB3/', 10)),
    text: (s) => `cfg ${s} end`,
  },
  { name: 'anthropic', secret: j('sk-', 'ant-', rep('abC9', 6)), text: (s) => `key ${s} end` },
  { name: 'openai', secret: j('sk-', 'proj-', rep('xY7z', 8)), text: (s) => `key ${s} end` },
  { name: 'github', secret: j('gh', 'p_', rep('Ab1C', 6)), text: (s) => `token ${s} end` },
  { name: 'github', secret: j('github', '_pat_', rep('Zz9Y', 8)), text: (s) => `token ${s} end` },
  { name: 'slack', secret: j('xo', 'xb-', rep('1234', 4), '-abcdEFGH'), text: (s) => `hook ${s} end` },
  { name: 'google-api', secret: j('AI', 'za', rep('Qw1_', 8), 'abc'), text: (s) => `key ${s} end` },
  { name: 'stripe', secret: j('sk', '_live_', rep('Ab12', 6)), text: (s) => `key ${s} end` },
  {
    name: 'connection-string',
    secret: j('postgres', '://demo_user:hunter2pass@example.com:5432/app'),
    text: (s) => `url ${s} end`,
  },
  { name: 'password-assignment', secret: j('Pass', 'word=Sup3rS3cretVal'), text: (s) => `Server=db;${s};Trusted=no` },
  { name: 'azure-account-key', secret: j('Account', 'Key=', rep('Zm9v', 10), '=='), text: (s) => `${s};End=1` },
  { name: 'azure-sas', secret: j('Shared', 'AccessSignature=', rep('sv1', 8)), text: (s) => `${s};End=1` },
  { name: 'azure-sas', secret: j('?s', 'ig=', rep('ab12', 6)), text: (s) => `https://example.com/blob${s} end` },
  { name: 'generic-secret', secret: j('api', '_key: ', 'abcdef123456'), text: (s) => `conf ${s} end` },
  { name: 'generic-secret', secret: j('"pass', 'word": "', 'hunter2hunter2', '"'), text: (s) => `{${s}}` },
];

describe('redaction patterns', () => {
  it.each(cases)('redacts $name', ({ name, secret, text }) => {
    const out = redactText(text(secret)) as string;
    expect(out).toContain(`[REDACTED:${name}]`);
    expect(out).not.toContain(secret);
    expect(out).not.toMatch(/QUJDQUJD|hunter2|abcdef123456|Sup3rS3cretVal/);
  });

  it('leaves ordinary text alone', () => {
    expect(redactText('Demo conversation 1 about tokens and passwords')).toBe('Demo conversation 1 about tokens and passwords');
  });

  it('honours a custom replacement', () => {
    expect(redactText('xyz', [{ name: 'x', pattern: /xyz/g, replacement: '***' }])).toBe('***');
  });
});

describe('redaction through ingest', () => {
  const SID = '22222222-2222-4222-8222-222222222222';
  const secret = j('sk-', 'ant-', rep('qZ8x', 6));
  const b = (n: number) => ({ sessionId: SID, uuid: `u${n}`, timestamp: `2026-01-01T10:00:0${n}.000Z` });

  const setup = async () => {
    const m = makeMachine();
    writeSession(
      m.claudeRoot,
      SID,
      userText(b(1), `please rotate the credential ${secret} soon`) +
        assistant(b(2), [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `export KEY=${secret}` } }]) +
        toolResultLine(b(3), 't1', `leaked ${secret} output`),
    );
    await ingestAll(m.ctx);
    return m;
  };

  it('stores redacted columns, finds surrounding words, never the secret', async () => {
    const m = await setup();
    const db = openDb(m.ctx.dbPath);
    expect(search(db, { query: secret }).length).toBe(0);
    expect(search(db, { query: 'rotate credential' })).toHaveLength(1);
    const hits = search(db, { query: 'rotate' });
    expect(JSON.stringify(hits)).not.toContain(secret);
    const shown = getSession(db, SID.slice(0, 8), { expandTools: true });
    expect(JSON.stringify(shown)).not.toContain(secret);
    expect(JSON.stringify(shown)).toContain('[REDACTED:anthropic]');
    const fts = db.prepare("select count(*) as n from events_fts where events_fts match '\"qZ8xqZ8x\"'").get();
    expect(fts).toEqual({ n: 0 });
    // The raw record keeps the original; it is never shown.
    const raw = db.prepare('select count(*) as n from raw_records where raw like ?').get(`%${secret}%`) as { n: number };
    expect(raw.n).toBeGreaterThan(0);
    db.close();
  });

  it('redacts titles too', async () => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText(b(1), `Demo ${secret}`));
    await ingestAll(m.ctx);
    const db = openDb(m.ctx.dbPath);
    const title = (db.prepare('select title from sessions').get() as { title: string }).title;
    expect(title).toContain('[REDACTED:anthropic]');
    expect(title).not.toContain(secret);
    db.close();
  });
});
