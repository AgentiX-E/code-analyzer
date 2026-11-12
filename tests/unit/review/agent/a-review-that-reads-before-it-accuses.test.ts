// A review that reads before it accuses
//
// **The four behaviours the head-to-head says we were missing**, each kept here so that a later change cannot quietly
// remove it: the agent may read the repository between rounds, a finding survives only if the code it quotes is in the
// file, every changed file ends the review with a status, and the precision pass can only remove what it can point at.
//
// **A scripted provider, not a mocked engine.** The loop, the dispatcher, the locator and the accounting are the things
// under test and all four run for real; only the model's answers are written down in advance, which is the same seam
// `--dry-run` uses for the benchmark's arithmetic.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ReviewAgent,
  groupChangedFiles,
} from '../../../../packages/intelligence/src/review/agent/review-agent.js';
import { DirectoryRepository } from '../../../../packages/intelligence/src/review/agent/repository.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
  ToolDefinition,
} from '../../../../packages/intelligence/src/review/llm/provider.js';

const DIFF_A = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' export { a, b };',
].join('\n');

const DIFF_C = [
  'diff --git a/src/c.ts b/src/c.ts',
  '--- a/src/c.ts',
  '+++ b/src/c.ts',
  '@@ -1,1 +1,2 @@',
  ' export const c = 3;',
  '+export const d = 4;',
].join('\n');

const FILE_A = ['const a = 1;', 'const b = 2;', 'export { a, b };'].join('\n');
const FILE_C = ['export const c = 3;', 'export const d = 4;'].join('\n');

type Step = (prompt: string) => Partial<CompletionResult>;

/** **A provider whose answers are a script.** It records every prompt, because the transcript is the loop's output. */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];
  private readonly steps: Step[];

  constructor(steps: Step[]) {
    this.steps = [...steps];
  }

  private next(prompt: string): CompletionResult {
    this.prompts.push(prompt);
    const step = this.steps.shift();
    const produced = step === undefined ? { content: '{}' } : step(prompt);
    return {
      content: produced.content ?? '',
      model: this.model,
      createdAt: new Date(0).toISOString(),
      finishReason: produced.finishReason ?? 'stop',
      ...(produced.toolCalls === undefined ? {} : { toolCalls: produced.toolCalls }),
    };
  }

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    return this.next(prompt);
  }

  async completeWithTools(
    prompt: string,
    _tools: ToolDefinition[],
    _options?: CompletionOptions,
  ): Promise<CompletionResult> {
    return this.next(prompt);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return {
    id: `${name}-${String(Math.random()).slice(2, 8)}`,
    name,
    arguments: JSON.stringify(args),
  };
}

function repositoryFor(files: Record<string, string>): DirectoryRepository {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text);
  }
  const changed = new Map<string, string>();
  if (files['src/a.ts'] !== undefined) changed.set('src/a.ts', DIFF_A);
  if (files['src/c.ts'] !== undefined) changed.set('src/c.ts', DIFF_C);
  return new DirectoryRepository({ root, changed });
}

