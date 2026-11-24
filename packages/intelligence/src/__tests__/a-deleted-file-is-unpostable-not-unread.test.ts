/**
 * **A deleted file is not a file the run failed to read.**
 *
 * §149.5 measured the old rule swallowing a whole pull request: `microsoft/typescript-go#831` had **28 findings, one of
 * them on `testdata/baselines/reference/submodule/conformance/importTag16.types`** - a path the head revision does not
 * have - and coverage 27 of 28 made the gate inert for **all 28**. **Twenty-seven judgeable findings went unjudged to
 * punish one that could not be posted anyway.**
 *
 * The rule that did that was written against the failure it had actually seen (§`grounding-gate.ts`: a caller holding half
 * a checkout), and it is right about that case. **A 404 is a different fact wearing the same shape**: the file existed, the
 * change removed it, and a finding about the removal is a finding about a real thing that has **nowhere to be attached**.
 *
 * So the gate has three states per finding rather than two: **read**, **unread**, and **gone**. Only `unread` withholds.
 * The cases below are that claim, plus the parse that produces `gone` from git's own text: `+++ /dev/null` is how a diff
 * says the new revision has no such file.
 */
import { describe, expect, it } from 'vitest';

import { deletedPaths } from '../review/agent/patch.js';
import { decideGrounding, describeGrounding } from '../review/grounding-gate.js';

const FILE = ['export function add(a: number, b: number) {', '  return a + b;', '}'].join('\n');

function finding(over: Record<string, unknown> = {}) {
  return {
    path: 'src/math.ts',
    startLine: 2,
    endLine: 2,
    existingCode: 'return a + b;',
    content: '`add` is unused',
    ...over,
  };
}

describe('a path the revision does not have', () => {
  it('is unpostable rather than unread, so it does not disarm the gate for the rest of the list', () => {
    // **The measured defect, in one assertion.** Twenty-eight findings, one on a deleted path: the old rule withheld, and
    // the 27 that could be judged were emitted unchecked.
    const findings = [
      finding({ path: 'src/gone.ts', startLine: 1, endLine: 1, existingCode: '' }),
      ...Array.from({ length: 27 }, () => finding()),
    ];
    const decision = decideGrounding(findings, new Map([['src/math.ts', FILE]]), undefined, {
      absent: new Set(['src/gone.ts']),
    });

    expect(decision.applied).toBe(true);
    expect(decision.withheld).toBeNull();
    expect(decision.coverage).toEqual({ findings: 28, readable: 27, unpostable: 1 });
    expect(decision.report.unpostable).toHaveLength(1);
    expect(decision.kept).toHaveLength(27);
  });

  it('says which path it was and why no comment can be attached to it', () => {
    const decision = decideGrounding(
      [finding({ path: 'testdata/x.types', startLine: 1, endLine: 1, existingCode: '' })],
      new Map(),
      undefined,
      { absent: new Set(['testdata/x.types']) },
    );

    expect(decision.report.unpostable[0]?.reason).toMatch(/testdata\/x\.types/u);
    expect(decision.report.unpostable[0]?.reason).toMatch(/no line to attach to/u);
  });

  it('still withholds for a path that is neither read nor known to be gone', () => {
    // **The repair must not turn an unread file into an excusable one.** A caller that says nothing about a path keeps the
    // old answer: the gate cannot judge it, so it drops nothing.
    const decision = decideGrounding(
      [finding(), finding({ path: 'src/unread.ts' })],
      new Map([['src/math.ts', FILE]]),
    );

    expect(decision.applied).toBe(false);
    expect(decision.withheld).toBe('no-readable-arm');
    expect(decision.coverage).toEqual({ findings: 2, readable: 1, unpostable: 0 });
  });

  it('reports the bucket in the sentence a log prints', () => {
    const decision = decideGrounding(
      [finding(), finding({ path: 'src/gone.ts', startLine: 1, endLine: 1, existingCode: '' })],
      new Map([['src/math.ts', FILE]]),
      undefined,
      { absent: new Set(['src/gone.ts']) },
    );

    expect(describeGrounding(decision)).toMatch(
      /1 on a path this revision does not have, unpostable/u,
    );
  });

  it('hands the whole change to the judge when only the change is offered', () => {
    // **The other half of §150's interface, and a branch a caller can reach**: a review of a diff alone has no files but
    // does have the patch, so `change` arrives without `absent`. The name below occurs only in the change, which is the
    // one place that arm is allowed to look.
    const decision = decideGrounding(
      [finding({ content: '`dispatchCount` is no longer recomputed' })],
      new Map([['src/math.ts', FILE]]),
      undefined,
      { change: '-  this.dispatchCount = updateDispatchCount(count);' },
    );

    expect(decision.applied).toBe(true);
    expect(decision.report.namesNowhere).toBe(0);
  });

  it('says nothing about names or postability when it has neither to report', () => {
    // **A sentence with no note is the common case**, and the two empty-string arms are the ones a reader sees on every
    // clean run: a report whose every run carried a note would be a report whose notes nobody reads.
    const sentence = describeGrounding({
      applied: true,
      withheld: null,
      // **An older report shape**: no `unpostable` field, which is the branch the `?? 0` is for.
      coverage: { findings: 2, readable: 2 },
      report: { keptRatio: 1, ungrounded: [] },
    });

    expect(sentence).toBe('grounding applied: 0 of 2 dropped, kept 1');
  });

  it('carries both notes when a finding names nothing and another cannot be posted', () => {
    // **The sentence is the only place a reader meets these two facts**, so both notes have to reach it at once: a report
    // that printed one and dropped the other would be a report where a counted finding and a dropped one read the same.
    const decision = decideGrounding(
      [
        finding({ content: '`nowhere` is used before it is defined' }),
        finding({ path: 'src/gone.ts', startLine: 1, endLine: 1, existingCode: '' }),
      ],
      new Map([['src/math.ts', FILE]]),
      undefined,
      { absent: new Set(['src/gone.ts']) },
    );

    const sentence = describeGrounding(decision);
    expect(sentence).toContain('1 on a path this revision does not have, unpostable');
    expect(sentence).toContain('1 named a symbol absent from the code, kept');
  });

  it("reads the deleted paths out of git's own text", () => {
    const patch = [
      'diff --git a/src/kept.ts b/src/kept.ts',
      '--- a/src/kept.ts',
      '+++ b/src/kept.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+const a = 2;',
      'diff --git a/testdata/old.types b/testdata/old.types',
      'deleted file mode 100644',
      '--- a/testdata/old.types',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n');

    expect([...deletedPaths(patch)]).toEqual(['testdata/old.types']);
  });

  it('names nothing when every file in the change survives', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-1',
      '+2',
    ].join('\n');

    expect(deletedPaths(patch).size).toBe(0);
  });
});
