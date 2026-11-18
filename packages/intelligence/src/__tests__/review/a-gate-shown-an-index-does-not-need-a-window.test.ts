// A gate shown an index does not need a window, and the difference is nine tenths of the prompt
//
// **The comparison this file exists to make.** §73's contract showed the reader the added lines; §78's added 6 000
// characters of surrounding lines and returned −0.0022 F1 on 146 pull requests. **The window was not too small - it was
// the wrong shape**: it shows the lines around a change without saying what those lines belong to, so a reader is given
// forty lines of a function it cannot name, inside a file whose contract it cannot see.
//
// **`v4` keeps §78's evidence rule and replaces its block.** The same rule - evidence must lie outside the claim's own
// range, or the quote is the claim agreeing with itself - against a second block that is the file's export surface, the
// declaration the claim stands in, and the guards inside it. 600 characters instead of 6 000, and every one of them
// about the claim.
//
// **What is not claimed here.** This file does not say the index finds more true positives than the window. It says the
// prompt carries the same rule with a tenth of the characters, and that a quote from the index is verified against
// exactly the lines the index showed - which is the property the run will be read on.

import { describe, expect, it } from 'vitest';

import { FALSIFIER_CONTRACTS, FalsifierGate } from '../../review/adjudication/falsifier.js';
import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';
import { buildSymbolIndex, selectIndexedContext } from '../../review/index/symbols.js';
import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';
import type { GitDiff } from '@code-analyzer/shared';

/**
 * **One file, and a patch that adds one line to it: line 6.**
 *
 * Counted by hand, because a fixture whose line numbers are asserted by hand has to be counted by hand - the same note
 * the claim-check fixture carries, written after an off-by-one made every assertion in it true about the wrong line.
 */
const FILE_TEXT = [
  'export function claim(id: string): Entry | null {',
  '  const entry = open(id);',
  '  if (entry === null) {',
  "    throw new Error('x');",
  '  }',
  '  // guard added by the change',
  '  return entry;',
  '}',
  'export const LIMIT = 3;',
].join('\n');

const PATCH = [
  'diff --git a/src/queue.ts b/src/queue.ts',
  '--- a/src/queue.ts',
  '+++ b/src/queue.ts',
  '@@ -2,4 +2,5 @@',
  '   const entry = open(id);',
  '   if (entry === null) {',
  "     throw new Error('x');",
  '   }',
  '+  // guard added by the change',
  '   return entry;',
].join('\n');

const ADDED = numberedAddedLines(PATCH)!;
const INDEX = buildSymbolIndex('src/queue.ts', FILE_TEXT);

/** One claim, at a line. */
function finding(title: string, startLine: number): LLMFinding {
  return {
    startLine,
    endLine: startLine,
    severity: 'high',
    category: 'bug',
    title,
    description: `${title}.`,
    suggestion: null,
  };
}

/** A provider that answers the falsifier from a script and keeps the prompts it was given. */
class Scripted implements LLMProvider {
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

describe('a reader shown the index instead of the window', () => {
  it('sees the declaration the claim stands in rather than four hundred lines around it', async () => {
    const provider = new Scripted([]);
    const indexed = selectIndexedContext({ index: INDEX, lines: [6] });

    await new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v4 }).gate({
      path: 'src/queue.ts',
      findings: [finding('the guard is inverted', 6)],
      addedLines: ADDED,
      indexed,
    });

    const prompt = provider.prompts[0]!;
    expect(prompt).toContain('Contract: independent-evidence-v4');
    expect(prompt).toContain('exports: claim, LIMIT');
    expect(prompt).toContain('L1: export function claim(id: string): Entry | null {');
    // And not the window's own heading, because there is no window in this call.
    expect(prompt).not.toContain('The surrounding lines of the same file');
  });

  it('carries the same rule on a tenth of the characters', async () => {
    const lines = Array.from(
      { length: 400 },
      (_, at) => `  const padding${String(at)} = ${String(at)};`,
    ).join('\n');
    const longFile = `export function big(): number {\n${lines}\n  return 0;\n}`;
    const longIndex = buildSymbolIndex('src/big.ts', longFile);

    const window = await gatePromptOf(FALSIFIER_CONTRACTS.v3, {
      fileText: longFile,
      lines: [200],
      index: longIndex,
    });
    const indexedPrompt = await gatePromptOf(FALSIFIER_CONTRACTS.v4, {
      fileText: longFile,
      lines: [200],
      index: longIndex,
    });

    // The rule is the same sentence in both, which is what makes the price difference a difference in the instrument.
    expect(window).toContain('outside the claim');
    expect(indexedPrompt).toContain('outside the claim');
    expect(indexedPrompt.length).toBeLessThan(window.length * 0.6);
  });

