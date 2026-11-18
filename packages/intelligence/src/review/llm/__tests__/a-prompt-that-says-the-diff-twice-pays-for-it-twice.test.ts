// A prompt that says the diff twice pays for it twice
//
// **The measurement, taken from the prompt builders rather than from a bill.** The file arm calls
// `engine.reviewDiff(diff, sectionDiff)` - the same text as `fileContext` and as `diffContent` - and `describeTarget`
// prints `fileContext` under the label *"File context"* while `sharedPrefix` prints the diff under *"Diff content"*.
// **The two blocks are the same characters on every call**, and the per-lane arithmetic is:
//
// | diff    | total prompt characters | of which the second copy |
// | ------- | ----------------------- | ------------------------ |
// | 40 lines | 59 218                  | **20.8 %**               |
// | 190 lines | 151 378                | **38.6 %**               |
//
// **And the share grows with the diff, which is the direction that costs money**: §82.4 measured the bill at 0.78 USD
// per run with 95 % of it in the five lanes, and a prompt that carries the change twice pays for the second copy on
// every call because `boilerplate-first` puts the variable half last, outside the cached prefix.
//
// Two things are wrong here and only one of them is the tokens. The label is a false statement: a block called "File
// context" that contains a diff is not the surrounding code, and a lane told it is looking at a file's context when it
// is looking at the change again has been told something untrue. **The repair is one condition - a block identical to
// the diff is not context - and it is written as a guard rather than as a change to the caller**, because the same
// `fileContext` is what the gate parses (`numberedAddedLines`) and what the idiom lane reads: removing it at the call
// site would break two devices to fix one prompt.

import { describe, expect, it } from 'vitest';

import { LANE_PROMPTS, type PromptContext, type ReviewLane } from '../prompts.js';

const PATCH = [
  '--- a/src/queue.ts',
  '+++ b/src/queue.ts',
  '@@ -10,3 +10,5 @@',
  ' const RETRY_LIMIT = 3;',
  '+export function claim(id: string): Entry | null {',
  '+  return open(id);',
  ' }',
].join('\n');

const SURROUNDING =
  '### src/queue.ts — lines 8-24 of 90 — changed at 12-13\nexport class Worker {\n  private name;\n}';

const base: PromptContext = {
  diffContent: PATCH,
  filePath: 'src/queue.ts',
  changeType: 'modified',
  scope: 'file',
  maxFindings: 3,
  languageChecklist: false,
  promptOrder: 'boilerplate-first',
};

/** Every lane, because the defect was in the block all six of them share. */
const LANES = Object.keys(LANE_PROMPTS) as ReviewLane[];

describe('a block identical to the diff is not context, and is not printed', () => {
  it('prints the change once when the caller passed the change as the context', () => {
    for (const lane of LANES) {
      const prompt = LANE_PROMPTS[lane]({ ...base, fileContext: PATCH });
      const occurrences = prompt.split(PATCH).length - 1;
      expect(occurrences, `${lane} carries the diff ${occurrences} times`).toBe(1);
    }
  });

  it('still prints a window that is not the diff, because that is the block the option exists for', () => {
    for (const lane of LANES) {
      const prompt = LANE_PROMPTS[lane]({ ...base, fileContext: SURROUNDING });
      expect(prompt, lane).toContain(SURROUNDING);
      expect(prompt, lane).toContain('File context');
    }
  });

  it('says nothing about file context when there is none, which is the state the pull-request arm ships in', () => {
    const prompt = LANE_PROMPTS.security(base);
    expect(prompt).not.toContain('File context');
    expect(prompt).not.toContain('Surrounding code');
  });

  it('holds in all three orders, because the guard sits inside the block they all share', () => {
    for (const lane of LANES) {
      for (const promptOrder of ['boilerplate-first', 'diff-first', 'lane-first'] as const) {
        const prompt = LANE_PROMPTS[lane]({ ...base, promptOrder, fileContext: PATCH });
        const occurrences = prompt.split(PATCH).length - 1;
        expect(occurrences, `${lane} in ${promptOrder}`).toBe(1);
      }
    }
  });

  it('charges nothing for the duplicate, which is the whole of the repair', () => {
    const withDuplicate = LANE_PROMPTS.security({ ...base, fileContext: PATCH });
    const without = LANE_PROMPTS.security(base);
    expect(withDuplicate.length).toBe(without.length);
    // **And what that is worth, measured before the guard existed**: a 40-line call carried 20.8 % of its characters
    // twice and a 190-line call 38.6 %, because the second copy is the diff and the diff is the bulk of a call.
  });
});
