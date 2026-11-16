import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  claimsPrompt,
  crossPairControl,
  sameLineRejects,
  summariseRejudge,
} from '../../../scripts/lib/claims-match.mjs';

/**
 * **Four hundred and thirty-four goldens were rejected in files the reviewer had already commented on**, 263 of them on
 * the exact line - and the artifact reports that as one number, though it is three different findings:
 *
 * - **the same defect said differently**, which is a matcher that was never asked to say what the two statements share;
 * - **a different defect at the same line**, which is §59's second concern;
 * - **a nit this reviewer does not write**, which should stay lost and is most of what a benchmark's human reviewers
 *   leave behind.
 *
 * The three want three devices, so the split is worth measuring - and the measurement is a re-read of pairs the run
 * already paid for. **This file pins the two properties that make a re-read evidence rather than a looser matcher**:
 * the control exists and is genuinely crossed, and a reader that agrees with everything is worth zero however many
 * pairs it "recovers".
 */
const artifact = (records) => ({ missedGoldens: { records } });

const record = (over = {}) => ({
  pr: 'https://github.com/o/r/pull/1',
  goldenIndex: 0,
  bucket: 'findingOnPathRejected',
  path: 'src/a.ts',
  note: 'the erase in the loop is quadratic',
  proximity: 0,
  matchedFindings: [],
  nearestFinding: { startLine: 10, endLine: 14, text: 'erase inside the loop shifts the tail, so this is O(n squared)' },
  ...over,
});

