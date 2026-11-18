// @code-analyzer/intelligence — Retrieval over the cognition index, by a finding's own vocabulary
//
// **The mechanism this file copies, and the one §79.3 named M3 and never built.** `aoci-code` does not retrieve with
// embeddings: `index.Search(doc, keyword, tagFilter)` returns whole lines, capped at thirty, and the keyword comes from
// whatever the reader is currently looking at - `internal/mcptools/tools_read.go`. **The claim being tested is that a
// finding's own words are a good enough query**, and it is worth testing because the alternative - a vector store over a
// repository - costs a network call, a provider quota, and an answer no reader can check line by line.
//
// **No model, no embedding, no token.** A substring scan over a file measured in hundreds of rows. **The output is whole
// rows**, not fragments: a fragment of a contract reads like a contract and is not one.

import type { CognitionEntry } from './cognition.js';

/** How many rows a query may return. `aoci-code`'s own cap, kept because it is what makes the result a prompt. */
export const COGNITION_SEARCH_LIMIT = 30;

/** One retrieved row, with the words that matched it. */
export interface CognitionHit {
  readonly entry: CognitionEntry;
  /** The query's words that appear in this row, lower-cased and de-duplicated - so a reader can see *why* it came back. */
  readonly matched: readonly string[];
  /** How many of the query's words the row contains. Higher is a better row, and ties break by importance. */
  readonly score: number;
}

/**
 * **The words a finding's text is actually about.**
 *
 * Case-folded, and split on anything that is not a letter, a digit, `_` or `$` - so `getDirsFromFront(` and
 * `getDirsFromFront` are the same query word, and `Base::Vector3d` contributes `Base` and `Vector3d`.
 *
 * **Words shorter than three characters are dropped, and that is a decision rather than a convenience.** `if`, `a`, `to`
 * and `of` appear in every row of every index, so including them would make every query match every row and turn the
 * score into a rank of nothing. A token of two characters that a reader cares about - `id`, `io` - is a real loss and is
 * taken deliberately: **a query that returns thirty rows because it matched every row has returned nothing.**
 */
export function queryWords(text: string): string[] {
  const words = new Set<string>();
  for (const raw of text.split(/[^A-Za-z0-9_$]+/u)) {
    const word = raw.toLowerCase();
    if (word.length >= 3) words.add(word);
  }
  return [...words];
}

/**
 * **Scan the index for the rows a query is about, best first.**
 *
 * The score is **how many of the query's words a row contains**, which is the only ordering a substring scan can justify
 * without inventing a weight. Ties break by importance, then by path, so the result is deterministic: **a retrieval that
 * reorders itself between two runs of the same query is a retrieval nobody can diff.**
 *
 * **An empty query returns nothing rather than everything.** A finding with no words is a finding with no subject, and
 * returning the whole index for it would spend the budget on the alphabet.
 */
export function searchCognitionIndex(
  entries: readonly CognitionEntry[],
  query: string,
  options: { readonly limit?: number } = {},
): CognitionHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const limit = options.limit ?? COGNITION_SEARCH_LIMIT;

  const hits: CognitionHit[] = [];
  for (const entry of entries) {
    const haystack = rowText(entry).toLowerCase();
    const matched = words.filter((word) => haystack.includes(word));
    if (matched.length === 0) continue;
    hits.push({ entry, matched, score: matched.length });
  }

  hits.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.entry.importance !== left.entry.importance)
      return right.entry.importance - left.entry.importance;
    return left.entry.path < right.entry.path ? -1 : left.entry.path > right.entry.path ? 1 : 0;
  });

  return hits.slice(0, Math.max(0, limit));
}

/**
 * **The text a query is matched against: the row's content, and not its shape.**
 *
 * Two exclusions, and both are load-bearing:
 *
 * - **The tag is not there.** `C7M` is the row's budget, and a keyword cannot be about a budget.
 * - **`S=none` is not there either.** It is the format's way of saying the file has nothing to break, and a query word
 *   that matched it would return every unconstrained row in the repository - which is the same failure as keeping the
 *   words every row contains, one field over.
 */
function rowText(entry: CognitionEntry): string {
  const constraint = entry.constraint.toLowerCase() === 'none' ? '' : entry.constraint;
  return [
    entry.path,
    entry.responsibility,
    entry.readWith.join(' '),
    entry.dependedOnBy.join(' '),
    constraint,
  ].join(' ');
}

/**
 * **The rows to show a reader who is asking about one finding** - the retrieval the gate and the lanes can both spend.
 *
 * Rendered as whole rows, joined by a newline, because that is what `aoci-code` returns and what its budget assumes: a
 * caller that wants fewer characters asks for a smaller `limit` rather than for a truncation, since **a truncated row is a
 * contract with its end cut off**.
 */
export function renderCognitionHits(hits: readonly CognitionHit[]): string {
  return hits
    .map(
      (hit) =>
        `${hit.entry.path} · F: ${hit.entry.responsibility} · S: ${hit.entry.constraint}` +
        (hit.entry.readWith.length === 0 ? '' : ` · R: ${hit.entry.readWith.join(', ')}`),
    )
    .join('\n');
}
