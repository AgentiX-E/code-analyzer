// @code-analyzer/intelligence — a site, a cap, and the 1 112 findings the range rule removed without reading a word
//
// **The R-55 arm entered deduplication with 1 646 findings and left it with 530.** Of the 1 116 removed, **1 112 were
// removed under `rangeOnly`** - overlapping ranges and nothing else, no textual agreement behind the merge - and
// `keptAsSecondConcern` was **0**, because §59's switch keeps one extra finding at a site and only when the *category*
// differs. **The goldens say what that costs.** `ClusterChangedEvent.java:351-369` carries four separate goldens -
// a missing null check, a redundant `size()` call, a constant's encapsulation and that constant's position - and
// `InstrumentationServiceImpl.java:67-135` carries four more. **A reviewer that keeps one remark per range reports one
// of those four**, and the other three were rejected as *"a finding on this path that does not match"*.
//
// **So the cap becomes a number rather than a category prefix.** `sameSiteConcerns` is how many findings one site may
// keep, and the test of *same site* stays what it was - the ranges overlap - while the test of *one remark* stays
// textual: a second finding is kept only when `shares(...)` is below `dedupThreshold`. **A lane that says the same
// sentence twice in one range is still one remark**, which is what the switch must not lose while it gains the rest.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** A provider that answers one fixed list per lane, keyed by the lane's own role sentence. */
class LaneScript implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  constructor(private readonly byLane: Record<string, ReadonlyArray<Record<string, unknown>>>) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    for (const [role, findings] of Object.entries(this.byLane)) {
      if (prompt.includes(role)) {
        return this.result(JSON.stringify({ findings }));
      }
    }
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

function diff(): GitDiff {
  return {
    filePath: 'server/src/main/java/org/elasticsearch/cluster/ClusterChangedEvent.java',
    oldPath: null,
    status: 'modified',
    language: 'java',
    hunks: [],
    ranges: [{ startLine: 351, endLine: 369, startColumn: 0, endColumn: 0 }],
    addedLines: [352, 353, 354],
    removedLines: [],
    oldHash: '0000000',
    newHash: '1111111',
  } as unknown as GitDiff;
}

function finding(overrides: Record<string, unknown>): Record<string, unknown> {
  return { severity: 'medium', category: 'bug', suggestion: null, ...overrides };
}

/**
 * **Four findings, one file, one range, four different sentences** - the shape the goldens of
 * `ClusterChangedEvent.java:351-369` have. Every sentence is worded so that it shares fewer than 0.6 of its content
 * words with every other, which is the threshold the engine treats as *the same remark*.
 */
function fourConcernsAtOneSite(): Record<string, ReadonlyArray<Record<string, unknown>>> {
  return {
    'expert security reviewer': [
      finding({
        startLine: 352,
        endLine: 366,
        severity: 'high',
        title: 'metadata is dereferenced without a null check',
        description: 'previous metadata arrives from the cluster state and is used unguarded here',
      }),
    ],
    'expert performance engineer': [
      finding({
        startLine: 353,
        endLine: 365,
        severity: 'medium',
        title: 'redundant size and hasProject call per event',
        description: 'both queries walk the project map before the cheap identity comparison is tried',
      }),
    ],
    'expert code quality reviewer': [
      finding({
        startLine: 355,
        endLine: 360,
        severity: 'low',
        category: 'maintainability',
        title: 'the empty delta constant belongs inside the record',
        description: 'encapsulation of the sentinel would follow from nesting it',
      }),
    ],
    'identify architecture issues': [
      finding({
        startLine: 361,
        endLine: 368,
        severity: 'low',
        category: 'style',
        title: 'the constant is declared after its only consumer',
        description: 'reading order puts declarations above the method that refers to them',
      }),
    ],
  };
}

async function run(options: { sameSiteConcerns?: number; secondConcern?: boolean }) {
  const engine = new LLMReviewEngine(new LaneScript(fourConcernsAtOneSite()), {
    lanes: ['security', 'performance', 'maintainability', 'architecture'] as const,
    ...options,
  });
  const results = await engine.reviewDiff(diff());
  return { findings: results.flatMap((result) => result.findings), report: engine.lastDeduplication };
}

