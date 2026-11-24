/**
 * **The declaration for `gate-replay.mjs` and `scripts/lib/gate-replay.mjs`, so the gate's price is asserted rather than
 * read off a printed table.**
 *
 * The modules are `.mjs` because the CLI is run with plain `node` against a downloaded artifact, and a `.d.mts` sits
 * beside them for the reason `like-for-like.d.mts` gives: **a helper exercised only through its CLI is a helper whose
 * arithmetic is asserted by reading output**, which is how a delta gets quoted without the pool it came from.
 *
 * **The shapes are declared here rather than imported, and the reason is a measurement rather than a preference.** A
 * declaration file's imports are skipped by `skipLibCheck`, so an import that fails to resolve - `./x.js` from a `.d.mts`
 * resolves to `x.d.ts` and the judge is `x.ts` - leaves a base interface that contributes nothing and a `GroundableRow`
 * missing the three fields it was extending. The first version of this file did exactly that and reported six type errors
 * in a suite CI then refused. **Three fields restated is a smaller lie than an import that silently resolves to nothing**,
 * and the gate's own type is the shape the tests call `decideGrounding` through, so a drift is caught there.
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

/**
 * **The row as the gate reads it** - the fields it dereferences plus the sentence and the quotation.
 *
 * `path`, `startLine` and `endLine` are declared required because every row the replay scores carries them: the artifact
 * writes all three for every finding, and a row without them is one the matching would not credit anyway.
 */
export interface GroundableRow {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly existingCode?: string;
  readonly content?: string;
  readonly suggestionCode?: string;
  readonly filtered?: boolean;
  readonly pr?: string | null;
  readonly category?: string;
  readonly score?: number;
  readonly matchedGoldens?: readonly number[];
  readonly actionable?: boolean;
  readonly text?: string;
}

/**
 * What the gate may read for one pull request.
 *
 * **`change` and `absent` are §150's two additions** and both are optional: the whole change is a place a name can be
 * found, and a path the revision does not have is unpostable rather than unread.
 */
export interface GroundingSources {
  readonly contents: ReadonlyMap<string, string>;
  readonly diffs?: ReadonlyMap<string, string>;
  readonly change?: string;
  readonly absent?: ReadonlySet<string>;
}

/** What the gate answers. Deliberately the part `decidePerPullRequest` reads and not the whole of `GroundingDecision`. */
export interface GateAnswer<T> {
  readonly kept: readonly T[];
  readonly applied: boolean;
  readonly withheld: string | null;
  readonly coverage: {
    readonly findings: number;
    readonly readable: number;
    readonly unpostable?: number;
  };
  readonly report: {
    readonly unverifiableQuotes?: number;
    readonly namesNowhere?: number;
    readonly ungrounded: ReadonlyArray<{ readonly reason: string | null }>;
  };
}

/**
 * **The gate itself as a parameter**, so the arithmetic can be held to a stub and this module imports nothing it must build.
 *
 * `findings` is invariant against the generic the caller passes: `decideGrounding` is generic over `T extends
 * GroundableFinding`, so a function taking `readonly T[]` accepts a `readonly GroundableRow[]` and returns that same row
 * type, which is why the answer is generic rather than `GateAnswer<GroundableRow>`.
 */
export type GateDecider = <T extends GroundableRow>(
  findings: readonly T[],
  contents: ReadonlyMap<string, string> | undefined,
  diffs?: ReadonlyMap<string, string>,
  extra?: { readonly change?: string; readonly absent?: ReadonlySet<string> },
) => GateAnswer<T>;

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
  readonly unpostable: number;
}

/** One pull request's decision: applied, or withheld with the reason the product would give. */
export interface PullDecision {
  readonly pr: string;
  readonly applied: boolean;
  readonly withheld: string | null;
  readonly coverage: {
    readonly findings: number;
    readonly readable: number;
    readonly unpostable?: number;
  };
  readonly dropped: number;
}

/** The same two points per pull request, which is where the gate acted rather than a share of a total. */
export interface PullReplay {
  readonly pr: string;
  readonly applied: boolean;
  readonly withheld: string | null;
  readonly findings: number;
  readonly readable: number;
  readonly dropped: number;
  readonly postedBefore: number;
  readonly postedAfter: number;
  readonly goldensBefore: number;
  readonly goldensAfter: number;
}

/** The gate's own accounting, before any golden is priced. */
export interface GateAccounting {
  readonly findings: number;
  readonly dropped: number;
  readonly coverage: ReplayCoverage;
  readonly unverifiableQuotes: number;
  readonly namesNowhere: number;
  readonly withheldPullRequests: number;
  readonly byReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly decisions: readonly PullDecision[];
  readonly perPullRequest: readonly PullReplay[];
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

/** The row as the gate reads it. */
export function groundableRow(row: ArtifactRow): GroundableRow;

/** Every (pull request, path) the replay has to be able to read, which is the fetch list and the coverage claim at once. */
export function requiredSources(findings: readonly ArtifactRow[]): Map<string, Set<string>>;

export interface DecideResult {
  readonly keptIndices: Set<number>;
  readonly decisions: PullDecision[];
  readonly coverage: ReplayCoverage;
  readonly dropped: number;
  readonly unverifiableQuotes: number;
  readonly namesNowhere: number;
  readonly byReason: Map<string, number>;
}

/**
 * **Where the names a comment mentions live**, which is the distribution the retired name check was reading.
 *
 * `nowhere` is the only bucket the check could ever have been right about; `noName` and the three located buckets are the
 * comments it could not have decided, and their relative sizes are the argument §150 published for demoting it.
 */
export interface AnchorTally {
  readonly findings: number;
  readonly readable: number;
  readonly noName: number;
  readonly inRange: number;
  readonly inFile: number;
  readonly inChange: number;
  readonly nowhere: number;
  readonly examples: ReadonlyArray<{
    readonly pr: string;
    readonly path: string;
    readonly line: number;
    readonly names: readonly string[];
  }>;
}

export function anchorsOf(
  findings: readonly ArtifactRow[],
  sourcesFor: (pullRequest: string) => GroundingSources | undefined,
): AnchorTally;

export function decidePerPullRequest(
  findings: readonly ArtifactRow[],
  sourcesFor: (pullRequest: string) => GroundingSources | undefined,
  decide: GateDecider,
): DecideResult;

export function replayGroundingGate(input: {
  readonly findings: readonly ArtifactRow[];
  readonly goldens: number;
  readonly steps: readonly unknown[];
  readonly sourcesFor: (pullRequest: string) => GroundingSources | undefined;
  readonly decide: GateDecider;
  readonly published?: {
    readonly k?: number;
    readonly emitted?: number;
    readonly truePositives?: number;
    readonly f1?: number;
  };
}): GateReplay;
