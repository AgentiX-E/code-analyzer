/**
 * **Price one device against one banked arm, on the rows both arms read, without pretending two days are one run.**
 *
 * R-179 prices the `state` lane (§181) against R-178's banked `reviewer` artifact. A device is a configuration switch:
 * the two artifacts must differ in exactly one configuration key (`lane_set`), and the comparison must be drawn over
 * the same covered `(pull request, golden)` rows. A pair that fails either condition is about the runs, not the device,
 * and is refused rather than reported.
 *
 * The delta is read only from fields the two artifacts declare about themselves - `byCategory` bug `truePositives`
 * (reconciled by `byCategory.totals.agrees`) and top-level `f1` - never from a figure retyped from a report. The campaign
 * has measured `0.07` F1 of day-to-day drift on an unchanged configuration, so a cross-dispatch delta is labelled
 * `cross-dispatch` and carries a caveat that forbids reading it as the within-run McNemar the paired tool computes.
 */
import { pairArms } from './arm-pair.mjs';

/** The configuration key a priced device differs in (the artifact records it as `laneSet`). */
export const DEVICE_KEY = 'laneSet';

/**
 * Fields a caller may explicitly declare as dispatch-entailed rather than device.
 *
 * `competitorMode` is chosen at dispatch time and changes only the ours-vs-competitor decomposition step; it does not
 * touch the lanes, the judge, or ours' own TP/FP/FN. A caller that bought a device arm with `competitor=off` must say
 * so here - the tool never ignores a field on its own - and the ignored keys are echoed into the verdict.
 */
export const DISPATCH_ENTAILED_KEYS = ['competitorMode'];

/** The measured same-configuration day-to-day F1 drift, quoted so a cross-dispatch delta is read against it. */
export const CROSS_DISPATCH_DRIFT = 0.07;

export class PriceDeviceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PriceDeviceError';
  }
}

/** Which configuration keys differ between two artifacts. */
export function variedKeys(base, device) {
  const left = base?.configuration ?? {};
  const right = device?.configuration ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

/**
 * **The Code Defect TP an artifact declares, from the reconciled decomposition.**
 *
 * `byCategory.rows` is a decomposition of the run's true positives (§179.2), and `totals.agrees` asserts it sums to the
 * published TP. Reading the `bug` row is a figure the artifact stands behind; re-typing a number from a report is not.
 */
export function codeDefectTruePositives(artifact) {
  const rows = artifact?.byCategory?.rows;
  if (!Array.isArray(rows) || artifact?.byCategory?.totals?.agrees !== true) {
    throw new PriceDeviceError(
      'an artifact without a reconciled byCategory decomposition cannot price a Code Defect device',
    );
  }
  const bug = rows.find((row) => row?.category === 'bug');
  if (bug === undefined || typeof bug.truePositives !== 'number') {
    throw new PriceDeviceError('the byCategory decomposition has no bug row to price');
  }
  return bug.truePositives;
}

/**
 * Price `device` against `base`.
 *
 * @param base    the banked arm (R-178's `reviewer` artifact).
 * @param device  the arm under test (R-179's `stateful` artifact).
 * @param dispatch `same` for a within-dispatch pair, `cross` for two jobs on two days.
 */
export function priceDevice({ base, device, dispatch = 'cross', ignoreKeys = [] }) {
  const varied = variedKeys(base, device);
  const unexpected = ignoreKeys.filter((key) => !DISPATCH_ENTAILED_KEYS.includes(key));
  if (unexpected.length > 0) {
    throw new PriceDeviceError(
      `only dispatch-entailed keys may be ignored (${DISPATCH_ENTAILED_KEYS.join(', ')}); received ${JSON.stringify(unexpected)}`,
    );
  }
  const effective = varied.filter((key) => !ignoreKeys.includes(key));
  if (effective.length === 0 || effective.some((key) => key !== DEVICE_KEY)) {
    throw new PriceDeviceError(
      `a priced device must differ from its banked arm only in ${DEVICE_KEY}; received ${JSON.stringify(effective)}` +
        (ignoreKeys.length > 0
          ? ` (ignored dispatch-entailed: ${JSON.stringify(ignoreKeys)})`
          : ''),
    );
  }

  const basePRs = pullRequestsOf(base);
  const devicePRs = pullRequestsOf(device);
  if (basePRs.sort().join('|') !== devicePRs.sort().join('|')) {
    throw new PriceDeviceError(
      `the two arms scored different pull requests (${basePRs.length} vs ${devicePRs.length}); ` +
        'a delta over different pull requests is a fact about the runs, not device price',
    );
  }
  // Both arms must divide by the same corpus. The covered golden *subsets* are allowed to differ - that is the device
  // changing which goldens the registered rule reaches - but the denominator it divides by must be the same 452.
  const corpusOf = (a) => {
    const published = a?.fullEmission ?? a;
    return Number(published?.truePositives ?? 0) + Number(published?.falseNegatives ?? 0);
  };
  if (corpusOf(base) !== corpusOf(device)) {
    throw new PriceDeviceError(
      `the two arms divided by different corpora (${corpusOf(base)} vs ${corpusOf(device)} goldens)`,
    );
  }

  const paired = pairArms(base, device);
  const baseDefects = codeDefectTruePositives(base);
  const deviceDefects = codeDefectTruePositives(device);
  const baseF1 = Number(base?.f1 ?? 0);
  const deviceF1 = Number(device?.f1 ?? 0);
  const within = dispatch === 'same';

  return {
    varied: effective,
    ignoredDispatchEntailed: ignoreKeys,
    pullRequests: basePRs.length,
    coverage: {
      base: paired.off.covered,
      device: paired.on.covered,
      both: paired.both,
    },
    pValue: paired.pValue,
    codeDefect: {
      base: baseDefects,
      device: deviceDefects,
      delta: deviceDefects - baseDefects,
    },
    f1: {
      base: baseF1,
      device: deviceF1,
      delta: deviceF1 - baseF1,
    },
    pairing: within ? 'within-dispatch' : 'cross-dispatch',
    driftCaveat: within
      ? null
      : `cross-dispatch delta is read against a measured ${CROSS_DISPATCH_DRIFT.toFixed(2)} F1 ` +
        'same-configuration day-to-day drift; it is not the within-run McNemar',
  };
}

/** The pull requests an artifact scored, with a clear refusal when an artifact has no coverage block. */
function pullRequestsOf(artifact) {
  const rows = artifact?.coverage?.byPullRequest;
  if (!Array.isArray(rows)) {
    throw new PriceDeviceError(
      'an artifact with no coverage.byPullRequest cannot be paired: no two row sets can be shown equal',
    );
  }
  return rows.map((pull) => String(pull?.pr));
}
