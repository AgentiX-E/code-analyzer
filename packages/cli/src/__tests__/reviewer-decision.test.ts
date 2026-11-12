// **A caller that switches the reviewer must not also get a different meaning of "mergeable".**
//
// `--agent` replaces the five lanes with a model that reads the repository. What it must not replace is the reading of
// the result: a critical finding blocks, more than three high findings request changes, anything comments, nothing
// approves. The lanes' rule lives in `ReviewSwarm` and this one lives here, so **two implementations of one policy is
// exactly the shape that drifts quietly** — one of them gets a new severity and the other keeps the old meaning, and the
// only person who notices is the user whose pull request was told different things by two commands.
//
// So the rule is a pure function with its own cases, and its four branches are enumerated here rather than discovered by
// running a review four times.

import { describe, expect, it } from 'vitest';

import { agentFindings, decisionFor, type PrReviewFinding } from '../commands/pr-review.js';

import type { ReviewComment } from '@code-analyzer/shared';

/** One finding, with the fields the decision reads. */
function finding(severity: PrReviewFinding['severity'], at = 1): PrReviewFinding {
  return {
    id: `f-${String(at)}`,
    file: 'src/a.ts',
    line: at,
    endLine: at,
    severity,
    category: 'bug',
    lens: 'agent',
    source: 'agent',
    title: `finding ${String(at)}`,
    description: 'what goes wrong',
    snippet: 'const a = 1;',
    confidence: 'high',
    autoFixable: false,
    inDiff: true,
  };
}

describe('the merge decision, from findings', () => {
  it('blocks on one critical finding and names it as a required correction', () => {
    const decision = decisionFor([finding('critical', 7)]);
    expect(decision.canMerge).toBe(false);
    expect(decision.recommendation).toBe('block');
    expect(decision.blockingCount).toBe(1);
    expect(decision.requiredCorrections).toEqual(['[agent] src/a.ts:7 — finding 7']);
    expect(decision.reason).toContain('1 critical');
  });

  it('requests changes at more than three high findings, and comments at three or fewer', () => {
    // **The boundary is part of the policy**: `> 3`, not `>= 3`, and the lane arm uses the same number.
    const three = decisionFor([finding('high', 1), finding('high', 2), finding('high', 3)]);
    expect(three.recommendation).toBe('approve-with-comments');
    expect(three.canMerge).toBe(true);
    const four = decisionFor([
      finding('high', 1),
      finding('high', 2),
      finding('high', 3),
      finding('high', 4),
    ]);
    expect(four.recommendation).toBe('request-changes');
    expect(four.canMerge).toBe(true);
    expect(four.reason).toContain('4 high-severity');
  });

  it('comments on anything below that, and approves a clean change', () => {
    expect(decisionFor([finding('low')]).recommendation).toBe('approve-with-comments');
    expect(decisionFor([finding('low')]).reason).toBe('1 finding(s) — review recommended.');
    const clean = decisionFor([]);
    expect(clean.recommendation).toBe('approve');
    expect(clean.canMerge).toBe(true);
    expect(clean.reason).toBe('No issues found. Safe to merge.');
    expect(clean.requiredCorrections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The reviewer's comments, flattened into the report
// ---------------------------------------------------------------------------

/** One comment as the reading reviewer files it, with the fields the report reads. */
function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'agent-0-src/a.ts',
    path: 'src/a.ts',
    content:
      'The guard cannot fire: `bound` is already a number.\nReturn `1000` from that branch instead.',
    existingCode: '  if (bound > 1000) {',
    startLine: 6,
    endLine: 6,
    category: 'bug',
    severity: 'high',
    filtered: false,
    createdAt: '2026-11-12T00:00:00.000Z',
    suggestionCode: '  if (bound > 1000) {\n    return 1000;',
    ...overrides,
  };
}

describe('the reviewer’s comments, flattened into the report', () => {
  const inDiff = (file: string, line: number): boolean => file === 'src/a.ts' && line >= 5;

  it('splits the first line off as the title and keeps the whole text as the description', () => {
    const [finding] = agentFindings([comment()], inDiff);
    expect(finding?.title).toBe('The guard cannot fire: `bound` is already a number.');
    expect(finding?.description).toContain('Return `1000` from that branch instead.');
    expect(finding?.source).toBe('agent');
    expect(finding?.lens).toBe('agent');
    expect(finding?.inDiff).toBe(true);
  });

  it('names a finding with no title line after its file rather than reporting an empty heading', () => {
    // **A single-line comment has no newline to split on**, and a report whose heading is the empty string is a row a
    // reader cannot find again.
    const [single] = agentFindings([comment({ content: 'One sentence, no second line.' })], inDiff);
    expect(single?.title).toBe('One sentence, no second line.');
    const [empty] = agentFindings([comment({ content: '' })], inDiff);
    expect(empty?.title).toBe('Finding on src/a.ts');
    // **And a comment the API returned without an id gets one derived from its position**, because two findings with the
    // same id are one finding to every consumer downstream.
    expect(empty?.id).toBe('agent-0-src/a.ts');
    expect(agentFindings([comment({ id: undefined })], inDiff)[0]?.id).toBe('agent-0-src/a.ts');
  });

  it('carries a suggestion only when the reviewer wrote one, and marks the finding fixable only then', () => {
    const [withFix] = agentFindings([comment()], inDiff);
    expect(withFix?.autoFixable).toBe(true);
    expect(withFix?.fixSuggestion).toBe('  if (bound > 1000) {\n    return 1000;');
    const [withoutFix] = agentFindings([comment({ suggestionCode: undefined })], inDiff);
    expect(withoutFix?.autoFixable).toBe(false);
    expect(withoutFix?.suggestion).toBeUndefined();
    expect(withoutFix?.fixSuggestion).toBeUndefined();
  });

  it('marks a finding the change did not touch, so a consumer knows it cannot be posted inline', () => {
    const [outside] = agentFindings([comment({ startLine: 2, endLine: 2 })], inDiff);
    expect(outside?.inDiff).toBe(false);
  });
});
