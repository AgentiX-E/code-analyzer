// @code-analyzer/intelligence — where the diff's added lines are
//
// **This file exists because the naive version of this function is wrong in a way no total can show.** A walk that
// looks at a line's first character counts `+++ b/file.ts` as an added line, and every line number after it is off by
// one per file boundary. **The tests below are numbered in that order**: the plain hunk, the file-header trap, the
// multi-hunk file, the deletion, and the case where the text is not a patch at all.

import { describe, it, expect } from 'vitest';

import { addedLinesOf } from '../../review/adjudication/patch-lines.js';

describe('addedLinesOf', () => {
  it('reads one hunk as the numbers the patch states', () => {
    const patch = [
      '@@ -10,3 +10,5 @@',
      ' context ten',
      '-removed',
      '+added eleven',
      '+added twelve',
      ' context thirteen',
    ].join('\n');
    // New side: 10 context, 11 added, 12 added, 13 context -> added = {11, 12}.
    expect([...addedLinesOf(patch)!].sort((a, b) => a - b)).toEqual([11, 12]);
  });

  it('does not count the file headers as content', () => {
    // **The trap.** `+++` begins with a `+` and `---` begins with a `-`, and a first-character walk shifts every number
    // in the file by the number of headers above it.
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' const a = 1;',
      '+const b = 2;',
      ' const c = 3;',
    ].join('\n');
    expect([...addedLinesOf(patch)!]).toEqual([2]);
  });

  it('keeps the new-side numbering across two hunks', () => {
    const patch = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,2 @@',
      '-old first',
      '+new first',
      ' kept',
      '@@ -40,2 +40,3 @@',
      ' kept forty',
      '+inserted forty-one',
      ' kept forty-two',
    ].join('\n');
    expect([...addedLinesOf(patch)!].sort((a, b) => a - b)).toEqual([1, 41]);
  });

  it('advances the new side on an empty line inside a hunk', () => {
    // An empty line in a pasted patch is a context line whose leading space an editor stripped. Treating it as nothing
    // shifts every following number in the hunk up by one.
    const patch = ['@@ -1,4 +1,5 @@', ' first', '', '+added third', ' fourth', ' fifth'].join('\n');
    expect([...addedLinesOf(patch)!]).toEqual([3]);
  });

  it('returns an empty set for a patch that only deletes', () => {
    // A comment on a deleted line is a comment on code that no longer exists, so "nothing may be filed here" is the
    // correct answer and is different from "the numbers are unknown".
    const patch = ['@@ -1,3 +1,1 @@', ' kept', '-gone one', '-gone two'].join('\n');
    const added = addedLinesOf(patch);
    expect(added).not.toBeNull();
    expect(added!.size).toBe(0);
  });

  it('returns null for hunk headers with no content beneath them', () => {
    // **The engine's own `buildDiffContent` produces exactly this**: the headers are real and the file they describe is
    // not walked, so the numbers cannot be derived - and an empty set here would refuse every comment in a review, which
    // is how a coordinate defect reports itself as precision.
    expect(
      addedLinesOf('// File: src/a.cpp\n// Change type: modified\n\n@@ -8,11 +8,14 @@ (modified)'),
    ).toBeNull();
  });

  it('returns null when the text is not a patch', () => {
    // **The distinction the adjudicator depends on.** The product path hands this a code window, not a patch, and an
    // empty set there would mean "the diff added nothing" and refuse every comment in the review.
    expect(addedLinesOf('export function f() {\n  return 1;\n}')).toBeNull();
    expect(addedLinesOf('')).toBeNull();
    expect(addedLinesOf(undefined)).toBeNull();
    expect(addedLinesOf(null)).toBeNull();
  });

  it('ignores the no-newline marker', () => {
    const patch = ['@@ -1,2 +1,2 @@', '-a', '+b', '\\ No newline at end of file'].join('\n');
    expect([...addedLinesOf(patch)!]).toEqual([1]);
  });

  it('survives a hunk header whose count is omitted', () => {
    // git omits `,1`: `@@ -1 +1 @@` is a legal header, and a parser that requires the comma reads it as no hunk and
    // reports every added line as unknown.
    const patch = ['@@ -1 +1 @@', '-only old', '+only new'].join('\n');
    expect([...addedLinesOf(patch)!]).toEqual([1]);
  });
});
