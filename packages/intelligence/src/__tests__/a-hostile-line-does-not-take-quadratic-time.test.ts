// @code-analyzer/intelligence — a hostile line must not cost quadratic time
//
// **The defect class, in one sentence**: three patterns in this package were written to describe a shape and were read
// against text the product did not write, so a line chosen by whoever sent the pull request could make the analyser
// spend time proportional to the square of its length.
//
// - `path-imports.ts` read `/^\s*import\s+[^'"]*from\s+['"]…/` against a line that starts with `import` and never says
//   `from` - a minified bundle's first line is exactly that.
// - `citations.ts` read `[0-9][0-9,\s\-–—]*?\s*[\]】]` against an answer that opens a bracket and never closes it, and
//   the trailing `\s*` rescanned the whitespace run at every candidate end position.
// - `actionability.ts` read `^diff --git a\/(.+?) b\/(.+)$` against a header line containing many `b/` candidates.
//
// **Why the assertion is a stopwatch and not a shape.** A test that read the pattern's source and looked for an
// unbounded quantifier would pass on any pattern that avoided the one spelling it knew, and **a rule that is checked by
// reading its own text is checked by whoever wrote it.** The only thing that distinguishes linear from quadratic is
// time, so this measures time - at two input sizes, with a ceiling two orders of magnitude above the linear cost and
// two orders below the quadratic one, so that neither a slow machine nor a fast one can decide the answer.

import { describe, expect, it } from 'vitest';

import { VersionCompatibilityMatrix } from '../cross-repo/version-matrix.js';
import { parseCitationIds } from '../qa/citations.js';
import { collectDiffFacts } from '../review/actionability.js';
import { DiffParser } from '../review/diff-parser.js';
import { readImportSpecifier } from '../review/import-specifier.js';
import { analyzeApi } from '../review/lenses/api-lens.js';
import { analyzeStructure } from '../review/lenses/structure-lens.js';
import { analyzeStyle } from '../review/lenses/style-lens.js';
import { LLMReviewEngine } from '../review/llm/llm-review-engine.js';
import { createAstContext } from '../rules/ast-rule-checker.js';
import {
  checkMaxFunctionLines,
  checkMaxParams,
  checkNoArrayIndexKey,
  checkNoDuplicateImports,
  checkTrailingWhitespace,
} from '../rules/rule-runner.js';
import { extractImports } from '../search/path-imports.js';

/**
 * **How long a call is allowed to take on a forty-kilobyte line.**
 *
 * The linear cost of any of the three is well under a millisecond; the quadratic cost at this size is seconds. **Half a
 * second is the middle of that gap**, which is where a threshold has to sit to be a statement about the algorithm
 * rather than about the machine the test is running on.
 */
const CEILING_MS = 500;

