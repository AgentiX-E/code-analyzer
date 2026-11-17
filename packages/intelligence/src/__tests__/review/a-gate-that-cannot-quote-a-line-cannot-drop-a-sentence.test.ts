// @code-analyzer/intelligence — a gate that cannot quote a line cannot drop a sentence
//
// **The device this file is about, and why the contract it is held to is not the adjudicator's.** §44–§45 tested one
// falsification device and it worked: precision 45.5 % and 32.4 %. It also took recall to 6.6 % and 5.3 % and F1 from
// 19.5 % to 11.6 %, **because it asked one question per finding and accepted "refuted" without evidence.** A reviewer
// that drops nine of every ten sentences is not a filter; it is a different, quieter reviewer.
//
// **So this gate is inverted.** It keeps by default, it is asked once per *file* rather than once per finding, and **a
// drop is only applied when the reader quotes a line this diff added** - the quote is checked, not believed. Three
// things follow from that, and each is a test below: an unreadable answer keeps everything, an unverifiable quote keeps
// its finding, and a verified quote removes one sentence and touches no other byte of it.
//
// **What it is not allowed to do is the point of the third.** No rewriting, no re-anchoring, no severity changes. A gate
// that edits is a second author of the comment, and then the figure measures the gate rather than the reviewer.

import { describe, expect, it } from 'vitest';

import {
  FalsifierGate,
  FALSIFIER_MIN_QUOTE,
  buildFalsifierPrompt,
  readFalsifierAnswer,
  type FalsifierRefutation,
} from '../../review/adjudication/falsifier.js';
import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';
import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/** One patch, three added lines on 11, 12 and 13, plus a removed line no quote may come from. */
/**
 * **Three added lines, counted by hand: 11, 12 and 13.**
 *
 * Three context lines at 8, 9 and 10, then the removal (which advances the old side only), then the three additions at
 * 11, 12 and 13, then one closing context line at 14 - and `+8,7` is that count. The first draft of this fixture had two
 * context lines and the additions landed on 10, 11 and 12, which is the same off-by-one the engine's claim-check fixture
 * records: **a fixture whose line numbers are asserted by hand has to be counted by hand.**
 */
const PATCH = [
  'diff --git a/src/DimensionValidators.cpp b/src/DimensionValidators.cpp',
  '--- a/src/DimensionValidators.cpp',
  '+++ b/src/DimensionValidators.cpp',
  '@@ -8,4 +8,7 @@',
  ' double isValidSingleEdge(const Line& line) {',
  '   const double x = line.x;',
  '   const double halfWidth = line.width / 2;',
  '-  const double y = line.y;',
  '+  const double y = line.y * 2.0;',
  '+  if (x < FLT_EPSILON) {',
  '+    return DimensionGeometry::isHorizontal;',
  '   return DimensionGeometry::isVertical;',
].join('\n');

const ADDED = numberedAddedLines(PATCH)!;

/** A finding, at a line, saying one sentence. */
function finding(
  title: string,
  startLine = 12,
  category: LLMFinding['category'] = 'bug',
): LLMFinding {
  return {
    startLine,
    endLine: startLine,
    severity: 'high',
    category,
    title,
    description: `${title}, which the change does not guard against.`,
    suggestion: null,
  };
}

/** A provider that answers every falsifier call from a script, and counts the calls it was given. */
class ScriptedFalsifier implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';

  calls = 0;
  readonly prompts: string[] = [];

  constructor(private readonly answers: ReadonlyArray<string>) {}

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

