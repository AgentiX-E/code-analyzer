// A taint path that crosses a repository boundary - and the three ways it must not.
//
// **The composition the matrix says nobody claims.** Taint is `[O]`, cross-repository analysis is `[O]`, and this is
// the two joined. **What the cases are about is the join being wrong**: a boundary that is not crossed, an edge that
// is not a boundary, and a graph with no boundaries at all - **each of which would produce a finding about nothing.**

import { describe, expect, it } from 'vitest';

import { findCrossRepoTaint } from '../security/cross-repo-taint.js';

import type { JoinableFinding } from '../security/cross-repo-taint.js';
import type { KnowledgeGraph } from '@code-analyzer/shared';

function graphWith(
  nodes: Array<{ id: number; name: string; filePath: string; projectId: string }>,
  edges: Array<{ sourceId: number; targetId: number; type: string }>,
): KnowledgeGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, { ...n, label: 'Function' }])),
    edges: new Map(edges.map((e, i) => [i, { id: i, ...e }])),
  } as unknown as KnowledgeGraph;
}

const finding: JoinableFinding = {
  sourceNodeId: 1,
  sinkNodeId: 2,
  category: 'sql_injection',
  severity: 'high',
  cweId: 'CWE-89',
  sourceDescription: 'request.body',
  sinkDescription: 'db.query',
  confidence: 0.9,
};

describe('taint across a repository boundary', () => {
  it('reports a finding whose sink is reached from another repository', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'handler', filePath: 'src/h.ts', projectId: 'repo-a' },
        { id: 2, name: 'runQuery', filePath: 'src/db.ts', projectId: 'repo-a' },
        { id: 3, name: 'consumer', filePath: 'src/c.ts', projectId: 'repo-b' },
      ],
      [{ sourceId: 3, targetId: 2, type: 'CROSS_REPO_CALLS' }],
    );

    const report = findCrossRepoTaint(graph, [finding]);

    expect(report.crossRepoEdgeCount).toBe(1);
    expect(report.findings.length).toBe(1);
    // **The two repositories are the finding**, and both are named rather than one.
    expect(report.findings[0]!.originRepo).toBe('repo-a');
    expect(report.findings[0]!.targetRepo).toBe('repo-b');
    expect(report.findings[0]!.boundariesCrossed).toBe(1);
    // **The confidence is lower than the finding it came from**, because a join is wrong wherever either half is.
    expect(report.findings[0]!.confidence).toBeLessThan(finding.confidence);
    // And the path carries the repository at every step, because that is the axis being reported on.
    expect(report.findings[0]!.path.map((h) => h.repoId)).toEqual(['repo-a', 'repo-a', 'repo-b']);
  });

  it('says nothing when the edge stays inside one repository', () => {
    // **A self-boundary is not a boundary.** An edge from one file to another in the same repository is a fact, and
    // **reporting it as a cross-repository taint would be a finding about nothing crossing.**
    const graph = graphWith(
      [
        { id: 1, name: 'handler', filePath: 'src/h.ts', projectId: 'repo-a' },
        { id: 2, name: 'runQuery', filePath: 'src/db.ts', projectId: 'repo-a' },
        { id: 3, name: 'helper', filePath: 'src/x.ts', projectId: 'repo-a' },
      ],
      [{ sourceId: 3, targetId: 2, type: 'CROSS_REPO_CALLS' }],
    );

    const report = findCrossRepoTaint(graph, [finding]);

    // **The edge count is one and the findings are none**, which is the pair a self-boundary check has to produce.
    expect(report.crossRepoEdgeCount).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it('says nothing at all when no edge crosses a boundary, and reports the count', () => {
    // **The guard four other analyses carry.** With no cross-repository edges every result is empty, and **an empty
    // result would read as "nothing crosses"** rather than "the prerequisite is missing".
    const graph = graphWith(
      [
        { id: 1, name: 'a', filePath: 'src/a.ts', projectId: 'repo-a' },
        { id: 2, name: 'b', filePath: 'src/b.ts', projectId: 'repo-a' },
      ],
      [{ sourceId: 2, targetId: 1, type: 'CALLS' }],
    );

    const report = findCrossRepoTaint(graph, [finding]);

    expect(report.crossRepoEdgeCount).toBe(0);
    expect(report.findings).toEqual([]);
    // **The repositories covered are still reported**, so a reader can tell a clean result from a narrow one.
    expect(report.reposCovered).toEqual(['repo-a']);
  });

  it('counts an import as a boundary, not only a call', () => {
    // **The two edge types are separate facts**, and a taint that leaves through an import has left.
    const graph = graphWith(
      [
        { id: 1, name: 'handler', filePath: 'src/h.ts', projectId: 'repo-a' },
        { id: 2, name: 'runQuery', filePath: 'src/db.ts', projectId: 'repo-a' },
        { id: 3, name: 'shared', filePath: 'src/s.ts', projectId: 'repo-c' },
      ],
      [{ sourceId: 3, targetId: 1, type: 'CROSS_REPO_IMPORTS' }],
    );

    const report = findCrossRepoTaint(graph, [finding]);

    expect(report.findings.length).toBe(1);
    expect(report.findings[0]!.targetRepo).toBe('repo-c');
  });

  it('sorts the worst thing first, not the most certain one', () => {
    const graph = graphWith(
      [
        { id: 1, name: 'h', filePath: 'src/h.ts', projectId: 'repo-a' },
        { id: 2, name: 'q1', filePath: 'src/q1.ts', projectId: 'repo-a' },
        { id: 3, name: 'q2', filePath: 'src/q2.ts', projectId: 'repo-a' },
        { id: 4, name: 'c1', filePath: 'src/c1.ts', projectId: 'repo-b' },
        { id: 5, name: 'c2', filePath: 'src/c2.ts', projectId: 'repo-b' },
      ],
      [
        { sourceId: 4, targetId: 2, type: 'CROSS_REPO_CALLS' },
        { sourceId: 5, targetId: 3, type: 'CROSS_REPO_CALLS' },
      ],
    );

    const report = findCrossRepoTaint(graph, [
      { ...finding, sinkNodeId: 2, severity: 'low', confidence: 0.99 },
      { ...finding, sourceNodeId: 3, sinkNodeId: 3, severity: 'critical', confidence: 0.5 },
    ]);

    // **Severity first**, because a caller reading the top of a list wants the worst thing in it.
    expect(report.findings[0]!.severity).toBe('critical');
  });
});
