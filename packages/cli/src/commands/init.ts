#!/usr/bin/env node
// @code-analyzer/cli — Initialize project configuration
// Creates .code-analyzer/ directory with default standards.json and config

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { DEFAULT_STANDARDS } from '@code-analyzer/intelligence';

import type { ProjectStandard, StandardRule } from '@code-analyzer/shared';

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

/**
 * The standards file `init` writes, **in the format the standards engine reads**.
 *
 * This used to be a flat `{ name, rules: [{ id, category, severity, description, enabled }] }`, which no engine could
 * consume: `StandardsEngine.checkRule` dispatches on `rule.checkType`, and a rule without one is a rule that matches
 * nothing. A project initialised that way, and then reviewed with `--standards .code-analyzer/standards.json`, got a
 * clean report over a rule set that was never applied — the most expensive kind of wrong answer, because it looks
 * like a pass.
 *
 * The rules are the ones this product already ships as its defaults, so `init` and `standards check` agree about what
 * "the default standard" means instead of each keeping a list.
 */
export function projectStandard(): ProjectStandard {
  const rules = new Map<string, StandardRule>();
  for (const standard of DEFAULT_STANDARDS) {
    // Later definitions win, matching `StandardsEngine.composeStandards`: one rule id, one behaviour, everywhere.
    for (const rule of standard.rules) rules.set(rule.id, rule);
  }
  return {
    id: 'project-standards',
    name: 'Project Standards',
    version: '1.0.0',
    category: 'custom',
    description: 'The rule set this project reviews against, seeded from the standards Code Analyzer ships.',
    rules: [...rules.values()],
    examples: [],
  };
}

const DEFAULT_CONFIG = {
  version: '0.1.0',
  index: {
    mode: 'full',
    maxFileSize: 10485760,
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/*.min.*'],
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
    writeFileSync(standardsPath, JSON.stringify(projectStandard(), null, 2) + '\n');
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
      // `filesCreated` only ever holds 'standards.json', 'config.json' and
      // '.gitignore (updated)', none of which equals '.gitignore', so the
      // containment check that used to guard this push was always true.
      filesCreated.push('.gitignore (updated)');
    }
  } catch {
    // .gitignore write failed — non-critical
  }

  const allCreated = filesCreated.length;

  return {
    success: true,
    configDir,
    filesCreated,
    filesExisting,
    message:
      allCreated > 0
        ? `Initialized Code Analyzer in ${configDir}. Created: ${filesCreated.join(', ')}.`
        : `Code Analyzer already initialized in ${configDir}. Use --force to overwrite.`,
  };
}
