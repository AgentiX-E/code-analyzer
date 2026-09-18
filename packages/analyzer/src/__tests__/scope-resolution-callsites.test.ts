// The scope-resolution phase now keeps the calls it resolves.
//
// It always resolved them — inline, in about sixty lines, to build CALLS edges — and then stored a count:
//
//   ctx.phaseData.set('scopeResolution', { referencesResolved });
//
// The resolved calls were thrown away. The CFG-based taint subsystem reads `FunctionCfg.callSites` and had nothing
// producing them, and the two halves of this were in the same package without meeting: the parsed files with their
// symbols, and the references with their kinds and lines.
//
// These tests run the phase, with a graph empty enough that its own loops skip, so the assertions are about the
// part added: that call sites are computed from what the phase already had, and that both exits carry the same
// shape so a consumer can tell "none" from "not computed".

import { describe, it, expect } from 'vitest';

import { ScopeResolutionPhase } from '../pipeline/phases/scope-resolution.js';

import type {
  KnowledgeGraph,
  ParsedFile,
  PipelineContext,
  ReferenceSite,
} from '@code-analyzer/shared';
import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

function symbol(name: string, startLine: number, endLine: number) {
  return {
    name,
    kind: 'Function',
    qualifiedName: `file:src/a.ts:${name}`,
    startLine,
    endLine,
    isExported: true,
    properties: {},
  };
}

function reference(
  line: number,
  targetName: string,
  kind: ReferenceSite['referenceKind'],
): ReferenceSite {
  return {
    sourceFile: 'src/a.ts',
    sourceLine: line,
    sourceColumn: 0,
    targetName,
    referenceKind: kind,
  };
}

function parsed(references: ReferenceSite[]): ParsedFile {
  return {
    filePath: 'src/a.ts',
    language: 'typescript',
    symbols: [symbol('handler', 10, 20)],
    references,
    scopeTree: {},
    ast: null,
  } as unknown as ParsedFile;
}

function context(parsedFiles: ParsedFile[] | undefined): PipelineContext {
  return {
    projectId: 'test-project',
    rootPath: '/tmp/test-project',
    phaseData: new Map<string, unknown>(parsedFiles ? [['parse', { parsedFiles }]] : []),
    config: {} as CodeAnalyzerConfig,
    // The phase reads `fileIndex` and `nodes`; with both empty its own loops skip, which is what isolates the
    // assertion to the part added.
    graph: { fileIndex: new Map(), nodes: new Map() } as unknown as KnowledgeGraph,
  } as PipelineContext;
}

describe('ScopeResolutionPhase', () => {
  it('stores the call sites it can derive from the parsed files and references', async () => {
    const ctx = context([parsed([reference(12, 'query', 'call')])]);

    const result = await new ScopeResolutionPhase().execute(ctx);
    const stored = ctx.phaseData.get('scopeResolution') as {
      callSites: Map<string, unknown[]>;
      callSiteCount: number;
    };

    expect(result.status).toBe('success');
    expect(stored.callSiteCount).toBe(1);
    expect(stored.callSites.get('file:src/a.ts:handler')).toHaveLength(1);
    expect(result.output).toMatchObject({ callSiteCount: 1 });
  });

  it('ignores references that are not calls', async () => {
    const ctx = context([parsed([reference(12, 'value', 'access')])]);

    await new ScopeResolutionPhase().execute(ctx);
    const stored = ctx.phaseData.get('scopeResolution') as { callSiteCount: number };

    expect(stored.callSiteCount).toBe(0);
  });

  it('reports a count of zero when there is nothing to resolve, with the same shape as the success path', async () => {
    // The early exit must not be distinguishable from "resolved, and there were none" — otherwise a consumer cannot
    // tell whether the phase ran.
    const result = await new ScopeResolutionPhase().execute(context(undefined));

    expect(result.status).toBe('success');
    expect(result.output).toEqual({ referencesResolved: 0, callSiteCount: 0 });
  });
});
