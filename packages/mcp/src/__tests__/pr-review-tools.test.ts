// @code-analyzer/mcp — PR Review Tools Tests
// Tests for review_pr and check_standards, including the branches that were
// invisible while pr-review.ts carried a whole-file v8 ignore hint.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphEdge, GraphNode, RelationshipType } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_EXTENDS, EDGE_IMPLEMENTS } from '@code-analyzer/shared';
import { ToolContextImpl } from '../tools/tool-context.js';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';
import type { ToolResult } from '../tools/registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00.000Z').toISOString();

interface NodeOverrides {
  label?: GraphNode['label'];
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  complexity?: number | null;
  isExported?: boolean;
}

function makeNode(projectId: string, name: string, overrides: NodeOverrides = {}): GraphNode {
  return {
    id: 0,
    projectId,
    label: overrides.label ?? 'Function',
    name,
    qualifiedName: `${projectId}.${name}`,
    filePath: overrides.filePath === undefined ? 'src/app.ts' : overrides.filePath,
    startLine: overrides.startLine === undefined ? 1 : overrides.startLine,
    endLine: overrides.endLine === undefined ? 40 : overrides.endLine,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: overrides.complexity === undefined ? null : overrides.complexity,
    isExported: overrides.isExported ?? false,
    fingerprint: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface Link {
  from: number;
  to: number;
  type?: RelationshipType;
}

/**
 * Insert `nodes` in order, then wire them with `links` (indices into `nodes`).
 * Returns the store plus the real node ids so tests can build diffs against
 * files that actually contain the nodes.
 */
function seedGraph(
  projectId: string,
  nodes: GraphNode[],
  links: Link[],
): { store: InMemoryGraphStore; ids: number[] } {
  const store = new InMemoryGraphStore();
  const ids = store.insertNodes(nodes);
  if (links.length > 0) {
    const edges: GraphEdge[] = links.map((link) => ({
      id: 0,
      projectId,
      sourceId: ids[link.from]!,
      targetId: ids[link.to]!,
      type: link.type ?? EDGE_CALLS,
      properties: {},
      weight: 1,
      createdAt: NOW,
    }));
    store.insertEdges(edges);
  }
  return { store, ids };
}

/** A single-file diff section. `header` lines are emitted verbatim. */
function diffSection(filePath: string, header: string, body: string): string {
  return `diff --git a/${filePath} b/${filePath}\n${header}--- a/${filePath}\n+++ b/${filePath}\n${body}`;
}

function parseResult(result: ToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== 'text') {
    throw new Error(`expected a text result, got: ${JSON.stringify(result.content)}`);
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

function summaryOf(data: Record<string, unknown>): Record<string, number> {
  return data['summary'] as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let registry: ToolRegistry;
let tmpDir: string;

beforeAll(() => {
  registry = createToolRegistry();
  tmpDir = mkdtempSync(join(tmpdir(), 'pr-review-tools-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('review_pr - cross-repo path', () => {
  it('returns the cross-repo error payload when the group is unknown', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const result = await registry.execute(
      'review_pr',
      { projectId: 'acme/widget', groupId: 'ghost-group' },
      ctx,
    );

    const data = parseResult(result);
    expect(data['mode']).toBe('cross-repo');
    expect(data['groupId']).toBe('ghost-group');
    expect(String(data['error'])).toContain('not found');
  });

  it('runs the cross-repo review when the group and repo are registered', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    ctx.getRepoGroupManager().createGroup('g-cross', 'Cross Group', '');
    ctx.getRepoGroupManager().addRepo('g-cross', 'acme', 'widget', '', '/tmp/widget');

    const result = await registry.execute(
      'review_pr',
      { projectId: 'acme/widget', groupId: 'g-cross', prNumber: 7 },
      ctx,
    );

    const data = parseResult(result);
    expect(data['mode']).toBe('cross-repo');
    expect(data['groupId']).toBe('g-cross');
    expect(data['mergeRecommendation']).toBeDefined();
    expect(data['crossRepoRisk']).toBeDefined();
    expect(Array.isArray(data['recommendations'])).toBe(true);
  });

  it('parses the supplied diff before handing it to the cross-repo engine', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    ctx.getRepoGroupManager().createGroup('g-diff', 'Diff Group', '');
    ctx.getRepoGroupManager().addRepo('g-diff', 'acme', 'widget', '', '/tmp/widget');

    const diff = diffSection(
      'src/app.ts',
      'new file mode 100644\n',
      '@@ -0,0 +1,3 @@\n+export const a = 1;\n',
    );
    const result = await registry.execute(
      'review_pr',
      { projectId: 'acme/widget', groupId: 'g-diff', diff },
      ctx,
    );

    const data = parseResult(result);
    expect(data['mode']).toBe('cross-repo');
    expect(data['crossRepoImpacts']).toBeDefined();
  });

  it('falls back to the whole-id repo name when the project id has no slash', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    ctx.getRepoGroupManager().createGroup('g-flat', 'Flat Group', '');
    ctx.getRepoGroupManager().addRepo('g-flat', 'acme', 'widget', '', '/tmp/widget');

    // projectId has no "/" → the name segment is undefined and falls back to
    // the full id, which is also the registered repo fullName.
    const result = await registry.execute(
      'review_pr',
      { projectId: 'acme/widget', groupId: 'g-flat' },
      ctx,
    );
    expect(parseResult(result)['mode']).toBe('cross-repo');

    const flatResult = await registry.execute(
      'review_pr',
      { projectId: 'widget', groupId: 'g-flat' },
      ctx,
    );
    expect(String(parseResult(flatResult)['error'])).toContain('not found in group');
  });

  it('falls through to the single-repo path when the store is not a context', async () => {
    const store = new InMemoryGraphStore();
    // A raw store is not a ToolContext, so the cross-repo block is skipped and
    // the graph-store fallback below it runs instead.
    const result = await registry.execute(
      'review_pr',
      { projectId: 'acme/widget', groupId: 'ghost-group' },
      store,
    );

    const data = parseResult(result);
    expect(data['summary']).toBeDefined();
    expect(summaryOf(data)['mergeRecommendation']).toBe('review-manually');
    expect(summaryOf(data)['riskLevel']).toBe('unknown');
    expect(data['reviewMethod']).toBe('Basic integrity check');
  });
});

describe('review_pr - impact buckets from a diff', () => {
  /** Build a project where `src/app.ts` holds `stars` fan-out nodes. */
  function fanOutProject(fanOut: number, howMany: number) {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < howMany; i++) {
      nodes.push(makeNode('proj', `changed${i}`));
    }
    // Targets live in a different file so the diff range never matches them.
    for (let i = 0; i < fanOut * howMany; i++) {
      nodes.push(
        makeNode('proj', `dep${i}`, {
          filePath: 'src/deps.ts',
          startLine: 100 + i,
          endLine: 100 + i,
        }),
      );
    }
    const links: Link[] = [];
    for (let s = 0; s < howMany; s++) {
      for (let d = 0; d < fanOut; d++) {
        links.push({ from: s, to: howMany + s * fanOut + d });
      }
    }
    return seedGraph('proj', nodes, links);
  }

  const diff = diffSection('src/app.ts', '', '@@ -1,4 +1,6 @@\n+export const a = 1;\n');

  it('classifies an isolated symbol as low impact', async () => {
    const { store } = fanOutProject(0, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const summary = summaryOf(data);
    expect(summary['lowFindings']).toBe(1);
    expect(summary['mediumFindings']).toBe(0);
    expect(summary['riskLevel']).toBe('low');
    expect(summary['overallScore']).toBe(99);
    expect(summaryOf(data)['mergeRecommendation']).toBe('approve');
    expect(data['recommendations']).toContain('No significant issues found — safe to merge');
  });

  it('classifies a 2-5 node blast radius as medium impact', async () => {
    const { store } = fanOutProject(1, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const summary = summaryOf(data);
    expect(summary['mediumFindings']).toBe(1);
    expect(summary['riskLevel']).toBe('low');
    expect(data['recommendations']).toContain(
      'Address 1 medium-severity findings at your discretion',
    );
  });

  it('escalates to medium risk once more than two symbols are medium impact', async () => {
    const { store } = fanOutProject(1, 3);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const summary = summaryOf(data);
    expect(summary['mediumFindings']).toBe(3);
    expect(summary['riskLevel']).toBe('medium');
    expect(summary['overallScore']).toBe(85);
  });

  it('classifies a 6-10 node blast radius as high impact', async () => {
    const { store } = fanOutProject(6, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const summary = summaryOf(data);
    expect(summary['highFindings']).toBe(1);
    expect(summary['riskLevel']).toBe('high');
    expect(summary['overallScore']).toBe(90);
    expect(summaryOf(data)['mergeRecommendation']).toBe('approve');
    expect(data['recommendations']).toContain('Review 1 high-severity findings carefully');
    expect(data['recommendations']).toContain('Add integration tests to verify no regressions');
  });

  it('recommends caution once more than two symbols are high impact', async () => {
    const { store } = fanOutProject(6, 3);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect(summaryOf(data)['highFindings']).toBe(3);
    expect(summaryOf(data)['mergeRecommendation']).toBe('caution');
  });

  it('classifies an 11+ node blast radius as critical impact', async () => {
    const { store } = fanOutProject(11, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const summary = summaryOf(data);
    expect(summary['criticalFindings']).toBe(1);
    expect(summary['riskLevel']).toBe('critical');
    expect(summary['overallScore']).toBe(80);
    expect(summaryOf(data)['mergeRecommendation']).toBe('reject');
    expect(data['recommendations']).toContain('Address 1 critical findings before merging');
    expect(data['recommendations']).toContain('Consider adding more tests for high-risk areas');
  });

  it('counts changed lines, routes and tests', async () => {
    const nodes = [
      makeNode('proj', 'changed'),
      makeNode('proj', 'getItems', { label: 'Route', filePath: 'src/routes.ts' }),
      makeNode('proj', 'testItems', { label: 'Test', filePath: 'src/tests.ts' }),
    ];
    const { store } = seedGraph('proj', nodes, []);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    const metrics = data['metrics'] as Record<string, number>;
    expect(metrics['filesChanged']).toBe(1);
    expect(metrics['symbolsAffected']).toBe(1);
    expect(metrics['routesAffected']).toBe(1);
    expect(metrics['testsImpacted']).toBe(1);
    expect(metrics['linesChanged']).toBeGreaterThan(0);
  });

  it('reports the PR number and AI-review flag when supplied', async () => {
    const { store } = fanOutProject(0, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'review_pr',
        { projectId: 'proj', diff, prNumber: 42, includeAiReview: true },
        ctx,
      ),
    );

    expect(data['prNumber']).toBe(42);
    expect(data['aiReview']).toBe('LLM backend not available');
    expect(data['baseRef']).toBe('main');
    expect(data['headRef']).toBe('HEAD');
  });

  it('honours explicit refs and defaults the PR number to N/A', async () => {
    const { store } = fanOutProject(0, 1);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'review_pr',
        { projectId: 'proj', diff, baseRef: 'develop', headRef: 'feature/x' },
        ctx,
      ),
    );

    expect(data['prNumber']).toBe('N/A');
    expect(data['baseRef']).toBe('develop');
    expect(data['headRef']).toBe('feature/x');
    expect(data['aiReview']).toBeUndefined();
  });

  it('finds no symbols when the diff touches an unrelated file', async () => {
    const { store } = fanOutProject(0, 1);
    const ctx = new ToolContextImpl(store);
    const unrelated = diffSection('src/other.ts', '', '@@ -1,2 +1,3 @@\n+x\n');
    const data = parseResult(
      await registry.execute('review_pr', { projectId: 'proj', diff: unrelated }, ctx),
    );

    const summary = summaryOf(data);
    expect(summary['totalFindings']).toBe(0);
    expect(summary['riskLevel']).toBe('low');
    expect(summary['overallScore']).toBe(100);
    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(0);
  });
});

describe('review_pr - diff parsing', () => {
  function projectWithNode(filePath: string, startLine: number, endLine: number) {
    return seedGraph('proj', [makeNode('proj', 'target', { filePath, startLine, endLine })], []);
  }

  it('uses new-side line numbers for added files', async () => {
    const { store } = projectWithNode('src/new.ts', 1, 10);
    const ctx = new ToolContextImpl(store);
    const diff = diffSection(
      'src/new.ts',
      'new file mode 100644\n',
      '@@ -0,0 +1,5 @@\n+export const a = 1;\n',
    );
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(1);
  });

  it('uses old-side line numbers for deleted files', async () => {
    const { store } = projectWithNode('src/gone.ts', 8, 20);
    const ctx = new ToolContextImpl(store);
    const diff = diffSection(
      'src/gone.ts',
      'deleted file mode 100644\n',
      '@@ -8,12 +0,0 @@\n-export const a = 1;\n',
    );
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(1);
  });

  it('accepts renamed files', async () => {
    const diff =
      'diff --git a/src/old.ts b/src/new.ts\n' +
      'rename from src/old.ts\n' +
      'rename to src/new.ts\n' +
      '--- a/src/old.ts\n' +
      '+++ b/src/new.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      '-a\n' +
      '+b\n';
    const { store } = projectWithNode('src/new.ts', 1, 10);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect((data['metrics'] as Record<string, number>)['filesChanged']).toBe(1);
    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(1);
  });

  it('defaults the hunk count to 1 when a hunk omits it', async () => {
    const { store } = projectWithNode('src/one.ts', 3, 6);
    const ctx = new ToolContextImpl(store);
    const diff = diffSection('src/one.ts', '', '@@ -3 +3 @@\n+a\n');
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(1);
  });

  it('falls back to a covering range when a section has no hunk header', async () => {
    const { store } = projectWithNode('src/plain.ts', 1, 40);
    const ctx = new ToolContextImpl(store);
    const diff = diffSection('src/plain.ts', '', ' context only\n');
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    // The synthetic range is 1..1 on both sides, and the node spans 1..40,
    // so the overlap test still matches.
    expect((data['metrics'] as Record<string, number>)['symbolsAffected']).toBe(1);
  });

  it('skips a section that has no +++ header', async () => {
    const { store } = projectWithNode('src/none.ts', 1, 10);
    const ctx = new ToolContextImpl(store);
    const diff =
      'diff --git a/src/none.ts b/src/none.ts\n--- a/src/none.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n';
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj', diff }, ctx));

    expect((data['metrics'] as Record<string, number>)['filesChanged']).toBe(0);
  });
});

describe('review_pr - graph heuristics without a diff', () => {
  it('flags symbols whose complexity exceeds 20', async () => {
    const { store } = seedGraph('proj', [makeNode('proj', 'hot', { complexity: 25 })], []);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }, ctx));

    const findings = data['findings'] as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]!['title']).toBe('High complexity: hot');
    expect(findings[0]!['severity']).toBe('high');
    expect(summaryOf(data)['highFindings']).toBe(1);
    expect(summaryOf(data)['riskLevel']).toBe('high');
  });

  it('flags exported high-degree symbols as critical when complexity exceeds 15', async () => {
    const nodes = [makeNode('proj', 'hub', { complexity: 20, isExported: true })];
    for (let i = 0; i < 11; i++) {
      nodes.push(
        makeNode('proj', `leaf${i}`, {
          filePath: 'src/leaves.ts',
          startLine: 100 + i,
          endLine: 100 + i,
        }),
      );
    }
    const links: Link[] = [];
    for (let i = 0; i < 11; i++) {
      links.push({ from: 0, to: i + 1, type: i % 2 === 0 ? EDGE_IMPLEMENTS : EDGE_EXTENDS });
    }
    const { store } = seedGraph('proj', nodes, links);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }, ctx));

    const findings = data['findings'] as Array<Record<string, unknown>>;
    expect(findings.some((f) => f['title'] === 'High impact target: hub')).toBe(true);
    expect(findings.some((f) => f['severity'] === 'critical')).toBe(true);
    expect(summaryOf(data)['criticalFindings']).toBe(1);
    expect(summaryOf(data)['riskLevel']).toBe('critical');
  });

  it('flags exported high-degree symbols as high when complexity is at most 15', async () => {
    const nodes = [makeNode('proj', 'hub', { complexity: 5, isExported: true })];
    for (let i = 0; i < 11; i++) {
      nodes.push(
        makeNode('proj', `leaf${i}`, {
          filePath: 'src/leaves.ts',
          startLine: 100 + i,
          endLine: 100 + i,
        }),
      );
    }
    const { store } = seedGraph(
      'proj',
      nodes,
      Array.from({ length: 11 }, (_, i) => ({ from: 0, to: i + 1 })),
    );
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }, ctx));

    const findings = data['findings'] as Array<Record<string, unknown>>;
    expect(findings.some((f) => f['severity'] === 'high')).toBe(true);
    expect(findings.some((f) => f['severity'] === 'critical')).toBe(false);
    expect(summaryOf(data)['highFindings']).toBe(1);
  });

  it('reports a clean bill of health for an empty project', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }, ctx));

    expect(summaryOf(data)['totalFindings']).toBe(0);
    expect(summaryOf(data)['riskLevel']).toBe('low');
    expect(summaryOf(data)['overallScore']).toBe(100);
    expect(data['recommendations']).toEqual(['No significant issues found — safe to merge']);
  });
});