describe('the falsifier gate', () => {
  it('asks once per file, and shows the reader the lines and the claims and nothing else', async () => {
    // **Two assertions in one test because they are the same assertion**: the prompt is the instrument. A gate that
    // asked per finding would cost what the adjudicator cost (§44: 5 032 calls for 146 pull requests), and a prompt that
    // named the lane or the score would be answered by a reader anchoring on it.
    const provider = new ScriptedFalsifier([]);
    const findings = Array.from({ length: 12 }, (_, at) => finding(`claim ${at + 1}`, 12));

    await new FalsifierGate(provider).gate({ path: 'src/a.cpp', findings, addedLines: ADDED });

    expect(provider.calls).toBe(1);
    const prompt = provider.prompts[0]!;
    // Every claim, by the number the answer has to cite.
    for (let at = 1; at <= 12; at += 1) expect(prompt).toContain(`[${at}]`);
    // Every added line, by the number the file gives it, with its text.
    expect(prompt).toContain('11|   const double y = line.y * 2.0;');
    expect(prompt).toContain('12|   if (x < FLT_EPSILON) {');
    // And not the two things that would anchor the reader.
    expect(prompt).not.toMatch(/\bsecurity lane\b|\barchitecture lane\b/);
    expect(prompt).not.toMatch(/\bscore\b|\branked\b/i);
  });

  it('keeps every finding when the reader is silent, which is the default the whole device rests on', async () => {
    const provider = new ScriptedFalsifier(['{"refuted":[]}']);
    const findings = [finding('one'), finding('two')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept).toHaveLength(2);
    expect(outcome.report).toMatchObject({ candidates: 2, dropped: 0, keptBecauseQuoteMissing: 0 });
  });

  it('keeps every finding when the answer cannot be read, and says so rather than counting a drop', async () => {
    // **The failure mode §44 hid.** A provider that answers prose is not a reader that refuted everything, and the two
    // have opposite repairs - one is a credential or a model problem, the other is the device working.
    const provider = new ScriptedFalsifier(['All of these look reasonable to me.']);
    const findings = [finding('one'), finding('two')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept).toHaveLength(2);
    expect(outcome.dropped).toHaveLength(0);
    expect(outcome.report.unreadable).toBe(1);
  });

  it('cannot drop a finding on a quote from a line the diff removed', async () => {
    // **The one check that makes this a falsifier rather than a second opinion.** The removed line is visible in the
    // patch, so a reader can quote it, and a quote from it is not evidence about the change - it is evidence about the
    // code the change replaced.
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        refuted: [
          { claim: 1, quote: 'const double y = line.y;', reason: 'the y component is still read' },
        ],
      }),
    ]);
    const findings = [finding('the y component is dropped')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(0);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(1);
  });

  it('cannot drop a finding on a quote too short to identify a line', async () => {
    // `if (x` is on an added line and is not evidence of anything. **The floor is what stops a reader from quoting the
    // three characters any line would satisfy** - the same defect `golden-attribution` had when it matched on `return`.
    const provider = new ScriptedFalsifier([
      JSON.stringify({ refuted: [{ claim: 1, quote: 'if (x', reason: 'the guard exists' }] }),
    ]);
    const findings = [finding('the epsilon guard is missing')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(FALSIFIER_MIN_QUOTE).toBeGreaterThan('if (x'.length);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(1);
  });

  it('drops exactly the finding whose refutation it could quote, and keeps the rest', async () => {
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        refuted: [
          {
            claim: 2,
            quote: '    return DimensionGeometry::isHorizontal;',
            reason: 'the vertical branch is returned on line 14',
          },
        ],
      }),
    ]);
    const findings = [finding('the guard is missing'), finding('vertical edges are horizontal')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept.map((entry) => entry.title)).toEqual(['the guard is missing']);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.finding.title).toBe('vertical edges are horizontal');
    expect(outcome.dropped[0]!.quote).toBe('    return DimensionGeometry::isHorizontal;');
    expect(outcome.dropped[0]!.reason).toContain('vertical branch');
    expect(outcome.report).toMatchObject({ candidates: 2, dropped: 1, keptBecauseQuoteMissing: 0 });
  });

  it('matches a quote whose whitespace was reflowed, because a reader copying indentation is not a reader in error', async () => {
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: 'if (x < FLT_EPSILON) {',
            reason: 'the guard the claim says is missing',
          },
        ],
      }),
    ]);
    const findings = [finding('the epsilon guard is missing')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(0);
  });

  it('never rewrites what it keeps, and hands back the same objects', async () => {
    // **A gate that edits is a second author.** The engine re-anchors and re-words elsewhere; here the only permitted
    // effect is removal, so the survivors are compared by identity and by every field.
    const provider = new ScriptedFalsifier(['{"refuted":[]}']);
    const findings = [finding('one', 12), finding('two', 13, 'performance')];
    const before = structuredClone(findings);

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept[0]).toBe(findings[0]);
    expect(outcome.kept[1]).toBe(findings[1]);
    expect(outcome.kept).toEqual(before);
  });

  it('ignores a claim number it never asked about, and drops a claim twice-refuted once', async () => {
    const quote = '    return DimensionGeometry::isHorizontal;';
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        refuted: [
          { claim: 9, quote, reason: 'not a claim in this prompt' },
          { claim: 0, quote, reason: 'not a claim either' },
          { claim: 1, quote, reason: 'first reason' },
          { claim: 1, quote, reason: 'second reason' },
        ],
      }),
    ]);
    const findings = [finding('one'), finding('two')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.kept.map((entry) => entry.title)).toEqual(['two']);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.reason).toBe('first reason');
  });

  it('spends no call on a file with nothing to check', async () => {
    const provider = new ScriptedFalsifier([]);

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings: [],
      addedLines: ADDED,
    });

    expect(provider.calls).toBe(0);
    expect(outcome.report).toMatchObject({ candidates: 0, dropped: 0, keptBecauseQuoteMissing: 0 });
  });

  it('spends no call when the text it was handed is not a patch, because no quote could be verified', async () => {
    // **A gate whose evidence cannot be checked is a gate that would drop on the reader's word.** The product path hands
    // in a code window rather than a diff when the review was given no patch, and the honest answer there is to keep
    // everything and pay nothing.
    const provider = new ScriptedFalsifier([]);
    const findings = [finding('one')];

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: null,
    });

    expect(provider.calls).toBe(0);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.report.notAPatch).toBe(true);
  });

  it('asks about sixty claims at most, and a refutation of the sixty-first changes nothing', async () => {
    // **A file with seventy findings is a file whose seventieth is not the one a reader settles.** The rest are kept
    // unasked and the count says so, so the artifact reports how much of the pool the gate ever saw rather than
    // implying it saw all of it.
    const provider = new ScriptedFalsifier([
      JSON.stringify({
        refuted: [
          {
            claim: 65,
            quote: '    return DimensionGeometry::isHorizontal;',
            reason: 'a claim nobody asked about',
          },
        ],
      }),
    ]);
    const findings = Array.from({ length: 70 }, (_, at) => finding(`claim ${at + 1}`));

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings,
      addedLines: ADDED,
    });

    expect(outcome.report).toMatchObject({ candidates: 70, dropped: 0, notAsked: 10 });
    expect(outcome.kept).toHaveLength(70);
    // And the prompt carried the sixtieth claim and not the sixty-first.
    expect(provider.prompts[0]).toContain('[60]');
    expect(provider.prompts[0]).not.toContain('[61]');
  });

  it('cannot verify a quote from a line the budget kept out of the prompt', async () => {
    // **The budget is a limit on what was shown, and a quote is evidence only if it was shown.** A reader that returned
    // a line from the part of the file it never saw is quoting something else - and the gate has to refuse it rather
    // than verify it against text the reader could not have read.
    const many = Array.from(
      { length: 400 },
      (_, at) => `+  const double value${at} = compute(${at}, line.width, line.height);`,
    );
    const patch = ['@@ -1,1 +1,400 @@', ' baseline();', ...many].join('\n');
    const added = numberedAddedLines(patch)!;
    const last = addLastQuote(added);

    const provider = new ScriptedFalsifier([
      JSON.stringify({ refuted: [{ claim: 1, quote: last, reason: 'the last line decides it' }] }),
    ]);

    const outcome = await new FalsifierGate(provider).gate({
      path: 'src/a.cpp',
      findings: [finding('a claim about the last line')],
      addedLines: added,
    });

    expect(provider.prompts[0]).not.toContain(last);
    expect(outcome.dropped).toHaveLength(0);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(1);
  });

  it('keeps every finding when the provider throws, because a gate that did not run refuted nothing', async () => {
    const broken = new (class extends ScriptedFalsifier {
      override async complete(): Promise<CompletionResult> {
        throw new Error('500 from the provider');
      }
    })([]);

    const outcome = await new FalsifierGate(broken).gate({
      path: 'src/a.cpp',
      findings: [finding('one'), finding('two')],
      addedLines: ADDED,
    });

    expect(outcome.kept).toHaveLength(2);
    expect(outcome.report).toMatchObject({ dropped: 0, unreadable: 1, calls: 0 });
  });
});

