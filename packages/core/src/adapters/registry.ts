import { claudeAiAdapter } from './claude-ai/index.js';
import { claudeCodeAdapter } from './claude-code/index.js';
import type { SourceAdapter } from './types.js';

// The single list of registered adapters. Add new ones here.
export const adapters: SourceAdapter[] = [claudeCodeAdapter, claudeAiAdapter];

export function getAdapter(id: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
