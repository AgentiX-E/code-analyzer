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

import { parseCitationIds } from '../qa/citations.js';
import { collectDiffFacts } from '../review/actionability.js';
import { DiffParser } from '../review/diff-parser.js';
import { readImportSpecifier } from '../review/import-specifier.js';
import { analyzeApi } from '../review/lenses/api-lens.js';
import { analyzeStructure } from '../review/lenses/structure-lens.js';
import { LLMReviewEngine } from '../review/llm/llm-review-engine.js';
import { checkNoDuplicateImports } from '../rules/rule-runner.js';
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
  const time = (chars: number): number => {
    const started = performance.now();
    run(chars);
    return performance.now() - started;
  };
  // Warm the call once so that a first-call JIT tier does not land in the denominator.
  time(size);

  const half = time(size / 2);
  const full = time(size);

  expect(
    full,
    `${label}: ${String(Math.round(full))} ms on ${String(size)} characters`,
  ).toBeLessThan(CEILING_MS);
  // **Four times for a doubling is the quadratic allowance.** A linear call reads four, a quadratic reads sixteen.
  expect(
    full,
    `${label}: ${String(Math.round(full))} ms against ${String(Math.round(half))} ms at half the size`,
  ).toBeLessThan(Math.max(4 * half, 5));
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
