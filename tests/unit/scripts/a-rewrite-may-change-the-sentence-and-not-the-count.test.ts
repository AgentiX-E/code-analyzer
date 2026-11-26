// @code-analyzer/scripts — the rewrite may change a sentence and may not change a count
//
// **What this file guards, and why the pair of facts travel together.** §166.4 priced the two-sided verifier as *the same
// 227 comments, the sentences corrected*, and the prize of F1 `0.3221 → 0.3896` only means anything while the 227 holds.
// So the readout has to be able to say **the count is unchanged** and **the sentence changed**, and it has to be able to
// say both without a model: the numbers the paid run produces are compared against this arithmetic, and an arithmetic that
// could quietly add or drop a comment would make the comparison unverifiable.
//
// **And the diff lexer is here for the same reason one level down.** A quotation is checked against a line number, and a
// lexer that drifts by one on a `\ No newline at end of file` marker makes every later quotation fail a check it should
// pass - a verifier that refuses everything looks like a strict verifier and is a broken one.

import { describe, expect, it } from 'vitest';

import { evidenceWindow, sideLinesByPath } from '../../../scripts/lib/diff-side-lines.mjs';
import {
  pairedChange,
  pointOf,
  postedRows,
  withRewrites,
  type ArtifactRow,
} from '../../../scripts/lib/crosscheck-readout.mjs';

const DIFF = [
  'diff --git a/src/auth/refresh.ts b/src/auth/refresh.ts',
  'index 1111111..2222222 100644',
  '--- a/src/auth/refresh.ts',
  '+++ b/src/auth/refresh.ts',
  '@@ -10,4 +10,6 @@ export async function refresh(credentialId: string) {',
  ' const user = store.findUser(credentialId);',
  '-const stale = user.id;',
  '+const current = await store.findUser(user.id);',
  '+return current;',
  ' }',
  'diff --git a/src/gone.ts b/src/gone.ts',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-export const gone = 1;',
].join('\n');

const STEPS = [
  { kind: 'drop', categories: ['test'] },
  { kind: 'budget', k: 12 },
];

/** Three rows on one pull request, scored so the cut's order is decided by the score and not by the list. */
const ROWS = [
  {
    pr: 'o/r/pull/1',
    at: 0,
    path: 'a.ts',
    startLine: 10,
    score: 0.9,
    category: 'bug',
    text: 'one',
  },
  {
    pr: 'o/r/pull/1',
    at: 1,
    path: 'a.ts',
    startLine: 20,
    score: 0.5,
    category: 'bug',
    text: 'two',
  },
  {
    pr: 'o/r/pull/1',
    at: 2,
    path: 'a.ts',
    startLine: 30,
    score: 0.1,
    category: 'test',
    text: 'three',
  },
];