describe('review_pr - degraded stores', () => {
  it('uses the integrity-check fallback for a raw graph store', async () => {
    const store = new InMemoryGraphStore();
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }, store));

    expect(summaryOf(data)['mergeRecommendation']).toBe('review-manually');
    expect(summaryOf(data)['riskLevel']).toBe('unknown');
    expect(data['reviewMethod']).toBe('Basic integrity check');
    expect(data['graphIntegrity']).toBeDefined();
    expect(data['prNumber']).toBe('N/A');
  });

  it('reports the AI-review flag on the integrity-check fallback too', async () => {
    const store = new InMemoryGraphStore();
    const data = parseResult(
      await registry.execute(
        'review_pr',
        { projectId: 'proj', prNumber: 5, includeAiReview: true },
        store,
      ),
    );

    expect(data['prNumber']).toBe(5);
    expect(data['aiReview']).toBe('LLM backend not available');
  });

  it('asks the caller to index first when there is no store at all', async () => {
    const data = parseResult(await registry.execute('review_pr', { projectId: 'proj' }));

    expect(summaryOf(data)['mergeRecommendation']).toBe('manual-review-needed');
    expect(data['graphIntegrity']).toBeUndefined();
    expect(String(data['note'])).toContain('Index a project first');
  });

  it('returns an error result when the store is closed', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    store.close();

    const result = await registry.execute('review_pr', { projectId: 'proj' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('PR review error: InMemoryGraphStore is closed');
  });
});

