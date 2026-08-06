// @code-analyzer/intelligence — Sprint A Integration Test

import { describe, it, expect } from 'vitest';
import { TaintPipeline } from '../security/taint-pipeline.js';
import { buildCallGraph } from '../security/taint-pipeline.js';
import {
  buildReducedGraph,
  mapToOriginalNodes,
} from '../community/aggregation.js';
import { createAstContext } from '../rules/ast-rule-checker.js';
import type { FunctionCfg } from '../cfg/types.js';
import type { CallGraphEdge } from '../security/interproc-solver.js';

// ---------------------------------------------------------------------------
// Integration: Verify all Sprint A modules work together
// ---------------------------------------------------------------------------

function cfg(name: string): FunctionCfg {
  return {
    functionName: name, filePath: 'test.ts', startLine: 1, startColumn: 0,
    blocks: [{ index: 0, startLine: 1, endLine: 1, statementCount: 1, isEntry: true, isExit: true }],
    edges: [], bindings: [], entryIndex: 0, exitIndex: 0,
    stmtFacts: { defs: new Map(), uses: new Map(), sourceSites: new Map(), sinkSites: new Map(), sanitizerSites: new Map() },
  };
}

describe('Sprint A Integration', () => {
  it('taint pipeline + call graph builder compose', () => {
    const cfgs = new Map<string, FunctionCfg>();
    cfgs.set('A::fn', cfg('fn'));
    cfgs.set('B::fn', cfg('fn'));

    const cg = buildCallGraph(cfgs);
    const pipeline = new TaintPipeline();
    const result = pipeline.analyze(cfgs, cg);

    expect(result).toBeDefined();
    expect(result.stats).toBeDefined();
  });

  it('community aggregation + taint pipeline are independent', () => {
    // Build a simple adjacency
    const adj = new Map<number, Map<number, number>>();
    adj.set(1, new Map([[2, 1]]));
    adj.set(2, new Map([[1, 1]]));
    const deg = new Map([[1, 1], [2, 1]]);
    const partition = new Map([[1, 0], [2, 0]]);

    // Aggregation should produce a reduced graph
    const reduced = buildReducedGraph(adj, partition, deg);
    expect(reduced.nodes.length).toBe(1);

    // Mapping back should work
    const mapped = mapToOriginalNodes(new Map([[0, 100]]), reduced.communityMembers);
    expect(mapped.get(1)).toBe(100);
    expect(mapped.get(2)).toBe(100);
  });

  it('AST context detects structured elements', () => {
    const ctx = createAstContext(['eval("test");', 'console.log(x);'], 'test.ts', 'typescript');

    // Tree-sitter should be available for TypeScript in test env
    expect(ctx.calls.length + ctx.strings.length + ctx.functions.length).toBeGreaterThan(0);

    // Should detect eval call
    expect(ctx.calls.length).toBeGreaterThan(0);

    // Should detect string literal
    expect(ctx.strings.length).toBeGreaterThan(0);
  });

  it('AST context falls back gracefully for unknown language', () => {
    const ctx = createAstContext(['print "hello"'], 'test.nim', 'nim');
    // No tree-sitter grammar for Nim, but regex should catch the string
    expect(ctx.strings.length).toBeGreaterThan(0);
  });
});
