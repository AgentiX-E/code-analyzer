// The sanitized handler, measured rather than assumed absent.
//
// The fixture's fourth file is the same shape as the first two with one difference: the value is put through
// `encodeURIComponent` before it reaches the sink. The test above asserts that `handleList` is not reported, and
// **an absence is not a measurement** - it is equally consistent with the flow never arriving.
//
// What this file shows is that the flow does arrive and is neutralized on the way:
//
//   bindings [request=0, term=1, safe=2]
//   sources [1]        the request field, as in the other two handlers
//   sanitizers [2]     `encodeURIComponent(term)`, whose result is binding 2
//   calls [runCommand([2])]   **the call passes the sanitized binding, not the source**

import { readFileSync } from 'node:fs';

import { TypeScriptProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';

import type { ParsedFile } from '@code-analyzer/shared';

describe('the sanitized handler in the fixture', () => {
  it('has a source, a sanitizer, and a call that passes the sanitized binding', () => {
    const code = readFileSync('tests/fixtures/app-with-taint/src/safe.ts', 'utf8');
    const typed = new TypeScriptProvider() as unknown as {
      parse(s: string, f: string): Array<{ tag?: string }>;
      extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
      extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
      extractSanitizers(s: string): Array<{ sanitizerType: string; line: number; text: string }>;
    };
    const sanitizers = typed.extractSanitizers(code);
    const captures = typed.parse(code, 'safe.ts');
    const { symbols, references, scopeTree } = groupCaptures(
      captures as Parameters<typeof groupCaptures>[0],
      'safe.ts',
    );
    const parsed = {
      filePath: 'safe.ts',
      language: 'typescript',
      symbols,
      references,
      scopeTree,
      ast: captures,
    } as unknown as ParsedFile;
    const callSites = buildCallSites([parsed], references);
    const extraction = new Map([
      [
        'safe.ts',
        {
          sources: typed.extractTaintSources(code),
          sinks: typed.extractTaintSinks(code),
          sanitizers,
        },
      ],
    ]);
    const cfg = [...buildFunctionCfgs([parsed], callSites, extraction)].find(([, c]) =>
      c.functionName.includes('handleList'),
    )?.[1];
    expect(cfg).toBeDefined();
    if (!cfg) return;

    // The sanitizer is in the vocabulary and in the function.
    expect(cfg.stmtFacts.sanitizerSites.size).toBe(1);
    expect(sanitizers.some((s) => s.sanitizerType === 'encoding')).toBe(true);

    // The source is there, so the flow starts.
    expect(cfg.stmtFacts.sourceSites.size).toBe(1);

    // **And the call passes the binding the sanitizer produced.** Those two things together are what the absence
    // above means: not "the flow never arrived" but "the flow was neutralized".
    const sanitized = cfg.bindings.find((b) => b.name === 'safe');
    const source = cfg.bindings.find((b) => b.name === 'term');
    expect(sanitized).toBeDefined();
    expect(source).toBeDefined();
    const runCommand = (cfg.callSites ?? []).find((c) => c.calleeName.includes('runCommand'));
    expect(runCommand?.argBindings).toContain(sanitized?.index);
    expect(runCommand?.argBindings).not.toContain(source?.index);
  });
});
