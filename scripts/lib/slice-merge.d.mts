/**
 * **Two slices of one corpus read as one experiment** - declared because the module is JavaScript and the tests are
 * TypeScript.
 */
import type { CoverageRow } from './corpus-resolution.mjs';

/** One artifact of one slice, as the bench writes it. */
export interface SliceArtifact {
  readonly corpus?: string;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly corpusSlice?: { readonly skip?: number; readonly requested?: number; readonly slices?: readonly { skip: number; max: number }[] };
  readonly prsReviewed?: number;
  readonly truePositives?: number;
  readonly falsePositives?: number;
  readonly falseNegatives?: number;
  readonly precision?: number;
  readonly recall?: number;
  readonly f1?: number;
  readonly coverage?: { readonly byPullRequest?: readonly CoverageRow[] };
}

export interface MergedArtifact extends SliceArtifact {
  readonly corpusSlice: { readonly slices: readonly { skip: number; max: number }[]; readonly skip: number; readonly requested: number };
  readonly mergedFrom: readonly {
    readonly slice: { skip: number; max: number };
    readonly pullRequests: number;
    readonly truePositives: number;
    readonly falsePositives: number;
    readonly falseNegatives: number;
  }[];
}

export declare function mergeSlices(artifacts: readonly SliceArtifact[]): MergedArtifact;
