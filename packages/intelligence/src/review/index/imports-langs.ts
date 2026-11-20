/**
 * **A comment on line 42 of a Java file cannot be checked against anything this index knows**, because until now the edge
 * layer read TypeScript's `import … from './b.js'` and nothing else. §95.1 measured that layer at 1.000 agreement with
 * `ts.resolveModuleName` and stated the gap in the same paragraph: *Java's `import a.b.C;`, Python's `from .mod import
 * x`, Go's import block and Kotlin's and Swift's imports are not read at all.* **This file reads five of them.**
 *
 * **Three of the five name a file, one names a package, and one names neither.** That is the whole design, and it is why
 * the resolver is a second function rather than a branch:
 *
 * - **Java, Kotlin and Groovy** write `import a.b.C;` and the dots *are* the path - `a/b/C.java` - which is a resolution
 *   rule a repository can check without a classpath;
 * - **Python** writes `from .mod import x` and the leading dots are the directory the importing file sits in, which is
 *   the one place a specifier's meaning depends on the *importer* rather than on the names it spells;
 * - **Swift's `import Foundation` names a module**, not a file, and **a resolver that guessed a path for it would invent
 *   an edge** - so it is answered `external` and the refusal is the fact.
 *
 * **What this file may not do.** It reads statements, not scopes: it does not know that `a.b.C` is a class rather than a
 * package, and it does not follow `Wildcard` imports to the names behind them - the same three refusals `repo-index.ts`
 * already states, applied to five more languages. **A wildcard makes no edge for the reason a namespace import makes
 * none**: it says nothing about which name crosses.
 */

/** One import statement as the file wrote it, before any resolution. */
export interface LanguageImportStatement {
  /** The module or path the statement names, exactly as the language spells it, with the dots it wrote. */
  readonly specifier: string;
  /** The names the statement brings into scope, with the name each is referred to by locally. */
  readonly names: readonly { readonly imported: string; readonly local: string }[];
  /** Whether the statement brings a namespace or a wildcard rather than a list of names. */
  readonly namespace: boolean;
  readonly startLine: number;
  readonly endLine: number;
  /** Whether the specifier names a file in this repository, or a package that is not one. */
  readonly kind: 'file' | 'module';
  /**
   * **The name the statement binds the package to, where the language has such a name and spells it** - Go's
   * `bytesconv "a/b"`, and nothing else in this file. Absent means the language's default binding applies, which for Go
   * is the last segment of the path.
   */
  readonly alias?: string;
}

/** The languages this reader answers, which are the ones whose import syntax is not TypeScript's. */
const JVM = new Set(['java', 'kotlin', 'groovy']);

/** `import static a.b.C.m;`, `import a.b.C as D`, `import a.b.*` - one statement, three spellings, one reader. */
const JVM_IMPORT =
  /^\s*import\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*(?:[A-Za-z_$][\w$]*|\*))*)\s*(?:as\s+([A-Za-z_$][\w$]*))?\s*;?/u;

/**
 * `import Foundation`, and Swift's five `import struct Dispatch.DispatchTime` forms.
 *
 * **The dotted run is part of the specifier**, because the stated form names a declaration inside a module: reading only
 * `Dispatch` would answer "this file imports the Dispatch module" when it imports one type from it - **a fact a review
 * would then repeat wrongly**, and the shape the first measurement caught.
 */
const SWIFT_IMPORT =
  /^\s*import\s+(?:(?:class|struct|enum|protocol|func|var|let|typealias)\s+)?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/u;

/** `import a.b, c as d` - the comma list Python allows and the other four do not. */
const PY_IMPORT = /^\s*import\s+(.+?)\s*;?\s*$/u;

/** `from .pkg.mod import (a, b as c)`, where the leading dots belong to the importer rather than to the module. */
const PY_FROM = /^\s*from\s+([.\w]+)\s+import\s+(.+?)\s*;?\s*$/u;

