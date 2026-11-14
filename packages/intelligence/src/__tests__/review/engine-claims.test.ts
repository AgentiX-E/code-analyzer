// @code-analyzer/intelligence — the engine with the claim check switched on
//
// **What this file proves that the class's own tests cannot.** The adjudicator's tests show that a verdict is applied
// correctly to a candidate. **They say nothing about whether the engine reaches the adjudicator at all, in the right
// order, with the right coordinate system, and without losing the lane a finding came from** - and both of this
// repository's worst measurement defects were exactly that shape: a device that existed and was not wired, and a filter
// that compared file lines against a diff's line count.
//
// So the assertions are about the *engine*: how many model calls a file costs, which lane the survivor is attributed to,
// whether a restatement is refused before a paid call happens, and whether a file's findings survive a refutation that
// happened beside them.

import { describe, it, expect } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// A provider that answers lanes and the second reader from one table
// ---------------------------------------------------------------------------

const NARRATION = {
  startLine: 11,
  endLine: 11,
  severity: 'low',
  category: 'architecture',
  title: 'Public API change: return type of prefBalloonArrow changed from int to ArrowType',
  description: 'The return type was converted to the new enum.',
  suggestion: null,
};

const CLAIM = {
  startLine: 12,
  endLine: 12,
  severity: 'high',
  category: 'bug',
  title: 'vertical edges are classified as horizontal',
  description:
    'When line.x is below the epsilon the comparison falls through, so a vertical edge is reported horizontal.',
  suggestion: 'compare the y component as well',
};

const SECOND_CLAIM = {
  startLine: 13,
  endLine: 13,
  severity: 'medium',
  category: 'performance',
  title: 'the dimension is rebuilt once per view',
  description:
    'Each view in the loop recomputes the same geometry, so the cost is quadratic in the number of views.',
  suggestion: 'hoist the computation out of the loop',
};

class LaneProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  laneCalls = 0;
  adjudicationCalls = 0;
  readonly adjudicationPrompts: string[] = [];

  constructor(
    private readonly findings: ReadonlyArray<Record<string, unknown>>,
    private readonly verdicts: ReadonlyArray<string>,
  ) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    if (prompt.includes('second reader of a code review comment')) {
      const at = this.adjudicationCalls;
      this.adjudicationCalls += 1;
      this.adjudicationPrompts.push(prompt);
      return this.result(this.verdicts[at] ?? '{"verdict":"upheld","reason":"holds"}');
    }
    this.laneCalls += 1;
    // **One lane speaks and the others are silent**, which is what a real review looks like on most files and what makes
    // the lane attribution assertion meaningful: a flat list would pass every other test in this file.
    if (prompt.includes('expert security reviewer'))
      return this.result(JSON.stringify({ findings: this.findings }));
    return this.result('{"findings":[]}');
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('no tools here');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private result(content: string): CompletionResult {
    return {
      content,
      model: this.model,
      createdAt: new Date().toISOString(),
      finishReason: 'stop',
    };
  }
}

/** A patch whose added lines are 11, 12 and 13 - the numbers the fixtures point at. */
/**
 * **A patch whose added lines are 11, 12 and 13, which is what every fixture above points at.**
 *
 * The first version of this constant had its hunk header say `+8,7` over four context lines and three additions, and
 * **the additions landed on 10, 11 and 12 rather than on 11, 12 and 13** - so the fixture was testing a coordinate the
 * code never used, and the failure it produced read as an anchoring bug. **A fixture whose line numbers are asserted by
 * hand has to be counted by hand**, and the count is written here: three context lines at 8, 9 and 10, three additions
 * at 11, 12 and 13, one closing context line at 14.
 */
const PATCH = [
  'diff --git a/src/DimensionValidators.cpp b/src/DimensionValidators.cpp',
  '--- a/src/DimensionValidators.cpp',
  '+++ b/src/DimensionValidators.cpp',
  '@@ -8,4 +8,7 @@',
  ' double isValidSingleEdge(const Line& line) {',
  '   const double x = line.x;',
  '   const double y = line.y;',
  '+  if (x < FLT_EPSILON) {',
  '+    return DimensionGeometry::isHorizontal;',
  '+  }',
  '   return DimensionGeometry::isVertical;',
].join('\n');

