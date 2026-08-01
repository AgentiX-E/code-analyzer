// @code-analyzer/intelligence — Diff Parser Tests

import { describe, it, expect } from 'vitest';
import { DiffParser } from '../review/diff-parser.js';

import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParser(): DiffParser {
  return new DiffParser();
}

function createSingleHunkDiff(): string {
  return [
    'diff --git a/src/index.ts b/src/index.ts',
    'index abc123..def456 100644',
    '--- a/src/index.ts',
    '+++ b/src/index.ts',
    '@@ -1,5 +1,6 @@',
    ' import { foo } from "./foo";',
    ' ',
    '-export const oldValue = 42;',
    '+export const newValue = 42;',
    '+export const extraValue = 99;',
    ' ',
    ' export function main() {',
  ].join('\n');
}

function createMultiHunkDiff(): string {
  return [
    'diff --git a/src/utils.ts b/src/utils.ts',
    'index 123abc..456def 100644',
    '--- a/src/utils.ts',
    '+++ b/src/utils.ts',
    '@@ -10,4 +10,5 @@',
    ' function helper1() {',
    '   return 1;',
    ' }',
    '+function helper2() {',
    '+  return 2;',
    '+}',
    '@@ -20,3 +21,4 @@',
    ' function main() {',
    '   return helper1();',
    '+  return helper2();',
    ' }',
  ].join('\n');
}

function createMultiFileDiff(): string {
  return [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index a1..b2 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,4 @@',
    ' // Foo module',
    '+export const foo = "bar";',
    ' ',
    ' export default foo;',
    'diff --git a/src/bar.ts b/src/bar.ts',
    'index c3..d4 100644',
    '--- a/src/bar.ts',
    '+++ b/src/bar.ts',
    '@@ -1,2 +1,3 @@',
    ' // Bar module',
    '+export const bar = "baz";',
    ' export { bar };',
  ].join('\n');
}

function createAdditionsOnlyDiff(): string {
  return [
    'diff --git a/newfile.ts b/newfile.ts',
    'new file mode 100644',
    'index 0000000..abc1234',
    '--- /dev/null',
    '+++ b/newfile.ts',
    '@@ -0,0 +1,3 @@',
    '+export const greeting = "hello";',
    '+',
    '+export function sayHello() {',
    '+  return greeting;',
    '+}',
  ].join('\n');
}

function createDeletionsOnlyDiff(): string {
  return [
    'diff --git a/oldfile.ts b/oldfile.ts',
    'deleted file mode 100644',
    'index abc1234..0000000',
    '--- a/oldfile.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-export const old = "value";',
    '-',
    '-export function doOld() {',
    '-  return old;',
    '-}',
  ].join('\n');
}

function createRenameDiff(): string {
  return [
    'diff --git a/old-name.ts b/new-name.ts',
    'similarity index 100%',
    'rename from old-name.ts',
    'rename to new-name.ts',
    '@@ -1,3 +1,3 @@',
    ' // Unchanged content',
    ' ',
    ' export const value = 42;',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Unified Diff Parsing Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Unified Diff Parsing', () => {
  it('should parse empty diff correctly', () => {
    const parser = createParser();
    const result = parser.parseUnifiedDiff('');
    expect(result).toEqual([]);
  });

  it('should parse whitespace-only diff as empty', () => {
    const parser = createParser();
    const result = parser.parseUnifiedDiff('   \n  \n  ');
    expect(result).toEqual([]);
  });

  it('should parse single file with one hunk', () => {
    const parser = createParser();
    const diff = createSingleHunkDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/index.ts');
    expect(result[0]!.ranges.length).toBe(1);
    expect(result[0]!.ranges[0]!.oldStart).toBe(1);
    expect(result[0]!.ranges[0]!.newStart).toBe(1);
    expect(result[0]!.changeType).toBe('modified');
  });

  it('should parse single file with multiple hunks', () => {
    const parser = createParser();
    const diff = createMultiHunkDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/utils.ts');
    expect(result[0]!.ranges.length).toBe(2);
  });

  it('should parse multiple files', () => {
    const parser = createParser();
    const diff = createMultiFileDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(2);
    expect(result[0]!.filePath).toBe('src/foo.ts');
    expect(result[1]!.filePath).toBe('src/bar.ts');
  });

  it('should detect new file additions', () => {
    const parser = createParser();
    const diff = createAdditionsOnlyDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('newfile.ts');
    expect(result[0]!.changeType).toBe('added');
  });

  it('should detect file deletions', () => {
    const parser = createParser();
    const diff = createDeletionsOnlyDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('oldfile.ts');
    expect(result[0]!.changeType).toBe('deleted');
  });

  it('should detect file renames', () => {
    const parser = createParser();
    const diff = createRenameDiff();
    const result = parser.parseUnifiedDiff(diff);

    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('new-name.ts');
    expect(result[0]!.oldPath).toBe('old-name.ts');
    expect(result[0]!.changeType).toBe('renamed');
  });

  it('should skip lines before the first diff header', () => {
    const parser = createParser();
    // Lines before any "diff --git" header should be ignored (inFile is false)
    const diff = [
      'commit abc123def456',
      'Author: Test <test@example.com>',
      'Date:   Mon Jan 1 00:00:00 2024 +0000',
      '',
      '    Some commit message',
      '',
      'diff --git a/src/main.ts b/src/main.ts',
      'index 123..456 100644',
      '--- a/src/main.ts',
      '+++ b/src/main.ts',
      '@@ -1,1 +1,1 @@',
      ' unchanged',
    ].join('\n');

    const result = parser.parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('src/main.ts');
  });
});

