// @code-analyzer/intelligence — the window around a hunk, tested as a window
//
// **The claim these tests are for.** `docs/EVAL-CONTRACT.md` §20 registers one measurement - whether showing a lane the
// block each hunk sits in recovers any of the 160 goldens that were rejected with a finding standing on their own line.
// That measurement needs a corpus, a model and money. **What it cannot tell you is whether the window was ever built**,
// and a run that quietly sent no context would report the off-arm's figure as the on-arm's - the failure this batch of
// tests exists to make impossible, at no cost and before the run rather than after it.
//
// **What they deliberately do not claim.** They do not claim the window helps. A test that asserted a better F1 would be
// a test of a mock, and the honest instrument for that question is a paired run over the same goldens.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CODE_CONTEXT_LIMITS,
  changedRangesFromDiff,
  codeContextForFile,
  codeContextForSections,
  hunkAnchorsFromDiff,
} from '../code-context.js';

/** A file whose shape is unambiguous: one function, three braces deep, with the change on line 6. */
const TYPESCRIPT = [
  'import { readFile } from "node:fs";', // 1
  '', // 2
  'export function load(path) {', // 3
  '  const raw = readFile(path);', // 4
  '  // the guard', // 5
  '  if (!raw) return null;', // 6
  '  return parse(raw);', // 7
  '}', // 8
  '', // 9
  'export function parse(raw) {', // 10
  '  return raw;', // 11
  '}', // 12
].join('\n');

const DIFF_ONE_HUNK = [
  'diff --git a/src/load.ts b/src/load.ts',
  '--- a/src/load.ts',
  '+++ b/src/load.ts',
  '@@ -4,3 +4,4 @@',
  '   const raw = readFile(path);',
  '+  // the guard',
  '   if (!raw) return null;',
].join('\n');

describe('a diff says where its hunks land in the new file', () => {
  it('reads every hunk extent, because a change is read with the context lines it shipped with', () => {
    const diff = ['@@ -4,3 +4,4 @@', '@@ -40,7 +41,9 @@', 'diff --git a/x b/x'].join('\n');

    expect(changedRangesFromDiff(diff)).toEqual([
      { startLine: 4, endLine: 7 },
      { startLine: 41, endLine: 49 },
    ]);
  });

  it('treats a header with no count as the one line git means by it', () => {
    expect(changedRangesFromDiff('@@ -12 +12 @@')).toEqual([{ startLine: 12, endLine: 12 }]);
  });

  it('gives a pure deletion one line of window rather than an inverted range', () => {
    // `+7,0` is what git writes for a hunk that removes lines and adds none: it covers no line of the new file, and a
    // range whose end precedes its start would be a window nobody can render.
    expect(changedRangesFromDiff('@@ -7,3 +7,0 @@')).toEqual([{ startLine: 7, endLine: 7 }]);
  });

  it('skips a header that names no line of the new file', () => {
    // `@@ -1 +0,1 @@` is a hunk written against a file that does not exist in the new revision. It is a coordinate with
    // no line in it, and a window built from line zero would name a line the file does not have.
    expect(changedRangesFromDiff('@@ -1 +0,1 @@')).toEqual([]);
  });

  it('returns nothing for a document with no header, rather than inventing line one', () => {
    expect(changedRangesFromDiff('--- a/x\n+++ b/x\n+added')).toEqual([]);
  });
});