describe('the agent reads the repository between rounds', () => {
  it('carries a file read into the next round’s prompt, so the quote can be copied rather than guessed', async () => {
    const provider = new ScriptedProvider([
      () => ({
        content: '- b is added but never read',
        toolCalls: [call('read_file', { path: 'src/a.ts' })],
      }),
      () => ({
        content: '',
        toolCalls: [
          call('file_comment', {
            comments: [
              {
                path: 'src/a.ts',
                content: 'b is exported but never assigned anything but a literal',
                existing_code: 'const b = 2;',
                category: 'bug',
                severity: 'medium',
              },
            ],
          }),
          call('task_done', { reviewed: ['src/a.ts'], skipped: [] }),
        ],
      }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });

    expect(provider.prompts).toHaveLength(2);
    // **The second prompt contains the tool result**, and the tool result is numbered source - the evidence the model
    // was told to use and the evidence a diff-only reviewer never had.
    expect(provider.prompts[1]).toContain('TOOL read_file ->');
    expect(provider.prompts[1]).toContain('    2| const b = 2;');
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.comments[0]?.startLine).toBe(2);
    expect(outcome.comments[0]?.existingCode).toBe('const b = 2;');
    expect(outcome.accounts).toEqual([
      { path: 'src/a.ts', status: 'commented', comments: 1, reason: null },
    ]);
    expect(outcome.ledger.modelCalls).toBe(2);
    // **Three tool calls: the read, the finding, the declaration** - and two model calls, which is the cost.
    expect(outcome.ledger.toolCalls).toBe(3);
    expect(outcome.ledger.declared?.reviewed).toEqual(['src/a.ts']);
  });

  it('keeps reviewing when a round talked instead of calling a tool', async () => {
    const provider = new ScriptedProvider([
      () => ({ content: 'I will start with the added constant.' }),
      () => ({ content: '', toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(provider.prompts[1]).toContain('I will start with the added constant.');
    expect(provider.prompts[1]).toContain('Continue with a tool call.');
    expect(outcome.comments).toEqual([]);
    expect(outcome.accounts[0]?.status).toBe('reviewed-clean');
  });

  it('takes the changed paths from the repository when the caller names none', async () => {
    const provider = new ScriptedProvider([
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: [],
    });
    expect(outcome.accounts.map((account) => account.path)).toEqual(['src/a.ts']);
  });

  it('records a round that answered with nothing at all, rather than losing the round', async () => {
    const provider = new ScriptedProvider([
      () => ({ content: '', toolCalls: [{ id: 'blank', name: 'read_file', arguments: '' }] }),
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(provider.prompts[1]).toContain('(tool calls)');
    expect(provider.prompts[1]).toContain('Error: read_file needs a path');
    expect(outcome.accounts[0]?.status).toBe('reviewed-clean');
  });

  it('keeps a suggestion with the finding, and says when a quote had to be disambiguated', async () => {
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('file_comment', {
            comments: [
              {
                path: 'src/a.ts',
                content: 'b is never read',
                existing_code: 'const a = 1;',
                suggestion_code: 'const b = readB();',
              },
            ],
          }),
          call('task_done', { reviewed: ['src/a.ts'] }),
        ],
      }),
    ]);
    const repository = repositoryFor({ 'src/a.ts': FILE_A });
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository,
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments[0]?.suggestionCode).toBe('const b = readB();');
    // **`const a = 1;` occurs once in this file**, so nothing had to be disambiguated and the ledger says zero.
    expect(outcome.ledger.disambiguated).toBe(0);
  });

  it('stops at the round budget and says so rather than running until the money is gone', async () => {
    const provider = new ScriptedProvider([
      () => ({ toolCalls: [call('read_file', { path: 'src/a.ts' })] }),
      () => ({ toolCalls: [call('read_file', { path: 'src/a.ts' })] }),
      () => ({ toolCalls: [call('read_file', { path: 'src/a.ts' })] }),
    ]);
    const outcome = await new ReviewAgent(provider, {
      filter: false,
      limits: { maxRounds: 2 },
    }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.ledger.modelCalls).toBe(2);
    expect(outcome.ledger.declared).toBeNull();
    expect(outcome.accounts[0]?.status).toBe('unaccounted');
    expect(outcome.accounts[0]?.reason).toBe('the review ended without a declaration');
    // **The refusal is recorded with its reason**, because an agent that stopped for want of budget and one that
    // finished are the same comments and different explanations.
    expect(outcome.ledger.refusals.length).toBeGreaterThan(0);
  });

  it('reviews a directory per call and merges what each call declared', async () => {
    const provider = new ScriptedProvider([
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/c.ts'], skipped: [] })] }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A, 'src/c.ts': FILE_C }),
      changedPaths: ['src/a.ts', 'src/c.ts'],
    });
    // **Two files in one directory are one group**, so one call - and the second scripted step is never used.
    expect(outcome.ledger.groups).toBe(1);
    expect(outcome.ledger.declared?.reviewed).toEqual(['src/a.ts']);
    expect(outcome.accounts.map((account) => account.status)).toEqual([
      'reviewed-clean',
      'unaccounted',
    ]);
    expect(outcome.accounts[1]?.reason).toBe('named in neither list');
  });
});