  it('verifies a quote against the lines the index showed, and only those', async () => {
    const indexed = selectIndexedContext({ index: INDEX, lines: [6] });
    const provider = new Scripted([
      JSON.stringify({
        refuted: [{ claim: 1, quote: "throw new Error('x');" }],
      }),
    ]);

    const outcome = await new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v4 }).gate({
      path: 'src/queue.ts',
      findings: [finding('the guard is inverted', 6)],
      addedLines: ADDED,
      indexed,
    });

    // The throw is inside the declaration the claim stands in, and outside the claim's own range.
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(0);
  });

  it('keeps the claim whose quote is a line the index never printed', async () => {
    const indexed = selectIndexedContext({ index: INDEX, lines: [6] });
    const provider = new Scripted([
      JSON.stringify({ refuted: [{ claim: 1, quote: 'const entry = open(id);' }] }),
    ]);

    const outcome = await new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v4 }).gate({
      path: 'src/queue.ts',
      findings: [finding('the guard is inverted', 6)],
      addedLines: ADDED,
      indexed,
    });

    // Line 2 was not shown - the index spends its budget on the claim and its guards - so a quote of it is unverified.
    expect(outcome.dropped).toHaveLength(0);
    expect(outcome.report.keptBecauseQuoteMissing).toBe(1);
  });
});

/** The prompt one gate call produces under a contract, with the same inputs as the tests above. */
async function gatePromptOf(
  contract: (typeof FALSIFIER_CONTRACTS)[keyof typeof FALSIFIER_CONTRACTS],
  input: { fileText: string; lines: readonly number[]; index: ReturnType<typeof buildSymbolIndex> },
): Promise<string> {
  const provider = new Scripted([]);
  const indexed = selectIndexedContext({ index: input.index, lines: input.lines });
  const surrounding = input.fileText
    .split('\n')
    .map((text, at) => ({ line: at + 1, text }))
    .filter((line) => Math.abs(line.line - input.lines[0]!) <= 40 && line.line !== input.lines[0]);

  await new FalsifierGate(provider, { contract }).gate({
    path: 'src/big.ts',
    findings: [finding('one claim', input.lines[0]!)],
    addedLines: numberedAddedLines(PATCH) ?? ADDED,
    ...(contract === FALSIFIER_CONTRACTS.v4 ? { indexed } : { surrounding }),
  });
  return provider.prompts[0]!;
}

describe('the engine carrying an index to the gate', () => {
  const DIFF: GitDiff = {
    filePath: 'src/queue.ts',
    oldHash: '',
    newHash: '',
    ranges: [{ oldStart: 2, oldEnd: 5, newStart: 2, newEnd: 6, changeType: 'modified' as const }],
    changeType: 'modified' as const,
  };

  const LANE_ANSWER = JSON.stringify({
    findings: [
      {
        startLine: 6,
        endLine: 6,
        severity: 'high',
        category: 'bug',
        title: 'the guard is inverted',
        description: 'the guard is inverted.',
        suggestion: null,
      },
    ],
  });

  it('hands the gate the file it indexed rather than a window it would have to guess', async () => {
    const provider = new Scripted([LANE_ANSWER, JSON.stringify({ refuted: [] })]);
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      parallel: false,
      falsify: 'independent-evidence-v4',
      fileIndexOf: (path: string) => (path === 'src/queue.ts' ? INDEX : undefined),
    });

    await engine.reviewDiff(DIFF, PATCH);

    expect(provider.calls).toBe(2);
    expect(provider.prompts[1]).toContain('exports: claim, LIMIT');
  });

  it('falls back to the window when no index was built, rather than to a gate with no second block', async () => {
    const provider = new Scripted([LANE_ANSWER, JSON.stringify({ refuted: [] })]);
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      parallel: false,
      falsify: 'independent-evidence-v4',
      surroundingOf: () => FILE_TEXT,
    });

    await engine.reviewDiff(DIFF, PATCH);

    // **The degradation is the point**: a caller with no index still reaches the evidence rule it dispatched under.
    expect(provider.prompts[1]).toContain('The surrounding lines of the same file');
    expect(provider.prompts[1]).not.toContain('exports: claim, LIMIT');
  });
});
