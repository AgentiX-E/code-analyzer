/**
 * **A comment about a deletion has to name something the file no longer contains, and the check convicted it for that.**
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
 * **So the check's premise was false rather than its threshold.** It asked *"does this name exist in this file"* when the
 * question the evidence supports is *"does this name exist in the code this comment is about"* - and the change is part of
 * that code. The cases below are that claim, one shape at a time, including the shapes that must still be refused: a
 * narrowed check that keeps everything is not a repair.
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
  it('keeps a comment that names the symbol the change removed', () => {
    const comment = finding('`dispatchCount` is no longer recomputed after the constructor');

    // **The two arms differ in one field**, which is what makes the repair attributable: the same finding, the same file,
    // the same rule - and the only change is whether the gate was shown the change.
    const withoutChange = judgeGrounding([comment], { contents: new Map([['src/node.ts', HEAD]]) });
    const withChange = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(withoutChange.ungrounded).toHaveLength(1);
    expect(withoutChange.ungrounded[0]?.reason).toMatch(/occurs nowhere/u);
    expect(withChange.ungrounded).toHaveLength(0);
    expect(withChange.grounded).toHaveLength(1);
  });

  it('still refuses a name that occurs in neither the file nor the change', () => {
    const comment = finding('`bogusSymbol` is not initialised here');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.ungrounded).toHaveLength(1);
    expect(report.grounded).toHaveLength(0);
  });

  it('keeps a name the file declares away from the finding, which the file-only version already did', () => {
    // **The repair widened one of three places a name may be found and must not quietly replace another.** A comment may
    // name a symbol declared elsewhere in the same file, and that was true before this change: a version that checked the
    // change first and forgot the file would be a second defect wearing the first one's fix.
    // **`helper` is declared at line 5** - outside the region and absent from the change - so it is kept only by the
    // file fallback, which is the behaviour that has to survive the widening.
    const comment = finding('`helper` is now called with a negative value');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.ungrounded).toHaveLength(0);
  });

  it('behaves exactly as before when the caller has no change to show', () => {
    // **A caller reviewing a diff alone passes no `diffs`**, and its behaviour must not move: the read of an absent diff
    // is an empty string, and an empty string occurs in nothing.
    const kept = judgeGrounding([finding('`count` is doubled')], {
      contents: new Map([['src/node.ts', HEAD]]),
    });
    const dropped = judgeGrounding([finding('`dispatchCount` is gone')], {
      contents: new Map([['src/node.ts', HEAD]]),
    });

    expect(kept.ungrounded).toHaveLength(0);
    expect(dropped.ungrounded).toHaveLength(1);
  });

  it('reads a literal in backticks the same way, because the change is where it was', () => {
    const comment = finding('The trailing `false` argument was dropped, which changes the default');
    const report = judgeGrounding([comment], {
      contents: new Map([['src/node.ts', HEAD]]),
      diffs: new Map([['src/node.ts', DIFF]]),
    });

    expect(report.ungrounded).toHaveLength(0);
  });
});
