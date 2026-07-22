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
    include: ['packages/*/src/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/performance/**/*.bench.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/shared/src/**/*.ts', 'packages/core/src/**/*.ts', 'packages/infra/src/**/*.ts', 'packages/analyzer/src/**/*.ts', 'packages/intelligence/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/index.ts',                       // Barrel files (tested via consumer tests)
        '**/provider.ts',                     // Pure interface definitions (0% exec code)
        'packages/infra/src/storage/types.ts', // Pure type definitions
        'packages/infra/src/filesystem/watcher.ts', // Future iteration stub
        'packages/intelligence/src/embeddings/embedder.ts', // Requires native @agentix-e/embed-code-ts
        'packages/*/dist/**',
        'packages/mcp/**',
        'packages/server/**',
        'packages/vscode/**',
        'packages/web/**',
        'packages/cli/**',
      ],
      thresholds: {
        lines: 95,
        branches: 94,
        functions: 95,
        statements: 95,
      },
    },
    testTimeout: 10_000,
  },
});
