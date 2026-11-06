// **The arm's two claims, as tests.** It ranks a file by words that are in its body and not in its name - which is the
// whole reason it exists, because the path-and-imports arm cannot see them and on the Long Code Arena instances the
// analyser refuses that arm scored 0.1441 against the lexical control's 0.3116. And it is **the control's ranking**, to
// the last path, on every instance where the control's own document cap does not bite: an arm that agreed only in
// aggregate would make the fusion's gain a gain over two arithmetics rather than over two documents.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTermIndex, rankBm25 } from '../benchmark/lca-baseline.js';
import { BODY_BYTES_PER_FILE, rankByFileBody } from '../search/file-body.js';

describe('rankByFileBody', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'file-body-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  const rank = (query: string, limit = 200, files?: string[]): readonly string[] =>
    rankByFileBody({ checkout: root, files: files ?? ['a.py', 'b.py'], query, limit }).ranked;

  it('**ranks the file on a word that is in its body and nowhere in its name**', () => {
    // The user story: an issue says "the retry decorator loses the timeout". Neither file is called anything like that,
    // and the only difference between them is what they are written in.
    write('a.py', 'def connect(host):\n    return socket.create_connection((host, 80))\n');
    write(
      'b.py',
      'def retry(fn):\n    # the retry decorator drops the timeout argument\n    return fn\n',
    );
    expect(rank('the retry decorator loses the timeout')[0]).toBe('b.py');
  });

  it('**reads the path as part of the document**, so a question that names a file finds it', () => {
    write('a.py', 'VALUE = 1\n');
    write('HttpRetryPolicy.py', 'VALUE = 2\n');
    expect(rank('HttpRetryPolicy', 200, ['a.py', 'HttpRetryPolicy.py'])[0]).toBe(
      'HttpRetryPolicy.py',
    );
  });

  it('**returns files that matched nothing nowhere**, because a zero is the absence of a ranking', () => {
    write('a.py', 'alpha = 1\n');
    write('b.py', 'beta = 2\n');
    expect(rank('alpha')).toEqual(['a.py']);
  });

  it('**breaks a tie by path ascending**, so the order is a function of the corpus and not of the sort', () => {
    write('z.py', 'timeout = 1\n');
    write('m.py', 'timeout = 1\n');
    write('a.py', 'timeout = 1\n');
    expect(rank('timeout', 200, ['z.py', 'm.py', 'a.py'])).toEqual(['a.py', 'm.py', 'z.py']);
  });

  it('**reports the answer space rather than the number that matched**', () => {
    write('a.py', 'alpha = 1\n');
    write('b.py', 'beta = 2\n');
    const result = rankByFileBody({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      limit: 200,
    });
    expect(result.documents).toBe(2);
    expect(result.ranked).toEqual(['a.py']);
  });

  it('**counts a file it cannot read and does not rank it**', () => {
    write('a.py', 'alpha = 1\n');
    // A directory in the answer space: `readHead` refuses it, and the arm must neither drop it from the denominator nor
    // award it a match.
    mkdirSync(join(root, 'b.py'), { recursive: true });
    const result = rankByFileBody({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      limit: 200,
    });
    expect(result.documents).toBe(2);
    expect(result.unreadableFiles).toBe(1);
    expect(result.ranked).toEqual(['a.py']);
  });

  it('**answers nothing for a query with no terms**, and still reports the universe', () => {
    write('a.py', 'alpha = 1\n');
    const result = rankByFileBody({
      checkout: root,
      files: ['a.py'],
      query: 'the and of',
      limit: 10,
    });
    expect(result.ranked).toEqual([]);
    expect(result.documents).toBe(1);
  });

  it('**answers nothing for an empty answer space**', () => {
    const result = rankByFileBody({ checkout: root, files: [], query: 'alpha', limit: 10 });
    expect(result).toEqual({ ranked: [], documents: 0, unreadableFiles: 0, bytesRead: 0 });
  });

  it('**reads no more than the cap**, so a term that lives past it is not seen', () => {
    // The cap is a stated configuration, not an accident: the body arm and the control both read 64 KB, and a file whose
    // first occurrence of a word lies beyond that cannot be ranked on it by either.
    const padding = 'x'.repeat(BODY_BYTES_PER_FILE);
    write('a.py', 'alpha\n');
    write('b.py', `${padding}\nalpha\n`);
    const result = rankByFileBody({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      limit: 200,
    });
    expect(result.ranked).toEqual(['a.py']);
    expect(result.bytesRead).toBe(Buffer.byteLength('alpha\n') + BODY_BYTES_PER_FILE);
  });

  it('**is the control’s ranking, path for path**, on an answer space the control’s own cap does not reach', () => {
    // **The identity that makes the addition honest.** `benchmark/lca-baseline.ts` reads a file's whole text as a
    // document with the same tokeniser, the same `k1` and `b`, the same smoothed inverse document frequency, the same
    // drop-the-zeros rule and the same path tie-break. If the two disagree here, one of them has a defect, and the
    // fusion's contribution would be measured against a different arithmetic from the one the control publishes.
    write('src/main/java/RetryPolicy.java', 'class RetryPolicy {\n  int timeout = 30;\n}\n');
    write('src/main/java/HttpClient.java', 'class HttpClient {\n  void retry() {}\n}\n');
    write('src/main/java/Cache.java', 'class Cache {\n  int size = 0;\n}\n');
    write('README.md', 'retry retry retry timeout\n');
    const files = [
      'src/main/java/RetryPolicy.java',
      'src/main/java/HttpClient.java',
      'src/main/java/Cache.java',
      'README.md',
    ];
    const query = 'the retry loses the timeout when caching';

    const mine = rankByFileBody({ checkout: root, files, query, limit: 200 }).ranked;
    const control = rankBm25(buildTermIndex(root, files), query, 200);

    expect(mine).toEqual(control);
    expect(mine.length).toBeGreaterThan(1);
  });

  it('**agrees with the control on a corpus where every file matches everything**', () => {
    // A second identity fixture, because the first one has one file that matches nothing: this one exercises the case
    // where every document is scored and only the order differs.
    write('a.txt', 'timeout timeout retry\n');
    write('b.txt', 'retry\n');
    write('c.txt', 'timeout\n');
    const files = ['a.txt', 'b.txt', 'c.txt'];
    const query = 'retry timeout';
    expect(rankByFileBody({ checkout: root, files, query, limit: 200 }).ranked).toEqual(
      rankBm25(buildTermIndex(root, files), query, 200),
    );
  });

  it('**cuts to the limit without changing the order**', () => {
    write('a.py', 'timeout = 1\n');
    write('b.py', 'timeout = 2\n');
    write('c.py', 'timeout = 3\n');
    const files = ['c.py', 'b.py', 'a.py'];
    const full = rankByFileBody({ checkout: root, files, query: 'timeout', limit: 200 }).ranked;
    const cut = rankByFileBody({ checkout: root, files, query: 'timeout', limit: 2 }).ranked;
    expect(cut).toEqual(full.slice(0, 2));
  });
});

