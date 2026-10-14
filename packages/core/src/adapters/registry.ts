import { claudeCodeAdapter } from './claude-code/index.js';
import type { SourceAdapter } from './types.js';

// The single list of adapters. Nothing else in core names a specific tool.
export const adapters: SourceAdapter[] = [claudeCodeAdapter];

export function getAdapter(id: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
