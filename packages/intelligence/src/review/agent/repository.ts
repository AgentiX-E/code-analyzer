// @code-analyzer/intelligence — the codebase a review is allowed to read
//
// **The competitor's review agent is given six tools and a checkout**: `internal/tool/definitions.go` in
// `alibaba/open-code-review` declares `file_read`, `file_read_diff`, `file_search`, `file_find`, `code_comment` and
// `task_done`, and its main prompt tells the model to *"use context tools to read or search related code when needed"*
// before it files anything. **Our review engine was given a string.**
//
// That difference is measurable and it is the whole of the gap the head-to-head reports: on the same corpus, the same
// judge and the same model, the tool-using reviewer reached F1 0.4043 against our 0.2033 - and **158 of the 282 goldens
// we missed had a finding of ours on their path, within ten lines, that did not describe the same defect.** A reviewer
// that cannot read the function cannot say what the function does wrong.
//
// So this file is the other half of that sentence: **a codebase, as an interface.** It is deliberately a read-only view
// with a byte budget, because a review is billed per token and an agent with unrestricted reads is a bill with no
// ceiling. **The interface is here and the transport is not** - the benchmark supplies one over the GitHub API and the
// CLI supplies one over the working tree - the same division `LLMProvider` follows, and for the same reason: **a module
// that reaches the network by itself cannot be tested against a corpus.**

import { closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

/** One file, as the reviewer sees it. */
export interface RepositoryFile {
  /** Repository-relative path, posix separators. */
  path: string;
  /** The file's text, truncated to the repository's read limit. */
  text: string;
  /** Whether `text` is shorter than the file, so a caller can say so rather than reason about half a function. */
  truncated: boolean;
  /** The line number the text starts at. 1 unless the read was ranged. */
  firstLine: number;
}

/** One line a search matched. */
export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** A read-only view of the code a review covers. */
export interface ReviewRepository {
  /** The changed files, repository-relative, in the order the diff named them. */
  changedPaths(): ReadonlyArray<string>;
  /** The unified diff of a changed file, or null when the file was not part of this change. */
  diffOf(path: string): string | null;
  /** A file's text, or null when it does not exist - **null rather than an empty string**, because a reviewer that
   * cannot tell "absent" from "empty" will describe an empty file as a defect. */
  readFile(path: string): RepositoryFile | null;
  /** Substring search across the codebase. **A literal, not a pattern**: a reviewer that can pass a regular expression
   * to a remote endpoint is a reviewer that can be made to wait for one. */
  search(query: string, options?: SearchOptions): SearchHit[];
  /** Every file the repository can see, for a caller that needs to name what was not read. */
  listFiles(): ReadonlyArray<string>;
}

export interface SearchOptions {
  /** Maximum hits returned. Default 20. */
  limit?: number;
  /** Maximum files examined. Default 400. */
  maxFiles?: number;
  /** Only paths matching this suffix, e.g. `.ts`. */
  suffix?: string;
}

/** What the reader is allowed to spend, and what it refuses to read. */
export interface RepositoryLimits {
  /** Maximum characters returned by one `readFile`. Default 60 000. */
  maxFileChars?: number;
  /** Maximum bytes of a file the reader will even open. Default 2 000 000. */
  maxFileBytes?: number;
  /** Directories never walked. */
  skipDirectories?: ReadonlyArray<string>;
  /** Maximum files a listing will collect. Default 20 000 - **a ceiling against a walk of a monorepo**, not a choice. */
  maxFilesListed?: number;
}

const DEFAULT_LIMITS: Required<RepositoryLimits> = {
  maxFileChars: 60_000,
  maxFileBytes: 2_000_000,
  maxFilesListed: 20_000,
  skipDirectories: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.git',
    '.turbo',
    'vendor',
    'target',
  ],
};

/** Extensions a search will read. **A search is for code**; the corpus of a review is source. */
const SEARCHABLE =
  /\.(?:[cm]?[jt]sx?|py|go|java|kt|kts|swift|ets|rs|c|h|cc|cpp|hpp|cs|rb|php|scala|groovy|xml|ya?ml|json|sql|sh|tsx|vue|svelte)$/;

/**
 * **Normalise a path and refuse anything that leaves the root.**
 *
 * A model chooses the path, so the path is untrusted input: `../../etc/passwd` is a read the reviewer asked for and a
 * read it must not get. The check is on the resolved relative path rather than on the string, because `a/../../b`
 * contains no `..` at the start and still escapes.
 */
