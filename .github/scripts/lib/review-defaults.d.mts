// **Declarations for the one reader of the shipped reviewer configuration**, because the type-check gate refuses an
// implicit any and both the test suite and the promoter import this module directly.

/** The range and type a knob's value has to be inside. */
export interface KnobSpec {
  readonly kind: 'integer' | 'boolean';
  readonly min?: number;
  readonly max?: number;
}

/** Where a knob's value is written in an artifact, and what proves the run read it. */
export interface KnobEvidence {
  readonly read: (artifact: unknown) => unknown;
  readonly applied: (artifact: unknown, value: unknown) => boolean;
  readonly where: string;
}

/** One arm artifact as the promoter sees it: a configuration, a score and a record of who produced it. */
export interface PromotionArm {
  readonly label: string;
  readonly artifact: Record<string, unknown> | null;
}

/** The configuration file, as read from disk. */
export interface ReviewDefaultsFile {
  readonly schema: number;
  readonly about?: readonly string[];
  readonly knobs: Record<string, unknown>;
  readonly provenance: Record<string, unknown>;
}

/** The pre-registered acceptance rule. */
export interface PromotionRuleFile {
  readonly version: number;
  readonly metric: string;
  readonly primary: string;
  readonly minimumDelta: number;
  readonly guards: { readonly precision: number; readonly recall: number };
  readonly minimumSample: { readonly pullRequests: number; readonly goldens: number };
  readonly requirePaired: boolean;
  readonly requireApplied: boolean;
  readonly tieBreak: readonly string[];
}

/** One named refusal: which arm, which condition, and the sentence a reader needs to fix it. */
export interface PromotionRejection {
  readonly arm: string;
  readonly reason: string;
  readonly detail: string;
}

/** The paired comparison between the candidate and the baseline, over goldens rather than counts. */
export interface PairedResult {
  readonly both: number;
  readonly oursOnly: number;
  readonly theirsOnly: number;
  readonly pValue: number;
  readonly verdict: string;
}

/** The promoter's answer. `outcome` is `promote` only when every condition in the rule held. */
export interface PromotionDecision {
  readonly outcome: 'promote' | 'hold';
  readonly reason: string;
  readonly metricPath: string;
  readonly detail?: string;
  readonly delta?: number;
  readonly paired?: PairedResult;
  readonly rejections: PromotionRejection[];
  readonly baseline?: {
    readonly label: string;
    readonly knobs: Record<string, unknown>;
    readonly score: number;
  };
  readonly candidate?: {
    readonly label: string;
    readonly knobs: Record<string, unknown>;
    readonly score: number;
  };
  readonly champion: {
    readonly label: string;
    readonly knobs: Record<string, unknown>;
    readonly score: number;
    readonly precision: number | null;
    readonly recall: number | null;
    readonly pullRequests: number | null;
    readonly goldens: number;
    readonly runId: string | null;
    readonly commit: string | null;
  } | null;
}

export const REPO_ROOT: string;
export const DEFAULTS_PATH: string;
export const RULE_PATH: string;
export const GENERATED_PATH: string;
export const KNOB_SPEC: Readonly<Record<string, KnobSpec>>;
export const KNOB_NAMES: readonly string[];

/** The JSON, parsed and shape-checked. Throws a message naming every error rather than the first. */
export function readReviewDefaults(path?: string): ReviewDefaultsFile;

/** The rule, shape-checked. */
export function readPromotionRule(path?: string): PromotionRuleFile;

/** Every way a configuration object can be wrong, listed rather than thrown one at a time. */
export function validateDefaults(defaults: unknown): string[];

/** The TypeScript module the engine compiles, rendered from the JSON. */
export function renderDefaultsModule(defaults: ReviewDefaultsFile): string;