/** The names a `from … import (…)` list carries, once the parentheses and the line breaks are gone. */
function pyNames(list: string): { names: LanguageImportStatement['names']; namespace: boolean } {
  const cleaned = list.replace(/[()]/gu, ' ').replace(/\\\s*$/u, ' ');
  if (cleaned.trim() === '*') return { names: [], namespace: true };
  const names = cleaned
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const [imported = '', local] = piece.split(/\s+as\s+/u);
      return { imported: imported.trim(), local: (local ?? imported).trim() };
    })
    .filter((name) => name.imported.length > 0);
  return { names, namespace: false };
}

/** The last segment of a dotted path, which is the name a JVM import brings into scope. */
function lastSegment(dotted: string): string {
  const parts = dotted.split('.');
  return parts[parts.length - 1]!;
}

/**
 * **Every import statement in one file, in source order.**
 *
 * `codes` is the lexer's masked text and it is read rather than `lines`, for the reason §95.1 found the hard way: **a
 * benchmark fixture holds `import { Database } from './database';` inside a template literal**, and a reader of imports
 * that could not tell code from text reported it as the only unresolved import in a repository whose imports all
 * resolve. **A JVM import in a string is the same defect in five more languages.**
 *
 * The continuation join is bounded at eight lines, which is the same bound `repo-index.ts` uses - a bound rather than a
 * guess, because a file full of text must not cost a quadratic scan.
 */
export function readLanguageImports(
  language: string,
  lines: readonly string[],
  codes: readonly string[],
): LanguageImportStatement[] {
  const out: LanguageImportStatement[] = [];
  const isJvm = JVM.has(language);
  const isPython = language === 'python';
  const isSwift = language === 'swift';
  if (!isJvm && !isPython && !isSwift) return out;

  for (let at = 0; at < lines.length; at += 1) {
    // **A statement starts on a line of code**, and this is the line that keeps a fixture from becoming an import.
    if (codes[at]!.trim().length === 0) continue;
    const line = lines[at]!;

    if (isJvm) {
      const match = JVM_IMPORT.exec(line);
      if (match === null) continue;
      const dotted = match[1]!.replace(/\s+/gu, '');
      const wildcard = dotted.endsWith('.*');
      const isStatic = /^\s*import\s+static\b/u.test(line);
      /**
       * **A static import names a member of a type**, so the type is the module and the member is the name:
       * `import static a.b.C.m;` is an edge to `a/b/C.java` carrying `m`, and a reader that kept the whole run would
       * look for a file called `m`. **The trailing segment is the declaration and everything before it is the file**, and
       * the first version got it wrong in the direction that looks right - the specifier was a path that resolved to
       * nothing.
       */
      const body = wildcard ? dotted.slice(0, -2) : dotted;
      const specifier = isStatic ? body.slice(0, body.lastIndexOf('.')) : body;
      const member = isStatic ? body.slice(body.lastIndexOf('.') + 1) : lastSegment(body);
      out.push({
        specifier,
        names: wildcard ? [] : [{ imported: member, local: match[2] ?? member }],
        namespace: wildcard,
        startLine: at + 1,
        endLine: at + 1,
        kind: 'file',
      });
      continue;
    }

    if (isSwift) {
      const match = SWIFT_IMPORT.exec(line);
      if (match === null) continue;
      // **A module is not a file**, so the statement is recorded and the resolver refuses it below.
      out.push({
        specifier: match[1]!,
        names: [],
        namespace: false,
        startLine: at + 1,
        endLine: at + 1,
        kind: 'module',
      });
      continue;
    }

    // Python: two forms, and the second may span lines.
    const from = PY_FROM.exec(line);
    if (from !== null) {
      let list = from[2]!;
      let end = at;
      while ((list.includes('(') && !list.includes(')')) || /,\s*$/u.test(list)) {
        if (end >= Math.min(lines.length - 1, at + 7)) break;
        end += 1;
        list = `${list} ${codes[end]!.trim()}`;
      }
      const { names, namespace } = pyNames(list);
      out.push({
        specifier: from[1]!,
        names,
        namespace,
        startLine: at + 1,
        endLine: end + 1,
        kind: 'file',
      });
      at = end;
      continue;
    }

    const plain = PY_IMPORT.exec(line);
    if (plain === null) continue;
    let list = plain[1]!;
    let end = at;
    while (/\\\s*$/u.test(list) || (/\(/u.test(list) && !/\)/u.test(list))) {
      if (end >= Math.min(lines.length - 1, at + 7)) break;
      end += 1;
      list = `${list} ${codes[end]!.trim()}`;
    }
    for (const piece of list.replace(/[()\\]/gu, ' ').split(',')) {
      const [module = '', local] = piece.split(/\s+as\s+/u);
      const specifier = module.trim();
      if (specifier.length === 0 || specifier === '*') continue;
      out.push({
        specifier,
        names: [
          { imported: lastSegment(specifier), local: (local ?? lastSegment(specifier)).trim() },
        ],
        namespace: false,
        startLine: at + 1,
        endLine: end + 1,
        kind: 'file',
      });
    }
    at = end;
  }

  return out;
}

