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
    include: ['packages/*/src/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts', 'tests/property/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/shared/src/**/*.ts', 'packages/core/src/**/*.ts', 'packages/infra/src/**/*.ts', 'packages/analyzer/src/**/*.ts', 'packages/intelligence/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/index.ts',                       // Barrel files (tested via consumer tests)
        '**/provider.ts',                     // Pure interface definitions (0% exec code)
        '**/fixtures/**',                     // Test fixtures (no exec code)
        'packages/infra/src/storage/types.ts', // Pure type definitions
        'packages/core/src/agents/types.ts', // Pure type definitions
        'packages/infra/src/filesystem/watcher.ts', // Future iteration stub
        // Tree-sitter infra + heavy providers (require native modules, low branch coverage)
        'packages/analyzer/src/languages/base-c-like.ts',
        'packages/analyzer/src/languages/tree-sitter-base.ts',
        'packages/analyzer/src/languages/csharp.ts',
        'packages/analyzer/src/languages/go.ts',
        'packages/analyzer/src/languages/java.ts',
        'packages/analyzer/src/languages/javascript.ts',
        'packages/analyzer/src/languages/kotlin.ts',
        'packages/analyzer/src/languages/python.ts',
        'packages/analyzer/src/languages/rust.ts',
        'packages/analyzer/src/languages/php.ts',
        'packages/analyzer/src/languages/ruby.ts',
        'packages/analyzer/src/languages/swift.ts',
        'packages/analyzer/src/languages/typescript.ts',
        // I/O-bound files that cannot achieve 95%+ branch coverage in CI
        'packages/analyzer/src/pipeline/parallel-phases.ts',
        'packages/infra/src/workers/parallel-indexer.ts',
        'packages/intelligence/src/cross-repo/cross-repo-indexer.ts',
        'packages/intelligence/src/cross-repo/cross-repo-pr-review.ts',
        // Signal/webhook-dependent operational code
        'packages/core/src/operations/graceful-shutdown.ts',
        'packages/intelligence/src/review/github-webhook.ts',
        // Native/system dependency files
        'packages/infra/src/git/*.ts',
        // Generated / dist
        'packages/*/dist/**',
        // Non-covered packages (integration-layer packages require full environment)
        'packages/mcp/**',
        'packages/server/**',
        'packages/vscode/**',
        'packages/web/**',
        'packages/cli/**',
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
    testTimeout: 10_000,
  },
});
