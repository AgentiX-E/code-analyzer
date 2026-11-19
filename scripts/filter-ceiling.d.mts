/**
 * **The declaration for `filter-ceiling.mjs`, so a test reads the arithmetic the command prints.**
 *
 * The same reason `anchor-rate.d.mts` exists: the script is `.mjs` because a gate calls it with plain `node`, and a
 * helper exercised only through its CLI is a helper whose arithmetic is asserted by pasting its printed table into a
 * document. **The ceiling is the claim that decides whether a fifth filter is worth building**, so it is read by a test
 * rather than quoted from a terminal.
 */

/** One reviewer's rows reduced to the counts both artifacts support. */
export interface ReviewerCounts {
  goldens: number;
  kept: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Distinct goldens matched somewhere in the run, over the corpus - the generator's own recall. */
  generatorRecall: number;
  generatorMatched: number;
  /** Keep exactly the findings that matched: precision is 1 by construction, recall unchanged. */
  ceilingAtPerfectPrecision: number;
  /** The same set scored without the gift of perfect precision. */
  ceilingRescued: number;
  /** Where F1 stops if recall goes to 1 at the precision the run achieved. */
  asymptoteAtThisPrecision: number;
}

/** One point of the precision/recalibration frontier. */
export interface FrontierRow {
  precision: number;
  requiredMatched: number | null;
  reachable: boolean;
}

/** What the run published, on its own basis, carried rather than recomputed. */
export interface PublishedFigures {
  kept: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
  goldensHit: number;
}

/** The artifact `filter-ceiling.mjs` writes to `benchmarks/filter-ceiling.json`. */
export interface Ceiling {
  comment: string[];
  measuredAt: string;
  sources: { ours: string; theirs: string };
  target: number;
  ours: ReviewerCounts;
  theirs: ReviewerCounts;
  oursPublished: PublishedFigures;
  /** Both reviewers on the pull requests they share, which is the only population on which the two are comparable. */
  shared: {
    pullRequests: number;
    ours: ReviewerCounts;
    theirs: ReviewerCounts;
    /** The two swaps: their precision on our recall, and ours on theirs. */
    crossed: { theirPrecisionOnOurRecall: number; ourPrecisionOnTheirRecall: number };
  };
  frontier: { target: number; rows: FrontierRow[]; floorPrecision: number };
  verdict: {
    targetInsideOurCeiling: boolean;
    targetInsideTheirCeiling: boolean;
    ourCeiling: number;
    theirCeiling: number;
    ourGeneratorRecall: number;
    theirGeneratorRecall: number;
    whatTheirPrecisionWouldBuyOnOurFindings: number;
  };
}

/** The two artifacts, in whatever shape the harness wrote them; only the fields read here are declared. */
export interface OurArtifact {
  measuredAt?: string;
  scoring?: { registeredRule?: string };
  coverage: { byPullRequest: Array<{ goldens: number }> };
  rankedFindings: Array<{ pr: string; actionable?: boolean; matchedGoldens?: string[] }>;
  truePositives?: number;
  falsePositives?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  missedGoldens?: { counts?: { hit?: number } };
}

export interface TheirArtifact {
  pulls: Record<string, { goldens: number; keep: boolean[]; matches: number[][] }>;
}

export function buildCeiling(bench: OurArtifact, baseline: TheirArtifact): Ceiling;
export function formatCeiling(artifact: Ceiling): string;
