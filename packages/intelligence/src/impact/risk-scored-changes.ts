// How much a change matters, scored by who depends on it.
//
// **The product's own sentence, as a number**: *"a symbol that changed and is only used inside the diff is usually
// fine; a symbol that changed and is used at four sites the author never opened is where the defects live."*
//
// **The arena's competitors ship this as `detect_changes_tool`** - *"risk-scored changes"* - and the matrix records
// it as competitor-only. **What makes it buildable now is the same thing that made a call graph buildable**: the
// edges. **A consumer count is a count of incoming edges, and until this week there were none to count.**
//
// **And the score is deliberately legible rather than learned.** Four terms, each of which a reviewer can argue with,
// because a risk score nobody can explain is a number nobody acts on - **and the field's own lesson is that the
// reviewer is the one who has to trust it.**

import { EDGE_CALLS, EDGE_CROSS_REPO_CALLS, EDGE_IMPORTS } from '@code-analyzer/shared';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** A symbol whose definition a change touched. */
export interface ChangedSymbol {
  name: string;
  filePath: string;
}

export interface ScoredChange extends ChangedSymbol {
  /** **The number the sentence is about**: consumers outside the file this symbol lives in. */
  consumersOutsideFile: number;
  /** Consumers in the same file, which the author almost certainly opened. */
  consumersInFile: number;
  /** Consumers in another repository, which no test in this repository can reach. */
  consumersInOtherRepos: number;
  /** `0` to `1`, rising with everything above. **Not a probability** - a rank. */
  risk: number;
  /** The terms that produced the score, so a reader can disagree with one. */
  reasons: string[];
}

export interface RiskScoredReport {
  changes: ScoredChange[];
  /** The highest score, so a caller can sort or threshold without re-deriving it. */
  maxRisk: number;
  /** **Zero here makes every score zero**, so it is reported rather than assumed. */
  callsEdgeCount: number;
}

/**
 * Scores changed symbols by their consumers.
 *
 * **A change with no consumers scores zero rather than one**, which is the sentence's first half: *"only used inside
 * the diff is usually fine"*. **The score rises with reach**, and reach is what the graph knows and a diff does not.
 */
export function scoreChangedSymbols(
  graph: KnowledgeGraph,
  changes: ChangedSymbol[],
): RiskScoredReport {
  // **Incoming edges by target**, once, because a scan per symbol is a scan per symbol.
  const callersOf = new Map<number, number[]>();
  const importersOf = new Map<number, number[]>();
  let callsEdgeCount = 0;
  for (const edge of graph.edges.values()) {
    const type = String(edge.type);
    if (type === EDGE_CALLS || type === EDGE_CROSS_REPO_CALLS) {
      callsEdgeCount++;
      const list = callersOf.get(edge.targetId) ?? [];
      list.push(edge.sourceId);
      callersOf.set(edge.targetId, list);
    } else if (type === EDGE_IMPORTS) {
      const list = importersOf.get(edge.targetId) ?? [];
      list.push(edge.sourceId);
      importersOf.set(edge.targetId, list);
    }
  }

  // **The node lookup, by name and file**, because a change is identified by both.
  const byNameAndFile = new Map<string, number[]>();
  for (const node of graph.nodes.values()) {
    if (!/Function|Method|Class|Interface/i.test(String(node.label))) continue;
    const key = `${node.filePath}\u0000${node.name}`;
    const list = byNameAndFile.get(key) ?? [];
    list.push(node.id);
    byNameAndFile.set(key, list);
  }

  const idToRepo = new Map<number, string>();
  for (const node of graph.nodes.values()) idToRepo.set(node.id, String(node.projectId));

  const changesOut: ScoredChange[] = [];
  for (const change of changes) {
    const ids = byNameAndFile.get(`${change.filePath}\u0000${change.name}`) ?? [];
    const inFile = new Set<number>();
    const outside = new Set<number>();
    const otherRepos = new Set<number>();

    for (const id of ids) {
      for (const callerId of [...(callersOf.get(id) ?? []), ...(importersOf.get(id) ?? [])]) {
        const caller = graph.nodes.get(callerId);
        if (!caller) continue;
        if (caller.filePath === change.filePath) inFile.add(callerId);
        else outside.add(callerId);
        // **Another repository is a stronger statement than another file**: no test here reaches it.
        for (const repoId of ids) if (idToRepo.get(callerId) !== idToRepo.get(repoId)) otherRepos.add(callerId);
      }
    }

    // **Four legible terms.** Reach outside the file dominates, because that is the sentence; a cross-repository
    // consumer is the strongest reach there is; and the in-file count contributes a little, because a busy symbol is
    // a bigger change even when everyone who reads it is already looking.
    const reasons: string[] = [];
    let risk = 0;
    if (outside.size > 0) {
      risk += 0.5;
      reasons.push(`${outside.size} consumer(s) outside ${change.filePath}, which the author did not open`);
    }
    if (otherRepos.size > 0) {
      risk += 0.3;
      reasons.push(`${otherRepos.size} consumer(s) in another repository, which no test here can reach`);
    }
    if (ids.length === 0) reasons.push('the symbol was not found in the graph, so its reach is unknown');
    if (risk > 0 && inFile.size > 0) {
      risk += 0.1;
      reasons.push(`${inFile.size} consumer(s) in the same file`);
    }
    // **Capped at one**, and the cap is stated rather than implied.
    risk = Math.min(1, Math.round(risk * 100) / 100);

    changesOut.push({
      ...change,
      consumersOutsideFile: outside.size,
      consumersInFile: inFile.size,
      consumersInOtherRepos: otherRepos.size,
      risk,
      reasons,
    });
  }

  changesOut.sort((a, b) => b.risk - a.risk);
  return {
    changes: changesOut,
    maxRisk: changesOut.length === 0 ? 0 : changesOut[0]!.risk,
    callsEdgeCount,
  };
}
