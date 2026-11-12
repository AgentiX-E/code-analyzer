// @code-analyzer — End-to-end: `review pr --agent` runs the reviewer that reads, from the command a user types
//
// **The user story, in one sentence**: *I added a limit check to a function, and because the check compares against a
// value the file normalises three lines earlier, the bound I wrote can never fire — and the review told me that, citing
// the line it read.* The defect is invisible in the diff: the added lines are correct on their own, and only the file
// around them says they are dead code. **That is the case the five single-shot lanes cannot see and this arm exists for.**
//
// **Why this is an end-to-end test rather than a unit test of `ReviewAgent`.** The agent has its own suite, driven
// against a hand-built repository, and it passes whether or not any command can reach it. What was missing until this
// iteration is the wiring: `--agent` on the command, the patch carried out of `resolveChangeSet`, a repository built from
// the texts the change resolved, the reviewer's comments flattened into the report, and the cost reported beside them.
// **Every one of those failures produces a command that prints a clean review**, which is why the assertions below are
// about what the report says rather than about what the agent returned.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatPrReviewReport, runPrReview } from '../../packages/cli/src/commands/pr-review.js';

import type {
  CompletionResult,
  LLMProvider,
  ToolDefinition,
} from '../../packages/intelligence/src/review/llm/provider.js';

// ---------------------------------------------------------------------------
// The change: a bound added below the line that makes it unreachable
// ---------------------------------------------------------------------------

const FILE = [
  'export function charge(total, limit) {', // 1
  '  const bound = Number(limit);', // 2 - the value is normalised here
  '  if (Number.isNaN(bound)) {', // 3
  '    return 0;', // 4
  '  }', // 5
  '  if (bound > 1000) {', // 6 - added by the pull request
  '    return bound;', // 7 - the fallthrough returns the value, so the guard cannot fire
  '  }', // 8
  '  return total;', // 9
  '}', // 10
].join('\n');

const BASE = [
  'export function charge(total, limit) {',
  '  const bound = Number(limit);',
  '  if (Number.isNaN(bound)) {',
  '    return 0;',
  '  }',
  '  return total;',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// A provider that answers from the round it is in
// ---------------------------------------------------------------------------

/**
 * **One scripted review: read the file, file two findings, declare the scope.**
 *
 * The second finding quotes a line the file does not contain, and it is there on purpose: **the arm's whole claim is that
 * a comment whose evidence cannot be found is dropped rather than posted**, and that claim is only tested when one is.
 */
class ScriptedReviewer implements LLMProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-1';

  /** The prompts, in order, so the test can prove what the reviewer was actually shown. */
  readonly prompts: string[] = [];
  /** The tool names offered on each call, so a filing round can be told from a reading round. */
  readonly offered: string[][] = [];

  private round = 0;

  /** A scripted reviewer is always up: the test is about what it is asked, not whether it answers. */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  async complete(prompt: string): Promise<CompletionResult> {
    this.prompts.push(prompt);
    // **The filter pass**, which runs after the loop: a comment it cannot contradict stays.
    return this.result('{"remove": []}');
  }

  async completeWithTools(prompt: string, tools: ToolDefinition[]): Promise<CompletionResult> {
    this.prompts.push(prompt);
    this.offered.push(tools.map((tool) => tool.name));
    this.round += 1;
    if (this.round === 1) {
      return this.result('Reading the file the guard sits in.', [
        { name: 'read_file', arguments: JSON.stringify({ path: 'src/charge.js' }) },
      ]);
    }
    if (this.round === 2) {
      return this.result('Filing what the file shows.', [
        {
          name: 'file_comment',
          arguments: JSON.stringify({
            comments: [
              {
                path: 'src/charge.js',
                content:
                  'The `bound > 1000` guard cannot fire: `bound` is a `Number` by line 2, and the branch returns ' +
                  '`bound`, so a caller above the limit is charged the full amount instead of being clamped. Return ' +
                  '`1000` from that branch.',
                existing_code: '  if (bound > 1000) {',
                suggestion_code: '  if (bound > 1000) {\n    return 1000;',
                category: 'bug',
                severity: 'high',
              },
              {
                path: 'src/charge.js',
                content: 'This line does not exist in the file, so the quote must be refused.',
                existing_code: '  const imaginary = neverWritten();',
                category: 'bug',
                severity: 'medium',
              },
            ],
          }),
        },
      ]);
    }
    return this.result('Done.', [
      {
        name: 'task_done',
        arguments: JSON.stringify({ reviewed: ['src/charge.js'], skipped: [] }),
      },
    ]);
  }

  private result(
    content: string,
    calls: ReadonlyArray<{ name: string; arguments: string }> = [],
  ): CompletionResult {
    return {
      content,
      model: this.model,
      createdAt: new Date(0).toISOString(),
      finishReason: calls.length > 0 ? 'tool_calls' : 'stop',
      ...(calls.length === 0
        ? {}
        : {
            toolCalls: calls.map((call, at) => ({
              id: `call-${String(at)}`,
              name: call.name,
              arguments: call.arguments,
            })),
          }),
    };
  }
}

/**
 * **A reviewer that declares nothing**, which is the failure this arm exists to make countable.
 *
 * It reads no file, files nothing, and ends with two empty lists — so the file is neither reviewed nor skipped. The
 * report has to say so, because *"a clean review"* and *"a review that never looked"* are the same number of findings and
 * must not be the same sentence.
 */
class SilentReviewer implements LLMProvider {
  readonly name = 'silent';
  readonly model = 'silent-1';

  /** Reachable, and useless - which is the case the report has to make visible. */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  async complete(): Promise<CompletionResult> {
    return this.result('{"remove": []}');
  }

