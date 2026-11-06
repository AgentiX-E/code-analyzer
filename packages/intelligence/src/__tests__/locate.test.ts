// **The user story, as a test.** A reader has a checkout, a question, and no time for an index. `locateFiles` is the
// product's answer for that reader; these tests hold it to the two properties that make the answer usable - it ranks the
// file the question is about above the files it is not, and it reports the universe it ranked rather than a number that
// could be a prefix.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { locateFiles } from '../search/locate.js';

describe('locateFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  it('**ranks the file the question names above the files it does not**, with no index built', () => {
    write(
      'src/main/java/RetryPolicy.java',
      'package a;\nimport a.http.HttpClient;\nclass RetryPolicy {}\n',
    );
    write('src/main/java/HttpClient.java', 'package a;\nclass HttpClient {}\n');
    write('src/main/java/Cache.java', 'import a.http.HttpClient;\nclass Cache {}\n');

    const result = locateFiles(root, 'the retry policy loses the timeout', { limit: 10 });
    expect(result.ranked[0]).toBe('src/main/java/RetryPolicy.java');
    expect(result.answerSpace).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('uses the imports as well as the path, which is what makes it a document rather than a filename match', () => {
    // The question names a module, not a file: `HttpClient` appears in two paths' import blocks and in one path. The
    // document that holds it only as an import must still outrank the file that holds it not at all.
    write('src/a/Client.java', 'import a.http.HttpClient;\nclass Client {}\n');
    write('src/a/Unrelated.java', 'class Unrelated {}\n');

    const result = locateFiles(root, 'http client', { limit: 10 });
    expect(result.ranked).toEqual(['src/a/Client.java']);
    expect(result.importLines).toBe(1);
  });

  it('reports how many files the answer space held, refused or not', () => {
    for (let index = 0; index < 7; index += 1)
      write(`pkg/F${String(index)}.py`, `def f${String(index)}(): pass\n`);
    const result = locateFiles(root, 'f3', { limit: 3 });
    expect(result.answerSpace).toBe(7);
    expect(result.ranked.length).toBeLessThanOrEqual(3);
  });

  it('**says when the walk was capped**, because a ranking over a prefix is a lower bound', () => {
    for (let index = 0; index < 6; index += 1) write(`pkg/F${String(index)}.py`, '');
    const result = locateFiles(root, 'anything', { maxFiles: 2, limit: 5 });
    expect(result.truncated).toBe(true);
    expect(result.answerSpace).toBe(2);
  });

  it('ranks a caller-supplied answer space without walking, which is how the corpus uses it', () => {
    // **The benchmark case.** The corpus already holds the answer space as a list, and re-deriving it from the
    // filesystem would rank a different universe than the one the published baselines rank.
    write('a/Match.java', 'class Match {}\n');
    write('a/Other.java', 'class Other {}\n');
    const result = locateFiles(root, 'match', {
      files: ['a/Match.java', 'a/Other.java'],
      limit: 5,
    });
    expect(result.ranked).toEqual(['a/Match.java']);
    expect(result.answerSpace).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('defaults to ten paths and to the default extension list, so a caller can pass nothing at all', () => {
    for (let index = 0; index < 12; index += 1) {
      write(`pkg/c${String(index)}/Handler.java`, 'class Handler {}\n');
    }
    const result = locateFiles(root, 'handler');
    expect(result.ranked).toHaveLength(10);
    expect(result.answerSpace).toBe(12);
  });

  it('answers a question with no term in common with any file with nothing', () => {
    write('a/Match.java', 'class Match {}\n');
    expect(locateFiles(root, 'kubernetes', { limit: 5 }).ranked).toEqual([]);
  });

  it('counts a file whose head cannot be read as unreadable, and still ranks it on its path', () => {
    // **A missing read is not a missing file.** Dropping it would shrink the universe the ranking is measured over,
    // which is the one thing a fallback must not do - and a corpus answer space can name a file the checkout no longer
    // holds, which is exactly what a deleting commit produces.
    write('a/Real.java', 'class Real {}\n');
    const result = locateFiles(root, 'deleted file', {
      files: ['a/Real.java', 'a/Deleted.java'],
      limit: 5,
    });
    expect(result.unreadableFiles).toBe(1);
    expect(result.answerSpace).toBe(2);
    expect(result.ranked).toEqual(['a/Deleted.java']);
  });
});

// ---------------------------------------------------------------------------
// The second arm: a declaration ranking the caller already holds
// ---------------------------------------------------------------------------

describe('locateFiles with an arm to fuse', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-fuse-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  it('**a file only the declaration arm ranked still appears**, which is a fusion and not a filter', () => {
    // The pool's two hundred candidates do not cover every file of a three-thousand-file checkout; the arm the caller
    // supplies is the part of the answer the pool never reached. A result that dropped it would be an intersection
    // wearing the name of a fusion.
    write('src/Retry.java', 'class Retry {}\n');
    write('src/Unrelated.java', 'class Unrelated {}\n');
    const result = locateFiles(root, 'retry policy', {
      declarations: ['src/Unrelated.java', 'src/Nowhere.java'],
      limit: 5,
    });
    expect(result.ranked).toContain('src/Nowhere.java');
    expect(result.ranked).toContain('src/Retry.java');
    expect(result.fusion?.k).toBe(60);
  });

  it('**two arms that agree outrank one arm that does not**, which is what reciprocal rank buys', () => {
    write('src/Alpha.java', 'import a.beta.Beta;\nclass Alpha {}\n');
    write('src/Beta.java', 'class Beta {}\n');
    const result = locateFiles(root, 'alpha', {
      // `Beta` is second in the only arm that reaches it, so `Alpha` - first in both - wins even though the
      // declaration arm's first entry is a file the file-level arm never saw.
      declarations: ['src/Gamma.java', 'src/Beta.java'],
      limit: 5,
    });
    expect(result.ranked[0]).toBe('src/Alpha.java');
  });

  it('**publishes the file-level arm alone beside the fusion**, so the two can be told apart', () => {
    write('src/Alpha.java', 'class Alpha {}\n');
    const result = locateFiles(root, 'alpha', {
      declarations: ['src/Beta.java'],
      limit: 5,
    });
    expect(result.fileLevel[0]).toBe('src/Alpha.java');
    expect(result.fusion?.scores.find((entry) => entry.path === 'src/Beta.java')?.arms).toEqual({
      declarations: 1 / 61,
    });
  });

  it('**reads the file-level arm deeper than the answer it returns**, so the fused order is not decided by a cut', () => {
    // A caller asking for one path and supplying a two-hundred-entry declaration list needs the file-level arm read to
    // the same depth: fusing a two-hundred-long list against a one-long one makes the order depend on how many paths
    // the reader asked to see.
    for (let index = 0; index < 5; index += 1)
      write(`pkg/S${String(index)}.java`, 'import a.core.Common;\nclass Holder {}\n');
    const result = locateFiles(root, 'common core', {
      declarations: ['pkg/S4.java'],
      limit: 1,
      fusionDepth: 5,
    });
    expect(result.ranked).toHaveLength(1);
    expect(result.fileLevel.length).toBeGreaterThan(1);
  });

  it('**reports no fusion when no arm was given**, and says so rather than returning an empty one', () => {
    write('pkg/A.java', 'class A {}\n');
    const result = locateFiles(root, 'a');
    expect(result.fusion).toBeNull();
    expect(result.fileLevel).toEqual(result.ranked);
  });

  it('**honours a supplied rank constant**, because an ablation has to be able to run another one', () => {
    write('pkg/A.java', 'class A {}\n');
    const result = locateFiles(root, 'a', { declarations: ['pkg/B.java'], limit: 3, k: 10 });
    expect(result.fusion?.k).toBe(10);
    expect(result.fusion?.scores.find((entry) => entry.path === 'pkg/B.java')?.score).toBeCloseTo(
      1 / 11,
      12,
    );
  });
});
