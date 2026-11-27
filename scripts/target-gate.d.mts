/**
 * The declaration for `scripts/target-gate.mjs`.
 *
 * Two things are asserted directly rather than by reading the CLI's stdout: `resolveRef`, because a target is only as
 * truthful as the path it reads and an unmatched selector must refuse rather than read as zero; and `analyse`, because
 * the two rules - target never below its competitor, baseline equal to its source - are the whole content of the gate.
 */

/** The numeric value and file behind `file#path`, or the reason it could not be read. */
export function resolveRef(
  ref: string | null | undefined,
  repo: string,
): { ok: true; value: number; file: string } | { ok: false; reason: string };

/** The result of checking every target in the registry. */
export function analyse(
  repo: string,
  registryPath: string,
): {
  ok: boolean;
  failures: string[];
  checks: Array<{ id: string; field: string; value: number; from: string }>;
  targets: unknown[];
};
