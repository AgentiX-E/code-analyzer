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
    // Multi-process fork pool. Each test file runs in its own worker, so
    // memory is released between files. A single shared worker (singleFork)
    // was tried to dodge a vitest 3-era native-addon fork-safety crash, but
    // it OOMs at ~6GB once the 12k-test suite + tree-sitter/better-sqlite3
    // addons accumulate in one process. tree-sitter's C bindings are
    // fork-safe on vitest 4 + Node 22, so the default pool is correct.
    pool: 'forks',
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
      'tests/benchmarks/performance/*.test.ts',
    ],
    exclude: [
      'packages/web/**',
      'packages/vscode/**',
      '**/benchmarks/ca-bench/suites/**',
      '**/benchmarks/ca-bench/fixtures/**',
      '**/benchmarks/search-benchmark.test.ts',
      'packages/intelligence/src/__tests__/cross-service-linking.test.ts',
      // Scale stress generates and parses ~9.3K synthetic files across four
      // tiers to probe O(n²) cliffs and superlinear memory growth. It is a
      // dedicated stress benchmark (run standalone via its file path), not a
      // unit test — under the default unit-test pool it OOMs a single worker
      // and its heap-delta assertions are GC-timing sensitive.
      'tests/benchmarks/real-world/__tests__/scale-stress.test.ts',
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
      //
      // There is deliberately NO `**/types.ts` entry. That pattern is a claim
      // about a file's contents rather than a licence to skip a filename, and
      // nothing enforces it: it was matching
      // `intelligence/src/cross-service/types.ts`, which carries `ServiceEdgeType`
      // and ~400 lines of library-detection tables reached by five production
      // modules. Coverage had been silently ignoring that file.
      //
      // The three remaining pure-type `types.ts` files are simply counted. A file
      // with no executable statements reports 0/0, which the summary renders as
      // 100%, so counting one costs nothing and cannot hide anything — whereas a
      // pattern that matches by name can, and did. Adding a per-file exclusion
      // here would reintroduce exactly the review problem: a reviewer cannot tell
      // from a path whether the file still holds only declarations.
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts', // Barrel files — re-export only, exercised via consumer tests
        '**/provider.ts', // Pure interface definitions (no executable code)
        '**/fixtures/**', // Test fixtures (no executable code)
        '**/start.ts', // Process entry points — exercised via integration/e2e
        '**/benchmark-data.ts', // Static benchmark datasets (no executable code)
        '**/benchmarks/**', // Benchmark harnesses, not production logic
        'packages/*/dist/**', // Built output
      ],
      thresholds: {
        // These mirror what CI actually enforces. `coverage.yml` runs
        // `coverage-report.js --threshold 95` on all four dimensions, so for a
        // long time this block disagreed with the gate that decides the build:
        // it sat at 75/65/75/75, and a run could therefore be green locally
        // while CI failed at 95. The measured values are 99.53 / 98.50 / 99.61 /
        // 99.63 (statements / branches / functions / lines), so 95 across the
        // board is the honest floor and the two gates now agree.
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
