import { describe, expect, it } from 'vitest';

import { collectDiffFacts, weighFinding } from '../actionability.js';
import { parseLLMResponse } from '../llm/prompts.js';

import type { LocatedFinding } from '../actionability.js';
import type { LLMFinding, PromptContext } from '../llm/prompts.js';

/**
 * **§88.2 said R-41 is a prompt and not a filter, and this is the device that makes the prompt checkable.**
 *
 * A lane is asked for one added line through which the defect is reached, quoted from the diff, in a field of its own.
 * **The field is what makes the claim falsifiable**: a sentence in a description that happens to contain an added line
 * is a coincidence a summariser produces, and a field the contract requires is an answer the lane had to give. The
 * three questions below are the three ways that answer can fail - it can be absent, it can be invented, and it can be a
 * fragment too short to identify a line - and each is asserted separately because **a device that only counted presence
 * would score a hallucinated anchor the same as a verified one.**
 */

const DIFF = [
  'diff --git a/src/geom.ts b/src/geom.ts',
  'index 1111111..2222222 100644',
  '--- a/src/geom.ts',
  '+++ b/src/geom.ts',
  '@@ -10,4 +10,5 @@ export function area(angle: number) {',
  ' const angle = compute();',
  '-const angle = 0;',
  '+const total = angle * 2;',
  '+if (total > limit) {',
  '+  report(total);',
  ' }',
].join('\n');

const ANCHOR = 'if (total > limit) {';

const FACTS = collectDiffFacts(DIFF);

function finding(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 12,
    endLine: 12,
    severity: 'high',
    category: 'bug',
    title: 'Guard is missing around limit comparison',
    description: '`total` can exceed `limit` and `report` is called on a bad value.',
    suggestion: 'Add a check before the comparison: `if (limit > 0 && total > limit)`.',
    lane: 'security',
    ...overrides,
  };
}

function located(overrides: Partial<LLMFinding> = {}): LocatedFinding {
  return { finding: finding(overrides), path: 'src/geom.ts' };
}

describe('the anchor a lane is asked for', () => {
  it('is verified when it is one of the diff’s added lines', () => {
    const scored = weighFinding(located({ anchor: ANCHOR }), FACTS);
    expect(scored.features.anchored).toBe(true);
  });

  it('is refused when it is not among the added lines, which is what a recalled line looks like', () => {
    const scored = weighFinding(located({ anchor: 'if (total >= limit) {' }), FACTS);
    expect(scored.features.anchored).toBe(false);
  });

  it('is refused when it is a fragment too short to identify a line', () => {
    // `report` is in an added line; a fragment that would match almost any file is not an anchor.
    const scored = weighFinding(located({ anchor: 'report' }), FACTS);
    expect(scored.features.anchored).toBe(false);
  });

  it('is read off the path the finding names, so an anchor from another file is not evidence', () => {
    const scored = weighFinding(
      { finding: finding({ anchor: ANCHOR }), path: 'src/other.ts' },
      FACTS,
    );
    expect(scored.features.anchored).toBe(false);
  });

  it('makes the comment quotable, so an anchored comment collects the existing quotesDiff weight', () => {
    const withAnchor = weighFinding(located({ anchor: ANCHOR }), FACTS);
    expect(withAnchor.features.quotesDiff).toBe(true);
    expect(withAnchor.score).toBeGreaterThan(weighFinding(located(), FACTS).score);
  });

  it('is not a gate: a finding without one is scored and emitted exactly as before', () => {
    const bare = weighFinding(located(), FACTS);
    expect(bare.features.anchored).toBe(false);
    expect(bare.actionable).toBe(true);
    expect(bare.score).toBeGreaterThan(0.6);
    // **And the absent field is not a reason.** The `why` list is what a reader argues with, so a rule that refused an
    // anchorless comment would leave a line here saying so; there is none, because the anchor is a weight and not a gate.
    expect(bare.why.join(' ')).not.toContain('anchor');
  });
});

describe('the anchor travels from the answer to the finding', () => {
  it('is kept when the lane answered with a string', () => {
    const raw = JSON.stringify({
      findings: [
        {
          startLine: 12,
          endLine: 12,
          severity: 'high',
          category: 'bug',
          title: 't',
          description: 'd',
          suggestion: null,
          anchor: ANCHOR,
        },
      ],
    });
    expect(parseLLMResponse(raw)[0]?.anchor).toBe(ANCHOR);
  });

  it('is dropped when the lane answered with something that is not a string', () => {
    const raw = JSON.stringify({
      findings: [
        {
          startLine: 12,
          endLine: 12,
          severity: 'high',
          category: 'bug',
          title: 't',
          description: 'd',
          anchor: 12,
        },
      ],
    });
    expect(parseLLMResponse(raw)[0]?.anchor).toBeUndefined();
  });

  it('is dropped when the field is blank, because a blank field is an unanswered question', () => {
    const raw = JSON.stringify({
      findings: [
        {
          startLine: 12,
          endLine: 12,
          severity: 'high',
          category: 'bug',
          title: 't',
          description: 'd',
          anchor: '   ',
        },
      ],
    });
    expect(parseLLMResponse(raw)[0]?.anchor).toBeUndefined();
  });
});

describe('the contract states the anchor in both scopes', () => {
  const base: PromptContext = {
    diffContent: DIFF,
    filePath: 'src/geom.ts',
    changeType: 'modified',
  };

  it('asks a file call for it, and the schema has a field for the answer', async () => {
    const { LANE_PROMPTS } = await import('../llm/prompts.js');
    const prompt = LANE_PROMPTS.security(base);
    expect(prompt).toContain('"anchor"');
    expect(prompt).toContain('the added line through which the defect is reached');
  });

  it('asks a pull-request call for it in the same words, so the two scopes are comparable', async () => {
    const { LANE_PROMPTS } = await import('../llm/prompts.js');
    const prompt = LANE_PROMPTS.security({
      ...base,
      scope: 'pull-request',
      paths: ['src/geom.ts'],
      maxFindings: 3,
    });
    expect(prompt).toContain('"anchor"');
    expect(prompt).toContain('the added line through which the defect is reached');
  });
});
