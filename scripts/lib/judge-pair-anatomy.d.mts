/**
 * **The declarations exist because the module is JavaScript and the tests are TypeScript.**
 *
 * `tsconfig.tests.json` typechecks the tests, and a `.mjs` import without declarations is `any` - which is how a field
 * named `path` in one place and `filePath` in another survives to a table that reads plausibly and adds up wrong.
 */
import type { EmittedFinding, Point } from './operating-point.mjs';

/** One pull request as the corpus file writes it. **Only the two fields the indexing uses are required.** */
export interface CorpusPull {
  readonly githubPrUrl?: string;
  readonly comments?: readonly { readonly note?: string; readonly path?: string }[];
}

/** A candidate rule over one `(finding path, golden path)` pair. */
export interface PairRule {
  readonly name: string;
  readonly matches: (findingPath: string, goldenPath: string) => boolean;
}

export const PAIR_RULES: readonly PairRule[];
export const NO_FILTER: PairRule;

export interface PairRow {
  readonly name: string;
  /** How many of the judge's pairs survive the rule. */
  readonly pairs: number;
  readonly allPairs: number;
  /** The share of pairs that survive, or `null` when the artifact has no pairs at all. */
  readonly survival: number | null;
  /** The artifact's own emission, scored with the judge asked only the surviving pairs. */
  readonly filtered: Point;
  /** The emission a rule would produce if the product could apply it - **it cannot**, and the column says so. */
  readonly gated: Point;
  readonly deltaFiltered: number;
  readonly deltaGated: number;
}

export interface PairAnatomy {
  readonly findings: number;
  readonly goldens: number;
  readonly allPairs: number;
  readonly judgeCalls: number;
  /** Calls the ranked findings do not explain, **printed rather than attributed**. */
  readonly judgeGap: number;
  readonly full: Point;
  readonly shipped: Point;
  readonly rows: readonly PairRow[];
}

export function pairAnatomy(
  bench: {
    readonly rankedFindings?: readonly EmittedFinding[];
    readonly fullEmission?: { readonly truePositives?: number; readonly falseNegatives?: number };
    readonly emissionRules?: { readonly shipped?: { readonly steps?: readonly unknown[] } };
    readonly spend?: { readonly judge?: { readonly calls?: number } };
  },
  corpus: readonly CorpusPull[],
  rules?: readonly PairRule[],
): PairAnatomy;
