// The control's own tests.
//
// **A control that is wrong is worse than no control**, because it is the number the comparison rests on and nobody
// recomputes it. These cases are the ways it can be wrong without looking wrong: a tokeniser that never fires its
// camel-case clause, an inverse document frequency that goes negative and pushes a matching file *down* the list, a
// tie-break that makes the ranking a function of the directory order, a cap that silently indexes half a repository and
// reports the half it indexed as if it were the whole.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BM25_MAX_DOCUMENTS,
  BM25_MAX_FILE_BYTES,
  bm25Map,
  buildBm25,
  rankBm25,
  tokenize,
} from '../lca-baseline.js';

/** A checkout holding the named files, each with the content given. **Real files, because the caps are about bytes.** */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lca-bm25-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

describe('tokenize', () => {
  it('lower-cases and drops tokens of one character', () => {
    expect(tokenize('A Router X')).toEqual(['router']);
  });

  it('drops a function word', () => {
    expect(tokenize('the router when it fails')).toEqual(['router', 'fails']);
  });

  it('keeps the whole identifier and each of its camel-case parts', () => {
    expect(tokenize('handleLogin')).toEqual(['handlelogin', 'handle', 'login']);
  });

  it('splits an acronym once, at the end of the run', () => {
    // **The case that caught the first implementation.** It split on an upper-case letter following a lower-case one,
    // which is right for `handleLogin` and produces `h`, `t`, `t`, `p` for `HTTPServer` - every one of them a single
    // character, and therefore dropped. The tokeniser looked correct and was blind to every acronym in the corpus.
    expect(tokenize('HTTPServer')).toEqual(['httpserver', 'http', 'server']);
  });

  it('splits a padded acronym the same way', () => {
    expect(tokenize('buildHttpClient')).toEqual(['buildhttpclient', 'build', 'http', 'client']);
  });

  it('keeps digits inside a token', () => {
    expect(tokenize('utf8')).toEqual(['utf8']);
  });

  it('does not emit a part that is the whole token', () => {
    expect(tokenize('router')).toEqual(['router']);
  });

  it('drops a part that is itself a function word', () => {
    // `isRedirect` splits into `is` and `redirect`; `is` carries nothing and must not be indexed.
    expect(tokenize('isRedirect')).toEqual(['isredirect', 'redirect']);
  });

  it('drops a part of one character', () => {
    expect(tokenize('aConfig')).toEqual(['aconfig', 'config']);
  });

  it('answers an empty string with no terms', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('treats punctuation as a boundary', () => {
    expect(tokenize('cache.get(key)')).toEqual(['cache', 'get', 'key']);
  });
});

describe('buildBm25', () => {
  it('indexes exactly the files it is given', () => {
    const root = checkout({ 'a.py': 'alpha beta', 'b.py': 'gamma', 'notes.md': 'delta' });
    const index = buildBm25(root, ['a.py', 'b.py']);
    expect(index.documents.map((document) => document.path)).toEqual(['a.py', 'b.py']);
    expect(index.documentFrequency.get('alpha')).toBe(1);
    // **The file the corpus does not count is not in the control's index either**, or the control ranks a superset.
    expect(index.documentFrequency.get('delta')).toBeUndefined();
  });

  it('prefixes the path to the document, so a term in a filename matches', () => {
    const root = checkout({ 'src/HttpClient.py': 'class Thing: pass' });
    const index = buildBm25(root, ['src/HttpClient.py']);
    expect(index.documentFrequency.get('httpclient')).toBe(1);
  });

  it('omits the path when asked to', () => {
    const root = checkout({ 'src/HttpClient.py': 'class Thing: pass' });
    const index = buildBm25(root, ['src/HttpClient.py'], { includePath: false });
    expect(index.documentFrequency.get('httpclient')).toBeUndefined();
    expect(index.documentFrequency.get('thing')).toBe(1);
  });

  it('reads at most the cap, so a large file cannot take the parent down', () => {
    const head = 'needle '.repeat(4);
    const padding = 'x'.repeat(BM25_MAX_FILE_BYTES);
    const root = checkout({ 'big.py': `${head}${padding} haystack` });
    const index = buildBm25(root, ['big.py']);
    expect(index.documentFrequency.get('needle')).toBe(1);
    // **The term past the cap is not indexed, and that is the price of a bounded read** - recorded rather than hidden,
    // because a control that quietly read half of a file is a control with an unstated handicap.
    expect(index.documentFrequency.get('haystack')).toBeUndefined();
  });

  it('indexes an empty file as a document of length zero', () => {
    // **The zero-byte read is a branch of its own**: the buffer is allocated at zero and the loop never runs, and a
    // document that vanished from the length average would move every other document's normalisation.
    const root = checkout({ 'a.py': '', 'b.py': 'alpha' });
    const index = buildBm25(root, ['a.py', 'b.py'], { includePath: false });
    expect(index.documents).toHaveLength(2);
    expect(index.documents[0]!.length).toBe(0);
    expect(index.averageLength).toBe(0.5);
  });

  it('honours a caller’s smaller cap', () => {
    const root = checkout({ 'a.py': 'first second' });
    const index = buildBm25(root, ['a.py'], { maxFileBytes: 5 });
    expect(index.documentFrequency.get('first')).toBe(1);
    expect(index.documentFrequency.get('second')).toBeUndefined();
  });

  it('counts a file it could not read instead of failing', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildBm25(root, ['a.py', 'vanished.py']);
    expect(index.unreadableFiles).toBe(1);
    expect(index.documents).toHaveLength(1);
  });

  it('counts a file the document cap kept out', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'beta' });
    const index = buildBm25(root, ['a.py', 'b.py'], { maxDocuments: 1 });
    expect(index.documents).toHaveLength(1);
    expect(index.skippedFiles).toBe(1);
  });

  it('has the documented default document cap', () => {
    expect(BM25_MAX_DOCUMENTS).toBe(4_000);
  });

  it('averages the document length', () => {
    const root = checkout({ 'a.py': 'one two three four', 'b.py': 'one' });
    const index = buildBm25(root, ['a.py', 'b.py'], { includePath: false });
    // 4 terms and 1 term: the mean is 2.5, and the length normalisation divides by it.
    expect(index.averageLength).toBe(2.5);
  });

  it('answers an empty answer space with an empty index rather than dividing by zero', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-bm25-'));
    const index = buildBm25(root, []);
    expect(index.documents).toHaveLength(0);
    expect(index.averageLength).toBe(0);
  });
});

