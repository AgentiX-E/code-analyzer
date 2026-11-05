// @code-analyzer/intelligence — the lexical core shared by the ranking fallback and by the benchmark's controls
//
// **Why this is a product module and not a benchmark module.** The tokeniser, the rank-frequency saturation and the
// length normalisation used to live inside `benchmark/lca-baseline.ts`, where they were the benchmark's control and
// nothing else. They are not a control: they are how this product reads a file as a bag of words, and iteration 76 gives
// that reading a job - the file-level fallback that ranks a checkout too large for the analyser (`search/path-imports.ts`).
// A fallback that could not see the control's terms would be a second vocabulary, and a comparison between the two would
// be a comparison of two tokenisers wearing the name of a comparison of two documents.
//
// **One definition, two readers, so the difference between them is the document.** The control reads a file's whole
// text; the fallback reads its path and its import statements. Everything else - the tokeniser, `k1`, `b`, the smoothed
// inverse document frequency, the drop-the-zeros rule, the tie-break - is this file, imported by both. **A mechanism
// test whose two arms share five of six components is a test of the sixth**, and the artefact can say so without the
// reader having to check.
//
// **The constants are stated rather than tuned.** `k1 = 1.2` and `b = 0.75` are the values the BM25 literature settled
// on for short documents; a control with a tuning knob is a control that can be made to lose, and a fallback with a
// tuning knob is a fallback fitted to the corpus it was measured on.

/** The rank-frequency saturation the BM25 literature fixes at 1.2 for short documents. **Stated, not tuned.** */
export const BM25_K1 = 1.2;

/** The length-normalisation weight: 0.75 is the standard midpoint between "ignore length" and "divide by length". */
export const BM25_B = 0.75;

/**
 * Terms carrying no information about which file to change.
 *
 * **A short list, and deliberately not a linguistic one.** It removes the words that appear in every issue of every
 * repository ("the", "error", "when") and nothing else: a longer list is a tuning knob, and a control with a tuning knob
 * is a control that can be made to lose.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'should',
  'so',
  'than',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'which',
  'while',
  'will',
  'with',
  'would',
]);

/** A lower-case letter, **by case and not by code point**, so a digit is neither. */
function isLower(character: string): boolean {
  return character !== character.toUpperCase() && character === character.toLowerCase();
}

/** An upper-case letter, by the same test. */
function isUpper(character: string): boolean {
  return character !== character.toLowerCase() && character === character.toUpperCase();
}

/**
 * Split an identifier at its camel-case boundaries: `getUserById` → `get`, `user`, `by`, `id`.
 *
 * **Acronyms split once, at the end of the run.** `HTTPServer` is `http` and `server`, not `h`, `t`, `t`, `p` and
 * `server`: the boundary is an upper-case letter that follows a lower-case one, **or** one that is followed by a
 * lower-case letter while itself following an upper-case one. Without the second clause every acronym in a Java
 * repository becomes single letters, and single letters are dropped - which would make the control quietly blind to
 * `HttpClient` while looking like it was not.
 */
function camelParts(token: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index]!;
    const previous = index === 0 ? '' : token[index - 1]!;
    const next = token[index + 1] ?? '';
    const boundary =
      isUpper(character) &&
      current.length > 0 &&
      (isLower(previous) || (isUpper(previous) && isLower(next)));
    if (boundary) {
      parts.push(current);
      current = '';
    }
    current += character.toLowerCase();
  }
  // **No guard on `current` here.** `camelParts` is called only for a tokenised run, and `tokenize` skips an empty one
  // before calling - so the tail is always non-empty, and a guard that can never fire is a branch the coverage report
  // has to excuse rather than a defence.
  parts.push(current);
  return parts;
}

/**
 * The terms of a piece of text.
 *
 * **Both the whole token and its camel-case parts**, because an issue says "login" and the declaration says
 * `handleLogin` - a tokeniser that keeps only whole identifiers would score a reader lower than the baseline it is
 * standing in for, and a reader that is weaker than the published row makes our own figure look better than it is.
 * **Erasure in the direction that is hard on us is the only erasure worth having.**
 *
 * **Camel case is read before the text is lower-cased**, which is the defect this function shipped with for one commit:
 * the split ran on an already-folded string, where no character is upper-case, so the clause never fired and the
 * tokeniser looked correct while doing nothing.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // **Split on anything that is not a letter or a digit, keeping the case** - the case is the information the next step
  // reads, and lower-casing first is exactly how it gets thrown away.
  for (const raw of text.split(/[^A-Za-z0-9]+/)) {
    if (raw.length === 0) continue;
    const whole = raw.toLowerCase();
    if (whole.length >= 2 && !STOPWORDS.has(whole)) tokens.push(whole);
    const parts = camelParts(raw);
    if (parts.length <= 1) continue;
    for (const part of parts) {
      if (part.length < 2 || part === whole || STOPWORDS.has(part)) continue;
      tokens.push(part);
    }
  }
  return tokens;
}

/** One document as the lexical scorers read it. **The minimum both the control and the fallback can produce.** */
export interface LexicalDocument {
  /** Repository-relative POSIX path, **the corpus's own coordinate system**. */
  readonly path: string;
  /** The document's terms, in the order they were read. **Duplicates are the term frequency.** */
  readonly tokens: readonly string[];
}