describe('a site can carry more than one concern', () => {
  it('keeps one remark per range by default, which is the arm every published figure was measured under', async () => {
    // **The default is the history, not the improvement.** 1 112 of R-55's removals happened under this rule, so a
    // default that already kept two would silently re-price every figure in the tree.
    const { findings, report } = await run({});
    expect(findings).toHaveLength(1);
    expect(report?.mergedBy.rangeOnly).toBe(3);
    expect(report?.keptAsSecondConcern).toBe(0);
    expect(report?.sameSiteConcerns).toBe(1);
  });

  it('keeps two when the cap is two, and neither of them is a category collision', async () => {
    const { findings, report } = await run({ sameSiteConcerns: 2 });
    expect(findings).toHaveLength(2);
    expect(report?.keptAsSecondConcern).toBe(1);
    expect(report?.mergedBy.rangeOnly).toBe(2);
    // **The cap is on the site and not on the run**: four findings over one range at a cap of two is two remarks.
    expect(report?.after).toBe(2);
  });

  it('keeps all four when the cap is four, which is the shape the goldens have', async () => {
    const { findings, report } = await run({ sameSiteConcerns: 4 });
    expect(findings).toHaveLength(4);
    expect(report?.keptAsSecondConcern).toBe(3);
    expect(report?.mergedBy).toEqual({ rangeAndWords: 0, rangeOnly: 0, wordsNearby: 0 });
    // **And the count of what happened still adds up**, because a report whose totals do not is the §46.8 defect.
    expect(report?.before).toBe(4);
    expect(report?.dropped).toBe(0);
  });

  it('does not turn the cap into a licence for the same sentence twice', async () => {
    // **One lane says one thing and another lane says it again in the same words.** At a cap of four the range rule is
    // satisfied, the cap is not reached, and the finding is *still* a duplicate: the merge key that reads words is the
    // one that decides, and `rangeAndWords` is what it is counted under.
    const engine = new LLMReviewEngine(
      new LaneScript({
        'expert security reviewer': [
          finding({
            startLine: 352,
            endLine: 366,
            severity: 'high',
            title: 'metadata is dereferenced without a null check',
            description: 'previous metadata arrives from the cluster state and is used unguarded here',
          }),
        ],
        'identify architecture issues': [
          finding({
            startLine: 353,
            endLine: 365,
            severity: 'medium',
            title: 'metadata is dereferenced without a null check',
            description: 'previous metadata arrives from the cluster state and is used unguarded here',
          }),
        ],
      }),
      {
        lanes: ['security', 'architecture'] as const,
        sameSiteConcerns: 4,
      },
    );
    const results = await engine.reviewDiff(diff());
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
    expect(engine.lastDeduplication?.mergedBy.rangeAndWords).toBe(1);
    expect(engine.lastDeduplication?.keptAsSecondConcern).toBe(0);
  });

  it('leaves §59 alone when both switches are on, because a category prefix is a narrower cap', async () => {
    // **`secondConcern` is the cap of one, restricted to a different category.** A run that sets both asks for the
    // wider of the two, and the report says which number it applied rather than averaging them.
    const { findings, report } = await run({ secondConcern: true, sameSiteConcerns: 3 });
    expect(findings).toHaveLength(3);
    expect(report?.sameSiteConcerns).toBe(3);
    expect(report?.keptAsSecondConcern).toBe(2);
  });

  it('refuses a cap that is not a positive integer, rather than reading zero as one', async () => {
    // **Zero and one are the same instruction** and a negative number is not an instruction at all, so the constructor
    // raises instead of choosing - a run whose artifact says `sameSiteConcerns: 0` would be a run nobody can reproduce.
    expect(() => new LLMReviewEngine(new LaneScript({}), { sameSiteConcerns: 0 })).toThrow(
      /sameSiteConcerns/u,
    );
    expect(() => new LLMReviewEngine(new LaneScript({}), { sameSiteConcerns: -1 })).toThrow(
      /sameSiteConcerns/u,
    );
    expect(() => new LLMReviewEngine(new LaneScript({}), { sameSiteConcerns: 2.5 })).toThrow(
      /sameSiteConcerns/u,
    );
  });
});
