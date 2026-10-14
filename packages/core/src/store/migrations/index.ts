import { initial } from './001-initial.js';

// Numbered and append-only: never edit a released migration, add the next number.
export const migrations: { version: number; name: string; sql: string }[] = [
  { version: 1, name: 'initial', sql: initial },
];