/** Terms of a document, and how many times each occurs. Built once per document, at scoring time. */
function countsOf(tokens: readonly string[], wanted: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (!wanted.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * How many documents hold each term, **counted once per document**.
 *
 * A term repeated forty times in one file is one document of evidence, which is what an inverse document frequency is
 * about; counting occurrences would make the weight depend on the corpus's verbosity rather than on its vocabulary.
 */
export function documentFrequencies(documents: readonly LexicalDocument[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(document.tokens)) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }
  return frequency;
}

/**
 * The BM25+ style smoothed inverse document frequency, which stays positive for a term in every document:
 * `ln(1 + (N - df + 0.5) / (df + 0.5))` is never negative, and a negative weight would let a matching term push a file
 * **down** the list.
 */
export function bm25Idf(documentFrequency: number, total: number): number {
  return Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

/** The BM25 weight of a term held `frequency` times by a document of `length` in a corpus of `averageLength`. */
export function bm25Weight(
  frequency: number,
  length: number,
  idf: number,
  averageLength: number,
): number {
  const normaliser = BM25_K1 * (1 - BM25_B + (BM25_B * length) / Math.max(averageLength, 1));
  return (idf * (frequency * (BM25_K1 + 1))) / (frequency + normaliser);
}

/**
 * The smoothed inverse document frequency of TF-IDF: `ln((1 + N) / (1 + df)) + 1`.
 *
 * **Smoothed for the same reason BM25's is**: a term that appears in every document must weigh something rather than
 * nothing, and a weight of zero would make a whole class of matches invisible instead of weak.
 */
export function tfidfIdf(documentFrequency: number, total: number): number {
  return Math.log((1 + total) / (1 + documentFrequency)) + 1;
}

/**
 * The term's weight in one document: **sublinear** term frequency times the smoothed idf.
 *
 * **`1 + ln(tf)` rather than `tf`**, because a file that mentions a word forty times is not forty times more about it -
 * the same reason BM25 saturates, arrived at without a parameter.
 */
export function tfidfWeight(frequency: number, idf: number): number {
  return (1 + Math.log(frequency)) * idf;
}

/**
 * The half every lexical ranking shares, **written once so that two rankings differ in their weighting and not in their
 * sort**.
 *
 * **Ties are broken by path, ascending**, so the ranking is a function of the corpus rather than of the order the
 * filesystem returned the directory in. A ranking whose tie-break is `Array.prototype.sort`'s stability is a ranking
 * whose number can move between two runs of the same commit.
 *
 * **Only documents that matched at least one term are returned.** A score of zero is not a weak ranking, it is the
 * absence of one, and returning the whole answer space in path order would give credit for a match that never happened.
 */
export function rankByScore(
  documents: readonly LexicalDocument[],
  scoreOf: (document: LexicalDocument) => number,
  limit: number,
): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const document of documents) {
    const value = scoreOf(document);
    if (value > 0) scored.push({ path: document.path, score: value });
  }
  scored.sort((left, right) =>
    left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score,
  );
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.path);
}

/**
 * Rank a set of documents with BM25.
 *
 * **The term counts are computed at scoring time from the document's own token list**, rather than stored as a map per
 * document. The two are the same arithmetic and differ by a factor of ten in memory: a map costs an object, a bucket
 * array and a string key per term, and the fallback holds twenty thousand documents at once on a checkout the analyser
 * refused. Nothing here is approximate - the counts are exact and only the terms the query names are ever counted.
 */
export function rankBm25Documents(
  documents: readonly LexicalDocument[],
  documentFrequency: ReadonlyMap<string, number>,
  averageLength: number,
  query: string,
  limit: number,
): string[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || documents.length === 0) return [];
  const total = documents.length;
  const weighted = terms.map((term) => ({
    term,
    idf: bm25Idf(documentFrequency.get(term) ?? 0, total),
  }));
  const wanted = new Set(weighted.map((entry) => entry.term));

  return rankByScore(
    documents,
    (document) => {
      const counts = countsOf(document.tokens, wanted);
      let value = 0;
      for (const { term, idf } of weighted) {
        const frequency = counts.get(term);
        if (frequency === undefined) continue;
        value += bm25Weight(frequency, document.tokens.length, idf, averageLength);
      }
      return value;
    },
    limit,
  );
}

/** The mean length of the documents, or `0` for an empty index. **The length normalisation divides by it.** */
export function averageLengthOf(documents: readonly LexicalDocument[]): number {
  if (documents.length === 0) return 0;
  let total = 0;
  for (const document of documents) total += document.tokens.length;
  return total / documents.length;
}
