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
  buildTermIndex,
  lexicalControls,
  rankBm25,
  rankTfidf,
  tokenize,
} from '../lca-baseline.js';

import type { TermIndex } from '../lca-baseline.js';

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

describe('buildTermIndex', () => {
  it('indexes exactly the files it is given', () => {
    const root = checkout({ 'a.py': 'alpha beta', 'b.py': 'gamma', 'notes.md': 'delta' });
    const index = buildTermIndex(root, ['a.py', 'b.py']);
    expect(index.documents.map((document) => document.path)).toEqual(['a.py', 'b.py']);
    expect(index.documentFrequency.get('alpha')).toBe(1);
    // **The file the corpus does not count is not in the control's index either**, or the control ranks a superset.
    expect(index.documentFrequency.get('delta')).toBeUndefined();
  });

  it('prefixes the path to the document, so a term in a filename matches', () => {
    const root = checkout({ 'src/HttpClient.py': 'class Thing: pass' });
    const index = buildTermIndex(root, ['src/HttpClient.py']);
    expect(index.documentFrequency.get('httpclient')).toBe(1);
  });

  it('omits the path when asked to', () => {
    const root = checkout({ 'src/HttpClient.py': 'class Thing: pass' });
    const index = buildTermIndex(root, ['src/HttpClient.py'], { includePath: false });
    expect(index.documentFrequency.get('httpclient')).toBeUndefined();
    expect(index.documentFrequency.get('thing')).toBe(1);
  });

  it('reads at most the cap, so a large file cannot take the parent down', () => {
    const head = 'needle '.repeat(4);
    const padding = 'x'.repeat(BM25_MAX_FILE_BYTES);
    const root = checkout({ 'big.py': `${head}${padding} haystack` });
    const index = buildTermIndex(root, ['big.py']);
    expect(index.documentFrequency.get('needle')).toBe(1);
    // **The term past the cap is not indexed, and that is the price of a bounded read** - recorded rather than hidden,
    // because a control that quietly read half of a file is a control with an unstated handicap.
    expect(index.documentFrequency.get('haystack')).toBeUndefined();
  });

  it('indexes an empty file as a document of length zero', () => {
    // **The zero-byte read is a branch of its own**: the buffer is allocated at zero and the loop never runs, and a
    // document that vanished from the length average would move every other document's normalisation.
    const root = checkout({ 'a.py': '', 'b.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    expect(index.documents).toHaveLength(2);
    expect(index.documents[0]!.length).toBe(0);
    expect(index.averageLength).toBe(0.5);
  });

  it('honours a caller’s smaller cap', () => {
    const root = checkout({ 'a.py': 'first second' });
    const index = buildTermIndex(root, ['a.py'], { maxFileBytes: 5 });
    expect(index.documentFrequency.get('first')).toBe(1);
    expect(index.documentFrequency.get('second')).toBeUndefined();
  });

  it('counts a file it could not read instead of failing', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py', 'vanished.py']);
    expect(index.unreadableFiles).toBe(1);
    expect(index.documents).toHaveLength(1);
  });

  it('counts a file the document cap kept out', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'beta' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { maxDocuments: 1 });
    expect(index.documents).toHaveLength(1);
    expect(index.skippedFiles).toBe(1);
  });

  it('has the documented default document cap', () => {
    expect(BM25_MAX_DOCUMENTS).toBe(4_000);
  });

  it('averages the document length', () => {
    const root = checkout({ 'a.py': 'one two three four', 'b.py': 'one' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    // 4 terms and 1 term: the mean is 2.5, and the length normalisation divides by it.
    expect(index.averageLength).toBe(2.5);
  });

  it('answers an empty answer space with an empty index rather than dividing by zero', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-bm25-'));
    const index = buildTermIndex(root, []);
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
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankBm25(index, 'cache invalidated', 10)).toEqual(['b.py']);
  });

  it('returns nothing when no term matches', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py'], { includePath: false });
    // **An empty ranking is a zero, not a list in path order.** Returning the answer space would give credit for a
    // match that never happened.
    expect(rankBm25(index, 'zebra', 10)).toEqual([]);
  });

  it('returns nothing for a query made only of function words', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py']);
    expect(rankBm25(index, 'the when it', 10)).toEqual([]);
  });

  it('still scores a term that every document holds', () => {
    // **The inverse document frequency is the smoothed one**, `ln(1 + (N - df + 0.5) / (df + 0.5))`, which is positive
    // for `df = N`. The unsmoothed form is zero there, and zero would drop every document from a query the whole corpus
    // answers - which is precisely the query a bug report opens with.
    const root = checkout({ 'a.py': 'shared alpha', 'b.py': 'shared beta' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankBm25(index, 'shared', 10)).toEqual(['a.py', 'b.py']);
  });

  it('breaks a tie by path, so the ranking is a function of the corpus', () => {
    const root = checkout({ 'z.py': 'identical text', 'a.py': 'identical text' });
    const index = buildTermIndex(root, ['z.py', 'a.py'], { includePath: false });
    expect(rankBm25(index, 'identical', 10)).toEqual(['a.py', 'z.py']);
  });

  it('honours the limit', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'alpha', 'c.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py', 'b.py', 'c.py'], { includePath: false });
    expect(rankBm25(index, 'alpha', 2)).toHaveLength(2);
  });

  it('answers a limit of zero with nothing', () => {
    const root = checkout({ 'a.py': 'alpha' });
    const index = buildTermIndex(root, ['a.py']);
    expect(rankBm25(index, 'alpha', 0)).toEqual([]);
  });

  it('weights a rare term above a common one', () => {
    const root = checkout({
      'a.py': 'common rare',
      'b.py': 'common',
      'c.py': 'common',
      'd.py': 'common',
    });
    const index = buildTermIndex(root, ['a.py', 'b.py', 'c.py', 'd.py'], { includePath: false });
    // **Four documents hold `common` and one holds `rare`**, so the document holding both leads by the difference in
    // their weights - which is the whole reason an inverse document frequency is in a BM25 and not a term count.
    expect(rankBm25(index, 'common rare', 10)[0]).toBe('a.py');
  });

  it('answers an empty index with nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'lca-bm25-'));
    const index = buildTermIndex(root, []);
    expect(rankBm25(index, 'anything', 10)).toEqual([]);
  });
});

