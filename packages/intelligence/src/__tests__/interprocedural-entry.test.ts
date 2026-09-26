// The entry point, called for the first time outside a test that wrote its own fixtures.
//
// The assertions say what is true including what is not: the functions are built and analysed, the call sites
// reach the solver's summaries, and **no taint crosses a call yet** because `stmtFacts` is empty and a written
// callee name is not a qualified name. Both limits are recorded elsewhere; a test that claimed otherwise would be
// the defect this whole sequence has been removing.

import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';
import {
  analyzeInterproceduralTaint,
  toCallGraphEdges,
  resolveCallSites,
} from '../security/interprocedural-entry.js';

import type { CallSite, NodeLabel, ParsedFile, SymbolDefinition } from '@code-analyzer/shared';
import { TaintPropagator } from '../security/taint-propagator.js';

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

  it('rewrites a unique callee name to its qualified name, which is what makes resolution reachable', () => {
    const cfgs = buildFunctionCfgs(
      [parsed([symbol('handler', 10, 20), symbol('helper', 30, 40)])],
      new Map([['file:src/a.ts:handler', [callSite(12, 'helper')]]]),
    );

    const resolved = resolveCallSites(cfgs);

    expect(resolved.get('file:src/a.ts:handler')?.callSites?.[0]?.calleeName).toBe(
      'file:src/a.ts:helper',
    );
  });

  it('leaves an ambiguous callee exactly as written', () => {
    // Two functions answer to `helper`, so neither is chosen. The call stays unresolved and visible; guessing would
    // attach taint to a function the call may not reach.
    const cfgs = buildFunctionCfgs(
      [parsed([symbol('handler', 10, 20)])],
      new Map([['file:src/a.ts:handler', [callSite(12, 'helper')]]]),
    );
    const withDuplicate = new Map(cfgs);
    withDuplicate.set('file:src/b.ts:helper', {
      ...cfgs.get('file:src/a.ts:handler')!,
      functionName: 'helper',
    });

    // Both functions must answer to `helper` for it to be ambiguous. My first version renamed only the
    // added one, so `helper` was unique and resolved correctly: the assertion was right, the fixture wrong.
    withDuplicate.set('file:src/a.ts:handler', {
      ...cfgs.get('file:src/a.ts:handler')!,
      functionName: 'helper',
    });

    const resolved = resolveCallSites(withDuplicate);

    expect(resolved.get('file:src/a.ts:handler')?.callSites?.[0]?.calleeName).toBe('helper');
  });

  it('leaves a function whose call sites are absent without any, rather than inventing them', () => {
    // `FunctionCfg.callSites` is optional, so `resolveCallSites` must tolerate its absence even though the producer
    // in this repository always sets it. The guard is required by the type, and this is where it is exercised.
    const cfgs = buildFunctionCfgs([parsed([symbol('handler', 10, 20)])], new Map());
    const withoutSites = new Map(
      [...cfgs].map(([qualifiedName, cfg]) => [qualifiedName, { ...cfg, callSites: undefined }]),
    );

    const resolved = resolveCallSites(withoutSites);

    expect(resolved.get('file:src/a.ts:handler')?.callSites).toEqual([]);
  });

  describe('the sanitizer path check', () => {
    /**
     * Both halves of `isNeutralized`'s answer, which the end-to-end file only exercises in the positive.
     *
     * The function walks the sanitizer index looking for one whose statement lies between the source's and the sink's.
     * A sanitizer outside that range must be skipped rather than counted, and an empty index must answer false rather
     * than throw or default to true - **a sanitizer check that says yes when it has found nothing is worse than no
     * check at all**, because it would report every flow as neutralised.
     */

    it('does not count a sanitizer outside the source-to-sink range', () => {
      const propagator = new TaintPropagator();
      const occurrences = new Map([
        // Two statements past the sink: skipped by the range test rather than accepted.
        [
          9,
          [
            {
              point: { blockIndex: 0, stmtIndex: 9, line: 11 },
              neutralizedKinds: new Set(['escaping']),
              description: 'escape',
            },
          ],
        ],
      ]);

      const answer = (
        propagator as unknown as {
          isNeutralized(index: Map<number, unknown[]>, from: number, to: number): boolean;
        }
      ).isNeutralized(occurrences, 1, 2);

      expect(answer).toBe(false);
    });

    it('answers false for an empty index rather than defaulting to true', () => {
      const propagator = new TaintPropagator();

      const answer = (
        propagator as unknown as {
          isNeutralized(index: Map<number, unknown[]>, from: number, to: number): boolean;
        }
      ).isNeutralized(new Map(), 1, 5);

      expect(answer).toBe(false);
    });

    it('counts a sanitizer on either bound, because both ends are real', () => {
      const propagator = new TaintPropagator();
      const occurrence = [
        {
          point: { blockIndex: 0, stmtIndex: 2, line: 3 },
          neutralizedKinds: new Set(['escaping']),
          description: 'escape',
        },
      ];
      const at = (index: number): Map<number, unknown[]> => new Map([[index, occurrence]]);
      const ask = (from: number, to: number): boolean =>
        (
          propagator as unknown as {
            isNeutralized(index: Map<number, unknown[]>, from: number, to: number): boolean;
          }
        ).isNeutralized(at(2), from, to);

      expect(ask(2, 5)).toBe(true); // on the source's own statement
      expect(ask(1, 2)).toBe(true); // on the sink's
      expect(ask(3, 5)).toBe(false); // strictly between the sink's and beyond nothing
    });
  });
});
