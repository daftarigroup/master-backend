import { defineConfig } from 'vitest/config';

// Tests live in /tests (outside tsconfig's "src" include) so they never ship in dist/.
// Database tests need TEST_DATABASE_URL (local, name containing "test"); without it they are skipped.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/setup/globalSetup.ts'],
    setupFiles: ['tests/setup/env.ts'],
    // DB tests share one database, so run test files one at a time.
    fileParallelism: false,
  },
});
