// @code-analyzer/intelligence — the file's body, as a ranking
//
// **The arm the product did not have, and the row it explains.** `search/path-imports.ts` reads eight kilobytes of a
// file's head to find its imports and never reads the body, on the argument that "a fallback that read the body would
// be the same instrument with a smaller budget rather than a second one". The argument is about *novelty* and the job
// is *coverage*, and on the Long Code Arena measurement the two came apart: on the 35 instances the analyser refused,
// the path-and-imports reading scored **0.1441** while the lexical control — a bag of words over the whole file —
// scored **0.3116**. Those 35 rows are 23 % of the protocol, and the product's figure over the protocol was
// **0.3919** against the control's **0.4242**. **A fallback that cannot read the body is not a weaker version of the
// analyser; it is a different question answered badly.** What a reader on a twenty-thousand-file checkout has is a
// repository, a question, and no index; the words of the answer are in the files whether or not a parser ran.
//
// **So this is the third arm, and it is deliberately the control's document.** The path, then the body, read as a bag
// of words, scored with BM25 at the constants `lexical.ts` states. **The identity is the point**: the control's column
// and this arm must agree to the last digit on every instance where the control's own four-thousand-document cap does
// not bite, because an arm that quietly ranked differently would make the fusion's gain a gain over two arithmetics
// rather than over two documents. `file-body.test.ts` asserts that equality on a fixture, and the artifact publishes
// both columns so a reader can check it on a run.
//
// **Not shared with the control, on purpose:** the control holds a `Map` of term counts per document, which costs an
// object, a bucket array and a string key per term, and it therefore caps at four thousand documents. This arm holds
// **one `Uint32Array` of the query's own terms per file and nothing else** — no term map, no vocabulary, no token
// array — so it ranks the twenty-thousand-file checkout the analyser refused, which is the only reason it exists. The
// arithmetic is identical and the memory is O(files × query terms): twenty thousand files against thirty query terms is
// 2.4 MB. **The counts are exact**, because only the terms the query names are ever counted — the same property
// `lexical.ts` states for the fallback, taken one step further: the token array is not retained either.
//
// **What this arm is not.** It is not a semantic ranker (no embedding, no model), it is not the analyser (no parser, no
// graph), and it is not a re-ranking of anything. It reads files, counts words, and sorts. Its value is that it runs
// where nothing else does.

import { join } from 'node:path';

import { readHead } from './file-head.js';
import { bm25Idf, bm25Weight, tokenize } from './lexical.js';

/**
 * How many bytes of one file are read.
 *
 * **Sixty-five thousand five hundred and thirty-six, the same cap the lexical control publishes for its own document.**
 * Two arms that differed in their cap would differ in their document, and the comparison this arm was built for is a
 * comparison of two ways of ranking the *same* text. A file longer than the cap contributes its first sixty-four
 * kilobytes; the cap is in the artifact's configuration block, and it is the only quantity in this module that is a
 * choice rather than a definition.
 */
export const BODY_BYTES_PER_FILE = 65_536;

/** Options for {@link rankByFileBody}. **Stated at the call site so the artifact can print them.** */
export interface BodyRankingOptions {
  /** Bytes read per file. Defaults to {@link BODY_BYTES_PER_FILE}. */
  readonly maxBytes?: number;
}

/** What one body-arm ranking produced. **Every field is published in the row or in the configuration block.** */
export interface BodyRanking {
  /** Paths, best first, cut to `limit`. **Only files that matched at least one term**, as in every ranking here. */
  readonly ranked: readonly string[];
  /** How many files were in the answer space, read or not. **The denominator of the mean the arm's figures are over.** */
  readonly documents: number;
  /** Files whose head could not be read at all. **Not the same fact as a file that matched nothing.** */
  readonly unreadableFiles: number;
  /** Bytes of text that were tokenised. **The arm's cost, published so a slow instance is visible per row.** */
  readonly bytesRead: number;
}

/** The empty answer, for a query with no terms or an answer space with no files. */
function nothing(documents: number): BodyRanking {
  return { ranked: [], documents, unreadableFiles: 0, bytesRead: 0 };
}

