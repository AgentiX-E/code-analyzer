/**
 * **The edge layer's first five languages, judged by a parser that is not this repository's lexer.**
 *
 * `repo-index.ts` grows a reader per language, and **a reader measured against the fixtures its author wrote is measured
 * against its author.** §95.1 answered this for TypeScript with `ts.resolveModuleName`, which is the compiler's own
 * resolver; **there is no compiler in this sandbox for Java, Kotlin, Groovy, Python or Swift**, so the judge here is one
 * level lower and that is stated rather than papered over: **tree-sitter says where an import statement is and what it
 * names; it does not say which file that is.** Resolution stays a rule this repository writes and a corpus that can
 * refuse it (a specifier that resolves to nothing is a `missing` row, counted).
 *
 * **The judged fact is the specifier list per file**, which is exactly the part a line-based lexer can get wrong: an
 * import wrapped over lines, an import inside a string, a `from .mod import (a,\n b)` that spans three lines, a `*`
 * wildcard, and a JVM `import static a.b.C.m` whose last segment is a member rather than a type.
 *
 * **Where the two implementations are allowed to differ, and where they are not.** The oracle reads Python's `from`
 * forms with the grammar's own node extents and takes the text between `from` and `import`; the reader in
 * `imports-langs.ts` does it with a regular expression over the masked line. **The comparison is therefore about
 * statements, not about style** - and a statement either side finds that the other misses is a defect in whichever is
 * wrong, which is the only useful thing a second implementation can say.
 *
 * Usage:
 *   npx tsx scripts/import-oracle.ts            # measure the corpus, write benchmarks/import-oracle.json
 *   npx tsx scripts/import-oracle.ts --check    # recompute and compare to the committed artifact
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';

import {
  readCommonJsRequires,
  readLanguageImports,
} from '../packages/intelligence/src/review/index/imports-langs.js';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = [
  'benchmarks/polyglot/files',
  'benchmarks/polyglot/hard',
  'benchmarks/polyglot/imports',
].map((dir) => join(ROOT, dir));
const OUT = join(ROOT, 'benchmarks/import-oracle.json');

/** The grammars this judge has, and where each one lives. */
const GRAMMAR: Record<string, { module: string; nested?: boolean }> = {
  java: { module: 'tree-sitter-java' },
  kotlin: { module: 'tree-sitter-kotlin' },
  python: { module: 'tree-sitter-python' },
  swift: { module: 'tree-sitter-swift' },
  groovy: { module: 'tree-sitter-groovy', nested: true },
  javascript: { module: 'tree-sitter-javascript' },
};

/** The extensions this measurement covers, which are the five languages the edge layer just learned. */
const LANGUAGE_OF: Record<string, string> = {
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.py': 'python',
  '.swift': 'swift',
  '.js': 'javascript',
};

interface Snapshot {
  language: string;
  file: string;
  ours: string[];
  theirs: string[];
}

/** The parser for one language, or `null` when this sandbox has no grammar for it. */
function parserFor(language: string): { parse: (text: string) => unknown } | null {
  const entry = GRAMMAR[language];
  if (entry === undefined) return null;
  const base = entry.nested
    ? `${ROOT}packages/analyzer/node_modules/${entry.module}`
    : entry.module;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Parser = require('tree-sitter') as new () => {
    setLanguage: (grammar: unknown) => void;
    parse: (text: string) => unknown;
  };
  const grammar = require(base) as unknown;
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser as unknown as { parse: (text: string) => unknown };
}

/**
 * **The specifier a node's own text names.**
 *
 * The rule is textual on purpose: **the grammar has already decided that this node is an import and where it begins and
 * ends**, and what remains is which run of characters inside it is the module. Doing that with a second grammar walk
 * would be a second parser rather than a second opinion.
 */