/** The text of the last added line, which the budget keeps out of the prompt. */
function addLastQuote(lines: ReadonlyArray<{ line: number; text: string }>): string {
  return lines[lines.length - 1]!.text.trim();
}

describe('the falsifier prompt and its reader', () => {
  it('states the default as keep, and forbids the two edits it may not make', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/a.cpp',
      findings: [finding('one')],
      addedLines: ADDED,
    });

    expect(prompt).toContain('kept');
    expect(prompt).toMatch(/may not rewrit|do not rewrit/i);
    expect(prompt).toMatch(/exactly|character for character|verbatim/i);
    // The question is about a line the diff added, and it is asked about all of them at once.
    expect(prompt).toMatch(/added line/i);
    expect(prompt).toContain('src/a.cpp');
  });

  it('reads a fenced answer, because a model told not to fence one fences it anyway', () => {
    // **The fence is the one malformation that would otherwise read as silence.** `parseLLMResponse` strips fences for
    // the lanes for exactly this reason, and a gate that answered "unreadable" to every fenced answer would be a gate
    // that never ran on the provider that prefers them.
    const fenced = '```json\n{"refuted":[{"claim":1,"quote":"' +
      '  const double y = line.y * 2.0;","reason":"intended"}]}\n```';
    expect(readFalsifierAnswer(fenced)).toMatchObject({ kind: 'answer' });
    const refuted = (readFalsifierAnswer(fenced) as { refuted: FalsifierRefutation[] }).refuted;
    expect(refuted[0]!.claim).toBe(1);

    // A fence with no newline at all is not a body, and the answer is returned as it stands rather than emptied.
    expect(readFalsifierAnswer('```').kind).toBe('unreadable');
    // A fence that never closes is still a body - the model was cut off after the JSON, not before it.
    expect(readFalsifierAnswer('```json\n{"refuted":[]}')).toEqual({ kind: 'answer', refuted: [] });
  });

  it('skips a refutation that is not an object, rather than counting it as a drop', () => {
    // **The list is model output, so an element can be anything.** A string or a nested list in the `refuted` array is
    // a malformed entry and not a refutation - skipping it keeps the claim, which is the direction the contract allows.
    const answer = readFalsifierAnswer(
      '{"refuted":[["claim",1],"keep this one","nonsense",{"claim":"two","quote":"x","reason":"y"},{"claim":2,"quote":"q","reason":"r"}]}',
    );
    expect(answer.kind).toBe('answer');
    expect((answer as { refuted: FalsifierRefutation[] }).refuted).toHaveLength(1);
    expect((answer as { refuted: FalsifierRefutation[] }).refuted[0]!.claim).toBe(2);
  });

  it('reads a missing answer as unreadable rather than as silence', () => {
    expect(readFalsifierAnswer(null as unknown as string)).toEqual({
      kind: 'unreadable',
      why: 'the answer is not JSON',
    });
  });

  it('reads a bare list as unreadable, because the question asked for an object', () => {
    // An array is the answer to a different question - the prompt asks for `{"refuted":[…]}` - and reading a list of
    // refutations off it would be inventing the key the model did not write.
    expect(readFalsifierAnswer('[{"claim":1,"quote":"x","reason":"y"}]')).toEqual({
      kind: 'unreadable',
      why: 'the answer is not an object',
    });
  });

  it('numbers a claim by the range it covers when the claim is not on one line', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/a.cpp',
      findings: [{ ...finding('a block'), startLine: 11, endLine: 13 }],
      addedLines: ADDED,
    });

    expect(prompt).toContain('[1] (lines 11-13)');
  });

  it('reads an answer that has no refuted key as silence rather than as an error', () => {
    expect(readFalsifierAnswer('{}')).toEqual({ kind: 'answer', refuted: [] });
    expect(readFalsifierAnswer('{"refuted":[{"claim":1,"quote":"x","reason":"y"}]}')).toMatchObject(
      {
        kind: 'answer',
      },
    );
    expect(readFalsifierAnswer('not json').kind).toBe('unreadable');
    expect(readFalsifierAnswer('{"refuted":"none"}').kind).toBe('unreadable');
  });
});