describe('the block a hunk sits in, with the coordinates a model cannot recover', () => {
  it('widens from the hunk to the function around it and names the lines', () => {
    const window = codeContextForFile(
      'src/load.ts',
      TYPESCRIPT,
      changedRangesFromDiff(DIFF_ONE_HUNK),
    );

    // The header is the coordinate: without it a finding about line 6 of a window that begins at line 3 is a finding
    // about the wrong line, and the engine's own range check would discard it.
    expect(window.split('\n')[0]).toBe('### src/load.ts — lines 3-8 of 12 — changed at 4-7');
    // The whole function, not the three-line hunk: line 3 opens the block and line 8 closes it.
    expect(window).toContain('export function load(path) {');
    expect(window).toContain('return parse(raw);');
    // And nothing from the next function, because the block ended.
    expect(window).not.toContain('export function parse(raw)');
  });

  it('falls back to the hunk plus padding in a language whose blocks are indentation', () => {
    const python = [
      'def load(path):', // 1
      '    raw = read(path)', // 2
      '    if not raw:', // 3
      '        return None', // 4
      '    return parse(raw)', // 5
    ].join('\n');

    const window = codeContextForFile('load.py', python, [{ startLine: 3, endLine: 3 }], {
      ...DEFAULT_CODE_CONTEXT_LIMITS,
      padding: 1,
    });

    expect(window.split('\n')[0]).toBe('### load.py — lines 2-4 of 5 — changed at 3-3');
    expect(window).toContain('if not raw:');
    expect(window).not.toContain('def load');
  });

  it('treats a brace inside a string as a character and not as a block', () => {
    const file = ['const a = "{";', 'function f() {', '  return a;', '}'].join('\n');

    const window = codeContextForFile('a.ts', file, [{ startLine: 3, endLine: 3 }]);

    // The `{` in the string would have put the depth at two and made line 1 the block's start.
    expect(window.split('\n')[0]).toBe('### a.ts — lines 2-4 of 4 — changed at 3-3');
  });

  it('refuses to guess a block when the file cannot be balanced, and widens instead', () => {
    // A multi-line template literal closes a brace the scanner never opened, so the depth goes negative. **The fallback
    // is the hunk plus padding**: a window that is merely wider is honest, and one that claims to be a function when it
    // is not is a false statement in the prompt.
    const file = ['const t = `', '}`,', 'function f() {', '  return 1;', '}'].join('\n');

    const window = codeContextForFile('a.ts', file, [{ startLine: 4, endLine: 4 }], {
      ...DEFAULT_CODE_CONTEXT_LIMITS,
      padding: 1,
    });

    expect(window.split('\n')[0]).toBe('### a.ts — lines 3-5 of 5 — changed at 4-4');
    expect(window).not.toContain('const t');
  });

  it('clips a block that is longer than the limit rather than sending a whole file', () => {
    const body = Array.from({ length: 200 }, (_, at) => `  line(${String(at)});`).join('\n');
    const file = `function huge() {\n${body}\n}`;

    const window = codeContextForFile('huge.ts', file, [{ startLine: 100, endLine: 100 }], {
      ...DEFAULT_CODE_CONTEXT_LIMITS,
      maxBlockLines: 40,
      padding: 2,
    });

    expect(window.split('\n')[0]).toBe(`### huge.ts — lines 98-102 of 202 — changed at 100-100`);
    expect(window.split('\n')).toHaveLength(1 + 5);
  });

  it('merges two hunks that touch, so a contiguous change is one window', () => {
    const file = ['function f() {', '  a();', '  b();', '}'].join('\n');

    const window = codeContextForFile('a.ts', file, [
      { startLine: 2, endLine: 2 },
      { startLine: 3, endLine: 3 },
    ]);

    expect(window.split('\n')[0]).toBe('### a.ts — lines 1-4 of 4 — changed at 2-2, 3-3');
    expect(window).not.toContain('... ');
  });

  it('reads a comment marker and a string literal without counting their braces', () => {
    // A brace where no code exists is the same mistake in the other direction from a missed one: **it moves the block
    // boundary, and every line number in the window then disagrees with the file.** Three spellings, three languages -
    // `// {` in TypeScript, `# {` in PHP, and a `{` inside a string with an escaped quote.
    const ts = ['function h() {', '  const a = 1; // {', '  return a;', '}'].join('\n');
    const php = ['function f() {', '  $x = 1; # {', '  return $x;', '}'].join('\n');
    const quoted = ['const s = "\\"{";', 'function g() {', '  return s;', '}'].join('\n');

    expect(codeContextForFile('h.ts', ts, [{ startLine: 3, endLine: 3 }]).split('\n')[0]).toBe(
      '### h.ts — lines 1-4 of 4 — changed at 3-3',
    );
    // Without the `#` rule the depth at line 3 would be two and the window would start at the comment rather than at
    // the function - a one-line difference that is invisible in a review and wrong in every line number it prints.
    expect(codeContextForFile('f.php', php, [{ startLine: 3, endLine: 3 }]).split('\n')[0]).toBe(
      '### f.php — lines 1-4 of 4 — changed at 3-3',
    );
    expect(codeContextForFile('b.ts', quoted, [{ startLine: 3, endLine: 3 }]).split('\n')[0]).toBe(
      '### b.ts — lines 2-4 of 4 — changed at 3-3',
    );
  });

  it('says how much of the window it did not show, rather than clipping in silence', () => {
    const body = Array.from({ length: 400 }, () => '  const value = compute();').join('\n');
    const file = `function f() {\n${body}\n}`;

    const window = codeContextForFile('f.ts', file, [{ startLine: 200, endLine: 200 }], {
      ...DEFAULT_CODE_CONTEXT_LIMITS,
      maxBlockLines: 500,
      maxCharsPerFile: 900,
    });

    expect(window.length).toBeLessThanOrEqual(900);
    expect(window).toMatch(/\.\.\. \[\d+ characters of this window not shown\] \.\.\.$/);
  });

  it('does not step back over a line that opened more than one level, because that line is not this block', () => {
    // `function f() { if (x) {` opens two blocks on one line. The window starts where the block starts - leaving the
    // step-back out rather than reaching two levels up, which would pull the previous statement into a function window.
    const file = ['const o = {};', 'function f() { if (x) {', '  a();', '} }'].join('\n');

    const window = codeContextForFile('a.ts', file, [{ startLine: 3, endLine: 3 }]);

    expect(window.split('\n')[0]).toBe('### a.ts — lines 2-4 of 4 — changed at 3-3');
    expect(window).not.toContain('const o');
  });

  it('treats a window entirely past the end of the file as no window and shows the head instead', () => {
    // The corpus carries coordinates from a revision the caller may not have; a window computed from line 50 of a
    // three-line file is a window with no lines in it, and the fallback is the head rather than an empty string.
    const window = codeContextForFile('short.ts', 'a\nb\nc', [{ startLine: 50, endLine: 60 }]);

    expect(window.split('\n')[0]).toBe('### short.ts — lines 1-3 of 3 — changed at 50-60');
  });

  it('returns nothing for a file with no content, which is not the same as a file with no window', () => {
    expect(codeContextForFile('empty.ts', '', [{ startLine: 1, endLine: 1 }])).toBe('');
  });

  it('clamps a range that runs past the end of the file instead of reading undefined lines', () => {
    const window = codeContextForFile('short.ts', 'only one line', [{ startLine: 1, endLine: 99 }]);

    expect(window.split('\n')[0]).toBe('### short.ts — lines 1-1 of 1 — changed at 1-99');
    expect(window).toContain('only one line');
  });

  it('shows the head of a file whose diff had no hunk header', () => {
    // A caller that passed a diff the scanner could not read still named a file, and an empty window would be
    // indistinguishable from a file that could not be read at all.
    const window = codeContextForFile('noheader.ts', TYPESCRIPT, [], {
      ...DEFAULT_CODE_CONTEXT_LIMITS,
      padding: 1,
    });

    expect(window.split('\n')[0]).toBe('### noheader.ts — lines 1-3 of 12 — changed at (unknown)');
  });
});