function timeOf(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('a line the product did not write', () => {
  it('does not make the import extractor quadratic', () => {
    // The shape that used to be quadratic: `import` and then forty thousand characters that never say `from` and are
    // never quoted. Before the bound this took seconds; now it is a scan of one line.
    const hostile = `import ${'a'.repeat(40_000)}`;

    const elapsed = timeOf(() => {
      // **One capture, and it is the wrong one** - a line beginning `import aaaa…` satisfies the loose Java form, which
      // is why that form sits last in the list. The claim here is about the time, not the capture.
      expect(extractImports(hostile)).toHaveLength(1);
    });

    expect(elapsed).toBeLessThan(CEILING_MS);
    // **And the same input twice as long must not cost four times as much**, which is the claim a ceiling alone cannot
    // make. The allowance is generous because a millisecond-scale measurement is mostly noise.
    const half = timeOf(() => {
      extractImports(`import ${'a'.repeat(20_000)}`);
    });
    expect(elapsed).toBeLessThan(Math.max(CEILING_MS, 4 * half));
  });

  it('still reads an import statement of the length a real one has', () => {
    // **The bound must be a bound on absurdity, not on real code.** A specifier list of three hundred characters is
    // what a generated barrel file looks like, and it has to survive `{0,512}`.
    const names = Array.from({ length: 40 }, (_, i) => `name${String(i)}`).join(', ');
    const line = `import { ${names} } from './a-real-module';`;

    expect(extractImports(line)).toEqual(['./a-real-module']);

    // **Past the bound the specifier is a miss rather than a lie**: the JavaScript pattern stops matching, and the line
    // falls through to the loose forms below it, which capture a name instead of a module. `importLines` is what would
    // publish the consequence, and it counts lines rather than verifying which half of the statement was kept.
    expect(extractImports(`import ${'x'.repeat(600)} from './too-long';`)).not.toContain(
      './too-long',
    );
  });

  it('does not make the citation parser quadratic', () => {
    // A bracket that is opened and never closed, followed by a long run of what the class accepts.
    const hostile = `see [${'1, '.repeat(20_000)}`;

    const elapsed = timeOf(() => {
      expect(parseCitationIds(hostile)).toEqual([]);
    });

    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('still expands the citations a real answer makes', () => {
    expect(parseCitationIds('as shown in [3], [5-7] and 【9】')).toEqual([3, 5, 6, 7, 9]);
    // Trailing whitespace inside the bracket used to be swallowed by the pattern and is now handled by the split, so
    // the behaviour is pinned rather than assumed.
    expect(parseCitationIds('see [ 4 , 6 ]')).toEqual([4, 6]);
  });

  it('does not make the diff header quadratic', () => {
    // Twenty thousand ` b/` candidates on one line: every one of them was a backtrack point for `(.+?) b/(.+)$`.
    const hostile = `diff --git a/${' b/'.repeat(20_000)}`;

    const elapsed = timeOf(() => {
      collectDiffFacts(hostile);
    });

    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('does not make the engine quadratic on the same two headers', () => {
    // **The engine split a diff with its own copy of the pattern**, so the defect existed twice and the fix had to reach
    // both. This drives the engine's own section splitter through `reviewPullRequest`, which is where a pull-request
    // call reads a diff it did not write.
    const hostile = [
      `diff --git a/${' b/'.repeat(20_000)}`,
      `@@ -${'1'.repeat(20_000)}`,
      '+const a = 1;',
    ].join('\n');

    const elapsed = timeOf(() => {
      const engine = new LLMReviewEngine({
        name: 'silent',
        model: 'silent',
        complete: () =>
          Promise.resolve({
            content: '{"findings": []}',
            model: 'silent',
            createdAt: '2026-11-10T00:00:00.000Z',
            finishReason: 'stop',
          }),
        completeWithTools: () =>
          Promise.resolve({
            content: '{"findings": []}',
            model: 'silent',
            createdAt: '2026-11-10T00:00:00.000Z',
            finishReason: 'stop',
          }),
        healthCheck: () => Promise.resolve(true),
      });
      // **`void` and not `return`**: the section splitter runs synchronously before the first await, so the stopwatch
      // covers the scan that was quadratic. The call is left to settle on its own; `describe` below fails the suite if
      // an unhandled rejection escapes.
      void engine.reviewPullRequest([{ path: 'src/a.ts', diffText: hostile }]);
    });

    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('still reads the two paths of a header, and refuses a line that only looks like one', () => {
    const facts = collectDiffFacts(
      [
        'diff --git a/src/retry.ts b/src/retry.ts',
        '@@ -1,1 +1,2 @@',
        ' const a = 1;',
        '+const b = 2;',
      ].join('\n'),
    );
    expect([...facts.added.keys()]).toEqual(['src/retry.ts']);
    expect(facts.added.get('src/retry.ts')?.get(2)).toBe('const b = 2;');

    // **A path containing the separator is ambiguous in git's own format**, and the split is at the first ` b/` because
    // that is where the lazy group it replaces stopped. Pinned so that the linear rewrite cannot quietly move it.
    const nested = collectDiffFacts(
      ['diff --git a/x b/y.ts b/z.ts', '@@ -1,1 +1,1 @@', '-old', '+new'].join('\n'),
    );
    expect([...nested.added.keys()]).toEqual(['y.ts b/z.ts']);

    // And a header with nothing after the separator names no file at all.
    expect(collectDiffFacts('diff --git a/src/a.ts b/').added.size).toBe(0);
  });
});

// ============================================================================
// The same stopwatch, applied to the four lenses and rules that read a line
// ============================================================================
//
// **Why these four and not the other seventy-five findings.** CodeQL's polynomial-redos rule fires seventy-nine times
// in this repository, and a rule that fires seventy-nine times is a rule whose findings have to be sorted before they
// can be believed. The sort was done by measurement rather than by inspection: each finding's own adversarial string -
// the one CodeQL names in its message - was replayed at four and forty kilobytes, and the ones that crossed a
// two-hundred-millisecond ceiling are the ones below. **Two of them did not finish at all**: forty kilobytes of
// spaces after the word `import` ran for more than five seconds, which makes the quadratic claim an
// understatement - a cubic or worse shape has the same signature when the only samples are "fast" and "did not return".
//
// **The claim each case makes.** Not "the pattern is bounded" - that is a fact about the source, and a source can be
// edited - but "this call, on an input the product did not write, costs time proportional to its length". So each case
// measures twice, at half the size and at the full size, and asserts both that the absolute cost is small and that
// doubling the input did not quadruple it.

/**
 * **Measure a call at two sizes and assert it is linear, not merely fast.**
 *
 * The absolute ceiling alone would pass a quadratic that happened to be well optimised; the ratio alone would pass a
 * linear call that took a minute. Together they say what the reader wants to know: the cost grows with the input and
 * the constant is small.
 */
function expectLinear(label: string, size: number, run: (chars: number) => void): void {
  const once = (chars: number): number => {
    const started = performance.now();
    run(chars);
    return performance.now() - started;
  };
  /**
   * **The best of three readings, not one.**
   *
   * These measurements are milliseconds long and run beside fourteen other workers, so a single reading includes
   * whatever the scheduler and the collector were doing at that instant. **Noise only ever adds time to a call**, so the
   * fastest of several readings is the closest thing to the cost of the call itself - and a single sample was enough to
   * fail this file once: `analyzeApi` read 9 ms at half the size and 41 ms at the full size on a busy machine, and 4 ms
   * and 8 ms on an idle one. The assertion had not changed; the sampling had.
   */
  const time = (chars: number): number => {
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) best = Math.min(best, once(chars));
    return best;
  };
  // Warm the call once so that a first-call JIT tier does not land in the denominator.
  once(size);

  const half = time(size / 2);
  const full = time(size);

  expect(
    full,
    `${label}: ${String(Math.round(full))} ms on ${String(size)} characters`,
  ).toBeLessThan(CEILING_MS);
  // **Four times for a doubling is the quadratic allowance.** A linear call reads four, a quadratic reads sixteen.
  // **And twenty milliseconds is the floor below which the ratio is not a statement about the algorithm**: at that
  // scale the difference between two readings is a pause, not a shape.
  expect(
    full,
    `${label}: ${String(Math.round(full))} ms against ${String(Math.round(half))} ms at half the size`,
  ).toBeLessThan(Math.max(4 * half, 20));
}

/**
 * **A layer configuration that actually resolves**, because the import matcher only runs for a file that belongs to a
 * layer: a measurement that never enters the branch measures nothing, and the first version of the test above passed in
 * one millisecond for exactly that reason.
 */
const LAYERS = `
layers:
  - name: web
    paths:
      - src/web/
    forbidden_imports:
      - data
  - name: data
    paths:
      - src/data/
    forbidden_imports: []
`;

describe('the lenses and rules that read a line', () => {
  it('does not let a line of question marks make the structure lens quadratic', () => {
    // `countBranches` asked `\?.*:` whether the line held a ternary. The `.*` consumed the rest of the line and then
    // gave it back one character at a time looking for the colon, and it did that from every `?` in the line - so a line
    // of question marks cost the square of its length. **A branch count is a count of `?` that are not `?.` or `??`**,
    // which is a local decision and needs no look-ahead across the line.
    expectLinear('analyzeStructure on ?', 40_000, (chars) => {
      analyzeStructure('?'.repeat(chars), 'src/a.ts');
    });
  });

  it('does not let a line of spaces after `import` make the structure lens hang', () => {
    // `import\s+.*\s+from` gave the engine two unbounded whitespace runs to partition around a lazy `.*`, so a line
    // that begins with `import` and never says `from` was a search over every split of the run. **Bounding the runs is
    // what makes it linear, and sixty-four characters is past anything an import statement has ever contained.**
    expectLinear('analyzeStructure on import', 40_000, (chars) => {
      analyzeStructure(`import ${' '.repeat(chars)}`, 'src/web/a.ts', { layerConfig: LAYERS });
    });
  });

  it('does not let the same line make the duplicate-import rule hang', () => {
    expectLinear('checkNoDuplicateImports on import', 40_000, (chars) => {
      checkNoDuplicateImports([`import ${' '.repeat(chars)}`], 'src/a.ts', 'typescript');
    });
  });

  it('does not let a long run of digits make the hunk header quadratic', () => {
    // `(\d+),?(\d+)?` could split a run of digits between the two groups in many ways, and `\s+` after it multiplied
    // them. **Git writes one comma and one space in a hunk header**, so the pattern now says that and the engine has
    // nothing to guess.
    const parser = new DiffParser();
    expectLinear('parseHunks on digits', 40_000, (chars) => {
      parser.parseHunks([`@@ -0${'0'.repeat(chars)}`]);
    });
  });

  it('does not let a long run of word characters make the API lens quadratic', () => {
    // `(\w+)\s*:\s*(?:async\s*)?\(` scanned from every position inside a single long token, and each position consumed
    // the rest of the token before failing. **A GraphQL field name is a name**; a hundred and twenty-eight characters is
    // four times the longest one in any published schema, and the bound turns the scan into a constant per position.
    // The route matcher only runs inside a GraphQL resolver map, so the hostile token is placed where a resolver would
    // be - **an input that never enters the branch is not a measurement of the branch.**
    expectLinear('analyzeApi on digits', 40_000, (chars) => {
      analyzeApi(`type Query: {\n${'0'.repeat(chars)}`, 'src/schema.ts');
    });
  });

  it('still reads the shapes these patterns exist for', () => {
    // **A bound on absurdity must not be a bound on real code**, so each rewritten pattern is re-read at the shape it
    // was written for. These are the cases the timing tests above would happily pass while returning nothing.
    const parser = new DiffParser();
    expect(parser.parseHunks(['@@ -1,5 +1,5 @@'])).toHaveLength(1);
    expect(parser.parseHunks(['@@ -1 +1 @@'])).toHaveLength(1);
    expect(parser.parseHunks(['@@ -10,3 +20 @@'])[0]?.newCount).toBe(1);

    const structure = analyzeStructure(
      ['import { db } from "src/data/database";', 'import { b } from "src/web/button";'].join('\n'),
      'src/web/card.ts',
      { layerConfig: LAYERS },
    );
    expect(structure.some((f) => f.evidence.ruleId === 'struct-layer-violation')).toBe(true);

    expect(
      checkNoDuplicateImports(['import a from "x";', 'import b from "x";'], 'a.ts', 'ts'),
    ).toHaveLength(1);

    // The API lens reads routes and reports what a service cannot ship without. **A `POST` that destructures the body
    // and never validates it is such a finding**, so this asserts the route was read rather than that an array exists.
    const api = analyzeApi(
      [
        "const express = require('express');",
        'const router = express.Router();',
        '',
        "router.post('/users', (req, res) => {",
        '  const { name, email } = req.body;',
        '  res.json({ id: 1, name, email });',
        '});',
      ].join('\n'),
      '/src/routes/users.ts',
    );
    expect(api.some((f) => f.evidence.ruleId === 'api-missing-validation')).toBe(true);
  });
});

describe('the import specifier scanner', () => {
  // **The replacement for the pattern has to be read as carefully as the pattern was**, and a scanner is a function, so
  // its contract is checked here rather than inferred from the lens that uses it.
  it('reads the shapes an import statement has', () => {
    expect(readImportSpecifier("import { a, b } from './mod';")).toBe('./mod');
    expect(readImportSpecifier('import defaultExport from "pkg"')).toBe('pkg');
    expect(readImportSpecifier("import * as ns from '@scope/pkg/sub'")).toBe('@scope/pkg/sub');
    expect(readImportSpecifier('import  double  from\t"tabbed"')).toBe('tabbed');
    // A specifier is taken to the first closing quote of the same kind, so a path with a space survives.
    expect(readImportSpecifier("import a from './with space/mod'")).toBe('./with space/mod');
  });

  it('refuses what is not an import statement', () => {
    expect(readImportSpecifier("const important = require('./x');")).toBeNull();
    expect(readImportSpecifier("export { a } from './mod';")).toBeNull();
    expect(readImportSpecifier('import')).toBeNull();
    expect(readImportSpecifier('importx from "pkg"')).toBeNull();
    expect(readImportSpecifier('import a from pkg')).toBeNull();
    // An unclosed quote names no module: a zero-length path is not a path.
    expect(readImportSpecifier("import a from './unclosed")).toBeNull();
    // `from` has to be preceded by whitespace, so a name that ends in it does not count.
    expect(readImportSpecifier("import fromage fromage from 'x'")).toBe('x');
    expect(readImportSpecifier("import a fromage'x'")).toBeNull();
  });
});

describe('a gap that two quantifiers can both read', () => {
  // **The second family, and the one CodeQL named twenty-four times.** Each of these patterns gave a backtracking engine
  // two ways to read the same characters: `\\s*` on both sides of an optional group, a run of whitespace that a trailing
  // `\\s*` could also take, an unrolled string matcher whose inner and outer runs met, an alternation whose every branch
  // ended in whitespace followed by another whitespace run. **A pair like that is quadratic in the length of the gap**,
  // and a gap is exactly what a minified line or a generated file is made of.
  //
  // **Six of the seven were linear anyway, and this file says so rather than implying otherwise.** Run against the
  // previous commit, these cases read one to four milliseconds each - a quadratic with a small constant, at the size a
  // file can be. The seventh read **2 957 ms**: `checkMaxParams`'s alternation put a whitespace run at the end of every
  // branch and then asked for another one, so a name followed by forty kilobytes of spaces and a `(` had two runs to
  // split a gap between. **That is the case the assay missed**, because the input it replays is built from the pump the
  // message names - `=>` followed by spaces - and with a `=>` in front the `(` never arrives, so the split is decided by
  // the first backtrack. A message names a character; the shape that costs is a different hypothesis.
  //
  // The assertion is the same one the rest of this file makes - time at half the size and at the full size - because the
  // claim is the same claim. What is new is the input: a run of the gap, with nothing after it.

  it('does not let spaces between a modifier and a name reach a method header twice', () => {
    // `^\\s*(?:public|private|protected|static|async)?\\s*(\\w+)\\s*\\(` has two whitespace runs that meet when the
    // optional group does not participate, and a third that meets the second.
    expectLinear('checkMaxFunctionLines on a header gap', 40_000, (chars) => {
      checkMaxFunctionLines([`public${' '.repeat(chars)}method(`], 'src/a.ts', 'typescript');
    });
  });

  it('does not let spaces between a name and its parentheses reach the parameter count twice', () => {
    // `(?:function\\s+\\w{1,128}\\s*|=>\\s*|\\w{1,128}\\s*)\\s*\\(`: every branch ended in a whitespace run and the
    // pattern then asked for another one. The branches no longer end in whitespace, so the run is read once.
    expectLinear('checkMaxParams on a name gap', 40_000, (chars) => {
      checkMaxParams([`name${' '.repeat(chars)}(`], 'src/a.ts', 'typescript');
    });
  });

  it('does not let an optional brace between two whitespace runs reach a key index twice', () => {
    // `\\bkey\\s*=\\s*\\{?\\s*(?:index|i|idx|j|k)\\b` - the brace is optional and whitespace is optional on both sides of
    // it, so the gap after `=` had two readings. `(?:\\{\\s*)?` is one group with one reading.
    expectLinear('checkNoArrayIndexKey on a gap', 40_000, (chars) => {
      checkNoArrayIndexKey([`key${' '.repeat(chars)}={`], 'src/a.tsx', 'typescript');
    });
  });

  it('does not let a line of tabs cost its own square to see the last character', () => {
    // `/[ \\t]+$/` asks "does this line end in whitespace" and answers by trying a run at every position. `/[ \\t]$/`
    // asks the same question about one character, which is all the question needs.
    expectLinear('checkTrailingWhitespace on tabs', 40_000, (chars) => {
      checkTrailingWhitespace(['\\t'.repeat(chars)], 'src/a.ts', 'typescript');
    });
  });

  it('does not let an operator in front of a version cost the length of the version', () => {
    // Two `String.replace` calls, one with a leading `[^\\d]*` and one with `[^.\\d].*$`: a `.*` beside a class that can
    // match the same characters is the pair that lets a string be partitioned. Two scans read the same run.
    const matrix = new VersionCompatibilityMatrix();
    expectLinear('parseSemver on an operator run', 40_000, (chars) => {
      matrix.parseSemver(`${'~'.repeat(chars)}1.2.3`);
    });
  });

  it('does not let a header with many separators cost the square of its length', () => {
    // `^diff --git a\\/(.*?) b\\/(.*?)$` tried every ` b/` as the separator, from both groups. The first one is the
    // separator git writes, and `indexOf` finds it once.
    const parser = new DiffParser();
    expectLinear('parseUnifiedDiff on separators', 40_000, (chars) => {
      parser.parseUnifiedDiff(`diff --git a/${' b/'.repeat(Math.floor(chars / 3))}`);
    });
  });

  it('does not let an escape run make the style lens quadratic', () => {
    // The unrolled `[^"\\\\]*(?:\\\\[\\s\\S][^"\\\\]*)*` has an inner and an outer run over the same characters, and a
    // line of escapes gives the engine a choice at every one of them. `(?:[^"\\\\]|\\\\[\\s\\S])*` is one list of two
    // disjoint cases.
    expectLinear('analyzeStyle on escapes', 40_000, (chars) => {
      analyzeStyle(`const a = "${'\\\\a'.repeat(Math.floor(chars / 2))}`, 'src/a.ts');
    });
  });

  it('does not let a string of escapes that never closes cost the square of its length', () => {
    // **The unterminated case, and the terminator is what makes it a measurement.** A closed string closes on the first
    // unescaped quote and the pattern reads it in one pass; a string that never closes is the input where every `\\"`
    // is a decision the engine tries and re-tries. Measured before the scan: **7 ms at five thousand escapes, 30 ms at
    // ten, 118 ms at twenty** for the alternation, and the same curve 1.8 times higher for the unrolled form.
    const hostile = (chars: number): string => `const a = "${'\\"'.repeat(Math.floor(chars / 2))}`;
    expectLinear('analyzeStyle on an unterminated string', 120_000, (chars) => {
      analyzeStyle(hostile(chars), 'src/a.ts');
    });
  });

  it('does not let the same line reach the same cost in the string extractor', () => {
    // The extractor is reached through `createAstContext` with a language tree-sitter does not know, which is the
    // fallback path the pattern belongs to - **the AST path never reads these patterns.**
    const hostile = (chars: number): string => `const a = "${'\\"'.repeat(Math.floor(chars / 2))}`;
    expectLinear('createAstContext on an unterminated string', 120_000, (chars) => {
      createAstContext([hostile(chars)], 'src/a.txt', 'plaintext');
    });
  });

  it('still reads the shapes these patterns were written for', () => {
    // **The rewrite has to keep the reading, and a timing test cannot see that.** Each of the above is re-read at the
    // shape the product meets every day.
    expect(checkMaxFunctionLines(['public longMethod('], 'src/a.ts', 'typescript')).toHaveLength(0);
    expect(checkMaxParams(['function f(a, b) {'], 'src/a.ts', 'typescript')).toHaveLength(0);
    expect(checkNoArrayIndexKey(['<li key={index} />'], 'src/a.tsx', 'typescript')).toHaveLength(1);
    expect(checkNoArrayIndexKey(['<li key={item.id} />'], 'src/a.tsx', 'typescript')).toHaveLength(
      0,
    );
    expect(checkTrailingWhitespace(['const a = 1;   '], 'src/a.ts', 'typescript')).toHaveLength(1);
    expect(checkTrailingWhitespace(['const a = 1;'], 'src/a.ts', 'typescript')).toHaveLength(0);

    const matrix = new VersionCompatibilityMatrix();
    expect(matrix.parseSemver('^1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(matrix.parseSemver('~2.0.0-beta.1')).toEqual({ major: 2, minor: 0, patch: 0 });

    // **A diff header whose path contains a space is read at its first separator**, which is the one git writes.
    const parser = new DiffParser();
    const diffs = parser.parseUnifiedDiff(
      [
        'diff --git a/src/a b.ts b/src/a b.ts',
        'index 1..2 100644',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.filePath).toBe('src/a b.ts');
  });
});
