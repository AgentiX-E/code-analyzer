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
import { LLMReviewEngine } from '../review/llm/llm-review-engine.js';
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
