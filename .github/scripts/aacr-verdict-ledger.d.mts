// **Declarations for the verdict ledger, because a test that reads `any` cannot be wrong about a shape.**
//
// The module is plain ESM under `.github/scripts/`, which the TypeScript gate sees only through this file. Without it the
// test that asserts a round trip compiles to `any` on both sides of the comparison, and a comparison of two `any`s is
// not an assertion - it is a call that returns `boolean` for the wrong reason.
//
// **`decodeVerdictLedger` takes `unknown` rather than its own output type.** Its whole job is to refuse a file this module
// did not write, and a parameter typed as the shape it writes would push that refusal into a cast at every call site.

/** The version stamped into every ledger. A reader that meets another number refuses the file rather than guessing. */
export declare const VERDICT_LEDGER_VERSION: 1;

/** What one run's matrix looks like on disk: one character per pair, in an order the file names. */
export interface VerdictLedger {
  version: 1;
  /** The coordinate carried by position rather than by a field, written out so a reader never has to infer it. */
  order: 'golden-major';
  findings: number;
  goldens: number;
  /** `1` match, `0` no match, `?` the judge did not answer. Length is `findings * goldens`. */
  cells: string;
}

/** The matrix as the arithmetic reads it: index `golden * findings + finding`, `null` for an unanswered pair. */
export interface VerdictMatrix {
  findings: number;
  goldens: number;
  verdicts: (boolean | null)[];
}

/**
 * Encode the matrix a judge pass already computed.
 *
 * `undefined` is accepted and written as `?`, because that is how a pair the loop never reached is held in memory - and a
 * hole in the loop and a refusal by the model are the same sentence about the job.
 */
export declare function encodeVerdictLedger(input: {
  findings: number;
  goldens: number;
  verdicts: (boolean | null | undefined)[];
}): VerdictLedger;

/** Read a ledger back, refusing every shape this module did not write. */
export declare function decodeVerdictLedger(ledger: unknown): VerdictMatrix;

/** Rebuild `matches[finding] = [golden, ...]`, the shape every downstream figure in the bench reads. */
export declare function matchesFromVerdictLedger(matrix: VerdictMatrix): number[][];
