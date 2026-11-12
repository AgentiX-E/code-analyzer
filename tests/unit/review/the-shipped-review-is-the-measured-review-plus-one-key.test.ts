// The review that is published is the review that was measured, plus exactly one declared key
//
// **The defect this file exists to prevent is one that had already happened.** The reviewer's settings were written
// twice - four literals in the benchmark harness and four in the `review pr` command - and the copies had diverged on
// `allowOffDiff`, so every published figure described a configuration that **no product path offered**: the benchmark
// refused findings on untouched files, and the command shipped them. A difference of one key that nobody declared is how
// a benchmark stops describing the thing it is named after.
//
// **The fix is naming, not forbidding.** The two arms are `BASELINE_AGENT_OPTIONS` (measured, comparable with a
// competitor that only comments on changed lines) and `SHIPPED_AGENT_OPTIONS` (published, which may also report that a
// change broke an untouched caller). The pair is allowed to differ; it is not allowed to differ *silently* or in more
// than the keys below. And the difference is asserted twice - as values, and as behaviour - because a constant that is
// right and an engine that ignores it is the same defect one level down.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENT_ARM_DIVERGENCE,
  BASELINE_AGENT_OPTIONS,
  ReviewAgent,
  SHIPPED_AGENT_OPTIONS,
} from '../../../packages/intelligence/src/review/agent/review-agent.js';
import { DirectoryRepository } from '../../../packages/intelligence/src/review/agent/repository.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
  ToolDefinition,
} from '../../../packages/intelligence/src/review/llm/provider.js';

const DIFF_A = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' export { a, b };',
].join('\n');

/** `src/c.ts` is in the repository and **not** in the change - which is exactly what `allowOffDiff` is about. */
const FILE_A = ['const a = 1;', 'const b = 2;', 'export { a, b };'].join('\n');
const FILE_C = ['export const c = 3;', 'export const d = 4;'].join('\n');

/** A provider that files one comment on the untouched file and then ends the task. */
class OffDiffProvider implements LLMProvider {
  readonly name = 'off-diff';
  readonly model = 'off-diff-1';
  private round = 0;

  async complete(): Promise<CompletionResult> {
    return { content: '{"remove": []}', model: this.model, createdAt: '', finishReason: 'stop' };
  }

  async completeWithTools(
    _prompt: string,
    _tools: ToolDefinition[],
    _options?: CompletionOptions,
  ): Promise<CompletionResult> {
    this.round += 1;
    if (this.round === 1) {
      return {
        content: '',
        model: this.model,
        createdAt: '',
        finishReason: 'stop',
        toolCalls: [
          {
            id: 'c1',
            name: 'file_comment',
            arguments: JSON.stringify({
              comments: [
                {
                  path: 'src/c.ts',
                  content: 'd is exported but nothing assigns it',
                  existing_code: 'export const d = 4;',
                  category: 'bug',
                  severity: 'medium',
                },
              ],
            }),
          },
          { id: 'd1', name: 'task_done', arguments: JSON.stringify({ reviewed: [] }) },
        ],
      };
    }
    return { content: '', model: this.model, createdAt: '', finishReason: 'stop', toolCalls: [] };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function repository(): DirectoryRepository {
  const root = mkdtempSync(join(tmpdir(), 'agent-arm-'));
  for (const [path, text] of Object.entries({ 'src/a.ts': FILE_A, 'src/c.ts': FILE_C })) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text);
  }
  return new DirectoryRepository({ root, changed: new Map([['src/a.ts', DIFF_A]]) });
}

describe('the two arms differ in one key, and the file says which', () => {
  it('names the divergence rather than leaving it to be discovered', () => {
    // **A second divergence is not forbidden, it is required to be declared here first.** The failure message says what
    // the consequence would be, because the person who adds one is the person who can decide whether the published
    // figure still describes the shipped reviewer.
    expect(AGENT_ARM_DIVERGENCE).toEqual(['allowOffDiff']);
  });

  it('is otherwise the same reviewer, key by key', () => {
    const keys = Object.keys(BASELINE_AGENT_OPTIONS) as Array<keyof typeof BASELINE_AGENT_OPTIONS>;
    const same = keys.filter((key) => BASELINE_AGENT_OPTIONS[key] === SHIPPED_AGENT_OPTIONS[key]);
    expect(same.sort()).toEqual(keys.filter((key) => !AGENT_ARM_DIVERGENCE.includes(key)).sort());
  });

  it('keeps the cap the per-file truncation was measured at, not a second opinion of it', () => {
    // §23.9 measured the three-per-file cap as the binding constraint on 64 of 132 on-path rejections. **A cap that
    // moved in one arm and not the other would make that measurement describe neither.**
    expect(BASELINE_AGENT_OPTIONS.maxFindingsPerFile).toBe(3);
    expect(SHIPPED_AGENT_OPTIONS.maxFindingsPerFile).toBe(3);
  });
});

describe('the engine reads its defaults from the shipped arm', () => {
  it('reports a finding on an untouched file when nothing overrides the default', async () => {
    // **This is the behaviour the product ships**, and it is asserted as behaviour because a constant that the engine
    // ignores is indistinguishable from a constant that does not exist.
    const outcome = await new ReviewAgent(new OffDiffProvider(), { filter: false }).review({
      repository: repository(),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments.map((comment) => comment.path)).toEqual(['src/c.ts']);
  });

  it('refuses the same finding under the measured arm', async () => {
    // **And this is the arm every published figure describes.** The same provider, the same repository, the same
    // finding - one key, two answers, which is what makes the difference a measurement rather than a claim.
    const outcome = await new ReviewAgent(new OffDiffProvider(), {
      ...BASELINE_AGENT_OPTIONS,
      filter: false,
    }).review({ repository: repository(), changedPaths: ['src/a.ts'] });
    expect(outcome.comments).toEqual([]);
    expect(outcome.ledger.draftsFiled).toBe(1);
  });
});

describe('both callers name the arm instead of respelling it', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');
  /**
   * **Code, not prose.** Both files explain in their comments why the arms differ, and a comment that names a literal is
   * documentation rather than a second definition - so the assertion reads assignment lines and nothing else. A blank
   * test that failed on its own explanation would be a test that punishes the reason the file is readable.
   */
  const assignments = (source: string): string[] =>
    source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => line.replace(/\/\/.*$/, ''));

  it('has the command spread the shipped arm', () => {
    const lines = assignments(read('packages/cli/src/commands/pr-review.ts'));
    expect(lines.join('\n')).toContain('...SHIPPED_AGENT_OPTIONS');
    // **The literal that used to be here is the defect**, not a style matter: it was the only place that said `true`
    // while the benchmark said `false`.
    expect(lines.filter((line) => /allowOffDiff\s*:/.test(line))).toEqual([]);
  });

  it('has the harness spread the measured arm and record what it ran', () => {
    const source = read('.github/scripts/aacr-bench.mjs');
    const lines = assignments(source).join('\n');
    expect(lines).toContain('...BASELINE_AGENT_OPTIONS');
    expect(lines.split('\n').filter((line) => /allowOffDiff\s*:/.test(line))).toEqual([]);
    // The five budget numbers used to be a second copy of `DEFAULT_AGENT_LIMITS`. A copy is a value that can move
    // without the artifact noticing, so the artifact records what ran instead.
    expect(lines).toContain('limits: { ...DEFAULT_AGENT_LIMITS }');
    expect(source).toContain('agentOptions: {');
    expect(source).toContain('divergence: [...AGENT_ARM_DIVERGENCE]');
  });
});
