// @code-analyzer/intelligence — the pass says why it kept the sentence, and about which name it asked
//
// **What §170 could not report.** The run rewrote twenty comments and one of them was a plan entry. The report carried
// `kept` as a pooled tally over the whole pass, so once a comment was summed into `agree 93` nobody could say which
// comment that was - and the campaign's open question (`§170.4`: does the pass decline, or does it fail?) needed exactly
// that join. An attribution that cannot be attached to a comment is an attribution of the run, not of the entries the
// acceptance is stated over.
//
// **So the pass now reports one outcome per finding**, addressed by the position it was handed, and counts the anchor
// question three ways: the name the caller handed over (`handed`), a name the sentence reached a backtick for when no
// caller named one (`own`), and a handed name the sentence does not write (`fallback`) - the case §170.5 found nine times
// by joining two files by hand, and which this pass can now state about itself.
//
// **What is being pinned here is arithmetic, not prose.** Every path out of the pass has its own test, because a reason
// that is counted for one comment and lost for the next is worse than no reason at all: it reads as a denominator.

import { describe, expect, it } from 'vitest';

import {
  RELATED_NAMES_CONTRACT,
  SymbolCrosscheck,
  type CrosscheckReport,
  type TwoSidedFinding,
} from '../symbol-crosscheck.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../llm/provider.js';

/** Two sides of one call, in the shape the prompt numbers them. */
const LINES = [
  '214| export function getForLogin(organizationId: string, realm: string) {',
  '215|   const key = cacheKey(realm, organizationId);',
  '216|   return cache.get(key);',
  '217| }',
];

const COMMENT =
  '`getForLogin` is handed `organizationId` but computes its cache key from `realm` and `organizationId`.';

const finding = (overrides: Partial<TwoSidedFinding> = {}): TwoSidedFinding => ({
  path: 'src/auth/login.ts',
  startLine: 215,
  description: COMMENT,
  pr: 'o/r#1',
  ...overrides,
});

/** A provider that answers from a table, and is a real provider while it does it: only the network is replaced. */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];
  private readonly answers: string[];
  private readonly failure: Error | null;

  constructor(answers: string[], failure: Error | null = null) {
    this.answers = answers;
    this.failure = failure;
  }

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    if (this.failure !== null) throw this.failure;
    const answer = this.answers[Math.min(this.prompts.length - 1, this.answers.length - 1)] ?? '';
    return {
      content: answer,
      model: this.model,
      createdAt: '2026-11-27T00:00:00.000Z',
      finishReason: 'stop',
      costUsd: 0.0004,
    };
  }

  async completeWithTools(prompt: string): Promise<CompletionResult> {
    return this.complete(prompt);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

const withQuote = (answer: Record<string, unknown>): string =>
  JSON.stringify({
    left: {
      line: 214,
      quote: 'export function getForLogin(organizationId: string, realm: string) {',
    },
    right: { line: 215, quote: 'const key = cacheKey(realm, organizationId);' },
    ...answer,
  });

const REWRITE =
  '`getForLogin` takes `organizationId` and builds its cache key from `realm` and `organizationId`: two realms share an entry.';

/** One pass over one comment, so a test states only the thing it is about. */
async function onePass(
  provider: LLMProvider,
  options: { anchor?: string; maxPerPullRequest?: number; maxCalls?: number } = {},
): Promise<{ report: CrosscheckReport; findings: TwoSidedFinding[] }> {
  const pass = new SymbolCrosscheck(provider, {
    contract: RELATED_NAMES_CONTRACT,
    maxSymbolsPerComment: 1,
    ...(options.maxPerPullRequest === undefined
      ? {}
      : { maxPerPullRequest: options.maxPerPullRequest }),
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
  });
  const said = finding(options.anchor === undefined ? {} : { anchor: options.anchor });
  const { findings, report } = await pass.run([said], () => LINES);
  return { report, findings };
}

describe('the pass says why it kept the sentence', () => {
  it('reports one outcome per finding, addressed by the position it was handed', async () => {
    const { report } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]));
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.index).toBe(0);
    // **The key is the pair, not the comment**, because the pair is what was asked and a record that filed the outcome
    // under the comment would have to re-derive the question to say what the answer was about.
    expect(report.outcomes[0]?.key).toBe('getForLogin→organizationId');
  });

  it('says `rewritten` when the sentence changed, and the index is the finding that changed', async () => {
    const { report, findings } = await onePass(
      new ScriptedProvider([withQuote({ agree: 'no', rewrite: REWRITE })]),
    );
    expect(report.outcomes[0]).toEqual({
      index: 0,
      key: 'getForLogin→organizationId',
      reason: 'rewritten',
    });
    expect(findings[0]?.description).toBe(REWRITE);
  });

  it('says `agree` when the two quoted lines agree, which is the largest refusal in the published run', async () => {
    const { report, findings } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]));
    expect(report.outcomes[0]?.reason).toBe('agree');
    expect(findings[0]?.description).toBe(COMMENT);
  });

  it('says `cannot` rather than inventing a reason out of an unquoted pair', async () => {
    const { report } = await onePass(
      new ScriptedProvider([withQuote({ agree: 'cannot', rewrite: null })]),
    );
    expect(report.outcomes[0]?.reason).toBe('cannot');
  });

  it('says `unreadable` when the answer is not a verdict, and keeps the sentence', async () => {
    const { report, findings } = await onePass(new ScriptedProvider(['I would rather not.']));
    expect(report.outcomes[0]?.reason).toBe('unreadable');
    expect(findings[0]?.description).toBe(COMMENT);
    expect(report.kept['unreadable']).toBe(1);
  });

  it('says `failed` when the provider throws, and the run continues rather than reporting a lower recall', async () => {
    const { report, findings } = await onePass(
      new ScriptedProvider([withQuote({ agree: 'yes' })], new Error('502')),
    );
    expect(report.outcomes[0]?.reason).toBe('failed');
    expect(findings).toHaveLength(1);
    expect(report.failed).toBe(1);
  });

  it('says `no-evidence` for a comment with no lines, and does not buy a call for it', async () => {
    const provider = new ScriptedProvider([withQuote({ agree: 'yes' })]);
    const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
    const { report } = await pass.run([finding()], () => []);
    expect(report.outcomes[0]).toEqual({ index: 0, key: null, reason: 'no-evidence' });
    expect(provider.prompts).toHaveLength(0);
  });

  it('says `no-symbol` for a comment that names one name, which is the three entries §170 could not ask', async () => {
    const provider = new ScriptedProvider([withQuote({ agree: 'yes' })]);
    const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
    const { report } = await pass.run(
      [finding({ description: '`getForLogin` is slow.' })],
      () => LINES,
    );
    expect(report.outcomes[0]).toEqual({ index: 0, key: null, reason: 'no-symbol' });
    expect(provider.prompts).toHaveLength(0);
  });

  it('says `budget` when the pass stops before the call, because a cap that reads as a refusal is a lie', async () => {
    const { report } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]), {
      maxCalls: 0,
    });
    expect(report.outcomes[0]?.reason).toBe('budget');
    expect(report.budgetExhausted).toBe(true);
  });

  it('says `pull-request-cap` when one diff has had its share of the bill', async () => {
    const pass = new SymbolCrosscheck(new ScriptedProvider([withQuote({ agree: 'yes' })]), {
      contract: RELATED_NAMES_CONTRACT,
      maxSymbolsPerComment: 1,
      maxPerPullRequest: 1,
    });
    const { report } = await pass.run([finding(), finding()], () => LINES);
    // **The second comment is refused before it is asked**, which is the difference between a cap and a budget: the cap
    // belongs to the diff and the refusal is written on the comment that met it.
    expect(report.outcomes.map((outcome) => outcome.reason)).toEqual(['agree', 'pull-request-cap']);
    expect(report.called).toBe(1);
  });

  it('reports the reason of the question that stopped the comment, not the first one it met', async () => {
    const pass = new SymbolCrosscheck(
      new ScriptedProvider([
        withQuote({ agree: 'yes' }),
        withQuote({ agree: 'cannot', rewrite: null }),
      ]),
      { contract: RELATED_NAMES_CONTRACT, maxSymbolsPerComment: 2 },
    );
    const { report } = await pass.run([finding()], () => LINES);
    // Two questions, neither of which rewrote: the pass read both and the last refusal is what the comment's outcome is.
    expect(report.called).toBe(2);
    expect(report.outcomes[0]?.reason).toBe('cannot');
  });
});

