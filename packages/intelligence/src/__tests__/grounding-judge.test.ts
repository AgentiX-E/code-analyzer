// What gets dropped, and the ratio that says so.
//
// **The number this file is written against**: the review protocol scores precision 0.00 - one comment emitted and it
// was wrong. **Precision is the trust metric**, and the field's leader holds it by running a judge that drops what it
// cannot ground. **This is the first version of that judge here, and its checks are the ones decidable without a
// model.**
//
// **Every case asserts both directions.** `expect(kept).toContain(x)` alone is satisfied by a judge that keeps
// everything, and `expect(dropped).toContain(x)` alone is satisfied by one that drops everything. **A filter is
// defined by what it removes and what it leaves**, so each case states both.

import { describe, expect, it } from 'vitest';

import { judgeGrounding } from '../review/grounding-judge.js';

import type { ReviewComment } from '@code-analyzer/shared';

const FILE = ['export function add(a: number, b: number) {', '  return a + b;', '}', ''].join('\n');
const CONTENTS = new Map([['src/math.ts', FILE]]);

/** A comment about something that is in the file, with only the fields the judge reads varying. */
function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    path: 'src/math.ts',
    content: 'the addition overflows for large inputs',
    existingCode: 'return a + b;',
    startLine: 2,
    endLine: 2,
    category: 'bug',
    severity: 'minor',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...over,
  } as ReviewComment;
}

describe('a finding that cannot be grounded is dropped', () => {
  it('keeps a finding whose quoted code is where it says it is', () => {
    const report = judgeGrounding([comment()], { contents: CONTENTS });

    expect(report.grounded.map((c) => c.id)).toContain('c1');
    // **And nothing was dropped**, which is the other half of the claim.
    expect(report.ungrounded).toEqual([]);
    expect(report.keptRatio).toBe(1);
  });

  it('drops a finding on a file the review never read', () => {
    const report = judgeGrounding([comment({ path: 'src/elsewhere.ts' })], { contents: CONTENTS });

    // **Both directions on one case.**
    expect(report.grounded).toEqual([]);
    expect(report.ungrounded.map((v) => v.comment.id)).toContain('c1');
    expect(report.ungrounded[0]!.reason).toMatch(/never read/);
  });

  it('drops a finding whose line range is outside the file', () => {
    const report = judgeGrounding([comment({ startLine: 900, endLine: 901 })], {
      contents: CONTENTS,
    });

    expect(report.grounded).toEqual([]);
    expect(report.ungrounded[0]!.reason).toMatch(/not a range/);
  });

  it('drops a finding whose quoted code is not there', () => {
    // **The strongest check available without a model.** The comment quotes code; **if the text is not in the file,
    // the comment is about something that is not there.**
    const report = judgeGrounding([comment({ existingCode: 'return multiply(a, b);' })], {
      contents: CONTENTS,
    });

    expect(report.grounded).toEqual([]);
    expect(report.ungrounded[0]!.reason).toMatch(/does not appear/);
  });

  it('counts a finding that names an identifier the file does not contain, and keeps it', () => {
    // **The empirical gate, from the literature, demoted to a note.** *Refute-or-Promote* (arXiv 2604.19049) reports ten
    // reviewers unanimously endorsing a bug that did not exist, **killed only by an empirical test** - so the gate
    // requires **evidence rather than agreement**. `applyTimingPad` is named in the comment and occurs nowhere, which is
    // the shape the check was written for.
    //
    // **It is kept as of §150, and the reason is a measurement rather than a preference.** On the published artifact the
    // widened check convicted 6 findings of which 2 carried a golden - **one in three, against a base rate of one in
    // three** - so a filter built on it selects wrong comments at the rate the list already contains them. The verdict
    // survives as a number: *"one of these comments names a symbol that is nowhere in the code"*.
    const report = judgeGrounding(
      [comment({ content: 'the loop in `applyTimingPad` leaks the length' })],
      { contents: CONTENTS },
    );

    expect(report.grounded.map((c) => c.id)).toEqual(['c1']);
    expect(report.ungrounded).toEqual([]);
    expect(report.namesNowhere).toBe(1);
  });

  it('keeps a finding that names an identifier the file does contain, and counts nothing', () => {
    // **The other direction, again.** `add` is in the file, so the same rule passes it - **a gate that dropped every
    // comment naming a symbol would suppress the true findings too**, which is the failure mode *Sifting the Noise*
    // (arXiv 2601.22952) measured: aggressive filtering suppressed 22% of real vulnerabilities.
    const report = judgeGrounding([comment({ content: '`add` can overflow on large inputs' })], {
      contents: CONTENTS,
    });

    expect(report.grounded.map((c) => c.id)).toContain('c1');
    expect(report.namesNowhere).toBe(0);
  });

  it('does not count a literal in backticks, which is syntax rather than a name', () => {
    // **`?? false` was one of the six false convictions §149 published**, under the heading *"a literal in backticks"*. A
    // keyword in backticks is a mention of the language: counting it as a vanished identifier would make the note fire on
    // good comments, and a note that fires on good comments is a note nobody reads.
    const report = judgeGrounding(
      [comment({ content: 'the guard falls through to `false` when the count is negative' })],
      { contents: CONTENTS },
    );

    expect(report.grounded).toHaveLength(1);
    expect(report.namesNowhere).toBe(0);
  });

  it('does not count a name the comment itself proposes, because a proposal is absent by construction', () => {
    // **`NeedSubElement` was the third of §149's four shapes.** A finding that says *"replace this with `NeedSubElement`"*
    // names something that does not exist **because that is the whole point of the sentence** - so the suggestion is not
    // evidence of a hallucination, it is evidence of a fix.
    const report = judgeGrounding(
      [
        comment({
          content: 'this branches on the raw enum instead of the resolved element',
          suggestionCode: 'const element = NeedSubElement::from(shape);',
        }),
      ],
      { contents: CONTENTS },
    );

    expect(report.grounded).toHaveLength(1);
    expect(report.namesNowhere).toBe(0);
  });

  it('keeps a finding with no quotation, because absence is not evidence of absence', () => {
    // **A comment that quotes nothing is not checked rather than dropped.** The quotation is evidence when present;
    // treating its absence as a failure would drop every comment the heuristics write.
    const report = judgeGrounding([comment({ existingCode: '' })], { contents: CONTENTS });

    expect(report.grounded.map((c) => c.id)).toContain('c1');
  });

  it('reports the kept ratio, and calls one when there was nothing to judge', () => {
    const both = judgeGrounding([comment(), comment({ id: 'c2', path: 'src/gone.ts' })], {
      contents: CONTENTS,
    });
    expect(both.keptRatio).toBe(0.5);
    expect(both.ungrounded.map((v) => v.comment.id)).toEqual(['c2']);

    // **Nothing to judge is not a failure rate**, and `1` is the honest reading of "nothing was dropped".
    expect(judgeGrounding([], { contents: CONTENTS }).keptRatio).toBe(1);
  });

  it('gives every dropped finding a reason that names the rule', () => {
    const report = judgeGrounding(
      [comment({ id: 'a', path: 'src/none.ts' }), comment({ id: 'b', startLine: 99, endLine: 99 })],
      { contents: CONTENTS },
    );

    // **A verdict without a rule cannot be argued with**, which is the same reason the dead-code detector carries one.
    expect(report.ungrounded.length).toBe(2);
    for (const verdict of report.ungrounded) {
      expect(typeof verdict.reason).toBe('string');
      expect(verdict.reason!.length).toBeGreaterThan(10);
      expect(verdict.grounded).toBe(false);
    }
  });
});

