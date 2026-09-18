// Call sites, built from symbols and references.
//
// The taint subsystem reads `FunctionCfg.callSites` and nothing produced them. The analyser's own CFG cannot supply
// them: `ControlFlowGraph` has no notion of variables or calls. But `ParsedFile.symbols` knows each function's line
// range and a `ReferenceSite` knows each call's line and its target — a call reference inside a function's range is
// a call site of it.
//
// The input is `ReferenceSite` rather than `ResolvedCall` because that is what the pipeline has in hand: a
// `ResolvedCall` would have to be constructed from one, which is a conversion invented to satisfy a signature.
//
// These are the cases that decide whether the lookup is right: inside, outside, nested, non-call, non-callable,
// two files, two calls, no calls, two functions, and all references filtered out.

import { describe, it, expect } from 'vitest';

import { buildCallSites } from '../resolution/call-sites.js';

import type { ParsedFile, ReferenceSite, SymbolDefinition } from '@code-analyzer/shared';

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

/** A call reference, which is what the module reads. */
function call(sourceLine: number, targetName: string, sourceFile = 'src/a.ts'): ReferenceSite {
  return {
    sourceFile,
    sourceLine,
    sourceColumn: 0,
    targetName,
    referenceKind: 'call',
  } as ReferenceSite;
}

/** A reference that is not a call, which the module must ignore. */
function access(sourceLine: number, targetName: string, sourceFile = 'src/a.ts'): ReferenceSite {
  return {
    sourceFile,
    sourceLine,
    sourceColumn: 0,
    targetName,
    referenceKind: 'access',
  } as ReferenceSite;
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

  it('ignores references that are not calls', () => {
    // `targetName` is always a string, so an "unnamed call" does not exist here; what the module filters on is the
    // reference kind.
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [access(12, 'value')],
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

  it('groups two calls in the same file under the same function', () => {
    // Covers the bucket path: the second call for a file must join the first rather than replace it.
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [call(12, 'query'), call(14, 'save')],
    );

    expect(sites.get('file:src/a.ts:handler')?.map((c) => c.calleeName)).toEqual(['query', 'save']);
  });

  it('skips a file that has symbols but no references', () => {
    // The first branch: `!calls` — a parsed file the resolver produced no calls for.
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)], 'src/quiet.ts')],
      [call(12, 'query')],
    );

    expect(sites.size).toBe(0);
  });

  it('gives each function in a file its own entry', () => {
    // Covers the second `out.get`: two functions in one file that both contain calls.
    const sites = buildCallSites(
      [parsed([symbol('first', 'Function', 1, 10), symbol('second', 'Function', 20, 30)])],
      [call(5, 'a'), call(25, 'b')],
    );

    expect(sites.get('file:src/a.ts:first')?.map((c) => c.calleeName)).toEqual(['a']);
    expect(sites.get('file:src/a.ts:second')?.map((c) => c.calleeName)).toEqual(['b']);
  });

  it('skips a symbol with no qualified name', () => {
    // `hasQualifiedName` guards a symbol the extractor produced without one. Such a symbol cannot be keyed, so its
    // calls are dropped rather than filed under an empty string.
    const anonymous = {
      ...symbol('anon', 'Function', 10, 20),
      qualifiedName: '',
    } as SymbolDefinition;
    const sites = buildCallSites([parsed([anonymous])], [call(12, 'query')]);

    expect(sites.size).toBe(0);
  });

  it('writes no key when a function contains only non-call references', () => {
    // Covers the final guard: `existing` stays empty when every reference was filtered out, so no key is written.
    const sites = buildCallSites(
      [parsed([symbol('handler', 'Function', 10, 20)])],
      [access(12, 'a'), access(14, 'b')],
    );

    expect(sites.size).toBe(0);
  });
});
