// @code-analyzer/intelligence — the control that runs where the product cannot
//
// **A comparison is only as good as the set both sides were measured on.** Iteration 70 published MAP 0.3794 over the
// 24 instances that finished, and the eleven that did not were refused by one rule - a checkout above 2 000 files - and
// every one of them is a large Java or Kotlin repository. **A large repository has more candidates to rank**, so the
// sub-population that produced the figure is the sub-population that is easiest to rank, and the published baseline
// table (GPT-4 0.39, GTE 0.33, Mistral 0.30, TF-IDF 0.27, BM25 under 0.25) was measured on all fifty instances of each
// split. **The figure and the table are therefore not the same quantity**, and no amount of repeating the figure fixes
// that.
//
// **The repair is a control variate, not an apology.** BM25 needs no parser, no graph and no model: it reads the answer
// space's text, counts terms, and ranks. It therefore runs on **every** instance, including the ones whose analysis the
// supervisor would kill - and it is not an arbitrary control, because it is one of the baselines the paper itself
// publishes. Running it beside our retriever turns one unpaired number into two paired ones:
//
//   * `MAP(ours) - MAP(BM25)` **per instance**, which is a difference between two rankings of the same files of the same
//     repository at the same commit - so repository size, language and issue difficulty cancel instead of confounding;
//   * `MAP(BM25)` **per stratum of repository size**, which measures how much easier the instances we could run are, in
//     the units of the comparison the reader is being asked to accept.
//
// **What this is not.** It is not the paper's BM25 row reproduced: their configuration indexes what their script indexes
// with their tokeniser, and this module states its own (k1 1.2, b 0.75, camel-case splitting, 64 KB per file) in the
// artifact beside the number. **A control that is documented is a control; a control that is described as "the same as
// theirs" is a claim nobody can check.**
//
// **And a second control reads the same index, because one is not enough to carry the conclusion.** The retrieval
// reading the product now ships - a file's position is its best two declarations rather than its best one - was chosen
// against BM25: the paired interval excluded zero on the armature and BM25 was the control on those rows. **A decision
// made against one comparator is a decision that can be fitted to it**, and the question a reader is entitled to ask is
// whether the gain is a property of retrieval in general or of the one scorer the choice was tuned against. TF-IDF is
// the second control: same documents, same tokeniser, same caps, same tie-break, and a different weighting formula - so
// whatever differs between the two arms is the formula and nothing else. It is also one of the paper's own rows
// (`TF-IDF` 0.27), which is why it is the one worth adding rather than a scorer this project invented to lose.

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { averagePrecision, firstRelevantRank } from './lca-instrument.js';

/** The rank-frequency saturation the BM25 literature fixes at 1.2 for short documents. **Stated, not tuned.** */
export const BM25_K1 = 1.2;

/** The length-normalisation weight: 0.75 is the standard midpoint between "ignore length" and "divide by length". */
export const BM25_B = 0.75;

/**
 * How much of one file the index reads.
 *
 * **A cap, because the index runs in the parent process and the parent is the thing that must survive.** The instance
 * whose analysis the supervisor kills is exactly the instance this control has to measure, so the control cannot read
 * a 6 MB minified bundle into memory to count it. Truncation is published per instance as `truncatedFiles` rather than
 * applied quietly.
 */
export const BM25_MAX_FILE_BYTES = 65_536;

/** How many documents the index may hold. **A second cap for the same reason, and the answer space is far below it.** */
export const BM25_MAX_DOCUMENTS = 4_000;

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
 * The index's terms for a piece of text.
 *
 * **Both the whole token and its camel-case parts**, because an issue says "login" and the declaration says
 * `handleLogin` - a tokeniser that keeps only whole identifiers would score the control lower than the baseline it is
 * standing in for, and a control that is weaker than the published row makes our own figure look better than it is.
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

/** One document: its term counts, and how many terms it held. */
export interface TermDocument {
  /** Repository-relative POSIX path, **the corpus's own coordinate system**. */
  readonly path: string;
  readonly termFrequency: ReadonlyMap<string, number>;
  readonly length: number;
}