describe('a second reading of a rejected pair is only evidence if it is controlled', () => {
  it('takes the pairs that are on the file, on the line, and rejected', () => {
    const pairs = sameLineRejects(
      artifact([
        record(),
        record({ proximity: 4, note: 'four lines away, a different question' }),
        record({ bucket: 'hit', note: 'accepted, so there is nothing to re-read' }),
        record({ bucket: 'noFindingOnPath', proximity: null, note: 'we said nothing on this file' }),
        record({ goldenIndex: 1, note: '   ', nearestFinding: { text: 'x' } }),
        record({ goldenIndex: 2, nearestFinding: { startLine: 10, endLine: 10, text: '' } }),
      ]),
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].note).toContain('quadratic');
    expect(pairs[0].comment).toContain('O(n squared)');
    expect(pairs[0].id).toBe('https://github.com/o/r/pull/1#0');
  });

  it('survives an artifact that predates the records', () => {
    expect(sameLineRejects({})).toEqual([]);
    expect(sameLineRejects(null)).toEqual([]);
    expect(sameLineRejects({ missedGoldens: { records: 'nope' } })).toEqual([]);
  });

  it('crosses the golden onto another pull request, and never onto its own', () => {
    const pairs = Array.from({ length: 9 }, (_, i) =>
      record({ pr: `https://github.com/o/r/pull/${String(i)}`, goldenIndex: i, note: `claim ${String(i)}` }),
    );
    const controls = crossPairControl(sameLineRejects(artifact(pairs)));

    expect(controls).toHaveLength(9);
    for (const [i, control] of controls.entries()) {
      // **The pairing is broken and the question is kept**: the comment stays where it was said, the note comes from
      // somewhere else, and that is what makes an acceptance evidence of agreement rather than of adjacency.
      expect(control.comment).toBe(pairs[i].nearestFinding.text);
      expect(control.note).not.toBe(pairs[i].note);
      expect(control.donorId).not.toBe(control.id);
    }
    // **Deterministic**, so two readings of one artifact produce comparable rates.
    expect(crossPairControl(sameLineRejects(artifact(pairs)))).toEqual(controls);
  });

  it('gives a single pair no control rather than a control that is itself', () => {
    expect(crossPairControl(sameLineRejects(artifact([record()])))).toEqual([]);
    // **And a corpus where every pair is from one pull request has no crossed pair either** - the honest answer is an
    // empty control, which the summary then reports as an unmeasured lift rather than as a zero.
    const onePull = Array.from({ length: 4 }, (_, i) => record({ goldenIndex: i, note: `claim ${String(i)}` }));
    expect(crossPairControl(sameLineRejects(artifact(onePull)))).toEqual([]);
  });

  it('asks for the shared claim before the verdict, and names the ways of saying no', () => {
    const prompt = claimsPrompt({ note: 'the erase is quadratic', comment: 'erase in a loop shifts the tail' });

    expect(prompt).toContain('"shared"');
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"different"');
    expect(prompt).toContain('"wording"');
    expect(prompt).toContain('fair summary of BOTH statements');
    // **The sentence that keeps "semantic" from meaning "adjacent"**: a claim true of any two comments on one function
    // is not a shared concern, and without it the matcher has no way to reject a neighbouring remark.
    expect(prompt).toContain('equally true of any two comments');
    expect(prompt.indexOf('the erase is quadratic')).toBeLessThan(prompt.indexOf('erase in a loop shifts the tail'));
  });

  it('prices the recovery against the control, not against zero', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ real: 'same', control: 'different' })),
      ...Array.from({ length: 9 }, () => ({ real: 'different', control: 'different' })),
      // **One crossed pair the reader accepted**, which is the whole point of having a control: a reader with any
      // willingness to agree shows it here, and the recovery is what survives the subtraction.
      { real: 'different', control: 'same' },
      { real: 'wording', control: 'wording' },
      { real: null, control: null },
    ];
    const summary = summariseRejudge(rows);

    expect(summary.pairs).toBe(22);
    expect(summary.answered).toBe(21);
    expect(summary.unanswered).toBe(1);
    expect(summary.same).toBe(10);
    expect(summary.different).toBe(10);
    expect(summary.wording).toBe(1);
    expect(summary.realShare).toBeCloseTo(0.4762, 3);
    expect(summary.controlShare).toBeCloseTo(0.0476, 3);
    expect(summary.lift).toBeCloseTo(0.4286, 3);
    expect(summary.beyondControl).toBeCloseTo(9, 2);
  });

  it('is worth nothing when the reader agrees with everything', () => {
    // **The failure mode a looser matcher takes.** Every real pair accepted and every crossed pair too: 20 of 20 and
    // 20 of 20, a lift of zero and an evidence count of zero - which is what a reader with no discrimination looks like
    // once it is measured against something.
    const rows = Array.from({ length: 20 }, () => ({ real: 'same', control: 'same' }));
    const summary = summariseRejudge(rows);

    expect(summary.realShare).toBe(1);
    expect(summary.controlShare).toBe(1);
    expect(summary.lift).toBe(0);
    expect(summary.beyondControl).toBe(0);
  });

  it('does not read an unanswered call as a rejection', () => {
    const summary = summariseRejudge([
      { real: 'same', control: null },
      { real: null, control: null },
    ]);
    expect(summary.answered).toBe(1);
    expect(summary.unanswered).toBe(1);
    expect(summary.controlAnswered).toBe(0);
    // **An unmeasured control is `0` share and `1` lift, and the summary says the control answered nothing** - the
    // number a reader must not quote as if it were the measured one.
    expect(summary.controlAnswered).toBe(0);
  });

  it('refuses an artifact with nothing to re-read, before asking for a key', () => {
    // **The two failures want different repairs**, and the reader that named the key first would send somebody looking
    // for a secret when the path was wrong. Both are asserted here because the order is the whole claim.
    const directory = mkdtempSync(join(tmpdir(), 'rejudge-'));
    writeFileSync(
      join(directory, 'aacr-bench.json'),
      JSON.stringify(artifact([record({ bucket: 'hit' })])),
    );

    let message = '';
    try {
      execFileSync(process.execPath, [join('scripts', 'aacr-rejudge.mjs'), '--bench', directory], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, AACR_JUDGE_KEY: '', MARTIAN_API_KEY: '', DEEPSEEK_API_KEY: '' },
      });
    } catch (error) {
      message = String(error.stderr ?? '');
    }
    expect(message).toContain('no rejected same-line pairs');
    expect(message).not.toContain('no judge key');
  });

  it('is dispatched on demand, against an artifact another run already paid for', () => {
    // **The readback is a reader, not a check**: it needs an artifact somebody already paid for, so it is a dispatch
    // rather than a push - and the wiring gate refuses a script that is both registered as a local tool and named by a
    // workflow, which is how this file knows the two halves agree.
    const workflow = readFileSync('.github/workflows/aacr-rejudge.yml', 'utf8');
    expect(workflow).toContain('workflow_dispatch');
    // **`run-id` is the whole economy of it**: reading the artifact of a run that already happened is the difference
    // between four hundred judge calls and another 2.5-hour review pass.
    expect(workflow).toContain('run-id: ${{ inputs.run_id }}');
    expect(workflow).toContain('--self-test');
    const register = JSON.parse(readFileSync('scripts/gate-wiring-register.json', 'utf8'));
    expect(Object.keys(register)).not.toContain('scripts/aacr-rejudge.mjs');
  });
});
