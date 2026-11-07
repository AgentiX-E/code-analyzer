/**
 * Every `✅` in `docs/language-support.md` is a claim, and this is the test that can disagree with it.
 *
 * **The table had no instrument, so a row could be false for as long as nobody looked.** Iteration 85 found one by
 * accident — Kotlin's `Function Calls` — and the finding is worth more than the fix: a capability table written from
 * what a language *can* express is a plan, and a plan that is read as a measurement is how a product ends up
 * claiming a call graph it never built. This suite turns each cell into a question with an answer:
 *
 * - the language has a fixture (`support/language-support-matrix.ts`),
 * - the row has a check that reads the captures its provider emitted for that fixture,
 * - and the check either finds the evidence or says which evidence is missing.
 *
 * **Three lists have to agree, and each of them can fail on its own.** The matrix's columns are the languages, its rows
 * are the features; `FIXTURES` is keyed by the same language names; `CHECKS` and `UNINSTRUMENTED` are keyed by the same
 * row labels. A column with no fixture fails, a row in neither check list fails, and a `✅` whose check finds nothing
 * fails. The first two are what keeps this from rotting: a language added to the matrix and a row added to the table
 * both force a decision here rather than passing silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArkTSProvider } from '../languages/arkts.js';
import { BashProvider } from '../languages/bash.js';
import { CppProvider } from '../languages/cpp.js';
import { CSharpProvider } from '../languages/csharp.js';
import { DartProvider } from '../languages/dart.js';
import { ElixirProvider } from '../languages/elixir.js';
import { GoProvider } from '../languages/go.js';
import { GroovyProvider } from '../languages/groovy.js';
import { JavaProvider } from '../languages/java.js';
import { JavaScriptProvider } from '../languages/javascript.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { LuaProvider } from '../languages/lua.js';
import { PhpProvider } from '../languages/php.js';
import { PythonProvider } from '../languages/python.js';
import { RProvider } from '../languages/r.js';
import { RubyProvider } from '../languages/ruby.js';
import { RustProvider } from '../languages/rust.js';
import { ScalaProvider } from '../languages/scala.js';
import { SvelteProvider } from '../languages/svelte.js';
import { SwiftProvider } from '../languages/swift.js';
import { TypeScriptProvider } from '../languages/typescript.js';
import { ZigProvider } from '../languages/zig.js';
import { providerLoaders } from '../pipeline/phase-helpers.js';
import {
  CHECKS,
  FIXTURES,
  SCRIPT_AND_COMPONENT_FIXTURES,
  UNINSTRUMENTED,
} from './support/language-support-matrix.js';

import type { FixtureNames } from './support/language-support-matrix.js';
import type { LanguageProvider } from '../languages/provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const PROVIDERS: Readonly<Record<string, () => LanguageProvider>> = {
  TypeScript: () => new TypeScriptProvider(),
  JavaScript: () => new JavaScriptProvider(),
  Python: () => new PythonProvider(),
  Go: () => new GoProvider(),
  Java: () => new JavaProvider(),
  Kotlin: () => new KotlinProvider(),
  'C#': () => new CSharpProvider(),
  Rust: () => new RustProvider(),
  PHP: () => new PhpProvider(),
  Ruby: () => new RubyProvider(),
  'C/C++': () => new CppProvider(),
  Swift: () => new SwiftProvider(),
  Dart: () => new DartProvider(),
  Lua: () => new LuaProvider(),
  Scala: () => new ScalaProvider(),
  Zig: () => new ZigProvider(),
  Elixir: () => new ElixirProvider(),
  ArkTS: () => new ArkTSProvider(),
  Groovy: () => new GroovyProvider(),
  Bash: () => new BashProvider(),
  R: () => new RProvider(),
  Svelte: () => new SvelteProvider(),
};

/** `✅`, `—` and `N/A` are the three cells the table writes; anything else is a typo this suite should catch. */
const CLAIMED = '✅';
const CELLS = new Set([CLAIMED, '—', 'N/A']);

interface Matrix {
  readonly languages: string[];
  readonly rows: { feature: string; cells: string[] }[];
}

/**
 * The feature matrix as the document writes it, read rather than restated.
 *
 * **Reading the document is the point.** A copy of the table in a test is a second table that can drift from the one
 * users read; the cells are the same cells, so the test has to look at the same file. The parser is deliberately
 * literal — pipe-delimited, no escaped pipes — because that is what the table is.
 */