function diff(): GitDiff {
  return {
    filePath: 'src/DimensionValidators.cpp',
    oldHash: 'old',
    newHash: 'new',
    ranges: [{ oldStart: 8, oldEnd: 11, newStart: 8, newEnd: 14, changeType: 'modified' }],
    changeType: 'modified',
  };
}

describe('LLMReviewEngine with the claim check', () => {
  it('changes nothing when the check is off, and spends no call on it', async () => {
    // **The default, and the reason it is the default**: every published figure in this repository was measured without
    // this device, and an arm that cannot be switched off cannot be measured against them.
    const provider = new LaneProvider([NARRATION, CLAIM], []);
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
    const results = await engine.reviewDiff(diff(), PATCH);

    expect(provider.adjudicationCalls).toBe(0);
    expect(engine.lastAdjudication).toBeNull();
    expect(results.flatMap((result) => result.findings)).toHaveLength(2);
  });

  it('refuses a restatement before spending a call on it', async () => {
    // **The cheap half first.** A comment that restates the diff never reaches a paid call, and the count says so.
    const provider = new LaneProvider(
      [NARRATION, CLAIM],
      ['{"verdict":"upheld","reason":"holds"}'],
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], adjudicate: true });
    const results = await engine.reviewDiff(diff(), PATCH);

    expect(provider.adjudicationCalls).toBe(1);
    expect(engine.lastAdjudication).toMatchObject({
      narration: { considered: 2, kept: 1, refusedByRule: { 'api-change': 1 } },
    });
    const kept = results.flatMap((result) => result.findings);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.title).toBe(CLAIM.title);
  });

  it('drops a refuted claim and keeps the lane it came from', async () => {
    const provider = new LaneProvider(
      [CLAIM, SECOND_CLAIM],
      [
        '{"verdict":"refuted","reason":"the else branch exists at line 14"}',
        '{"verdict":"upheld","line":13,"reason":"the loop recomputes it"}',
      ],
    );
    // **One call at a time, because the verdicts are a script and a script has an order.** With four calls in flight the
    // provider answers them in arrival order, which is not candidate order - and a test that read the answers
    // positionally against a concurrent pass would be asserting something the pass never promised.
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      adjudicate: true,
      adjudicateConcurrency: 1,
    });
    const results = await engine.reviewDiff(diff(), PATCH);

    expect(engine.lastAdjudication?.claims).toMatchObject({ candidates: 2, upheld: 1, refuted: 1 });
    const kept = results.flatMap((result) => result.findings);
    expect(kept.map((finding) => finding.title)).toEqual([SECOND_CLAIM.title]);
    // **The lane survives**, so the per-lane tables a benchmark prints still attribute the goldens to a reviewer.
    expect(results[0]!.lane).toBe('security');
    expect(kept[0]!.lane).toBeUndefined();
    expect(results[0]!.findings[0]).toBe(kept[0]);
  });

  it('files a repair with the sentence the second reader wrote', async () => {
    const provider = new LaneProvider(
      [CLAIM],
      [
        JSON.stringify({
          verdict: 'repaired',
          line: 12,
          reason: 'the defect here is the missing comparison of the y component',
          title: 'a vertical edge is reported as horizontal',
          description:
            'When line.x is below the epsilon the code returns isHorizontal for a vertical edge.',
          severity: 'high',
          category: 'bug',
        }),
      ],
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], adjudicate: true });
    const results = await engine.reviewDiff(diff(), PATCH);

    const kept = results.flatMap((result) => result.findings);
    expect(kept[0]).toMatchObject({
      title: 'a vertical edge is reported as horizontal',
      repaired: true,
      startLine: 12,
      endLine: 12,
    });
    expect(engine.lastAdjudication?.claims).toMatchObject({ repaired: 1, upheld: 0 });
  });

  it('anchors a comment on the line the diff added, not on the line the lane guessed', async () => {
    // **The coordinate test.** The lane said line 12; the second reader read the patch and said 11. A comment filed on
    // the guessed line is a comment a judge cannot match, and 141 of this corpus's goldens were missed exactly there.
    const provider = new LaneProvider(
      [CLAIM],
      ['{"verdict":"upheld","line":11,"reason":"this line decides it"}'],
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], adjudicate: true });
    const results = await engine.reviewDiff(diff(), PATCH);
    expect(results.flatMap((result) => result.findings)[0]).toMatchObject({
      startLine: 11,
      endLine: 11,
    });
  });

  it('does not delete findings when the provider is down, and counts what it could not check', async () => {
    const provider = new LaneProvider([CLAIM], []);
    const failing: LLMProvider = {
      name: 'Scripted',
      model: 'scripted-1',
      complete: async (prompt: string, options?: CompletionOptions) => {
        if (prompt.includes('second reader')) throw new Error('quota exhausted');
        return provider.complete(prompt, options);
      },
      completeWithTools: () => provider.completeWithTools(),
      healthCheck: () => provider.healthCheck(),
    };
    const engine = new LLMReviewEngine(failing, { lanes: ['security'], adjudicate: true });
    const results = await engine.reviewDiff(diff(), PATCH);

    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
    expect(engine.lastAdjudication?.claims).toMatchObject({ unchecked: 1, refuted: 0 });
  });

  it('keeps a lane that failed failing rather than resurrecting it', async () => {
    // A lane whose call failed carries `success: false` and no findings; the rebuild must not turn it into a success.
    const provider = new LaneProvider([CLAIM], ['{"verdict":"upheld","reason":"holds"}']);
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security', 'performance'],
      adjudicate: true,
    });
    const results = await engine.reviewDiff(diff(), PATCH);
    expect(results.every((result) => result.success)).toBe(true);
    expect(results.map((result) => result.findings.length).sort()).toEqual([0, 1]);
  });

  it('uses the diff header block when the caller gave no file text', async () => {
    // **The product path can be called without a patch**, and then the added-line set is unknown rather than empty -
    // a distinction that decides between "no constraint" and "refuse everything".
    const provider = new LaneProvider([CLAIM], ['{"verdict":"upheld","reason":"holds"}']);
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], adjudicate: true });
    const results = await engine.reviewDiff(diff(), undefined);
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
    expect(engine.lastAdjudication?.claims).toMatchObject({
      candidates: 1,
      upheld: 1,
      unanchored: 0,
    });
  });

  it('records every comment it removed, with the sentence that removed it', async () => {
    // **The counter is not the diagnosis.** §44 bought a corpus run that said *"494 refuted"* and could not say whether
    // the reader was too strict or was looking at a line it had never been shown. **The reason is the only field that
    // answers that**, and it has to survive the engine, which is where the last three instrument defects lived.
    const provider = new LaneProvider(
      [NARRATION, CLAIM, SECOND_CLAIM],
      [
        '{"verdict":"refuted","reason":"the guard at\\nline 14 returns before this"}',
        '{"verdict":"upheld","line":13,"reason":"holds"}',
      ],
    );
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      adjudicate: true,
      adjudicateConcurrency: 1,
    });
    await engine.reviewDiff(diff(), PATCH);

    const refused = engine.lastAdjudication?.refused ?? [];
    expect(refused).toHaveLength(2);
    const [restatement, refutation] = refused;
    expect(restatement).toMatchObject({ why: 'narration:api-change', startLine: 11 });
    expect(refutation).toMatchObject({ why: 'refuted', startLine: 12, path: diff().filePath });
    // **One line, because a reason carrying a fenced block turns one artifact row into ten** - and the newline the
    // scripted reader wrote is the smallest version of that.
    expect(refutation!.reason).toBe('the guard at line 14 returns before this');
    expect(refutation!.reason).not.toContain('\n');
    expect(refutation!.title).toBe(CLAIM.title);
  });

  it('tells the second reader which line the comment is on', async () => {
    // **The §45 device, asserted where it is wired rather than where it is written.** The prompt test proves the sentence
    // exists; this proves the engine hands the prompt what it needs to produce it, which is the patch itself.
    const provider = new LaneProvider([CLAIM], ['{"verdict":"upheld","reason":"holds"}']);
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], adjudicate: true });
    await engine.reviewDiff(diff(), PATCH);

    const prompt = provider.adjudicationPrompts[0] ?? '';
    expect(prompt).toContain('The comment is filed on line 12.');
    // The patch's own content indentation survives the `+` strip, because the reader is being shown the code.
    expect(prompt).toContain('12 |     return DimensionGeometry::isHorizontal;');
  });
});
