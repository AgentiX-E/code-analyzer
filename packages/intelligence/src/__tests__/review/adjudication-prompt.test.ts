// @code-analyzer/intelligence — what the second reader is shown, and the line it is told to look at
//
// **The failure this file is written against is an instrument failure, not a prompt failure.** §44's run asked the
// reader *"is this comment true of this code?"* while showing it a patch whose lines carried no numbers and never
// saying which of them the comment was filed on. It answered REFUTED 494 times out of 587, and **two very different
// causes produce that number**: a reader that is too strict, and a reader that cannot find the line. **A prompt that
// does not name the line cannot distinguish them**, so the assertions below are about the coordinate system first and
// the wording second.
//
// **The window test is the one that would have caught the old input.** The 26,926-character patch of
// `DimensionValidators.cpp` in FreeCAD#19411 was clipped from the middle out at 12,000 characters, and a comment at line
// 675 of that file sat in the part that was cut. **The reader was asked about code it was not shown**, and answered
// accordingly.

import { describe, it, expect } from 'vitest';

import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';
import {
  ADJUDICATION_LINE_WINDOW,
  buildAdjudicationPrompt,
  clipCode,
  renderAddedLines,
} from '../../review/adjudication/prompt.js';

import type { LLMFinding } from '../../review/llm/prompts.js';

const finding = (overrides: Partial<LLMFinding> = {}): LLMFinding => ({
  title: 'Vertical line misclassified as horizontal in isValidSingleEdge',
  description:
    'In `isValidSingleEdge`, when the line’s x component is near zero, the function returns `isHorizontal` instead of `isVertical`.',
  severity: 'high',
  category: 'bug',
  startLine: 675,
  endLine: 675,
  suggestion: null,
  ...overrides,
});

/**
 * A patch whose added lines are numbered from `start`, so a window can be too small and a focus can be inside it.
 *
 * **The header states the start the content actually begins at**, which is the one thing a hand-written patch fixture
 * gets wrong: `@@ +660,40 @@` followed by lines that begin at 660 is a patch, and `@@ +659,40 @@` followed by the same
 * lines is a patch whose every number is one lower than the file's. The first version of this helper was the second.
 */
function patchAround(start = 660, count = 40): string {
  const lines = [`@@ -${String(start)},0 +${String(start)},${String(count)} @@`];
  for (let at = start; at < start + count; at += 1)
    lines.push(`+const line${String(at)} = ${String(at)};`);
  return lines.join('\n');
}

describe('numberedAddedLines', () => {
  it('carries the number and the text of every added line', () => {
    const patch = ['@@ -10,2 +10,3 @@', ' context ten', '+added eleven', '+added twelve'].join(
      '\n',
    );
    expect(numberedAddedLines(patch)).toEqual([
      { line: 11, text: 'added eleven' },
      { line: 12, text: 'added twelve' },
    ]);
  });

  it('is null for text that is not a patch, which is the product path handing in a code window', () => {
    expect(numberedAddedLines('const a = 1;\nconst b = 2;')).toBeNull();
  });

  it('is null for hunk headers with no content under them', () => {
    // **The engine’s own `buildDiffContent` emits exactly this**, and reading it as "added nothing" would refuse every
    // comment in the review.
    expect(numberedAddedLines('@@ -8,11 +8,14 @@\n@@ -40,3 +43,4 @@')).toBeNull();
  });

  it('agrees with the set form, because they are one walk', () => {
    const patch = patchAround(300, 12);
    const numbered = numberedAddedLines(patch);
    expect(numbered).not.toBeNull();
    expect(numbered!.map((entry) => entry.line)).toEqual(
      [...new Set(numbered!.map((entry) => entry.line))].sort((a, b) => a - b),
    );
  });
});

