// **The one read every measurement goes through, tested on real files rather than on a stubbed filesystem.**
//
// `readHead` is shared by the lexical control and by the file-level fallback, so a defect here would move both figures
// in the same direction and would therefore be invisible in the difference between them - which is the figure the whole
// artifact publishes. That is the reason this file exists at all: the function is four lines long and it is the only
// place where a cap is actually applied.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readHead } from '../search/file-head.js';

describe('readHead', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'read-head-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a file shorter than the cap in full', () => {
    const path = join(root, 'short.txt');
    writeFileSync(path, 'import a\nimport b\n');
    expect(readHead(path, 65_536)).toBe('import a\nimport b\n');
  });

  it('**stops at the cap rather than at the file**, which is the whole point of the function', () => {
    // A file of `cap + 10` bytes read with `cap` returns exactly `cap` bytes: a reader that returned the file would be
    // the one the analyser's own kills are made of, and a reader that returned nothing would silently index an empty
    // document and call it a document.
    const path = join(root, 'long.txt');
    writeFileSync(path, 'x'.repeat(1_010));
    const head = readHead(path, 1_000);
    expect(head).not.toBeNull();
    expect(head!.length).toBe(1_000);
    expect(head).toBe('x'.repeat(1_000));
  });

  it('cuts at a byte boundary the caller can predict, so a cap of zero is an empty head', () => {
    const path = join(root, 'any.txt');
    writeFileSync(path, 'content');
    expect(readHead(path, 0)).toBe('');
  });

  it('answers an empty file with an empty head rather than with null', () => {
    // **Empty is a reading; absent is not.** The two are counted separately by both instruments - `unreadableFiles`
    // for `null`, a document of no terms for `''` - so collapsing them here would lose a distinction the artifact
    // publishes.
    const path = join(root, 'empty.txt');
    writeFileSync(path, '');
    expect(readHead(path, 1_000)).toBe('');
  });

  it('answers null for a path that does not exist', () => {
    expect(readHead(join(root, 'absent.txt'), 1_000)).toBeNull();
  });

  it('answers null for a path that cannot be opened as a file', () => {
    // A directory is the case a checkout actually produces: `readHead` is called on an answer-space path, and a
    // malformed entry in that list is a directory. The `catch` is what turns it into a row's `unreadableFiles` count
    // instead of a thrown error that would end the whole run.
    expect(readHead(root, 1_000)).toBeNull();
  });

  it('reads multibyte text as characters, since the cap is on bytes and the document is on terms', () => {
    // **The one place where a byte cap and a string meet.** Cutting mid-character would produce a replacement
    // character, which the tokeniser would then count as a term; a boundary at a whole number of characters is the
    // case the corpus actually produces, and it round-trips.
    const path = join(root, 'utf8.txt');
    writeFileSync(path, '修正 修正\n');
    expect(readHead(path, 1_000)).toBe('修正 修正\n');
  });

  it('**answers null for a fifo instead of blocking on it**, which is why the open is non-blocking', () => {
    // The check that refuses a non-regular file now runs *after* the open, so the open itself has to return. A fifo
    // opened for reading waits for a writer, and a job that has a clock cannot afford to wait for one that never comes.
    // This test would hang rather than fail if the flag were dropped, which is the point: the deadline is the assertion.
    if (process.platform === 'win32') return;
    const path = join(root, 'pipe');
    execFileSync('mkfifo', [path]);
    expect(readHead(path, 1_000)).toBeNull();
  });

  it('**answers null for a symlink to a directory**, so the descriptor is what is judged', () => {
    // `statSync` followed the link and `openSync` then failed on the target; asking `fstat` about the descriptor means
    // the file that is checked is the file that would be read. A symlink is how a checkout produces a non-file in an
    // answer space without the path looking like one.
    if (process.platform === 'win32') return;
    const link = join(root, 'link');
    symlinkSync(root, link);
    expect(readHead(link, 1_000)).toBeNull();
  });
});
