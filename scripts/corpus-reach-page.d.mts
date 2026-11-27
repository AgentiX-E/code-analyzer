// **Declarations for the reach page, because the test imports it and an undeclared module is `any`.**
//
// The same rule `scripts/lib/diff-side-lines.d.mts` records: a test that reaches an undeclared module compiles against
// `any`, so an assertion that the page refuses a non-summing table would pass against a function that returns nothing.
// The shape here is the record `scripts/corpus-reach.mjs` writes and the page reads - nothing else.

/** One bucket of a reach record: where a golden stands relative to the diff, and how many each arm credited there. */
export interface ReachBucket {
  /** `inHunk`, `outsideHunks`, `absentPath` or `unread`; a string, because the page draws a bucket it does not name. */
  bucket: string;
  goldens: number;
  addedInSpan: number;
  ours: number;
  theirs: number | null;
}

/** The record `corpus-reach.mjs` writes under `corpus-reach-v1`. */
export interface CorpusReachRecord {
  version: string;
  source: string;
  /** `live` or `pinned`; a string, because the page prints the record's own word for it. */
  reading?: string;
  basis: string;
  corpus: { pullRequests: number; goldens: number };
  buckets: ReachBucket[];
  addressable: { goldens: number; share: number };
  credited: { ours: number; theirs: number | null };
  rate: {
    oursOnSlice: number;
    oursOnAddressable: number;
    theirsOnSlice: number | null;
    theirsOnAddressable: number | null;
  };
}

export declare function renderCorpusReach(record: CorpusReachRecord): string;
