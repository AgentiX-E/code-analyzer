// **Declarations for the promoter**, because the test suite imports it directly and the type-check gate refuses an
// implicit any rather than recording one.

export {
  type PromotionArm,
  type PromotionDecision,
  type PromotionRejection,
  type ReviewDefaultsFile,
  type PromotionRuleFile,
} from './lib/review-defaults.d.mts';

import type {
  PromotionArm,
  PromotionDecision,
  ReviewDefaultsFile,
} from './lib/review-defaults.d.mts';

/** The knobs an artifact describes, with the evidence that the run read them. */
export function knobsOf(artifact: unknown): {
  knobs: Record<string, unknown>;
  missing: string[];
  unproven: string[];
};

/** Where each knob's value lives in an artifact, and what proves the run read it. */
export const KNOB_EVIDENCE: Readonly<
  Record<
    string,
    {
      read: (artifact: unknown) => unknown;
      applied: (artifact: unknown, value: unknown) => boolean;
      where: string;
    }
  >
>;

/** The coverage set a paired test needs, or `null` when the artifact predates the per-golden field. */
export function coverageOf(artifact: unknown): Set<string> | null;

/** A metric by dotted path, or `null` when the artifact does not carry it. */
export function metricAt(artifact: unknown, path: string): number | null;

/** Apply the rule to a set of arms. Never writes; the CLI is what writes. */
export function promote(input: {
  arms: readonly PromotionArm[];
  defaults: { knobs: Record<string, unknown> };
  rule: Record<string, unknown>;
}): PromotionDecision;

/** The configuration file a promotion produces, with its provenance. */
export function defaultsWith(
  decision: PromotionDecision,
  defaults: ReviewDefaultsFile,
  extra: { resolvedAt: string; runUrl?: string | null; ruleVersion: number },
): ReviewDefaultsFile & Record<string, unknown>;

/** The rule against a fixture whose answer was written before the arithmetic was. Returns a line or throws. */
export function selfTest(): string;
