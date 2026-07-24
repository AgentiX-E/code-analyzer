// @code-analyzer — Benchmark Configuration
// Vitest bench config for performance regression detection.
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
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/performance/**/*.bench.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    benchmark: {
      outputFile: './bench-results.json',
      include: ['tests/performance/**/*.bench.ts'],
    },
  },
});
