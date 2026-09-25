// Which analysis the taint tool reports having run, and what it says about the answer's limits.
//
// The tool has two paths: the pipeline's findings, when a run produced them, and a heuristic node walk. The first
// returns the real analysis under `interprocedural-dataflow` and **no note**; the second is unchanged, note and all,
// because the note still describes what that path does. Both halves are asserted here.

import { describe, it, expect } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';

import { taintAnalysis } from '../tools/pdg.js';
import { ToolContextImpl } from '../tools/tool-context.js';

import type { ToolResult } from '../tools/registry.js';
import type { InterprocTaintFinding } from '@code-analyzer/intelligence';

function finding(): InterprocTaintFinding {
  return {
    id: 'file:src/a.js:handler#taint-0-2-0',
    source: {
      bindingIdx: 0,
      point: { blockIndex: 0, stmtIndex: 1, line: 2 },
      category: 'http_request',
      description: 'req.body.id',
      line: 2,
    },
    sink: {
      point: { blockIndex: 0, stmtIndex: 2, line: 3 },
      kind: 'sql_exec',
      description: 'db.query(id)',
      line: 3,
    },
    sourceFn: 'file:src/a.js:handler',
    sinkFn: 'file:src/a.js:handler',
    callChain: ['file:src/a.js:handler'],
    sanitized: false,
    neutralizedKinds: [],
    hops: 1,
    confidence: 1,
  };
}

function context(): ToolContextImpl {
  return new ToolContextImpl(new InMemoryGraphStore());
}

/** The tool's answer, parsed. The payload is JSON in a text part, so the field access is by index. */
function bodyOf(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('taintAnalysis', () => {
  it('returns the pipeline findings under the real method, and drops the note', async () => {
    const ctx = context();
    ctx.taintFindings = [finding()];

    const body = bodyOf(await taintAnalysis({ projectId: 'p' }, ctx));

    expect(body['analysisMethod']).toBe('interprocedural-dataflow');
    expect(body['vulnerablePaths']).toBe(1);
    expect((body['taintPaths'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      sourceFn: 'file:src/a.js:handler',
      sink: { kind: 'sql_exec', line: 3 },
    });
    // **The note is gone**, because it is not true of this answer — and `analysisMethod` is what says so.
    expect(body['note']).toBeUndefined();
  });

  it('filters findings by the requested sink kind, and stays on the real method when none match', async () => {
    const ctx = context();
    ctx.taintFindings = [finding()];

    const other = bodyOf(await taintAnalysis({ projectId: 'p', sinkKind: 'command_exec' }, ctx));

    // An empty answer under the real method, not a fallback to a heuristic that would report noise instead.
    expect(other['analysisMethod']).toBe('interprocedural-dataflow');
    expect(other['vulnerablePaths']).toBe(0);
  });

  it('keeps the note when there are no findings, because it still describes that path', async () => {
    const body = bodyOf(await taintAnalysis({ projectId: 'p' }, context()));

    expect(body['analysisMethod']).toBe('pattern-based-heuristic');
    expect(typeof body['note']).toBe('string');
  });

  it("carries a finding's sanitized flag through to the payload", async () => {
    // **The other end of the chain.** The propagator now decides whether a sanitizer was on the path, and this is
    // whether that decision survives to the caller: the tool maps `sanitized` straight from the finding, so a
    // sanitized flow and an unsanitized one must be distinguishable in what a caller receives.
    const ctx = context();
    ctx.taintFindings = [{ ...finding(), sanitized: true }];

    const body = bodyOf(await taintAnalysis({ projectId: 'p' }, ctx));

    const paths = body['taintPaths'] as Array<Record<string, unknown>>;
    expect(paths[0]?.['sanitized']).toBe(true);
    expect(body['analysisMethod']).toBe('interprocedural-dataflow');
  });
});