describe('the loop survives a model that answers in the wrong shape', () => {
  it('treats arguments that are not JSON as an empty call rather than losing the round', async () => {
    const provider = new ScriptedProvider([
      () => ({ toolCalls: [{ id: 'bad', name: 'read_file', arguments: '{"path": ' }] }),
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(provider.prompts[1]).toContain('Error: read_file needs a path');
    expect(outcome.accounts[0]?.status).toBe('reviewed-clean');
  });

  it('merges the declarations of two groups, keeping the first reason for a file both skipped', async () => {
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('task_done', {
            reviewed: ['src/a.ts'],
            skipped: [{ path: 'docs/x.md', reason: 'generated' }],
          }),
        ],
      }),
      () => ({
        toolCalls: [
          call('task_done', {
            reviewed: ['lib/b.ts'],
            skipped: [
              { path: 'docs/x.md', reason: 'a second reason' },
              { path: 'lib/c.ts', reason: 'config' },
            ],
          }),
        ],
      }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({
        'src/a.ts': FILE_A,
        'lib/b.ts': 'export const b = 1;',
        'lib/c.ts': 'export {};',
      }),
      changedPaths: ['src/a.ts', 'lib/b.ts', 'lib/c.ts'],
    });
    expect(outcome.ledger.groups).toBe(2);
    expect(outcome.ledger.declared?.reviewed.sort()).toEqual(['lib/b.ts', 'src/a.ts']);
    expect(outcome.ledger.declared?.skipped.map((entry) => entry.reason).sort()).toEqual([
      'a second reason'.replace('a second reason', 'config'),
      'generated',
    ]);
  });
});

