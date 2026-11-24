/**
 * **A check that could only read half the list may not delete from it.**
 *
 * `judgeGrounding` answers four decidable questions about a finding, and **every one of them needs the file**. So the
 * interesting states are not "correct" and "incorrect" but "the caller had the files" and "the caller had some of the
 * files", and the second is the one that produces a published number by accident:
 *
 * - **wire it blind** and every finding on a file the run did not fetch is dropped for the reason *"the review never
 *   read it"* - the §23.7 shape, where a device calibrated on one arm took the other arm from F1 0.2092 to 0.0523;
 * - **drop only what is decidable** and the surviving precision is a mixture of a checked list and an unchecked one,
 *   which is a figure about the fetcher rather than about the findings;
 * - **skip the work when the files are missing** and the run cannot even say what it would have done, so the device is
 *   unfalsifiable in exactly the way §130 was written about.
 *
 * **The last case is why the report travels with the refusal.** A withheld gate still reports `keptRatio` and every
 * verdict, so a run without file contents produces a measurement of the gate rather than a silence about it.
 *
 * **And the last test is the one that keeps two reviewers on one rule**: the same call classifies a `PrReviewFinding`
 * - the shape `code-analyzer review pr` emits - and a `ReviewComment`, because the rule is stated over a structural type
 * rather than over either.
 */
import { describe, expect, it } from 'vitest';

import { decideGrounding, describeGrounding } from '../review/grounding-gate.js';

const FILE = ['export function add(a: number, b: number) {', '  return a + b;', '}'].join('\n');
const CONTENTS = new Map([['src/math.ts', FILE]]);

/** One finding, with everything a check needs, spelled the way the product spells it. */
function finding(over: Record<string, unknown> = {}) {
  return {
    path: 'src/math.ts',
    startLine: 2,
    endLine: 2,
    existingCode: 'return a + b;',
    content: '`add` is unused',
    filtered: false,
    ...over,
  };
}

describe('the grounding gate', () => {
  it('drops what it can prove is about nothing when it read every file the list names', () => {
    const decision = decideGrounding(
      [
        finding(),
        // The quotation is not in the file, so the finding is about code that is not there.
        finding({ existingCode: 'return a * b;' }),
        // A range the file does not have.
        finding({ startLine: 900, endLine: 900, existingCode: '' }),
      ],
      CONTENTS,
    );
    expect(decision.applied).toBe(true);
    expect(decision.withheld).toBeNull();
    expect(decision.kept).toHaveLength(1);
    expect(decision.kept[0]).toMatchObject({ existingCode: 'return a + b;', filtered: false });
    expect(decision.coverage).toEqual({ findings: 3, readable: 3, unpostable: 0 });
  });

  it('drops nothing at all when one finding is on a file the caller could not read', () => {
    const findings = [finding(), finding({ path: 'src/never-fetched.ts' })];
    const decision = decideGrounding(findings, CONTENTS);
    expect(decision.applied).toBe(false);
    expect(decision.withheld).toBe('no-readable-arm');
    // **Identity, not equality**: a withheld gate returns the caller's own list, so a wiring bug that mutated the array
    // would be visible here rather than in a figure three steps later.
    expect(decision.kept).toBe(findings);
    expect(decision.coverage).toEqual({ findings: 2, readable: 1, unpostable: 0 });
  });

  it('drops nothing when the run had no file contents at all, which is the default arm', () => {
    const findings = [finding()];
    for (const contents of [undefined, new Map<string, string>()]) {
      const decision = decideGrounding(findings, contents);
      expect(decision.applied).toBe(false);
      expect(decision.kept).toBe(findings);
      expect(decision.coverage.readable).toBe(0);
    }
  });

  it('reports what it would have dropped even when it withheld the drop', () => {
    const decision = decideGrounding(
      [finding({ existingCode: 'return a * b;' }), finding({ path: 'src/unread.ts' })],
      CONTENTS,
    );
    expect(decision.applied).toBe(false);
    // Zero kept, because both are ungrounded - and **the report says so while the caller still emits both.** That is the
    // whole point of recording before applying.
    expect(decision.report.keptRatio).toBe(0);
    expect(decision.report.ungrounded.map((verdict) => verdict.grounded)).toEqual([false, false]);
    expect(decision.report.ungrounded[1]!.reason).toContain('never read');
  });

  it('treats an empty list as full coverage, because there is no unread path to keep', () => {
    const decision = decideGrounding([], undefined);
    expect(decision.applied).toBe(true);
    expect(decision.kept).toEqual([]);
    expect(decision.report.keptRatio).toBe(1);
  });

  it('holds a finding of the shape the command emits to the same rule as a review comment', () => {
    // The command's own type: `file`/`line`/`snippet` rather than `path`/`startLine`/`existingCode`.
    const asCommandSees = {
      file: 'src/math.ts',
      line: 2,
      endLine: 2,
      snippet: 'return a * b;',
      title: '`add` is unused',
    };
    const remapped = {
      path: asCommandSees.file,
      startLine: asCommandSees.line,
      endLine: asCommandSees.endLine,
      existingCode: asCommandSees.snippet,
      content: asCommandSees.title,
    };
    const decision = decideGrounding([remapped], CONTENTS);
    expect(decision.applied).toBe(true);
    expect(decision.kept).toHaveLength(0);
    expect(decision.report.ungrounded[0]!.reason).toContain('quoted code does not appear');
  });
});

