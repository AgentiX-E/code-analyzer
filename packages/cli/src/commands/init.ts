#!/usr/bin/env node
// @code-analyzer/cli — Initialize project configuration
// Creates .code-analyzer/ directory with default standards.json and config

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';

import { getDefaultConfig } from '@code-analyzer/core';
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
    description:
      'The rule set this project reviews against, seeded from the standards Code Analyzer ships.',
    rules: [...rules.values()],
    examples: [],
  };
}

/**
 * The configuration `init` writes.
 *
 * **The shape here is the shape the loader reads, and that is the whole point of this function.** It used to write a
 * different document — `{ version, index: { mode, maxFileSize, languages }, review: { severity, failOn, maxFiles },
 * search: { maxResults, includeImports } }` — at a path the loader did not look in. Neither of those was a typo: the two
 * halves of the feature were written against two different ideas of what the file was, and since nothing read it, nothing
 * ever disagreed out loud. A project could set `index.maxFileSize` and get no effect, and had no way to find out.
 *
 * Three keys from the defaults are deliberately **not** written, and for two different reasons:
 *
 * - `rootPath` is an absolute path from the machine that ran `init`, and `parseWorkers` is a function of that machine's
 *   CPU count. Both would travel with the repository and describe the wrong machine.
 * - `ignorePaths` is a fourth list of paths beside the two the walk actually reads, and nothing in this product consumes
 *   it. Writing it into a new project's configuration would recreate, in miniature, exactly the defect this iteration is
 *   about: a file that looks like it configures something. It stays in the schema because the shared type has it; it does
 *   not belong in a file a user is meant to edit.
 *
 * Every key written here is a value the defaults already have, so the file starts out equivalent to no file at all — the
 * difference is that it is now a place to change something, and `code-analyzer config` names it as the source of each
 * value it sets.
 */
export function defaultConfigFile(): Record<string, unknown> {
  const defaults = getDefaultConfig();
  return {
    projectId: defaults.projectId,
    excludePatterns: defaults.excludePatterns,
    includePatterns: defaults.includePatterns,
    maxFileSize: defaults.maxFileSize,
    maxFiles: defaults.maxFiles,
  };
}

const GITIGNORE_ENTRY = '\n# Code Analyzer\n.code-analyzer/data/\n';

/**
 * Write `contents` to `path`, or report that the file is already there.
 *
 * **The check and the write are one operation.** This used to read `existsSync(path) || force` and then write, which is
 * a time-of-check to time-of-use race: the file can appear between the two, and the write then silently destroys
 * whatever was written in between — a standards file someone had just edited, in the case that matters. CodeQL reported
 * it as `js/file-system-race` on `standards.json` and the fix is not to suppress the alert but to use the flag the
 * kernel already offers: `wx` creates and fails with `EEXIST` atomically.
 *
 * @returns whether the file was written (true) or already existed (false).
 */
function writeIfAbsent(path: string, contents: string, force: boolean): boolean {
  if (force) {
    writeFileSync(path, contents);
    return true;
  }
  try {
    writeFileSync(path, contents, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // **`EEXIST` means "that path is taken", not "that file is here".** `O_EXCL` fails on a directory too, and calling a
    // directory an existing standards file sends a reader to edit something that is not a file.
    if (!statSync(path).isFile()) {
      throw new Error(`${path} exists and is not a regular file`);
    }
    return false;
  }
}

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
  if (writeIfAbsent(standardsPath, JSON.stringify(projectStandard(), null, 2) + '\n', force)) {
    filesCreated.push('standards.json');
  } else {
    filesExisting.push('standards.json');
  }

  // config.json
  const configPath = join(configDir, 'config.json');
  if (writeIfAbsent(configPath, JSON.stringify(defaultConfigFile(), null, 2) + '\n', force)) {
    filesCreated.push('config.json');
  } else {
    filesExisting.push('config.json');
  }

  // Append to .gitignore
  const gitignorePath = join(targetDir, '.gitignore');
  try {
    // **One descriptor, so the read and the append are the same file.** Reading by path and then appending by path is
    // the shape CodeQL reports as `js/file-system-race`: between the two calls the path can be replaced by a symlink, and
    // the append would then land wherever it points. `open` resolves the path once, and `a+` gives a handle that can be
    // read and appended to; `O_APPEND` still puts every write at the end, so another process's lines are never
    // overwritten by a copy of this file as it looked a moment earlier.
    const handle = openSync(gitignorePath, 'a+');
    try {
      const existing = readFileSync(handle, 'utf-8');
      if (!existing.includes('.code-analyzer/data/')) {
        appendFileSync(handle, (existing.trimEnd() + GITIGNORE_ENTRY).trimEnd() + '\n');
        // `filesCreated` only ever holds 'standards.json', 'config.json' and
        // '.gitignore (updated)', none of which equals '.gitignore', so the
        // containment check that used to guard this push was always true.
        filesCreated.push('.gitignore (updated)');
      }
    } finally {
      closeSync(handle);
    }
  } catch {
    // .gitignore write failed — non-critical
  }

  const allCreated = filesCreated.length;
  // **The file is worth nothing if nobody says it is read.** This message is the one place a user is standing when
  // `config.json` first exists, so it names the command that reads it and the keys that make it work.
  const configHint = filesCreated.includes('config.json')
    ? ` Edit ${join(configDir, 'config.json')} to change what a run does; ` +
      '`code-analyzer config` prints the effective values and which file set each one.'
    : '';

  return {
    success: true,
    configDir,
    filesCreated,
    filesExisting,
    message:
      allCreated > 0
        ? `Initialized Code Analyzer in ${configDir}. Created: ${filesCreated.join(', ')}.${configHint}`
        : `Code Analyzer already initialized in ${configDir}. Use --force to overwrite.`,
  };
}