describe('the engine with the gate switched on', () => {
  /** Answers the security lane, and answers the gate from a script. */
  class LaneAndGate implements LLMProvider {
    readonly name = 'Scripted';
    readonly model = 'scripted-1';
    laneCalls = 0;
    gateCalls = 0;
    gatePrompts: string[] = [];

    constructor(
      private readonly findings: ReadonlyArray<Record<string, unknown>>,
      private readonly answer: string,
    ) {}

    async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
      if (prompt.includes("independent reader of one file's change")) {
        this.gateCalls += 1;
        this.gatePrompts.push(prompt);
        return this.result(this.answer);
      }
      this.laneCalls += 1;
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

  function reviewDiff(): GitDiff {
    return {
      filePath: 'src/DimensionValidators.cpp',
      oldHash: 'old',
      newHash: 'new',
      ranges: [{ oldStart: 8, oldEnd: 11, newStart: 8, newEnd: 14, changeType: 'modified' }],
      changeType: 'modified',
    };
  }

  const CLAIM_ONE = {
    startLine: 11,
    endLine: 11,
    severity: 'high',
    category: 'bug',
    title: 'the y component is doubled',
    description: 'The change multiplies y by two before the comparison.',
    suggestion: null,
  };

  const CLAIM_TWO = {
    startLine: 13,
    endLine: 13,
    severity: 'medium',
    category: 'performance',
    title: 'the horizontal branch is unreachable',
    description: 'The early return makes the final return dead for every input.',
    suggestion: null,
  };

  it('changes nothing and spends nothing when the gate is off', async () => {
    const provider = new LaneAndGate([CLAIM_ONE, CLAIM_TWO], '{"refuted":[]}');
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });
    const results = await engine.reviewDiff(reviewDiff(), PATCH);

    expect(provider.gateCalls).toBe(0);
    expect(engine.lastFalsifier).toBeNull();
    expect(results.flatMap((result) => result.findings)).toHaveLength(2);
  });

  it('drops the claim it could quote a line for, keeps the other, and keeps the lane', async () => {
    const provider = new LaneAndGate(
      [CLAIM_ONE, CLAIM_TWO],
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: '  const double y = line.y * 2.0;',
            reason: 'the doubled y is what the change intends',
          },
        ],
      }),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], falsify: true });
    const results = await engine.reviewDiff(reviewDiff(), PATCH);

    // **One call for the file, not one per claim** - that ratio is the whole reason the device is affordable.
    expect(provider.gateCalls).toBe(1);
    expect(engine.lastFalsifier?.report).toMatchObject({
      candidates: 2,
      dropped: 1,
      keptBecauseQuoteMissing: 0,
    });
    const kept = results.flatMap((result) => result.findings);
    expect(kept.map((entry) => entry.title)).toEqual([CLAIM_TWO.title]);
    expect(results[0]!.lane).toBe('security');
    expect(engine.lastFalsifier?.dropped[0]?.quote).toBe('  const double y = line.y * 2.0;');
  });

  it('keeps everything and spends nothing when the review was handed a code window instead of a patch', async () => {
    // **The product path hands in the block a hunk sits in rather than a diff**, and a gate whose only warrant is a
    // quoted added line cannot verify one there. The honest answer is to keep the pool and record why - **a file the
    // gate could not read is not a file it cleared**, and the counter says so.
    const provider = new LaneAndGate(
      [CLAIM_ONE],
      JSON.stringify({ refuted: [{ claim: 1, quote: 'const double y = line.y;', reason: 'x' }] }),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], falsify: true });
    const window = ['double isValidSingleEdge(const Line& line) {', '  return false;', '}'].join('\n');
    const results = await engine.reviewDiff(reviewDiff(), window);

    expect(provider.gateCalls).toBe(0);
    expect(engine.lastFalsifier?.report).toMatchObject({ dropped: 0, notAPatch: true, calls: 0 });
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
  });

  it('reads the added lines out of the patch, so a quote from a removed line drops nothing', async () => {
    const provider = new LaneAndGate(
      [CLAIM_ONE],
      JSON.stringify({
        refuted: [{ claim: 1, quote: 'const double y = line.y;', reason: 'y is still read' }],
      }),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'], falsify: true });
    const results = await engine.reviewDiff(reviewDiff(), PATCH);

    expect(engine.lastFalsifier?.report.keptBecauseQuoteMissing).toBe(1);
    expect(results.flatMap((result) => result.findings)).toHaveLength(1);
  });
});