/** `require('./m')` - the one import form JavaScript has that TypeScript's reader cannot see. */
const CJS_REQUIRE = /require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu;

/** `const { a, b: c } = require('./m')`, which names what crosses where a bare call names nothing. */
const CJS_DESTRUCTURE =
  /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*(['"])([^'"\n]+)\2\s*\)/gu;

/**
 * **Every `require()` call in one file, in source order - the edges a CommonJS repository actually has.**
 *
 * §97.3 stated the refusal this function removes: *JavaScript's `require()` is not read, so every CJS edge is missing.*
 * A `.js` file that imports its neighbours with `require` looked, to this index, exactly like a file with no imports at
 * all, and `impactOf` answered *nobody calls this* for a helper that three files require.
 *
 * **The mask decides whether a call is code, and the unmasked line decides what it names.** `codes[at]` has comments
 * and string literals replaced by blanks, so a `require('./x')` inside a comment or inside a string is not a call - the
 * defect §95.1 found in `benchmark-fixtures.ts`, which this file inherits rather than re-learns. The specifier itself
 * is blanked by that same mask, so it is read from `lines[at]` at the offset the mask located - **bookkeeping on masked
 * text, literals from source**, and the two are never mixed.
 *
 * **A bare call is a namespace and a destructuring pattern is a name list**, which is the distinction the ESM reader
 * already draws between `import * as m` and `import { a }`. `const m = require('./m')` says nothing about which names
 * cross, so it makes a statement of `kind: 'namespace'` and no edge - following `m.a` afterwards would be scope
 * analysis, and a name inferred from a property access is a guess this layer does not make.
 */
export function readCommonJsRequires(
  lines: readonly string[],
  codes: readonly string[],
): LanguageImportStatement[] {
  const out: LanguageImportStatement[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const masked = codes[at]!;
    if (masked.trim().length === 0) continue;
    const line = lines[at]!;

    /** The names each `require` on this line is bound to, keyed by the specifier it was called with. */
    const destructured = new Map<string, { imported: string; local: string }[]>();
    for (const match of line.matchAll(CJS_DESTRUCTURE)) {
      destructured.set(
        match[3]!,
        match[1]!
          .split(',')
          .map((piece) => piece.trim())
          .filter((piece) => piece.length > 0)
          .map((piece) => {
            const [imported = '', local] = piece.split(/\s+as\s+|\s*:\s*/u);
            return { imported: imported.trim(), local: (local ?? imported).trim() };
          })
          .filter((name) => name.imported.length > 0),
      );
    }

    for (const match of line.matchAll(CJS_REQUIRE)) {
      const start = match.index ?? 0;
      // **Whether this is code is decided on the mask at the same offset**, which is the only reading that keeps a
      // `require` inside a string from becoming an edge.
      if (masked.slice(start, start + 'require'.length) !== 'require') continue;
      const specifier = match[2]!;
      const names = destructured.get(specifier) ?? [];
      out.push({
        specifier,
        names,
        namespace: names.length === 0,
        startLine: at + 1,
        endLine: at + 1,
        kind: 'file',
      });
    }
  }
  return out;
}

/** The extensions each family resolves a specifier to, in the order a resolver tries them. */
const FAMILY_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  groovy: ['.groovy', '.gradle'],
};

/** `package a.b`, which the three JVM languages write identically and always before the first declaration. */
const PACKAGE_DECLARATION = /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;?\s*$/u;

/** How far into a file a `package` statement can be: it precedes every declaration, and a bound keeps a file with none
 * from being scanned twice. */
const PACKAGE_SEARCH_LINES = 40;

/**
 * **The package a file declares, which is the key a JVM import is really written with.**
 *
 * §97 resolved `import a.b.C;` by matching the tail of a path, and that is right for a repository laid out as its
 * packages - `src/main/java/a/b/C.java`. **It is wrong for every Kotlin multiplatform project**:
 * `kotlinx-coroutines-core/common/src/flow/Flow.kt` declares `package kotlinx.coroutines.flow` and **no suffix of its
 * path is `kotlinx/coroutines/flow/Flow.kt`**. `Kotlin/kotlinx.coroutines` writes 4 421 import statements and 2 of them
 * resolved under the suffix rule; this is the fact that fixes it, and it is the compiler's own key rather than an
 * approximation of it.
 */
export function readPackageName(
  language: string,
  lines: readonly string[],
  codes: readonly string[],
): string | null {
  if (!JVM.has(language)) return null;
  const limit = Math.min(lines.length, PACKAGE_SEARCH_LINES);
  for (let at = 0; at < limit; at += 1) {
    // **A package statement is code**, so a commented-out one is not read; the same guard every reader here uses.
    if (codes[at]!.trim().length === 0) continue;
    const match = PACKAGE_DECLARATION.exec(lines[at]!);
    if (match !== null) return match[1]!;
  }
  return null;
}

/**
 * **The file a JVM specifier names, which is its dots written as slashes.**
 *
 * `import a.b.C;` names `a/b/C.java` **wherever the source root is**, and a repository's source root is not in the
 * statement - `src/main/java/a/b/C.java` and `a/b/C.java` are the same import. So the match is a **suffix** match against
 * the corpus, cheap because it is done over the basenames the corpus actually holds: `C.java` is one key, and only the
 * files under that key can end with the dotted path.
 */
export function resolveJvmSpecifier(
  language: string,
  specifier: string,
  filesByBase: ReadonlyMap<string, readonly string[]>,
  packages?: ReadonlyMap<string, readonly string[]>,
): string | null {
  /**
   * **The package declaration wins over the path suffix**, because it is the statement's own claim about itself and a
   * path is a convention. Two files called `Flow.kt` in two source sets is the shape a multiplatform project has by
   * construction, and the suffix rule refuses that pair while the package key answers it.
   */
  const declared = packages?.get(specifier);
  if (declared !== undefined && declared.length > 0) return [...declared].sort()[0]!;

  const extensions = FAMILY_EXTENSIONS[language] ?? [];
  const tail = specifier.replace(/\./gu, '/');
  const name = tail.slice(tail.lastIndexOf('/') + 1);
  for (const extension of extensions) {
    const base = `${name}${extension}`;
    for (const candidate of filesByBase.get(base) ?? []) {
      if (candidate === `${tail}${extension}` || candidate.endsWith(`/${tail}${extension}`)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * **The file a Python specifier names, which depends on who is importing.**
 *
 * `from .mod import x` in `pkg/a/b.py` means `pkg/a/mod.py`, and `from ..mod import x` means `pkg/mod.py` - **the leading
 * dots are steps up from the importing file's directory, one per dot after the first**, which is the only rule in this
 * file that cannot be evaluated from the specifier alone. A statement with no dots is an absolute import and is looked
 * up from the repository root, and one that is found there is a file; one that is not is a module on `sys.path` and is
 * refused rather than guessed.
 */
export function resolvePythonSpecifier(
  specifier: string,
  fromPath: string,
  files: ReadonlySet<string>,
): string | null {
  const dots = /^\.*/u.exec(specifier)?.[0].length ?? 0;
  const rest = specifier.slice(dots);
  if (dots === 0 && rest.length === 0) return null;

  const steps = dots === 0 ? 0 : dots - 1;
  const segments = dirOf(fromPath)
    .split('/')
    .filter((part) => part.length > 0);
  if (steps > segments.length) return null;
  const base = segments.slice(0, segments.length - steps).join('/');
  const relative = rest.replace(/\./gu, '/');
  const stem = relative.length === 0 ? base : base.length === 0 ? relative : `${base}/${relative}`;
  if (stem.length === 0) return null;

  const candidates = [`${stem}.py`, `${stem}/__init__.py`];
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return null;
}

/** The directory a repo-relative path sits in, or the empty string at the root. */
function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** `path` with `.` and `..` resolved, and no leading `./`. **Shared with `repo-index.ts` so two readers cannot disagree
 * about what a path is** - the C resolution below joins a directive to the includer's directory, which is the same
 * arithmetic the TypeScript one does. */
export function normalisePath(path: string): string {
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

/**
 * **Go's import, which is the one statement a `from`-shaped reader cannot find.** `import "a/b"` has no keyword after
 * the specifier, the specifier is the last thing on the line, and `gofmt` writes every group as a block:
 *
 * ```go
 * import (
 * 	"os"
 * 	bytesconv "github.com/gin-gonic/gin/internal/bytesconv"
 * 	_ "github.com/mattn/go-sqlite3"
 * 	. "math"
 * )
 * ```
 *
 * **Three aliases and three meanings**, and the resolver has to tell them apart: a name binds the package under that
 * name, `_` binds nothing and exists for its side effect, and `.` binds every exported name into the file's own scope.
 * The blank and dot forms are recorded and make no edge, because **a name nobody spelled is a name nobody can be told
 * crosses** - the same refusal `import * as ns` gets in TypeScript, for the same reason.
 */
const GO_IMPORT_LINE =
  /^\s*(?:import\s+)?(?:([A-Za-z_][\w]*|[._])\s+)?(["`])([^"`\n]+)\2\s*;?\s*$/u;

/** The two lines that open and close a group, which `gofmt` writes for every repository that imports more than one
 * package. */
const GO_BLOCK_OPEN = /^\s*import\s*\(\s*$/u;
const GO_BLOCK_CLOSE = /^\s*\)\s*$/u;

/**
 * **Every import statement in one Go file, in source order.**
 *
 * **The block's lines are strings and nothing else**, so the lexer masks them to blanks and a reader that required a word
 * of code on the line would read an empty block - the shape `gofmt` writes for every file that imports two packages.
 * The reading therefore runs on `lines` for the block and uses the mask only to decide whether a *single* statement is
 * code, which is the case a commented-out import is.
 */
export function readGoImports(
  lines: readonly string[],
  codes: readonly string[],
): LanguageImportStatement[] {
  const out: LanguageImportStatement[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (GO_BLOCK_OPEN.test(line) && codes[at]!.trim().length > 0) {
      for (let inner = at + 1; inner < lines.length; inner += 1) {
        const row = lines[inner]!;
        if (GO_BLOCK_CLOSE.test(row)) {
          at = inner;
          break;
        }
        const match = GO_IMPORT_LINE.exec(row);
        if (match === null) continue;
        out.push({
          specifier: match[3]!,
          names: [],
          namespace: true,
          startLine: inner + 1,
          endLine: inner + 1,
          kind: 'file',
          ...(match[1] === undefined ? {} : { alias: match[1] }),
        });
      }
      continue;
    }
    // **A statement starts on a line of code**, which is the same guard the TypeScript reader uses: `// import "x"` and
    // an `import "x"` inside a block comment are both masked to blanks and both must not become edges.
    if (codes[at]!.trim().length === 0) continue;
    const match = /^\s*import\s+(?:([A-Za-z_][\w]*|[._])\s+)?(["`])([^"`\n]+)\2\s*$/u.exec(line);
    if (match === null) continue;
    out.push({
      specifier: match[3]!,
      names: [],
      namespace: true,
      startLine: at + 1,
      endLine: at + 1,
      kind: 'file',
      ...(match[1] === undefined ? {} : { alias: match[1] }),
    });
  }
  return out;
}

/**
 * **The files of the package a Go import names, or `null` when the import names a dependency.**
 *
 * A Go import is a *module path plus a directory*, and the module path is in `go.mod`:
 * `github.com/gin-gonic/gin/internal/bytesconv` in the module `github.com/gin-gonic/gin` is the directory
 * `internal/bytesconv/`, and **a package is every `.go` file directly in it rather than one file** - which is why this
 * answer is a list and the JVM answer is a path.
 *
 * **Without `go.mod` the answer is `null` and not a suffix match**, and the difference is the whole of this function's
 * value: `github.com/x/gin/main` would suffix-match the `main/` of a repository that merely has one, and **a wrong edge
 * is worse than a missing one here**, because the consumer is a review deciding what a change reaches.
 */
export function resolveGoPackage(
  specifier: string,
  modulePath: string | null,
  files: ReadonlySet<string>,
): string[] | null {
  if (modulePath === null) return null;
  const inModule =
    specifier === modulePath
      ? ''
      : specifier.startsWith(`${modulePath}/`)
        ? specifier.slice(modulePath.length + 1)
        : null;
  if (inModule === null) return null;

  const prefix = inModule.length === 0 ? '' : `${inModule}/`;
  const out: string[] = [];
  for (const path of files) {
    if (!path.endsWith('.go')) continue;
    if (!path.startsWith(prefix)) continue;
    // **Directly in the directory**, because a package does not include its subdirectories.
    if (path.slice(prefix.length).includes('/')) continue;
    out.push(path);
  }
  out.sort();
  return out.length === 0 ? null : out;
}

/**
 * **C's `#include`, which is not an import but a paste**, and the only edge a C or C++ repository has.
 *
 * Two spellings and two meanings, and the difference is the language's own rule rather than a convention:
 * `#include "x.h"` **searches the including file's directory first**, and `#include <stdio.h>` searches the include path
 * and names a header that is not in this repository. The quoted form is a file and the angled form is `external`; a path
 * invented for `stdio.h` would be an edge invented for it.
 *
 * **The mask decides whether it is a directive**, the same guard every other reader uses: `/* #include "a.h" *\/` is
 * masked to blanks and is not a directive, and `#  include` with the extra spaces the standard allows is one.
 */
const C_INCLUDE = /^\s*#\s*include\s*([<"])([^>"\n]+)[>"]/u;

/** Every include directive in one C or C++ file, in source order. */
export function readCIncludes(
  lines: readonly string[],
  codes: readonly string[],
): LanguageImportStatement[] {
  const out: LanguageImportStatement[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (codes[at]!.trim().length === 0) continue;
    const match = C_INCLUDE.exec(lines[at]!);
    if (match === null) continue;
    out.push({
      specifier: match[2]!.trim(),
      names: [],
      namespace: true,
      startLine: at + 1,
      endLine: at + 1,
      // **The bracket is the whole resolution rule**, and it is the one fact the statement itself carries.
      kind: match[1] === '"' ? 'file' : 'module',
    });
  }
  return out;
}

/** What a C directive resolved to, and which refusal it was when it resolved to nothing. */
export interface CIncludeResolution {
  readonly target: string | null;
  readonly why: 'resolved' | 'missing' | 'ambiguous';
}

/**
 * **The file a quoted `#include` names**: the includer's own directory first, then a suffix match that must be unique.
 *
 * **The second chance is not a guess because of how it is bounded.** A C compiler is given `-I` flags that are not in
 * the statement, so `#include "unity/unity.h"` from `tests/all.c` is legal when `tests/` is on the include path - and
 * the only evidence a repository can check is **which paths end with the specifier**. One is an answer; **two is a
 * refusal**, because a vendored copy at the root and a copy under `tests/` is a real shape (`unity.h` is one), and
 * picking the shorter path would be a wrong edge in a review that then says a change reaches a file it does not.
 */
export function resolveCInclude(
  specifier: string,
  fromPath: string,
  files: ReadonlySet<string>,
): CIncludeResolution {
  const budget = normalisePath(`${dirOf(fromPath)}/${specifier}`);
  if (files.has(budget)) return { target: budget, why: 'resolved' };

  const matches: string[] = [];
  for (const path of files) {
    if (path === specifier || path.endsWith(`/${specifier}`)) matches.push(path);
  }
  if (matches.length === 1) return { target: matches[0]!, why: 'resolved' };
  if (matches.length === 0) return { target: null, why: 'missing' };
  return { target: null, why: 'ambiguous' };
}
