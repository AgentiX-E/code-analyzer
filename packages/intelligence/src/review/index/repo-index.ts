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
import {
  normalisePath,
  readCIncludes,
  readCommonJsRequires,
  readGoImports,
  readLanguageImports,
  readPackageName,
  readDocumentRefs,
  resolveCInclude,
  resolveDocumentRef,
  resolveGoPackage,
  resolveJvmSpecifier,
  resolvePythonSpecifier,
} from './imports-langs.js';
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
  readonly why: 'external' | 'missing' | 'ambiguous';
}

/**
 * **What the index needs to know that a file does not carry.**
 *
 * The one field is `goModule`, and it is here rather than derived because **an import path does not say where the module
 * ends**: `github.com/gin-gonic/gin/internal/bytesconv` is inside a repository when `go.mod` says the module is
 * `github.com/gin-gonic/gin`, and it is a dependency when the module is something else. A caller that does not read
 * `go.mod` gets every Go import answered `external` - **which is the honest answer, not a degraded one**, because a
 * suffix match would resolve `github.com/x/gin/main` inside any repository that happens to hold a `main/`.
 */
export interface RepoIndexOptions {
  /** The `module` line of the repository's `go.mod`, or `null` when there is none. */
  readonly goModule?: string | null;
  /**
   * **The modules a Swift package declares, and the directory each one's sources are in** - `Package.swift`'s targets,
   * resolved against the checkout by the caller that could see it.
   *
   * It is an option rather than a field of the text for the same reason `goModule` is: **a module name does not say
   * where the module is**, and a resolver that guessed `Alamofire.swift` for `import Alamofire` would invent an edge.
   * Absent, every Swift import is `external`, which is the answer §102 published and still the honest one.
   */
  readonly swiftModules?: ReadonlyMap<string, string> | null;
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
  /**
   * **A quoted `#include` that two files answer**, counted apart from a missing one because it is not a defect in the
   * repository: a vendored copy at the root and the copy under `tests/` is a real shape, and a resolver that picked one
   * would be reporting a guess as a resolution.
   */
  readonly ambiguousImports: number;
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
  readonly why: 'resolved' | 'package' | 'external' | 'missing' | 'ambiguous';
}

/**
 * **A wildcard import names a package, and a package that this repository declares is a resolution even though no file
 * crosses.** `import kotlinx.coroutines.*` is 82 % of `kotlinx.coroutines`' 4 302 imports (3 548 of them), and answering
 * every one `external` said the repository was importing somebody else's code when it was importing its own - **a rate
 * that describes the shape of the imports rather than the coverage of the index**.
 */

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
const CANDIDATE_SUFFIXES = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  // **`.ets` is ArkTS's, and it is in this list because the import that names it is TypeScript's.** HarmonyOS writes
  // `import { X } from '../model/Counter'` in a `.ets` file, and a candidate list without this entry answered every
  // such import as `missing` - the whole edge layer of an ArkTS application, absent.
  '.ets',
] as const;

/** The extensions that are a compiled artefact of one of the above, and are answered by their source. */
const COMPILED = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/** `path` with `.` and `..` resolved, and no leading `./`. */

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
 * it is per import rather than per line. It is bounded instead by a per-file word index, which is why the two readers
 * that need to ask "which name does this file use" of every declaration in a *package* or a *header* can do so at all.
 */
