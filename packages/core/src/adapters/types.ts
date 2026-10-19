import type { HansardContext } from '../config.js';

export interface ArchiveFile {
  machineId: string;
  // Relative to archiveRoot, forward slashes. Doubles as the ingest_state key.
  relPath: string;
  absPath: string;
}

export interface MirrorReport {
  filesScanned: number;
  filesMirrored: number;
  bytesAppended: number;
  skipped: { relPath: string; reason: string }[];
}

export interface RawRecordOut {
  byteOffset: number;
  raw: string;
  unparsed: boolean;
  sessionId: string | null;
}

export interface EventOut {
  id: string;
  // Index into ParseResult.records, linked to raw_records.id on write.
  recordIndex: number;
  sessionId: string;
  projectDir: string | null;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'tool' | 'system';
  kind: 'text' | 'thinking' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  // Set by adapters whose source can re-export edited data: the newest edit wins on conflict.
  sourceUpdatedAt?: string;
  filesTouched?: string[];
  attachments?: unknown[];
}

// A tool result arrives as its own line and is merged into the tool event it answers.
export interface ToolResultPatch {
  eventId: string;
  recordIndex: number;
  sessionId: string;
  projectDir: string | null;
  timestamp: string | null;
  toolOutput: string;
  outputText: string;
  filesTouched?: string[];
}

export interface SessionUpdate {
  sessionId: string;
  cwd?: string;
  aiTitle?: string;
  // Authoritative title with the source's own edit time, newest wins.
  title?: { value: string; updatedAt: string; fallback?: boolean };
}

export interface ParseResult {
  records: RawRecordOut[];
  events: EventOut[];
  patches: ToolResultPatch[];
  sessions: SessionUpdate[];
  warnings: string[];
}

export interface FixtureGenerator {
  // Writes synthetic local source data under root. Never reads real data.
  generate(opts: { root: string; sessions?: number }): { sessionIds: string[] };
  // Writes a small, fixed demo data set (every case the parser handles, plus a fake secret that redaction
  // must remove) in the shape this source would have on disk. `secret` is supplied by the caller so no
  // credential-shaped text lives in the repo. Returns the files written, relative to root.
  sample(opts: { root: string; secret: string }): { files: string[] };
}

export interface SourceAdapter {
  id: string;
  displayName: string;
  kind: 'live' | 'import';
  describe(): { reads: string; localLocation: string; archiveLayout: string };
  discover(ctx: HansardContext): { location: string; found: boolean; detail?: string }[];
  mirror?(ctx: HansardContext, opts?: { file?: string }): MirrorReport;
  // Archive file that a local source file mirrors to, or null when the adapter does not own that path.
  archiveFileFor?(ctx: HansardContext, localPath: string): ArchiveFile | null;
  archiveFiles(ctx: HansardContext, onWarning?: (message: string) => void): ArchiveFile[];
  // Reason to skip an archive file (for example a sync-conflict copy), or null to ingest it.
  skipReason?(file: ArchiveFile): string | null;
  // Import adapters read an immutable archive file (for example a zip) instead of line chunks.
  parseArchive?(file: ArchiveFile, ctx: HansardContext): AsyncIterable<ParseResult>;
  parse(file: ArchiveFile, chunk: { text: string; startOffset: number }, ctx: HansardContext): ParseResult;
  fixtures: FixtureGenerator;
}
