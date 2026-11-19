// @code-analyzer/intelligence — the edges between files, which is the only fact in this index that a single file
// cannot establish
//
// **§93 measured every per-file fact this index can produce as a selector and all of them were the exact null.** The
// reason is not a tuning problem: "line 42 stands inside `panel_paint`" and "line 42 names a symbol this file declares"
// are true of a comment that found a defect and of a comment that found nothing, in the same proportion. **A fact about
// a file's shape cannot separate two comments filed against the same shape.**
//
// **The fact that is not about one file is the one the field is built on.** `sourcegraph/scip` gives every symbol an
// identity that survives a file boundary, which is what makes *who reads this* a query. `coderabbit` builds a code
// graph per pull request and `greptile` a repository graph, and both sell the same thing: **a review that knows what a
// change reaches.** This module is the smallest checkable version - the files an import names, and the names that
// actually cross.
//
// **Three refusals, and each one is a decision rather than an omission.**
//
// 1. **A bare specifier is `external`, not `missing`.** `import { z } from 'zod'` is a dependency; where it lives is not
//    in this repository. Counting it as unresolved would make a resolution rate that describes `node_modules`.
// 2. **A namespace import makes no edge.** `import * as ns` says nothing about which name crosses; the crossing is
//    `ns.helper`, and reading that is member resolution. The count is reported so the omission is visible.
// 3. **A re-export is not followed.** `import { renamed } from './b.js'` resolves to `b.ts` and makes no edge when `b.ts`
//    does not itself declare `renamed` - **a wrong edge is worse than a missing one here**, because the consumer is a
//    review deciding what a change reaches.

import { readImportSpecifier } from '../import-specifier.js';
import { buildSymbolIndex } from './symbols.js';

import type { FileSymbolIndex } from './symbols.js';

/** One file, as the caller has it: a path and its text. */
export interface RepoFile {
  readonly path: string;
  readonly text: string;
}

/** A name read from one file and declared in another. */
export interface CrossReference {
  readonly fromPath: string;
  /** 1-based, and the first line the name is used on outside its own import statement. */
  readonly fromLine: number;
  readonly toPath: string;
  readonly toName: string;
}

/** An import this index declined to answer, and which refusal it was. */
export interface UnresolvedImport {
  readonly fromPath: string;
  readonly line: number;
  readonly specifier: string;
  readonly why: 'external' | 'missing';
}

/** The counts a reader needs to know what the rates below are rates *of*. */
export interface RepoIndexStats {
  readonly files: number;
  readonly symbols: number;
  /** Import statements that named a module, resolved or not. */
  readonly imports: number;
  readonly resolvedImports: number;
  readonly externalImports: number;
  readonly missingImports: number;
  readonly namespaceImports: number;
  /** Names imported **and used**, declared in the file the import names. */
  readonly edges: number;
}

/** One import statement, and what this index answered for it. */
export interface ResolvedImport {
  readonly fromPath: string;
  readonly line: number;
  readonly specifier: string;
  /** The repo-relative file that answers it, or `null` for a package or a path no file holds. */
  readonly target: string | null;
  readonly why: 'resolved' | 'external' | 'missing';
}

export interface RepoIndex {
  readonly files: ReadonlyMap<string, FileSymbolIndex>;
  readonly references: readonly CrossReference[];
  /**
   * **Every import statement, resolved or not**, so a reader can compare this resolver against another one line by
   * line. `unresolved` is the subset a report shows; **a rate needs the denominator to be enumerable**, which is what
   * this is for.
   */
  readonly imports: readonly ResolvedImport[];
  readonly unresolved: readonly UnresolvedImport[];
  readonly stats: RepoIndexStats;
}

/** What a change to these names reaches. */
export interface ImpactSet {
  readonly callers: readonly CrossReference[];
  /** The files that read at least one of the names, sorted and without repeats. */
  readonly paths: readonly string[];
  /** The changed names that no other file reads. */
  readonly unreachable: readonly string[];
}

/** A name imported from a module, with the name it is referred to by locally. */
interface ImportedName {
  readonly imported: string;
  readonly local: string;
}

interface ImportStatement {
  readonly specifier: string;
  readonly names: readonly ImportedName[];
  readonly namespace: boolean;
  /** 1-based, and inclusive: every line the statement occupied, because an import is not a use of itself. */
  readonly startLine: number;
  readonly endLine: number;
}

/** The extensions a specifier may be answered with, in the order a resolver tries them. */
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** The extensions that are a compiled artefact of one of the above, and are answered by their source. */
const COMPILED = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/** `path` with `.` and `..` resolved, and no leading `./`. */
function normalisePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** The directory part of a repo-relative path, without a trailing slash. */
function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** Whether a specifier is a path in this repository rather than a package name. */
function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

