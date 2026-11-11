// Types for `paired-replay.mjs`.

/** A point, with the four counts it was computed from. */
export interface ReplayPoint {
  findings: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** How many goldens one arm covers that the other does not. */
export interface Discordance {
  oursOnly: number;
  theirsOnly: number;
}

/** One category's contribution to an arm's true positives. */
export interface CategoryTally {
  findings: number;
  truePositives: number;
}

export type CategoryTable = Record<string, CategoryTally>;

/** An arm scored over the paired corpus, with the arm it is compared to. */
export interface PairedArm extends ReplayPoint {
  against: ReplayPoint;
  discordance: Discordance;
  byCategory: CategoryTable;
}

export interface CompetitorArm extends ReplayPoint {
  byCategory: CategoryTable;
}

export interface ExcludedPull {
  key: string;
  reason: string;
}

export interface WholeCorpusArms {
  everything: ReplayPoint;
  gate: ReplayPoint;
  profile: ReplayPoint;
  /** Their arm under the same actionability gate ours is scored under. */
  theirs: ReplayPoint;
  /** Their arm with every finding emitted, which is what their own publication quoted. */
  theirsEverything: ReplayPoint;
}

export interface PairedReplay {
  measuredAt: string | null;
  pullRequestsScored: number;
  goldensScored: number;
  paired: {
    pullRequests: number;
    goldens: number;
    excluded: ExcludedPull[];
    scoresByThemOnly: ExcludedPull[];
    theirs: CompetitorArm;
    theirsEverything: CompetitorArm;
    oursUngatedAgainstTheirsUngated: Discordance;
    everything: PairedArm;
    gate: PairedArm;
    profile: PairedArm;
  };
  whole: WholeCorpusArms;
  dropCategories: string[];
}

export interface ReplayVerdict {
  arm: 'gate' | 'profile';
  ok: boolean;
  mismatches: Array<{ field: string; published: number; replayed: number; arm: string }>;
}

export declare function maximumMatchingIndices(matches: number[][], goldens: number): number[];

export declare function matchingOwners(matches: number[][], goldens: number): number[];

export declare function replayHeadToHead(input: {
  bench?: Record<string, unknown> | null;
  baseline?: Record<string, unknown> | null;
  dropCategories?: string[];
}): PairedReplay;

export declare function compareReplayToArtifact(
  replay: PairedReplay,
  bench: Record<string, unknown> | null,
): ReplayVerdict;