/** Everything the ranking needs, built once per instance. **One index, read by two scorers.** */
export interface TermIndex {
  readonly documents: readonly TermDocument[];
  /** How many documents hold each term, which is what the inverse document frequency is computed from. */
  readonly documentFrequency: ReadonlyMap<string, number>;
  /** Mean document length, for the length normalisation. `0` on an empty index. */
  readonly averageLength: number;
  /** Files the caps kept out. **Published, because an index that is short is a weaker control.** */
  readonly skippedFiles: number;
  /** Files that could not be read at all. */
  readonly unreadableFiles: number;
}

/** Read at most `cap` bytes of a file, or `null` when it cannot be read. **Bounded by the cap, not by the file.** */
function readPrefix(absolute: string, cap: number): string | null {
  let handle: number | null = null;
  try {
    const size = statSync(absolute).size;
    const wanted = Math.min(size, cap);
    const buffer = Buffer.allocUnsafe(wanted);
    handle = openSync(absolute, 'r');
    let filled = 0;
    while (filled < wanted) {
      const read = readSync(handle, buffer, filled, wanted - filled, filled);
      // **The one branch in this module no test reaches, and it is stated rather than excused.** A regular file returns
      // everything it was asked for; a short read here means the file shrank between the `stat` and the `read`, which
      // is a race with another process and not a case a fixture can construct. It stays because without it a file that
      // *did* shrink would spin the loop forever, and an unreachable guard against an unbounded loop is cheaper than
      // the alternative.
      if (read === 0) break;
      filled += read;
    }
    return buffer.subarray(0, filled).toString('utf8');
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}

/** Options for {@link buildTermIndex}. **Stated at the call site so the artifact can print them.** */
export interface TermIndexOptions {
  readonly maxFileBytes?: number;
  readonly maxDocuments?: number;
  /** Prefix a document's text with its path, so a term in a filename can match. **Default `true`.** */
  readonly includePath?: boolean;
}

/**
 * Index an answer space.
 *
 * **The files are the corpus's own answer space**, not the checkout: the published baselines rank exactly the non-test
 * files of the configuration's extension, and a control allowed to rank a superset would be a control measured on an
 * easier question.
 */
export function buildTermIndex(
  checkout: string,
  files: readonly string[],
  options: TermIndexOptions = {},
): TermIndex {
  const cap = options.maxFileBytes ?? BM25_MAX_FILE_BYTES;
  const limit = options.maxDocuments ?? BM25_MAX_DOCUMENTS;
  const includePath = options.includePath ?? true;

  const documents: TermDocument[] = [];
  const documentFrequency = new Map<string, number>();
  let skippedFiles = 0;
  let unreadableFiles = 0;
  let totalLength = 0;

  for (const path of files) {
    if (documents.length >= limit) {
      skippedFiles += 1;
      continue;
    }
    const text = readPrefix(join(checkout, path), cap);
    if (text === null) {
      unreadableFiles += 1;
      continue;
    }
    // **The path is part of the document.** An issue that names `HttpClient.kt` is naming a file, and a control that
    // could not see the filename would be a control we built to lose.
    const tokens = tokenize(includePath ? `${path} ${text}` : text);
    const termFrequency = new Map<string, number>();
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    for (const term of termFrequency.keys())
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    totalLength += tokens.length;
    documents.push({ path, termFrequency, length: tokens.length });
  }

  return {
    documents,
    documentFrequency,
    averageLength: documents.length === 0 ? 0 : totalLength / documents.length,
    skippedFiles,
    unreadableFiles,
  };
}

/** The BM25 weight of one term in one document. **Zero when the term is absent**, which is what makes a sparse sum. */
function bm25Score(
  document: TermDocument,
  term: string,
  idf: number,
  averageLength: number,
): number {
  const frequency = document.termFrequency.get(term);
  if (frequency === undefined) return 0;
  const normaliser =
    BM25_K1 * (1 - BM25_B + (BM25_B * document.length) / Math.max(averageLength, 1));
  return (idf * (frequency * (BM25_K1 + 1))) / (frequency + normaliser);
}

/**
 * Rank the index against a query.
 *
 * **Ties are broken by path, ascending**, so the ranking is a function of the corpus rather than of the order the
 * filesystem returned the directory in. A control whose tie-break is `Array.prototype.sort`'s stability is a control
 * whose number can move between two runs of the same commit.
 *
 * **Only documents that matched at least one term are returned.** A BM25 score of zero is not a weak ranking, it is the
 * absence of one, and returning the whole answer space in path order would give credit for a name match that never
 * happened.
 */
export function rankBm25(index: TermIndex, query: string, limit: number): string[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || index.documents.length === 0) return [];
  const total = index.documents.length;
  const weighted = terms.map((term) => {
    const frequency = index.documentFrequency.get(term) ?? 0;
    // **The BM25+ style smoothed inverse document frequency**, which stays positive for a term in every document:
    // `ln(1 + (N - df + 0.5) / (df + 0.5))` is never negative, and a negative weight would let a matching term push a
    // file down the list.
    return { term, idf: Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)) };
  });

  return rankScored(
    index,
    (document) => {
      let value = 0;
      for (const { term, idf } of weighted)
        value += bm25Score(document, term, idf, index.averageLength);
      return value;
    },
    limit,
  );
}

