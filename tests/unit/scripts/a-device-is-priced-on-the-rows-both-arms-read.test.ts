/**
 * **A device is priced on the rows both arms read, from fields the artifacts declare about themselves.**
 *
 * R-179 prices the `state` lane (§181) against R-178's banked `reviewer` artifact. Two ways of getting that verdict
 * wrong both look like a number:
 *
 * - counting goldens over two different row sets, which reports a fact about the runs rather than the device;
 * - reading a cross-dispatch delta (two days, two jobs) as if it were a same-dispatch paired test, when the campaign's
 *   own record has measured `0.07` F1 of day-to-day drift on an unchanged configuration.
 *
 * The third discipline is provenance: the Code Defect number comes from the reconciled `byCategory` decomposition the
 * artifact publishes, not from a figure re-typed from a report (the report's "83" is not a field in the artifact; its
 * reconciled `bug` TP is 86). The tool written first here refuses all three.
 */
import { describe, expect, it } from 'vitest';

import {
  codeDefectTruePositives,
  priceDevice,
  PriceDeviceError,
} from '../../../scripts/lib/device-price.mjs';

const PRS = [
  'https://github.com/o/r/pull/1',
  'https://github.com/o/r/pull/2',
  'https://github.com/o/r/pull/3',
];

/** An artifact with a coverage block and a reconciled byCategory decomposition. */
function artifact({
  laneSet,
  covered,
  bugTP,
  f1,
}: {
  laneSet: string;
  covered: string[];
  bugTP: number;
  f1: number;
}) {
  return {
    configuration: {
      profile: 'advisory',
      laneSet: { name: laneSet, lanes: ['security', 'architecture'] },
      promptOrder: 'boilerplate-first',
      maxPullRequests: 50,
      competitorMode: 'record',
    },
    coverage: {
      byPullRequest: covered.map((pr) => ({ pr, covered: [0, 1] })),
    },
    byCategory: {
      rows: [
        { category: 'bug', emitted: 176, truePositives: bugTP },
        { category: 'architecture', emitted: 66, truePositives: 10 },
      ],
      totals: {
        attributedTruePositives: bugTP + 10,
        reportedTruePositives: bugTP + 10,
        agrees: true,
      },
    },
    truePositives: 123,
    falseNegatives: 329,
    f1,
  };
}

const base = () => artifact({ laneSet: 'reviewer', covered: PRS, bugTP: 86, f1: 0.328 });
const device = () => artifact({ laneSet: 'stateful', covered: PRS, bugTP: 91, f1: 0.328 });

describe('codeDefectTruePositives', () => {
  it('reads the reconciled bug row, not a figure re-typed from a report', () => {
    expect(codeDefectTruePositives(base())).toBe(86);
  });

  it('refuses an artifact whose decomposition is not reconciled', () => {
    const broken = base();
    broken.byCategory.totals.agrees = false;
    expect(() => codeDefectTruePositives(broken)).toThrow(PriceDeviceError);
  });
});

describe('priceDevice', () => {
  it('prices the device on the rows both arms covered and reports a cross-dispatch pairing', () => {
    const verdict = priceDevice({ base: base(), device: device(), dispatch: 'cross' });
    expect(verdict.varied).toEqual(['laneSet']);
    expect(verdict.pullRequests).toBe(3);
    expect(verdict.coverage.both).toBe(6);
    expect(verdict.codeDefect.delta).toBe(5);
    expect(verdict.f1.delta).toBeCloseTo(0, 6);
    expect(verdict.pairing).toBe('cross-dispatch');
    expect(verdict.driftCaveat).toMatch(/0\.07/);
  });

  it('refuses a pair whose configuration differs in more than the device field', () => {
    const shifted = device();
    shifted.configuration.promptOrder = 'lane-first';
    expect(() => priceDevice({ base: base(), device: shifted, dispatch: 'cross' })).toThrow(
      PriceDeviceError,
    );
  });

  it('does not silently ignore a dispatch-entailed field - the caller must declare it', () => {
    const shifted = device();
    shifted.configuration.competitorMode = 'off';
    expect(() => priceDevice({ base: base(), device: shifted, dispatch: 'cross' })).toThrow(
      /competitorMode/,
    );
    const verdict = priceDevice({
      base: base(),
      device: shifted,
      dispatch: 'cross',
      ignoreKeys: ['competitorMode'],
    });
    expect(verdict.varied).toEqual(['laneSet']);
    expect(verdict.ignoredDispatchEntailed).toEqual(['competitorMode']);
  });

  it('refuses to ignore a field that is not dispatch-entailed', () => {
    const shifted = device();
    shifted.configuration.promptOrder = 'lane-first';
    expect(() =>
      priceDevice({
        base: base(),
        device: shifted,
        dispatch: 'cross',
        ignoreKeys: ['promptOrder'],
      }),
    ).toThrow(/only dispatch-entailed keys/);
  });

  it('accepts a pair whose covered golden subsets differ - that is the device reaching different goldens', () => {
    const shifted = device();
    shifted.coverage.byPullRequest = PRS.map((pr) => ({ pr, covered: [0, 1, 2] }));
    const verdict = priceDevice({ base: base(), device: shifted, dispatch: 'cross' });
    expect(verdict.coverage.base).toBe(6);
    expect(verdict.coverage.device).toBe(9);
  });

  it('refuses a pair that scored different pull requests - the delta would be about the runs', () => {
    const shifted = device();
    shifted.coverage.byPullRequest = PRS.slice(0, 2).map((pr) => ({ pr, covered: [0, 1] }));
    expect(() => priceDevice({ base: base(), device: shifted, dispatch: 'cross' })).toThrow(
      /different pull requests/,
    );
  });

  it('refuses a pair divided by different corpora', () => {
    const shifted = device();
    shifted.falseNegatives = 250;
    expect(() => priceDevice({ base: base(), device: shifted, dispatch: 'cross' })).toThrow(
      /different corpora/,
    );
  });

  it('marks a same-dispatch pair as within-run so the McNemar is read at face value', () => {
    const verdict = priceDevice({ base: base(), device: device(), dispatch: 'same' });
    expect(verdict.pairing).toBe('within-dispatch');
    expect(verdict.driftCaveat).toBeNull();
  });

  it('reports a negative delta honestly when the device credits fewer defects', () => {
    const shifted = device();
    shifted.byCategory.rows[0]!.truePositives = 80;
    const verdict = priceDevice({ base: base(), device: shifted, dispatch: 'cross' });
    expect(verdict.codeDefect.device).toBe(80);
    expect(verdict.codeDefect.base).toBe(86);
    expect(verdict.codeDefect.delta).toBe(-6);
  });
});
