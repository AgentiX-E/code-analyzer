// @code-analyzer/intelligence — a hunk that carries no independent evidence can still be refuted by its file
//
// **The measurement this contract exists for.** `independent-evidence-v2` did what it was registered to do and then ran
// out of material: on 146 pull requests it removed **169 claims carrying 8 true positives** - **4.73 %**, against the
// 24.9 % of §73's gate and the 4 % §75.3 asks for. The pool is clean and it is small, and the arithmetic in §76 says why
// that is not enough: **169 removals move F1 by at most 0.0176**, under the 0.02 registered, so the run was
// `unreachable` and the corpus could not price the bar.
//
// **The 183 claims it left behind are the material.** 148 were kept because the only line the reader could quote was
// inside the claim's own range (`keptBecauseSelfReferential`), and 35 because the quote matched no line it had been
// shown (`keptBecauseQuoteMissing`). **Both are the same shortage**: a hunk of three added lines contains no independent
// evidence for a claim about those three lines, so the reader quotes what it has or gives up. 169 + 183 is 352, and at
// the toxicity v2 measured 352 removals are worth **+0.0207** - over the bar, which is why this is the next contract
// rather than a different device.
//
// **And the evidence has to be curated rather than dumped.** Three sources say the same thing: `arXiv 2411.03079`'s
// eCPG-Slicer derives a *precise and complete* slice before asking a model, `arXiv 2610.36010`'s CIVER verifies a claim
// by *intervening on the code it names*, and the field's own negative result - context-dump reviewers reporting 60–80 %
// of their findings as false - is what a reviewer gets when it is handed a bundle instead of a slice. **So v3 does not
// hand over the file.** It hands over the lines around each claim, numbered in the file's own coordinates, and nothing
// else.

import { describe, expect, it } from 'vitest';

import {
  FalsifierGate,
  FALSIFIER_CONTRACTS,
  buildFalsifierPrompt,
  selectSurrounding,
} from '../../review/adjudication/falsifier.js';
import { numberedAddedLines } from '../../review/adjudication/patch-lines.js';

import type { LLMFinding } from '../../review/llm/prompts.js';
import type {
  CompletionOptions,
  CompletionResult,
  LLMProvider,
} from '../../review/llm/provider.js';

/**
 * **A file whose hunk is three lines and whose guard is forty lines above it.**
 *
 * Lines 1-20 are the surrounding code the hunk does not touch; line 21 is the context line git prints above the change
 * and lines 22-24 are the added lines. The claim sits at 23 and says the width is never validated - and the validation
 * is at line 6, **outside the hunk, inside the file**, which is exactly the case v2 cannot reach.
 */
const FILE_LINES = [
  'namespace geom {',
  'double areaOf(const Line& line) {',
  '  if (!line.valid()) {',
  '    return 0.0;',
  '  }',
  '  if (line.width <= 0.0) {',
  '    throw std::invalid_argument("width");',
  '  }',
  '  return line.x * line.y;',
  '}',
  '}',
  'static constexpr int kMaxEdges = 4;',
  'void validate(const Line& line, int edges) {',
  '  if (edges > kMaxEdges) {',
  '    throw std::runtime_error("too many edges");',
  '  }',
  '  use(line, edges);',
  '  observe(line);',
  '  finish();',
  '}',
];

const PATCH = [
  'diff --git a/src/Geometry.cpp b/src/Geometry.cpp',
  '--- a/src/Geometry.cpp',
  '+++ b/src/Geometry.cpp',
  '@@ -21,1 +21,3 @@',
  ' void registerLine(const Line& line) {',
  '+  edges += 1;',
  '+  const double w = line.width / 2.0;',
  '+  publish(line, w, edges);',
].join('\n');

const ADDED = numberedAddedLines(PATCH)!;
const FILE_TEXT = [
  ...FILE_LINES,
  'void registerLine(const Line& line) {',
  '  edges += 1;',
  '  const double w = line.width / 2.0;',
  '  publish(line, w, edges);',
  '}',
].join('\n');

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
class ScriptedProvider implements LLMProvider {
  readonly name = 'Scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];