function specifiersOfText(text: string, language: string): string[] {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (language === 'javascript') {
    // **A `require` call names one specifier, and only when its argument is a string literal.** A template literal with
    // no substitutions is still a `template_string` node in this grammar and not a `string`, so it is refused here for
    // the same reason the reader refuses it: `require('./' + name)` is a call whose target is unknown at read time.
    const call = /^require\s*\(\s*(['"])([^'"\n]+)\1\s*\)$/u.exec(flat);
    return call === null ? [] : [call[2]!];
  }
  if (language === 'python') {
    const from = /^from\s+([.\w]+)\s+import\b/u.exec(flat);
    if (from !== null) return [from[1]!];
    // **A comma list is several imports**, and the grammar's node carries all of them: `import sys, json as js` is one
    // `import_statement` and two specifiers. The first run was the only one taken, which the fixtures reported as a
    // nine-to-eight disagreement and would have been read as the reader inventing an import.
    const plain = /^import\s+(.+)$/u.exec(flat);
    if (plain === null) return [];
    return plain[1]!
      .split(',')
      .map((piece) =>
        piece
          .trim()
          .split(/\s+as\s+/u)[0]!
          .trim(),
      )
      .filter((piece) => /^[.\w]+$/u.test(piece));
  }
  // **JVM and Swift**: drop the keyword, any of Swift's five modifiers, and Java's `static`.
  const stripped = flat
    .replace(/^import\s+/u, '')
    .replace(/^(?:static|class|struct|enum|protocol|func|var|let|typealias)\s+/u, '');
  const run = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\*)/u.exec(stripped);
  if (run === null) return [];
  if (run[1] === '*') return [];
  /**
   * **A static import's file is the type, not the member.** `import static a.b.C.m;` is an edge to `a/b/C.java` carrying
   * `m`, so both implementations have to answer `a.b.C` for the comparison to be about the import rather than about the
   * convention - **and the first run compared `a.b.C.m` with `a.b.C` and reported a disagreement that was really the
   * reader being right**.
   */
  if (/^import\s+static\b/u.test(flat)) {
    const body = run[1]!;
    const cut = body.lastIndexOf('.');
    return [cut < 0 ? body : body.slice(0, cut)];
  }
  return [run[1]!];
}

/** The node types that *are* an import statement in the five grammars, and none of the containers around them. */
const IMPORT_STATEMENT = /(?:^|_)import(?:_from)?_(?:declaration|header|statement)$/u;

/** Every import specifier the grammar finds in one file, one entry per statement. */
function oracleSpecifiers(language: string, text: string): string[] | null {
  const parser = parserFor(language);
  if (parser === null) return null;
  const tree = parser.parse(text) as { rootNode: Node };
  // **A walk rather than a node-type table**, because the five grammars spell the node five ways: `import_declaration`
  // in Java and Swift, `import_header` in Kotlin, `import_statement` and `import_from_statement` in Python, and the
  // Groovy grammar names its own. **A table would have had to be right about all five before the first measurement**,
  // which is the failure mode a second implementation exists to avoid.
  const out: string[] = [];
  const stack: Node[] = [tree.rootNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    /**
     * **The statement node, not any node whose type merely reads `import`.**
     *
     * Two readings were wrong in opposite directions, and both were caught by the measurement rather than by review:
     * the *keyword* `import` is a node of its own (Java read as four imports where it has two), and Kotlin wraps its
     * headers in an `import_list` (read as one import where it has seven). **A grammar names the statement
     * `import_declaration`, `import_header` or `import_statement`, and its container something else** - so the type is
     * the thing to match on, and the two failures are why a second implementation measures the oracle as well.
     */
    if (node.isNamed !== false && IMPORT_STATEMENT.test(node.type)) {
      out.push(...specifiersOfText(node.text, language));
    }
    /**
     * **CommonJS's import is a call and the grammar says so**, which is the second reason this walk is written over node
     * types rather than over lines: a `require` inside a string is a `string` node and never a `call_expression`, so the
     * judge refuses it by construction where the reader has to know it from the mask. **Two mechanisms, one fact** - if
     * they disagree, one of them is wrong, and that is what a judge is for.
     */
    if (language === 'javascript' && node.isNamed !== false && node.type === 'call_expression') {
      out.push(...specifiersOfText(node.text, language));
    }
    // **Children rather than `namedChildren`**: Python's `from .mod import (a)` puts the module in a named child but the
    // parentheses in anonymous ones, and a walker that skipped anonymous nodes would still be complete - so the cheaper
    // list is used and the visit order is made irrelevant by sorting the result.
    const children = node.children ?? [];
    for (let at = children.length - 1; at >= 0; at -= 1) stack.push(children[at]!);
  }
  return out;
}

/** The two fields of a tree-sitter node this file reads, and the children it descends through. */
interface Node {
  type: string;
  text: string;
  /** **Anonymous nodes carry the keyword itself**: the `import` token inside an `import_declaration` is a node too, and
   * counting it read every Java import twice - once as a statement and once as the word. */
  isNamed?: boolean;
  children?: Node[];
}

/** Each corpus file that this measurement covers, with the language its extension names. */
function corpus(): Array<{ path: string; language: string }> {
  const out: Array<{ path: string; language: string }> = [];
  for (const dir of CORPUS) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      const language = LANGUAGE_OF[extname(name)];
      if (language === undefined) continue;
      out.push({ path: join(dir, name), language });
    }
  }
  return out;
}