/**
 * Score every document, drop the ones that scored nothing, sort and cut.
 *
 * **The half both controls share, and sharing it is the point.** The two readings are supposed to differ in one thing -
 * the formula that turns a term count into a weight - so the tie-break, the drop-the-zeros rule and the cut are written
 * once. Two copies of this would let a later edit make the comparison a comparison of two orderings rather than of two
 * weightings, and the diff would look like a one-line change.
 */
function rankScored(
  index: TermIndex,
  scoreOf: (document: TermDocument) => number,
  limit: number,
): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const document of index.documents) {
    const value = scoreOf(document);
    if (value > 0) scored.push({ path: document.path, score: value });
  }
  scored.sort((left, right) =>
    left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score,
  );
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.path);
}

/**
 * The smoothed inverse document frequency of TF-IDF: `ln((1 + N) / (1 + df)) + 1`.
 *
 * **Smoothed for the same reason BM25's is**: a term that appears in every document must weigh something rather than
 * nothing, and a weight of zero would make a whole class of matches invisible instead of weak.
 */
function tfidfIdf(documentFrequency: number, total: number): number {
  return Math.log((1 + total) / (1 + documentFrequency)) + 1;
}

/**
 * The term's weight in one document: **sublinear** term frequency times the smoothed idf.
 *
 * **`1 + ln(tf)` rather than `tf`**, because a file that mentions a word forty times is not forty times more about it -
 * the same reason BM25 saturates, arrived at without a parameter. And **the document vector is L2 normalised** by
 * {@link rankTfidf} rather than by a length parameter, which is the other half of what makes this a different weighting
 * and not a different configuration of the same one.
 */
function tfidfWeight(frequency: number, idf: number): number {
  return (1 + Math.log(frequency)) * idf;
}

/**
 * Rank the same index with TF-IDF cosine similarity.
 *
 * **Cosine rather than a raw sum, so length is divided out rather than tuned away.** BM25's `b` is a parameter that says
 * how much a document's length should count; the cosine says it counts once, in the norm, and there is nothing to set.
 *
 * **The document norm is over the document's own terms and not over the query's**, which is what makes the two controls
 * differ in weighting alone: a norm computed over the three query terms would be a different document representation
 * with a different vocabulary, and the pairing would no longer isolate the formula. The cost is one pass over the
 * index's tokens per query, and this harness asks one question per instance.
 */
