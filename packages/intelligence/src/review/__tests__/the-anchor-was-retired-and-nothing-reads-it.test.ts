import { describe, expect, it } from 'vitest';

import { collectDiffFacts, weighFinding } from '../actionability.js';
import { LANE_PROMPTS } from '../llm/prompts.js';

import type { LocatedFinding } from '../actionability.js';
import type { LLMFinding, PromptContext } from '../llm/prompts.js';

/**
 * **§91 retired the anchor, and this is the file that keeps it retired.**
 *
 * R-41 asked every lane for one added line through which the defect is reached. **The lanes answered: 88.5 % of 384
 * emitted comments carried one**, so the prompt worked and the field was never the problem - and F1 fell from 0.2757 to
 * 0.2467 because a field that every comment fills is a field that selects nothing, and the score had been reading it as
 * a quotation.
 *
 * **So the device is gone, and the two ways it could come back are what these tests see.**
 *
 * 1. **Through the answer.** A lane that still writes `anchor` - a cached prompt, a stale client, a model trained on the
 *    old contract - must not move a score. The field is not in the type and not read, and the test asserts the score is
 *    identical with and without it.
 * 2. **Through the contract.** Neither scope asks for it, and the rule numbering has no hole where it was.
 *
 * **And one thing the same commit fixed and that outlives it**: the file contract's schema ended `"suggestion": "… |
 * null` with no closing quote, so every lane call since that line was written was shown an example that is not JSON. A
 * test asserts the quote is there in both scopes, because **that defect cannot fail a gate any other way** - it fails a
 * model's output and is charged to the model.
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

const FACTS = collectDiffFacts(DIFF);

/** A finding with the field the retired contract used to ask for, cast because the type no longer has it. */
const withAnchor = (anchor: string): LLMFinding =>
  ({
    startLine: 12,
    endLine: 12,
    severity: 'high',
    category: 'bug',
    title: 'Guard is missing around limit comparison',
    description: '`total` can exceed `limit` and `report` is called on a bad value.',
    suggestion: 'Add a check before the comparison: `if (limit > 0 && total > limit)`.',
    lane: 'security',
    anchor,
  }) as unknown as LLMFinding;

const located = (finding: LLMFinding): LocatedFinding => ({ finding, path: 'src/geom.ts' });

describe('a retired field a stale client still sends', () => {
  it('does not move the score, so it cannot come back through the answer', () => {
    const { anchor: _anchor, ...bare } = withAnchor('if (total > limit) {') as unknown as Record<
      string,
      unknown
    >;
    const without = weighFinding(located(bare as unknown as LLMFinding), FACTS);
    const withIt = weighFinding(located(withAnchor('if (total > limit) {')), FACTS);
    expect(withIt.score).toBe(without.score);
    expect(withIt.features).toEqual(without.features);
  });

  it('does not turn a comment that quotes nothing into one that quotes the diff', () => {
    const quotedBefore = weighFinding(located(withAnchor('if (total > limit) {')), FACTS);
    // The finding's own prose contains none of the added lines, so the quotation term must stay false however many
    // copies of an added line arrive in a field nobody reads.
    expect(quotedBefore.features.quotesDiff).toBe(false);
  });
});

describe('the contract no longer asks for it', () => {
  const base: PromptContext = {
    diffContent: DIFF,
    filePath: 'src/geom.ts',
    changeType: 'modified',
  };

  it('names no anchor field in a file call', () => {
    const prompt = LANE_PROMPTS.security(base);
    expect(prompt).not.toContain('"anchor"');
    expect(prompt).not.toContain('The anchor.');
  });

  it('names no anchor field in a pull-request call', () => {
    const prompt = LANE_PROMPTS.security({
      ...base,
      scope: 'pull-request',
      paths: ['src/geom.ts'],
      maxFindings: 3,
    });
    expect(prompt).not.toContain('"anchor"');
  });

  it('numbers the rules without a hole where it was', () => {
    const prompt = LANE_PROMPTS.security(base);
    expect(prompt).toContain('6. **The description names the failure');
    expect(prompt).not.toContain('7. **');
  });
});

describe('the schema defect that outlived the device', () => {
  const base: PromptContext = {
    diffContent: DIFF,
    filePath: 'src/geom.ts',
    changeType: 'modified',
  };

  it('closes the suggestion field’s string in both scopes', () => {
    const filePrompt = LANE_PROMPTS.security(base);
    const prPrompt = LANE_PROMPTS.security({
      ...base,
      scope: 'pull-request',
      paths: ['src/geom.ts'],
      maxFindings: 3,
    });
    expect(filePrompt).toContain('"suggestion": "<suggested fix> | null"');
    expect(prPrompt).toContain('"suggestion": "<suggested fix> | null"');
  });
});