/**
 * **The same line with comments and string literals blanked, written here rather than imported.**
 *
 * `imports-langs.ts` decides whether a `require` is code by reading a mask, and **a judge reusing the subject's masker
 * would only be able to agree with it.** This one is a state machine over quotes, backticks and the two comment forms,
 * thirteen lines of it, and it exists to be wrong in a different way.
 */
function maskStringsAndComments(text: string): string[] {
  const out: string[] = [];
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  for (const raw of text.split('\n')) {
    let line = '';
    for (let at = 0; at < raw.length; at += 1) {
      const two = raw.slice(at, at + 2);
      const char = raw[at]!;
      if (state === 'code') {
        if (two === '//') state = 'line';
        else if (two === '/*') state = 'block';
        else if (char === "'") state = 'single';
        else if (char === '"') state = 'double';
        else if (char === '`') state = 'template';
        if (state === 'code') {
          line += char;
          continue;
        }
        line += ' ';
        if (two === '//' || two === '/*') at += 1;
        continue;
      }
      if (state === 'line' || (state === 'block' && two === '*/')) {
        if (two === '*/') {
          state = 'code';
          at += 1;
        }
        line += ' ';
        continue;
      }
      if (char === '\\') {
        line += '  ';
        at += 1;
        continue;
      }
      if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code';
      }
      line += ' ';
    }
    if (state === 'line') state = 'code';
    out.push(line);
  }
  return out;
}

function measure(): {
  rows: Snapshot[];
  byLanguage: Record<
    string,
    { files: number; ours: number; theirs: number; agree: number; unjudged: number }
  >;
} {
  const rows: Snapshot[] = [];
  for (const { path, language } of corpus()) {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    const theirs = oracleSpecifiers(language, text);
    if (theirs === null) continue;
    // **JavaScript is read by the CommonJS reader**, and the mask it needs is built here rather than borrowed from the
    // module under test: a judge that reuses its subject's lexer can only agree with it about strings.
    const ours =
      language === 'javascript'
        ? readCommonJsRequires(lines, maskStringsAndComments(text)).map(
            (statement) => statement.specifier,
          )
        : readLanguageImports(language, lines, lines).map((statement) => statement.specifier);
    rows.push({ language, file: path.slice(ROOT.length), ours, theirs });
  }

  const byLanguage: Record<
    string,
    { files: number; ours: number; theirs: number; agree: number; unjudged: number }
  > = {};
  for (const row of rows) {
    const bucket = (byLanguage[row.language] ??= {
      files: 0,
      ours: 0,
      theirs: 0,
      agree: 0,
      unjudged: 0,
    });
    bucket.files += 1;
    bucket.ours += row.ours.length;
    bucket.theirs += row.theirs.length;
    // **Multiset agreement**, because two imports of the same module are two statements: a set comparison would report
    // a duplicate as agreement it did not get.
    const remaining = new Map<string, number>();
    for (const value of row.theirs) remaining.set(value, (remaining.get(value) ?? 0) + 1);
    let common = 0;
    for (const value of row.ours) {
      const left = remaining.get(value) ?? 0;
      if (left === 0) continue;
      remaining.set(value, left - 1);
      common += 1;
    }
    bucket.agree += common;
  }
  return { rows, byLanguage };
}

function main(argv: string[]): number {
  const { rows, byLanguage } = measure();
  const artifact = {
    comment: [
      'What the five new import readers find beside what tree-sitter finds, per file, as multisets of specifiers.',
      'The judge establishes where an import statement is and what it names; it says nothing about which file a',
      'specifier resolves to, and that half of the claim is a corpus refusal (a specifier that resolves to nothing is a',
      'missing row, counted) rather than a comparison.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    corpus: CORPUS.map((dir) => dir.slice(ROOT.length)),
    byLanguage,
    disagreement: rows
      .filter(
        (row) => JSON.stringify([...row.ours].sort()) !== JSON.stringify([...row.theirs].sort()),
      )
      .map((row) => ({ file: row.file, ours: row.ours, theirs: row.theirs })),
    files: rows.length,
  };

  if (argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify(committed.byLanguage) !== JSON.stringify(artifact.byLanguage)) {
      process.stderr.write(
        'benchmarks/import-oracle.json no longer equals its corpus. Re-run without --check.\n',
      );
      return 1;
    }
    process.stdout.write('import-oracle.json agrees with the corpus.\n');
    return 0;
  }

  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  for (const [language, bucket] of Object.entries(byLanguage)) {
    process.stdout.write(
      `${language.padEnd(8)} files ${String(bucket.files).padStart(3)}  ours ${String(bucket.ours).padStart(3)}  tree-sitter ${String(
        bucket.theirs,
      ).padStart(3)}  agree ${bucket.agree}\n`,
    );
  }
  process.stdout.write(`${artifact.disagreement.length} file(s) disagree\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
