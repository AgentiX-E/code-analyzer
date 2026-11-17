// @code-analyzer/intelligence — a line the claim points at cannot refute the claim
//
// **§74 is the reason this contract exists.** The first gate (§73) removed 557 of 1 646 claims and was wrong about
// which ones: of the 277 removals that could have reached a reviewer, **69 were true positives** - 24.9 % against a pool
// whose own true-positive rate is 21.3 %. The gate was not merely imprecise, it was very slightly *anti*-selective, and
// the 12 removals sampled from the artifact say why: **every one of them quoted a line inside the claim's own range.**
//
// That is not a reader hallucinating. It is the contract admitting a tautology. `Claim: the y component is doubled` at
// line 11, with `  const double y = line.y * 2.0;` at line 11 as the "contradicting" line, is a gate concluding that the
// code is the code - and because a claim's evidence *is* its line, **a quotation requirement satisfied by the claim's own
// line is not evidence at all.** `keptBecauseQuoteMissing` was 27 of 584 refutations (4.6 %), which is the same fact
// from the other side: a reader that can quote the claim's own line can always quote something.
//
// **So v2 removes the claim's range from the quotable set**, and the prompt says so. What is left is the only thing that
// could ever have refuted a claim: *the rest of the change* - a check three lines up, a `reserved` tag below, a guard in
// the same hunk that the claim said was missing. A gate with nothing else to point at keeps everything, which is the
// direction this device has always been allowed to fail in.

import { describe, expect, it } from 'vitest';

import {
  FalsifierGate,
  FALSIFIER_CONTRACTS,
  buildFalsifierPrompt,
} from '../../review/adjudication/falsifier.js';
import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';

/**
 * **Four added lines, and the claim sits on the third of them.**
 *
 * Two context lines at 8 and 9, the removal (old side only), then additions at 10, 11, 12 and 13 - and `+8,6` is that
 * count. The claim sits at 12, so 10, 11 and 13 are the only lines a v2 reader may quote, which is what makes the
 * arithmetic of every assertion below checkable by eye.
 */
const PATCH = [
  'diff --git a/src/DimensionValidators.cpp b/src/DimensionValidators.cpp',
  '--- a/src/DimensionValidators.cpp',
  '+++ b/src/DimensionValidators.cpp',
  '@@ -8,3 +8,6 @@',
  ' double isValidSingleEdge(const Line& line) {',
  '   const double x = line.x;',
  '-  const double y = line.y;',
  '+  const double halfWidth = line.width / 2;',
  '+  if (x < FLT_EPSILON) {',
  '+  const double y = line.y * 2.0;',
  '+  return DimensionGeometry::isVertical;',
].join('\n');

const ADDED = numberedAddedLines(PATCH)!;

function finding(title: string, startLine: number, endLine = startLine): LLMFinding {
  return {
    startLine,
    endLine,
    severity: 'high',
    category: 'bug',
    title,
    description: `${title}, which the change does not guard against.`,
    suggestion: null,
  };
}

/** Answers every call from a script, and remembers the prompt it was given. */
class ScriptedReader implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  calls = 0;
  prompts: string[] = [];

  constructor(private readonly answer: string) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.calls += 1;
    this.prompts.push(prompt);
    return {
      content: this.answer,
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

const CLAIM = finding('the y component is doubled', 12);

describe('the quotable set, and the one range it may not contain', () => {
  it('prints every claim with the range that is not evidence for it', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/DimensionValidators.cpp',
      findings: [CLAIM, finding('a block of two lines', 10, 11)],
      addedLines: ADDED,
      contract: 'independent-evidence-v2',
    });

    // **The prohibition is in the prompt rather than only in the checker**, because a reader told to quote "an added
    // line" will quote the claim's own line - that is what the first gate's sample did twelve times out of twelve - and
    // a rule enforced only after the answer arrives spends the call to learn nothing.
    expect(prompt).toContain('[1] (line 12) the y component is doubled');
    expect(prompt).toContain('not evidence for claim 1');
    expect(prompt).toContain('not evidence for claim 2');
    expect(prompt).toMatch(/lines 10-11/);
  });

  it('names the contract in the prompt, so an answer cannot be read against the wrong rules', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/a.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
      contract: 'independent-evidence-v2',
    });

    expect(prompt).toContain(FALSIFIER_CONTRACTS.v2);
    expect(prompt).toContain('outside');
  });

  it('keeps the first contract sendable, because a figure has to stay reproducible', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/a.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
      contract: 'quoted-falsifier-v1',
    });

    expect(prompt).toContain(FALSIFIER_CONTRACTS.v1);
    expect(prompt).not.toContain('not evidence for claim 1');
  });
});

