// @code-analyzer/intelligence — the index finally has a reader that can see a checkout
//
// **§100 put the index in front of the sentence and left it without a supply.** Every caller of `buildRepoIndex` had
// already decided which files to read: a benchmark that fetched the changed files, a report that globbed
// `packages/*/src`. **A repository on disk is the source none of them had**, and it is the one a product has - an action
// runs inside a checkout, so the whole graph is already on local disk and costs no request to read.
//
// **Four refusals, and each one is a cap the caller can see.**
//
// 1. **A dependency is not this repository.** `node_modules` alone holds more files than every source tree in it, and an
//    index over it would report rates about other people's code. The skip list is a default and the caller may change
//    it, because a corpus whose sources *are* under `vendor/` is a real repository.
// 2. **An artefact is not a declaration.** `dist/`, `build/`, `target/` hold compiled copies of files the walk already
//    read, and reading both would double every count and make `impactOf` answer with a `.js` file nobody edits.
// 3. **A file too large to be source is skipped rather than truncated**, and the byte count it was refused for is in the
//    stats: a truncated file would produce an import whose specifier is cut in half, which is a *wrong* edge rather than
//    a missing one.
// 4. **A cap that hides files says so.** `skippedOverCap` exists so a caller cannot mistake a repository of twenty
//    thousand files for the two thousand it indexed - **a silent cap is an index that reports a smaller repository as a
//    fact**.
//
// **Why synchronous.** The caller is a review that is about to spend a model call on the result: a walk of a few
// thousand files is tens of milliseconds, it is not the slow part, and a promise here would buy nothing but a reason for
// every test of the index to become asynchronous.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readSwiftTargets } from './imports-langs.js';

import type { RepoFile } from './repo-index.js';

/** What the walk will and will not read. Every field has a default that is safe for a checkout of a real repository. */
export interface RepoFileLimits {
  /** Extensions, with the dot. **The default is exactly the set the index can read**, so the walk cannot add files that
   * would raise `stats.files` without raising what the index knows. */
  readonly extensions?: readonly string[];
  readonly skipDirectories?: readonly string[];
  /** Files. Two thousand is more than any of the corpora this repository measures on, and a cap above that is a walk
   * that will not finish inside a review. */
  readonly maxFiles?: number;
  /** Bytes per file. Half a megabyte, because a source file larger than that is generated and an import cut out of it
   * would be a wrong edge rather than a missing one. */
  readonly maxFileBytes?: number;
  /** Bytes for the whole walk. **A repository is not the only thing that can be large**: a monorepo of forty thousand
   * source files is a checkout a review can still afford to look at, and holding all of it in memory is not. */
  readonly maxTotalBytes?: number;
  /**
   * **The files the caller will not read, said as a rule rather than as a list.** The extension is the index's
   * question; this is the caller's - a `.d.ts` is a declaration of a file the walk already read, and a `.test.ts` is
   * not what a review of `src` is about. **A file the caller refused is not counted as considered**, so the counts stay
   * rates over the corpus the caller asked for.
   */
  readonly accept?: (path: string) => boolean;
}

/** What the walk did, in the terms a caller can check. */
export interface RepoTreeStats {
  /** Whether the root was a directory at all. **A review that cannot see a checkout must still run.** */
  readonly readable: boolean;
  /** Files whose extension the caller asked for, whether or not they were read. */
  readonly considered: number;
  readonly read: number;
  readonly bytes: number;
  readonly skippedBySize: number;
  /** Files the cap hid. **The field that keeps a capped walk from reporting a smaller repository as a fact.** */
  readonly skippedOverCap: number;
  /** Files the byte cap hid, counted apart from the file cap because the two caps bind for different repositories. */
  readonly skippedOverBytes: number;
  readonly skippedUnreadable: number;
  readonly directoriesSkipped: number;
}

