// The entry point, called for the first time outside a test that wrote its own fixtures.
//
// The assertions say what is true including what is not: the functions are built and analysed, the call sites
// reach the solver's summaries, and **no taint crosses a call yet** because `stmtFacts` is empty and a written
// callee name is not a qualified name. Both limits are recorded elsewhere; a test that claimed otherwise would be
// the defect this whole sequence has been removing.

import { describe, it, expect } from 'vitest';

import {
  analyzeInterproceduralTaint,
  toCallGraphEdges,
} from '../security/interprocedural-entry.js';

import type { CallSite, NodeLabel, ParsedFile, SymbolDefinition } from '@code-analyzer/shared';

function symbol(
  name: string,
  startLine: number,
  endLine: number,
  kind: NodeLabel = 'Function',
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

function parsed(symbols: SymbolDefinition[]): ParsedFile {
  return {
    filePath: 'src/a.ts',
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

describe('analyzeInterproceduralTaint', () => {
  it('analyses every function the call sites are keyed by', () => {
    const result = analyzeInterproceduralTaint(
      [parsed([symbol('handler', 10, 20), symbol('helper', 30, 40)])],
      new Map([
        ['file:src/a.ts:handler', [callSite(12, 'helper')]],
        ['file:src/a.ts:helper', []],
      ]),
    );

    expect(result.summariesAnalyzed).toBe(2);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('reports no findings, because stmtFacts is empty and there is nothing to flow', () => {
    // Not a placeholder: `defs`, `uses` and the source and sink sites need statement-level analysis over an untyped
    // AST. Until that exists the propagator has no sources, so a finding here would be a fabrication.
    const result = analyzeInterproceduralTaint(
      [parsed([symbol('handler', 10, 20)])],
      new Map([['file:src/a.ts:handler', [callSite(12, 'query')]]]),
    );

    expect(result.findings).toEqual([]);
  });

  it('handles an empty input without fabricating a result', () => {
    const result = analyzeInterproceduralTaint([], new Map());

    expect(result.summariesAnalyzed).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('takes the call sites from the map rather than from the references', () => {
    // The entry point receives what the phase computed, so a `ParsedFile` with references but an empty map produces
    // no edges — the call sites are the phase's output, not a second derivation.
    const withReferences = {
      ...parsed([symbol('handler', 10, 20)]),
      references: [
        {
          sourceFile: 'src/a.ts',
          sourceLine: 12,
          sourceColumn: 0,
          targetName: 'query',
          referenceKind: 'call',
        },
      ],
    } as unknown as ParsedFile;

    const result = analyzeInterproceduralTaint(
      [withReferences],
      new Map([['file:src/a.ts:handler', []]]),
    );

    expect(result.summariesAnalyzed).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('builds no edges for a function that carries no call sites', () => {
    // `FunctionCfg.callSites` is optional, so a producer may omit it even though the one in this repository always
    // sets it. The guard is required by the type and covered here rather than left unreachable.
    const edges = toCallGraphEdges(new Map([['fn', {}]]));

    expect(edges).toEqual([]);
  });

  it('turns a call site into one edge, carrying the name it has', () => {
    const edges = toCallGraphEdges(
      new Map([['file:src/a.ts:handler', { callSites: [callSite(12, 'helper')] }]]),
    );

    expect(edges).toEqual([
      { callerQn: 'file:src/a.ts:handler', calleeQn: 'helper', callLine: 12, argCount: 0 },
    ]);
  });
});