describe('rankBm25', () => {
  it('ranks the file that holds the query term first', () => {
    const root = checkout({
      'a.py': 'unrelated content here',
      'b.py': 'the cache is not invalidated',
    });
    const index = buildBm25(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankBm25(index, 'cache invalidated', 10)).toEqual(['b.py']);
  });

  it('returns nothing when no term matches', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildBm25(root, ['a.py'], { includePath: false });
    // **An empty ranking is a zero, not a list in path order.** Returning the answer space would give credit for a
    // match that never happened.
    expect(rankBm25(index, 'zebra', 10)).toEqual([]);
  });

  it('returns nothing for a query made only of function words', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildBm25(root, ['a.py']);
    expect(rankBm25(index, 'the when it', 10)).toEqual([]);
  });

  it('still scores a term that every document holds', () => {
    // **The inverse document frequency is the smoothed one**, `ln(1 + (N - df + 0.5) / (df + 0.5))`, which is positive
    // for `df = N`. The unsmoothed form is zero there, and zero would drop every document from a query the whole corpus
    // answers - which is precisely the query a bug report opens with.
    const root = checkout({ 'a.py': 'shared alpha', 'b.py': 'shared beta' });
    const index = buildBm25(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankBm25(index, 'shared', 10)).toEqual(['a.py', 'b.py']);
  });

  it('breaks a tie by path, so the ranking is a function of the corpus', () => {
    const root = checkout({ 'z.py': 'identical text', 'a.py': 'identical text' });
    const index = buildBm25(root, ['z.py', 'a.py'], { includePath: false });
    expect(rankBm25(index, 'identical', 10)).toEqual(['a.py', 'z.py']);
  });

  it('honours the limit', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'alpha', 'c.py': 'alpha' });
    const index = buildBm25(root, ['a.py', 'b.py', 'c.py'], { includePath: false });
    expect(rankBm25(index, 'alpha', 2)).toHaveLength(2);
  });

  it('answers a limit of zero with nothing', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildBm25(root, ['a.py']);
    expect(rankBm25(index, 'alpha', 0)).toEqual([]);
  });

  it('weights a rare term above a common one', () => {
    const root = checkout({
      'a.py': 'common rare',
      'b.py': 'common',
      'c.py': 'common',
      'd.py': 'common',
    });
    const index = buildBm25(root, ['a.py', 'b.py', 'c.py', 'd.py'], { includePath: false });
    // **Four documents hold `common` and one holds `rare`**, so the document holding both leads by the difference in
    // their weights - which is the whole reason an inverse document frequency is in a BM25 and not a term count.
    expect(rankBm25(index, 'common rare', 10)[0]).toBe('a.py');
  });

  it('answers an empty index with nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-bm25-'));
    const index = buildBm25(root, []);
    expect(rankBm25(index, 'anything', 10)).toEqual([]);
  });
});

describe('bm25Map', () => {
  it('scores a perfect first place at one', () => {
    const root = checkout({ 'src/a.py': 'the cache is not invalidated', 'src/b.py': 'unrelated' });
    const result = bm25Map({
      checkout: root,
      files: ['src/a.py', 'src/b.py'],
      query: 'cache invalidated',
      expected: ['src/a.py'],
      depth: 200,
      options: { includePath: false },
    });
    expect(result.map).toBe(1);
    expect(result.ranked[0]).toBe('src/a.py');
    expect(result.documents).toBe(2);
  });

  it('scores zero when the answer is not in the index at all', () => {
    const root = checkout({ 'src/a.py': 'alpha' });
    const result = bm25Map({
      checkout: root,
      files: ['src/a.py'],
      query: 'zebra',
      expected: ['src/a.py'],
      depth: 200,
    });
    // **The row still carries a control figure of zero rather than `null`**: the control ran and found nothing, which is
    // a different fact from the control not running.
    expect(result.map).toBe(0);
    expect(result.ranked).toEqual([]);
  });

  it('publishes the first ten of the ranking and no more', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 15; index += 1) files[`f${String(index)}.py`] = 'alpha';
    const root = checkout(files);
    const result = bm25Map({
      checkout: root,
      files: Object.keys(files),
      query: 'alpha',
      expected: ['f0.py'],
      depth: 200,
      options: { includePath: false },
    });
    expect(result.ranked).toHaveLength(10);
    expect(result.documents).toBe(15);
  });

  it('carries the caps it applied, so the reader can see a short index', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'alpha' });
    const result = bm25Map({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      expected: ['a.py'],
      depth: 200,
      options: { maxDocuments: 1 },
    });
    expect(result.skippedFiles).toBe(1);
  });
});
