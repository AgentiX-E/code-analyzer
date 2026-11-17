// **Declarations for the comparison script, because the alternative is a test that cannot say what it is asserting.**
//
// The first version of the confirmation test imported this module without these, and the type-check gate failed with
// TS7016 - "implicitly has an 'any' type" - which cascaded into two implicit-any callback parameters. **A test whose
// subjects are `any` cannot be wrong about a type, which means it cannot be checked either**, and the gate refuses an
// any-shaped hole rather than recording one, which is why this file exists instead of a baseline entry.
//
// **And the file drifted, which is the other failure a hand-written declaration has.** Between §61 and §68 the script
// grew `registrationFor`, `registrationResolvable`, `resolutionForPullRequests`, `CORPUS_SAMPLING`,
// `MINIMUM_REGISTERED_GAIN`, `REPRODUCTION` and a second registration key, and none of them arrived here - so five test
// files imported names this file did not declare and the CI type-check went red on four consecutive commits that were
// green locally, because nobody ran the ratchet. **`declarations-match-the-script.test.ts` now reads both files and
// refuses a name that exists on one side only**, which is the repair for the process and not only for the omission.

/** What a registered hypothesis claims, and what would refute it. */
export interface Registration {
  section: string;
  claim: string;
  registeredGain: number;
  /** Which reviewer the claim is about: `file` for the five lanes, `pullRequest` for the reading arm. */
  arm: string;
  /**
   * **The configuration key the sentence varies, when it is not the key it is filed under.** §68's second entry lives
   * under `secondConcern200` because one switch carries two bars, and the switch it varies is `secondConcern`.
   */
  field?: string;
  /** The mechanism as the registration states it, for the reader. */
  mechanism: string;
  /** The entry of `MECHANISMS` that decides whether that sentence held. */
  mechanismRule: MechanismRule;
  /** Where a confirming run starts and how many pull requests it scores. Empty for a falsified device. */
  confirmation: { skip: number; max: number }[];
  /** The second clause of a sentence, as a gate rather than as a remark. */
  guard?: { arm: string; notLoweredBy: number };
  /** Set when the sentence was written after the dispatch, so a reader can tell a prediction from a description. */
  registeredAfterDispatch?: boolean;
  /** The inputs the sentence was written against, where it names them. */
  inputsFormed?: Record<string, unknown>;
  /**
   * **Set when the bar itself sits under the instrument's resolution**, which makes the sentence unfalsifiable
   * whatever the run shows. §68's 0.021 is flagged: at the 146 rows the two slices realized it needs 0.0255.
   */
  registeredBelowResolution?: boolean;
}

/**
 * **The mechanisms a registration may name**, so that the verdict field is computed from the sentence it is filed
 * under rather than from a rule the comparison script happens to prefer.
 */
export type MechanismRule = 'recall-holds' | 'recall-rises' | 'recall-trades-below-precision';

export declare const MECHANISMS: Readonly<
  Record<
    MechanismRule,
    (precisionGain: number, recallGain: number, recallTolerance: number) => boolean
  >
>;

/**
 * **Every device the comparison can price, named by the configuration key it varies.**
 *
 * `adjudicate` was added when §45 registered the claim check and this declaration was not, which nothing noticed because
 * no test read that key - **a declaration that omits a registration is a registration the type checker cannot see**, and
 * the omission surfaced only when `idioms` arrived and a test read it. The union is enumerated rather than widened to
 * `Record<string, Registration>`, so a key added to the script and not to this line still fails.
 */
export declare const REGISTRATIONS: Readonly<
  Record<
    | 'adjudicate'
    | 'adjudicate:falsifier'
    | 'agent'
    | 'codeContext'
    | 'emissionProfile'
    | 'ensemble'
    | 'ensemble:reader'
    | 'idioms'
    | 'languageChecklist'
    | 'remarks'
    | 'secondConcern'
    | 'secondConcern200'
    | 'laneSet',
    Registration
  >
>;

/**
 * **Which sentence judges an artifact, decided by the rows the artifact holds and not by which key is spelled first.**
 *
 * A merged artifact is judged against the sentence naming both slices; a single dispatch against the sentence naming
 * its own; ties go to the sentence naming more slices, and a field's own entry is the fallback.
 */
