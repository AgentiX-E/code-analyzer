// @code-analyzer/mcp — Trend Analysis Tool Branch Coverage
// Exercises the remaining reachable branches of the trend_analysis tool across
// the complexity, structure, and health reports: null filePath fallbacks, the
// 21-50 complexity bucket, empty-score statistics, the >15 node-type summary,
// graph-density tiers, and isolated-node (orphan) thresholds.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { insertNode, insertEdge } from './test-helpers.js';
import type { NodeLabel } from '@code-analyzer/shared';
import trendAnalysisTool from '../tools/trend-analysis.js';

async function run(store: InMemoryGraphStore, projectId: string, metric: string): Promise<string> {
  const r = await trendAnalysisTool.handler({ projectId, metric }, store);
  return r.content[0].text;
}

describe('trendAnalysisTool — complexity report edge cases', async () => {
  it('falls back to <unknown> for a scored node with no filePath', async () => {
    const store = new InMemoryGraphStore();
    const a = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'noPath',
      qualifiedName: 'noPath',
      filePath: null,
    });
    const b = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'target',
      qualifiedName: 'target',
      filePath: 'b.ts',
    });
    insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: a, targetId: b });

    const text = await run(store, 'p', 'complexity');
    expect(text).toContain('<unknown>');
  });

  it('buckets a score in the 21-50 range and flags high average complexity', async () => {
    const store = new InMemoryGraphStore();
    const high = insertNode(store, {
      projectId: 'p',
      label: 'Class',
      name: 'high',
      qualifiedName: 'high',
      filePath: 'h.ts',
    });
    // 7 EXTENDS edges -> score 21 (21-50 bucket); average > 15.
    for (let i = 0; i < 7; i++) {
      const t = insertNode(store, {
        projectId: 'p',
        label: 'Class',
        name: `t${i}`,
        qualifiedName: `t${i}`,
        filePath: `t${i}.ts`,
      });
      insertEdge(store, { projectId: 'p', type: 'EXTENDS', sourceId: high, targetId: t });
    }

    const text = await run(store, 'p', 'complexity');
    expect(text).toContain('21–50');
    expect(text).toContain('Recommendations');
  });

  it('reports zero statistics when no node has a structural score', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'isolated',
      qualifiedName: 'isolated',
      filePath: 'a.ts',
    });

    const text = await run(store, 'p', 'complexity');
    // No CALLS/EXTENDS/IMPLEMENTS edges -> empty scores -> Avg/Min/Max all 0.
    expect(text).toContain('Avg: 0');
    expect(text).toContain('Min: 0');
    expect(text).toContain('Max: 0');
  });
});

describe('trendAnalysisTool — structure report edge cases', async () => {
  it('summarizes the remaining node types when there are more than 15', async () => {
    const store = new InMemoryGraphStore();
    const labels: NodeLabel[] = [
      'Project',
      'Package',
      'Folder',
      'File',
      'Module',
      'Class',
      'Interface',
      'Function',
      'Method',
      'Constructor',
      'Property',
      'Enum',
      'TypeAlias',
      'Variable',
      'Route',
      'Component',
      'Test',
    ];
    labels.forEach((label, i) => {
      insertNode(store, {
        projectId: 'p',
        label,
        name: `${label}${i}`,
        qualifiedName: `${label}${i}`,
      });
    });

    const text = await run(store, 'p', 'structure');
    expect(text).toContain('more types');
  });
});

describe('trendAnalysisTool — health report edge cases', async () => {
  it('computes zero density for a single-node project', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, { projectId: 'p', label: 'Project', name: 'P', qualifiedName: 'P' });

    const text = await run(store, 'p', 'health');
    expect(text).toContain('Graph Density');
    expect(text).toContain('0%');
  });

  it('classifies a dense graph', async () => {
    const store = new InMemoryGraphStore();
    const a = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'a',
      qualifiedName: 'a',
      filePath: 'a.ts',
    });
    const b = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'b',
      qualifiedName: 'b',
      filePath: 'b.ts',
    });
    insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: a, targetId: b });

    const text = await run(store, 'p', 'health');
    expect(text).toContain('Dense');
  });

  it('classifies a moderate-density graph', async () => {
    const store = new InMemoryGraphStore();
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        insertNode(store, {
          projectId: 'p',
          label: 'Function',
          name: `f${i}`,
          qualifiedName: `f${i}`,
          filePath: `f${i}.ts`,
        }),
      );
    }
    // A single edge across 6 nodes -> density ~3.3% (moderate tier).
    insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: ids[0]!, targetId: ids[1]! });

    const text = await run(store, 'p', 'health');
    expect(text).toContain('Moderate');
  });

  it('classifies a moderate isolated-node ratio', async () => {
    const store = new InMemoryGraphStore();
    // 9 File nodes (excluded from the isolated set) + 1 isolated Function ->
    // 1/10 = 10% isolated (moderate tier).
    for (let i = 0; i < 9; i++) {
      insertNode(store, {
        projectId: 'p',
        label: 'File',
        name: `f${i}`,
        qualifiedName: `f${i}`,
        filePath: `f${i}.ts`,
      });
    }
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'orphan',
      qualifiedName: 'orphan',
      filePath: 'orphan.ts',
    });

    const text = await run(store, 'p', 'health');
    expect(text).toContain('Moderate');
    expect(text).toContain('Orphaned Symbols');
  });

  it('classifies a high isolated-node ratio and lists many orphans', async () => {
    const store = new InMemoryGraphStore();
    // 12 isolated functions -> 100% isolated (high tier) and > 10 orphans.
    for (let i = 0; i < 12; i++) {
      insertNode(store, {
        projectId: 'p',
        label: 'Function',
        name: `iso${i}`,
        qualifiedName: `iso${i}`,
        filePath: `iso${i}.ts`,
      });
    }

    const text = await run(store, 'p', 'health');
    expect(text).toContain('High');
    expect(text).toContain('more');
  });

  it('shows no orphaned section when there are no isolated nodes', async () => {
    const store = new InMemoryGraphStore();
    const a = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'a',
      qualifiedName: 'a',
      filePath: 'a.ts',
    });
    const b = insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'b',
      qualifiedName: 'b',
      filePath: 'b.ts',
    });
    insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: a, targetId: b });
    // A cycle gives both nodes an outgoing edge, so neither is flagged as
    // isolated (the health report keys "isolated" off outgoing edges).
    insertEdge(store, { projectId: 'p', type: 'CALLS', sourceId: b, targetId: a });

    const text = await run(store, 'p', 'health');
    expect(text).not.toContain('Orphaned Symbols');
  });

  it('falls back to ? for an orphan with no filePath', async () => {
    const store = new InMemoryGraphStore();
    insertNode(store, {
      projectId: 'p',
      label: 'Function',
      name: 'orphan',
      qualifiedName: 'orphan',
      filePath: null,
    });

    const text = await run(store, 'p', 'health');
    expect(text).toContain('Orphaned Symbols');
    expect(text).toContain('orphan');
  });
});