/**
 * **The file a specifier names, or `null` when the repository in hand does not hold it.**
 *
 * The `.js` → `.ts` swap is not a convenience: **it is what every relative import in this repository is written as**,
 * because TypeScript requires an ES module to spell the emitted extension. A resolver that took the specifier literally
 * would report this repository as entirely unresolved.
 */
function resolveSpecifier(
  specifier: string,
  fromPath: string,
  files: ReadonlyMap<string, RepoFile>,
): string | null {
  const base = normalisePath(
    specifier.startsWith('/') ? specifier : `${dirOf(fromPath)}/${specifier}`,
  );
  const dot = base.lastIndexOf('.');
  const slash = base.lastIndexOf('/');
  const extension = dot > slash ? base.slice(dot).toLowerCase() : '';

  const candidates: string[] = [base];
  if (COMPILED.has(extension)) {
    const stem = base.slice(0, dot);
    for (const suffix of CANDIDATE_SUFFIXES) candidates.push(`${stem}${suffix}`);
  } else if (extension === '') {
    for (const suffix of CANDIDATE_SUFFIXES) candidates.push(`${base}${suffix}`);
    for (const suffix of CANDIDATE_SUFFIXES) candidates.push(`${base}/index${suffix}`);
  }
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return null;
}

/** The words a line writes, which is how a use is distinguished from a mention in a longer word. */
function wordsOf(line: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < line.length) {
    const code = line.charCodeAt(at);
    const starts =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
    if (!starts) {
      at += 1;
      continue;
    }
    let end = at + 1;
    while (end < line.length) {
      const next = line.charCodeAt(end);
      const part =
        (next >= 65 && next <= 90) ||
        (next >= 97 && next <= 122) ||
        (next >= 48 && next <= 57) ||
        next === 95 ||
        next === 36;
      if (!part) break;
      end += 1;
    }
    out.push(line.slice(at, end));
    at = end;
  }
  return out;
}

/** The `{ a, b as c }` list of an import, read between the braces the text already has. */
function braceNames(text: string): ImportedName[] {
  const open = text.indexOf('{');
  if (open < 0) return [];
  const close = text.indexOf('}', open + 1);
  if (close < 0) return [];
  const out: ImportedName[] = [];
  for (const piece of text.slice(open + 1, close).split(',')) {
    const cleaned = piece.replace(/^\s*type\s+/u, ' ').trim();
    if (cleaned.length === 0) continue;
    const words = cleaned.split(/\s+as\s+/u);
    const imported = words[0]!.trim();
    const local = (words[1] ?? imported).trim();
    if (imported.length > 0) out.push({ imported, local });
  }
  return out;
}

/**
 * **The import statement that starts on line `at`, joined however many lines it occupies.**
 *
 * An import wrapped over four lines is this repository's own style, so a reader that looked at one line would miss most
 * of them. The join stops at the first `from` followed by a quote, at the line that ends the statement, or after eight
 * lines - **a bound rather than a guess**, because a file of `import (`-less text must not cost a quadratic scan.
 */
