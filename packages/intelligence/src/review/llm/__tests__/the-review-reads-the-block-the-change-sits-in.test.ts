// @code-analyzer/intelligence — the review reads the block the change sits in, and only when it was asked to
//
// `docs/EVAL-CONTRACT.md` §20 registers one measurement - whether a window of unchanged code around each hunk recovers
// any of the 160 goldens that were rejected with a finding on their own line. **This file settles the part that costs
// nothing**: that the window reaches the prompt, that it is the block rather than the whole file, that it carries its
// coordinates, and that a run which does not turn the switch on sends exactly the prompt it used to send.
//
// **The last test is the one that matters most.** A device whose off-arm is "the old prompt" only measures anything if
// the off-arm really is the old prompt byte for byte - and the way that stops being true is a shared function edited for
// the on-arm and never re-read for the off-arm.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '../llm-review-engine.js';
import { LANE_PROMPTS } from '../prompts.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../provider.js';

/** The function a hunk sits in, four lines longer than the hunk itself. */
const FILE = [
  'import { readFile } from "node:fs";', // 1
  '', // 2
  'export function load(path) {', // 3
  '  const raw = readFile(path);', // 4
  '  // the guard', // 5
  '  if (!raw) return null;', // 6
  '  return parse(raw);', // 7
  '}', // 8
  '', // 9
  'export function parse(raw) {', // 10
  '  return raw;', // 11
  '}', // 12
].join('\n');

const DIFF_TEXT = [
  'diff --git a/src/load.ts b/src/load.ts',
  '--- a/src/load.ts',
  '+++ b/src/load.ts',
  '@@ -4,3 +4,4 @@',
  '   const raw = readFile(path);',
  '+  // the guard',
  '   if (!raw) return null;',
].join('\n');

/** A provider that records the prompts it was given. It is an implementation, not a mock: the engine is measured by what it sends. */
class RecordingProvider implements LLMProvider {
  readonly name = 'recording';
  readonly model = 'recording';
  readonly prompts: string[] = [];

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    return {
      content: '{"findings": []}',
      model: this.model,
      usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      createdAt: '2026-11-11T00:00:00.000Z',
      finishReason: 'stop',
    };
  }

  async completeWithTools(
    prompt: string,
    _tools: unknown[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    return this.complete(prompt, options);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

async function promptsFor(options: {
  codeContext?: boolean;
  fileText?: string;
}): Promise<string[]> {
  const provider = new RecordingProvider();
  const engine = new LLMReviewEngine(provider);
  await engine.reviewPullRequest(
    [
      {
        path: 'src/load.ts',
        diffText: DIFF_TEXT,
        ...(options.fileText === undefined ? {} : { fileText: options.fileText }),
      },
    ],
    {
      maxFindingsPerPullRequest: 4,
      ...(options.codeContext === undefined ? {} : { codeContext: options.codeContext }),
    },
  );
  return provider.prompts;
}

describe('the window a lane is given', () => {
  it('carries the function around the hunk, its path, its line numbers and the lines that changed', async () => {
    const prompts = await promptsFor({ codeContext: true, fileText: FILE });

    expect(prompts).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).toContain('### src/load.ts — lines 3-8 of 12 — changed at 4-7');
      expect(prompt).toContain('export function load(path) {');
      // **The line after the block is not in the window**: a context that grows to the next function is a context that
      // pays for it.
      expect(prompt).not.toContain('export function parse(raw)');
    }
  });

  it('is labelled as unchanged code, so a lane does not report it as part of the change', async () => {
    const prompts = await promptsFor({ codeContext: true, fileText: FILE });

    for (const prompt of prompts) {
      expect(prompt).toContain(
        'Surrounding code, unchanged lines included (the block each hunk sits in):',
      );
    }
  });

  it('is absent from every lane when the switch is off', async () => {
    const prompts = await promptsFor({ codeContext: false, fileText: FILE });

    expect(prompts).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).not.toContain('### src/load.ts');
      expect(prompt).not.toContain('Surrounding code');
    }
  });

  it('sends exactly the prompt it used to send when the switch is off, byte for byte', async () => {
    const prompts = await promptsFor({ codeContext: false, fileText: FILE });
    const before = LANE_PROMPTS.security({
      diffContent: DIFF_TEXT,
      filePath: 'src/load.ts',
      changeType: 'pull-request',
      paths: ['src/load.ts'],
      maxFindings: 4,
      scope: 'pull-request',
      languageChecklist: false,
      promptOrder: 'boilerplate-first',
    });

    // **The off-arm is the contract, not an approximation of it.** If this fails, every figure published before the
    // device existed was measured on a prompt nobody can reproduce from the code.
    expect(prompts[0]).toBe(before);
  });

  it('says nothing about a file the caller could not read, rather than calling it empty', async () => {
    const prompts = await promptsFor({ codeContext: true });

    expect(prompts).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).not.toContain('Surrounding code');
      expect(prompt).toContain('Paths in this pull request:');
    }
  });
});
