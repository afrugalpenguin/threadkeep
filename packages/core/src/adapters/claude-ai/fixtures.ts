import fs from 'node:fs';
import path from 'node:path';
import type { FixtureGenerator } from '../types.js';
import { zipStored } from './zip-write.js';

type Json = Record<string, unknown>;

export const ISO = (n: number): string => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000000Z`;

export const textBlock = (text: string, n = 0): Json => ({
  type: 'text',
  text,
  citations: [],
  start_timestamp: ISO(n),
  stop_timestamp: ISO(n),
  flags: null,
});

export const message = (uuid: string, sender: 'human' | 'assistant', n: number, extra: Json = {}): Json => ({
  uuid,
  text: '',
  content: [],
  sender,
  created_at: ISO(n),
  updated_at: ISO(n),
  attachments: [],
  files: [],
  parent_message_uuid: '00000000-0000-4000-8000-000000000000',
  ...extra,
});

export const conversation = (uuid: string, name: string, messages: Json[], extra: Json = {}): Json => ({
  uuid,
  name,
  summary: '',
  created_at: ISO(0),
  updated_at: ISO(messages.length),
  account: { uuid: 'acct-demo' },
  chat_messages: messages,
  ...extra,
});

// A kitchen-sink synthetic export: every case the mapping has to handle. Placeholder content only.
export function sampleExport(): Json[] {
  return [
    conversation('c0000000-0000-4000-8000-000000000001', 'Demo conversation 1', [
      message('m1-1', 'human', 1, {
        content: [textBlock('Demo question about caching', 1)],
        attachments: [{ file_name: 'notes.txt', file_size: 12, file_type: 'txt', extracted_content: 'EXTRACTED-BODY-MARKER' }],
        files: [{ file_uuid: 'f-1', file_name: 'diagram.png' }],
      }),
      message('m1-2', 'assistant', 2, {
        content: [
          { type: 'thinking', thinking: 'weighing options', summaries: [], signature: null },
          textBlock('Demo answer about caching layers', 2),
          { type: 'tool_use', id: 'tu-1', name: 'web_search', input: { query: 'cache invalidation' } },
          { type: 'tool_result', tool_use_id: 'tu-1', name: 'web_search', is_error: false, content: [{ type: 'text', text: 'result one' }] },
          { type: 'token_budget' },
          { type: 'injected_prompt_block', text: 'hidden' },
        ],
      }),
    ]),
    conversation('c0000000-0000-4000-8000-000000000002', '', [
      message('m2-1', 'human', 1, { text: 'Demo conversation 2 fallback text', content: [] }),
      message('m2-2', 'assistant', 2, {
        content: [
          { type: 'tool_use', id: null, name: 'fetch', input: { url: 'https://example.com/a' } },
          { type: 'tool_use', id: null, name: 'fetch', input: { url: 'https://example.com/b' } },
          { type: 'tool_result', tool_use_id: null, name: 'fetch', is_error: false, content: [{ type: 'text', text: 'body of b' }] },
          { type: 'tool_result', tool_use_id: null, name: 'fetch', is_error: false, content: [{ type: 'text', text: 'body of a' }] },
          { type: 'tool_result', tool_use_id: null, name: 'other', is_error: true, content: [{ type: 'text', text: 'orphan' }] },
        ],
      }),
      message('m2-3', 'human', 3, {
        content: [
          { type: 'image', file_uuid: 'img-1', source: null },
          { type: 'document', file_uuid: 'doc-1', title: 'Spec' },
        ],
      }),
    ]),
    conversation('c0000000-0000-4000-8000-000000000003', 'Demo empty conversation', []),
  ];
}

// Writes conversations.json under root. Tests zip it with a test-only helper.
export const claudeAiFixtures: FixtureGenerator = {
  generate({ root }) {
    fs.mkdirSync(root, { recursive: true });
    const data = sampleExport();
    fs.writeFileSync(path.join(root, 'conversations.json'), JSON.stringify(data));
    return { sessionIds: data.map((c) => c['uuid'] as string) };
  },
  sample: writeClaudeAiSample,
};

// Two titled demo conversations, one carrying the planted secret.
export function sampleConversations(secret: string): Json[] {
  const [first, second] = sampleExport() as [Json, Json];
  const messages = first['chat_messages'] as Json[];
  messages.push(message('m1-3', 'human', 3, { content: [textBlock(`For the deploy step my token is ${secret} so keep it handy`, 3)] }));
  return [{ ...first, updated_at: ISO(messages.length) }, { ...second, name: 'Demo conversation 2' }];
}

// Writes root/export.zip containing conversations.json, the file a claude.ai data export carries.
export function writeClaudeAiSample({ root, secret }: { root: string; secret: string }): { files: string[] } {
  fs.mkdirSync(root, { recursive: true });
  const zip = zipStored({ 'conversations.json': JSON.stringify(sampleConversations(secret)) });
  fs.writeFileSync(path.join(root, 'export.zip'), zip);
  return { files: ['export.zip'] };
}