export declare function registrationFor(
  field: string,
  readSlices: readonly { skip: number; max: number }[],
): Registration | null;

/**
 * **Whether a registration can be answered at the corpus it will be judged on**, returned rather than thrown so that a
 * bar under the instrument's resolution is a rewrite of the sentence rather than a failed device.
 *
 * **The parameter is the one field the function reads**, because a caller asking "can this bar be signed" has a bar and
 * not always a whole registration - and typing it as `Registration` made four such callers write four fields they did not
 * have.
 */
export declare function registrationResolvable(
  registration: Partial<Registration> | null | undefined,
  goldens: number,
): { resolvable: boolean; resolution: number; bar: number | null; reason?: string };

/** Minutes of whole job per pull request, from the run whose configuration the next run repeats. */
export declare const MEASURED_MINUTES_PER_PULL_REQUEST: number;

/** How many pull requests a job with this many minutes can score at all. */
export declare function slicesThatFit(minutes: number | string): number;

/** How much slower than the measured arm a confirming run's day may be and still finish. */
export declare const CONFIRMATION_OVERRUN_TOLERANCE: number;

/** How many pull requests a confirmation on this ceiling can hold and still finish on a slow day. */
export declare function slicesAConfirmationCanFit(minutes: number | string): number;

/**
 * **The corpus the resolution is anchored on**, so that a scaled bar is a formula with an anchor rather than a constant
 * that never improves: 98 pull requests and 715 goldens move the file arm by 0.0191.
 */
export declare const CORPUS_SAMPLING: {
  readonly pullRequests: number;
  readonly goldens: number;
  readonly deltaSd: number;
  readonly armSd: number;
  readonly resamples: number;
  readonly seed: number;
  readonly samplingBar: number;
  readonly measuredOn: string;
  readonly from: string;
};

/** What one configuration run twice does to the figure - the instrument, not the corpus. */
export declare const REPRODUCTION: {
  readonly goldens: number;
  readonly pullRequests: number;
  readonly truePositives: number;
  readonly comments: number;
  readonly f1Delta: number;
  readonly pullRequestsWithDifferentGoldens: number;
  readonly pullRequestsWithDifferentCoverage: number;
  readonly measuredOn: string;
};

/** **The smallest gain this project will register**, because a bar under it cannot be signed by any run it can afford. */
export declare const MINIMUM_REGISTERED_GAIN: number;

/** What a two-armed comparison cannot resolve at this many goldens. */
export declare function resolutionFor(
  goldens: number,
  options?: { measuredAt?: number; measuredResolution?: number },
): number;

/** **The same question in the unit the corpus is sampled in**: pull requests, not goldens. */
export declare function resolutionForPullRequests(
  pullRequests: number,
  options?: { measuredResolution?: number },
): number;

/**
 * The single configuration field the two artifacts differ in, or why there is not exactly one.
 *
 * **`entailed` is the key a device switches on as a consequence of being itself** - `agent: on` turns `codeContext` on -
 * and it is reported rather than folded away, because the pair compares one device and the artifact has to say which
 * keys it did not treat as a second variable.
 */
export declare function variedField(
  on: object,
  off: object,
): {
  field: string | null;
  differ: string[];
  entailed?: string[];
  withValue: unknown;
  withoutValue: unknown;
};

/** Every reason these two artifacts are not the same experiment. */
export declare function confoundsBetween(
  on: object,
  off: object,
): { field: string; expected: unknown; known: unknown }[];

/** The paired arithmetic, as a function of two artifacts and nothing else. */
export declare function summarise(on: object, off: object): Record<string, unknown>;

/**
 * **The paired reading on the rows both arms read**, which is the only difference two artifacts can support when their
 * totals are built from different pull requests.
 */
export declare function pairedOnCommonPullRequests(
  on: object,
  off: object,
): {
  commonPullRequests: number;
  both: number;
  withOnly: number;
  withoutOnly: number;
  pValue: number;
  verdict: string;
  dropped: { with: string[]; without: string[] };
  counts: string;
};

/** The line, so the job's log and the artifact say the same thing about the same pairs. */
export declare function pairedReading(paired: {
  commonPullRequests: number;
  withOnly: number;
  withoutOnly: number;
  pValue: number;
  dropped: { with: string[]; without: string[] };
}): string;