describe('check_standards - StandardsEngine phase', () => {
  function writeSource(name: string, content: string): string {
    const path = join(tmpDir, name);
    writeFileSync(path, content, 'utf-8');
    return path;
  }

  it('records engine violations and defaults a missing suggestion to null', async () => {
    const filePath = writeSource('use-strict.js', "'use strict';\nexport const x = 1;\n");
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', filePath, standardIds: ['javascript-best-practices'] },
        ctx,
      ),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    const violation = results.find((r) => r['ruleId'] === 'jsbp-use-strict');
    expect(violation).toBeDefined();
    expect(violation!['suggestion']).toBeNull();
    expect(violation!['source']).toBe('StandardsEngine');
    expect(violation!['passed']).toBe(false);
    expect((data['summary'] as Record<string, number>)['medium']).toBeGreaterThan(0);
    expect(data['reviewMethod']).toBe('StandardsEngine + Graph heuristics');
  });

  it('reports a clean pass when no rule fires', async () => {
    const filePath = writeSource('clean.js', '// nothing to check\n');
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', filePath, standardIds: ['javascript-best-practices'] },
        ctx,
      ),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    expect(results.some((r) => r['title'] === 'All checks passed')).toBe(true);
    expect((data['summary'] as Record<string, number>)['passed']).toBe(1);
  });

  it('skips an unknown standard id gracefully', async () => {
    const filePath = writeSource('unknown-std.js', 'export const x = 1;\n');
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', filePath, standardIds: ['no-such-standard'] },
        ctx,
      ),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(0);
    expect(data['standardsChecked']).toEqual(['no-such-standard']);
  });

  it('falls through to graph heuristics when the file cannot be read', async () => {
    // A directory passes existsSync() but readFileSync() throws EISDIR.
    const dirPath = join(tmpDir, 'as-directory');
    mkdirSync(dirPath, { recursive: true });

    const { store } = seedGraph('proj', [makeNode('proj', 'plain', { filePath: dirPath })], []);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute('check_standards', { projectId: 'proj', filePath: dirPath }, ctx),
    );

    expect(data['reviewMethod']).toBe('StandardsEngine + Graph heuristics');
    expect(data['filePath']).toBe(dirPath);
  });
});

