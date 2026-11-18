// @code-analyzer/intelligence — a finding on a line the change did not touch has no standing
//
// §78 bought 6 000 characters of surrounding context per claim and moved F1 by −0.0022, because the pool's problem was
// never that the reader saw too little - it was that findings were standing on hunks that changed nothing a compiler
// would see. `change-shape` decides that from the diff; this file is the gate's use of the decision.
//
// **The three things it must not do.** It must not drop when the caller said nothing (an absent decision is not a
// permissive one, and it is not a restrictive one either). It must not spend a model call to learn what the diff
// already said. And it must not drop a finding that overlaps a novel line even by one line, because a finding that
// spans the change is a finding about the change.

import { describe, expect, it } from 'vitest';

import { FalsifierGate } from '../../review/adjudication/falsifier.js';
import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';
import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type { CompletionOptions, CompletionResult, LLMProvider } from '../../review/llm/provider.js';

/** Three added lines on 11, 12 and 13. */
const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -8,4 +8,7 @@',
  ' const a = 1;',
  ' const b = 2;',
  ' const c = 3;',
  '-const d = 4;',
  '+const d = 4 * 2;',
  '+if (a < 0) {',
  '+  throw new Error("bad");',
  ' return d;',
].join('\n');

const ADDED = numberedAddedLines(PATCH)!;

function finding(title: string, startLine: number, endLine = startLine): LLMFinding {
  return {
    startLine,
    endLine,
    severity: 'high',
    category: 'bug',
    title,
    description: `${title}.`,
    suggestion: null,
  };
}

class ScriptedFalsifier implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  calls = 0;
  readonly prompts: string[] = [];

  constructor(private readonly answers: ReadonlyArray<string> = []) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    const at = this.calls;
    this.calls += 1;
    this.prompts.push(prompt);
    return {
      content: this.answers[at] ?? '{"refuted":[]}',
      model: this.model,
      createdAt: new Date().toISOString(),
      finishReason: 'stop',
    };
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('no tools here');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('a gate told which lines are novel', () => {
  it('drops a finding on a line the change did not touch, without asking the model', async () => {
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('the constant is wrong', 9)],
      addedLines: ADDED,
      novelLines: new Set([12, 13]),
    });

    expect(provider.calls).toBe(0);
    expect(outcome.kept).toEqual([]);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]?.reason).toContain('no line this change touched');
    expect(outcome.report.droppedBecauseNotNovel).toBe(1);
    expect(outcome.report.dropped).toBe(1);
  });

  it('keeps a finding that spans a novel line even when it starts outside', async () => {
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('the guard is inverted', 11, 13)],
      addedLines: ADDED,
      novelLines: new Set([12]),
    });

    expect(provider.calls).toBe(1);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.report.droppedBecauseNotNovel).toBe(0);
  });

  it('asks about the survivors and leaves the untouched ones out of the prompt', async () => {
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [
        finding('kept, on the change', 12),
        finding('dropped, far above it', 2),
        finding('dropped, far below it', 40),
      ],
      addedLines: ADDED,
      novelLines: new Set([12]),
    });

    expect(provider.calls).toBe(1);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]?.title).toBe('kept, on the change');
    expect(outcome.report.droppedBecauseNotNovel).toBe(2);
    // The prompt is the instrument: a dropped claim must not appear in it, or the reader was still paid to read it.
    expect(provider.prompts[0]).toContain('kept, on the change');
    expect(provider.prompts[0]).not.toContain('dropped, far above it');
  });

  it('spends nothing at all when no finding stands on a novel line', async () => {
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('one', 2), finding('two', 40)],
      addedLines: ADDED,
      novelLines: new Set([12]),
    });

    expect(provider.calls).toBe(0);
    expect(outcome.kept).toEqual([]);
    expect(outcome.report.calls).toBe(0);
    expect(outcome.report.droppedBecauseNotNovel).toBe(2);
  });

  it('drops everything when the set is empty, which is a decision and not an absence', async () => {
    // **An empty set says the change added nothing.** Treating it as "no information" would make a pure reformat the
    // one case the gate cannot see, which is the case this device exists for.
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('one', 12)],
      addedLines: ADDED,
      novelLines: new Set(),
    });

    expect(provider.calls).toBe(0);
    expect(outcome.kept).toEqual([]);
    expect(outcome.report.droppedBecauseNotNovel).toBe(1);
  });

  it('behaves exactly as before when the caller supplies no set at all', async () => {
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('one', 2), finding('two', 12)],
      addedLines: ADDED,
    });

    expect(provider.calls).toBe(1);
    expect(outcome.kept).toHaveLength(2);
    expect(outcome.report.droppedBecauseNotNovel).toBe(0);
  });

  it('never filters a file whose text is not a patch', async () => {
    // `addedLines === null` is already the "cannot verify" path, and it keeps everything. The shape must not turn it
    // into a dropping path through the back door.
    const provider = new ScriptedFalsifier();
    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.ts',
      findings: [finding('one', 2)],
      addedLines: null,
      novelLines: new Set<number>(),
    });

    expect(provider.calls).toBe(0);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.report.droppedBecauseNotNovel).toBe(0);
  });
});

describe('the engine carries the decision to the gate', () => {
  const ENGINE_PATCH = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -8,4 +8,7 @@',
    ' const a = 1;',
    ' const b = 2;',
    ' const c = 3;',
    '-const d = 4;',
    '+const d = 4 * 2;',
    '+if (a < 0) {',
    '+  throw new Error("bad");',
    ' return d;',
  ].join('\n');

  const DIFF = {
    filePath: 'src/a.ts',
    oldHash: '',
    newHash: '',
    ranges: [{ oldStart: 8, oldEnd: 11, newStart: 8, newEnd: 11, changeType: 'modified' as const }],
    changeType: 'modified' as const,
  };

  it('drops the finding the diff refutes and keeps the one on the change, in one lane', async () => {
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        findings: [
          finding('the guard inverts the comparison', 12),
          finding('zebra quartz handshake', 11),
        ],
      }),
    ]);
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      parallel: false,
      falsify: 'independent-evidence-v2',
      novelLinesOf: (path: string) => (path === 'src/a.ts' ? new Set([12, 13]) : undefined),
    });

    const results = await engine.reviewDiff(DIFF, ENGINE_PATCH);
    const titles = results.flatMap((result) => result.findings.map((item) => item.title));

    expect(titles).toContain('the guard inverts the comparison');
    expect(titles).not.toContain('zebra quartz handshake');
    expect(engine.lastFalsifier?.report.droppedBecauseNotNovel).toBe(1);
  });

  it('leaves the gate untouched when no shape was computed', async () => {
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        findings: [
          finding('the guard inverts the comparison', 12),
          finding('zebra quartz handshake', 11),
        ],
      }),
    ]);
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      parallel: false,
      falsify: 'independent-evidence-v2',
    });

    const results = await engine.reviewDiff(DIFF, ENGINE_PATCH);
    const titles = results.flatMap((result) => result.findings.map((item) => item.title));

    expect(titles).toHaveLength(2);
    expect(engine.lastFalsifier?.report.droppedBecauseNotNovel).toBe(0);
  });
});
