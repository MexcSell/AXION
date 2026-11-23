import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
    // c93 (H14b): every test pool is small (the axion role's 45 connections are shared by every lane); a test that really needs more passes its own max
    env: { AXION_TEST_POOL_MAX: '3' },
  },
});