export function buildRepoIndex(
  files: readonly RepoFile[],
  options: RepoIndexOptions = {},
): RepoIndex {
  const byPath = new Map<string, RepoFile>();
  for (const file of files) byPath.set(normalisePath(file.path), file);

  const indices = new Map<string, FileSymbolIndex>();
  for (const [path, file] of byPath) indices.set(path, buildSymbolIndex(path, file.text));

  /**
   * **The basenames the corpus holds, because a JVM import is a suffix and a suffix search needs an index.**
   * `import a.b.C;` names `a/b/C.java` wherever the source root is, so the question is which of this corpus's paths end
   * with that tail - and asking it of every path for every import would be the quadratic scan this file avoids
   * everywhere else. Keyed by `C.java`, only the files called that are ever compared.
   */
  const byBase = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const bucket = byBase.get(base);
    if (bucket === undefined) byBase.set(base, [path]);
    else bucket.push(path);
  }

  /** The three languages whose imports are answered by a package declaration as well as by a path. */
  const JVM_LANGUAGES = new Set(['java', 'kotlin', 'groovy']);

  /**
   * **The JVM classes this repository declares, keyed the way the compiler keys them**: `package.name` from the file's
   * own `package` statement and its own file name. §102 measured `Kotlin/kotlinx.coroutines` at **4 421 import
   * statements and 2 resolved** under the path-suffix rule, because a multiplatform source tree is not laid out as its
   * packages - this index is the fact that answers it.
   */
  const packages = new Map<string, string[]>();
  /** The package names this repository declares, which is the only thing a wildcard import can be answered with. */
  const packageNames = new Set<string>();
  for (const [path, index] of indices) {
    if (!JVM_LANGUAGES.has(index.language)) continue;
    const declared = readPackageName(index.language, index.lines, index.codes);
    if (declared === null) continue;
    packageNames.add(declared);
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '');
    /**
     * **Two keys, because Kotlin imports a name and not a file.** `import kotlinx.coroutines.launch` names a top-level
     * `fun` declared in `Builders.kt`, so a key built from the file name misses it - **and 4 383 of
     * `kotlinx.coroutines`' 4 421 imports were still external after the file-name key was added.** A declaration is the
     * other key, and a name declared in two files of one package answers with the first path in sorted order rather than
     * with nothing.
     */
    for (const name of [base, ...index.symbols.map((symbol) => symbol.name)]) {
      const key = `${declared}.${name}`;
      const bucket = packages.get(key);
      if (bucket === undefined) packages.set(key, [path]);
      else if (!bucket.includes(path)) bucket.push(path);
    }
  }

  const references: CrossReference[] = [];
  const statements: ResolvedImport[] = [];
  const unresolved: UnresolvedImport[] = [];
  let imports = 0;
  let resolvedImports = 0;
  let externalImports = 0;
  let missingImports = 0;
  let ambiguousImports = 0;
  let namespaceImports = 0;
  let symbols = 0;
  for (const index of indices.values()) symbols += index.symbols.length;

  const fileSet = new Set(byPath.keys());
  /**
   * **The languages whose import syntax is not TypeScript's** - and Swift is not one of them any more: a module is
   * answered by a target, which is a directory rather than a file, so it has its own branch below.
   */
  const SIBLING = new Set(['java', 'kotlin', 'groovy', 'python']);
  /** **Where a Go import's module path ends**, which is the one thing `go.mod` says that an import cannot. */
  const goModule = options.goModule ?? null;
  /** **Where each Swift module's sources are**, which is the one thing `Package.swift` says that an import cannot. */
  const swiftModules = options.swiftModules ?? null;
  /** The document languages, whose only edge is a reference to another document. */
  const DOCUMENT = new Set(['xml', 'json', 'yaml']);

  /**
   * **One bookkeeping path for every reader**, because two paths that each counted an import would be two denominators
   * the moment either drifted. `targets === null` is decided by the caller - **a JVM path that is not in this repository
   * is a library and a Python statement with no leading dot is one too, while `from .mod import x` that resolves to
   * nothing is a path this repository does not hold** - and the refusal is reported rather than dropped.
   *
   * `namesFrom` is the third thing a reader can differ about, and it is not a detail: **TypeScript's statement carries
   * the names it imports, a C `#include` carries none and the names that cross are the ones the header declares and the
   * importer uses, and a Go `import "a/b"` carries none and the names that cross are spelled `pkg.Name` at the use
   * site.** Three languages, three places the name list comes from, one place it is turned into an edge.
   */
  const record = (
    path: string,
    statement: {
      specifier: string;
      names: readonly { imported: string; local: string }[];
      namespace: boolean;
      startLine: number;
      endLine: number;
      alias?: string;
    },
    targets: readonly string[] | null,
    why: 'missing' | 'external' | 'ambiguous' | 'package',
    namesFrom: 'statement' | 'target' | 'package' = 'statement',
    /** Whether only the declarations the language exports can cross - true for a module, false for a header. */
    onlyExported = false,
  ): void => {
    imports += 1;
    /**
     * **A wildcard import of a package this repository declares is a resolution with no file behind it.** Nothing
     * crosses - the names are spelled unqualified - so there is no edge, and the statement is not a miss either:
     * `external` would say the package is somebody else's, which is the one thing the index can refute.
     */
    if (why === 'package') {
      resolvedImports += 1;
      namespaceImports += 1;
      statements.push({
        fromPath: path,
        line: statement.startLine,
        specifier: statement.specifier,
        target: null,
        why: 'package',
      });
      return;
    }
    if (targets === null || targets.length === 0) {
      if (why === 'missing') missingImports += 1;
      else if (why === 'ambiguous') ambiguousImports += 1;
      else externalImports += 1;
      statements.push({
        fromPath: path,
        line: statement.startLine,
        specifier: statement.specifier,
        target: null,
        why,
      });
      unresolved.push({
        fromPath: path,
        line: statement.startLine,
        specifier: statement.specifier,
        why,
      });
      return;
    }
    resolvedImports += 1;
    statements.push({
      fromPath: path,
      line: statement.startLine,
      specifier: statement.specifier,
      target: targets[0]!,
      why: 'resolved',
    });

    /**
     * **A `#include` pastes a file**, so the names that cross are the declarations the header makes that the importer
     * then uses - and a header that declares forty functions and is included by a file that calls one of them is an edge
     * for that one and none for the other thirty-nine.
     *
     * **A name the importer also declares is not a name it reads from the header**, and this is the one filter the
     * measurement forced: `tests/unity` declares `setUp` and `tearDown` in every one of its thirty test files and
     * `unity.h` declares them once, so a raw word match credited thirty edges to a header nobody read those names from.
     * C's own rule says the same thing - the file's definition shadows the header's declaration, and **a definition is
     * not a read**.
     */
    if (namesFrom === 'target') {
      const own = new Set(indices.get(path)!.symbols.map((symbol) => symbol.name));
      // **Keyed by the target list and not by its directory**, because two headers in one directory are two different
      // sets of names and a cache keyed by the directory answered the second with the first's - which cost `jq` 636 of
      // its 728 edges the first time this was written.
      const byName = namesOfTarget(targets.join('\u0000'), targets, onlyExported);
      /**
       * **The importer's vocabulary is walked once rather than the target's declarations once per name.** A Swift target
       * is a hundred files and a header is forty declarations, so the first version asked *is `name` used here* of every
       * declaration in the module - and `Alamofire`, whose tests import a hundred-file target, took **4 959 ms** to index
       * 140 files while every other corpus in the table took under 300. **The inversion is the same answer for a
       * hundredth of the work**: the words a file writes are already indexed, and the question becomes a lookup.
       */
      for (const [name, at] of wordLinesOf(path)) {
        if (own.has(name)) continue;
        const to = byName.get(name);
        if (to === undefined) continue;
        const used = firstAtOrAfter(at, statement.endLine);
        if (used === null) continue;
        references.push({ fromPath: path, fromLine: used, toPath: to, toName: name });
      }
      return;
    }

    /**
     * **A Go import binds a package identifier, and Go's own rule makes the crossing decidable**: a file's package
     * identifiers are unique bindings, so `bytesconv.StringToBytes` in a file that imported `bytesconv` is a call into
     * that package and cannot be anything else. That is why this is a resolution rather than the guess `ns.helper`
     * would be in JavaScript, where `ns` could be any object in scope.
     *
     * **Only exported names**, because Go's compiler says the same: a lowercase name belongs to its package and no file
     * outside it can spell it.
     */
    if (namesFrom === 'package') {
      const bound =
        statement.alias === undefined || statement.alias.length === 0
          ? lastSegmentOf(statement.specifier)
          : statement.alias;
      // **`_` binds nothing and `.` binds everything**, and neither names a package a use site can spell.
      if (bound === '_' || bound === '.' || bound.length === 0) return;
      const uses = dottedUsesOf(path);
      for (const target of targets) {
        for (const symbol of indices.get(target)!.symbols) {
          if (!/^[A-Z]/u.test(symbol.name)) continue;
          const at = uses.get(`${bound}.${symbol.name}`);
          if (at === undefined) continue;
          references.push({
            fromPath: path,
            fromLine: at + 1,
            toPath: target,
            toName: symbol.name,
          });
        }
      }
      return;
    }

    if (statement.namespace) {
      namespaceImports += 1;
      return;
    }
    for (const name of statement.names) {
      for (const target of targets) {
        const declared = indices
          .get(target)!
          .symbols.find((symbol) => symbol.name === name.imported);
        if (declared === undefined) continue;
        const used = firstUse(path, name.local, statement.endLine);
        if (used === null) continue;
        references.push({ fromPath: path, fromLine: used, toPath: target, toName: name.imported });
        // **A name is declared in one file of a package**, so the first target that holds it is the only one.
        break;
      }
    }
  };

  const codesOf = (path: string): readonly string[] => indices.get(path)!.codes;

  /**
   * **The words each file writes and the line each of them first appears on**, built once per file.
   *
   * `firstUse` used to scan the file for every name, and that was affordable while the names came from a statement: an
   * `import { a, b }` asks twice. **A `#include` asks once per declaration in the header** - forty for `cJSON.h` - and a
   * Go import asks once per exported name in the package. **Forty scans of three thousand lines is the quadratic pass
   * this file refuses everywhere else**, so the scan happens once and the question becomes a binary search.
   */
  const wordLines = new Map<string, Map<string, number[]>>();
  const wordLinesOf = (path: string): Map<string, number[]> => {
    const cached = wordLines.get(path);
    if (cached !== undefined) return cached;
    const built = new Map<string, number[]>();
    const codes = codesOf(path);
    for (let at = 0; at < codes.length; at += 1) {
      for (const word of wordsOf(codes[at]!)) {
        const bucket = built.get(word);
        if (bucket === undefined) built.set(word, [at]);
        else if (bucket[bucket.length - 1] !== at) bucket.push(at);
      }
    }
    wordLines.set(path, built);
    return built;
  };

  /** **The `pkg.Name` pairs a file writes**, which is the only form a Go use takes across a package boundary. */
  const dottedUse = new Map<string, Map<string, number>>();
  const dottedUsesOf = (path: string): Map<string, number> => {
    const cached = dottedUse.get(path);
    if (cached !== undefined) return cached;
    const built = new Map<string, number>();
    const codes = codesOf(path);
    for (let at = 0; at < codes.length; at += 1) {
      for (const match of codes[at]!.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/gu)) {
        const key = `${match[1]!}.${match[2]!}`;
        if (!built.has(key)) built.set(key, at);
      }
    }
    dottedUse.set(path, built);
    return built;
  };

  /**
   * **The declarations of one target or header, keyed by name**, built once per directory.
   *
   * Two files in one target can declare the same name - `RequestInterceptor` is a protocol in its own file and an
   * `extension` in four others - and **the first file in sorted order is the answer**, because a name is declared once and
   * extended afterwards.
   */
  const targetNames = new Map<string, Map<string, string>>();
  const namesOfTarget = (
    key: string,
    targets: readonly string[],
    onlyExported: boolean,
  ): Map<string, string> => {
    const cached = targetNames.get(key);
    if (cached !== undefined) return cached;
    const built = new Map<string, string>();
    for (const target of targets) {
      for (const symbol of indices.get(target)!.symbols) {
        /**
         * **A Swift module offers what it marks `public` or `open`, and nothing else** - that is Swift's own rule, and
         * the scanner already encodes it. Without it the name set of a target is every `extension URLRequest { … }`
         * header in it, so **`URLRequest` looked like a declaration of `HTTPHeaders.swift`** and a test that merely
         * mentioned `URLRequest` got an edge into a file that only adds methods to it.
         *
         * **A C header is the other way round**: a `static inline` helper in a `.h` is visible to every file that
         * includes it, so the C reader keeps the whole list.
         */
        if (onlyExported && !symbol.exported) continue;
        if (!built.has(symbol.name)) built.set(symbol.name, target);
      }
    }
    targetNames.set(key, built);
    return built;
  };

  /** The first line in `lines` that is at or after `after`, which is the same answer `firstUse` gives without the name. */
  const firstAtOrAfter = (lines: readonly number[], after: number): number | null => {
    let lo = 0;
    let hi = lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid]! < after) lo = mid + 1;
      else hi = mid;
    }
    return lo < lines.length ? lines[lo]! + 1 : null;
  };

  /** The first line after `after` that uses `name` as a word of code, or `null` when the file never does. */
  const firstUse = (path: string, name: string, after: number): number | null => {
    const at = wordLinesOf(path).get(name);
    if (at === undefined) return null;
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid]! < after) lo = mid + 1;
      else hi = mid;
    }
    return lo < at.length ? at[lo]! + 1 : null;
  };

  for (const [path, index] of indices) {
    const lines = index.lines;
    const codes = index.codes;

    /**
     * **Go's import is a package and C's include is a file**, and both were answered zero before this branch existed:
     * 375 of the 944 files `aacr-bench` scores are written in the two of them, and every one of those files had
     * declarations the index could name and no edge the index could follow.
     */
    if (index.language === 'go') {
      for (const statement of readGoImports(lines, codes)) {
        record(
          path,
          statement,
          resolveGoPackage(statement.specifier, goModule, fileSet),
          'external',
          'package',
        );
      }
      continue;
    }

    if (index.language === 'c') {
      for (const statement of readCIncludes(lines, codes)) {
        // **An angled include names a system header**, and a path invented for `stdio.h` would be an edge invented for it.
        if (statement.kind === 'module') {
          record(path, statement, null, 'external');
          continue;
        }
        const resolution = resolveCInclude(statement.specifier, path, fileSet);
        record(
          path,
          statement,
          resolution.target === null ? null : [resolution.target],
          // **A refusal is reported as what it was**, and the `resolved` arm is the one this field never reads.
          resolution.why === 'ambiguous' ? 'ambiguous' : 'missing',
          'target',
        );
      }
      continue;
    }

    /**
     * **A schema's `$ref` and an XSD's `schemaLocation` are the only edges a document corpus has**, and every one of them
     * was answered zero: a `.json` was a file that declared its keys and reached nothing. The statement is a namespace -
     * **a file crosses and no name does** - so the resolution lands in `imports` and makes no symbol edge.
     */
    if (DOCUMENT.has(index.language)) {
      for (const statement of readDocumentRefs(index.language, lines)) {
        if (statement.kind === 'module') {
          record(path, statement, null, 'external');
          continue;
        }
        const target = resolveDocumentRef(statement.specifier, path, fileSet);
        record(path, statement, single(target), 'missing');
      }
      continue;
    }

    /**
     * **A Swift module is a target, and the target is a directory** (§103). `import Alamofire` in a test target is an
     * edge into the library it tests, and the names that cross are the ones the importer spells unqualified - the same
     * shape a `#include` has, because Swift and C both bring a whole module into scope rather than a name list.
     */
    if (index.language === 'swift') {
      for (const statement of readLanguageImports('swift', lines, codes)) {
        // `import struct Dispatch.DispatchTime` names a declaration inside a module, so the module is the first segment.
        const module = statement.specifier.split('.')[0]!;
        const directory = swiftModules?.get(module) ?? null;
        const targets =
          directory === null
            ? null
            : [...fileSet]
                .filter((candidate) => candidate.startsWith(`${directory}/`))
                .filter((candidate) => candidate.endsWith('.swift'))
                .sort();
        if (targets === null || targets.length === 0) {
          // **Without a manifest, or for a module this package does not declare**, the refusal is the fact.
          record(path, statement, null, 'external');
          continue;
        }
        record(path, statement, targets, 'external', 'target', true);
      }
      continue;
    }

    if (SIBLING.has(index.language)) {
      for (const statement of readLanguageImports(index.language, lines, codes)) {
        if (index.language === 'python') {
          const target = resolvePythonSpecifier(statement.specifier, path, fileSet);
          // **The leading dot is what makes an unresolved Python import a missing path** rather than a library: `os` is
          // on `sys.path` and `..nowhere` is a mistake in this repository.
          record(
            path,
            statement,
            target === null ? null : [target],
            statement.specifier.startsWith('.') ? 'missing' : 'external',
          );
          continue;
        }
        record(
          path,
          statement,
          single(resolveJvmSpecifier(index.language, statement.specifier, byBase, packages)),
          // **A wildcard that names a package of this repository is not a dependency**, and the two answers are one line
          // apart because the difference is one fact the repository holds.
          statement.namespace && packageNames.has(statement.specifier) ? 'package' : 'external',
        );
      }
      continue;
    }

    /**
     * **A `.js` file uses two import forms and the corpus does not say which**: `require('./m')` and
     * `import … from './m'` are both legal in the same file, so both readers run and the statement lists are
     * concatenated in source order. **`require` is deliberately not read for `.ts`** - §95.1 judges that language's
     * relative specifiers against `ts.resolveModuleName`, which resolves `import` declarations and not `require`
     * calls, and adding specifiers the judge does not see would lower the agreement that measurement exists to keep.
     */
    if (index.language === 'javascript') {
      for (const statement of readCommonJsRequires(lines, codes)) {
        // **A bare specifier is a package and a relative one is a path**, which is the rule the ESM path already states:
        // `require('node:fs')` is a dependency and `require('./nowhere')` is a bug in this repository, and reporting the
        // first as `missing` would attribute a defect to a repository over its own dependencies. The first run did
        // exactly that, and a test asserting `externalImports` found it.
        const relative = isRelative(statement.specifier);
        const target = relative ? resolveSpecifier(statement.specifier, path, byPath) : null;
        record(path, statement, single(target), relative ? 'missing' : 'external');
      }
    }

    for (let at = 0; at < lines.length; at += 1) {
      const statement = readStatement(lines, codes, at);
      if (statement === null) continue;
      at = statement.endLine - 1;
      if (!isRelative(statement.specifier)) {
        record(path, statement, null, 'external');
        continue;
      }
      record(
        path,
        statement,
        single(resolveSpecifier(statement.specifier, path, byPath)),
        'missing',
      );
    }
  }

  /**
   * **One edge per (file, file, name), and the duplicate was a real count rather than a rounding error.** A Swift target
   * answers an import with several files, and a name can be declared in more than one of them - `RequestInterceptor` is a
   * protocol in its own file and an `extension` in four others - so the package path pushed the same edge once per
   * declaration and `Alamofire` filed 1 440 edges for 183 imports. **The extension file really does depend on the
   * protocol**, so the edges stay; the same traversal reaching the same pair twice is what goes.
   */
  const unique: CrossReference[] = [];
  const seenEdges = new Set<string>();
  for (const reference of references) {
    const key = `${reference.fromPath}\u0000${reference.toPath}\u0000${reference.toName}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    unique.push(reference);
  }
  references.length = 0;
  references.push(...unique);

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
      ambiguousImports,
      namespaceImports,
      edges: references.length,
    },
  };
}

/** The last segment of a dotted or slashed path, which is the identifier Go binds a package to by default. */
function lastSegmentOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('.'));
  return at < 0 ? path : path.slice(at + 1);
}

/**
 * **One file, or no files**, which is the shape every reader but Go's produces.
 *
 * Go resolves to a package, which is several files, and the bookkeeping takes a list for that reason. **The four readers
 * that answer with a single path say so here rather than each writing their own ternary**, because four spellings of
 * "null or one" is how two of them end up disagreeing about which one `null` is.
 */
function single(target: string | null): readonly string[] | null {
  return target === null ? null : [target];
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