describe('check_standards - graph heuristic phase', () => {
  it('flags a lower-cased class name', async () => {
    const filePath = 'src/app.ts';
    const { store } = seedGraph(
      'proj',
      [makeNode('proj', 'myService', { label: 'Class', filePath })],
      [],
    );
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute('check_standards', { projectId: 'proj', filePath }, ctx),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    const naming = results.find((r) => r['standard'] === 'naming-conventions');
    expect(naming).toBeDefined();
    expect(String(naming!['description'])).toContain('myService');
    expect((data['summary'] as Record<string, number>)['low']).toBe(1);
  });

  it('rates complexity above 10 as medium and above 20 as high', async () => {
    const filePath = 'src/app.ts';
    const { store } = seedGraph(
      'proj',
      [
        makeNode('proj', 'mediumFn', { filePath, complexity: 15 }),
        makeNode('proj', 'highFn', { filePath, complexity: 25 }),
      ],
      [],
    );
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute('check_standards', { projectId: 'proj', filePath }, ctx),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    const complexity = results.filter((r) => r['standard'] === 'complexity-threshold');
    expect(complexity).toHaveLength(2);
    expect(complexity.some((c) => c['severity'] === 'medium')).toBe(true);
    expect(complexity.some((c) => c['severity'] === 'high')).toBe(true);
    const summary = data['summary'] as Record<string, number>;
    expect(summary['medium']).toBe(1);
    expect(summary['high']).toBe(1);
  });

  it('skips graph heuristics when the file has no symbols', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', filePath: 'src/missing.ts' },
        ctx,
      ),
    );

    const results = data['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(0);
    expect(data['complianceScore']).toBe(100);
  });
});