/**
 * Rank an answer space by the words its files are written in.
 *
 * **One pass over the files, and it is one because the terms are known before the first read.** The document frequency
 * of a term the query does not name is never read, so the counts of one file are a vector over the query's own terms;
 * the inverse document frequencies and the mean length are then derived from that table rather than from a second walk
 * over the corpus. A two-pass design would read every file twice - which on the refused instances is 2.5 GB of I/O - to
 * compute a quantity the first pass already holds.
 *
 * **The path is part of the document**, exactly as the control writes it: an issue that names `HttpClient.kt` is naming
 * a file, and an arm that could not see the filename would be weaker than the control in a way that has nothing to do
 * with bodies. It is prepended once, so it weighs what one occurrence of a term weighs, and BM25's saturation decides
 * the rest.
 */
export function rankByFileBody(input: {
  readonly checkout: string;
  readonly files: readonly string[];
  readonly query: string;
  readonly limit: number;
  readonly options?: BodyRankingOptions;
}): BodyRanking {
  const cap = input.options?.maxBytes ?? BODY_BYTES_PER_FILE;
  const terms = [...new Set(tokenize(input.query))];
  const documents = input.files.length;
  if (terms.length === 0 || documents === 0) return nothing(documents);

  const positionOfTerm = new Map<string, number>();
  for (const [position, term] of terms.entries()) positionOfTerm.set(term, position);

  // **One vector per file, holding the query's terms only.** A `Uint32Array` of thirty entries is a hundred and twenty
  // bytes against the several kilobytes a term map costs, and the whole table is what the second phase sorts.
  const counts: Uint32Array[] = [];
  const lengths = new Uint32Array(documents);
  let unreadableFiles = 0;
  let bytesRead = 0;

  for (const [index, file] of input.files.entries()) {
    const perFile = new Uint32Array(terms.length);
    const text = readHead(join(input.checkout, file), cap);
    if (text === null) {
      // **A file that cannot be read is in the answer space and out of the ranking.** Dropping it would shrink the
      // denominator the mean is over; scoring it as a match would invent one. Its vector stays zero and its length
      // stays zero, so it contributes to `documents` and to nothing else.
      unreadableFiles += 1;
      counts.push(perFile);
      continue;
    }
    bytesRead += Buffer.byteLength(text);
    const tokens = tokenize(`${file} ${text}`);
    lengths[index] = tokens.length;
    for (const token of tokens) {
      const position = positionOfTerm.get(token);
      // **`perFile[position]!` rather than `?? 0`.** The vector was created one line above with one slot per query
      // term and `position` comes from the map that built it, so the read is always defined - a `?? 0` here would be
      // a branch no fixture can reach, and the coverage report would have to excuse it. The assertion says why.
      if (position !== undefined) perFile[position] = perFile[position]! + 1;
    }
    counts.push(perFile);
  }

  // **The document frequency of each query term, read off the vectors.** A file holding a term forty times is one
  // document of evidence, which is what an inverse document frequency is about.
  const documentFrequency: number[] = [];
  for (let position = 0; position < terms.length; position += 1) {
    let frequency = 0;
    // Every vector holds `terms.length` slots, so this index is in range for every element of `counts`.
    for (const perFile of counts) if (perFile[position]! > 0) frequency += 1;
    documentFrequency.push(frequency);
  }

  let totalLength = 0;
  for (const length of lengths) totalLength += length;
  const averageLength = totalLength / documents;

  const idf = terms.map((_, position) => bm25Idf(documentFrequency[position]!, documents));

  const scored: { path: string; score: number }[] = [];
  for (const [index, perFile] of counts.entries()) {
    let score = 0;
    for (let position = 0; position < terms.length; position += 1) {
      const frequency = perFile[position]!;
      if (frequency === 0) continue;
      score += bm25Weight(frequency, lengths[index]!, idf[position]!, averageLength);
    }
    // **A zero is not a weak ranking, it is the absence of one**, which is the rule every ranking in this package keeps:
    // returning the answer space in path order would give credit for a match that never happened.
    if (score > 0) scored.push({ path: input.files[index] as string, score });
  }

  scored.sort((left, right) =>
    left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score,
  );

  return {
    ranked: scored.slice(0, Math.max(0, input.limit)).map((entry) => entry.path),
    documents,
    unreadableFiles,
    bytesRead,
  };
}
