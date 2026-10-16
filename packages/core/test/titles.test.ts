import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importClaudeAi, ingestAll, openDb, type HansardContext } from '../src/index.js';
import { conversation, message, textBlock } from '../src/adapters/claude-ai/fixtures.js';
import { userText } from '../src/adapters/claude-code/fixtures.js';
import { makeMachine, tempDir, writeSession } from './helpers.js';
import { writeZip } from './zip.js';

const j = (...parts: string[]) => parts.join('');
const SID = '33333333-3333-4333-8333-333333333333';

// Secrets assembled at runtime; each is placed so it straddles character 80 of the title.
const secrets = {
  connection: j('postgres', '://admin:', 'hunter2hunter2', '@example.com:5432/app'),
  jwt: j('eyJ', 'hbGciOiJIUzI1NiJ9', '.eyJ', 'zdWIiOiJkZW1vIn0', '.', 'c2lnbmF0dXJlMTIzNDU'),
};
const pad = (secret: string, at = 70) => `${'x'.repeat(at)} ${secret} tail`;

const titles = (ctx: HansardContext) => {
  const db = openDb(ctx.dbPath);
  try {
    return (db.prepare('select title from sessions').all() as { title: string }[]).map((r) => r.title);
  } finally {
    db.close();
  }
};

describe('titles are redacted before truncation', () => {
  it.each(Object.entries(secrets))('claude code fallback title with %s', async (_name, secret) => {
    const m = makeMachine();
    writeSession(m.claudeRoot, SID, userText({ sessionId: SID, uuid: 'u1', timestamp: '2026-01-01T10:00:00.000Z' }, pad(secret)));
    await ingestAll(m.ctx);
    const [title] = titles(m.ctx);
    expect(title).toContain('[REDACTED');
    for (const fragment of ['hunter2', 'hbGciOiJIUzI1', 'admin:', 'c2lnbmF0']) expect(title).not.toContain(fragment);
    expect((title as string).length).toBeLessThanOrEqual(80);
  });

  it.each(Object.entries(secrets))('claude.ai fallback title with %s', async (_name, secret) => {
    const m = makeMachine();
    const data = [conversation('c-1', '', [message('m-1', 'human', 1, { content: [textBlock(pad(secret), 1)] })])];
    const zip = path.join(tempDir(), 'x.zip');
    await writeZip(zip, { 'conversations.json': JSON.stringify(data) });
    await importClaudeAi(m.ctx, [zip]);
    const [title] = titles(m.ctx);
    expect(title).toContain('[REDACTED');
    for (const fragment of ['hunter2', 'hbGciOiJIUzI1', 'admin:', 'c2lnbmF0']) expect(title).not.toContain(fragment);
  });

  it('redacts explicit claude.ai names and keeps them untruncated', async () => {
    const m = makeMachine();
    const name = pad(secrets.connection, 90);
    const data = [conversation('c-2', name, [])];
    const zip = path.join(tempDir(), 'y.zip');
    await writeZip(zip, { 'conversations.json': JSON.stringify(data) });
    await importClaudeAi(m.ctx, [zip]);
    const [title] = titles(m.ctx);
    expect(title).toContain('[REDACTED:connection-string]');
    expect(title).not.toContain('hunter2');
  });
});
