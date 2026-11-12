// A finding is located by the code it quotes, not by the line number it guessed
//
// **The contract the competitor's `code_comment` tool enforces and ours did not.** A model's line number is the part of
// its answer that drifts; the string it copied is the part that can be checked. `internal/diff/resolver.go` in
// `alibaba/open-code-review` matches `existing_code` against the diff's hunks and then against the file's content, and
// returns a comment with no location when neither matches.
//
// **These cases are the locator's whole decision surface**, because a locator that is wrong in a way nobody measured is
// a reviewer that files findings on the wrong line and is believed.

import { describe, expect, it } from 'vitest';

import {
  locateInDiff,
  locateInFile,
  locateSnippetLines,
} from '../../../../packages/intelligence/src/review/agent/grounding.js';

const FILE = [
  'import { x } from "./x";',
  '',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
  'export function multiply(a: number, b: number): number {',
  '  return a * b;',
  '}',
  '',
  '// a repeated block, twice, so a tie has to be broken',
  'const limit = 10;',
  '',
  '// a repeated block, twice, so a tie has to be broken',
  'const limit = 10;',
];

describe('a snippet is found where it is, not where it was claimed', () => {
  it('reports a byte-exact quote as exact, at the line it sits on', () => {
    const located = locateSnippetLines(FILE, 'return a + b;');
    expect(located).not.toBeNull();
    expect(located?.startLine).toBe(4);
    expect(located?.endLine).toBe(4);
    expect(located?.quality).toBe('exact');
  });

  it('reports a re-indented quote as normalised rather than exact', () => {
    const located = locateSnippetLines(FILE, 'return    a   +  b;');
    expect(located?.quality).toBe('normalised');
    expect(located?.startLine).toBe(4);
  });

  it('accepts a quote that still carries its diff markers', () => {
    const located = locateSnippetLines(FILE, '+  return a + b;');
    expect(located?.startLine).toBe(4);
  });

  it('breaks a tie with the caller’s hint and says that it did', () => {
    // **The second occurrence is at line 15 and the first at line 12**, so a hint at 14 has to choose and the distance
    // is what chooses: 1 against 2.
    const near = locateSnippetLines(FILE, 'const limit = 10;', 14);
    expect(near?.quality).toBe('disambiguated');
    expect(near?.startLine).toBe(15);
    const other = locateSnippetLines(FILE, 'const limit = 10;', 12);
    expect(other?.startLine).toBe(12);
    const first = locateSnippetLines(FILE, 'const limit = 10;');
    expect(first?.quality).toBe('disambiguated');
    // **No hint means the first occurrence**, which is deterministic rather than arbitrary.
    expect(first?.startLine).toBe(12);
  });

  it('anchors on a first line whose tail the model paraphrased, and reports how much it matched', () => {
    const quoted = [
      'export function multiply(a: number, b: number): number {',
      'return a * b // wrong tail',
    ];
    const located = locateSnippetLines(FILE, quoted.join('\n'));
    expect(located?.quality).toBe('anchored');
    expect(located?.startLine).toBe(7);
    expect(located?.matchedLines).toBe(1);
    expect(located?.snippetLines).toBe(2);
  });

  it('ignores the blank lines a fenced quote carries at its edges', () => {
    const located = locateSnippetLines(FILE, '\n\n  return a + b;  \n\n');
    expect(located?.startLine).toBe(4);
    expect(located?.snippetLines).toBe(1);
  });

  it('prefers the anchor whose remainder matches most, when the first line occurs twice', () => {
    const file = ['anchor();', 'x();', 'y();', 'z();', 'w();', 'v();', 'anchor();', 'b();', 'c();'];
    // **The first line is at 1 and at 7, and only the second one has a tail that follows it.** A locator that took the
    // first anchor would put the finding on line 1 of a file whose defect is on line 8.
    const located = locateSnippetLines(file, ['anchor();', 'b();', 'c();', 'd();'].join('\n'));
    expect(located?.quality).toBe('anchored');
    expect(located?.startLine).toBe(7);
    expect(located?.matchedLines).toBe(3);
  });

  it('anchors on a first line that is unique while the tail skips a line the model omitted', () => {
    const file = [
      'const handler = async () => {',
      '  const a = 1;',
      '  const b = 2;',
      '  return a;',
      '};',
    ];
    const located = locateSnippetLines(
      file,
      ['const handler = async () => {', '  const a = 1;', '  return a;', '};'].join('\n'),
    );
    expect(located?.quality).toBe('anchored');
    expect(located?.startLine).toBe(1);
    // **Every line of the quote is in the file**, and one line of the file is missing from the quote - which is what a
    // model that quoted the lines it cared about produces, and what the anchor is for.
    expect(located?.matchedLines).toBe(4);
  });

  it('refuses a quote that is not in the file, rather than guessing a nearby line', () => {
    expect(locateSnippetLines(FILE, 'return a / b;')).toBeNull();
  });

  it('refuses a half-remembered block whose majority is missing', () => {
    const quoted = [
      'export function multiply(a: number, b: number): number {',
      'nothing here',
      'nor here',
      'nor this',
      'nor that',
    ].join('\n');
    expect(locateSnippetLines(FILE, quoted)).toBeNull();
  });

  it('refuses an empty snippet, and a short anchor that does not match exactly', () => {
    expect(locateSnippetLines(FILE, '   \n  ')).toBeNull();
    // **`}` occurs twice and is short, so it can only be found exactly**; a paraphrase of it is nothing to go on.
    expect(locateSnippetLines(FILE, '} }')).toBeNull();
    expect(locateSnippetLines(FILE, '}')?.quality).toBe('disambiguated');
  });

  it('refuses a snippet longer than the file', () => {
    expect(locateSnippetLines(['a'], 'a\nb\nc')).toBeNull();
  });

  it('reports the line in the file’s coordinates when the read started part-way down', () => {
    const located = locateInFile(
      { path: 'a.ts', text: 'return a + b;\n}', truncated: false, firstLine: 4 },
      'return a + b;',
    );
    expect(located?.startLine).toBe(4);
  });
});

describe('a quote is located in a diff in the new file’s coordinates', () => {
  const DIFF = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,4 +3,5 @@ export function add',
    ' const before = 1;',
    '-const removed = 2;',
    '+const added = 2;',
    '+const alsoAdded = 3;',
    ' }',
  ].join('\n');

  it('numbers added and context lines and skips removed ones', () => {
    expect(locateInDiff(DIFF, 'const added = 2;')?.startLine).toBe(4);
    expect(locateInDiff(DIFF, 'const alsoAdded = 3;')?.startLine).toBe(5);
    expect(locateInDiff(DIFF, 'const before = 1;')?.startLine).toBe(3);
  });

  it('refuses a quote of a line the change removed', () => {
    expect(locateInDiff(DIFF, 'const removed = 2;')).toBeNull();
  });

  it('refuses a diff with no content lines at all', () => {
    expect(locateInDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n', 'anything')).toBeNull();
  });
});