function readStatement(
  lines: readonly string[],
  codes: readonly string[],
  at: number,
): ImportStatement | null {
  const first = lines[at]!.trim();
  const opensImport = /^(?:import|export)\b/u.test(first);
  if (!opensImport) return null;
  // **A statement starts on a line of code.** Without this, a `import …` written inside a template literal - a fixture,
  // a generator, a test corpus - is read as this file's import: this repository's own `benchmark-fixtures.ts` holds
  // benchmark programs as strings, and the resolver reported its line 24 as the single unresolved import in 1 257.
  if (codes[at]!.trim().length === 0) return null;
  // `export const x = 1` is not a re-export; only a braced `export { … } from` is a crossing.
  if (first.startsWith('export') && !first.includes('{')) return null;

  let joined = first;
  let end = at;
  while (
    !/from\s*['"]/u.test(joined) &&
    !joined.endsWith(';') &&
    end < Math.min(lines.length - 1, at + 7)
  ) {
    end += 1;
    joined = `${joined} ${lines[end]!.trim()}`;
  }

  let specifier = readImportSpecifier(joined);
  if (specifier === null) {
    // `export { a } from './b.js'` - the same crossing written from the other side, and the one `readImportSpecifier`
    // declines because it reads the keyword `import`. **The quoted run is taken as a unit rather than by counting
    // characters from `from`**, because the gaps around it are whatever the formatter left there: the first version
    // assumed exactly one space and handed back an empty specifier for `from  './b.js'`.
    const quoted = /from\s*(['"])([^'"]+)\1/u.exec(joined);
    if (quoted === null) return null;
    specifier = quoted[2]!;
  }

  const namespace = /import\s*\*\s*as\s+/u.test(joined);
  return {
    specifier,
    names: namespace ? [] : braceNames(joined),
    namespace,
    startLine: at + 1,
    endLine: end + 1,
  };
}

/**
 * **Every file read, every import answered where the repository answers it, and every edge a name that crosses.**
 *
 * The cost is linear in the text the caller already holds: one pass for the symbols, one for the statements, and one for
 * the words of the lines an imported name is used on - and that last pass is the only one that can be quadratic, because
 * it is per import rather than per line. It is bounded instead by looking for a word with `indexOf` on each line.
 */
export function buildRepoIndex(files: readonly RepoFile[]): RepoIndex {
  const byPath = new Map<string, RepoFile>();
  for (const file of files) byPath.set(normalisePath(file.path), file);

  const indices = new Map<string, FileSymbolIndex>();
  for (const [path, file] of byPath) indices.set(path, buildSymbolIndex(path, file.text));

  const references: CrossReference[] = [];
  const statements: ResolvedImport[] = [];
  const unresolved: UnresolvedImport[] = [];
  let imports = 0;
  let resolvedImports = 0;
  let externalImports = 0;
  let missingImports = 0;
  let namespaceImports = 0;
  let symbols = 0;
  for (const index of indices.values()) symbols += index.symbols.length;

  for (const [path, index] of indices) {
    const lines = index.lines;
    const codes = index.codes;
    for (let at = 0; at < lines.length; at += 1) {
      const statement = readStatement(lines, codes, at);
      if (statement === null) continue;
      imports += 1;
      at = statement.endLine - 1;

      if (!isRelative(statement.specifier)) {
        externalImports += 1;
        statements.push({
          fromPath: path,
          line: statement.startLine,
          specifier: statement.specifier,
          target: null,
          why: 'external',
        });
        unresolved.push({
          fromPath: path,
          line: statement.startLine,
          specifier: statement.specifier,
          why: 'external',
        });
        continue;
      }
      const target = resolveSpecifier(statement.specifier, path, byPath);
      if (target === null) {
        missingImports += 1;
        statements.push({
          fromPath: path,
          line: statement.startLine,
          specifier: statement.specifier,
          target: null,
          why: 'missing',
        });
        unresolved.push({
          fromPath: path,
          line: statement.startLine,
          specifier: statement.specifier,
          why: 'missing',
        });
        continue;
      }
      resolvedImports += 1;
      statements.push({
        fromPath: path,
        line: statement.startLine,
        specifier: statement.specifier,
        target,
        why: 'resolved',
      });
      if (statement.namespace) {
        namespaceImports += 1;
        continue;
      }

      const targetIndex = indices.get(target)!;
      for (const name of statement.names) {
        const declared = targetIndex.symbols.find((symbol) => symbol.name === name.imported);
        if (declared === undefined) continue;
        const used = firstUse(codes, name.local, statement.endLine);
        if (used === null) continue;
        references.push({ fromPath: path, fromLine: used, toPath: target, toName: name.imported });
      }
    }
  }

  references.sort((left, right) =>
    left.fromPath === right.fromPath
      ? left.fromLine - right.fromLine
      : left.fromPath < right.fromPath
        ? -1
        : 1,
  );

  return {
    files: indices,
    references,
    imports: statements,
    unresolved,
    stats: {
      files: indices.size,
      symbols,
      imports,
      resolvedImports,
      externalImports,
      missingImports,
      namespaceImports,
      edges: references.length,
    },
  };
}

/**
 * The first line after `after` that uses `name` as a word of **code**, or `null` when the file never does.
 *
 * **A mention inside a comment or a string is not a use**, and the test is the lexer's rather than a second opinion:
 * the masked line keeps code and blanks comments and string bodies, so `// helper still returns the stale value` and
 * `` `${helper}` `` are both invisible here while `const x = helper();` is not. **This is the one way an edge can be
 * wrong rather than missing**, and it is the reason the count is worth reporting at all.
 */
function firstUse(codes: readonly string[], name: string, after: number): number | null {
  for (let at = after; at < codes.length; at += 1) {
    const line = codes[at]!;
    if (!line.includes(name)) continue;
    if (wordsOf(line).includes(name)) return at + 1;
  }
  return null;
}

/**
 * **What a change to these names reaches**, which is the query a per-file index cannot answer and a review needs.
 *
 * **`unreachable` is reported and not omitted**, because it is half the answer: a name nothing outside its file reads
 * is a change that is contained, and a review that only heard the caller count would not know which half it was in.
 */
export function impactOf(index: RepoIndex, path: string, names: readonly string[]): ImpactSet {
  const wanted = new Set(names);
  const callers = index.references.filter((row) => row.toPath === path && wanted.has(row.toName));
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const row of callers) {
    if (seen.has(row.fromPath)) continue;
    seen.add(row.fromPath);
    paths.push(row.fromPath);
  }
  const reached = new Set(callers.map((row) => row.toName));
  return { callers, paths, unreachable: names.filter((name) => !reached.has(name)) };
}
