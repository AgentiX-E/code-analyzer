// A taint path that leaves one repository and arrives in another.
//
// **The composition nothing in the competitive matrix claims.** The matrix records taint as `[O]` and cross-repository
// analysis as `[O]`, **and this is the two of them stacked**: a value that enters as untrusted input in one repository
// and reaches a sink in another. **No competitor in the column is recorded as able to do either half at a repository
// boundary.**
//
// **And it composes rather than re-implements.** The taint engine already finds sources and sinks inside one
// repository; the cross-repo indexer already produces `CROSS_REPO_CALLS` and `CROSS_REPO_IMPORTS`. **What was missing
// was the join** - which is the same shape as the fifth surface gap, one level up.
//
// **What this does not do, stated because the name invites the assumption.** It does **not** re-run taint analysis
// across repositories: it takes findings the engine produced **and follows their endpoints across the boundary.**
// **A taint that only becomes a source after crossing is not found here**, and the artifact says so rather than
// implying a whole-program analysis that does not exist.

import { EDGE_CROSS_REPO_CALLS, EDGE_CROSS_REPO_IMPORTS } from '@code-analyzer/shared';

import type { TaintCategory, TaintSeverity } from './taint-engine.js';
import type { KnowledgeGraph } from '@code-analyzer/shared';

// **From the engine rather than from `shared`**, because the taint vocabulary is the engine's own and **duplicating
// it in the shared package would be two definitions of one thing.**

/** One step of a path, with the repository it is in - because the repository is the point. */
export interface CrossRepoHop {
  repoId: string;
  nodeId: number;
  name: string;
  filePath: string;
}

export interface CrossRepoTaintFinding {
  /** Where the untrusted value entered. */
  originRepo: string;
  /** Where it arrived, which is not where it entered - that is the finding. */
  targetRepo: string;
  category: TaintCategory;
  severity: TaintSeverity;
  cweId?: string;
  sourceDescription: string;
  sinkDescription: string;
  /** **How many repository boundaries were crossed**, which is the risk this half of the analysis adds. */
  boundariesCrossed: number;
  path: CrossRepoHop[];
  /** **Lower than the single-repository finding it came from**, because a boundary is a place the join can be wrong. */
  confidence: number;
}

export interface CrossRepoTaintReport {
  findings: CrossRepoTaintFinding[];
  /** **Zero here makes every result empty**, so it is reported rather than assumed. */
  crossRepoEdgeCount: number;
  /** The repositories the analysis covered, so a reader can tell a clean result from a narrow one. */
  reposCovered: string[];
}

/** The minimum a single-repository finding must carry to be joined. */
export interface JoinableFinding {
  sourceNodeId: number;
  sinkNodeId: number;
  category: TaintCategory;
  severity: TaintSeverity;
  cweId?: string;
  sourceDescription: string;
  sinkDescription: string;
  confidence: number;
}

/**
 * Finds taint paths that cross a repository boundary.
 *
 * **The join is the whole analysis**: a single-repository finding says *"this untrusted value reaches this sink"*, and
 * **a cross-repository edge from either endpoint says the value has somewhere else to go.** Where it arrives is
 * reported, **and the caller decides what to do about it** - which is the same division the grounding judge uses.
 */
export function findCrossRepoTaint(
  graph: KnowledgeGraph,
  findings: JoinableFinding[],
): CrossRepoTaintReport {
  const reposCovered = new Set<string>();
  for (const node of graph.nodes.values()) reposCovered.add(String(node.projectId));

  // **The cross-repository edges, both directions, by the node they touch.** A taint can leave through a call the
  // other repository makes into this one, **or through an import** - and the two are separate edge types because they
  // are separate facts.
  const crossRepoNeighbours = new Map<number, number[]>();
  let crossRepoEdgeCount = 0;
  for (const edge of graph.edges.values()) {
    const type = String(edge.type);
    if (type !== EDGE_CROSS_REPO_CALLS && type !== EDGE_CROSS_REPO_IMPORTS) continue;
    crossRepoEdgeCount++;
    for (const [from, to] of [
      [edge.sourceId, edge.targetId],
      [edge.targetId, edge.sourceId],
    ] as const) {
      const list = crossRepoNeighbours.get(from) ?? [];
      list.push(to);
      crossRepoNeighbours.set(from, list);
    }
  }

  // **The guard, and it is the same one four other analyses carry**: with no cross-repository edges every answer is
  // empty, and **an empty answer would read as "nothing crosses"** rather than "the prerequisite is missing."
  if (crossRepoEdgeCount === 0) {
    return { findings: [], crossRepoEdgeCount: 0, reposCovered: [...reposCovered].sort() };
  }

  const out: CrossRepoTaintFinding[] = [];
  for (const finding of findings) {
    const source = graph.nodes.get(finding.sourceNodeId);
    const sink = graph.nodes.get(finding.sinkNodeId);
    if (!source || !sink) continue;
    const originRepo = String(source.projectId);

    // **A boundary is crossed at either endpoint**, because the value can leave from the sink's side or arrive from
    // the source's - and **checking one of the two would report half the paths**.
    const exits: Array<{ via: number; from: number }> = [];
    for (const via of [
      ...(crossRepoNeighbours.get(finding.sinkNodeId) ?? []),
      ...(crossRepoNeighbours.get(finding.sourceNodeId) ?? []),
    ]) {
      exits.push({ via, from: finding.sinkNodeId });
    }
    for (const exit of exits) {
      const arrived = graph.nodes.get(exit.via);
      if (!arrived) continue;
      const targetRepo = String(arrived.projectId);
      // **A self-boundary is not a boundary**, and reporting one would be a finding about nothing crossing.
      if (targetRepo === originRepo) continue;

      out.push({
        originRepo,
        targetRepo,
        category: finding.category,
        severity: finding.severity,
        cweId: finding.cweId,
        sourceDescription: finding.sourceDescription,
        sinkDescription: `${finding.sinkDescription} - reached from ${originRepo} via ${String(arrived.name)}`,
        boundariesCrossed: 1,
        path: [
          { repoId: originRepo, nodeId: source.id, name: String(source.name), filePath: String(source.filePath) },
          { repoId: originRepo, nodeId: sink.id, name: String(sink.name), filePath: String(sink.filePath) },
          { repoId: targetRepo, nodeId: arrived.id, name: String(arrived.name), filePath: String(arrived.filePath) },
        ],
        // **The confidence is multiplied rather than carried**, because this is a join of two facts and **a join is
        // wrong wherever either half is.**
        confidence: Math.round(finding.confidence * 0.8 * 100) / 100,
      });
    }
  }

  // **Sorted by severity first and confidence second**, because a caller reading the top of the list is asking for the
  // worst thing, not the most certain one.
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  out.sort((a, b) => {
    const bySeverity = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    return bySeverity !== 0 ? bySeverity : b.confidence - a.confidence;
  });

  return { findings: out, crossRepoEdgeCount, reposCovered: [...reposCovered].sort() };
}
