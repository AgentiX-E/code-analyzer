// Types for `unread-corpus.mjs`.
//
// **Why a hand-written declaration rather than a rewrite in TypeScript.** The module is imported by a `.mjs` script that
// runs under plain node with no build step, and by tests that run through vitest - so **the file it imports has to be
// the file that runs**. A `.ts` source would put a build between the harness and its own logic, which is the one place
// this repository has kept free of one.

/** How much of the corpus a run actually read, with the two counts it was derived from. */
export interface CorpusRead {
  requested: number;
  unread: number;
  read: number;
  /** `unread / requested`, rounded to four places; `0` for an empty corpus. */
  share: number;
}

/** **The largest loss that cannot move a recall figure by more than its own error bar on this corpus.** */
export declare const UNREAD_DISCLOSURE_THRESHOLD: number;

export declare function unreadCorpus(input: {
  requested?: number | null;
  unread?: number | null;
}): CorpusRead;

/** **`null` when nothing was lost**, so a caller cannot forget to decide whether to print. */
export declare function describeUnread(input: {
  requested?: number | null;
  unread?: number | null;
  pulls?: Array<{ key?: string; reason?: string }> | null;
}): string | null;

export declare function readTheWholeCorpus(input: {
  requested?: number | null;
  unread?: number | null;
}): boolean;
