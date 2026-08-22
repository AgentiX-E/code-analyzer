// Honest coverage config — only excludes genuinely non-functional files.
// Used to establish a truthful baseline without gaming via broad exclusions.
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
    ],
    exclude: ['packages/web/**', 'packages/vscode/**', '**/node_modules/**', '**/dist/**'],
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
      // Only genuinely non-functional files are excluded.
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/fixtures/**',
        '**/dist/**',
        '**/node_modules/**',
        // Benchmark data files (pure static data, no executable logic)
        'packages/intelligence/src/benchmark/benchmark-data.ts',
        'packages/analyzer/src/__tests__/benchmark-data.ts',
      ],
      thresholds: {
        lines: 95,
        branches: 89,
        functions: 95,
        statements: 95,
      },
    },
  },
});
