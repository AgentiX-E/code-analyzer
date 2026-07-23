#!/usr/bin/env node
// @code-analyzer/cli — Initialize project configuration
// Creates .code-analyzer/ directory with default standards.json and config

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitOptions {
  /** Target directory (defaults to cwd) */
  directory?: string;
  /** Force overwrite existing config */
  force?: boolean;
}

export interface InitResult {
  success: boolean;
  configDir: string;
  filesCreated: string[];
  filesExisting: string[];
  message: string;
}

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

const DEFAULT_STANDARDS = {
  name: 'Project Standards',
  description: 'Custom code review standards for this project',
  version: '1.0.0',
  rules: [
    {
      id: 'no-console-log',
      category: 'quality',
      severity: 'warning',
      description: 'Avoid console.log in production code',
      enabled: true,
    },
    {
      id: 'no-debugger',
      category: 'quality',
      severity: 'error',
      description: 'Remove debugger statements',
      enabled: true,
    },
  ],
};

const DEFAULT_CONFIG = {
  version: '0.1.0',
  index: {
    mode: 'full',
    maxFileSize: 10485760,
    excludePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/*.min.*',
    ],
    languages: 'auto',
  },
  review: {
    severity: 'warning',
    failOn: 'error',
    maxFiles: 100,
  },
  search: {
    maxResults: 50,
    includeImports: true,
  },
};

const GITIGNORE_ENTRY = '\n# Code Analyzer\n.code-analyzer/data/\n';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Initialize Code Analyzer configuration in a project directory.
 *
 * Creates `.code-analyzer/` with:
 *   - `standards.json`  — project-specific review standards
 *   - `config.json`     — analyzer configuration
 *   - `data/`           — data directory for the knowledge graph DB
 *
 * Also appends `.code-analyzer/data/` to `.gitignore`.
 */
export function initProject(options: InitOptions = {}): InitResult {
  const targetDir = resolve(options.directory ?? process.cwd());
  const configDir = join(targetDir, '.code-analyzer');
  const filesCreated: string[] = [];
  const filesExisting: string[] = [];
  const force = options.force ?? false;

  // Create config directory
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Create data directory
  const dataDir = join(configDir, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // standards.json
  const standardsPath = join(configDir, 'standards.json');
  if (!existsSync(standardsPath) || force) {
    writeFileSync(standardsPath, JSON.stringify(DEFAULT_STANDARDS, null, 2) + '\n');
    filesCreated.push('standards.json');
  } else {
    filesExisting.push('standards.json');
  }

  // config.json
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath) || force) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    filesCreated.push('config.json');
  } else {
    filesExisting.push('config.json');
  }

  // Append to .gitignore
  const gitignorePath = join(targetDir, '.gitignore');
  try {
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    if (!existing.includes('.code-analyzer/data/')) {
      writeFileSync(gitignorePath, (existing.trimEnd() + GITIGNORE_ENTRY).trimEnd() + '\n');
      if (!filesCreated.includes('.gitignore')) {
        filesCreated.push('.gitignore (updated)');
      }
    }
  } catch {
    // .gitignore write failed — non-critical
  }

  const allCreated = filesCreated.length;
  const allExisting = filesExisting.length;

  return {
    success: true,
    configDir,
    filesCreated,
    filesExisting,
    message: allCreated > 0
      ? `Initialized Code Analyzer in ${configDir}. Created: ${filesCreated.join(', ')}.`
      : `Code Analyzer already initialized in ${configDir}. Use --force to overwrite.`,
  };
}