describe('lexicalControls', () => {
  it('scores a perfect first place at one', () => {
    const root = checkout({ 'src/a.py': 'the cache is not invalidated', 'src/b.py': 'unrelated' });
    const result = lexicalControls({
      checkout: root,
      files: ['src/a.py', 'src/b.py'],
      query: 'cache invalidated',
      expected: ['src/a.py'],
      depth: 200,
      options: { includePath: false },
    }).bm25;
    expect(result.map).toBe(1);
    expect(result.ranked[0]).toBe('src/a.py');
    expect(result.documents).toBe(2);
  });

  it('scores zero when the answer is not in the index at all', () => {
    const root = checkout({ 'src/a.py': 'alpha' });
    const result = lexicalControls({
      checkout: root,
      files: ['src/a.py'],
      query: 'zebra',
      expected: ['src/a.py'],
      depth: 200,
    }).bm25;
    // **The row still carries a control figure of zero rather than `null`**: the control ran and found nothing, which is
    // a different fact from the control not running.
    expect(result.map).toBe(0);
    expect(result.ranked).toEqual([]);
  });

  it('publishes the first ten of the ranking and no more', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 15; index += 1) files[`f${String(index)}.py`] = 'alpha';
    const root = checkout(files);
    const result = lexicalControls({
      checkout: root,
      files: Object.keys(files),
      query: 'alpha',
      expected: ['f0.py'],
      depth: 200,
      options: { includePath: false },
    }).bm25;
    expect(result.ranked).toHaveLength(10);
    expect(result.documents).toBe(15);
  });

  it('carries the caps it applied, so the reader can see a short index', () => {
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'alpha' });
    const result = lexicalControls({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'alpha',
      expected: ['a.py'],
      depth: 200,
      options: { maxDocuments: 1 },
    }).bm25;
    expect(result.skippedFiles).toBe(1);
  });
});

