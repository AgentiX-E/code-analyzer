/**
 * **The declaration for `gate-replay.mjs` and `scripts/lib/gate-replay.mjs`, so the gate's price is asserted rather than
 * read off a printed table.**
 *
 * The modules are `.mjs` because the CLI is run with plain `node` against a downloaded artifact, and a `.d.mts` sits
 * beside them for the reason `like-for-like.d.mts` gives: **a helper exercised only through its CLI is a helper whose
 * arithmetic is asserted by reading output**, which is how a delta gets quoted without the pool it came from.
 */

/** A finding's row, as the artifact carries it: the gate's four fields plus what the cut reads. */
export interface ArtifactRow {
  readonly pr?: string | null;
  readonly path?: string | null;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly text?: string;
  readonly existingCode?: string;
  readonly category?: string;
  readonly score?: number;
  readonly matchedGoldens?: readonly number[];
  readonly actionable?: boolean;
}

/** What the gate may read for one pull request. */
export interface GroundingSources {
  readonly contents: ReadonlyMap<string, string>;
  readonly diffs?: ReadonlyMap<string, string>;
}

/** A point, with the four counts it came from. */
export interface ReplayPoint {
  readonly emitted: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** What the gate was offered and what it read, per pull request and in total. */
export interface ReplayCoverage {
  readonly offered: number;
  readonly readable: number;
}

/** One pull request's decision: applied, or withheld with the reason the product would give. */
export interface PullDecision {
  readonly pr: string;
  readonly applied: boolean;
  readonly withheld: string | null;
  readonly coverage: { readonly findings: number; readonly readable: number };
  readonly dropped: number;
}

/** The gate's own accounting, before any golden is priced. */
export interface GateAccounting {
  readonly findings: number;
  readonly dropped: number;
  readonly coverage: ReplayCoverage;
  readonly unverifiableQuotes: number;
  readonly withheldPullRequests: number;
  readonly byReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly decisions: readonly PullDecision[];
}

/** The removals the criterion is written on: what left the posted set, and how much of it was true. */
export interface RemovalPool {
  readonly posted: number;
  readonly truePositives: number;
  /** `null` when nothing was removed, because a zero would read as a perfect pool. */
  readonly share: number | null;
}

/** The whole replay: two points, the difference, and the pool it was paid at. */
export interface GateReplay {
  readonly cut: { readonly label: string; readonly steps: readonly unknown[] };
  readonly baseline: ReplayPoint;
  readonly gated: ReplayPoint;
  readonly reproduced: boolean | null;
  readonly delta: {
    readonly emitted: number;
    readonly truePositives: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  };
  readonly gate: GateAccounting;
  readonly removals: RemovalPool;
  readonly admitted: { readonly posted: number; readonly truePositives: number };
  readonly goldens: {
    readonly before: number;
    readonly after: number;
    readonly lost: readonly string[];
    readonly gained: readonly string[];
  };
}

export function groundableRow(row: ArtifactRow): ArtifactRow & { content: string };

export function requiredSources(findings: readonly ArtifactRow[]): Map<string, Set<string>>;

export function decidePerPullRequest(
  findings: readonly ArtifactRow[],
  sourcesFor: (pullRequest: string) => GroundingSources | undefined,
  decide: (
    findings: readonly (ArtifactRow & { content?: string })[],
    contents: ReadonlyMap<string, string>,
    diffs?: ReadonlyMap<string, string>,
  ) => {
    kept: readonly (ArtifactRow & { content?: string })[];
    applied: boolean;
    withheld: string | null;
    coverage: { readonly findings: number; readonly readable: number };
    report: {
      readonly unverifiableQuotes?: number;
      readonly ungrounded: ReadonlyArray<{ readonly reason: string | null }>;
    };
  },
): {
  keptIndices: Set<number>;
  decisions: PullDecision[];
  coverage: ReplayCoverage;
  dropped: number;
  unverifiableQuotes: number;
  byReason: Map<string, number>;
};

export function replayGroundingGate(input: {
  readonly findings: readonly ArtifactRow[];
  readonly goldens: number;
  readonly steps: readonly unknown[];
  readonly sourcesFor: (pullRequest: string) => GroundingSources | undefined;
  readonly decide: Parameters<typeof decidePerPullRequest>[2];
  readonly published?: { readonly k?: number; readonly truePositives?: number; readonly f1?: number };
}): GateReplay;
