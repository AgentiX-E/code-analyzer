import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  claimsPrompt,
  crossPairControl,
  sameLineRejects,
  samePullRequestControl,
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
// **The fixture is typed at its two seams**, because a record whose `note` is `any` cannot be shown to be the golden's
// sentence and a `records` list of `any` would let a string through the branch that refuses exactly that.
const artifact = (records: unknown) => ({ missedGoldens: { records } });

interface RecordFixture extends Record<string, unknown> {
  pr: string;
  goldenIndex: number;
  bucket: string;
  path: string;
  note: string;
  proximity: number | null;
  matchedFindings: unknown[];
  nearestFinding: { startLine?: number; endLine?: number; text: string };
}

const record = (over: Partial<RecordFixture> = {}): RecordFixture => ({
  pr: 'https://github.com/o/r/pull/1',
  goldenIndex: 0,
  bucket: 'findingOnPathRejected',
  path: 'src/a.ts',
  note: 'the erase in the loop is quadratic',
  proximity: 0,
  matchedFindings: [],
  nearestFinding: {
    startLine: 10,
    endLine: 14,
    text: 'erase inside the loop shifts the tail, so this is O(n squared)',
  },
  ...over,
});

describe('a second reading of a rejected pair is only evidence if it is controlled', () => {
  it('takes the pairs that are on the file, on the line, and rejected', () => {
    const pairs = sameLineRejects(
      artifact([
        record(),
        record({ proximity: 4, note: 'four lines away, a different question' }),
        record({ bucket: 'hit', note: 'accepted, so there is nothing to re-read' }),
        record({
          bucket: 'noFindingOnPath',
          proximity: null,
          note: 'we said nothing on this file',
        }),
        record({ goldenIndex: 1, note: '   ', nearestFinding: { text: 'x' } }),
        record({ goldenIndex: 2, nearestFinding: { startLine: 10, endLine: 10, text: '' } }),
      ]),
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.note).toContain('quadratic');
    expect(pairs[0]?.comment).toContain('O(n squared)');
    expect(pairs[0]?.id).toBe('https://github.com/o/r/pull/1#0');
  });

  it('survives an artifact that predates the records', () => {
    expect(sameLineRejects({})).toEqual([]);
    expect(sameLineRejects(null)).toEqual([]);
    expect(sameLineRejects({ missedGoldens: { records: 'nope' } })).toEqual([]);
  });

  it('crosses the golden onto another pull request, and never onto its own', () => {
    const pairs = Array.from({ length: 9 }, (_, i) =>
      record({
        pr: `https://github.com/o/r/pull/${String(i)}`,
        goldenIndex: i,
        note: `claim ${String(i)}`,
      }),
    );
    const controls = crossPairControl(sameLineRejects(artifact(pairs)));

    expect(controls).toHaveLength(9);
    for (const [i, control] of controls.entries()) {
      // **The pairing is broken and the question is kept**: the comment stays where it was said, the note comes from
      // somewhere else, and that is what makes an acceptance evidence of agreement rather than of adjacency.
      expect(control.comment).toBe(pairs[i]?.nearestFinding.text);
      expect(control.note).not.toBe(pairs[i]?.note);
      expect(control.donorId).not.toBe(control.id);
    }
    // **Deterministic**, so two readings of one artifact produce comparable rates.
    expect(crossPairControl(sameLineRejects(artifact(pairs)))).toEqual(controls);
  });

  it('gives a single pair no control rather than a control that is itself', () => {
    expect(crossPairControl(sameLineRejects(artifact([record()])))).toEqual([]);
    // **And a corpus where every pair is from one pull request has no crossed pair either** - the honest answer is an
    // empty control, which the summary then reports as an unmeasured lift rather than as a zero.
    const onePull = Array.from({ length: 4 }, (_, i) =>
      record({ goldenIndex: i, note: `claim ${String(i)}` }),
    );
    expect(crossPairControl(sameLineRejects(artifact(onePull)))).toEqual([]);
  });

  it('asks for the shared claim before the verdict, and names the ways of saying no', () => {
    const prompt = claimsPrompt({
      note: 'the erase is quadratic',
      comment: 'erase in a loop shifts the tail',
    });

    expect(prompt).toContain('"shared"');
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"different"');
    expect(prompt).toContain('"wording"');
    expect(prompt).toContain('fair summary of BOTH statements');
    // **The sentence that keeps "semantic" from meaning "adjacent"**: a claim true of any two comments on one function
    // is not a shared concern, and without it the matcher has no way to reject a neighbouring remark.
    expect(prompt).toContain('equally true of any two comments');
    expect(prompt.indexOf('the erase is quadratic')).toBeLessThan(
      prompt.indexOf('erase in a loop shifts the tail'),
    );
  });

  it('prices the recovery against the hardest control, not against zero', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({
        real: 'same',
        crossed: 'different',
        sameFile: 'different',
        samePull: 'different',
      })),
      ...Array.from({ length: 9 }, () => ({
        real: 'different',
        crossed: 'different',
        sameFile: 'different',
        samePull: 'different',
      })),
      // **One crossed pair the reader accepted**, which is the whole point of having a control: a reader with any
      // willingness to agree shows it here, and the recovery is what survives the subtraction.
      { real: 'different', crossed: 'same', sameFile: 'different', samePull: 'different' },
      { real: 'wording', crossed: 'wording', sameFile: 'different', samePull: 'different' },
      { real: null, crossed: null, sameFile: null, samePull: null },
    ];
    const summary = summariseRejudge(rows);

    expect(summary.pairs).toBe(22);
    expect(summary.answered).toBe(21);
    expect(summary.unanswered).toBe(1);
    expect(summary.same).toBe(10);
    expect(summary.different).toBe(10);
    expect(summary.wording).toBe(1);
    expect(summary.realShare).toBeCloseTo(0.4762, 3);
    expect(summary.crossed.share).toBeCloseTo(0.0476, 3);
    expect(summary.lift).toBeCloseTo(0.4286, 3);
    expect(summary.beyondControl).toBeCloseTo(9, 2);
  });

  it('takes the floor from the control that accepts the most, and names it', () => {
    // **The reason there are three controls.** A crossed pair is rejected from the file extension alone, so a zero there
    // is not evidence; the same-file control shares the vocabulary, the module and the change and differs only in the
    // defect, and **it is the one that decides whether a real acceptance means anything.**
    const rows = Array.from({ length: 20 }, () => ({
      real: 'same',
      crossed: 'different',
      sameFile: 'same',
      samePull: 'different',
    }));
    const summary = summariseRejudge(rows);

    expect(summary.realShare).toBe(1);
    expect(summary.crossed.share).toBe(0);
    expect(summary.sameFile.share).toBe(1);
    expect(summary.floorFrom).toBe('sameFile');
    expect(summary.floorShare).toBe(1);
    // **A reader that says yes to any two statements about one file has recovered nothing**, and the arithmetic says so
    // instead of reporting a hundred percent.
    expect(summary.lift).toBe(0);
    expect(summary.beyondControl).toBe(0);
  });

  it('is worth nothing when the reader agrees with everything', () => {
    // **The failure mode a looser matcher takes.** Every real pair accepted and every control too, a lift of zero and an
    // evidence count of zero - which is what a reader with no discrimination looks like once it is measured.
    const rows = Array.from({ length: 20 }, () => ({
      real: 'same',
      crossed: 'same',
      sameFile: 'same',
      samePull: 'same',
    }));
    const summary = summariseRejudge(rows);

    expect(summary.realShare).toBe(1);
    expect(summary.lift).toBe(0);
    expect(summary.beyondControl).toBe(0);
  });

  it('does not read an unanswered call as a rejection, and does not read a missing control as a zero', () => {
    const summary = summariseRejudge([
      { real: 'same', crossed: 'different', sameFile: null, samePull: null },
      { real: null, crossed: null, sameFile: null, samePull: null },
    ]);
    expect(summary.answered).toBe(1);
    expect(summary.unanswered).toBe(1);
    // **An unbuilt control is reported as unanswered rather than as a rate of zero**, and the floor names the one that
    // did answer - which is the number a reader must not quote as if it were the measured one.
    expect(summary.sameFile.answered).toBe(0);
    expect(summary.floorFrom).toBe('crossed');
  });

  it('builds the hard controls inside one pull request', () => {
    const records = [
      record({ goldenIndex: 0, path: 'src/a.ts', note: 'the erase in the loop is quadratic' }),
      record({
        goldenIndex: 1,
        path: 'src/a.ts',
        note: 'the mutex is not held around the write',
        nearestFinding: { startLine: 12, endLine: 12, text: 'x' },
      }),
      record({
        goldenIndex: 2,
        path: 'src/b.ts',
        note: 'the retry has no backoff',
        nearestFinding: { startLine: 90, endLine: 90, text: 'x' },
      }),
    ];
    const pairs = sameLineRejects(artifact(records));
    const one = pairs.slice(0, 1);

    const sameFile = samePullRequestControl(artifact(records), one, { samePath: true });
    expect(sameFile).toHaveLength(1);
    expect(sameFile[0]?.path).toBe('src/a.ts');
    // **The nearest golden, because distance is the difficulty being tested.** `src/b.ts` is ninety lines away and
    // `src/a.ts` is two; a control that took whichever came first would vary with the corpus's ordering.
    expect(sameFile[0]?.note).toContain('mutex');

    const samePull = samePullRequestControl(artifact(records), one, { samePath: false });
    expect(samePull[0]?.note).toContain('retry has no backoff');
    expect(samePull[0]?.donorPath).toBe('src/b.ts');
  });

  it('contributes no hard control when a pull request carries one golden', () => {
    const alone = [record()];
    expect(
      samePullRequestControl(artifact(alone), sameLineRejects(artifact(alone)), { samePath: true }),
    ).toEqual([]);
    expect(
      samePullRequestControl(artifact(alone), sameLineRejects(artifact(alone)), {
        samePath: false,
      }),
    ).toEqual([]);
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
      // **The `stderr` of a failed spawn is the sentence this test asserts on**, and `catch` binds `unknown`: the cast
      // names why the property exists rather than asserting the whole value away.
      message = String((error as { stderr?: string }).stderr ?? '');
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
