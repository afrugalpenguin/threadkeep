import { stableId } from '../../ids.js';
import type { ArchiveFile, EventOut, ParseResult, ToolResultPatch } from '../types.js';

const SOURCE = 'claude-code';
const SUMMARY_MAX = 2000;
const OUTPUT_MAX = 20000;
const SUMMARY_KEYS = ['command', 'file_path', 'path', 'notebook_path', 'pattern', 'url', 'query', 'description'];

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function summariseToolInput(input: unknown): string {
  if (isObject(input)) {
    for (const key of SUMMARY_KEYS) {
      const value = input[key];
      if (typeof value === 'string' && value.length > 0) return value.slice(0, SUMMARY_MAX);
    }
  }
  return (JSON.stringify(input ?? {}) ?? '').slice(0, SUMMARY_MAX);
}

export function pathsFrom(value: unknown): string[] {
  if (!isObject(value)) return [];
  return ['file_path', 'path', 'notebook_path', 'filePath']
    .map((key) => str(value[key]))
    .filter((v): v is string => v !== null && v.length > 0);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (isObject(item) && item['type'] === 'text' ? (str(item['text']) ?? '') : ''))
    .filter((t) => t.length > 0)
    .join('\n');
}

// Claude Code writes many `type: user` lines the human never typed. Text that starts (after leading
// whitespace) with one of these markers is system generated:
//   <local-command-stdout>, <local-command-stderr>, <local-command-caveat>  output of local slash commands
//   <task-notification>                                                     background task reports
//   [Request interrupted by user  (also "... for tool use]")                 interruption markers
// Lines flagged isMeta (skill bodies, caveats) or isCompactSummary are handled by the caller.
// `<command-name>` records are NOT listed: the human typed those slash commands.
const SYSTEM_TEXT = /^\s*(?:<local-command-(?:stdout|stderr|caveat)>|<task-notification>|\[Request interrupted by user)/;
export function isSystemGeneratedUserText(text: string): boolean {
  return SYSTEM_TEXT.test(text);
}

export function parseClaudeCode(file: ArchiveFile, chunk: { text: string; startOffset: number }): ParseResult {
  const result: ParseResult = { records: [], events: [], patches: [], sessions: [], warnings: [] };
  const defaultSession = (file.relPath.split('/').pop() ?? '').replace(/\.jsonl$/i, '');
  let offset = chunk.startOffset;

  for (const rawLine of chunk.text.split('\n')) {
    const lineOffset = offset;
    offset += Buffer.byteLength(rawLine, 'utf8') + 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      obj = undefined;
    }
    if (!isObject(obj)) {
      result.records.push({ byteOffset: lineOffset, raw: line, unparsed: true, sessionId: null });
      result.warnings.push(`unparseable line at offset ${lineOffset} in ${file.relPath}`);
      continue;
    }

    const sessionId = str(obj['sessionId']) ?? defaultSession;
    const recordIndex = result.records.length;
    result.records.push({ byteOffset: lineOffset, raw: line, unparsed: false, sessionId });

    const type = str(obj['type']);
    if (type === 'ai-title') {
      const title = str(obj['aiTitle']);
      if (title) result.sessions.push({ sessionId, aiTitle: title });
      continue;
    }
    if (type !== 'user' && type !== 'assistant') continue;

    const cwd = str(obj['cwd']);
    if (cwd) result.sessions.push({ sessionId, cwd });
    const message = isObject(obj['message']) ? obj['message'] : {};
    const uuid = str(obj['uuid']) ?? `o${lineOffset}`;
    const timestamp = str(obj['timestamp']);
    const common = { recordIndex, sessionId, projectDir: cwd, timestamp };
    const first = result.events.length;
    const attachments: unknown[] = [];
    let imageIndex: number | null = null;
    const flagged = obj['isMeta'] === true || obj['isCompactSummary'] === true;
    const textEvent = (role: 'user' | 'assistant', index: number, text: string): EventOut => ({
      ...common,
      id: stableId(SOURCE, sessionId, uuid, String(index)),
      role: role === 'user' && (flagged || isSystemGeneratedUserText(text)) ? 'system' : role,
      kind: 'text',
      content: text,
    });

    const role = type === 'user' ? 'user' : 'assistant';
    const content = message['content'];
    if (typeof content === 'string') {
      if (content.length > 0) result.events.push(textEvent(role, 0, content));
    } else if (Array.isArray(content)) {
      content.forEach((block, index) => {
        if (!isObject(block)) return;
        const blockType = str(block['type']);
        if (blockType === 'text') {
          const text = str(block['text']) ?? '';
          if (text.length > 0) result.events.push(textEvent(role, index, text));
        } else if (blockType === 'thinking') {
          const text = str(block['thinking']) ?? '';
          if (text.length > 0) {
            result.events.push({
              ...common,
              id: stableId(SOURCE, sessionId, uuid, String(index)),
              role: 'assistant',
              kind: 'thinking',
              content: text,
            });
          }
        } else if (blockType === 'tool_use') {
          const toolUseId = str(block['id']);
          if (!toolUseId) return;
          const input = block['input'];
          const event: EventOut = {
            ...common,
            id: stableId(SOURCE, sessionId, 'tool', toolUseId),
            role: 'tool',
            kind: 'tool',
            content: summariseToolInput(input),
            toolInput: JSON.stringify(input ?? {}),
            filesTouched: pathsFrom(input),
          };
          const name = str(block['name']);
          if (name) event.toolName = name;
          result.events.push(event);
        } else if (blockType === 'tool_result') {
          const toolUseId = str(block['tool_use_id']);
          if (!toolUseId) return;
          const toolUseResult = obj['toolUseResult'];
          const output: Json = { is_error: block['is_error'] === true, content: block['content'] ?? null };
          if (toolUseResult !== undefined) output['toolUseResult'] = toolUseResult;
          const patch: ToolResultPatch = {
            ...common,
            eventId: stableId(SOURCE, sessionId, 'tool', toolUseId),
            toolOutput: JSON.stringify(output),
            outputText: resultText(block['content']).slice(0, OUTPUT_MAX),
            filesTouched: pathsFrom(toolUseResult),
          };
          result.patches.push(patch);
        } else if (blockType === 'image') {
          const source = block['source'];
          const mediaType = isObject(source) ? str(source['media_type']) : null;
          attachments.push({ type: 'image', media_type: mediaType });
          imageIndex ??= index;
        }
      });
    }

    if (attachments.length > 0) {
      if (result.events.length === first) {
        result.events.push(textEvent('user', imageIndex ?? 0, ''));
      }
      (result.events[first] as EventOut).attachments = attachments;
    }
  }
  return result;
}
