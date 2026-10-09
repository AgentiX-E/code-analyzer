// The compiler's own output, and what it means when there is none.
//
// **This capability's correctness lives in a pure parser**, so most of this file is about the format rather than about
// running anything - **and the running is behind an injected runner**, which is what lets the interesting cases exist
// at all: **a project with no compiler, a typecheck that times out, and a tool that fails without a diagnostic.**

import { describe, expect, it } from 'vitest';

import { chooseTypecheckCommand, collectCompileEvidence, parseTscOutput } from '../compile-evidence.js';

/** Verbatim output from `tsc`, including the continuation line a real diagnostic carries. */
const REAL_OUTPUT = `src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
  The expected type comes from property 'count' which is declared here on type 'Options'.
src/b.ts(3,1): warning TS6133: 'x' is declared but its value is never read.
src/c.ts(88,17): error TS2345: Argument of type 'Foo' is not assignable to parameter of type 'Bar'.
`;

describe('what the compiler said', () => {
  it('reads every diagnostic, with its location and code', () => {
    const findings = parseTscOutput(REAL_OUTPUT);
    expect(findings.length).toBe(3);
    expect(findings[0]).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      column: 5,
      code: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
      severity: 'error',
    });
    // **The warning is a warning**, because a caller ranking findings needs the compiler's own severity rather than
    // one this code invents.
    expect(findings[1]!.severity).toBe('warning');
    expect(findings[2]!.code).toBe('TS2345');
  });

  it('does not split a diagnostic whose message contains colons and parentheses', () => {
    // **The reason the pattern is anchored on the whole shape**: a message like this one would break a looser scan,
    // **and the second half would become a finding about nothing.**
    const tricky = `src/d.ts(5,9): error TS2769: No overload matches this call: (a: string) => void, (b: number) => void.\n`;
    const findings = parseTscOutput(tricky);
    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain('(a: string) => void');
  });

  it('says nothing about output that is not a diagnostic', () => {
    // **A build tool prints progress, and progress is not a finding.** This is the difference between a parser and a
    // grep.
    expect(parseTscOutput('Compiling...\nDone in 3.2s\n')).toEqual([]);
  });
});

describe('which command to run', () => {
  it('prefers the project script over an assumption', () => {
    // **Asking the project is better than guessing**, because a repository that checks itself with `vue-tsc` would
    // otherwise be misjudged - **and a misjudged typecheck is a finding about nothing.**
    const chosen = chooseTypecheckCommand({ scripts: { typecheck: 'vue-tsc --noEmit' }, devDependencies: { typescript: '^5' } });
    expect(chosen?.fromScript).toBe(true);
    expect(chosen?.args).toContain('typecheck');
  });

  it('falls back to tsc when the project depends on it', () => {
    const chosen = chooseTypecheckCommand({ scripts: {}, devDependencies: { typescript: '^5.4.0' } });
    expect(chosen?.fromScript).toBe(false);
    expect(chosen?.args).toEqual(['--no-install', 'tsc', '--noEmit']);
  });

  it('returns nothing when the project has no TypeScript at all', () => {
    expect(chooseTypecheckCommand({ scripts: {}, dependencies: { express: '^5' } })).toBeNull();
    expect(chooseTypecheckCommand(null)).toBeNull();
  });
});

describe('and when it could not run', () => {
  it('says why rather than reporting a clean build', async () => {
    // **The distinction that matters most here**: a repository with no compiler **is not a repository with no
    // errors**, and **a caller that cannot tell them apart reports the second as the first.**
    const result = await collectCompileEvidence('/tmp', { run: async () => ({ stdout: '', exitCode: 0 }) }, { dependencies: { express: '^5' } });
    expect(result.findings).toEqual([]);
    expect(result.skipped?.reason).toMatch(/no typecheck script/);
  });

  it('reports a timeout as a skip, not as an empty success', async () => {
    const result = await collectCompileEvidence(
      '/tmp',
      { run: () => new Promise(() => {}) },
      { devDependencies: { typescript: '^5' } },
      50,
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped?.reason).toMatch(/did not finish/);
  });

  it('reports a tool that failed without a diagnostic rather than calling it clean', async () => {
    const result = await collectCompileEvidence(
      '/tmp',
      { run: async () => ({ stdout: 'error: could not find tsconfig.json\n', exitCode: 2 }) },
      { devDependencies: { typescript: '^5' } },
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped?.reason).toMatch(/exited 2/);
  });

  it('returns the diagnostics when there are diagnostics', async () => {
    const result = await collectCompileEvidence(
      '/tmp',
      { run: async () => ({ stdout: REAL_OUTPUT, exitCode: 2 }) },
      { devDependencies: { typescript: '^5' } },
    );
    expect(result.skipped).toBeNull();
    expect(result.findings.length).toBe(3);
  });
});