function readMatrix(): Matrix {
  const document = readFileSync(
    join(import.meta.dirname, '../../../../docs/language-support.md'),
    'utf8',
  );
  const lines = document.split('\n');
  const headerIndex = lines.findIndex((line) => line.startsWith('| Feature'));
  expect(headerIndex, 'docs/language-support.md has no `| Feature` header row').toBeGreaterThan(-1);

  const cellsOf = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  const languages = cellsOf(lines[headerIndex]!).slice(1);

  const rows: { feature: string; cells: string[] }[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith('|')) break;
    const parsed = cellsOf(line);
    const feature = parsed[0]!.replace(/\*\*/g, '').trim();
    if (feature.length === 0 || /^-+$/.test(feature)) continue;
    rows.push({ feature, cells: parsed.slice(1) });
  }

  return { languages, rows };
}

/**
 * **The languages the product has, and the ones the matrix deliberately does not cover.**
 *
 * A column is a claim about a language that publishes declarations: capture a function, a class, a method, a call. A
 * scanner also admits the configuration, markup and document formats a repository is made of, and those have providers
 * with their own facts — a YAML key, an HTML element, a SQL table — which this table's rows do not describe. **The split
 * is stated here rather than implied by a hard-coded list**, so a provider added tomorrow fails this suite until its
 * author says which half it belongs to.
 *
 * The list is read off `providerLoaders` and not off a recollection of it, which is how it came to have eleven entries:
 * `hcl`, `dockerfile` and `xml` were in the table and in neither list.
 */
const NOT_A_PROGRAMMING_LANGUAGE: Readonly<Record<string, string>> = {
  yaml: 'a configuration format: keys and anchors, not declarations and calls',
  json: 'a data format: no declarations at all',
  sql: 'a query language: tables and statements, measured by the taint and schema rows of its own suite',
  toml: 'a configuration format: keys and tables',
  markdown: 'a document format: headings and links',
  html: 'a markup format: elements and attributes, measured by the taint rows of its own suite',
  css: 'a stylesheet language: selectors and rules',
  hcl: 'a configuration format: blocks and attributes, read by the infrastructure rules of its own suite',
  dockerfile: 'a build recipe: instructions in order, with no declaration and no call',
  xml: 'a markup format: elements and attributes, measured by its own provider suite',
};

/** The identifier in `docs/language-support.md` for each language the pipeline can load. */
const COLUMN_OF: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  csharp: 'C#',
  rust: 'Rust',
  php: 'PHP',
  ruby: 'Ruby',
  // **One column, two providers**: `c` and `cpp` are separate loaders because the grammars differ, and one column
  // because a user asking "do you read C++" is asking about both.
  c: 'C/C++',
  cpp: 'C/C++',
  swift: 'Swift',
  dart: 'Dart',
  lua: 'Lua',
  scala: 'Scala',
  zig: 'Zig',
  elixir: 'Elixir',
  arkts: 'ArkTS',
  groovy: 'Groovy',
  bash: 'Bash',
  r: 'R',
  svelte: 'Svelte',
};

const MATRIX = readMatrix();

const ALL_FIXTURES = { ...FIXTURES, ...SCRIPT_AND_COMPONENT_FIXTURES };

/** One parse per language, because twenty-five assertions ask the same provider about the same file. */
const parsed = new Map<string, UnifiedCapture[]>();

function capturesOf(language: string): UnifiedCapture[] {
  const cached = parsed.get(language);
  if (cached !== undefined) return cached;
  const fixture = ALL_FIXTURES[language];
  if (fixture === undefined) return [];
  const provider = PROVIDERS[language]!();
  const captures = provider.parse(fixture.source, fixture.file);
  parsed.set(language, captures);
  return captures;
}

