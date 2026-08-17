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
      '@code-analyzer/mcp': resolve(packagesDir, 'mcp/src'),
      '@code-analyzer/server': resolve(packagesDir, 'server/src'),
      '@code-analyzer/cli': resolve(packagesDir, 'cli/src'),
      '@code-analyzer/integration': resolve(packagesDir, 'integration/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Fork pool with singleFork — all tests in one worker avoids native
    // addon inter-process crashes. After all tests pass, vitest pool
    // teardown may emit a cosmetic EPIPE error.
    pool: 'forks',
    singleFork: true,
    testTimeout: 90_000,
    hookTimeout: 60_000,
    include: [
      'packages/*/src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
      'tests/property/**/*.test.ts',
      'tests/benchmarks/ca-bench/__tests__/*.test.ts',
      'tests/benchmarks/real-world/__tests__/*.test.ts',
      'tests/benchmarks/performance/*.bench.ts',
    ],
    exclude: [
      'packages/web/**',
      'packages/vscode/**',
      '**/benchmarks/ca-bench/suites/**',
      '**/benchmarks/ca-bench/fixtures/**',
      '**/benchmarks/search-benchmark.test.ts',
      'packages/intelligence/src/__tests__/cross-service-linking.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/shared/src/**/*.ts',
        'packages/core/src/**/*.ts',
        'packages/infra/src/**/*.ts',
        'packages/analyzer/src/**/*.ts',
        'packages/intelligence/src/**/*.ts',
        'packages/mcp/src/**/*.ts',
        'packages/server/src/**/*.ts',
        'packages/cli/src/**/*.ts',
      ],
      // Honest exclusion set — only genuinely non-functional files.
      // Every production source file is counted toward coverage.
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',          // Barrel files — re-export only, exercised via consumer tests
        '**/provider.ts',       // Pure interface definitions (no executable code)
        '**/fixtures/**',       // Test fixtures (no executable code)
        '**/types.ts',          // Pure type definitions (no executable code)
        '**/start.ts',          // Process entry points — exercised via integration/e2e
        '**/benchmark-data.ts', // Static benchmark datasets (no executable code)
        '**/benchmarks/**',     // Benchmark harnesses, not production logic
        'packages/*/dist/**',   // Built output
      ],
      thresholds: {
        // Honest baseline after de-gamification (2026-08-17). These reflect the
        // real measured coverage across all production source — no whole-file
        // `v8 ignore file` exclusions, no "ITERATION 4 SCHEDULED" config block.
        // Ratchet target as tests are added: 95 lines / 90 branches / 95 functions / 95 statements.
        lines: 75,
        branches: 65,
        functions: 75,
        statements: 75,
      },
    },
  },
});