/** A checkout as the index takes it: files, what reading them cost, and the one fact a file cannot carry. */
export interface RepoTree {
  readonly files: readonly RepoFile[];
  readonly stats: RepoTreeStats;
  /**
   * **The `module` line of the repository's `go.mod`, or `null`.**
   *
   * An import path does not say where the module ends: `github.com/gin-gonic/gin/internal/bytesconv` is inside this
   * checkout when `go.mod` says so and a dependency when it says something else. **The walk is the only place that can
   * read it**, because `go.mod` is not a source file and `buildRepoIndex` is handed text rather than a directory - so the
   * one extra read happens here and the index is given the answer.
   */
  readonly goModule: string | null;
  /**
   * **The modules a Swift package declares, and the directory each one's sources are in.**
   *
   * Read from `Package.swift`, because **a module name does not say where the module is**: `import Alamofire` is
   * `Source/` in one package and `Sources/Alamofire/` in the next, and SwiftPM writes the answer down. A target that
   * spells no path is resolved against the two defaults SwiftPM defines - `Sources/<name>` and `Tests/<name>` - **and
   * only a directory the checkout actually holds is believed**, which is the difference between a default and a guess.
   */
  readonly swiftModules: ReadonlyMap<string, string>;
  /**
   * **The workspace packages a checkout declares, and the directory each one's `package.json` sits in.**
   *
   * Read from every `package.json` the walk passes, because **a package name does not say where the package is**: zod's
   * 333 sources import `zod` 192 times and the name resolves to `packages/zod/src/index.ts` only because a
   * `package.json` in `packages/zod/` says `"name": "zod"`. Measured on that checkout before this field existed: **513 of
   * 928 imports resolved (55.3 %), and 415 were answered `external`** — 192 of which name the repository itself.
   *
   * **The same field `goModule` and `swiftModules` are**, for the same reason: the walk is the only place that can read a
   * file the index is not given, so the answer is carried from here rather than guessed there.
   */
  readonly workspacePackages: ReadonlyMap<string, string>;
}

/**
 * The `name` a `package.json` declares, or `null`.
 *
 * **Tolerant in the same direction as the walk**: a manifest that is absent, unreadable, larger than a source file or not
 * JSON answers `null`, and a package nobody can name is a package whose imports stay `external` rather than a package
 * resolved to a guess.
 */
export function packageNameOf(text: string): string | null {
  if (text.length > 262_144) return null;
  try {
    /**
     * **`unknown` rather than the `any` `JSON.parse` returns**, because a manifest is a document this repository did not
     * write: the first version read `parsed?.name` off an `any` and the lint ratchet caught two unsafe assignments in a
     * file that had been clean - the same shape of finding as a resolver that trusts its input.
     */
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const name = (parsed as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 && name.length <= 214 ? name : null;
  } catch {
    return null;
  }
}

/** `module a/b` from a `go.mod` body, which is the one line that turns an import path into a directory. */
export function goModuleOf(text: string): string | null {
  const match = /^\s*module\s+(\S+)\s*$/mu.exec(text);
  return match === null ? null : match[1]!;
}

/** The languages `repo-index.ts` has a reader for, which is the only reason to read a file at all. */
const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.java',
  '.kt',
  '.kts',
  '.groovy',
  '.py',
  '.swift',
  '.ets',
  // **Go and C are the two languages 39.7 % of the review benchmark's files are written in**, measured on
  // `aacr-bench` v2: 164 `.cpp`, 87 `.c`, 34 `.h` and 90 `.go` of its 944. Until §102 the edge layer read neither, so the
  // walk did not read them either - a repository in those languages was indexed as a set of files with no imports.
  '.go',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  // **The document languages, whose edge is a reference to another document** (§103): an XSD that includes a type
  // library, a JSON Schema whose `allOf` names a file, an OpenAPI document whose `$ref` names forty components. They were
  // symbol languages with no edge layer, which is half an index.
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.xml',
  '.xsd',
  // **The DTD a DOCTYPE names**, added with the DOCTYPE reader: a reference resolves only to a file the walk read.
  '.dtd',
] as const;

/** Directories that are never this repository's sources. */
const DEFAULT_SKIP = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
] as const;

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * **The module a repository's `go.mod` declares, or `null`.**
 *
 * Read with the same tolerance as the walk: a `go.mod` that is missing, unreadable or larger than a source file answers
 * `null`, and the index then refuses every Go import as `external` rather than guessing where the module ends.
 */
function readGoModule(root: string): string | null {
  try {
    const text = readFileSync(join(root, 'go.mod'), 'utf8');
    if (text.length > 64 * 1024) return null;
    return goModuleOf(text);
  } catch {
    return null;
  }
}