describe('the capability matrix and its fixture table are the same shape', () => {
  it('every column of the matrix has a fixture', () => {
    const missing = MATRIX.languages.filter((language) => ALL_FIXTURES[language] === undefined);
    expect(missing, 'languages in docs/language-support.md with no fixture').toEqual([]);
  });

  /**
   * **Every provider the pipeline can load is either a column or named as not a programming language.**
   *
   * This is the assertion whose absence cost a whole iteration: ArkTS and Groovy had grammars, hundreds of lines of
   * walker and no column, so the table described seventeen languages while the product had nineteen. A row without a
   * producer is a promise; **a producer without a row is a capability nobody measured.**
   */
  it('every provider the pipeline loads is a column of the matrix', () => {
    const uncovered = Object.keys(providerLoaders)
      .filter((language) => NOT_A_PROGRAMMING_LANGUAGE[language] === undefined)
      .filter((language) => {
        const column = COLUMN_OF[language];
        return column === undefined || !MATRIX.languages.includes(column);
      });
    expect(uncovered, 'languages the pipeline loads with no column').toEqual([]);
  });

  it('every language the matrix does not cover says why not', () => {
    const unexplained = Object.keys(providerLoaders).filter(
      (language) =>
        NOT_A_PROGRAMMING_LANGUAGE[language] === undefined && COLUMN_OF[language] === undefined,
    );
    expect(unexplained, 'providers in neither list').toEqual([]);
  });

  it('a language exempted as not a programming language is not a column either', () => {
    const both = Object.keys(NOT_A_PROGRAMMING_LANGUAGE).filter((language) =>
      MATRIX.languages.includes(COLUMN_OF[language] ?? ''),
    );
    expect(both, 'languages both exempted and covered').toEqual([]);
  });

  it('every fixture is a column of the matrix', () => {
    const extra = Object.keys(ALL_FIXTURES).filter(
      (language) => !MATRIX.languages.includes(language),
    );
    expect(extra, 'fixtures for languages the matrix does not list').toEqual([]);
  });

  /**
   * **A row is either checked or it is listed as unreachable, and there is no third state.** This is the assertion that
   * would have caught iteration 85's false row before it was written: `Function Calls` had no check, and a row with no
   * check is a row whose `✅` nothing can contradict.
   */
  it('every row is either checked or listed as not instrumented', () => {
    const undecided = MATRIX.rows
      .map((row) => row.feature)
      .filter((feature) => CHECKS[feature] === undefined && UNINSTRUMENTED[feature] === undefined);
    expect(undecided, 'rows of the matrix in neither CHECKS nor UNINSTRUMENTED').toEqual([]);
  });

  it('the check table has no row the matrix does not have', () => {
    const known = new Set(MATRIX.rows.map((row) => row.feature));
    const ghosts = [...Object.keys(CHECKS), ...Object.keys(UNINSTRUMENTED)].filter(
      (feature) => !known.has(feature),
    );
    expect(ghosts, 'checks for rows the matrix does not list').toEqual([]);
  });

  it('every cell is one of the three the table documents', () => {
    const unknown = MATRIX.rows.flatMap((row) =>
      row.cells
        .map((cell, index) => ({ feature: row.feature, language: MATRIX.languages[index]!, cell }))
        .filter(({ cell }) => !CELLS.has(cell)),
    );
    expect(unknown, 'cells that are not ✅, — or N/A').toEqual([]);
  });

  /**
   * **A check that cannot fail is not a check.**
   *
   * Every assertion in this suite is `expect(check(…)).toBeNull()`, so a check that returns `null` unconditionally would
   * make its whole row green and say nothing — the same defect as a `✅` nobody can contradict, one level down. Feeding
   * each check an empty capture list and a name nothing was declared under is the input a working check must reject, and
   * this is the only way to find out that one does not.
   */
  it('every check rejects a parse that captured nothing', () => {
    // **A name nothing was declared under**, spelled the same way for every key so a check that accidentally matches an
    // empty string is caught as well.
    const absent = new Proxy(
      {},
      { get: (_target, key) => `absent-${String(key)}` },
    ) as FixtureNames;
    const silent = Object.entries(CHECKS).filter(
      ([, check]) => check({ captures: [], names: absent, isExported: () => false }) === null,
    );
    expect(
      silent.map(([feature]) => feature),
      'checks that pass on an empty parse',
    ).toEqual([]);
  });
});

describe('every claim a checked row makes is backed by its language', () => {
  for (const language of MATRIX.languages) {
    const fixture = ALL_FIXTURES[language];
    if (fixture === undefined) continue;

    describe(language, () => {
      const provider = PROVIDERS[language]!();

      for (const row of MATRIX.rows) {
        const index = MATRIX.languages.indexOf(language);
        const cell = row.cells[index];
        if (cell !== CLAIMED) continue;
        const check = CHECKS[row.feature];
        // A row in neither list is reported by the shape suite above, and a row only in `UNINSTRUMENTED` has been
        // decided as out of reach — neither is this suite's question.
        if (check === undefined) continue;

        it(row.feature, () => {
          const reason = check({
            captures: capturesOf(language),
            names: fixture.names,
            isExported: (name) => provider.isExported(fixture.source, name),
          });
          expect(reason, `${language} claims ${row.feature}`).toBeNull();
        });
      }
    });
  }
});