  constructor(private readonly answer: string) {}

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
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

describe('a claim can be refuted by a line the hunk did not touch', () => {
  it('names the third contract by its value, so an artifact says which contract produced its pool', () => {
    expect(FALSIFIER_CONTRACTS.v3).toBe('independent-evidence-v3');
    // **Three contracts, three names**, and the two older ones keep the values their figures were measured under.
    expect(FALSIFIER_CONTRACTS.v1).toBe('quoted-falsifier-v1');
    expect(FALSIFIER_CONTRACTS.v2).toBe('independent-evidence-v2');
  });

  it('gives the reader the lines around the claim and lets it quote one', () => {
    // **The promise**: a claim about line 23 saying "width is unvalidated" is refuted by line 6, which is in the file
    // and not in the hunk. Under v2 that sentence could not be quoted; under v3 it can.
    const provider = new ScriptedProvider(
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: 'if (line.width <= 0.0) {',
            reason: 'The width is validated in areaOf before it is used.',
          },
        ],
      }),
    );
    const gate = new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v3 });
    return gate
      .gate({
        path: 'src/Geometry.cpp',
        findings: [finding('width is never validated before use', 23)],
        addedLines: ADDED,
        surrounding: selectSurrounding({
          fileText: FILE_TEXT,
          findings: [finding('width is never validated before use', 23)],
          addedLines: ADDED,
          radius: 30,
        }),
        contract: FALSIFIER_CONTRACTS.v3,
      })
      .then((outcome) => {
        expect(outcome.report.dropped).toBe(1);
        expect(outcome.kept).toHaveLength(0);
        // **And the artifact can say which line it stood on**, which is the instrument §74.5 asked for.
        expect(outcome.dropped[0]!.quoteLine).toBe(6);
      });
  });

  it('still refuses a quote of the claim\u2019s own line, because v3 inherits v2', () => {
    // **The tautology is not re-admitted by the wider set.** The claim points at 23, and 23 is one of the added lines
    // the reader was shown, so quoting it is still a keep - the wider quotable set must not become a looser rule.
    const provider = new ScriptedProvider(
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: 'const double w = line.width / 2.0;',
            reason: 'The claim is about this very line.',
          },
        ],
      }),
    );
    const gate = new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v3 });
    return gate
      .gate({
        path: 'src/Geometry.cpp',
        findings: [finding('width is never validated before use', 23)],
        addedLines: ADDED,
        surrounding: selectSurrounding({
          fileText: FILE_TEXT,
          findings: [finding('width is never validated before use', 23)],
          addedLines: ADDED,
          radius: 30,
        }),
        contract: FALSIFIER_CONTRACTS.v3,
      })
      .then((outcome) => {
        expect(outcome.report.dropped).toBe(0);
        expect(outcome.report.keptBecauseSelfReferential).toBe(1);
      });
  });

  it('keeps v2\u2019s answer unchanged when no surrounding text was handed in', () => {
    // **A run that cannot produce the context is a v2 run**, not a broken one. The contract is asked for, the material
    // is missing, and the gate does what it always did: the claim stays.
    const provider = new ScriptedProvider(
      JSON.stringify({
        refuted: [
          {
            claim: 1,
            quote: 'if (line.width <= 0.0) {',
            reason: 'Not shown to this reader, so it cannot quote it.',
          },
        ],
      }),
    );
    const gate = new FalsifierGate(provider, { contract: FALSIFIER_CONTRACTS.v3 });
    return gate
      .gate({
        path: 'src/Geometry.cpp',
        findings: [finding('width is never validated before use', 23)],
        addedLines: ADDED,
        contract: FALSIFIER_CONTRACTS.v3,
      })
      .then((outcome) => {
        expect(outcome.report.dropped).toBe(0);
        expect(outcome.report.keptBecauseQuoteMissing).toBe(1);
      });
  });

  it('prints the surrounding lines in the file\u2019s own numbering, under their own heading', () => {
    const prompt = buildFalsifierPrompt({
      path: 'src/Geometry.cpp',
      findings: [finding('width is never validated before use', 23)],
      addedLines: ADDED,
      surrounding: selectSurrounding({
        fileText: FILE_TEXT,
        findings: [finding('width is never validated before use', 23)],
        addedLines: ADDED,
        radius: 30,
      }),
      contract: FALSIFIER_CONTRACTS.v3,
    });
    // **One numbering, not two.** A reader told that the added lines are 21-23 and the surrounding lines are 1-20 has to
    // be able to say "line 6" and have it mean the file's line 6, which is what the hunk header already means.
    expect(prompt).toContain('6|   if (line.width <= 0.0) {');
    expect(prompt).toContain('independent-evidence-v3');
    // And the claim's own range is still named as not-evidence.
    expect(prompt).toContain('own range is not evidence');
  });
});

describe('the surrounding lines are a slice rather than the file', () => {
  const findings = [finding('a', 23), finding('b', 60)];

  it('takes a window around each claim and never the whole file', () => {
    const long = Array.from({ length: 400 }, (_, at) => `line ${String(at + 1)}`).join('\n');
    const picked = selectSurrounding({
      fileText: long,
      findings,
      addedLines: null,
      radius: 5,
    });
    // Two claims, eleven lines each, no overlap: twenty-two at most.
    expect(picked.length).toBeLessThanOrEqual(22);
    expect(picked.length).toBeGreaterThan(0);
    // **Every line is near one of the claims**, which is the property that makes this a slice.
    for (const line of picked) {
      const near = findings.some(
        (claim) => line.line >= claim.startLine - 5 && line.line <= claim.endLine + 5,
      );
      expect(near, `line ${String(line.line)} is not near a claim`).toBe(true);
    }
  });

  it('never repeats a line the hunk already showed, because a duplicate is a second number for one fact', () => {
    const picked = selectSurrounding({
      fileText: FILE_TEXT,
      findings: [finding('width is never validated before use', 23)],
      addedLines: ADDED,
      radius: 30,
    });
    const added = new Set(ADDED.map((line) => line.line));
    for (const line of picked) expect(added.has(line.line)).toBe(false);
    // **And the result is ascending**, so a reader scanning the block is reading the file.
    const numbers = picked.map((line) => line.line);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('stops at its budget and keeps the lines nearest the claims', () => {
    const long = Array.from({ length: 400 }, (_, at) => `line ${String(at + 1)}`).join('\n');
    const picked = selectSurrounding({
      fileText: long,
      findings,
      addedLines: null,
      radius: 200,
      budget: 10,
    });
    expect(picked).toHaveLength(10);
    // **The nearest win**, which is the rule that makes a budget a slice rather than a coin toss: the claim at 23 keeps
    // its immediate neighbours, not the far edge of its radius.
    expect(picked.some((line) => Math.abs(line.line - 23) <= 5)).toBe(true);
  });
});