describe('rankByFileBody options', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'file-body-opt-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('**honours a stated cap**, so the same text can be read to two depths and the difference is the arm’s budget', () => {
    // The cap is a parameter because a caller paying for the I/O has to be able to say how much: a body arm that read
    // 64 KB unconditionally would be a fixed cost a twenty-thousand-file checkout cannot afford, and one that read
    // eight kilobytes would be the path-and-imports arm with a longer head.
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'a.py'), `${'x'.repeat(64)}\nalpha\n`);
    writeFileSync(join(root, 'b.py'), 'alpha\n');
    const narrow = rankByFileBody({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      limit: 10,
      options: { maxBytes: 32 },
    });
    // `a.py`'s only occurrence of the term lies past the thirty-two byte cap, so the narrow read cannot see it.
    expect(narrow.ranked).toEqual(['b.py']);
    const wide = rankByFileBody({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      limit: 10,
      options: { maxBytes: 4_096 },
    });
    expect([...wide.ranked].sort()).toEqual(['a.py', 'b.py']);
    expect(wide.bytesRead).toBeGreaterThan(narrow.bytesRead);
  });

  it('**answers nothing for a limit of zero**, rather than the deepest ranking', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'a.py'), 'alpha\n');
    const result = rankByFileBody({ checkout: root, files: ['a.py'], query: 'alpha', limit: 0 });
    expect(result.ranked).toEqual([]);
  });
});
