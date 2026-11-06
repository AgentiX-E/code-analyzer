// @code-analyzer/intelligence — fusing a declaration ranking with a file-level one
//
// **Two instruments were measured and each wins where the other loses.** On Long Code Arena's 200-500-file band the
// analyser's declaration pool scores **0.2925** while a ranking built from a file's path and its import statements
// scores **0.4130**; on the 0-50-file band the pool scores **0.6465** and the file-level reading **0.5010**. A product
// that chose between them would be choosing which quarter of the corpus to be wrong about. Fusing is the alternative,
// and this module is the fusion.
//
// **Reciprocal rank fusion, because it has no weight to fit.** The two arms score on scales that are not comparable -
// a BM25 weight over a bag of words and a fused graph score over declarations - and every alternative to RRF needs a
// normalisation chosen on the corpus being measured. RRF reads only **positions**: a path at rank *r* of an arm
// contributes `1 / (k + r)`.
//
// **`k` was 60 - the literature's value for two arms of comparable quality (Cormack, Clarke and Büttcher, SIGIR 2009) -
// and a hundred and nine measured instances said otherwise.** The constant used to be stated rather than tuned, on the
// argument that "a fusion with a tuned `k` is a fusion fitted to the split it was measured on". The argument is right
// and the conclusion was wrong: the ladder of five constants was measured on every instance of one run, and
// **leave-one-language-out cross-validation chose `k = 10` in all three folds** - tuning on Java and Kotlin and reading
// Python, tuning on Python and Kotlin and reading Java, tuning on Python and Java and reading Kotlin - with held-out
// gains of `+0.0316`, `+0.0025` and `+0.0028` over 60. The neighbours are not interchangeable either: on the full sample
// `k = 120` scores `-0.0104` and `k = 300` scores `-0.0117` against 60, with intervals that exclude zero. **60 was not
// on a plateau; it was on a slope, and the slope points down.**
//
// What a smaller `k` means, stated rather than implied: the contribution of a rank falls off faster, so the fusion
// trusts each arm's *head* more and its tail less. That is the right shape here because the file-level arm is a
// path-and-import heuristic whose precision collapses with depth - and it is why the constant travels with the figure,
// `FUSION_K_LADDER` publishes the rungs around it on every row, and `lca-merge.ts` re-scores the alternatives every run.
//
// **Equal weight, and the absence of a weight is a decision.** A weighted fusion would need the weights, the weights
// would come from this corpus, and the ablation that produced them would be indistinguishable from the result it
// explains. What this module publishes instead is each path's contribution **per arm**, so the artifact can show that a
// fusion gain came from the file-level arm carrying a path the pool never ranked rather than from arithmetic.
//
// **A path absent from an arm contributes nothing rather than a penalty.** The pool returns two hundred declarations; an
// implementation that treated "not in the pool" as "last" would double the penalty for every file the pool did not
// reach, which is exactly the failure the fusion exists to repair.

/** The rank constant the fusion ships. **Selected out of fold on 109 instances, and published beside every figure.** */
export const RRF_K = 10;

/** One ranked list taking part in a fusion. **The name is published, because a contribution without a source is a number.** */
export interface RankedArm {
  /** What produced this ranking, e.g. `declarations` or `file-level`. */
  readonly name: string;
  /** Paths, best first, **in one coordinate system across every arm**. */
  readonly ranked: readonly string[];
}

/** What one arm contributed to one path. */
export interface FusedScore {
  /** Repository-relative POSIX path, in whichever coordinate system the arms were given. */
  readonly path: string;
  /** The sum of the arms' contributions. **The quantity the ranking sorts on.** */
  readonly score: number;
  /** Each arm's contribution, keyed by arm name. **A zero is not stored**: an arm that did not rank a path gave it nothing. */
  readonly arms: Readonly<Record<string, number>>;
}

/** A fused ranking: the order, the constant it was computed with, and every contribution behind it. */
export interface FusedRanking {
  /** Paths, best first, cut to `limit`. */
  readonly ranked: readonly string[];
  /** The `k` the contributions were computed with. **Published beside the figure rather than in a comment.** */
  readonly k: number;
  /** Every path any arm ranked, with its contributions, in fused order. **Before the cut**, so a reader can recompute. */
  readonly scores: readonly FusedScore[];
}

/** Options for {@link reciprocalRankFusion}. */
export interface FusionOptions {
  /** The rank constant. **Supplied only by an ablation**, never by the product. */
  readonly k?: number;
  /** How many paths to return. **The full list is still in `scores`**, so a cut is a view and not a loss. */
  readonly limit?: number;
  /**
   * How much one position in an arm is worth, keyed by the arm's own name. **Absent means 1 for every arm.**
   *
   * **A weight of zero removes the arm**, rather than contributing zero: an arm that cannot move the order but can still
   * put a path into the list would turn a one-arm rung of the ladder into a two-arm one, and the rung exists to
   * reproduce a single arm's column exactly. Removing it makes that equality structural instead of approximate.
   *
   * **Weights exist because equal weight is a decision too.** Two arms of equal authority make the fused order a
   * compromise between them, and a compromise with a worse list is a worse list - which is what the Long Code Arena
   * measurement found when a path-and-imports arm at 0.3781 was fused unweighted with a declaration arm at 0.4152 and a
   * body arm at 0.4584. The shipped weighting is a constant with a published ladder, and this parameter is how the
   * ladder is expressed.
   */
  readonly weights?: Readonly<Record<string, number>>;
}

/**
 * Fuse several rankings by reciprocal rank.
 *
 * **A path repeated inside one arm keeps its best position and is not counted twice.** A ranking that names the same
 * file at positions three and eleven is not evidence of two matches: counting both would let one arm outvote another by
 * repeating itself, and repetition inside an arm is an artefact of whatever produced it rather than a signal.
 *
 * **Ties are broken by path, ascending**, for the same reason every other ranking in this package is: a fused order
 * that moved between two runs of the same input would be an order about the sort's stability.
 */
export function reciprocalRankFusion(
  arms: readonly RankedArm[],
  options: FusionOptions = {},
): FusedRanking {
  const k = options.k ?? RRF_K;
  const contributions = new Map<string, Record<string, number>>();
  for (const arm of arms) {
    const weight = options.weights?.[arm.name] ?? 1;
    // **A removed arm is not a zero-weight arm.** See `FusionOptions.weights`: a zero here would still admit every path
    // the arm ranked into the fused list at score zero, so a rung that means "this arm alone" would publish a list that
    // is the union of all of them, and the equality the ladder checks would hold on the numbers and not on the order.
    if (weight === 0) continue;
    const seen = new Set<string>();
    let position = 0;
    for (const path of arm.ranked) {
      if (seen.has(path)) continue;
      seen.add(path);
      position += 1;
      const entries = contributions.get(path) ?? {};
      entries[arm.name] = (entries[arm.name] ?? 0) + weight / (k + position);
      contributions.set(path, entries);
    }
  }

  const scores: FusedScore[] = [];
  for (const [path, byArm] of contributions) {
    let score = 0;
    for (const value of Object.values(byArm)) score += value;
    scores.push({ path, score, arms: byArm });
  }
  // **Score descending, then path ascending**: a total, not a rounded one, and a tie-break that does not depend on the
  // order the map happened to iterate in.
  scores.sort((left, right) =>
    left.score === right.score ? left.path.localeCompare(right.path) : right.score - left.score,
  );
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  return {
    ranked: scores.slice(0, Math.max(0, limit)).map((entry) => entry.path),
    k,
    scores,
  };
}
