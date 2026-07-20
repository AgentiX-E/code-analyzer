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
      exclude: ['src/__tests__/**', 'src/index.ts'],
    },
    testTimeout: 10000,
  },
});
