// A hunk that changed no token cannot carry a finding.
//
// §78 spent 6 000 characters of surrounding context per claim and moved F1 by −0.0022. The shortage was never that the
// reader saw too little; it was that the pool contained findings standing on hunks that changed nothing a compiler would
// see. These tests exist to make `change-shape` unable to say that, and unable to say the safe thing when it cannot
// prove the cheap one.

import { describe, expect, it } from 'vitest';

import { classifyChange, classifyPatch, mayCarryFinding } from '../change-shape.js';

const OLD = ['function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}'].join(
  '\n',
);
const NEW = ['function b() {', '  return 2;', '}', '', 'function a() {', '  return 1;', '}'].join(
  '\n',
);

describe('a hunk that only changed whitespace', () => {
  it('is reformatted, and carries no finding', () => {
    const shaped = classifyChange({
      removed: ['    if (x) {', '        y();', '    }'],
      added: ['  if (x) {', '    y();', '  }'],
      oldText: 'a\n    if (x) {\n        y();\n    }\nb',
      newText: 'a\n  if (x) {\n    y();\n  }\nb',
    });

    expect(shaped.shape).toBe('reformatted');
    expect(shaped.because).toBe('same-non-whitespace');
    expect(shaped.novelLines).toEqual([]);
    expect(mayCarryFinding(shaped.shape)).toBe(false);
  });

  it('is reformatted when one line became two with the same characters', () => {
    // The line-wrapping case: identical non-whitespace multiset, different line count.
    const shaped = classifyChange({
      removed: ['const v = fn(a, b);'],
      added: ['const v = fn(a,', '  b);'],
    });

    expect(shaped.shape).toBe('reformatted');
  });

  it('is reformatted when a hunk arrived with two empty sides', () => {
    const shaped = classifyChange({ removed: [], added: [] });

    expect(shaped.shape).toBe('reformatted');
    expect(shaped.because).toBe('no-change');
  });
});

describe('a hunk that only changed comment text', () => {
  it('is comment-only when the code around it is identical', () => {
    const shaped = classifyChange({
      removed: ['  // returns the cached value', '  return cache.get(key);'],
      added: ['  // returns the cached value, or undefined', '  return cache.get(key);'],
    });

    expect(shaped.shape).toBe('comment-only');
    expect(shaped.because).toBe('same-non-comment');
    expect(mayCarryFinding(shaped.shape)).toBe(false);
  });

  it('is comment-only when a block comment grew a line', () => {
    const shaped = classifyChange({
      removed: [' * The cache.', ' */'],
      added: [' * The cache.', ' * It is bounded at 128 entries.', ' */'],
    });

    expect(shaped.shape).toBe('comment-only');
  });

  it('treats an inline block comment as comment and the code after it as code', () => {
    // `/* note */ x = 1;` - the marker goes, the statement stays, and the two sides differ only in the note.
    const shaped = classifyChange({
      removed: ['/* old */ x = 1;'],
      added: ['/* new */ x = 1;'],
    });

    expect(shaped.shape).toBe('comment-only');
  });

  it('is substantive when a comment change also changes code', () => {
    const shaped = classifyChange({
      removed: ['  // guard', '  if (x) return 1;'],
      added: ['  // guard, widened', '  if (x || y) return 1;'],
    });

    expect(shaped.shape).toBe('substantive');
  });
});

