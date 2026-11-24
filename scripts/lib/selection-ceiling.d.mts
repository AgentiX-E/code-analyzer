/**
 * **The declaration for `selection-ceiling.mjs`, so the ceiling is asserted rather than quoted from a printed run.**
 *
 * The module is `.mjs` because `scripts/aacr-selection-ceiling.mjs` and every probe that asks the same question call it
 * with plain `node`, and a `.d.mts` sits beside it for the reason `like-for-like.d.mts` gives: **a helper exercised only
 * through its CLI is a helper whose arithmetic is asserted by reading output**, which is how a ceiling becomes a target
 * nobody can check.
 */

/** One entry of the row set: a pull request, its answer key's size, and the indices a matching already covered. */
export interface CeilingRow {
  readonly pr: string;
  readonly goldens: number;
  readonly covered: readonly number[];
}

/** One entry of the corpus: a pull request and the text of its reference comments, in the artifact's index order. */
export interface CorpusRow {
  readonly pullRequest: string;
  readonly comments: readonly string[];
}

export interface SelectionCeiling {
  readonly version: string;
  /** The denominator: every reference comment in the row set, including pull requests a cut silenced. */
  readonly referenceComments: number;
  /** Reference comments a maximum matching already paid for. */
  readonly covered: number;
  /** Not covered, but some sentence this run emitted names one of their code objects. */
  readonly reachableWithoutCoverage: number;
  /** Reference comments naming no code object at all, which no lexical measure can place on either side. */
  readonly unmeasurable: number;
  /** Reference comments naming objects no emitted sentence names: unreachable by any selection over this emission. */
  readonly unreachable: number;
  /** `(covered + reachableWithoutCoverage) / referenceComments`. */
  readonly ceiling: number;
  readonly unreachableShare: number;
  readonly examples: readonly { readonly pullRequest: string; readonly note: string }[];
}

/** The code objects a sentence names: backticked spans, and prose words shaped like identifiers. */
export function codeObjectsIn(text: unknown): Set<string>;

export function selectionCeiling(input: {
  readonly findings: readonly {
    readonly pr?: string | null;
    readonly path?: string | null;
    readonly text?: unknown;
  }[];
  readonly rows: readonly CeilingRow[];
  readonly corpus: readonly CorpusRow[];
}): SelectionCeiling;

/** The ceiling as a sentence, with its denominator, so it cannot be read as a precision. */
export function ceilingLine(ceiling: SelectionCeiling): string;

/** The version of this arithmetic, recorded in the artifact beside the figure it produced. */
export const CEILING_VERSION: string;
