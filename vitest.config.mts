import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests import the shared package from source, so they never need it built first.
export default defineConfig({
  resolve: {
    alias: {
      '@office/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // some tests run the whole simulation for a day; on a busy machine (tests run in parallel) 5 seconds is not enough
    testTimeout: 30000,
  },
});
