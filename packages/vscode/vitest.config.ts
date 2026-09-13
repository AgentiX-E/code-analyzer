import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const packagesDir = resolve(__dirname, '..');

// Plugin to rewrite .js imports to .ts for vitest/esbuild compatibility
function resolveJsToTs() {
  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.js') || source.includes('node_modules')) {
        return undefined;
      }
      if (!importer) return undefined;

      const importerDir = dirname(importer);
      const resolved = resolve(importerDir, source);
      const tsPath = resolved.replace(/\.js$/, '.ts');

      if (existsSync(tsPath)) {
        return tsPath;
      }

      return undefined;
    },
  };
}

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
  plugins: [resolveJsToTs()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/index.ts',
        'src/extension/extension.ts',
        'src/extension/commands.ts',
      ],
      // The same floor as the rest of the repository: 95 on every dimension. These
      // used to read 82/80/95/82, below what the package already achieved (measured
      // 99.92 statements / 100 branches / 99.52 functions / 100 lines over 16 files) —
      // a floor nobody enforced, in a workflow that never ran `--coverage` at all.
      // `test:coverage` now runs in `vscode-ci.yml`, so the number gates.
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
    testTimeout: 10000,
  },
});
