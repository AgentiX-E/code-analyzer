// @code-analyzer/intelligence — AST Security Rules Branch-Coverage Tests
// Exercises the remaining uncovered branches: comment-skip guards, the
// `?? ''` line-out-of-range fallbacks, environment-reference short-circuits,
// backtick template-literal secrets, and the deserialization try/catch scan.

import { describe, it, expect } from 'vitest';
import {
  checkNoDebugAst,
  checkHardcodedSecretsAst,
  checkUnsafeDeserializationAst,
  checkWeakCryptoAst,
  checkHttpUrlAst,
  checkUnsafeOptionalChainingAst,
} from '../rules/ast-security-rules.js';
import type { AstRuleContext } from '../rules/ast-rule-checker.js';

function makeCtx(overrides: Partial<AstRuleContext> = {}): AstRuleContext {
  return {
    lines: [],
    filePath: 'src/app.ts',
    language: 'typescript',
    hasAst: false,
    calls: [],
    strings: [],
    imports: [],
    assignments: [],
    functions: [],
    ...overrides,
  };
}

function consoleCall(line: number): AstRuleContext['calls'][number] {
  return { name: 'log', object: 'console', text: 'console.log()', line, arguments: [] };
}

describe('checkNoDebugAst', () => {
  it('skips a console call that sits on a commented line', () => {
    const ctx = makeCtx({ lines: ['// console.log("x")'], calls: [consoleCall(1)] });
    expect(checkNoDebugAst(ctx)).toHaveLength(0);
  });

  it('flags a console call whose line is beyond the provided lines', () => {
    const ctx = makeCtx({ lines: ['foo'], calls: [consoleCall(5)] });
    const r = checkNoDebugAst(ctx);
    expect(r).toHaveLength(1);
    expect(r[0]!.ruleId).toBe('no-debug-statement');
  });
});

describe('checkHardcodedSecretsAst', () => {
  it('skips an assignment that sits on a commented line', () => {
    const ctx = makeCtx({
      lines: ['// const p = "secret"'],
      assignments: [{ name: 'password', value: '"secret"', line: 1 }],
    });
    expect(checkHardcodedSecretsAst(ctx)).toHaveLength(0);
  });

  it('skips a process.env reference', () => {
    const ctx = makeCtx({
      lines: ['const p = process.env.SECRET'],
      assignments: [{ name: 'password', value: 'process.env.SECRET', line: 1 }],
    });
    expect(checkHardcodedSecretsAst(ctx)).toHaveLength(0);
  });

  it('flags a backtick template-literal secret', () => {
    const ctx = makeCtx({
      lines: ['const p = `s3cr3t`'],
      assignments: [{ name: 'password', value: '`s3cr3t`', line: 1 }],
    });
    expect(checkHardcodedSecretsAst(ctx)).toHaveLength(1);
  });

  it('flags an assignment whose line is beyond the provided lines', () => {
    const ctx = makeCtx({
      lines: ['foo'],
      assignments: [{ name: 'password', value: '"secret"', line: 5 }],
    });
    expect(checkHardcodedSecretsAst(ctx)).toHaveLength(1);
  });
});

describe('checkUnsafeDeserializationAst', () => {
  it('flags JSON.parse without a nearby try block', () => {
    const ctx = makeCtx({ lines: ['const a = 1;', 'JSON.parse(s);'] });
    expect(checkUnsafeDeserializationAst(ctx)).toHaveLength(1);
  });

  it('stops the backward scan at a closing brace', () => {
    const ctx = makeCtx({ lines: ['}', 'JSON.parse(s);'] });
    expect(checkUnsafeDeserializationAst(ctx)).toHaveLength(1);
  });

  it('accepts JSON.parse guarded by a try block', () => {
    const ctx = makeCtx({ lines: ['try {', 'JSON.parse(s);'] });
    expect(checkUnsafeDeserializationAst(ctx)).toHaveLength(0);
  });
});

describe('checkWeakCryptoAst', () => {
  it('handles a createHash call with no algorithm argument', () => {
    const ctx = makeCtx({
      lines: ['createHash()'],
      calls: [{ name: 'createHash', object: null, text: 'createHash()', line: 1, arguments: [] }],
    });
    expect(checkWeakCryptoAst(ctx)).toHaveLength(0);
  });
});

describe('checkHttpUrlAst', () => {
  it('skips a string literal that sits on a commented line', () => {
    const ctx = makeCtx({
      lines: ['// "http://example.com"'],
      strings: [{ value: 'http://example.com', text: '"http://example.com"', line: 1 }],
    });
    expect(checkHttpUrlAst(ctx)).toHaveLength(0);
  });

  it('flags a string literal whose line is beyond the provided lines', () => {
    const ctx = makeCtx({
      lines: ['foo'],
      strings: [{ value: 'http://example.com', text: '"http://example.com"', line: 5 }],
    });
    expect(checkHttpUrlAst(ctx)).toHaveLength(1);
  });
});

describe('checkUnsafeOptionalChainingAst', () => {
  it('skips a commented line', () => {
    const ctx = makeCtx({ lines: ['// a?.b'] });
    expect(checkUnsafeOptionalChainingAst(ctx)).toHaveLength(0);
  });
});
