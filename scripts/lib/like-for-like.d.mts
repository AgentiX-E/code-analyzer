/**
 * **The declaration for `like-for-like.mjs`, so the comparison's arithmetic can be asserted instead of read off a
 * printed table.**
 *
 * The module is `.mjs` because the bench workflow and `scripts/aacr-like-for-like.mjs` both call it with plain `node`,
 * and a `.d.mts` sits beside it for the reason `file-cut.d.mts` gives: **a helper exercised only through its CLI is a
 * helper whose arithmetic is asserted by reading output**, which is how a margin gets quoted across two row sets.
 */

/** One comment as one side's artifact stores it. Only the fields the two arithmetics read are named. */
export interface ComparedFinding {
  readonly pr?: string | null;
  readonly path?: string | null;
  /** The reference comments this comment's verdicts allow it to claim, **within its own pull request**. */
  readonly matchedGoldens?: readonly number[];
  /**
   * The second instrument's verdict, when the run bought `file_semantic_judge`.
   *
   * Its presence on any finding is what makes the `filed` reading exist at all; on the competitor's side it is absent by
   * construction, because a per-file judge has nothing to read.
   */
  readonly fileLevelGoldens?: readonly number[];
  /** Our side's shipped cut: the emission policy's flag. */
  readonly actionable?: boolean;
  readonly score?: number;
}

/** The competitor's baseline, in the shape `benchmarks/aacr/competitor-baseline.json` records it. */
export interface CompetitorBaseline {
  readonly pulls?: Record<
    string,
    {
      readonly goldens?: number;
      /** Positionally aligned with `keep` and `detail`: one entry per comment the competitor posted. */
      readonly matches?: readonly (readonly number[])[];
      readonly keep?: readonly boolean[];
      readonly detail?: readonly { readonly path?: string }[];
    }
  >;
}

/** One side under both arithmetics: the corpus's protocol, and `file-level-semantic-v1`. */
export interface SideScore {
  readonly emitted: number;
  readonly goldens: number;
  readonly protocol: {
    readonly tp: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  };
  readonly corpus: {
    readonly hitNewGt: number;
    readonly coveredGoldens: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  };
  /**
   * The same walk over the second instrument's per-finding verdicts, when the run bought that instrument.
   *
   * **`null` is not zero**: it says the artifact cannot answer this question at all, which is the competitor's state at
   * every price, because its record carries no comment text for a per-file judge to read.
   */
  readonly filed: {
    readonly hitNewGt: number;
    readonly coveredGoldens: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  } | null;
}

/** The cut this repository ships (`drop test`, drop the test path class, twelve per pull request), spelled once. */
export const OUR_SHIPPED_CUT: string;

export interface SharedRowSet {
  readonly rows: readonly {
    readonly pr: string;
    readonly goldens: number;
    readonly ours: readonly ComparedFinding[];
    readonly theirs: NonNullable<CompetitorBaseline['pulls']>[string];
  }[];
  readonly goldens: number;
  /** Pull requests one artifact holds and the other does not, by name, because an invisible exclusion is a tunable one. */
  readonly onlyThisRepository: readonly string[];
  readonly onlyTheCompetitor: readonly string[];
}

export function sharedRows(
  ourFindings: readonly ComparedFinding[],
  competitorBaseline: CompetitorBaseline,
): SharedRowSet;

export function shippedCut(row: SharedRowSet['rows'][number]): {
  readonly ourFindings: readonly ComparedFinding[];
  readonly theirFindings: readonly ComparedFinding[];
};

export function scoreSide(input: {
  readonly findings: readonly ComparedFinding[];
  readonly goldens: number;
}): SideScore;

/** The comparison, or a throw when the two artifacts share no pull request. */
export function likeForLike(input: {
  readonly ourFindings: readonly ComparedFinding[];
  readonly competitorBaseline: CompetitorBaseline;
}): {
  readonly pullRequests: number;
  readonly goldens: number;
  readonly onlyThisRepository: readonly string[];
  readonly onlyTheCompetitor: readonly string[];
  readonly sides: { readonly ours: SideScore; readonly theirs: SideScore };
};

/** Precision at a volume that is a total and not a fraction, so the comparison is not also a rounding comparison. */
export function atVolume(input: {
  readonly findings: readonly ComparedFinding[];
  readonly goldens: number;
  readonly total: number;
}): SideScore;