describe('the gate under the second contract', () => {
  it('refuses a refutation that quotes a line inside the claim it is about', async () => {
    const reader = new ScriptedReader(
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: '  const double y = line.y * 2.0;',
            reason: 'the doubling is intended',
          },
        ],
      }),
    );

    const outcome = await new FalsifierGate(reader, { contract: 'independent-evidence-v2' }).gate({
      path: 'src/DimensionValidators.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
    });

    // **The refutation is exactly the kind the first gate accepted**, and it is the kind its sample shows nine times in
    // twelve: the claim says the y component is doubled, and the quoted line is the doubling. Under v2 it is a quote of
    // the claim, not against it.
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(0);
    expect(outcome.report).toMatchObject({
      candidates: 1,
      dropped: 0,
      keptBecauseSelfReferential: 1,
      keptBecauseQuoteMissing: 0,
      contract: FALSIFIER_CONTRACTS.v2,
    });
  });

  it('applies a refutation that quotes a line outside the claim, and records which line', async () => {
    const reader = new ScriptedReader(
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: '  if (x < FLT_EPSILON) {',
            reason: 'an epsilon guard already exists',
          },
        ],
      }),
    );

    const outcome = await new FalsifierGate(reader, { contract: 'independent-evidence-v2' }).gate({
      path: 'src/DimensionValidators.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
    });

    expect(outcome.dropped).toHaveLength(1);
    // **The line number travels with the removal**, because the artifact's sample carried only the quote and a reader of
    // that sample could not ask the one question that decides whether the gate is a gate: *was this quote the claim's
    // own line?* §74 had to answer it by inference from twelve rows; the next run can answer it by counting.
    expect(outcome.dropped[0]).toMatchObject({ quoteLine: 11, claimIndex: 1 });
    expect(outcome.report.keptBecauseSelfReferential).toBe(0);
  });

  it('counts a claim whose whole range was quoted as self-referential, not as missing', async () => {
    // **The two counters are different defects and print the same F1.** `keptBecauseQuoteMissing` says the reader cannot
    // copy a line; `keptBecauseSelfReferential` says the reader copied the claim. A gate whose only number is the
    // removal count cannot tell a strict reader from a tautological one.
    const reader = new ScriptedReader(
      JSON.stringify({
        refuted: [{ claim: 1, quote: '  const double y = line.y * 2.0;', reason: 'x' }],
      }),
    );
    const outcome = await new FalsifierGate(reader, { contract: 'independent-evidence-v2' }).gate({
      path: 'src/a.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
    });

    expect(outcome.report.keptBecauseSelfReferential).toBe(1);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(0);
  });

  it('allows a quote whose text appears both inside and outside the claim', async () => {
    // **The test is existential, not positional**: a reader that quotes a line by its text has quoted a line that is
    // outside the claim if any line carrying that text is outside it. Refusing here would be refusing evidence that is
    // sitting in the quotable set - the same mistake as refusing a quote for its indentation.
    const patch = [
      'diff --git a/src/a.cpp b/src/a.cpp',
      '--- a/src/a.cpp',
      '+++ b/src/a.cpp',
      '@@ -1,2 +1,4 @@',
      ' int f() {',
      '+  return guard();',
      '+  return guard();',
      ' }',
    ].join('\n');
    const reader = new ScriptedReader(
      JSON.stringify({ refuted: [{ claim: 1, quote: '  return guard();', reason: 'guarded' }] }),
    );

    const outcome = await new FalsifierGate(reader, { contract: 'independent-evidence-v2' }).gate({
      path: 'src/a.cpp',
      findings: [finding('the return is unguarded', 2)],
      addedLines: numberedAddedLines(patch)!,
    });

    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.quoteLine).toBe(3);
  });

  it('still drops the claim the first contract dropped, so the two contracts are one device with two rules', async () => {
    const reader = new ScriptedReader(
      JSON.stringify({
        refuted: [{ claim: 1, quote: '  const double y = line.y * 2.0;', reason: 'x' }],
      }),
    );

    const first = await new FalsifierGate(reader, { contract: 'quoted-falsifier-v1' }).gate({
      path: 'src/a.cpp',
      findings: [CLAIM],
      addedLines: ADDED,
    });

    expect(first.dropped).toHaveLength(1);
    expect(first.report.contract).toBe(FALSIFIER_CONTRACTS.v1);
    expect(first.report.keptBecauseSelfReferential).toBe(0);
  });
});