// ---------------------------------------------------------------------------
// File Diff Parsing Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Single File Parsing', () => {
  it('should parse a single file diff with patch string', () => {
    const parser = createParser();
    const result = parser.parseFileDiff('test.ts', {
      patch: [
        '@@ -1,3 +1,4 @@',
        ' context',
        '-removed',
        '+added',
        ' context2',
      ].join('\n'),
    });

    expect(result.filePath).toBe('test.ts');
    expect(result.ranges.length).toBe(1);
  });

  it('should provide default range for empty patch', () => {
    const parser = createParser();
    const result = parser.parseFileDiff('test.ts', {});

    expect(result.filePath).toBe('test.ts');
    expect(result.ranges.length).toBe(1);
    expect(result.changeType).toBe('modified');
  });

  it('should detect rename when oldPath differs', () => {
    const parser = createParser();
    const result = parser.parseFileDiff('new.ts', {
      oldPath: 'old.ts',
      patch: [
        '@@ -1,3 +1,3 @@',
        ' context',
        ' context',
        ' context',
      ].join('\n'),
    });

    expect(result.filePath).toBe('new.ts');
    expect(result.oldPath).toBe('old.ts');
    expect(result.changeType).toBe('renamed');
  });
});

// ---------------------------------------------------------------------------
// Extract Additions/Deletions Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Extract Additions and Deletions', () => {
  it('should extract additions from a diff', () => {
    const parser = createParser();
    const diff: GitDiff = {
      filePath: 'test.ts',
      oldHash: 'a',
      newHash: 'b',
      ranges: [
        { oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 5, changeType: 'added' },
      ],
      changeType: 'modified',
    };

    const additions = parser.extractAdditions(diff);
    expect(additions.length).toBe(4); // 5-1 = 4
    expect(additions[0]!.lineNumber).toBe(1);
    expect(additions[3]!.lineNumber).toBe(4);
  });

  it('should extract deletions from a diff', () => {
    const parser = createParser();
    const diff: GitDiff = {
      filePath: 'test.ts',
      oldHash: 'a',
      newHash: 'b',
      ranges: [
        { oldStart: 5, oldEnd: 10, newStart: 5, newEnd: 5, changeType: 'removed' },
      ],
      changeType: 'modified',
    };

    const deletions = parser.extractDeletions(diff);
    expect(deletions.length).toBe(5); // 10-5 = 5
    expect(deletions[0]!.lineNumber).toBe(5);
  });

  it('should handle diff with empty ranges', () => {
    const parser = createParser();
    const diff: GitDiff = {
      filePath: 'test.ts',
      oldHash: 'a',
      newHash: 'b',
      ranges: [],
      changeType: 'modified',
    };

    const additions = parser.extractAdditions(diff);
    const deletions = parser.extractDeletions(diff);
    expect(additions).toHaveLength(0);
    expect(deletions).toHaveLength(0);
  });

  it('should handle diff with multiple ranges', () => {
    const parser = createParser();
    const diff: GitDiff = {
      filePath: 'test.ts',
      oldHash: 'a',
      newHash: 'b',
      ranges: [
        { oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 3, changeType: 'added' },
        { oldStart: 5, oldEnd: 7, newStart: 5, newEnd: 5, changeType: 'removed' },
      ],
      changeType: 'modified',
    };

    const additions = parser.extractAdditions(diff);
    const deletions = parser.extractDeletions(diff);
    expect(additions.length).toBe(2);
    expect(deletions.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Module Grouping Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Module Grouping', () => {
  it('should group diffs by first-level directory', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'src/foo/a.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
      {
        filePath: 'src/foo/b.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
      {
        filePath: 'src/bar/c.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
    ];

    const groups = parser.groupByModule(diffs);
    expect(groups.size).toBe(2);
    expect(groups.get('src/foo')?.length).toBe(2);
    expect(groups.get('src/bar')?.length).toBe(1);
  });

  it('should group root-level files under "root"', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'README.md',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
    ];

    const groups = parser.groupByModule(diffs);
    expect(groups.get('root')).toBeDefined();
    expect(groups.get('root')?.length).toBe(1);
  });

  it('should return empty map for empty diff array', () => {
    const parser = createParser();
    const groups = parser.groupByModule([]);
    expect(groups.size).toBe(0);
  });

  it('should handle deeply nested paths', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'src/components/ui/button/index.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
      {
        filePath: 'src/components/ui/input/index.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
      {
        filePath: 'src/utils/helpers.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
    ];

    const groups = parser.groupByModule(diffs);
    expect(groups.get('src/components/ui/button')?.length).toBe(1);
    expect(groups.get('src/components/ui/input')?.length).toBe(1);
    expect(groups.get('src/utils')?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rename Detection Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Rename Detection', () => {
  it('should detect renamed files', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'new-name.ts',
        oldPath: 'old-name.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'renamed',
      },
    ];

    const renames = parser.detectRenames(diffs);
    expect(renames).toHaveLength(1);
    expect(renames[0]!.oldPath).toBe('old-name.ts');
    expect(renames[0]!.newPath).toBe('new-name.ts');
  });

  it('should not detect non-renamed files', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'test.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'modified',
      },
    ];

    const renames = parser.detectRenames(diffs);
    expect(renames).toHaveLength(0);
  });

  it('should detect multiple renames', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'new-a.ts',
        oldPath: 'old-a.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'renamed',
      },
      {
        filePath: 'new-b.ts',
        oldPath: 'old-b.ts',
        oldHash: 'a', newHash: 'b', ranges: [],
        changeType: 'renamed',
      },
    ];

    const renames = parser.detectRenames(diffs);
    expect(renames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Statistics Computation Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Statistics', () => {
  it('should compute stats for multiple files', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      {
        filePath: 'src/app.ts',
        oldHash: 'a', newHash: 'b',
        ranges: [
          { oldStart: 1, oldEnd: 5, newStart: 1, newEnd: 10, changeType: 'modified' },
        ],
        changeType: 'modified',
      },
      {
        filePath: 'src/lib.py',
        oldHash: 'a', newHash: 'b',
        ranges: [
          { oldStart: 1, oldEnd: 0, newStart: 1, newEnd: 3, changeType: 'added' },
        ],
        changeType: 'added',
      },
    ];

    const stats = parser.computeStats(diffs);
    expect(stats.filesChanged).toBe(2);
    expect(stats.languages).toBeDefined();
    expect(stats.largestFile).not.toBeNull();
  });

  it('should detect languages correctly', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      { filePath: 'src/app.ts', oldHash: 'a', newHash: 'b', ranges: [], changeType: 'modified' },
      { filePath: 'src/lib.py', oldHash: 'a', newHash: 'b', ranges: [], changeType: 'modified' },
      { filePath: 'src/main.go', oldHash: 'a', newHash: 'b', ranges: [], changeType: 'modified' },
    ];

    const stats = parser.computeStats(diffs);
    expect(stats.languages['TypeScript']).toBe(1);
    expect(stats.languages['Python']).toBe(1);
    expect(stats.languages['Go']).toBe(1);
  });

  it('should handle empty diffs', () => {
    const parser = createParser();
    const stats = parser.computeStats([]);

    expect(stats.filesChanged).toBe(0);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
    expect(stats.largestFile).toBeNull();
  });

  it('should handle files with unknown extensions', () => {
    const parser = createParser();
    const diffs: GitDiff[] = [
      { filePath: 'Dockerfile', oldHash: 'a', newHash: 'b', ranges: [], changeType: 'modified' },
      { filePath: 'Makefile', oldHash: 'a', newHash: 'b', ranges: [], changeType: 'modified' },
    ];

    const stats = parser.computeStats(diffs);
    expect(stats.filesChanged).toBe(2);
    expect(stats.languages['Other']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Hunk Parsing Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Hunk Parsing', () => {
  it('should parse hunks with default counts (both omitted)', () => {
    const parser = createParser();
    // @@ -1 +1 @@ means oldStart=1, oldCount=1 (default), newStart=1, newCount=1 (default)
    const lines = ['@@ -1 +1 @@', ' context'];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(1);
    expect(hunks[0]!.oldCount).toBe(1);
    expect(hunks[0]!.newStart).toBe(1);
    expect(hunks[0]!.newCount).toBe(1);
  });

  it('should parse hunks with default counts (only old omitted)', () => {
    const parser = createParser();
    const lines = ['@@ -1 +1,2 @@', '+added line', ' context'];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(1);
    expect(hunks[0]!.oldCount).toBe(1);
    expect(hunks[0]!.newStart).toBe(1);
    expect(hunks[0]!.newCount).toBe(2);
  });

  it('should parse hunks with explicit counts', () => {
    const parser = createParser();
    const lines = ['@@ -10,5 +20,7 @@', ' context', '+added line', '-removed line', ' context'];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(10);
    expect(hunks[0]!.oldCount).toBe(5);
    expect(hunks[0]!.newStart).toBe(20);
    expect(hunks[0]!.newCount).toBe(7);
  });

  it('should handle "No newline at end of file" markers', () => {
    const parser = createParser();
    const lines = [
      '@@ -1,1 +1,1 @@',
      '-old line',
      '+new line',
      '\\ No newline at end of file',
    ];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
    // The "no newline" marker should be skipped
    expect(hunks[0]!.lines.length).toBe(2);
  });

  it('should skip lines before first hunk header', () => {
    const parser = createParser();
    const lines = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' content'];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
  });

  it('should handle multiple hunks', () => {
    const parser = createParser();
    const lines = [
      '@@ -1,3 +1,3 @@',
      ' context',
      ' context',
      ' context',
      '@@ -10,2 +10,3 @@',
      ' context',
      '+added',
      ' context',
    ];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(2);
  });

  it('should return empty array for empty input', () => {
    const parser = createParser();
    const hunks = parser.parseHunks([]);
    expect(hunks).toHaveLength(0);
  });

  it('should classify added, removed, and context lines', () => {
    const parser = createParser();
    const lines = [
      '@@ -1,2 +1,3 @@',
      ' context line',
      '+added line',
      '-removed line',
      ' more context',
    ];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0]!;
    expect(hunk.lines[0]!.type).toBe('context');
    expect(hunk.lines[1]!.type).toBe('added');
    expect(hunk.lines[2]!.type).toBe('removed');
    expect(hunk.lines[3]!.type).toBe('context');
  });

  it('should assign correct line numbers', () => {
    const parser = createParser();
    const lines = [
      '@@ -5,3 +10,4 @@',
      ' context',       // old:5 new:10
      '+added line',    // old:0 new:11
      '-removed body',  // old:6 new:0
      ' end context',   // old:7 new:11
    ];

    const hunks = parser.parseHunks(lines);
    const added = hunks[0]!.lines.filter((l) => l.type === 'added');
    const removed = hunks[0]!.lines.filter((l) => l.type === 'removed');

    expect(added).toHaveLength(1);
    expect(added[0]!.newLineNumber).toBe(11);
    expect(added[0]!.oldLineNumber).toBe(0);

    expect(removed).toHaveLength(1);
    expect(removed[0]!.oldLineNumber).toBe(6);
    expect(removed[0]!.newLineNumber).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe('DiffParser - Edge Cases', () => {
  it('should handle diff with only context lines (no changes)', () => {
    const parser = createParser();
    const diff = [
      'diff --git a/file.ts b/file.ts',
      'index abc..def 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      ' same line 1',
      ' same line 2',
    ].join('\n');

    const result = parser.parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]!.changeType).toBe('modified');
  });

  it('should skip binary file diffs', () => {
    const parser = createParser();
    const diff = [
      'diff --git a/image.png b/image.png',
      'Binary files a/image.png and b/image.png differ',
    ].join('\n');

    const result = parser.parseUnifiedDiff(diff);
    // Binary files should be skipped
    expect(
      result.filter((r) => r.filePath === 'image.png'),
    ).toHaveLength(0);
  });

  it('should handle diff with file mode changes only', () => {
    const parser = createParser();
    const diff = [
      'diff --git a/script.sh b/script.sh',
      'index abc..def 100644',
      'old mode 100644',
      'new mode 100755',
      '--- a/script.sh',
      '+++ b/script.sh',
      '@@ -1,1 +1,1 @@',
      ' unchanged content',
    ].join('\n');

    const result = parser.parseUnifiedDiff(diff);
    // Should produce a diff entry with the file path
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('script.sh');
  });

  it('should parse hunks with @@ in code content', () => {
    const parser = createParser();
    const lines = [
      '@@ -1,1 +1,1 @@',
      ' // This is not a hunk header @@ -2,1 +2,1 @@',
    ];

    const hunks = parser.parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(1);
  });
});