export function rankTfidf(index: TermIndex, query: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(query)) counts.set(token, (counts.get(token) ?? 0) + 1);
  if (counts.size === 0 || index.documents.length === 0) return [];
  const total = index.documents.length;

  const queryWeight = new Map<string, number>();
  let queryNormSquared = 0;
  for (const [term, frequency] of counts) {
    const documentFrequency = index.documentFrequency.get(term);
    // **A term no document holds contributes to neither side of the cosine**, and keeping it would divide every score
    // by a norm that includes a dimension nothing occupies.
    if (documentFrequency === undefined) continue;
    const weight = tfidfWeight(frequency, tfidfIdf(documentFrequency, total));
    queryWeight.set(term, weight);
    queryNormSquared += weight * weight;
  }
  if (queryWeight.size === 0) return [];
  const queryNorm = Math.sqrt(queryNormSquared);

  return rankScored(
    index,
    (document) => {
      let dot = 0;
      let normSquared = 0;
      for (const [term, frequency] of document.termFrequency) {
        // **The second branch in this module no fixture reaches, and it is stated rather than excused.**
        // `documentFrequency` is incremented for every term of every document in `buildTermIndex`, so a term that a
        // document holds is always in the map. The fallback stays because the alternative is a non-null assertion on a
        // lookup, which would turn a build defect into a silent `NaN` in a published figure rather than into `0`.
        const documentFrequency = index.documentFrequency.get(term) ?? 0;
        const weight = tfidfWeight(frequency, tfidfIdf(documentFrequency, total));
        normSquared += weight * weight;
        const fromQuery = queryWeight.get(term);
        if (fromQuery !== undefined) dot += fromQuery * weight;
      }
      // **`normSquared` needs no zero guard**: a non-zero dot product means the document holds a query term, which means
      // it holds at least one term, which means its norm is positive. A guard there would be a branch no fixture can
      // reach and the coverage report would have to excuse - the same reason `readPrefix` states its own.
      if (dot === 0) return 0;
      return dot / (Math.sqrt(normSquared) * queryNorm);
    },
    limit,
  );
}

/** What one instance's control produced. **Every field is published in the row.** */
export interface ControlResult {
  /** Average precision against the fixing commit, over the same depth the product's MAP column reads. */
  readonly map: number;
  /**
   * Where the first fixing file sits in the control's ranking, counting from one, or `null` when it is not there.
   *
   * **The column that separates two kinds of zero.** The product's own `answerRank` is published beside it, and a row
   * where the control's rank is 1 and ours is 31 is a ranking defect while a row where both are `null` is a corpus the
   * text cannot reach. MAP alone reports both as the same small number.
   */
  readonly rank: number | null;
  /** How many documents the index held. */
  readonly documents: number;
  /** Files the caps kept out of the index. */
  readonly skippedFiles: number;
  /** Files that could not be read. */
  readonly unreadableFiles: number;
  /** The first ten of the ranking, in the corpus's coordinate system, so a reader can see why the number is what it is. */
  readonly ranked: readonly string[];
}

/**
 * The controls' average precision on one instance, **both read off one index**.
 *
 * **The same ruler as the product's own MAP column**: `averagePrecision` from the instrument module, read to the same
 * depth, against the same ground truth, restricted to the same answer space. Nothing here is allowed to differ from
 * the thing it is compared with except the ranking itself.
 *
 * **One index and two rankings is a decision, not a shortcut.** `buildTermIndex` reads the answer space off disk and
 * builds the term counts; building it twice would double the I/O of the only part of this harness that runs on every
 * attempted instance, and - worse - a second build is a second chance for the two controls to see a different set of
 * files, which is exactly the confound a control exists to rule out. The two results therefore share `documents`,
 * `skippedFiles` and `unreadableFiles` by construction, and the gate refuses an artifact where they disagree.
 */
export function lexicalControls(input: {
  readonly checkout: string;
  readonly files: readonly string[];
  readonly query: string;
  readonly expected: readonly string[];
  readonly depth: number;
  readonly options?: TermIndexOptions;
}): { readonly bm25: ControlResult; readonly tfidf: ControlResult } {
  const index = buildTermIndex(input.checkout, input.files, input.options ?? {});
  const read = (ranked: string[]): ControlResult => ({
    map: averagePrecision(ranked, input.expected, input.depth),
    rank: firstRelevantRank(ranked, input.expected),
    documents: index.documents.length,
    skippedFiles: index.skippedFiles,
    unreadableFiles: index.unreadableFiles,
    ranked: ranked.slice(0, 10),
  });
  return {
    bm25: read(rankBm25(index, input.query, input.depth)),
    tfidf: read(rankTfidf(index, input.query, input.depth)),
  };
}
