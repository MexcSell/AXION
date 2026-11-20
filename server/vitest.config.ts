import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
