// @code-analyzer/intelligence — Program Dependence Graph Builder
// Composes control dependence edges from CDG and data dependence facts
// from reaching definitions into a unified statement-level PDG.
//
// Reference: Ferrante, Ottenstein & Warren (1987) "The Program Dependence
// Graph and Its Use in Optimization."

import type {
  FunctionCfg,
  ControlDepEdge,
  DefUseFact,
  PdgControlQuery,
  PdgDataQuery,
  PdgQueryResult,
} from './types.js';
import { computePostDominators } from './post-dominators.js';
import { computeControlDependence } from './control-dependence.js';
import { computeReachingDefinitions } from './reaching-defs.js';

// ---------------------------------------------------------------------------
// PDG Node
// ---------------------------------------------------------------------------

/** A node in the PDG — corresponds to a definition or use site. */
export interface PdgNode {
  /** Unique node ID. */
  readonly nodeId: number;
  /** Block index in the CFG. */
  readonly blockIndex: number;
  /** Statement index within the block (-1 for synthetic entry/exit). */
  readonly stmtIndex: number;
  /** Node kind. */
  readonly kind: 'entry' | 'exit' | 'def' | 'use' | 'branch';
  /** Source line (1-based, 0 if synthetic). */
  readonly line: number;
}

// ---------------------------------------------------------------------------
// PDG Edge
// ---------------------------------------------------------------------------

/** A directed edge in the PDG. */
export interface PdgEdge {
  readonly sourceId: number;
  readonly targetId: number;
  readonly kind: 'control' | 'data' | 'loop-carried';
  readonly label: string;
}

// ---------------------------------------------------------------------------
// PDG Graph
// ---------------------------------------------------------------------------

/** Program Dependence Graph with query capabilities. */
export interface PdgGraph {
  readonly functionName: string;
  readonly filePath: string;
  readonly nodes: readonly PdgNode[];
  readonly edges: readonly PdgEdge[];
  readonly controlEdges: readonly ControlDepEdge[];
  readonly dataFacts: readonly DefUseFact[];
  readonly nodeCount: number;
  readonly edgeCount: number;

  /** Query control dependence. */
  queryControl(query: PdgControlQuery): PdgQueryResult;
  /** Query data dependence. */
  queryData(query: PdgDataQuery): PdgQueryResult;
  /** Get all nodes that are control-dependent on the given node. */
  getControlDependents(nodeId: number): number[];
  /** Get all nodes that use the def at (block, stmt). */
  getDataDependents(blockIndex: number, stmtIndex: number): number[];
  /** Get all defs that the use at (block, stmt) depends on. */
  getDataSources(blockIndex: number, stmtIndex: number): number[];
}

// ---------------------------------------------------------------------------
// Internal augmented node
// ---------------------------------------------------------------------------

interface InternalNode extends PdgNode {
  controlDependents: Set<number>;
  controllers: Set<number>;
  dataTargets: Set<number>;
  dataSources: Set<number>;
}

// ===========================================================================
// Builder
// ===========================================================================

/**
 * Build a PDG for a single function CFG.
 *
 * Computes post-dominators, control dependence edges, and reaching
 * definitions, then stitches them together into a unified graph with
 * statement-level granularity.
 */
export function buildPdg(
  cfg: FunctionCfg,
  filePath: string,
  functionName?: string,
  options?: { maxEdges?: number },
): PdgGraph {
  const maxEdges = options?.maxEdges ?? 1000;
  const funcName = functionName ?? cfg.functionName ?? '<anonymous>';

  if (cfg.blocks.length === 0) {
    return makeEmptyGraph(funcName, filePath);
  }

  // Phase 1: Post-dominators
  const postDom = computePostDominators(cfg);

  // Phase 2: Control dependence (may be empty for simple CFGs)
  let cdgEdges: ControlDepEdge[] = [];
  if (postDom.ipdom.length > 0) {
    cdgEdges = [...computeControlDependence(cfg, postDom.ipdom, maxEdges)];
  }

  // Phase 3: Reaching definitions (may fail for incomplete/minimal CFGs)
  let dataFacts: DefUseFact[] = [];
  try {
    if (cfg.stmtFacts.defs.size > 0 || cfg.stmtFacts.uses.size > 0) {
      dataFacts = computeReachingDefinitions(cfg);
    }
  } catch {
    // Graceful degradation: skip data dependence if solver fails
  }

  // Phase 4: Build unified PDG
  return buildGraph(cfg, filePath, funcName, cdgEdges, dataFacts);
}

// ---------------------------------------------------------------------------
// Graph Construction
// ---------------------------------------------------------------------------

