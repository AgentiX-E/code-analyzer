// `FunctionCfg`s from parsed files — the first ones this repository has built outside a fixture.
//
// The tests assert what is true, including what is not yet true: the CFG names and line ranges are real, the call
// sites are attached, and `stmtFacts` is empty because that needs statement-level analysis over an untyped AST.
// Saying so in a test is what keeps it from being quietly filled in later with something plausible.

import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs, isCallableSymbol } from '../cfg/from-parsed-files.js';

import type { CallSite, NodeLabel, ParsedFile, SymbolDefinition } from '@code-analyzer/shared';

function symbol(
  name: string,
  kind: NodeLabel,
  startLine: number,
  endLine: number,
): SymbolDefinition {
  return {
    name,
    kind,
    qualifiedName: `file:src/a.ts:${name}`,
    startLine,
    endLine,
    isExported: true,
    properties: {},
  };
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

function callSite(line: number, calleeName: string): CallSite {
  return { blockIndex: 0, stmtIndex: 0, line, calleeName, argBindings: [], resultBinding: -1 };
}

describe('buildFunctionCfgs', () => {
  it('builds one CFG per callable symbol, keyed by qualified name', () => {
    const cfgs = buildFunctionCfgs(
      [parsed([symbol('handler', 'Function', 10, 20), symbol('Config', 'Class', 1, 50)])],
      new Map(),
    );

    expect([...cfgs.keys()]).toEqual(['file:src/a.ts:handler']);
    expect(cfgs.get('file:src/a.ts:handler')?.functionName).toBe('handler');
    expect(cfgs.get('file:src/a.ts:handler')?.filePath).toBe('src/a.ts');
  });

  it('spans the function with a single block whose line range matches the symbol', () => {
    const cfg = buildFunctionCfgs([parsed([symbol('handler', 'Function', 10, 20)])], new Map()).get(
      'file:src/a.ts:handler',
    );

    expect(cfg?.blocks).toEqual([
      { index: 0, startLine: 10, endLine: 20, statementCount: 11, isEntry: true, isExit: true },
    ]);
    expect(cfg?.entryIndex).toBe(0);
    expect(cfg?.exitIndex).toBe(0);
  });

  it('attaches the call sites computed for that function', () => {
    const cfgs = buildFunctionCfgs(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      new Map([['file:src/a.ts:handler', [callSite(12, 'query')]]]),
    );

    expect(cfgs.get('file:src/a.ts:handler')?.callSites).toEqual([callSite(12, 'query')]);
  });

  it('gives a function with no call sites an empty list, rather than omitting the field', () => {
    const cfg = buildFunctionCfgs([parsed([symbol('handler', 'Function', 10, 20)])], new Map()).get(
      'file:src/a.ts:handler',
    );

    expect(cfg?.callSites).toEqual([]);
  });

  it('leaves stmtFacts empty, and says so in the assertion', () => {
    // This is the limit, not an oversight: defs, uses and the source and sink sites need statement-level analysis
    // over `ParsedFile.ast`, which is `unknown`, and a source-and-sink model per language. Until then the
    // propagator will find no flows through these CFGs — but the pipeline is fed, and `resolved` has an answer.
    const cfg = buildFunctionCfgs([parsed([symbol('handler', 'Function', 10, 20)])], new Map()).get(
      'file:src/a.ts:handler',
    );

    expect(cfg?.stmtFacts.defs.size).toBe(0);
    expect(cfg?.stmtFacts.uses.size).toBe(0);
    expect(cfg?.stmtFacts.sourceSites.size).toBe(0);
    expect(cfg?.stmtFacts.sinkSites.size).toBe(0);
    expect(cfg?.bindings).toEqual([]);
  });

  it('skips a symbol with no qualified name', () => {
    const anonymous = {
      ...symbol('anon', 'Function', 1, 5),
      qualifiedName: '',
    };

    expect(buildFunctionCfgs([parsed([anonymous])], new Map()).size).toBe(0);
  });

  it('agrees with isCallableSymbol about what becomes a CFG', () => {
    expect(isCallableSymbol(symbol('f', 'Function', 1, 2))).toBe(true);
    expect(isCallableSymbol(symbol('C', 'Class', 1, 2))).toBe(false);
  });
});