describe('the findings the checks leave alone', () => {
  it('keeps a finding that offers no evidence, because absence is not evidence of absence', () => {
    // **Three kinds of silence**: no quotation, no backticked name, and a range that is a pair of integers. Each is a
    // finding this repository accepts, and a check that turned silence into a drop would delete the findings a
    // deterministic lane writes, which never quotes and never names.
    const decision = decideGrounding(
      [
        finding({ existingCode: '' }),
        finding({ content: 'this function is too long', suggestionCode: undefined }),
        finding({ startLine: 1, endLine: 3, existingCode: '' }),
        // **And the fields genuinely absent** rather than empty, which is how a deterministic rule reports a shape:
        // `existingCode` and `content` are optional on `GroundableFinding` and a finding that omits them is not a
        // finding with empty evidence, it is one that offers none.
        { path: 'src/math.ts', startLine: 2, endLine: 2 },
      ],
      CONTENTS,
    );
    expect(decision.applied).toBe(true);
    expect(decision.kept).toHaveLength(4);
    expect(decision.report.unverifiableQuotes).toBe(0);
  });

  it('drops a range whose end is not a line number, and one that begins before the file does', () => {
    const decision = decideGrounding(
      [
        finding({ startLine: 2, endLine: 2.5 }),
        finding({ startLine: 0, endLine: 1, existingCode: '' }),
      ],
      CONTENTS,
    );
    expect(decision.kept).toHaveLength(0);
    expect(decision.report.ungrounded.map((verdict) => verdict.reason)).toEqual([
      'lines 2-2.5 are not a range in a file of 3 lines',
      'lines 0-1 are not a range in a file of 3 lines',
    ]);
  });
});

describe('what the quotation check may not delete', () => {
  it('keeps a paraphrased quotation and counts it, because an ellipsis is an omission rather than a false claim', () => {
    // **The exact snippet this repository's own lens writes** for a missing docstring: true of the file, present in
    // none of it. A literal search for it fails everywhere, and dropping on that basis deleted a true positive in the
    // end-to-end fixture - the *Sifting the Noise* failure, where a filter suppressed 22% of real findings.
    const decision = decideGrounding(
      [finding({ existingCode: 'export function add(...)' })],
      CONTENTS,
    );
    expect(decision.applied).toBe(true);
    expect(decision.kept).toHaveLength(1);
    expect(decision.report.unverifiableQuotes).toBe(1);
  });

  it('keeps a finding whose quotation is a line the change removed, because that code exists there', () => {
    // A deletion is in the change and nowhere in the file: a check against the file alone asks *"did you quote the new
    // revision"* rather than *"does this code exist"*, which is a question about the quoter.
    const diff = ['@@ -1,1 +1,1 @@', '-  return a - b;'].join('\n');
    const findings = [finding({ existingCode: 'return a - b;', startLine: 1, endLine: 1 })];
    expect(decideGrounding(findings, CONTENTS).kept).toHaveLength(0);
    const withDiff = decideGrounding(findings, CONTENTS, new Map([['src/math.ts', diff]]));
    expect(withDiff.applied).toBe(true);
    expect(withDiff.kept).toHaveLength(1);
    expect(withDiff.report.unverifiableQuotes).toBe(0);
  });
});

describe('how the decision reads', () => {
  it('says what it dropped and why, in the same sentence a reader can check', () => {
    const decision = decideGrounding(
      [
        finding(),
        finding({ existingCode: 'return a * b;' }),
        finding({ startLine: 90, endLine: 90 }),
      ],
      CONTENTS,
    );
    const text = describeGrounding(decision);
    expect(text).toContain('grounding applied: 2 of 3 dropped');
    expect(text).toContain('kept 0.3333');
    expect(text).toContain('the quoted code does not appear');
    expect(text).toContain('lines 90-90 are not a range');
  });

  it('names the refusal and the two counts, so a withheld run is not a silent one', () => {
    const decision = decideGrounding([finding(), finding({ path: 'src/unread.ts' })], CONTENTS);
    const text = describeGrounding(decision);
    expect(text).toContain('grounding withheld (no-readable-arm)');
    expect(text).toContain('1 of 2 findings were on a file this run read');
    expect(text).toContain('nothing was dropped');
  });

  it('says how much of the evidence it could not read, and names a verdict that has no rule', () => {
    // A paraphrased quotation counted, so the drop rate is reported as a rate over the quotations it could read.
    const decision = decideGrounding(
      [finding(), finding({ existingCode: 'return a + b; // ...' })],
      CONTENTS,
    );
    expect(describeGrounding(decision)).toContain('1 paraphrased quotation(s) kept unchecked');
    // **And a decision assembled by hand**, which `decideGrounding` never produces and a caller reading a stored
    // artifact can: a verdict without a rule is counted rather than dropped from the breakdown, because a total that does
    // not add up is the one thing a breakdown may not do. The refusal with no reason recorded reads as a refusal rather
    // than as a gate that ran.
    expect(
      describeGrounding({
        applied: true,
        withheld: null,
        coverage: { findings: 2, readable: 2 },
        report: {
          keptRatio: 0.5,
          ungrounded: [{ reason: null }, { reason: null }],
          unverifiableQuotes: 0,
        },
      }),
    ).toContain('2 unnamed');
    expect(
      describeGrounding({
        applied: false,
        withheld: null,
        coverage: { findings: 1, readable: 0 },
        report: { keptRatio: 1, ungrounded: [] },
      }),
    ).toContain('grounding withheld (unknown)');
  });
});
