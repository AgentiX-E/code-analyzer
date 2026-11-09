// @code-analyzer/cli — One severity scale for every review surface
//
// **Two vocabularies are in the wild and both are contracts.** The CLI's options speak
// `info | warning | error | critical`: that is what `review --severity` documents, and it is what
// `.github/actions/code-analyzer-action/action.yml` passes as `severity` and `fail-on`. The analysis engines speak
// `critical | high | medium | low | info`: that is `Severity` in `@code-analyzer/shared`, and it is what every
// finding carries.
//
// A command that compared one against the other by string equality would answer "no findings" for every
// `--severity warning`, because `'medium' !== 'warning'` filters out everything and reports a clean pull request.
// **That failure is silent, which is why the bridge is a table with a test rather than a conditional at each call.**
//
// The mapping is monotone — it never turns a worse finding into a better one:
//
//   | option label | engine severity |
//   |--------------|-----------------|
//   | `info`       | `info`          |
//   | `warning`    | `low`           |
//   | `error`      | `high`          |
//   | `critical`   | `critical`      |
//
// `warning → low` is deliberate: a `low` finding *is* a warning — a nit that a reviewer mentions and a build does not
// fail on — while `medium` is a should-fix. So `--severity warning` hides only `info`, and `--fail-on error` fails on
// `high` and `critical`, which is what the workflow that passes it means.

import type { Severity } from '@code-analyzer/shared';

/** The five labels the engines use, worst first. The order is the rank. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Every label this CLI accepts, and the engine severity it means.
 *
 * The engine's own labels are present so a caller who writes `--severity high` — the word the report will print back
 * at them — is understood rather than rejected.
 */
export const SEVERITY_ALIASES: Readonly<Record<string, Severity>> = {
  critical: 'critical',
  error: 'high',
  high: 'high',
  medium: 'medium',
  warning: 'low',
  low: 'low',
  info: 'info',
};

/** Labels accepted where a run is asked never to fail: `--fail-on off`. */
export const FAIL_ON_OFF = 'off';

/**
 * The engine severity `label` means, or `undefined` when it is not a severity at all.
 *
 * **`undefined` rather than a default**, because a typo silently defaulting to `warning` would make `--fail-on
 * critcal` a run that never fails, and the reader would have no way to tell.
 */
export function normalizeSeverity(label: string): Severity | undefined {
  return SEVERITY_ALIASES[label.trim().toLowerCase()];
}

/** The labels to print in a usage error, so the reader can see what would have worked. */
export function describeSeverityLabels(): string {
  return Object.keys(SEVERITY_ALIASES).join(', ');
}

/** How bad a severity is: `critical` is 4, `info` is 0. Used for every threshold comparison. */
export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(severity);
}

/** The worst severity in a list, or `undefined` for an empty list — a clean run, not a zero. */
export function worstSeverity(severities: readonly Severity[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const severity of severities) {
    if (worst === undefined || severityRank(severity) > severityRank(worst)) worst = severity;
  }
  return worst;
}

/**
 * Whether a run whose findings are `severities` should exit non-zero, given a `--fail-on` value.
 *
 * **`off` is a label, not an absent option**, because "this command is advisory" and "somebody forgot the flag" have
 * to be distinguishable in a workflow file.
 */
export function failsOn(severities: readonly Severity[], failOn: string): boolean {
  const normalized = failOn.trim().toLowerCase();
  if (normalized === FAIL_ON_OFF) return false;
  const threshold = normalizeSeverity(normalized);
  // An unparsed `--fail-on` still fails nothing here — the caller rejects it before a review runs, and a second
  // error path would only make the message ambiguous.
  if (threshold === undefined) return false;
  const worst = worstSeverity(severities);
  if (worst === undefined) return false;
  return severityRank(worst) >= severityRank(threshold);
}