describe('a pull request gets the windows it can afford, and says what it left out', () => {
  const sections = [
    { path: 'a.ts', diffText: DIFF_ONE_HUNK, fileText: TYPESCRIPT },
    {
      path: 'b.ts',
      diffText: DIFF_ONE_HUNK.replace(/load/g, 'save'),
      fileText: TYPESCRIPT.replace(/load/g, 'save'),
    },
    // A file the caller could not read contributes nothing, and **omitting it is the behaviour the option already had**:
    // an empty window would tell a model the file is empty.
    { path: 'c.ts', diffText: DIFF_ONE_HUNK },
  ];

  it('builds one window per readable file and skips the ones it could not read', () => {
    const context = codeContextForSections(sections);

    expect(context).toContain('### a.ts — lines 3-8 of 12');
    expect(context).toContain('### b.ts — lines 3-8 of 12');
    expect(context).not.toContain('c.ts');
  });

  it('stops at the total budget and counts the files it did not show', () => {
    const context = codeContextForSections(sections, DEFAULT_CODE_CONTEXT_LIMITS, 200);

    expect(context).toContain('a.ts');
    expect(context).toContain('1 more file(s) not shown');
  });

  it('returns an empty string when nothing could be read, so the prompt is byte-identical to the old one', () => {
    expect(codeContextForSections([])).toBe('');
    expect(codeContextForSections([{ path: 'a.ts', diffText: DIFF_ONE_HUNK }])).toBe('');
  });
});

