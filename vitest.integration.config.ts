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
    include: ['tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/index.ts',
        'packages/*/src/**/*.bench.ts',
      ],
    },
    testTimeout: 30_000,
  },
});