function buildGraph(
  cfg: FunctionCfg,
  filePath: string,
  funcName: string,
  cdgEdges: readonly ControlDepEdge[],
  dataFacts: readonly DefUseFact[],
): PdgGraph {
  const nodes: InternalNode[] = [];
  const edges: PdgEdge[] = [];
  // Map {block}:{stmt} → nodeId
  const siteMap = new Map<string, number>();

  let nextId = 0;

  // Sentinel: entry and exit nodes
  const entryNode = addNode(-1, -1, 'entry', 0);
  const exitNode = addNode(-2, -2, 'exit', 0);

  // --- Collect all unique program points from data facts ---
  for (const f of dataFacts) {
    getNode(f.defBlock, f.defStmt, 'def', 0); // line unknown for def-only sites
    getNode(f.useBlock, f.useStmt, 'use', 0);
  }

  // --- Control dependence edges ---
  for (const cdgEdge of cdgEdges) {
    const srcBlock = cdgEdge.from;
    const tgtBlock = cdgEdge.to;

    // Represent the "branch node" for the source block as the block's
    // definition site with the highest index, or create a synthetic one.
    let srcId = findBlockNode(srcBlock, 'def');
    if (srcId === undefined) {
      // Create a synthetic branch node for this block
      const branchLine = cfg.blocks[srcBlock]?.startLine ?? 0;
      srcId = addNode(srcBlock, -1, 'branch', branchLine);
    }

    let tgtId = findBlockNode(tgtBlock, undefined);
    if (tgtId === undefined) {
      // Create a synthetic entry node for the target block
      const tgtLine = cfg.blocks[tgtBlock]?.startLine ?? 0;
      tgtId = addNode(tgtBlock, -1, 'use', tgtLine);
    }

    const label = cdgEdge.label ?? 'ctrl';
    edges.push({
      sourceId: srcId,
      targetId: tgtId,
      kind: label.includes('loop') ? 'loop-carried' : 'control',
      label,
    });

    nodes[srcId]!.controlDependents.add(tgtId);
    nodes[tgtId]!.controllers.add(srcId);
  }

  // --- Data dependence edges ---
  for (const fact of dataFacts) {
    const srcKey = `${fact.defBlock}:${fact.defStmt}`;
    const tgtKey = `${fact.useBlock}:${fact.useStmt}`;

    const srcId = siteMap.get(srcKey);
    const tgtId = siteMap.get(tgtKey);

    if (srcId !== undefined && tgtId !== undefined && srcId !== tgtId) {
      edges.push({
        sourceId: srcId,
        targetId: tgtId,
        kind: 'data',
        label: `var_${fact.bindingIdx}`,
      });

      nodes[srcId]!.dataTargets.add(tgtId);
      nodes[tgtId]!.dataSources.add(srcId);
    }
  }

  return makeGraph(funcName, filePath, nodes, edges, cdgEdges, dataFacts, siteMap);

  // --- Helpers ---
  function addNode(block: number, stmt: number, kind: PdgNode['kind'], line: number): number {
    const key = `${block}:${stmt}`;
    const existing = siteMap.get(key);
    if (existing !== undefined) return existing;

    const node: InternalNode = {
      nodeId: nextId,
      blockIndex: block,
      stmtIndex: stmt,
      kind,
      line,
      controlDependents: new Set(),
      controllers: new Set(),
      dataTargets: new Set(),
      dataSources: new Set(),
    };

    siteMap.set(key, nextId);
    nodes.push(node);
    return nextId++;
  }

  function getNode(block: number, stmt: number, kind: PdgNode['kind'], line: number): number {
    const key = `${block}:${stmt}`;
    const existing = siteMap.get(key);
    if (existing !== undefined) return existing;
    return addNode(block, stmt, kind, line);
  }

  function findBlockNode(
    block: number,
    preferKind: PdgNode['kind'] | undefined,
  ): number | undefined {
    let best: number | undefined;
    let bestScore = -1;

    for (const node of nodes) {
      if (node.blockIndex !== block) continue;
      let score = 0;
      if (node.kind === preferKind) score = 2;
      else if (node.kind === 'branch') score = 1;
      else if (node.stmtIndex >= 0) score = 3;
      if (score > bestScore) {
        bestScore = score;
        best = node.nodeId;
      }
    }

    return best;
  }
}

// ---------------------------------------------------------------------------
// Graph Object Construction
// ---------------------------------------------------------------------------

function makeGraph(
  funcName: string,
  filePath: string,
  nodes: InternalNode[],
  edges: PdgEdge[],
  controlEdges: readonly ControlDepEdge[],
  dataFacts: readonly DefUseFact[],
  siteMap: Map<string, number>,
): PdgGraph {
  return {
    functionName: funcName,
    filePath,
    nodes,
    edges,
    controlEdges,
    dataFacts,
    get nodeCount() { return nodes.length; },
    get edgeCount() { return edges.length; },

    queryControl(query: PdgControlQuery): PdgQueryResult {
      const matching = query.direction === 'dependents'
        ? controlEdges.filter((e) => e.from === query.controllerBlock)
        : controlEdges.filter((e) => e.to === query.controllerBlock);

      return {
        controlEdges: matching.slice(0, 100),
        dataFacts: [],
        truncated: matching.length > 100,
      };
    },

    queryData(query: PdgDataQuery): PdgQueryResult {
      const matching = query.direction === 'defs'
        ? dataFacts.filter(
            (f) =>
              f.defBlock === query.blockIndex &&
              f.defStmt === query.stmtIndex &&
              f.bindingIdx === query.bindingIdx,
          )
        : dataFacts.filter(
            (f) =>
              f.useBlock === query.blockIndex &&
              f.useStmt === query.stmtIndex &&
              f.bindingIdx === query.bindingIdx,
          );

      return {
        controlEdges: [],
        dataFacts: matching.slice(0, 100),
        truncated: matching.length > 100,
      };
    },

    getControlDependents(nodeId: number): number[] {
      const node = nodes[nodeId];
      return node ? [...node.controlDependents] : [];
    },

    getDataDependents(blockIndex: number, stmtIndex: number): number[] {
      const key = `${blockIndex}:${stmtIndex}`;
      const nodeId = siteMap.get(key);
      if (nodeId === undefined) return [];
      return [...nodes[nodeId]!.dataTargets];
    },

    getDataSources(blockIndex: number, stmtIndex: number): number[] {
      const key = `${blockIndex}:${stmtIndex}`;
      const nodeId = siteMap.get(key);
      if (nodeId === undefined) return [];
      return [...nodes[nodeId]!.dataSources];
    },
  };
}