// The three range checks the criterion performs before it reads a line.
//
// **A line number is not always a positive integer**: a producer that reports line 0, a negative offset from an
// arithmetic slip, or a range whose end precedes its start all reach this function, and each has a different reason.
// They are not defensive arms - a diff hunk that starts at 0 is a real producer bug - so each is exercised here.
describe('a range that cannot be real', () => {
  it('drops a comment whose start line is below one', () => {
    const report = judgeGrounding([comment({ startLine: 0, endLine: 2 })], { contents: CONTENTS });
    expect(report.ungrounded.map((v) => v.comment.id)).toEqual(['c1']);
  });

  it('drops a comment whose end line is below one', () => {
    const report = judgeGrounding([comment({ startLine: 1, endLine: 0 })], { contents: CONTENTS });
    expect(report.ungrounded.map((v) => v.comment.id)).toEqual(['c1']);
  });

  it('drops a comment whose range is inverted', () => {
    const report = judgeGrounding([comment({ startLine: 3, endLine: 1 })], { contents: CONTENTS });
    expect(report.ungrounded.map((v) => v.comment.id)).toEqual(['c1']);
  });

  it('keeps a comment that quotes nothing and names nothing, because both are optional evidence', () => {
    // `existingCode` absent rather than empty, and no backticked identifier: the two `?? ''` fallbacks.
    const bare = comment({ existingCode: undefined, content: 'the addition can overflow' });
    const report = judgeGrounding([bare], { contents: CONTENTS });
    expect(report.grounded.map((c) => c.id)).toEqual(['c1']);
  });
});
