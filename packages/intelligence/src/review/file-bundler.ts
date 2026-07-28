// @code-analyzer/intelligence — Smart File Bundler
// Groups related files for more effective PR review using deterministic heuristics.

import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BundleCategory = 'mirror' | 'sibling' | 'impl' | 'config' | 'solo';

export interface FileBundle {
  id: string;
  files: string[];
  primaryFile: string;
  category: BundleCategory;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Patterns that indicate a test file (match against full normalized path) */
const TEST_PATTERNS = [/\.(test|spec)\./i, /[\\/]__tests__[\\/]/i, /\.(test|spec)$/i];

/**
 * Mirror suffixes: language locales and environment variants.
 * These patterns match against the filename stem (without final extension).
 * They look for `[._]CODE` at word boundaries, possibly followed by another
 * `[._]` or end-of-stem.
 */
const MIRROR_STEM_PATTERNS = [
  /[._]en(?:[._]|$)/i,
  /[._]zh(?:[._]|$)/i,
  /[._]ja(?:[._]|$)/i,
  /[._]ko(?:[._]|$)/i,
  /[._]fr(?:[._]|$)/i,
  /[._]de(?:[._]|$)/i,
  /[._]es(?:[._]|$)/i,
  /[._]dev(?:[._]|$)/i,
  /[._]prod(?:[._]|$)/i,
  /[._]staging(?:[._]|$)/i,
  /[._]development(?:[._]|$)/i,
  /[._]production(?:[._]|$)/i,
];

/**
 * Mirror suffix patterns for full filename matching (used for category detection).
 */
const MIRROR_FULL_PATTERNS = [
  /[._]en[._]/i, /[._]zh[._]/i, /[._]ja[._]/i, /[._]ko[._]/i,
  /[._]fr[._]/i, /[._]de[._]/i, /[._]es[._]/i,
  /[._]dev[._]/i, /[._]prod[._]/i, /[._]staging[._]/i,
  /[._]development[._]/i, /[._]production[._]/i,
  // Also match at end (before extension)
  /[._]en\./i, /[._]zh\./i, /[._]ja\./i, /[._]ko\./i,
  /[._]fr\./i, /[._]de\./i, /[._]es\./i,
  /[._]dev\./i, /[._]prod\./i, /[._]staging\./i,
  /[._]development\./i, /[._]production\./i,
];

/** Sibling suffixes: styles, modules, stories, types */
const SIBLING_SUFFIXES = [
  /\.styles\./i, /\.module\.css$/i, /\.module\.scss$/i, /\.module\.less$/i,
  /\.types\./i, /\.stories\./i, /\.story\./i,
  /\.d\.ts$/i,
];

const INTERFACE_PREFIX = /^I[A-Z]/;
const ABSTRACT_PREFIX = /^Abstract[A-Z]/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativePath(file: string, root: string): string {
  const rel = path.relative(root, file);
  return rel.startsWith('..') ? file : rel;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function fileName(file: string): string {
  return normalizePath(path.basename(file));
}

function dirName(file: string): string {
  return normalizePath(path.dirname(file));
}

function baseNameNoExt(file: string): string {
  const name = fileName(file);
  const dotIdx = name.indexOf('.');
  return dotIdx === -1 ? name : name.substring(0, dotIdx);
}

function isTestFile(file: string): boolean {
  const name = normalizePath(file);
  return TEST_PATTERNS.some((p) => p.test(name));
}

function isInterfaceFile(name: string): boolean {
  const base = baseNameNoExt(name);
  return INTERFACE_PREFIX.test(base);
}

function isAbstractFile(name: string): boolean {
  const base = baseNameNoExt(name);
  return ABSTRACT_PREFIX.test(base);
}

/** Check if a filename has a mirror suffix (language or env variant). */
function hasMirrorSuffix(name: string): boolean {
  return MIRROR_FULL_PATTERNS.some((p) => p.test(name));
}

/** Check if a filename has a sibling suffix (styles, stories, etc). */
function hasSiblingSuffix(name: string): boolean {
  return SIBLING_SUFFIXES.some((p) => p.test(name));
}

/**
 * Strip known suffixes from a filename to produce the logical group base name.
 * Returns just the base portion (no extension) used for grouping.
 */
function logicalBaseName(file: string): string {
  const name = fileName(file);

  // Determine the stem (filename without final extension)
  const ext = path.extname(name);
  let stem: string;

  if (ext) {
    stem = name.substring(0, name.length - ext.length);
    // Handle double extensions like .d.ts
    if (stem.endsWith('.d')) {
      stem = stem.substring(0, stem.length - 2);
    }
  } else {
    stem = name;
  }

  // Remove test suffix from stem
  stem = stem.replace(/\.(test|spec)$/i, '');

  // Remove mirror suffixes (language/env) — these match against the stem
  for (const pattern of MIRROR_STEM_PATTERNS) {
    const match = stem.match(pattern);
    if (match) {
      const idx = stem.indexOf(match[0]);
      if (idx >= 0) {
        // Keep the separator before the variant
        stem = stem.substring(0, idx);
      }
      break;
    }
  }

  // Remove sibling suffixes from stem
  // .styles, .types, .stories, .story — these appear as infix in the stem
  for (const suffix of ['.styles', '.types', '.stories', '.story']) {
    const idx = stem.indexOf(suffix);
    if (idx >= 0) {
      stem = stem.substring(0, idx);
      break;
    }
  }

  // Handle .module suffix in stem
  const moduleIdx = stem.indexOf('.module');
  if (moduleIdx >= 0) {
    stem = stem.substring(0, moduleIdx);
  }

  // Interface prefix: IUserService -> UserService
  if (INTERFACE_PREFIX.test(stem)) {
    stem = stem.substring(1);
  }

  // Abstract prefix: AbstractRepo -> Repo
  if (ABSTRACT_PREFIX.test(stem)) {
    stem = stem.substring(8);
  }

  // If the stem still contains dots after all known suffixes are stripped,
  // use only the base name (before first dot). This handles patterns like
  // "Foo.helpers.ts" grouping with "Foo.tsx".
  const firstDot = stem.indexOf('.');
  if (firstDot > 0) {
    stem = stem.substring(0, firstDot);
  }

  return stem || name;
}

/**
 * Compute a canonical group name for a file. Files that map to the same
 * canonical name are bundled together.
 */
function canonicalGroup(file: string): string {
  const dir = dirName(file);

  // For __tests__ directory files, use parent directory
  const cleanDir = dir.replace(/[\\/]__tests__$/i, '');

  const base = logicalBaseName(file);
  return `${cleanDir}/${base}`;
}

// ---------------------------------------------------------------------------
// FileBundler Class
// ---------------------------------------------------------------------------

export class FileBundler {
  /**
   * Group a list of file paths into logical review bundles.
   *
   * @param files - Absolute or relative file paths
   * @param projectRoot - Project root directory for computing relative paths
   * @returns Array of FileBundle objects
   */
  bundleFiles(files: string[], projectRoot: string): FileBundle[] {
    if (!files.length) return [];

    const normalized = files.map((f) => normalizePath(f));
    const root = normalizePath(path.resolve(projectRoot));

    // Phase 1: Group files by canonical group name
    const groups = new Map<string, string[]>();

    for (const file of normalized) {
      const key = canonicalGroup(file);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(file);
    }

    // Phase 2: Build bundles
    const bundles: FileBundle[] = [];
    let counter = 0;

    for (const [, groupFiles] of groups) {
      counter++;
      const primary = pickPrimary(groupFiles);
      const category = groupFiles.length > 1 ? detectCategory(groupFiles) : 'solo';

      bundles.push({
        id: `bundle-${counter}`,
        files: groupFiles.map((f) => relativePath(f, root)),
        primaryFile: relativePath(primary, root),
        category,
      });
    }

    return bundles;
  }
}

// ---------------------------------------------------------------------------
// Category Detection
// ---------------------------------------------------------------------------

function detectCategory(files: string[]): BundleCategory {
  const names = files.map((f) => fileName(f));

  // Mirror: language or environment variants
  if (names.some((n) => hasMirrorSuffix(n))) return 'mirror';

  // Implementation: interface/abstract prefix patterns
  if (names.some((n) => isInterfaceFile(n) || isAbstractFile(n))) return 'impl';

  // Config: dev/prod/staging patterns
  if (names.some((n) => /[._](dev|prod|staging|development|production)[._]/i.test(n))) return 'config';

  // Sibling: styles, modules, stories, types suffixes
  if (names.some((n) => hasSiblingSuffix(n))) return 'sibling';

  // Test pairing
  if (names.some((n) => isTestFile(n))) return 'sibling';

  // Multiple files with same base name in same directory = sibling
  if (files.length > 1) {
    const bases = files.map((f) => baseNameNoExt(fileName(f)));
    const firstBase = bases[0];
    if (firstBase && bases.every((b) => b === firstBase)) return 'sibling';
  }

  return 'solo';
}

// ---------------------------------------------------------------------------
// Primary File Selection
// ---------------------------------------------------------------------------

function pickPrimary(files: string[]): string {
  const scored = files.map((f) => {
    const name = fileName(f);
    let score = 0;
    if (!isTestFile(f)) score += 10;
    if (!isInterfaceFile(name) && !isAbstractFile(name)) score += 5;
    if (!hasSiblingSuffix(name)) score += 3;
    if (!hasMirrorSuffix(name)) score += 3;
    if (/\.(tsx?|jsx?)$/i.test(name)) score += 2;
    return { file: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.file;
}
