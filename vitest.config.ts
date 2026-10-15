import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against source so they do not need a prior build.
    alias: {
      '@hansard/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@hansard/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
