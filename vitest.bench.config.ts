// @code-analyzer — Vitest config for benchmark tests
// Separate from main test config because benchmarks:
// 1. Are long-running (high timeouts)
// 2. Excluded from normal test runs
// 3. Should not affect coverage thresholds

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const packagesDir = resolve(__dirname, 'packages');

export default defineConfig({
  resolve: {
    alias: {
      '@code-analyzer/shared': resolve(packagesDir, 'shared/src'),
      '@code-analyzer/core': resolve(packagesDir, 'core/src'),
      '@code-analyzer/infra': resolve(packagesDir, 'infra/src'),
      '@code-analyzer/analyzer': resolve(packagesDir, 'analyzer/src'),
      '@code-analyzer/intelligence': resolve(packagesDir, 'intelligence/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.bench.ts'],
    exclude: ['packages/web/**', 'packages/vscode/**'],
    testTimeout: 300_000, // 5 minutes for large benchmark suites
    hookTimeout: 60_000,
    coverage: {
      enabled: false, // Benchmarks don't count toward coverage
    },
    // Expose garbage collection for cleaner measurements
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--expose-gc'],
      },
    },
    reporters: ['verbose'],
  },
});
