// **A reviewer reads a change one file at a time, and the text of the change was being thrown away.**
//
// `resolveChangeSet` fetches the patch and parses it into `GitDiff[]`, whose `ranges` carry line numbers and no text — so
// by the time `review pr` had a change to hand a reviewer, the only thing left was a map of file paths. **The reading
// arm files nothing without a diff**: it shows the model the change, it grounds a comment against an added line when the
// file cannot be read, and it refuses a quote that is in neither. So the patch is carried out of the resolver and split
// here, because **re-rendering a diff from ranges and file contents would be a second renderer that has to agree with
// git's, and one that disagrees is a review of a change that never happened.**

import { describe, expect, it } from 'vitest';

import { splitPatchByPath } from '@code-analyzer/intelligence';

/** A patch of two files, written the way git writes it. */
const TWO_FILES = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' export const a = 1;',
  '+export const b = 2;',
  ' export const c = 3;',
  'diff --git a/src/dir/b.ts b/src/dir/b.ts',
  'index 3333333..4444444 100644',
  '--- a/src/dir/b.ts',
  '+++ b/src/dir/b.ts',
  '@@ -1 +1 @@',
  '-const value = 1;',
  '+const value = 2;',
].join('\n');

describe('a patch, split the way a reviewer reads it', () => {
  it('gives one chunk per file, keyed by the path after the change', () => {
    const chunks = splitPatchByPath(TWO_FILES);
    expect([...chunks.keys()]).toEqual(['src/a.ts', 'src/dir/b.ts']);
    expect(chunks.get('src/a.ts')).toContain('+export const b = 2;');
    expect(chunks.get('src/dir/b.ts')).toContain('+const value = 2;');
    // **Each chunk is a diff on its own**, so `locateInDiff` can read it without knowing where it came from.
    for (const chunk of chunks.values()) expect(chunk.startsWith('diff --git a/')).toBe(true);
  });

  it('keys a rename by the new path, because a comment anchors on the file that exists', () => {
    const chunks = splitPatchByPath(
      [
        'diff --git a/src/old.ts b/src/new.ts',
        '--- a/src/old.ts',
        '+++ b/src/new.ts',
        '@@ -0,0 +1 @@',
        '+x',
      ].join('\n'),
    );
    expect([...chunks.keys()]).toEqual(['src/new.ts']);
  });

  it('does not split on a line that merely contains a header', () => {
    // **A fixture inside a test corpus is a real case**: this repository's own parser tests carry diffs in source files,
    // and a chunk boundary drawn at an added line that reads `diff --git` would turn one file into two.
    const chunks = splitPatchByPath(
      [
        'diff --git a/src/fixture.ts b/src/fixture.ts',
        '--- a/src/fixture.ts',
        '+++ b/src/fixture.ts',
        '@@ -1,1 +1,2 @@',
        " const sample = 'diff --git a/x b/y';",
        "+const other = 'diff --git a/p b/q';",
      ].join('\n'),
    );
    expect([...chunks.keys()]).toEqual(['src/fixture.ts']);
    expect(chunks.get('src/fixture.ts')).toContain("+const other = 'diff --git a/p b/q';");
  });

  it('returns nothing for a patch with no header rather than inventing a path', () => {
    // **The caller has to handle this**, and an empty map is what makes it handle it: a single-file patch without the
    // `diff --git` line has no path in it, and a chunk filed under a guessed name is a comment on the wrong file.
    expect(splitPatchByPath('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b').size).toBe(0);
    expect(splitPatchByPath('').size).toBe(0);
  });

  it('drops what precedes the first header instead of attaching it to the first file', () => {
    // **`git format-patch` writes a commit message above the first `diff --git`**, and a chunk that began with it would
    // hand `locateInDiff` prose where it expects hunks - the quote would fail to resolve and the finding would be
    // discarded as unevidenced. The preamble is not part of any file, so it belongs to none.
    const chunks = splitPatchByPath(
      [
        'From 1234567 Mon Sep 17 00:00:00 2001',
        'Subject: [PATCH] add a field',
        '',
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '+export const a = 2;',
      ].join('\n'),
    );
    expect([...chunks.keys()]).toEqual(['src/a.ts']);
    expect(chunks.get('src/a.ts')?.startsWith('diff --git a/src/a.ts')).toBe(true);
    expect(chunks.get('src/a.ts')).not.toContain('Subject:');
  });
});
