import os from 'node:os';

import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

/** Default maximum number of files to process per project. */
const DEFAULT_MAX_FILES = 50000;

/**
 * Returns the default configuration for Code Analyzer.
 * These defaults apply before user-level, project-level, or environment overrides.
 */
export function getDefaultConfig(): CodeAnalyzerConfig {
  return {
    projectId: '',
    rootPath: process.cwd(),
    excludePatterns: [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '.next/**',
      '.nuxt/**',
      '__pycache__/**',
      '*.pyc',
      'target/**',
      '.gradle/**',
    ],
    includePatterns: [],
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    maxFiles: DEFAULT_MAX_FILES,
    parseWorkers: Math.max(1, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2)),
    cacheDir: '.code-analyzer',
    ignorePaths: [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '.nuxt',
      '__pycache__',
      'target',
      '.gradle',
    ],
  };
}