describe('rankTfidf', () => {
  it('ranks a document holding the query terms above one that does not', () => {
    const root = checkout({ 'a.py': 'the cache is never invalidated', 'b.py': 'unrelated' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankTfidf(index, 'cache invalidated', 10)).toEqual(['a.py']);
  });

  it('returns nothing when no document holds a query term', () => {
    // **Empty rather than the whole answer space in path order**: a cosine of zero is the absence of a ranking, and
    // returning every file would give credit for a match that never happened.
    const root = checkout({ 'a.py': 'alpha', 'b.py': 'beta' });
    const index = buildTermIndex(root, ['a.py', 'b.py'], { includePath: false });
    expect(rankTfidf(index, 'zebra', 10)).toEqual([]);
    expect(rankTfidf(index, '   ', 10)).toEqual([]);
  });

  it('divides length out in the norm rather than through a parameter', () => {
    // **The same term in a short file and in a long one**, which is the shape BM25 needs `b` for and the cosine settles
    // by construction: the fillers are dimensions the query does not occupy, so they raise the document's norm without
    // raising its dot product.
    const root = checkout({
      'short.py': 'backoff',
      'long.py': `backoff ${Array.from({ length: 30 }, (_, index) => `w${String(index)}`).join(' ')}`,
    });
    const index = buildTermIndex(root, ['short.py', 'long.py'], { includePath: false });
    expect(rankTfidf(index, 'backoff', 10)[0]).toBe('short.py');
  });

  it('**penalises a document holding a term the index never counted**, rather than producing NaN', () => {
    // **The one branch in this module a corpus cannot produce, tested through the public API instead of excused.**
    // `buildTermIndex` counts a document frequency for every term of every document, so on any index it builds the
    // lookup always succeeds. But `TermIndex` is an exported shape and `rankTfidf` is an exported function, so a caller
    // can hand over a document holding a term the frequency map does not list - and the question of what happens then
    // is a real question with one defensible answer: the term weighs as if no document held it, which *raises* the
    // document's norm and therefore *lowers* its score. The alternative - a non-null assertion on the lookup - would
    // make the weight `NaN` and the score `NaN`, and a `NaN` in a published mean is a defect that travels.
    const index: TermIndex = {
      documents: [
        {
          path: 'counted.py',
          termFrequency: new Map([
            ['alpha', 1],
            ['beta', 1],
          ]),
          length: 2,
        },
        { path: 'plain.py', termFrequency: new Map([['alpha', 1]]), length: 1 },
      ],
      // `beta` is deliberately absent: the document holds it, the index does not count it.
      documentFrequency: new Map([['alpha', 2]]),
      averageLength: 1.5,
      skippedFiles: 0,
      unreadableFiles: 0,
    };
    const ranking = rankTfidf(index, 'alpha', 10);
    expect(ranking).toEqual(['plain.py', 'counted.py']);
  });

  it('orders a pair differently from BM25, which is the reason there are two controls', () => {
    // **The premise of the second control, stated as an executable fact.** A file that says "retry" forty times and
    // "backoff" once, against a file that says both terms a couple of times in four tokens: BM25 saturates the
    // repetition and prefers the compact file, the cosine lets the repeated dimension dominate and prefers the long one.
    // Neither ordering is wrong - they are two weightings - and an artifact that published only one of them would be
    // asking the reader to trust the choice of formula rather than to read it.
    const root = checkout({
      'repeat.py': `${Array.from({ length: 40 }, () => 'retry').join(' ')} backoff`,
      'mixed.py': 'retry backoff timeout socket',
    });
    const index = buildTermIndex(root, ['repeat.py', 'mixed.py'], { includePath: false });
    expect(rankBm25(index, 'retry backoff', 10)[0]).toBe('mixed.py');
    expect(rankTfidf(index, 'retry backoff', 10)[0]).toBe('repeat.py');
  });
});

describe('lexicalControls', () => {
  it('reads both controls off one index, so the two cannot see different files', () => {
    const root = checkout({ 'a.py': 'cache invalidated', 'b.py': 'cache' });
    const controls = lexicalControls({
      checkout: root,
      files: ['a.py', 'b.py'],
      query: 'cache invalidated',
      expected: ['a.py'],
      depth: 200,
      options: { includePath: false },
    });
    // **The three fields that describe the corpus rather than the ranking are shared by construction**, which is what
    // makes "the controls differ in weighting alone" a property of the code and not a sentence in a comment.
    expect(controls.bm25.documents).toBe(controls.tfidf.documents);
    expect(controls.bm25.skippedFiles).toBe(controls.tfidf.skippedFiles);
    expect(controls.bm25.unreadableFiles).toBe(controls.tfidf.unreadableFiles);
    expect(controls.bm25.map).toBe(1);
    expect(controls.tfidf.map).toBe(1);
  });

  it('reports a control that found nothing as zero rather than as absent', () => {
    // **`0` and `null` are different facts** and the pairing excludes one of them: a control that ran and matched nothing
    // contributed a row, a control that did not run contributed nothing.
    const root = checkout({ 'a.py': 'alpha' });
    const controls = lexicalControls({
      checkout: root,
      files: ['a.py'],
      query: 'zebra',
      expected: ['a.py'],
      depth: 200,
    });
    expect(controls.bm25.map).toBe(0);
    expect(controls.tfidf.map).toBe(0);
  });
});
