/**
 * **A comment about a deletion has to name something the file no longer contains, and the check counted it as a hallucination.**
 *
 * §149 priced `judgeGrounding` on the published AACR artifact - 591 findings, 452 goldens, the shipped cut applied before
 * and after - and the gate came back a loss: **21 of the posted comments removed, 6 of them true (28.6 % of the pool,
 * against §75.3's 4 % bar), five goldens spent**. Every removal that cost a golden named an identifier the head file
 * legitimately cannot contain:
 *
 * - `dispatchCount`, in a comment whose whole subject is that the change *removed* it;
 * - `lv_event_free_user_data_cb`, a helper declared in another file and imported;
 * - `NeedSubElement`, a name the comment proposes;
 * - `false` and `null`, literals written in backticks.
 *
 * **§149.3 made the change a place a name can be found and re-priced the device at 5 goldens spent instead of 6.** That
 * left the question §150 answers: with the change read whole, literals excluded and proposals excluded, **what is left?**
 * Six findings, two of them carrying a golden - **one in three, against a base rate of one in three among the comments that
 * were posted.** So the check is kept as **a count**, and these cases hold the widening that makes the count mean
 * something: a name in the change, a name in a sibling file of the same change, a name the file declares elsewhere, and a
 * literal, which is syntax rather than a name.
 */
import { describe, expect, it } from 'vitest';

import { judgeGrounding } from '../review/grounding-judge.js';

/** The head revision: the symbol the change deleted is gone, and nothing else moved. */
const HEAD = [
  'export function update(count: number) {',
  '  return count * 2;',
  '}',
  '',
  'export function helper(value: number) {',
  '  return value;',
  '}',
  '',
].join('\n');

/** The change, as the gate is given it: the line that used to compute the deleted symbol. */
const DIFF = [
  '@@ -1,4 +1,4 @@',
  '-  this.dispatchCount = updateDispatchCount(count, false);',
  '+  return count;',
].join('\n');

const finding = (text: string, over: Record<string, unknown> = {}) => ({
  path: 'src/node.ts',
  startLine: 1,
  endLine: 2,
  content: text,
  ...over,
});

describe('the name check reads the change as well as the file', () => {
  it('counts a comment that names the symbol the change removed unless it is shown the change', () => {
    const comment = finding('`dispatchCount` is no longer recomputed after the constructor');

    // **The two arms differ in one field**, which is what makes the widening attributable: the same finding, the same file,
    // the same rule - and the only change is whether the gate was shown the change.
    const withoutChange = judgeGrounding([comment], { contents: new Map([['src/node.ts', HEAD]]) });
    const withChange = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(withoutChange.namesNowhere).toBe(1);
    expect(withChange.namesNowhere).toBe(0);
    // **And neither arm drops it**, which is the difference between a check and a filter.
    expect(withoutChange.grounded).toHaveLength(1);
    expect(withChange.grounded).toHaveLength(1);
  });

  it('counts a name that occurs in neither the file nor the change, and still keeps the finding', () => {
    const comment = finding('`bogusSymbol` is not initialised here');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.namesNowhere).toBe(1);
    expect(report.grounded).toHaveLength(1);
    expect(report.ungrounded).toHaveLength(0);
  });

  it('finds a name a sibling file of the same change declares', () => {
    // **`tucker_weight_from_conv` was the fourth shape §149 published**: declared in a module the finding is not on. The
    // per-path diff cannot see it and **the change as a whole can**, which is why the caller may pass the whole patch.
    const comment = finding('`tucker_weight_from_conv` is now called without the rank argument');
    const sources = {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    };

    expect(judgeGrounding([comment], sources).namesNowhere).toBe(1);
    expect(
      judgeGrounding([comment], {
        ...sources,
        change: `${DIFF}\n+def tucker_weight_from_conv(weight, rank): ...`,
      }).namesNowhere,
    ).toBe(0);
  });

  it('keeps a name the file declares away from the finding, which the file-only version already did', () => {
    // **The widening must not quietly replace a place a name may be found**, only add one. `helper` is declared at line 5
    // - outside the region and absent from the change - so it is found only by the file fallback.
    const comment = finding('`helper` is now called with a negative value');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.namesNowhere).toBe(0);
  });

  it('behaves exactly as before when the caller has no change to show', () => {
    // **A caller reviewing a diff alone passes no `diffs`**, and its behaviour must not move: the read of an absent diff
    // is an empty string, and an empty string contains nothing.
    const kept = judgeGrounding([finding('`count` is doubled')], {
      contents: new Map([['src/node.ts', HEAD]]),
    });
    const counted = judgeGrounding([finding('`dispatchCount` is gone')], {
      contents: new Map([['src/node.ts', HEAD]]),
    });

    expect(kept.namesNowhere).toBe(0);
    expect(counted.namesNowhere).toBe(1);
    expect(counted.grounded).toHaveLength(1);
  });

  it('does not count a literal in backticks, whichever text it appears in', () => {
    // **The fifth shape, and the one the change cannot repair**: `false` is not a name at all. Before §150 it was counted
    // as a vanished identifier unless the change happened to contain it, which made the verdict depend on a hunk boundary.
    const comment = finding('The trailing `false` argument was dropped, which changes the default');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.namesNowhere).toBe(0);
  });
});
