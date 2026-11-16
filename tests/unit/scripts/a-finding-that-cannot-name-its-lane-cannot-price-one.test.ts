// @code-analyzer — a finding that cannot name its lane cannot price one
//
// **The discovery run published 1 109 findings and `lane: null` on every one of them.** The attribute existed on the
// lane's result and not on its findings, so the flattening that builds the judged list dropped it - and the question
// *"which of the five lanes earns its 5 785 model calls"* became unanswerable from the artifact that paid for them.
//
// The repair is one function, and these tests hold the two properties that make it a repair rather than a relabel:
// **a finding that already names its lane keeps it** (the reading agent stamps its own), and **a lane that failed
// contributes nothing**, because a lane that produced no findings and a lane that failed are the same zero in a figure
// and different facts about the reviewer.

import { describe, expect, it } from 'vitest';

import { locateLaneFindings } from '../../../scripts/lib/lane-attribution.mjs';

const finding = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  startLine: 10,
  endLine: 12,
  ...extra,
});

describe('the flattening keeps the lane a finding came from', () => {
  it('stamps every finding with the lane that produced it', () => {
    const located = locateLaneFindings([
      { lane: 'security', filePath: 'a.ts', success: true, findings: [finding('one')] },
      { lane: 'performance', filePath: 'a.ts', success: true, findings: [finding('two'), finding('three')] },
    ]);
    expect(located.map((entry) => entry.finding.lane)).toEqual(['security', 'performance', 'performance']);
    // **And the path comes from the result**, because a finding's line numbers are in the file the lane was given.
    expect(located.map((entry) => entry.path)).toEqual(['a.ts', 'a.ts', 'a.ts']);
  });

  it('leaves a finding that already names its lane alone, because the reader stamps its own', () => {
    // A merge arm runs both reviewers; relabelling the reader's rows as whichever lane was flattened last is the defect
    // that would make a per-lane table describe a reviewer nobody ran.
    const located = locateLaneFindings([
      { lane: 'security', filePath: 'a.ts', success: true, findings: [finding('mine', { lane: 'agent' })] },
    ]);
    expect(located[0]!.finding.lane).toBe('agent');
  });

  it('drops a lane that failed rather than filing its empty list as a finding', () => {
    const located = locateLaneFindings([
      { lane: 'security', filePath: 'a.ts', success: false, findings: [finding('never happened')] },
      { lane: 'performance', filePath: 'a.ts', success: true, findings: [finding('real')] },
    ]);
    expect(located).toHaveLength(1);
    expect(located[0]!.finding.title).toBe('real');
  });

  it('survives a lane that returned no findings and a list that is not there', () => {
    expect(locateLaneFindings([{ lane: 'security', filePath: 'a.ts', success: true }])).toEqual([]);
    expect(locateLaneFindings([])).toEqual([]);
    expect(locateLaneFindings(null)).toEqual([]);
  });

  it('does not mutate the finding it was handed, because the caller still owns it', () => {
    const original = finding('one');
    locateLaneFindings([{ lane: 'security', filePath: 'a.ts', success: true, findings: [original] }]);
    expect(original).not.toHaveProperty('lane');
  });
});
