// Compiler diagnostics as comments, and the gate that has to be able to check them.
//
// **The point of this file is the last case**: a compiler diagnostic is **the one finding in this product that no
// heuristic produced**, so **the grounding judge must be able to verify it** - and it can, **because the comment
// quotes the line the compiler pointed at, in the file it named.** A converter that produced an unsupportable
// quotation would be **manufacturing work for the gate**, which is why the file's absence is a skip rather than an
// empty quote.

import { describe, expect, it } from 'vitest';

import { compilerToComments } from '../review/compiler-comments.js';
import { judgeGrounding } from '../review/grounding-judge.js';

import type { CompilerDiagnostic } from '@code-analyzer/analyzer';

const A = ['const x: number = "s";', 'export function f() {', '  return x;', '}', ''];

const DIAGNOSTIC: CompilerDiagnostic = {
  filePath: 'src/a.ts',
  line: 1,
  column: 7,
  code: 'TS2322',
  message: "Type 'string' is not assignable to type 'number'.",
  severity: 'error',
};

describe('the compiler speaking the review stream\u2019s language', () => {
  it('quotes the line the compiler pointed at', () => {
    const comments = compilerToComments([DIAGNOSTIC], (p) => (p === 'src/a.ts' ? A : null));
    expect(comments.length).toBe(1);
    expect(comments[0]!.path).toBe('src/a.ts');
    expect(comments[0]!.startLine).toBe(1);
    // **The compiler's own words with its code**, because a reader looks `TS2322` up.
    expect(comments[0]!.content).toContain('TS2322');
    expect(comments[0]!.existingCode).toContain('const x: number');
    // **A type error is a bug**, not a style opinion.
    expect(comments[0]!.category).toBe('bug');
    expect(comments[0]!.severity).toBe('high');
  });

  it('skips a diagnostic whose file it cannot read rather than quoting nothing', () => {
    // **An unsupportable quotation is what the gate removes**, so producing one here would be producing work for it.
    expect(compilerToComments([DIAGNOSTIC], () => null)).toEqual([]);
  });

  it('gives the same id for the same diagnostic twice', () => {
    // **So a caller can dedupe across a rebase**, which a timestamp-based id makes impossible.
    const first = compilerToComments([DIAGNOSTIC], () => A)[0]!;
    const second = compilerToComments([DIAGNOSTIC], () => A)[0]!;
    expect(first.id).toBe(second.id);
  });

  it('produces a comment the grounding judge passes', () => {
    // **The case this file exists for.** The judge checks that a comment's quotation appears in the file it names -
    // and **a compiler diagnostic is grounded by construction**, because **it came from reading that file.**
    const comments = compilerToComments([DIAGNOSTIC], () => A);
    const judged = judgeGrounding(comments, { contents: new Map([['src/a.ts', A.join('\n')]]) });
    expect(judged.ungrounded).toEqual([]);
  });

  it('downgrades a warning to the lowest severity that is still a finding', () => {
    const warning = { ...DIAGNOSTIC, severity: 'warning' as const, code: 'TS6133' };
    const comments = compilerToComments([warning], () => A);
    expect(comments[0]!.severity).toBe('low');
  });
});
