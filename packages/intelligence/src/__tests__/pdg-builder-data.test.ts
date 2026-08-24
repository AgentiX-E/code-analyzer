// @code-analyzer/intelligence — PDG Builder Data-Dependence Tests
// Exercises the reaching-definitions → PDG data-edge stitching path and the
// graph query API, which the control-dependence-focused suite does not cover.

import { describe, it, expect } from 'vitest';
import { buildPdg } from '../cfg/pdg-builder.js';
import type {
  FunctionCfg,
  BasicBlock,
  CfgEdge,
  BindingEntry,
  StatementFacts,
} from '../cfg/types.js';

const STRIDE = 1024;

interface BlockSpec {
  index: number;
  statementCount: number;
  isEntry?: boolean;
  isExit?: boolean;
}

interface EdgeSpec {
  from: number;
  to: number;
  kind: CfgEdge['kind'];
}

/** Build a CFG with def/use facts for data-dependence analysis. */
function makeDataCfg(opts: {
  name?: string;
  blockSpecs: BlockSpec[];
  edges: EdgeSpec[];
  defs?: Array<{ block: number; stmt: number; bindingIdx: number; kind: 'must' | 'may' }>;
  uses?: Array<{ block: number; stmt: number; bindingIdx: number }>;
  bindings?: Array<{ index: number; name: string }>;
}): FunctionCfg {
  const blocks: BasicBlock[] = opts.blockSpecs.map((b) => ({
    index: b.index,
    startLine: b.index * 10 + 1,
    endLine: b.index * 10 + b.statementCount,
    statementCount: b.statementCount,
    isEntry: b.isEntry ?? b.index === 0,
    isExit: b.isExit ?? b.index === opts.blockSpecs.length - 1,
  }));

  const edges: CfgEdge[] = opts.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind }));

  const defs = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
      kind: 'must' | 'may';
    }>
  >();
  for (const d of opts.defs ?? []) {
    const key = d.block * STRIDE + d.stmt;
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key)!.push({
      point: { blockIndex: d.block, stmtIndex: d.stmt, line: d.block * 10 + d.stmt + 1 },
      bindingIdx: d.bindingIdx,
      kind: d.kind,
    });
  }

  const uses = new Map<
    number,
    Array<{
      point: { blockIndex: number; stmtIndex: number; line: number };
      bindingIdx: number;
    }>
  >();
  for (const u of opts.uses ?? []) {
    const key = u.block * STRIDE + u.stmt;
    if (!uses.has(key)) uses.set(key, []);
    uses.get(key)!.push({
      point: { blockIndex: u.block, stmtIndex: u.stmt, line: u.block * 10 + u.stmt + 1 },
      bindingIdx: u.bindingIdx,
    });
  }

  const bindings: BindingEntry[] = (opts.bindings ?? [{ index: 0, name: 'x' }]).map((b) => ({
    index: b.index,
    name: b.name,
    kind: 'local',
    declLine: 1,
    declColumn: 1,
    synthetic: false,
  }));

  const stmtFacts: StatementFacts = {
    defs,
    uses,
    sourceSites: new Map(),
    sinkSites: new Map(),
    sanitizerSites: new Map(),
  };

  return {
    functionName: opts.name ?? 'data',
    filePath: 'test.ts',
    startLine: 1,
    startColumn: 1,
    blocks,
    edges,
    bindings,
    stmtFacts,
    entryIndex: 0,
    exitIndex: opts.blockSpecs.length - 1,
  };
}

describe('buildPdg — data dependence', () => {
  it('stitches def→use facts into data edges', () => {
    const cfg = makeDataCfg({
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 1, isExit: true },
      ],
      edges: [{ from: 0, to: 1, kind: 'seq' }],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
      uses: [{ block: 1, stmt: 0, bindingIdx: 0 }],
    });

    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.dataFacts.length).toBeGreaterThan(0);
    const dataEdges = pdg.edges.filter((e) => e.kind === 'data');
    expect(dataEdges.length).toBeGreaterThan(0);
    expect(dataEdges[0]!.label).toBe('var_0');
  });

  it('does not create a data edge when def and use share a site', () => {
    const cfg = makeDataCfg({
      blockSpecs: [{ index: 0, statementCount: 1, isEntry: true, isExit: true }],
      edges: [],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
      uses: [{ block: 0, stmt: 0, bindingIdx: 0 }],
    });

    const pdg = buildPdg(cfg, 'test.ts');
    // A use in the same statement as its def has no distinct source site.
    const dataEdges = pdg.edges.filter((e) => e.kind === 'data');
    expect(dataEdges).toHaveLength(0);
  });
});

