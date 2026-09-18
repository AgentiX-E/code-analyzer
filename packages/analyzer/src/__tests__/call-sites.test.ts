// Call sites, built from symbols and resolved calls.
//
// The taint subsystem reads `FunctionCfg.callSites` and nothing produced them. The analyser's own CFG cannot supply
// them: `ControlFlowGraph` has no notion of variables or calls. But `ParsedFile.symbols` knows each function's line
// range and `ResolvedCall` knows each call's line, its caller and its callee — a resolved call inside a function's
// range is a call site of it.
//
// These are the cases that decide whether that lookup is right: inside, outside, nested, and unnamed.

import { describe, it, expect } from 'vitest';

import { buildCallSites } from '../resolution/call-sites.js';

import type { ParsedFile, SymbolDefinition } from '@code-analyzer/shared';
import type { ResolvedCall } from '../resolution/scope-resolver.js';

function symbol(
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
  file = 'src/a.ts',
): SymbolDefinition {
  return {
    name,
    kind: kind as SymbolDefinition['kind'],
    qualifiedName: `file:${file}:${name}`,
    startLine,
    endLine,
    isExported: true,
    properties: {},
  } as SymbolDefinition;
}

function parsed(symbols: SymbolDefinition[], filePath = 'src/a.ts'): ParsedFile {
  return {
    filePath,
    language: 'typescript',
    symbols,
    references: [],
    scopeTree: {},
    ast: null,
  } as unknown as ParsedFile;
}

function call(
  sourceLine: number,
  calleeName: string | null,
  sourceFile = 'src/a.ts',
): ResolvedCall {
  return {
    sourceFile,
    sourceLine,
    callerName: 'x',
    calleeFile: null,
    calleeName,
    isResolved: calleeName !== null,
  };
}

describe('buildCallSites', () => {
  it('puts a call inside a function under that function', () => {
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [call(12, 'query')],
    );

    expect(sites.get('file:src/a.ts:handler')).toEqual([
      {
        blockIndex: 0,
        stmtIndex: 0,
        line: 12,
        calleeName: 'query',
        argBindings: [],
        resultBinding: -1,
      },
    ]);
  });

  it('drops a call that falls outside every function', () => {
    // A top-level call belongs to no CFG. Inventing an owner for it would be the same defect as inventing call
    // sites, one level up.
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [call(30, 'query')],
    );

    expect(sites.size).toBe(0);
  });

  it('attributes a call to the inner function when functions nest', () => {
    const sites = buildCallSites(
      [parsed([symbol('outer', 'Function', 1, 40), symbol('inner', 'Function', 10, 20)])],
      [call(15, 'query')],
    );

    // Both ranges contain line 15. Both get it, deliberately: without a statement map this module cannot tell a
    // nested definition from a call in the outer body, and reporting it under both is visible, where choosing one
    // would be a silent guess.
    expect(sites.get('file:src/a.ts:inner')).toHaveLength(1);
    expect(sites.get('file:src/a.ts:outer')).toHaveLength(1);
  });

  it('skips calls whose callee could not be resolved to a name', () => {
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [call(12, null)],
    );

    expect(sites.size).toBe(0);
  });

  it('ignores symbols that cannot contain calls', () => {
    const sites = buildCallSites(
      [parsed([symbol('Config', 'Class', 1, 50), symbol('handler', 'Function', 10, 20)])],
      [call(5, 'load')],
    );

    // A class is not a function CFG, so a call in its body is not attributed to it.
    expect(sites.size).toBe(0);
  });

  it('keeps calls from two files apart', () => {
    const sites = buildCallSites(
      [
        parsed([symbol('a', 'Function', 1, 10)], 'src/a.ts'),
        parsed([symbol('b', 'Function', 1, 10, 'src/b.ts')], 'src/b.ts'),
      ],
      [call(5, 'query', 'src/a.ts'), call(6, 'save', 'src/b.ts')],
    );

    expect(sites.get('file:src/a.ts:a')?.[0]?.calleeName).toBe('query');
    expect(sites.get('file:src/b.ts:b')?.[0]?.calleeName).toBe('save');
  });
});