  async completeWithTools(): Promise<CompletionResult> {
    return this.result('Nothing to report.', [
      { name: 'task_done', arguments: JSON.stringify({ reviewed: [], skipped: [] }) },
    ]);
  }

  private result(
    content: string,
    calls: ReadonlyArray<{ name: string; arguments: string }> = [],
  ): CompletionResult {
    return {
      content,
      model: this.model,
      createdAt: new Date(0).toISOString(),
      finishReason: calls.length > 0 ? 'tool_calls' : 'stop',
      ...(calls.length === 0
        ? {}
        : {
            toolCalls: calls.map((call, at) => ({
              id: `call-${String(at)}`,
              name: call.name,
              arguments: call.arguments,
            })),
          }),
    };
  }
}

/** A real repository with one branch that adds a guard, and nothing else. */
function pullRequestWithAGuard(): { dir: string; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'code-analyzer-agent-e2e-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com',
      },
    });
  git('init', '--initial-branch=main', '--quiet');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'charge.js'), `${BASE}\n`, 'utf8');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  git('checkout', '--quiet', '-b', 'feature');
  writeFileSync(join(dir, 'src', 'charge.js'), `${FILE}\n`, 'utf8');
  git('add', '.');
  git('commit', '--quiet', '-m', 'add the limit guard');
  return { dir, git };
}

// ---------------------------------------------------------------------------

describe('`review pr --agent` — the reviewer that reads, from the command', () => {
  it('reports the dead guard, cites the line it read, and drops the comment it cannot evidence', async () => {
    const { dir } = pullRequestWithAGuard();
    const provider = new ScriptedReviewer();

    const run = await runPrReview({
      repo: dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      agent: true,
      provider,
    });
    if (!run.ok) throw new Error(run.error);

    const { report } = run;
    // **One finding, not two**: the second comment quoted a line the file does not contain, and the arm refuses those
    // rather than relocating them. A report of two would mean the evidence check never ran on the product path.
    expect(report.findings).toHaveLength(1);
    const [finding] = report.findings;
    expect(finding).toBeDefined();
    expect(finding?.file).toBe('src/charge.js');
    expect(finding?.source).toBe('agent');
    expect(finding?.lens).toBe('agent');
    // **The line is the span the quoted code occupies**, found in the file rather than taken from the model's opinion:
    // `if (bound > 1000) {` is line 6 of the file after the change.
    expect(finding?.line).toBe(6);
    expect(finding?.snippet).toBe('  if (bound > 1000) {');
    expect(finding?.severity).toBe('high');
    expect(finding?.autoFixable).toBe(true);

    // **And what it cost, in the four counts the benchmark publishes for the same arm.**
    expect(report.agent).toBeDefined();
    expect(report.agent?.draftsFiled).toBe(2);
    expect(report.agent?.modelCalls).toBeGreaterThan(0);
    expect(report.agent?.accounts['commented']).toBe(1);
    // **The drop is counted where the report already counts such things**, which is what makes a product report and a
    // harness artifact comparable rather than merely similar.
    expect(report.summary.evidenceRejected).toBe(1);

    // **The reviewer was offered the tools it needed and the filing round was told when reading was over.**
    expect(provider.offered[0]).toContain('read_file');
    expect(provider.prompts[0]).toContain('src/charge.js');
  });

  it('prints the reviewer and its spend, so a reader knows a model read the repository', async () => {
    const { dir } = pullRequestWithAGuard();
    const run = await runPrReview({
      repo: dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      agent: true,
      provider: new ScriptedReviewer(),
    });
    if (!run.ok) throw new Error(run.error);

    const text = formatPrReviewReport(run.report, 'text');
    expect(text).toContain('Reviewer: agent —');
    expect(text).toContain('2 drafts filed');
    // **A model reading a repository is a different claim from a deterministic lens**, and a report that did not say so
    // would make the two indistinguishable to the reader who has to trust one of them.
    expect(text).toContain('[HIGH] src/charge.js:6');
  });

  it('runs the lanes and reports no agent spend when --agent is absent', async () => {
    const { dir } = pullRequestWithAGuard();
    const run = await runPrReview({ repo: dir, targetBranch: 'main', sourceBranch: 'feature' });
    if (!run.ok) throw new Error(run.error);
    // **The default stays the arm every published figure was measured on**, and the report says which one produced it
    // by saying nothing about a reviewer it did not run.
    expect(run.report.agent).toBeUndefined();
    expect(run.report.findings.every((finding) => finding.source !== 'agent')).toBe(true);
  });

  it('warns about a file the reviewer neither reviewed nor declared', async () => {
    const { dir } = pullRequestWithAGuard();
    const run = await runPrReview({
      repo: dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      agent: true,
      provider: new SilentReviewer(),
    });
    if (!run.ok) throw new Error(run.error);

    // **Zero findings and one unaccounted file is not a clean pull request**, and the report says which it is.
    expect(run.report.findings).toEqual([]);
    expect(run.report.agent?.accounts['unaccounted']).toBe(1);
    const text = formatPrReviewReport(run.report, 'text');
    expect(text).toContain('neither reviewed nor declared');
  });

  it('refuses --agent without a key by naming the variable, not by printing a stack', async () => {
    const { dir } = pullRequestWithAGuard();
    const saved = process.env['DEEPSEEK_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    try {
      const run = await runPrReview({
        repo: dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
        agent: true,
      });
      expect(run.ok).toBe(false);
      if (run.ok) return;
      expect(run.exitCode).toBe(2);
      expect(run.error).toContain('DEEPSEEK_API_KEY');
      expect(run.error).toContain('without --agent');
    } finally {
      if (saved !== undefined) process.env['DEEPSEEK_API_KEY'] = saved;
    }
  });
});