describe('buildPdg — query API', () => {
  const cfg = makeDataCfg({
    name: 'query',
    blockSpecs: [
      { index: 0, statementCount: 1, isEntry: true },
      { index: 1, statementCount: 1, isExit: true },
    ],
    edges: [{ from: 0, to: 1, kind: 'seq' }],
    defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
    uses: [{ block: 1, stmt: 0, bindingIdx: 0 }],
  });
  const pdg = buildPdg(cfg, 'test.ts');

  it('queryData returns defs matching the given site', () => {
    const r = pdg.queryData({ blockIndex: 0, stmtIndex: 0, bindingIdx: 0, direction: 'defs' });
    expect(r.dataFacts.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it('queryData returns uses matching the given site', () => {
    const r = pdg.queryData({ blockIndex: 1, stmtIndex: 0, bindingIdx: 0, direction: 'uses' });
    expect(r.dataFacts.length).toBeGreaterThan(0);
  });

  it('queryData returns empty for an unmatched binding index', () => {
    const r = pdg.queryData({ blockIndex: 0, stmtIndex: 0, bindingIdx: 99, direction: 'defs' });
    expect(r.dataFacts).toHaveLength(0);
  });

  it('getDataDependents returns use sites of a def site', () => {
    const dependents = pdg.getDataDependents(0, 0);
    expect(dependents.length).toBeGreaterThan(0);
  });

  it('getDataDependents returns empty for an unknown site', () => {
    expect(pdg.getDataDependents(42, 42)).toEqual([]);
  });

  it('getDataSources returns def sites of a use site', () => {
    const sources = pdg.getDataSources(1, 0);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('getDataSources returns empty for an unknown site', () => {
    expect(pdg.getDataSources(42, 42)).toEqual([]);
  });

  it('queryControl supports the controllers direction', () => {
    // Build a branchy CFG so a control edge exists to query in reverse.
    const branchCfg = makeDataCfg({
      name: 'branch',
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 1 },
        { index: 2, statementCount: 1, isExit: true },
      ],
      edges: [
        { from: 0, to: 1, kind: 'cond-true' },
        { from: 0, to: 2, kind: 'cond-false' },
        { from: 1, to: 2, kind: 'seq' },
      ],
    });
    const branchPdg = buildPdg(branchCfg, 'test.ts');
    const dependents = branchPdg.queryControl({ controllerBlock: 0, direction: 'dependents' });
    expect(dependents.controlEdges.length).toBeGreaterThan(0);

    const controllers = branchPdg.queryControl({ controllerBlock: 1, direction: 'controllers' });
    // Reverse query keys on dependentBlock; at least one edge targets block 1.
    expect(controllers.controlEdges.length).toBeGreaterThan(0);
  });
});

describe('buildPdg — empty graph & defaults', () => {
  it('makeEmptyGraph query methods are safe no-ops', () => {
    const empty: FunctionCfg = {
      functionName: 'empty',
      filePath: 'test.ts',
      startLine: 0,
      startColumn: 0,
      blocks: [],
      edges: [],
      bindings: [],
      entryIndex: -1,
      exitIndex: -1,
      stmtFacts: {
        defs: new Map(),
        uses: new Map(),
        sourceSites: new Map(),
        sinkSites: new Map(),
        sanitizerSites: new Map(),
      },
    };
    const pdg = buildPdg(empty, 'test.ts');
    expect(pdg.nodeCount).toBe(2);
    expect(pdg.edgeCount).toBe(0);
    expect(pdg.queryControl({ controllerBlock: 0, direction: 'dependents' }).controlEdges).toEqual(
      [],
    );
    expect(
      pdg.queryData({ blockIndex: 0, stmtIndex: 0, bindingIdx: 0, direction: 'defs' }).dataFacts,
    ).toEqual([]);
    expect(pdg.getControlDependents(0)).toEqual([]);
    expect(pdg.getDataDependents(0, 0)).toEqual([]);
    expect(pdg.getDataSources(0, 0)).toEqual([]);
  });

  it('falls back to <anonymous> when no function name is provided', () => {
    const cfg = makeDataCfg({ name: undefined, blockSpecs: [], edges: [] });
    const noName = { ...cfg, functionName: undefined as unknown as string };
    const pdg = buildPdg(noName, 'test.ts');
    expect(pdg.functionName).toBe('<anonymous>');
  });

  it('prefers the explicit functionName argument over cfg.functionName', () => {
    const cfg = makeDataCfg({ name: 'fromCfg', blockSpecs: [], edges: [] });
    const pdg = buildPdg(cfg, 'test.ts', 'fromArg');
    expect(pdg.functionName).toBe('fromArg');
  });

  it('accepts a maxEdges option without throwing', () => {
    const cfg = makeDataCfg({
      name: 'capped',
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 1, isExit: true },
      ],
      edges: [{ from: 0, to: 1, kind: 'seq' }],
    });
    const pdg = buildPdg(cfg, 'test.ts', undefined, { maxEdges: 5 });
    expect(pdg.nodeCount).toBeGreaterThanOrEqual(2);
  });

  it('computes nodeCount and edgeCount getters', () => {
    const cfg = makeDataCfg({
      blockSpecs: [
        { index: 0, statementCount: 1, isEntry: true },
        { index: 1, statementCount: 1, isExit: true },
      ],
      edges: [{ from: 0, to: 1, kind: 'seq' }],
      defs: [{ block: 0, stmt: 0, bindingIdx: 0, kind: 'must' }],
      uses: [{ block: 1, stmt: 0, bindingIdx: 0 }],
    });
    const pdg = buildPdg(cfg, 'test.ts');
    expect(pdg.nodeCount).toBe(pdg.nodes.length);
    expect(pdg.edgeCount).toBe(pdg.edges.length);
  });
});