function safeRelative(root: string, path: string): string | null {
  if (path.length === 0 || isAbsolute(path)) return null;
  const cleaned = path.split('\\').join('/').replace(/^\.\//, '');
  const resolved = normalize(join(root, cleaned));
  const back = relative(root, resolved).split(sep).join('/');
  if (back.startsWith('..') || isAbsolute(back)) return null;
  return back;
}

/**
 * The root with its symlinks resolved, or the root as given when it does not exist.
 *
 * **`realpathSync` on the root rather than on every comparison**, because the two paths being compared have to be
 * spelled the same way: `/tmp` is `/private/tmp` on macOS, and a root that resolved but a candidate that did not would
 * make every read look like an escape. A root that cannot be resolved is a root with no files in it, and the reads fail
 * on their own; failing in the constructor would turn "the checkout is missing" into an exception at `new`.
 */
function realRootOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

/**
 * Whether a resolved path is the root or sits under it.
 *
 * **A prefix comparison with the separator attached**, because `/repo-evil` starts with `/repo` and is a different
 * directory. `readFile('src')` resolves to the root itself, which is why equality is its own case rather than a special
 * one at the call site.
 */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/** A repository backed by a directory on disk - the working tree, or a checkout. */
export class DirectoryRepository implements ReviewRepository {
  private readonly root: string;
  private readonly realRoot: string;
  private readonly diffs: Map<string, string>;
  private readonly limits: Required<RepositoryLimits>;
  private cachedFiles: string[] | null = null;

  constructor(options: {
    root: string;
    /** The change under review, as unified diffs keyed by repository-relative path. */
    changed: ReadonlyMap<string, string>;
    limits?: RepositoryLimits;
  }) {
    this.root = options.root;
    this.realRoot = realRootOf(options.root);
    this.diffs = new Map(options.changed);
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  changedPaths(): ReadonlyArray<string> {
    return [...this.diffs.keys()];
  }

  diffOf(path: string): string | null {
    return this.diffs.get(path) ?? null;
  }

  readFile(path: string): RepositoryFile | null {
    const relativePath = safeRelative(this.root, path);
    if (relativePath === null) return null;
    let descriptor: number;
    try {
      // **The name is resolved before it is opened, because a path inside the root can name a file outside it.**
      // `safeRelative` compares strings, and a pull request can commit a symlink - `notes -> /home/runner/.ssh/id_rsa`
      // costs one line and leaves the root lexically intact. A reader that opened the name would hand that file's text
      // to a model; `realpathSync` asks the filesystem which file the name actually is, and the answer is held to the
      // same rule. Resolving then opening leaves a window in which the link could be swapped, and it is accepted
      // deliberately: the swap needs write access to the tree being reviewed, which is a reader that has already lost.
      const resolved = realpathSync(join(this.root, relativePath));
      if (!isWithin(this.realRoot, resolved)) return null;
      descriptor = openSync(resolved, 'r');
    } catch {
      // **One `try`, because a resolve and an open fail for the same reason and the caller's answer is the same either
      // way** - the path is not readable, so the reviewer is told nothing rather than told the file is empty.
      return null;
    }
    try {
      // **One descriptor for the size and the text.** Asking the path whether it is a file and then reading the path is
      // two lookups of one name, and a name can point at two files in between - the file the reader measured and the
      // file the reader handed to the model were not provably the same file. `fstat` answers about the very inode the
      // read will come from, which is a fact the path could not supply.
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) return null;
      if (stat.size > this.limits.maxFileBytes) {
        // **A file too large to read is a file the reviewer is told about**, not a silent empty answer.
        return { path: relativePath, text: '', truncated: true, firstLine: 1 };
      }
      // **No `catch` around the read, because there is no failure it could report.** The descriptor is open, `fstat`
      // says it is a regular file, and its size is under the ceiling: the only way `readFileSync` fails from here is an
      // I/O error on the device, which is not a fact about the file a reviewer can be told - and a `catch` that
      // returned `null` for it would be a branch no corpus can reach, promising a graceful answer nothing can produce.
      // The `finally` is what matters: it closes the descriptor whether the read returns or throws.
      const text = readFileSync(descriptor, 'utf8');
      const limit = this.limits.maxFileChars;
      return {
        path: relativePath,
        text: text.length > limit ? text.slice(0, limit) : text,
        truncated: text.length > limit,
        firstLine: 1,
      };
    } finally {
      // **A descriptor is a resource, and a reader is called a dozen times per review.** The previous form leaked
      // nothing because it never held one; holding one without closing it in a `finally` would leak one per tool call.
      closeSync(descriptor);
    }
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    if (query.length < 2) return [];
    const limit = options.limit ?? 20;
    const maxFiles = options.maxFiles ?? 400;
    const needle = query.toLowerCase();
    const hits: SearchHit[] = [];
    let examined = 0;
    for (const path of this.listFiles()) {
      if (examined >= maxFiles || hits.length >= limit) break;
      if (options.suffix !== undefined && !path.endsWith(options.suffix)) continue;
      const file = this.readFile(path);
      if (file === null) continue;
      examined += 1;
      const lines = file.text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (line.toLowerCase().includes(needle)) {
          hits.push({ path, line: i + file.firstLine, text: line.trim().slice(0, 240) });
          if (hits.length >= limit) break;
        }
      }
    }
    return hits;
  }

  listFiles(): ReadonlyArray<string> {
    if (this.cachedFiles !== null) return this.cachedFiles;
    const found: string[] = [];
    const skip = new Set(this.limits.skipDirectories);
    const walk = (directory: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(absolute);
          continue;
        }
        if (!entry.isFile() || !SEARCHABLE.test(entry.name)) continue;
        found.push(relative(this.root, absolute).split(sep).join('/'));
        if (found.length >= this.limits.maxFilesListed) return;
      }
    };
    walk(this.root);
    found.sort();
    this.cachedFiles = found;
    return found;
  }
}