describe('check_standards - project-level analysis', () => {
  function projectWithFunctions(count: number) {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < count; i++) {
      nodes.push(
        makeNode('proj', `fn${i}`, {
          label: i % 2 === 0 ? 'Function' : 'Method',
          filePath: `src/f${i}.ts`,
        }),
      );
    }
    return seedGraph('proj', nodes, []);
  }

  it('announces a large project once more than 100 callables exist', async () => {
    const { store, ids } = projectWithFunctions(101);
    expect(ids).toHaveLength(101);

    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('check_standards', { projectId: 'proj' }, ctx));

    const results = data['results'] as Array<Record<string, unknown>>;
    const large = results.find((r) => r['standard'] === 'project-size');
    expect(large).toBeDefined();
    expect(String(large!['description'])).toContain('across 2 label types');
    expect((data['summary'] as Record<string, number>)['info']).toBeGreaterThan(0);
  });

  it('auto-detects applicable standards and reports them', async () => {
    const { store } = projectWithFunctions(3);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(await registry.execute('check_standards', { projectId: 'proj' }, ctx));

    const results = data['results'] as Array<Record<string, unknown>>;
    const detected = results.find((r) => r['standard'] === 'standards-detection');
    expect(detected).toBeDefined();
    expect(String(detected!['description'])).toContain('security-baseline');
    expect(data['filePath']).toBe('all files');
    expect(data['reviewMethod']).toBe('Graph-backed heuristics + StandardsEngine auto-detection');
    expect(data['standardsChecked']).toContain('typescript-coding');
  });

  it('treats an explicit "all" marker as auto-detection', async () => {
    const { store } = projectWithFunctions(2);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', standardIds: ['all'], autoFix: true },
        ctx,
      ),
    );

    expect(data['standardsChecked']).toContain('documentation');
    expect(data['autoFix']).toBe(true);
    expect(data['note']).toBe('Auto-fix requires configured fix rules');
  });

  it('honours an explicit standard list', async () => {
    const { store } = projectWithFunctions(2);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', standardIds: ['security-baseline'] },
        ctx,
      ),
    );

    expect(data['standardsChecked']).toEqual(['security-baseline']);
    expect(data['autoFix']).toBe(false);
    expect(data['note']).toBeUndefined();
  });

  it('ignores an empty explicit list and auto-detects instead', async () => {
    const { store } = projectWithFunctions(2);
    const ctx = new ToolContextImpl(store);
    const data = parseResult(
      await registry.execute('check_standards', { projectId: 'proj', standardIds: [] }, ctx),
    );

    expect((data['standardsChecked'] as string[]).length).toBeGreaterThan(0);
  });
});

describe('check_standards - degraded stores', () => {
  it('returns the neutral payload without a standard list when there is no context', async () => {
    const data = parseResult(await registry.execute('check_standards', { projectId: 'proj' }));

    expect(data['standardsChecked']).toEqual(['all']);
    expect(data['complianceScore']).toBe(100);
    expect(data['results']).toEqual([]);
    expect(String(data['note'])).toContain('requires indexed project data');
  });

  it('echoes the requested standards when there is no context', async () => {
    const data = parseResult(
      await registry.execute(
        'check_standards',
        { projectId: 'proj', standardIds: ['security-baseline'], filePath: 'src/app.ts' },
        new InMemoryGraphStore(),
      ),
    );

    expect(data['standardsChecked']).toEqual(['security-baseline']);
    expect(data['filePath']).toBe('src/app.ts');
    expect(data['complianceScore']).toBe(100);
  });

  it('returns an error result when the store is closed', async () => {
    const store = new InMemoryGraphStore();
    const ctx = new ToolContextImpl(store);
    store.close();

    const result = await registry.execute('check_standards', { projectId: 'proj' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Standards check error: InMemoryGraphStore is closed');
  });
});
