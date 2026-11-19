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

/** The extensions each family resolves a specifier to, in the order a resolver tries them. */
const FAMILY_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  groovy: ['.groovy', '.gradle'],
};

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
): string | null {
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