/**
 * **A repository whose files were handed to it** - the shape a transport that already fetched them needs.
 *
 * The benchmark reads files through the API and the tests read them off disk; **both arrive as text**, and a reviewer
 * that insisted on a filesystem would be a reviewer the benchmark could not use. Reads of a path that was not handed
 * over fall through to `fallback` when one is supplied, so a small map plus a reader is a usable combination.
 */
export class MappedRepository implements ReviewRepository {
  private readonly files: Map<string, string>;
  private readonly diffs: Map<string, string>;
  private readonly fallback: ReviewRepository | null;
  private readonly limits: Required<RepositoryLimits>;
  private readonly order: string[];

  constructor(options: {
    files: ReadonlyMap<string, string>;
    changed: ReadonlyMap<string, string>;
    fallback?: ReviewRepository | null;
    limits?: RepositoryLimits;
  }) {
    this.files = new Map(options.files);
    this.diffs = new Map(options.changed);
    this.fallback = options.fallback ?? null;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.order = [...this.diffs.keys()];
  }

  changedPaths(): ReadonlyArray<string> {
    return this.order;
  }

  diffOf(path: string): string | null {
    return this.diffs.get(path) ?? null;
  }

  readFile(path: string): RepositoryFile | null {
    const text = this.files.get(path);
    if (text !== undefined) {
      const limit = this.limits.maxFileChars;
      return {
        path,
        text: text.length > limit ? text.slice(0, limit) : text,
        truncated: text.length > limit,
        firstLine: 1,
      };
    }
    return this.fallback?.readFile(path) ?? null;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    if (query.length < 2) return [];
    const limit = options.limit ?? 20;
    const needle = query.toLowerCase();
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const [path, text] of this.files) {
      if (hits.length >= limit) break;
      if (options.suffix !== undefined && !path.endsWith(options.suffix)) continue;
      seen.add(path);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if ((lines[i] ?? '').toLowerCase().includes(needle)) {
          hits.push({ path, line: i + 1, text: (lines[i] ?? '').trim().slice(0, 240) });
          if (hits.length >= limit) break;
        }
      }
    }
    if (hits.length < limit && this.fallback !== null) {
      for (const hit of this.fallback.search(query, { ...options, limit: limit - hits.length })) {
        if (!seen.has(hit.path)) hits.push(hit);
      }
    }
    return hits;
  }

  listFiles(): ReadonlyArray<string> {
    const merged = new Set<string>([...this.files.keys()]);
    for (const path of this.fallback?.listFiles() ?? []) merged.add(path);
    return [...merged].sort();
  }
}
