// **The page draws the record, and refuses a record that disagrees with itself.**
//
// A chart is read faster than a table and checked less: a bar longer than the number printed under it, or a figure quoted
// without the guard that makes it about this arm, is the failure mode of every second page. So the refusals here are the
// page's whole behaviour worth testing - a version it does not know, a guard that does not rebuild the arm's own point, a
// lane whose uniques exceed the credits they are drawn from, and a counterfactual whose two sides are not the same cut or
// the same corpus - and the renderings asserted are the ones a reader would quote: the ceiling, the two-bar rows, the
// swap inside one run, and the difference between two arms.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/lane-discovery-page.mjs';

/** A record in the shape `scripts/lane-discovery.mjs` writes, small enough to check by eye. */
function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'lane-discovery-v1',
    arm: 'benchmarks/arm.json',
    laneSet: 'reviewer',
    profile: 'core',
    corpus: 'benchmarks/martian/positive_samples.json',
    cut: 'drop test, drop path test, budget 12',
    guard: [{ field: 'k', published: 402, rebuilt: 402 }],
    goldens: 158,
    emitted: 711,
    ceiling: { credited: 88, f1IfEverythingPosted: 0.2174, comments: 711 },
    atBudget: {
      budget: 5,
      emitted: 227,
      truePositives: 62,
      falsePositives: 165,
      falseNegatives: 96,
      precision: 0.2731,
      recall: 0.3924,
      f1: 0.3221,
    },
    lanes: [
      { lane: 'security', findings: 129, credited: 38, unique: 21, density: 0.2946 },
      { lane: 'maintainability', findings: 157, credited: 14, unique: 5, density: 0.0892 },
    ],
    difference: {
      reference: 'benchmarks/wide.json',
      referenceLaneSet: 'wide',
      referenceCeiling: 86,
      shared: 68,
      onlyArm: 20,
      onlyReference: 18,
    },
    counterfactual: null,
    ...over,
  };
}

/** **The record `benchmarks/lane-discovery.json` actually is**, with a lane dropped out of the same run beside it. */
function swapped(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base = record({
    atBudget: { ...(record()['atBudget'] as object), f1: 0.2879 } as unknown,
  });
  return {
    ...base,
    counterfactual: {
      without: ['crosscheck'],
      droppedFindings: 49,
      denominatorHeld: true,
      ceiling: { from: 86, to: 83 },
      atBudget: {
        k: 5,
        f1: { from: 0.2879, to: 0.2894 },
        truePositives: { from: 56, to: 56 },
        comments: { from: 231, to: 229 },
      },
      ...over,
    },
  };
}

function render(payload: Record<string, unknown>, extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-page-'));
  const at = join(dir, 'record.json');
  const out = join(dir, 'page.html');
  writeFileSync(at, `${JSON.stringify(payload)}\n`, 'utf8');
  execFileSync('node', [SCRIPT, '--record', at, '--out', out, ...extra], { encoding: 'utf8' });
  return readFileSync(out, 'utf8');
}

function failure(payload: Record<string, unknown>): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lane-page-'));
  const at = join(dir, 'record.json');
  writeFileSync(at, `${JSON.stringify(payload)}\n`, 'utf8');
  try {
    execFileSync('node', [SCRIPT, '--record', at, '--out', join(dir, 'page.html')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stderr?: Buffer | string };
    return { status: Number(failed.status ?? 1), stderr: String(failed.stderr ?? '') };
  }
}

describe('the lane page', () => {
  it('draws one row of two bars per lane, longest credit first', () => {
    const html = render(record());
    expect(html.match(/bar uniq/gu) ?? []).toHaveLength(2);
    // **`security` is 38 credited and `maintainability` 14**, so it sorts first and its bar is the full width the scale
    // is drawn against; the unique bar inside it is the 21 that no other lane named.
    expect(html.indexOf('<code>security</code>')).toBeLessThan(
      html.indexOf('<code>maintainability</code>'),
    );
    expect(html).toContain('width:100.0%');
  });

  it('prints the bar it was given rather than one of its own', () => {
    // **`--bar` is passed at the call site on purpose**: a target written into a renderer moves the next time a section
    // registers a different one, and the page would keep drawing the old number at the new position.
    const withBar = render(record(), ['--bar', '0.3735']);
    expect(withBar).toContain('the bar');
    expect(withBar).toContain('0.3735');
    expect(render(record())).not.toContain('the bar');
  });

  it('marks the point as met only when it reaches the bar', () => {
    const missing = render(record(), ['--bar', '0.3735']);
    expect(missing).not.toContain('class="pass"');
    const met = render(
      record({
        atBudget: { ...(record()['atBudget'] as object), f1: 0.38 } as unknown,
      }),
      ['--bar', '0.3735'],
    );
    expect(met).toContain('class="pass"');
  });

  it('adds the difference up, and says so when there is no reference', () => {
    const withReference = render(record());
    expect(withReference).toContain('only this arm');
    expect(withReference).toContain('20');
    const alone = render(record({ difference: null }));
    expect(alone).toContain('No reference arm was priced beside this one');
  });

  it('refuses a version it does not know', () => {
    const refused = failure(record({ version: 'lane-discovery-v2' }));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('this page reads v1');
  });

  it("refuses a guard that does not reproduce the arm's own point", () => {
    const refused = failure(record({ guard: [{ field: 'k', published: 402, rebuilt: 398 }] }));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('does not reproduce');
  });

  it('refuses a lane whose uniques exceed the credits they are drawn from', () => {
    // **A bar longer than its own total** is the failure a chart makes silently, so it is an exit rather than a clamp.
    const refused = failure(
      record({ lanes: [{ lane: 'ghost', findings: 10, credited: 2, unique: 5, density: 0.2 }] }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('5 uniques out of 2 credits');
  });

  it('draws both sides of the swap, with the sign on every delta', () => {
    // **The three figures that decide a lane's fate**: it adds three goldens to the ceiling, converts none of them at
    // `k = 5`, and costs two comments of budget and 0.0015 F1 to do it. A page that printed only the ceiling's `+3`
    // would be recommending the lane.
    const html = render(swapped());
    expect(html).toContain('What <code>crosscheck</code> buys, inside one run');
    expect(html).toContain('ceiling (credited goldens, no budget)');
    expect(html).toContain('<td class="n cost">-3</td>');
    expect(html).toContain('<td class="n cost">-2</td>');
    expect(html).toContain('<td class="n strong">+0.0015</td>');
    expect(html).toContain('49 findings are the only thing between them');
  });

  it('refuses a counterfactual whose two sides are not the same cut', () => {
    // **`from` has to be the pool this page already drew.** A record whose swap starts from a different figure than its own
    // point is a delta between two cuts, and nothing on the page says which cut is which.
    const refused = failure(
      swapped({
        atBudget: {
          ...(swapped()['counterfactual'] as { atBudget: object }).atBudget,
          f1: { from: 0.3, to: 0.2894 },
        },
      }),
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("this record's point is 0.2879");
  });

  it('refuses a counterfactual that moved the denominator', () => {
    // **Dropping a lane can drop the last finding on a pull request**, and a denominator that shrank with it charges the
    // removal twice. The instrument holds the corpus fixed and says so; a record that says otherwise is refused here.
    const refused = failure(swapped({ denominatorHeld: false }));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('moved the denominator');
  });
});
