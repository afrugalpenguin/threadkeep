import { initial } from './001-initial.js';
import { sourceUpdatedAt } from './002-source-updated-at.js';

// Numbered and append-only: never edit a released migration, add the next number.
export const migrations: { version: number; name: string; sql: string }[] = [
  { version: 1, name: 'initial', sql: initial },
  { version: 2, name: 'source-updated-at', sql: sourceUpdatedAt },
];