describe('a window is checked against the diff before it is sent', () => {
  const diff = [
    'diff --git a/src/load.ts b/src/load.ts',
    '--- a/src/load.ts',
    '+++ b/src/load.ts',
    '@@ -4,3 +4,4 @@',
    '   const raw = readFile(path);',
    '+  // the guard',
    '   if (!raw) return null;',
  ].join('\n');

  it('anchors on the first line the hunk adds, because a context line is the same in both revisions', () => {
    // **This is the whole discrimination**: line 4 is `readFile(path)` before the change and after it, so an anchor on
    // it would accept a file read at the wrong commit. The added line is not there before, and cannot be.
    expect(hunkAnchorsFromDiff(diff)).toEqual([{ line: 5, text: '  // the guard' }]);
  });

  it('falls back to the first context line for a hunk that adds nothing', () => {
    const deleting = [
      '@@ -4,3 +4,3 @@',
      '-  const raw = readFile(path);',
      '+  const raw = read(path);',
    ].join('\n');

    expect(hunkAnchorsFromDiff(deleting)).toEqual([{ line: 4, text: '  const raw = read(path);' }]);
  });

  it('refuses the window when the file is the revision before the change', () => {
    // The same file with the guard not yet added: line 4 holds the guard in the new revision and the reader in the old
    // one, and every line below it is one out. **A window built from this would be true about a file that no longer
    // exists**, and the prompt would be wrong in a way nobody could see.
    const before = [
      'import { readFile } from "node:fs";',
      '',
      'export function load(path) {',
      '  const raw = readFile(path);',
      '  if (!raw) return null;',
      '  return parse(raw);',
      '}',
    ].join('\n');

    expect(
      codeContextForFile(
        'src/load.ts',
        before,
        changedRangesFromDiff(diff),
        undefined,
        hunkAnchorsFromDiff(diff),
      ),
    ).toBe('');
    const context = codeContextForSections([
      { path: 'src/load.ts', diffText: diff, fileText: before },
    ]);
    expect(context).toBe('');
  });

  it('accepts the window when the file answers to the diff, and says which files it refused otherwise', () => {
    const sections = [
      { path: 'src/load.ts', diffText: diff, fileText: TYPESCRIPT },
      {
        path: 'src/other.ts',
        diffText: diff,
        fileText: TYPESCRIPT.replace('// the guard', '// a guard'),
      },
    ];

    const context = codeContextForSections(sections);

    expect(context).toContain('### src/load.ts');
    // **Both a refusal and an omission are named**, because a run whose windows silently halved would publish a
    // half-strength device as the device.
    expect(context).toContain(
      '1 file(s) not shown: the text at the changed line did not match the diff',
    );
  });
});
