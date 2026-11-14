// @code-analyzer/intelligence — the claim-checking pass, against a provider that answers as told
//
// **What a scripted provider is doing in a test that claims not to mock its subject.** The subject here is the pass: the
// prompt it builds, the decision it applies to each answer, the counting, the ordering and what happens when the call
// fails. **None of that lives in the provider**, which is a network boundary - and a test that called a real endpoint
// would be measuring the endpoint's mood as well as this class's logic, on a suite that has to run on every push. The
// provider below is a transport double, and every assertion is about code this repository owns.
//
// **The failure cases are the point of the file.** A dropped finding and a kept one are both plausible outcomes; a pass
// that deletes a true positive because the network blinked is a pass that reports a perfect precision on a bad day.

import { describe, it, expect } from 'vitest';

import { ClaimAdjudicator, oneLine } from '../../review/adjudication/adjudicator.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';

// ---------------------------------------------------------------------------
// A provider that answers from a table, and remembers what it was asked
// ---------------------------------------------------------------------------

interface Answer {
  /** Throw instead of answering, to stand in for a network or quota failure. */
  fail?: boolean;
  /** The content to return. Ignored when `fail` is set. */
  content?: string;
}

class ScriptedProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  readonly prompts: string[] = [];
  readonly options: Array<CompletionOptions | undefined> = [];
  private inFlight = 0;
  /** The most calls that were ever in flight at once, which is what a concurrency bound has to be measured on. */
  peakInFlight = 0;

  constructor(private readonly answers: Answer[] | ((prompt: string) => Answer)) {}

  private answerFor(prompt: string, at: number): Answer {
    if (typeof this.answers === 'function') return this.answers(prompt);
    return this.answers[at] ?? { content: '{"verdict":"upheld","reason":"default"}' };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const at = this.prompts.length;
    this.prompts.push(prompt);
    this.options.push(options);
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      // **A yield, so the concurrency bound is observable at all.** Without it every call resolves in the same tick and
      // a pass with no bound would look identical to one with a bound of four.
      await Promise.resolve();
      const answer = this.answerFor(prompt, at);
      if (answer.fail === true) throw new Error('provider is down');
      return {
        content: answer.content ?? '{"verdict":"upheld","reason":"default"}',
        model: this.model,
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  async completeWithTools(): Promise<CompletionResult> {
    throw new Error('the adjudicator does not call tools');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function finding(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 11,
    endLine: 11,
    severity: 'medium',
    category: 'bug',
    title: 'the claim',
    description: 'the description',
    suggestion: null,
    ...overrides,
  };
}

const ADDED = new Set([11, 12, 13]);

function candidate(overrides: Partial<LLMFinding> = {}) {
  return {
    finding: finding(overrides),
    addedCode: '@@ -10,3 +10,3 @@\n+const a = 1;',
    addedLines: ADDED,
  };
}

describe('ClaimAdjudicator', () => {
  it('files an upheld finding and counts it', async () => {
    const provider = new ScriptedProvider([
      { content: '{"verdict":"upheld","line":12,"reason":"the guard is absent"}' },
    ]);
    const adjudicator = new ClaimAdjudicator(provider);
    const outcome = await adjudicator.adjudicate([candidate()], { path: 'src/a.ts' });

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]!.finding).toMatchObject({ startLine: 12, endLine: 12 });
    expect(outcome.dropped).toEqual([]);
    expect(outcome.report).toEqual({
      candidates: 1,
      upheld: 1,
      repaired: 0,
      refuted: 0,
      unanchored: 0,
      unchecked: 0,
      calls: 1,
      unreadable: 0,
    });
  });

  it('drops a refuted finding and keeps the reason', async () => {
    const provider = new ScriptedProvider([
      { content: '{"verdict":"refuted","reason":"the guard is at line 9"}' },
    ]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate([candidate()], {
      path: 'src/a.ts',
    });

    expect(outcome.kept).toEqual([]);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.finding.title).toBe('the claim');
    expect(outcome.dropped[0]).toMatchObject({
      index: 0,
      why: 'refuted',
      reason: 'the guard is at line 9',
    });
    expect(outcome.report.refuted).toBe(1);
  });

  it('counts a repair separately from an uphold', async () => {
    const provider = new ScriptedProvider([
      {
        content: JSON.stringify({
          verdict: 'repaired',
          line: 11,
          reason: 'the defect here is the unchecked index',
          title: 'index past the end',
          description: 'The size comes from the header and is never compared with the buffer.',
        }),
      },
    ]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate([candidate()], {
      path: 'src/a.ts',
    });

    expect(outcome.kept[0]!.finding).toMatchObject({ title: 'index past the end', repaired: true });
    expect(outcome.report).toMatchObject({ repaired: 1, upheld: 0 });
  });

  it('counts an unanchorable comment apart from a refuted one', async () => {
    const provider = new ScriptedProvider([
      { content: '{"verdict":"upheld","line":900,"reason":"looks right"}' },
    ]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate(
      [{ finding: finding({ startLine: 900, endLine: 901 }), addedCode: '', addedLines: ADDED }],
      { path: 'src/a.ts' },
    );
    expect(outcome.report).toMatchObject({ unanchored: 1, refuted: 0, calls: 1 });
    expect(outcome.dropped[0]!.why).toBe('unanchored');
  });

  it('files the comment when the call fails, and says the check did not run', async () => {
    // **Open, not closed.** A provider outage that deleted every finding would report a reviewer with perfect precision
    // and no recall, and the two causes have opposite repairs.
    const provider = new ScriptedProvider([{ fail: true }]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate([candidate()], {
      path: 'src/a.ts',
    });

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]!.finding).toMatchObject({ startLine: 11, endLine: 11 });
    expect(outcome.report).toMatchObject({ unchecked: 1, calls: 0, refuted: 0 });
  });

  it('files the comment when the answer cannot be read, and counts it apart from a refutation', async () => {
    const provider = new ScriptedProvider([{ content: 'This looks fine to me.' }]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate([candidate()], {
      path: 'src/a.ts',
    });

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.report).toMatchObject({ unchecked: 1, unreadable: 1, refuted: 0 });
  });

  it('drops a finding whose check failed and whose range is not on an added line', async () => {
    // The one case where failing open would file a comment on a line the diff never touched.
    const provider = new ScriptedProvider([{ fail: true }]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate(
      [{ finding: finding({ startLine: 900, endLine: 901 }), addedCode: '', addedLines: ADDED }],
      { path: 'src/a.ts' },
    );
    expect(outcome.kept).toEqual([]);
    expect(outcome.report).toMatchObject({ unchecked: 1, unanchored: 1 });
  });

  it('returns survivors in candidate order, with the index each came from', async () => {
    // **The index is the whole point**: a refutation in the middle shifts every later position, and a caller that zipped
    // a filtered list back onto its originals by position would attribute a repair to the wrong finding.
    const verdicts = [
      '{"verdict":"refuted","reason":"restates the diff"}',
      '{"verdict":"upheld","reason":"holds"}',
      '{"verdict":"refuted","reason":"no input reaches it"}',
      '{"verdict":"upheld","reason":"holds"}',
    ];
    const provider = new ScriptedProvider(verdicts.map((content) => ({ content })));
    const outcome = await new ClaimAdjudicator(provider, { concurrency: 1 }).adjudicate(
      [
        candidate({ title: 'first' }),
        candidate({ title: 'second' }),
        candidate({ title: 'third' }),
        candidate({ title: 'fourth' }),
      ],
      { path: 'src/a.ts' },
    );

    expect(outcome.kept.map((entry) => entry.index)).toEqual([1, 3]);
    expect(outcome.kept.map((entry) => entry.finding.title)).toEqual(['second', 'fourth']);
    expect(outcome.dropped.map((entry) => entry.index)).toEqual([0, 2]);
  });

  it('bounds how many calls are in flight at once', async () => {
    const provider = new ScriptedProvider(() => ({
      content: '{"verdict":"upheld","reason":"holds"}',
    }));
    const candidates = Array.from({ length: 12 }, (_unused, at) => candidate({ title: `f${at}` }));
    await new ClaimAdjudicator(provider, { concurrency: 3 }).adjudicate(candidates, {
      path: 'src/a.ts',
    });
    expect(provider.peakInFlight).toBeLessThanOrEqual(3);
    expect(provider.peakInFlight).toBeGreaterThan(1);
  });

  it('makes no call for an empty candidate list', async () => {
    const provider = new ScriptedProvider([]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate([], { path: 'src/a.ts' });
    expect(provider.prompts).toHaveLength(0);
    expect(outcome.kept).toEqual([]);
    expect(outcome.report.candidates).toBe(0);
  });

  it('tags its calls, so a bill can say what the pass cost', async () => {
    const provider = new ScriptedProvider([{ content: '{"verdict":"upheld","reason":"holds"}' }]);
    await new ClaimAdjudicator(provider).adjudicate([candidate()], { path: 'src/a.ts' });
    expect(provider.options[0]).toMatchObject({ temperature: 0, tag: 'review:adjudicate' });
  });

  it('asks about this file, this claim and these added lines', async () => {
    const provider = new ScriptedProvider([{ content: '{"verdict":"upheld","reason":"holds"}' }]);
    await new ClaimAdjudicator(provider).adjudicate(
      [
        {
          finding: finding({
            title: 'the guard is missing',
            description: 'read() returns before the check',
          }),
          addedCode: '@@ -1,2 +1,2 @@\n+return early;',
          addedLines: ADDED,
          fileContext: 'const read = () => 1;',
        },
      ],
      { path: 'src/reader.ts' },
    );
    const prompt = provider.prompts[0]!;
    expect(prompt).toContain('src/reader.ts');
    expect(prompt).toContain('the guard is missing');
    expect(prompt).toContain('read() returns before the check');
    // **The added line arrives numbered, with the number the file gives it** - §45's device, and the reason the reader
    // can answer about a line instead of about a file.
    expect(prompt).toContain('1 | return early;');
    expect(prompt).toContain('The comment is filed on line');
    expect(prompt).toContain('const read = () => 1;');
    // **And the answer shape**, because a call that does not state the schema produces prose.
    expect(prompt).toContain('"verdict":"upheld"|"refuted"|"repaired"');
  });

  it('drops an unreadable answer whose range is not an added line', async () => {
    // **The second half of the fail-open decision.** Keeping the comment is right when it has somewhere to go; a comment
    // with no added line under it has nowhere, and filing it would put it on code the pull request never touched.
    const provider = new ScriptedProvider([{ content: 'Looks fine to me.' }]);
    const outcome = await new ClaimAdjudicator(provider).adjudicate(
      [{ finding: finding({ startLine: 900, endLine: 901 }), addedCode: '', addedLines: ADDED }],
      { path: 'src/a.ts' },
    );
    expect(outcome.kept).toEqual([]);
    expect(outcome.report).toMatchObject({ unreadable: 1, unchecked: 1, unanchored: 1 });
  });

  it('records the last report so a caller can read it without the return value', async () => {
    const provider = new ScriptedProvider([{ content: '{"verdict":"refuted","reason":"no"}' }]);
    const adjudicator = new ClaimAdjudicator(provider);
    expect(adjudicator.lastReport).toBeNull();
    await adjudicator.adjudicate([candidate()], { path: 'src/a.ts' });
    expect(adjudicator.lastReport).toMatchObject({ candidates: 1, refuted: 1 });
  });

  it('adjudicates one candidate without a list, for a caller that has one', async () => {
    const provider = new ScriptedProvider([
      { content: '{"verdict":"refuted","reason":"no input reaches it"}' },
    ]);
    const adjudicator = new ClaimAdjudicator(provider);
    const { applied, call } = await adjudicator.adjudicateOne(candidate(), 'src/a.ts');
    expect(call).toBe('answered');
    expect(applied).toMatchObject({
      kind: 'dropped',
      why: 'refuted',
      reason: 'no input reaches it',
    });
  });
});

describe('the prompt a caller can build on its own', () => {
  it('omits the surrounding code and the fix when the request carries neither', async () => {
    // **The two optional halves of the request**, exercised where they are absent: a call with no window and no
    // suggestion must still produce a prompt that states the claim, and it must not print the word "undefined".
    const { buildAdjudicationPrompt } = await import('../../review/adjudication/prompt.js');
    const prompt = buildAdjudicationPrompt({
      path: 'src/a.ts',
      finding: finding({ suggestion: null }),
      addedCode: '@@ -1,1 +1,1 @@\n+const a = 1;',
    });
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('the description');
    expect(prompt).not.toContain('Surrounding code');
    expect(prompt).not.toContain('Proposed fix');
    expect(prompt).not.toContain('undefined');
  });
});

describe('clipCode', () => {
  it('leaves a block under the budget alone', async () => {
    const { clipCode } = await import('../../review/adjudication/prompt.js');
    expect(clipCode('short', 100)).toBe('short');
  });

  it('keeps both ends of a block over the budget and says how much it dropped', async () => {
    const { clipCode } = await import('../../review/adjudication/prompt.js');
    const clipped = clipCode(`${'a'.repeat(60)}${'b'.repeat(60)}`, 40);
    expect(clipped.startsWith('a'.repeat(20))).toBe(true);
    expect(clipped.endsWith('b'.repeat(20))).toBe(true);
    expect(clipped).toContain('80 characters not shown');
  });
});

describe('oneLine', () => {
  // **The artifact stores these**, and an artifact is diffed: a reason carrying a fenced block turns one row into ten,
  // and a reason cut mid-word without a mark is a reason the next reader will quote as if it ended there.
  it('collapses the whitespace a model writes', () => {
    expect(oneLine('the guard at\n  line 14   returns first')).toBe(
      'the guard at line 14 returns first',
    );
  });

  it('marks a truncation instead of ending mid-word', () => {
    const long = 'a'.repeat(300);
    const cut = oneLine(long, 20);
    expect(cut).toHaveLength(20);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('says nothing rather than "[object Object]" for a value that is not a sentence', () => {
    expect(oneLine(undefined)).toBe('');
    expect(oneLine(null)).toBe('');
    expect(oneLine(42)).toBe('42');
  });
});