describe('a finding survives only if the code it quotes is in the file', () => {
  const quoteMiss = () =>
    ({
      content: '',
      toolCalls: [
        call('file_comment', {
          comments: [
            { path: 'src/a.ts', content: 'a is never used', existing_code: 'const a = 0;' },
            { path: 'src/a.ts', content: 'b is unused', existing_code: 'const b = 2;' },
          ],
        }),
        call('task_done', { reviewed: ['src/a.ts'] }),
      ],
    }) satisfies Partial<CompletionResult>;

  it('drops the finding whose quote is not in the file and keeps the one whose quote is', async () => {
    const outcome = await new ReviewAgent(new ScriptedProvider([quoteMiss]), {
      filter: false,
    }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.comments[0]?.content).toBe('b is unused');
    expect(outcome.drops).toHaveLength(1);
    expect(outcome.drops[0]?.reason).toBe('snippet-not-found');
    expect(outcome.drops[0]?.detail).toBe('the quoted code is not in src/a.ts');
  });

  it('locates a quote against the diff when the file could not be read', async () => {
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('file_comment', {
            comments: [{ path: 'src/a.ts', content: 'b is unused', existing_code: 'const b = 2;' }],
          }),
          call('task_done', { reviewed: ['src/a.ts'] }),
        ],
      }),
    ]);
    // **A repository whose changed file is not on disk**: the diff is the only source, and a quote of an added line
    // still resolves - which is the case a deleted-then-added file produces.
    const root = mkdtempSync(join(tmpdir(), 'agent-diff-only-'));
    const repository = new DirectoryRepository({ root, changed: new Map([['src/a.ts', DIFF_A]]) });
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository,
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments[0]?.startLine).toBe(2);
    expect(outcome.ledger.groundingReads).toBeGreaterThan(0);
  });

  it('keeps one finding per defect, and the per-file ceiling holds the rest', async () => {
    const many = Array.from({ length: 3 }, (_, at) => ({
      path: 'src/a.ts',
      content: `duplicate claim ${String(at)}`,
      existing_code: 'const b = 2;',
    }));
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('file_comment', { comments: many }),
          call('task_done', { reviewed: ['src/a.ts'] }),
        ],
      }),
    ]);
    const outcome = await new ReviewAgent(provider, {
      filter: false,
      maxFindingsPerFile: 1,
    }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.drops.map((drop) => drop.reason)).toEqual(['over-budget', 'over-budget']);
  });

  it('refuses a duplicate at the same line and category', async () => {
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('file_comment', {
            comments: [
              {
                path: 'src/a.ts',
                content: 'first',
                existing_code: 'const b = 2;',
                category: 'bug',
              },
              {
                path: 'src/a.ts',
                content: 'second',
                existing_code: 'const b = 2;',
                category: 'bug',
              },
            ],
          }),
          call('task_done', { reviewed: ['src/a.ts'] }),
        ],
      }),
    ]);
    const outcome = await new ReviewAgent(provider, { filter: false }).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.drops[0]?.reason).toBe('duplicate');
    expect(outcome.drops[0]?.detail).toContain('already at line 2');
  });

  it('allows a finding on an untouched file only when it was asked to', async () => {
    const fileComment = () => ({
      toolCalls: [
        call('file_comment', {
          comments: [
            {
              path: 'src/c.ts',
              content: 'd is shadowed elsewhere',
              existing_code: 'export const d = 4;',
            },
          ],
        }),
        call('task_done', { reviewed: ['src/a.ts'] }),
      ],
    });
    const files = { 'src/a.ts': FILE_A, 'src/c.ts': FILE_C };
    const allowed = await new ReviewAgent(new ScriptedProvider([fileComment]), {
      filter: false,
    }).review({
      repository: repositoryFor(files),
      changedPaths: ['src/a.ts'],
    });
    expect(allowed.comments).toHaveLength(1);
    // **`src/c.ts` is not a changed path here**, so its account is not in the list - the accounts follow the change.
    expect(allowed.accounts.map((account) => account.path)).toEqual(['src/a.ts']);

    const refused = await new ReviewAgent(new ScriptedProvider([fileComment]), {
      filter: false,
      allowOffDiff: false,
    }).review({ repository: repositoryFor(files), changedPaths: ['src/a.ts'] });
    expect(refused.comments).toEqual([]);
    expect(refused.drops[0]?.reason).toBe('off-diff');
  });
});

