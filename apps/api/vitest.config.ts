import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test' },
  },
});
