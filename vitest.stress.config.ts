// @code-analyzer — Vitest config for the scale stress benchmark
//
// **Why this file exists.** The stress test writes and parses ~9.3K synthetic files across four tiers, so it is excluded
// from the unit run (it OOMs a single worker under the default pool, and its heap-delta assertions are timing sensitive).
// It was documented as "run standalone by passing its file path", and that instruction did not work: `vitest run <path>`
// still applies the `exclude` list from `vitest.config.ts`, so the command exited with "No test files found" and the
// test was reachable only by editing the config. An exclusion that cannot be lifted is a test nobody runs. This config
// lifts it, gives the run the heap it needs, and is what `pnpm test:stress` calls.

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
    include: ['tests/benchmarks/real-world/__tests__/scale-stress.test.ts'],
    // One fork, with the heap the corpus needs: a single worker owns the whole run.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ['--expose-gc', '--max-old-space-size=6144'],
      },
    },
    testTimeout: 900_000,
    hookTimeout: 300_000,
    coverage: { enabled: false },
    reporters: ['verbose'],
  },
});