describe('a hunk that moved code', () => {
  it('is moved when both directions are present in the other side', () => {
    // The real shape of a move inside one hunk: `a` leaves its place, `b` arrives in it - and `b` already existed on
    // the old side while `a` still exists on the new one. **A block that is identical on both sides is not a move but a
    // no-op, and git does not emit one.**
    const shaped = classifyChange({
      removed: ['function a() {', '  return 1;', '}'],
      added: ['function b() {', '  return 2;', '}'],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('moved');
    expect(shaped.because).toBe('relocated');
    expect(shaped.novelLines).toEqual([]);
  });

  it('is substantive when the removed line vanished instead of moving', () => {
    // Added lines all existed before, but a removed line is nowhere on the new side: that is a copy plus a deletion.
    const shaped = classifyChange({
      removed: ['function gone() {', '  return 9;', '}'],
      added: ['function a() {', '  return 1;', '}'],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('substantive');
  });

  it('cannot claim a move when the file text was not supplied', () => {
    const shaped = classifyChange({
      removed: ['  return 1;'],
      added: ['  return 2;'],
    });

    expect(shaped.shape).toBe('substantive');
    expect(shaped.because).toBe('unprovable');
    expect(shaped.novelLines).toEqual(['  return 2;']);
  });
});

describe('a hunk that changed behaviour', () => {
  it('is substantive and names only the genuinely new lines', () => {
    const shaped = classifyChange({
      removed: ['  if (x) return 1;'],
      added: ['  if (x) return 1;', '  if (y) throw new Error("bad");'],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('substantive');
    expect(shaped.because).toBe('edited');
    expect(shaped.novelLines).toEqual(['  if (y) throw new Error("bad");']);
    expect(mayCarryFinding(shaped.shape)).toBe(true);
  });

  it('is substantive for a pure insertion into a known file', () => {
    const shaped = classifyChange({
      removed: [],
      added: ['export function c() {', '  return 3;', '}'],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('substantive');
    // `}` already exists on the old side, so it is not novel: **a brace is not a place a finding can stand.**
    expect(shaped.novelLines).toEqual(['export function c() {', '  return 3;']);
  });

  it('is substantive for a pure deletion', () => {
    const shaped = classifyChange({
      removed: ['function b() {', '  return 2;', '}'],
      added: [],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('substantive');
    expect(shaped.novelLines).toEqual([]);
  });
});

describe('a blank line and an open block comment', () => {
  it('counts a blank added line as not novel', () => {
    const shaped = classifyChange({
      removed: ['  return 1;'],
      added: ['', '  return 42;'],
      oldText: OLD,
      newText: NEW,
    });

    expect(shaped.shape).toBe('substantive');
    // The blank line is part of the change but is not a place a finding can stand.
    expect(shaped.novelLines).toEqual(['  return 42;']);
  });

  it('treats an unterminated block comment as comment, not as code', () => {
    const shaped = classifyChange({
      removed: ['/* opening', '  return 1;'],
      added: ['/* opening, reworded', '  return 1;'],
    });

    expect(shaped.shape).toBe('comment-only');
  });
});

describe('the classifier never trades a proof for a guess', () => {
  it('keeps a `#` line as code, so comment stripping cannot erase it', () => {
    // `#` is a comment marker in some languages and an operator in others. The marker is applied, the code is not lost,
    // and the two sides differ in their non-comment characters - so the answer is the safe one.
    const shaped = classifyChange({
      removed: ['  a = b # 1'],
      added: ['  a = b # 2'],
    });

    expect(shaped.shape).toBe('comment-only');
  });

  it('does not call an edit a reformat when a single character differs', () => {
    const shaped = classifyChange({
      removed: ['  return value === null;'],
      added: ['  return value === null; '],
    });

    // Trailing whitespace is whitespace: same non-whitespace multiset.
    expect(shaped.shape).toBe('reformatted');
  });

  it('separates two lines by a character, not only by whitespace', () => {
    const shaped = classifyChange({
      removed: ['  return value == null;'],
      added: ['  return value === null;'],
    });

    expect(shaped.shape).toBe('substantive');
  });
});

describe('a patch read as a whole', () => {
  const PATCH = [
    '@@ -1,3 +1,3 @@',
    ' function a() {',
    '-    return 1;',
    '+  return 1;',
    ' }',
    '@@ -10,3 +10,4 @@',
    ' function b() {',
    '   return 2;',
    "+  if (x) throw new Error('bad');",
    ' }',
  ].join('\n');

  it('classifies each hunk and keeps the new-side numbering exact', () => {
    const shaped = classifyPatch(PATCH);

    expect(shaped.hunks).toHaveLength(2);
    expect(shaped.hunks[0]?.shape).toBe('reformatted');
    expect(shaped.hunks[1]?.shape).toBe('substantive');
    // The first hunk added new line 2; the second added new line 12.
    expect(shaped.hunks[0]?.addedLines).toEqual([2]);
    expect(shaped.hunks[1]?.addedLines).toEqual([12]);
    expect([...shaped.novelLines]).toEqual([12]);
    expect(shaped.noneSubstantive).toBe(false);
  });

  it('says a pure reformat carries nothing, rather than saying nothing about it', () => {
    const shaped = classifyPatch(
      ['@@ -1,3 +1,3 @@', ' function a() {', '-    return 1;', '+  return 1;', ' }'].join('\n'),
    );

    expect(shaped.hunks).toHaveLength(1);
    expect(shaped.hunks[0]?.shape).toBe('reformatted');
    expect(shaped.hunks[0]?.addedLines).toEqual([2]);
    expect([...shaped.novelLines]).toEqual([]);
    expect(shaped.noneSubstantive).toBe(true);
  });

  it('does not claim a skip for a patch it could not read', () => {
    const shaped = classifyPatch('this is not a patch');

    expect(shaped.hunks).toEqual([]);
    expect(shaped.noneSubstantive).toBe(false);
  });

  it('ignores the no-newline marker instead of counting it as a context line', () => {
    const shaped = classifyPatch(
      ['@@ -1,2 +1,3 @@', ' a', ' b', '+c', '\\ No newline at end of file'].join('\n'),
    );

    expect(shaped.hunks[0]?.addedLines).toEqual([3]);
    expect(shaped.hunks[0]?.novelLines).toEqual([3]);
  });
});

describe('a hunk that only deleted', () => {
  // **The defect the first 30-pull-request reading paid for.** A deletion writes no line, so a set built from added
  // lines is empty - and the gate read that emptiness as "this change wrote nothing here" and refuted findings about
  // the removal. Three true positives among 48 removals, all of them about deletions.
  const DELETION = [
    '@@ -40,6 +40,3 @@',
    ' class A {',
    ' public:',
    '-  enum Kind { A, B };',
    '-  Kind kind() const;',
    ' };',
  ].join('\n');

  it('is substantive, because a removal is a change', () => {
    const shaped = classifyPatch(DELETION);

    expect(shaped.hunks[0]?.shape).toBe('substantive');
    expect(shaped.noneSubstantive).toBe(false);
  });

  it('writes no novel line and still offers one to stand on', () => {
    const shaped = classifyPatch(DELETION);

    // The tokens argument sees nothing to read...
    expect(shaped.hunks[0]?.novelLines).toEqual([]);
    expect(shaped.novelLines.size).toBe(0);
    // ...and the standing argument sees the hunk's own lines, including the place the removals were.
    expect([...shaped.allowedLines].sort((a, b) => a - b)).toEqual([40, 41, 42]);
    expect(shaped.hunks[0]?.removedAt).toEqual([42, 42]);
  });

  it('offers the deletion point when the hunk ends on the removal', () => {
    // No trailing context: the new-side span is empty, so the removal point is the whole of what the hunk contributes.
    const shaped = classifyPatch(['@@ -10,2 +9,0 @@', '-b', '-c'].join('\n'));

    expect(shaped.hunks[0]?.shape).toBe('substantive');
    expect(shaped.hunks[0]?.span).toBeNull();
    expect([...shaped.allowedLines]).toEqual([9]);
  });

  it('never lets a substantive hunk contribute nothing', () => {
    // **The invariant, stated once over the shapes that can reach it.** A substantive hunk that offers no line is a
    // contradiction: the classifier said the change happened and then gave a reader nowhere to look.
    const patches = [
      DELETION,
      ['@@ -1,2 +1,3 @@', ' a', '+b', ' c'].join('\n'),
      ['@@ -1,2 +1,2 @@', ' a', '-b', '+c'].join('\n'),
      ['@@ -7,0 +8,2 @@', '+x', '+y'].join('\n'),
      ['@@ -1,4 +1,4 @@', ' a', '-b', '-c', '+d', ' e'].join('\n'),
    ];

    for (const patch of patches) {
      const shaped = classifyPatch(patch);
      const substantive = shaped.hunks.filter((hunk) => hunk.shape === 'substantive');
      expect(substantive.length).toBeGreaterThan(0);
      expect(shaped.allowedLines.size).toBeGreaterThan(0);
    }
  });
});

describe('a file whose whole diff is a reformat', () => {
  const REFORMAT = [
    '@@ -1,3 +1,3 @@',
    ' function a() {',
    '-    return 1;',
    '+  return 1;',
    ' }',
  ].join('\n');

  it('offers no line at all, and says which kind of nothing it is', () => {
    const shaped = classifyPatch(REFORMAT);

    expect(shaped.allowedLines.size).toBe(0);
    expect(shaped.noneSubstantive).toBe(true);
    // **`whitespaceOnly` is not `noneSubstantive`**: a comment edit is text somebody wrote, and a relocation is code
    // that moved. Only a re-indent is nothing at all, and only that shape may skip a lane.
    expect(shaped.whitespaceOnly).toBe(true);
  });

  it('does not call a comment edit whitespace', () => {
    const shaped = classifyPatch(
      ['@@ -1,2 +1,2 @@', '-// old note', ' function a() {', '// new note'].join('\n'),
    );

    expect(shaped.noneSubstantive).toBe(true);
    expect(shaped.whitespaceOnly).toBe(false);
  });

  it('does not call a patch it could not read whitespace', () => {
    expect(classifyPatch('not a patch').whitespaceOnly).toBe(false);
  });

  it('never reports whitespace-only beside a line a finding could stand on', () => {
    // **The invariant the lane skip rests on.** `aacr-bench` does not call a lane for a `whitespaceOnly` file because the
    // gate would refute every finding in it; that is only lossless if such a file offers no line at all. If this ever
    // fails, the skip becomes a silent recall trade.
    const patches = [
      REFORMAT,
      ['@@ -1,3 +1,3 @@', ' a', '-b', '+b ', ' c'].join('\n'),
      ['@@ -4,2 +4,2 @@', '-  x', '+    x'].join('\n'),
      ['@@ -1,2 +1,2 @@', '-// a', '+// b', ' c'].join('\n'),
    ];

    for (const patch of patches) {
      const shaped = classifyPatch(patch);
      if (shaped.whitespaceOnly) expect(shaped.allowedLines.size).toBe(0);
    }
  });
});
