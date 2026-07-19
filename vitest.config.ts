import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
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
        branches: 90,
        functions: 95,
        statements: 95,
      },
    },
    testTimeout: 10_000,
  },
});
