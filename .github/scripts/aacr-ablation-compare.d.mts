// **Declarations for the comparison script, because the alternative is a test that cannot say what it is asserting.**
//
// The first version of the confirmation test imported this module without these, and the type-check gate failed with
// TS7016 - "implicitly has an 'any' type" - which cascaded into two implicit-any callback parameters. **A test whose
// subjects are `any` cannot be wrong about a type, which means it cannot be checked either**, and the gate refuses an
// any-shaped hole rather than recording one, which is why this file exists instead of a baseline entry.

/** What a registered hypothesis claims, and what would refute it. */
export interface Registration {
  section: string;
  claim: string;
  registeredGain: number;
  /** The mechanism as the registration states it, for the reader. */
  mechanism: string;
  /** The entry of `MECHANISMS` that decides whether that sentence held. */
  mechanismRule: MechanismRule;
  /** Where a confirming run starts and how many pull requests it scores. Empty for a falsified device. */
  confirmation: { skip: number; max: number }[];
}

/**
 * **The mechanisms a registration may name**, so that the verdict field is computed from the sentence it is filed
 * under rather than from a rule the comparison script happens to prefer.
 */
export type MechanismRule = 'recall-holds' | 'recall-trades-below-precision';

export declare const MECHANISMS: Readonly<
  Record<
    MechanismRule,
    (precisionGain: number, recallGain: number, recallTolerance: number) => boolean
  >
>;

export declare const REGISTRATIONS: Readonly<
  Record<'languageChecklist' | 'emissionProfile', Registration>
>;

/** Minutes of whole job per pull request, from the run whose configuration the next run repeats. */
export declare const MEASURED_MINUTES_PER_PULL_REQUEST: number;

/** How many pull requests a job with this many minutes can score at all. */
export declare function slicesThatFit(minutes: number | string): number;

/** The share of its ceiling a confirming run may spend. */
export declare const CONFIRMATION_CEILING_FRACTION: number;

/** What a two-armed comparison cannot resolve at this many goldens. */
export declare function resolutionFor(
  goldens: number,
  options?: { measuredAt?: number; measuredResolution?: number },
): number;

/** The single configuration field the two artifacts differ in, or why there is not exactly one. */
export declare function variedField(
  on: Record<string, unknown>,
  off: Record<string, unknown>,
): { field: string | null; with: unknown; without: unknown };

/** Every reason these two artifacts are not the same experiment. */
export declare function confoundsBetween(
  on: Record<string, unknown>,
  off: Record<string, unknown>,
): { field: string; expected: unknown; known: unknown }[];

/** The paired arithmetic, as a function of two artifacts and nothing else. */
export declare function summarise(
  on: Record<string, unknown>,
  off: Record<string, unknown>,
): Record<string, unknown>;