describe('the pass says which name the pair question was put to', () => {
  it('counts a handed anchor as `handed` when the sentence writes it', async () => {
    const { report } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]), {
      anchor: 'organizationId',
    });
    expect(report.anchors).toEqual({ handed: 1, own: 0, fallback: 0 });
    expect(report.outcomes[0]?.key).toBe('organizationId→getForLogin');
  });

  it('counts `own` when no anchor was handed over, which is most of a board', async () => {
    const { report } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]));
    expect(report.anchors).toEqual({ handed: 0, own: 1, fallback: 0 });
  });

  it('counts `fallback` when the handed name is not in the sentence - the defect §170.5 found by hand, stated by the pass', async () => {
    const { report } = await onePass(new ScriptedProvider([withQuote({ agree: 'yes' })]), {
      anchor: 'shortcut',
    });
    expect(report.anchors).toEqual({ handed: 0, own: 0, fallback: 1 });
    // **The question went to the sentence's own first name**, so the answer is about `getForLogin` and the record says
    // so instead of leaving a reader to infer it from a symbol it never asked about.
    expect(report.outcomes[0]?.key).toBe('getForLogin→organizationId');
  });

  it('leaves the three counts at zero under the first contract, which asks about a name and not a pair', async () => {
    const pass = new SymbolCrosscheck(new ScriptedProvider([withQuote({ agree: 'yes' })]), {
      contract: 'two-sides-v1',
    });
    const { report } = await pass.run([finding()], () => LINES);
    expect(report.anchors).toEqual({ handed: 0, own: 0, fallback: 0 });
  });

  it('counts per question, not per comment, so two questions are two anchors', async () => {
    const pass = new SymbolCrosscheck(
      new ScriptedProvider([withQuote({ agree: 'yes' }), withQuote({ agree: 'yes' })]),
      { contract: RELATED_NAMES_CONTRACT, maxSymbolsPerComment: 2 },
    );
    const { report } = await pass.run([finding({ anchor: 'getForLogin' })], () => LINES);
    expect(report.anchors.handed).toBe(report.called);
    expect(report.outcomes).toHaveLength(1);
  });
});