describe('the precision pass can only remove what it can point at', () => {
  const oneComment = () => ({
    toolCalls: [
      call('file_comment', {
        comments: [{ path: 'src/a.ts', content: 'b is unused', existing_code: 'const b = 2;' }],
      }),
      call('task_done', { reviewed: ['src/a.ts'] }),
    ],
  });

  it('removes a comment when the filter names the line that contradicts it', async () => {
    const provider = new ScriptedProvider([
      oneComment,
      () => ({ content: '{"remove": [{"index": 0, "line": "+const b = 2;"}]}' }),
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toEqual([]);
    expect(outcome.ledger.filtered).toBe(1);
    expect(outcome.drops[0]?.reason).toBe('filtered');
  });

  it('keeps a comment when the filter named an index but no contradicting line', async () => {
    const provider = new ScriptedProvider([
      oneComment,
      () => ({ content: '{"remove": [{"index": 0}]}' }),
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.ledger.filtered).toBe(0);
  });

  it('keeps everything when the filter answered prose, answered about nothing, or did not answer', async () => {
    for (const answer of [
      () => ({ content: 'I removed the doubtful one.' }),
      () => ({ content: '{"remove": [{"index": 9, "line": "x"}, "nonsense"]}' }),
      () => ({ content: '{"remove": []}' }),
      () => ({ content: '{"remove": [{"index": -1, "line": "+const b = 2;"}]}' }),
    ]) {
      const outcome = await new ReviewAgent(new ScriptedProvider([oneComment, answer])).review({
        repository: repositoryFor({ 'src/a.ts': FILE_A }),
        changedPaths: ['src/a.ts'],
      });
      expect(outcome.comments).toHaveLength(1);
      expect(outcome.ledger.filtered).toBe(0);
    }
  });

  it('keeps everything when the filter answered something that begins like JSON and is not', async () => {
    const provider = new ScriptedProvider([oneComment, () => ({ content: '{remove: [not json}' })]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.ledger.filtered).toBe(0);
  });

  it('keeps everything when the filter answered with a removal list that is not a list', async () => {
    const provider = new ScriptedProvider([
      oneComment,
      () => ({ content: '{"remove": "all of them"}' }),
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.ledger.filtered).toBe(0);
  });

  it('ignores an index that arrived as a string, because a filter that cannot count cannot point', async () => {
    const provider = new ScriptedProvider([
      oneComment,
      () => ({ content: '{"remove": [{"index": "0", "line": "+const b = 2;"}]}' }),
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.ledger.filtered).toBe(0);
  });

  it('tells the filter that a comment is on a file this change did not touch', async () => {
    const provider = new ScriptedProvider([
      () => ({
        toolCalls: [
          call('file_comment', {
            comments: [
              {
                path: 'src/c.ts',
                content: 'd is never used',
                existing_code: 'export const d = 4;',
              },
            ],
          }),
          call('task_done', { reviewed: ['src/a.ts'] }),
        ],
      }),
      () => ({ content: '{"remove": []}' }),
    ]);
    const repository = repositoryFor({ 'src/a.ts': FILE_A, 'src/c.ts': FILE_C });
    // **`src/c.ts` is on disk and not in the change**, which is the case the filter has to be told about: a comment that
    // names a file the diff does not contain cannot be checked against it.
    const changedOnlyA = new (repository.constructor as typeof DirectoryRepository)({
      root: (repository as unknown as { root: string }).root,
      changed: new Map([['src/a.ts', DIFF_A]]),
    });
    const outcome = await new ReviewAgent(provider, { allowOffDiff: true }).review({
      repository: changedOnlyA,
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(provider.prompts[1]).toContain('(not changed)');
  });

  it('keeps everything when the filter call threw, and says the count is zero rather than pretending', async () => {
    const provider = new ScriptedProvider([
      oneComment,
      () => {
        throw new Error('the provider refused');
      },
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.comments).toHaveLength(1);
    expect(outcome.ledger.filtered).toBe(0);
  });

  it('is skipped entirely when there is nothing to filter', async () => {
    const provider = new ScriptedProvider([
      () => ({ toolCalls: [call('task_done', { reviewed: ['src/a.ts'] })] }),
    ]);
    const outcome = await new ReviewAgent(provider).review({
      repository: repositoryFor({ 'src/a.ts': FILE_A }),
      changedPaths: ['src/a.ts'],
    });
    expect(outcome.ledger.modelCalls).toBe(1);
    expect(outcome.ledger.filtered).toBe(0);
  });
});

describe('grouping is deterministic, so the benchmark is reproducible', () => {
  it('groups by directory, in path order, capped at the group size', () => {
    // **`.` sorts before `a`**, so a file at the root is its own group first - the order is the directory's, not the
    // file's, which is what makes the same input produce the same groups twice.
    expect(groupChangedFiles(['b/x.ts', 'a/y.ts', 'a/z.ts', 'root.ts'], 2)).toEqual([
      ['root.ts'],
      ['a/y.ts', 'a/z.ts'],
      ['b/x.ts'],
    ]);
    // **A cap of one is one group per file**, and one above ten is ten - the ceiling their grouping prompt sets.
    expect(groupChangedFiles(['a/1.ts', 'a/2.ts'], 1)).toEqual([['a/1.ts'], ['a/2.ts']]);
    expect(groupChangedFiles(['a/1.ts', 'a/2.ts'], 99)).toEqual([['a/1.ts', 'a/2.ts']]);
    expect(groupChangedFiles([], 4)).toEqual([]);
  });
});
