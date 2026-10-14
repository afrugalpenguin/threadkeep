import { stableId, titleFromText, TOOL_OUTPUT_SEPARATOR } from '../../ids.js';
import { pathsFrom, summariseToolInput } from '../claude-code/parse.js';
import type { EventOut, ParseResult } from '../types.js';

const SOURCE = 'claude-ai';
const OUTPUT_MAX = 20000;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) continue;
    const type = str(item['type']);
    if (type === 'text') parts.push(str(item['text']) ?? '');
    else if (type === 'knowledge') {
      const head = [str(item['title']), str(item['url'])].filter(Boolean).join(' ');
      parts.push([head, str(item['text'])].filter(Boolean).join('\n'));
    } else if (type === 'local_resource') parts.push(`[file] ${str(item['name']) ?? str(item['file_path']) ?? ''}`.trim());
    else if (type === 'image') parts.push('[image]');
    else if (type === 'image_gallery') parts.push('[image gallery]');
  }
  return parts.filter((p) => p.length > 0).join('\n');
}

// Attachment metadata only. extracted_content (full file text) is deliberately dropped.
function messageAttachments(message: Json): unknown[] {
  const out: unknown[] = [];
  if (Array.isArray(message['attachments'])) {
    for (const a of message['attachments']) {
      if (!isObject(a)) continue;
      out.push({
        type: 'attachment',
        file_name: str(a['file_name']),
        file_size: typeof a['file_size'] === 'number' ? a['file_size'] : null,
        file_type: str(a['file_type']),
      });
    }
  }
  if (Array.isArray(message['files'])) {
    for (const f of message['files']) {
      if (isObject(f)) out.push({ type: 'file', file_uuid: str(f['file_uuid']), file_name: str(f['file_name']) });
    }
  }
  return out;
}

interface ToolUse {
  index: number;
  id: string | null;
  name: string | null;
  event: EventOut;
  paired: boolean;
}

// Pairs by id when both sides have one, otherwise with the nearest preceding unpaired use of the same name.
function pairUse(uses: ToolUse[], resultId: string | null, name: string | null, index: number): ToolUse | null {
  if (resultId !== null) {
    const byId = uses.find((u) => u.id === resultId && !u.paired);
    if (byId) return byId;
  }
  for (let i = uses.length - 1; i >= 0; i -= 1) {
    const use = uses[i] as ToolUse;
    if (use.index < index && !use.paired && use.name === name) return use;
  }
  return null;
}

export function parseConversation(conversation: Json, position: number): ParseResult {
  const result: ParseResult = { records: [], events: [], patches: [], sessions: [], warnings: [] };
  const conversationId = str(conversation['uuid']);
  if (!conversationId) {
    result.warnings.push(`conversation ${position} has no uuid, skipped`);
    return result;
  }
  result.records.push({
    byteOffset: position,
    raw: JSON.stringify(conversation),
    unparsed: false,
    sessionId: conversationId,
  });
  const messages = (Array.isArray(conversation['chat_messages']) ? conversation['chat_messages'] : [])
    .filter(isObject)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (str(a.m['created_at']) ?? '').localeCompare(str(b.m['created_at']) ?? '') || a.i - b.i)
    .map((x) => x.m);

  const name = (str(conversation['name']) ?? '').trim();
  const updatedAt = str(conversation['updated_at']) ?? str(conversation['created_at']) ?? '';
  let firstHumanText: string | null = null;

  for (const message of messages) {
    const messageId = str(message['uuid']);
    if (!messageId) continue;
    const created = str(message['created_at']);
    const sourceUpdatedAt = str(message['updated_at']) ?? created ?? '';
    const role = str(message['sender']) === 'human' ? 'user' : 'assistant';
    const content = Array.isArray(message['content']) ? message['content'].filter(isObject) : [];
    const events: EventOut[] = [];
    const uses: ToolUse[] = [];
    const attachments = messageAttachments(message);
    let firstImageIndex: number | null = null;

    const base = (index: number, block: Json | null) => ({
      id: stableId(SOURCE, conversationId, messageId, String(index)),
      recordIndex: 0,
      sessionId: conversationId,
      projectDir: null,
      timestamp: (block ? str(block['start_timestamp']) : null) ?? created,
      sourceUpdatedAt,
    });

    content.forEach((block, index) => {
      const type = str(block['type']);
      if (type === 'text') {
        const text = str(block['text']) ?? '';
        if (text.length > 0) events.push({ ...base(index, block), role, kind: 'text', content: text });
      } else if (type === 'thinking') {
        const text = str(block['thinking']) ?? '';
        if (text.length > 0) events.push({ ...base(index, block), role: 'assistant', kind: 'thinking', content: text });
      } else if (type === 'tool_use') {
        const input = block['input'];
        const event: EventOut = {
          ...base(index, block),
          role: 'tool',
          kind: 'tool',
          content: summariseToolInput(input),
          toolInput: JSON.stringify(input ?? {}),
          filesTouched: pathsFrom(input),
        };
        const toolName = str(block['name']);
        if (toolName) event.toolName = toolName;
        events.push(event);
        uses.push({ index, id: str(block['id']), name: toolName, event, paired: false });
      } else if (type === 'tool_result') {
        const output = JSON.stringify({
          is_error: block['is_error'] === true,
          content: block['content'] ?? null,
          ...(block['structured_content'] ? { structured_content: block['structured_content'] } : {}),
        });
        const text = resultText(block['content']).slice(0, OUTPUT_MAX);
        const use = pairUse(uses, str(block['tool_use_id']), str(block['name']), index);
        if (use) {
          use.paired = true;
          use.event.toolOutput = output;
          use.event.content = `${use.event.content}${TOOL_OUTPUT_SEPARATOR}${text}`;
        } else {
          const event: EventOut = {
            ...base(index, block),
            role: 'tool',
            kind: 'tool',
            content: `${TOOL_OUTPUT_SEPARATOR}${text}`,
            toolOutput: output,
          };
          const toolName = str(block['name']);
          if (toolName) event.toolName = toolName;
          events.push(event);
        }
      } else if (type === 'image') {
        attachments.push({ type: 'image', file_uuid: str(block['file_uuid']) });
        firstImageIndex ??= index;
      } else if (type === 'document') {
        attachments.push({ type: 'document', file_uuid: str(block['file_uuid']), title: str(block['title']) });
        firstImageIndex ??= index;
      }
      // injected_prompt_block, token_budget and unknown types produce no event
    });

    const hasUseful = events.length > 0;
    const fallback = str(message['text']) ?? '';
    if (!hasUseful && fallback.length > 0) {
      events.push({ ...base(0, null), role, kind: 'text', content: fallback });
    }
    if (attachments.length > 0) {
      if (events.length === 0) {
        events.push({ ...base(firstImageIndex ?? 0, null), role, kind: 'text', content: '' });
      }
      (events[0] as EventOut).attachments = attachments;
    }
    if (role === 'user' && firstHumanText === null) {
      const first = events.find((e) => e.kind === 'text' && e.content.length > 0);
      if (first) firstHumanText = first.content;
    }
    result.events.push(...events);
  }

  const session: ParseResult['sessions'][number] = { sessionId: conversationId };
  const title = name.length > 0 ? name : firstHumanText !== null ? titleFromText(firstHumanText) : '';
  if (title.length > 0) session.title = { value: title, updatedAt };
  result.sessions.push(session);
  return result;
}
