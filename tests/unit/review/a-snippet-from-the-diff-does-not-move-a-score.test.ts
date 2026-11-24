// **Filling a finding's snippet from the diff is the cheapest way to make a comment readable, and the most expensive way
// to break a measurement.** `weighFinding` asks whether the review quoted the change it is about; a quotation copied out
// of the diff answers yes by construction, so a naive fix would have marked every finding as quoting the change and the
// term would have stopped measuring the reviewer.
//
// **These cases are the guard, and they are written as equalities rather than as intentions.** A finding scored before
// the anchor and after it must produce the same number, the same features and the same order - and a quotation the model
// actually wrote must still count, because the point of the change was to add evidence, not to remove the term.

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_EXTRACTOR,
  attachEvidence,
  collectDiffFacts,
  rankFindings,
  weighFinding,
} from '@code-analyzer/intelligence';

import type { LLMFinding } from '@code-analyzer/intelligence';

const PATCH = [
  'diff --git a/src/charge.ts b/src/charge.ts',
  'index 1111111..2222222 100644',
  '--- a/src/charge.ts',
  '+++ b/src/charge.ts',
  '@@ -10,3 +10,5 @@',
  ' export async function charge(order: Order) {',
  '+  const total = order.items.reduce((sum, i) => sum + i.price, 0);',
  '+  await gateway.capture(order.id, total);',
  '   return order;',
  ' }',
].join('\n');

const ORIGIN = { commit: 'cafebabe', extractor: EVIDENCE_EXTRACTOR };

/** A finding about the added lines, written the way a lane returns one: no snippet, because nothing filled it. */
function finding(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 11,
    endLine: 12,
    severity: 'high',
    category: 'bug',
    title: 'The captured amount ignores the currency',
    description:
      'total is summed across items that may not share a currency, so capture can round wrong.',
    suggestion: 'Convert each price to the order currency before summing.',
    ...overrides,
  };
}

const facts = collectDiffFacts(PATCH);

describe('an anchor from the diff does not move the score', () => {
  it('scores a finding identically before and after its snippet is filled from the change', () => {
    const before = weighFinding({ finding: finding(), path: 'src/charge.ts' }, facts);

    const located = { finding: finding(), path: 'src/charge.ts' };
    expect(attachEvidence(located, facts, ORIGIN)).toBe(true);
    expect(located.finding.snippet).toBeDefined();
    const after = weighFinding(located, facts);

    // **Every field, not only the total.** A term that changed and a term that changed back would leave the score equal
    // and the report wrong.
    expect(after).toEqual(before);
  });

  it('does not let a derived snippet claim the quotation term', () => {
    const located = { finding: finding(), path: 'src/charge.ts' };
    attachEvidence(located, facts, ORIGIN);
    // The snippet now literally contains an added line, and the term must still be false: the model did not quote it.
    expect(located.finding.snippet).toContain('gateway.capture(order.id, total)');
    expect(weighFinding(located, facts).features.quotesDiff).toBe(false);
  });

  it('still counts a quotation the model wrote', () => {
    // The term exists to measure the reviewer, and this is the only shape in which the reviewer speaks.
    const located = {
      finding: finding({ snippet: 'await gateway.capture(order.id, total);' }),
      path: 'src/charge.ts',
    };
    attachEvidence(located, facts, ORIGIN);
    const score = weighFinding(located, facts);
    expect(located.finding.snippetSource).toBe('model');
    expect(score.features.quotesDiff).toBe(true);
  });

  it('leaves the order of a ranked list unchanged when every finding is anchored', () => {
    // **A ranking is what ships.** Two findings whose scores move together keep their order and still change the budget
    // cut, so the order alone is not enough - the scores are asserted equal in the first case, and both here.
    const plain = [
      {
        finding: finding({ startLine: 11, endLine: 11, severity: 'low' as const }),
        path: 'src/charge.ts',
      },
      {
        finding: finding({ startLine: 12, endLine: 12, severity: 'critical' as const }),
        path: 'src/charge.ts',
      },
      {
        finding: finding({ startLine: 11, endLine: 12, severity: 'medium' as const }),
        path: 'src/charge.ts',
      },
    ];
    const anchored = plain.map((entry) => ({ ...entry, finding: { ...entry.finding } }));
    for (const entry of anchored) attachEvidence(entry, facts, ORIGIN);

    expect(anchored.every((entry) => entry.finding.evidence !== undefined)).toBe(true);
    expect(rankFindings(anchored, facts).map((entry) => entry.score.score)).toEqual(
      rankFindings(plain, facts).map((entry) => entry.score.score),
    );
    expect(rankFindings(anchored, facts).map((entry) => entry.index)).toEqual(
      rankFindings(plain, facts).map((entry) => entry.index),
    );
  });

  it('keeps the grounding term where it was, because grounding is a range and not a quotation', () => {
    const located = { finding: finding({ startLine: 30, endLine: 31 }), path: 'src/charge.ts' };
    const before = weighFinding(located, facts);
    attachEvidence(located, facts, ORIGIN);
    expect(located.finding.evidence).toBeUndefined();
    expect(weighFinding(located, facts)).toEqual(before);
  });
});