/** The directory a repo-relative path sits in, and no trailing slash. */
function directoryOf(root: string, relative: string): boolean {
  try {
    return statSync(join(root, relative)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * **The module-to-directory map a Swift package declares**, or an empty map when there is no manifest.
 *
 * The four refusals are the same shape the walk makes: no `Package.swift` (a repository that is not a package), a
 * manifest over the size cap, a `binaryTarget` (no sources here), and a target whose default directory the checkout does
 * not hold - **each answers *this module has no sources I can see*, which is a fact the index reports as `external`
 * rather than as an edge**.
 */
function readSwiftModules(root: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  let text: string;
  try {
    text = readFileSync(join(root, 'Package.swift'), 'utf8');
  } catch {
    return out;
  }
  if (text.length > 128 * 1024) return out;
  for (const target of readSwiftTargets(text)) {
    const candidates =
      target.path === null ? [`Sources/${target.name}`, `Tests/${target.name}`] : [target.path];
    for (const candidate of candidates) {
      if (!directoryOf(root, candidate)) continue;
      out.set(target.name, candidate);
      break;
    }
  }
  return out;
}

/** The extension of a path, lowercased, or `''`. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

/**
 * **Every file under `root` that the index can read, sorted by path.**
 *
 * Sorted rather than in `readdir` order, because **an index built twice from one repository must be the same index**:
 * the edge list is sorted by path, and a walk that handed back the filesystem's order would make two runs' statistics
 * differ for a reason no one could reproduce.
 */
export function readRepoFiles(root: string, limits: RepoFileLimits = {}): RepoTree {
  const extensions = new Set(limits.extensions ?? DEFAULT_EXTENSIONS);
  const skip = new Set(limits.skipDirectories ?? DEFAULT_SKIP);
  const maxFiles = Math.max(1, limits.maxFiles ?? DEFAULT_MAX_FILES);
  const maxFileBytes = Math.max(1, limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const maxTotalBytes = Math.max(1, limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
  const accept = limits.accept ?? (() => true);

  const empty = (readable: boolean): RepoTree => ({
    files: [],
    goModule: null,
    swiftModules: new Map(),
    workspacePackages: new Map(),
    stats: {
      readable,
      considered: 0,
      read: 0,
      bytes: 0,
      skippedBySize: 0,
      skippedOverCap: 0,
      skippedOverBytes: 0,
      skippedUnreadable: 0,
      directoriesSkipped: 0,
    },
  });

  try {
    if (!statSync(root).isDirectory()) return empty(false);
  } catch {
    return empty(false);
  }

  const out: RepoFile[] = [];
  const workspacePackages = new Map<string, string>();
  let considered = 0;
  let bytes = 0;
  let skippedBySize = 0;
  let skippedOverCap = 0;
  let skippedOverBytes = 0;
  let skippedUnreadable = 0;
  let directoriesSkipped = 0;

  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      // **A symbolic link is not followed.** A checkout can hold a link to a parent directory, and a walk that followed
      // one would index the repository once per link, or never finish.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) {
          directoriesSkipped += 1;
          continue;
        }
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      // **A manifest is read for the name it declares, whether or not the caller asked for JSON.** A workspace package
      // is a directory whose `package.json` names it, and the name is the only thing that turns `import { z } from
      // 'zod'` into a file rather than into an external dependency.
      if (entry.name === 'package.json') {
        try {
          const declared = packageNameOf(readFileSync(join(root, path), 'utf8'));
          if (declared !== null && !workspacePackages.has(declared)) {
            workspacePackages.set(declared, relative);
          }
        } catch {
          // A manifest nobody can read is a package nobody can name, and the walk has already counted what it could not
          // read: this is not a second refusal, it is the same one seen by a different reader.
        }
      }
      if (!extensions.has(extensionOf(path))) continue;
      if (!accept(path)) continue;
      considered += 1;
      if (out.length >= maxFiles) {
        skippedOverCap += 1;
        continue;
      }
      try {
        const size = statSync(join(root, path)).size;
        if (size > maxFileBytes) {
          skippedBySize += 1;
          continue;
        }
        if (bytes + size > maxTotalBytes) {
          skippedOverBytes += 1;
          continue;
        }
        const text = readFileSync(join(root, path), 'utf8');
        bytes += text.length;
        out.push({ path, text });
      } catch {
        skippedUnreadable += 1;
      }
    }
  };

  walk('');

  // **`localeCompare` rather than a comparator with three arms**, because the third arm - two files with one path - is a
  // case a filesystem cannot produce and a branch a coverage gate would then have to be told a story about.
  out.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: out,
    goModule: readGoModule(root),
    swiftModules: readSwiftModules(root),
    workspacePackages,
    stats: {
      readable: true,
      considered,
      read: out.length,
      bytes,
      skippedBySize,
      skippedOverCap,
      skippedOverBytes,
      skippedUnreadable,
      directoriesSkipped,
    },
  };
}
