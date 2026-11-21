/**
 * **The declarations exist because the module is JavaScript and the tests are TypeScript.**
 *
 * The tests typecheck, and a `.mjs` import without declarations is `any` - which is how a field renamed in the artifact
 * reaches a table that still adds up.
 */
import type { CorpusPull } from './judge-pair-anatomy.mjs';

export const CACHE_BLOCK_TOKENS: number;

/** One batch size's cost, in requests and characters, over the pairs of one artifact. */
export interface BatchRow {
  readonly size: number;
  readonly calls: number;
  readonly characters: number;
  readonly charactersPerCall: number;
  /** Requests against the per-pair arm's, or `null` when the artifact has no pairs. */
  readonly callsRatio: number | null;
  /** Prompt characters against the per-pair arm's, or `null` when the artifact has no pairs. */
  readonly charactersRatio: number | null;
}

export interface BatchArithmetic {
  readonly findings: number;
  readonly pairs: number;
  readonly goldens: number;
  /** The mean length of the system message - **the block a batch makes shared and a per-pair call pays alone**. */
  readonly meanSystemCharacters: number;
  readonly rows: readonly BatchRow[];
}

export function batchArithmetic(
  bench: { readonly rankedFindings?: readonly { readonly pr?: string; readonly text?: string }[] },
  corpus: readonly CorpusPull[],
  sizes?: readonly number[],
): BatchArithmetic;