describe('the rewrite changes the sentence and not the count', () => {
  describe('the diff, as the new revision numbers it', () => {
    it('numbers an added line the way the file after the change does', () => {
      const files = sideLinesByPath(DIFF);
      const added = files.get('src/auth/refresh.ts')?.added ?? [];
      // **The hunk starts at new line 10**, the context line is 10, and the first `+` is therefore 11.
      expect(added).toEqual([
        { line: 11, text: 'const current = await store.findUser(user.id);' },
        { line: 12, text: 'return current;' },
      ]);
    });

    it('counts a removed line without offering it as evidence', () => {
      const files = sideLinesByPath(DIFF);
      expect(files.get('src/auth/refresh.ts')?.removed).toBe(1);
    });

    it('keeps a context line, because a line the pull request did not touch is still one the reader can see', () => {
      // **The defect that cost 118 of 217 answers**: with only `+` lines numbered, a caller whose callee sits in unchanged
      // context could quote one side and the pass answered `cannot`. The first hunk's context line is new-side line 10.
      const lines = sideLinesByPath(DIFF).get('src/auth/refresh.ts')?.lines ?? [];
      expect(lines[0]).toEqual({
        line: 10,
        text: 'const user = store.findUser(credentialId);',
        added: false,
      });
      expect(lines.filter((entry) => entry.added)).toHaveLength(2);
    });

    it('drops a file the change deleted, because a comment cannot be posted on it', () => {
      expect(sideLinesByPath(DIFF).has('src/gone.ts')).toBe(false);
    });

    it('keeps a content line that starts with a plus, because only the column decides', () => {
      const diff = ['+++ b/a.ts', '@@ -1,1 +1,2 @@', ' x', '++plus = 1;'].join('\n');
      // **The context line is new-side line 1**, so the added line that follows it is line 2.
      expect(sideLinesByPath(diff).get('a.ts')?.added).toEqual([{ line: 2, text: '+plus = 1;' }]);
    });

    it('stops a file at a hunk header it cannot read, rather than guessing the numbers', () => {
      const diff = ['+++ b/a.ts', '@@ nonsense @@', '+const a = 1;'].join('\n');
      expect(sideLinesByPath(diff).get('a.ts')?.added).toEqual([]);
    });
  });

  describe('the window a two-sided question is asked about', () => {
    const added = Array.from({ length: 40 }, (_, index) => ({
      line: index + 1,
      text: `line ${index + 1}`,
    }));

    it('looks back twelve lines and forward twenty, because both sides have to be in it', () => {
      // **Widened after the first paid run answered `cannot` on 118 of 217 comments**: the window is where that number
      // lived, and a declaration is usually further back than a use is forward.
      const window = evidenceWindow(added, 20);
      expect(window[0]).toBe('   8| line 8');
      expect(window.at(-1)).toBe('  40| line 40');
    });

    it('bounds the window, so a large diff cannot become a large prompt', () => {
      expect(evidenceWindow(added, 20, { max: 5 })).toHaveLength(5);
    });

    it('numbers with a fixed width, so the quotation check reads one shape', () => {
      const window = evidenceWindow(added, 3);
      expect(window[0]).toBe('   1| line 1');
      // **Twenty-three lines, not four**: the window is the bound, and a caller that wanted four would have said so.
      expect(window).toHaveLength(23);
    });

    it('answers nothing when the change added nothing here, which the pass reads as no evidence', () => {
      expect(evidenceWindow(added, 999)).toEqual([]);
    });

    it('refuses a start line that is not a number, rather than building a window around NaN', () => {
      expect(evidenceWindow(added, Number.NaN)).toEqual([]);
    });
  });

  describe('the readout', () => {
    it('posts what the cut posts, in the cut order', () => {
      const posted = postedRows(ROWS, STEPS, 2);
      expect(posted.map((row) => row.at)).toEqual([0, 1]);
    });

    it('applies a rewrite at the row it addresses', () => {
      // **Two rows, because the cut's first step drops `test`** - which is the same cut the artifact published.
      const posted = postedRows(ROWS, STEPS, 3);
      const rewritten = withRewrites(posted, new Map([[1, 'corrected']]));
      expect(rewritten.map((row) => row.text)).toEqual(['one', 'corrected']);
    });

    it('ignores a rewrite addressed to a row that was not posted, which is how the count stays put', () => {
      const posted = postedRows(ROWS, STEPS, 1);
      const rewritten = withRewrites(posted, new Map([[2, 'corrected']]));
      expect(rewritten).toHaveLength(1);
      expect(rewritten[0]?.text).toBe('one');
    });

    it('never moves the anchor, whatever it does to the sentence', () => {
      const posted = postedRows(ROWS, STEPS, 3);
      const rewritten = withRewrites(posted, new Map([[0, 'corrected']]));
      expect(rewritten.map((row) => [row.startLine, row.path])).toEqual(
        posted.map((row) => [row.startLine, row.path]),
      );
    });

    it('scores the same rows through the same cut, so two arms differ only in their sentences', () => {
      const creditOf = (row: ArtifactRow): number[] =>
        (row['matched'] as number[] | undefined) ?? [];
      const withCredit = ROWS.map((row, at) => ({ ...row, matched: at === 0 ? [0] : [] }));
      const base = pointOf(withCredit, creditOf, 2, STEPS, 2);
      const corrected = pointOf(
        withCredit.map((row: ArtifactRow & { matched: number[] }) =>
          row.at === 1 ? { ...row, matched: [1] } : row,
        ),
        creditOf,
        2,
        STEPS,
        2,
      );
      expect(base.emitted).toBe(corrected.emitted);
      expect(corrected.truePositives).toBe(base.truePositives + 1);
      expect(corrected.f1).toBeGreaterThan(base.f1);
    });

    it('counts the two cells a paired reading can move, and only those', () => {
      const change = pairedChange([true, false, true, false], [true, true, false, false]);
      expect(change).toMatchObject({ pairs: 4, broken: 1, fixed: 1, delta: 0 });
    });

    it('refuses two readings of different lengths, because a truncated pairing is not a pairing', () => {
      expect(() => pairedChange([true], [true, false])).toThrow(/same pairs/);
    });

    it('reports no movement as one, not as a small probability', () => {
      expect(pairedChange([], []).p).toBe(1);
    });
  });
});