describe('renderAddedLines', () => {
  it('numbers every line it prints, in the file’s own numbering', () => {
    const lines = numberedAddedLines(patchAround(660, 6))!;
    const rendered = renderAddedLines(lines, { startLine: 663, endLine: 663 });
    expect(rendered).toContain('663 | const line663 = 663;');
    // The width is shared, so a shorter number is padded rather than ragged.
    expect(rendered.split('\n').every((row) => /^\s*\d+ \| /.test(row))).toBe(true);
  });

  it('window contains the comment’s line even when the patch is far longer than the window', () => {
    // **The defect of §44, as an assertion.** Four hundred added lines and a comment at the four hundredth: the old
    // input clipped the patch from the middle out and the reader never saw it.
    const lines = numberedAddedLines(patchAround(1000, 400))!;
    const rendered = renderAddedLines(lines, { startLine: 1399, endLine: 1399 });
    expect(rendered).toContain('1399 | const line1399 = 1399;');
    expect(rendered.split('\n').length).toBeLessThanOrEqual(ADJUDICATION_LINE_WINDOW + 2);
  });

  it('says what it left out, on the side it left it out', () => {
    const lines = numberedAddedLines(patchAround(1000, 400))!;
    const rendered = renderAddedLines(lines, { startLine: 1399, endLine: 1399 });
    expect(rendered).toMatch(/^\.\.\. \d+ earlier added lines not shown/);
    expect(rendered).not.toContain('later added lines not shown');
  });

  it('a comment past the last added line lands on the last window rather than on nothing', () => {
    const lines = numberedAddedLines(patchAround(660, 10))!;
    const rendered = renderAddedLines(lines, { startLine: 900, endLine: 900 });
    expect(rendered).toContain('line669');
    expect(rendered).not.toContain('line670');
  });

  it('says how many it left out on the later side too', () => {
    // **A comment near the top of a long patch**: the reader sees the first window and is told the rest exists, because
    // a block that silently ends reads as the whole change.
    const lines = numberedAddedLines(patchAround(1000, 400))!;
    const rendered = renderAddedLines(lines, { startLine: 1000, endLine: 1000 });
    expect(rendered).toContain('1000 | const line1000 = 1000;');
    expect(rendered).toContain('later added lines not shown');
    expect(rendered).not.toContain('earlier added lines not shown');
  });

  it('is empty for no lines, which the caller never renders', () => {
    expect(renderAddedLines([], { startLine: 1, endLine: 1 })).toBe('');
  });
});

describe('buildAdjudicationPrompt', () => {
  it('names the line the comment is filed on', () => {
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.cpp',
      finding: finding(),
      addedCode: patchAround(660, 40),
    });
    expect(prompt).toContain('The comment is filed on line 675.');
    expect(prompt).toContain('675 | const line675 = 675;');
  });

  it('states the range when the comment covers more than one line', () => {
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.cpp',
      finding: finding({ startLine: 675, endLine: 679 }),
      addedCode: patchAround(660, 40),
    });
    expect(prompt).toContain('The comment is filed on line 675 and covers lines 675-679.');
  });

  it('shows a code window as code rather than pretending it has numbers', () => {
    // **The product path hands in the block the hunk sits in, and it has no line numbers.** A prompt that claims they
    // are numbered would have the reader cite a number it cannot see - which is worse than asking it to quote.
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.cpp',
      finding: finding(),
      addedCode: 'int f() {\n  return 0;\n}',
    });
    expect(prompt).toContain('this text carries no line numbers');
    expect(prompt).not.toContain('numbered as the file numbers them');
  });

  it('carries the comment, the path and the surrounding block, and no score or lane', () => {
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.cpp',
      finding: finding(),
      addedCode: patchAround(660, 10),
      fileContext: 'void DimensionValidators::check() {}',
    });
    expect(prompt).toContain('File: src/a.cpp');
    expect(prompt).toContain('Vertical line misclassified as horizontal in isValidSingleEdge');
    expect(prompt).toContain('Surrounding code, unchanged lines included:');
    expect(prompt).toContain('DimensionValidators::check');
    expect(prompt).not.toContain('score');
  });

  it('does not claim a surrounding block when there is none', () => {
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.cpp',
      finding: finding(),
      addedCode: patchAround(660, 10),
    });
    expect(prompt).not.toContain('Surrounding code');
  });
});

describe('clipCode', () => {
  it('leaves a block inside the budget alone', () => {
    expect(clipCode('short', 100)).toBe('short');
  });

  it('keeps both ends of a block over the budget and says how much it dropped', () => {
    const code = `${'a'.repeat(60)}${'b'.repeat(40)}${'c'.repeat(60)}`;
    const clipped = clipCode(code, 60);
    expect(clipped.startsWith('a'.repeat(30))).toBe(true);
    expect(clipped.endsWith('c'.repeat(30))).toBe(true);
    expect(clipped).toContain('100 characters not shown');
  });
});
