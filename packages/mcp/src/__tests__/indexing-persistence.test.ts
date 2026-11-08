/**
 * @fileoverview `analyze_repository` must leave the graph somewhere.
 *
 * **The defect this file exists for.** The tool ran the full pipeline, reported `nodeCount: 805`, and dropped the
 * result: `currentAnalysis` was assigned on the tool context and read by nothing, so after "indexing" a project the graph
 * store held zero nodes and every query tool answered about an empty graph. Every existing test passed, because they
 * insert their nodes by hand — the end-to-end path was the one nobody ran. These cases run it.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeRepository, listProjects } from '../tools/indexing-lifecycle.js';
import { ToolContextImpl } from '../tools/tool-context.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let root: string;
const PROJECT = 'persistence-fixture';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'analyze-persistence-'));
  writeFileSync(
    join(root, 'engine.ts'),
    [
      'export interface Ranker { rank(input: string): number }',
      '',
      'export class Engine implements Ranker {',
      '  rank(input: string): number {',
      '    return input.length;',
      '  }',
      '}',
      '',
      'export function score(text: string): number {',
      '  return new Engine().rank(text);',
      '}',
      '',
    ].join('\n'),
  );
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(
    join(root, 'lib', 'util.ts'),
    [
      'export function clamp(value: number, max: number): number {',
      '  return Math.min(value, max);',
      '}',
      '',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('analyze_repository persistence', () => {
  it('**writes the analysed graph into the store it was given**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });

    const result = await analyzeRepository({ path: root, projectId: PROJECT }, context);
    const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
      nodeCount: number;
      persisted: { persisted: boolean; nodes: number; edges: number; reason: string | null };
    };

    expect(result.isError).toBeUndefined();
    expect(payload.nodeCount).toBeGreaterThan(0);
    expect(payload.persisted.persisted).toBe(true);
    expect(payload.persisted.nodes).toBe(payload.nodeCount);
    expect(store.getAllNodes().length).toBe(payload.nodeCount);
    expect(store.getAllNodes().every((node) => node.projectId === PROJECT)).toBe(true);
  }, 60_000);

  it('**every stored edge points at nodes the store owns, because the ids were remapped**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    await analyzeRepository({ path: root, projectId: PROJECT }, context);

    const nodes = store.getAllNodes();
    const ids = new Set(nodes.map((node) => node.id));
    for (const edge of store.getAllEdges()) {
      expect(ids.has(edge.sourceId)).toBe(true);
      expect(ids.has(edge.targetId)).toBe(true);
    }
    // A graph with files and no edges would pass the loop above; the fixture has a call, so an edge must exist.
    expect(store.getAllEdges().length).toBeGreaterThan(0);
  }, 60_000);

  it('**makes the project visible to the tool that lists projects**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    await analyzeRepository({ path: root, projectId: PROJECT }, context);

    const listed = await listProjects({}, context);
    const payload = JSON.parse(listed.content[0]!.text ?? '{}') as {
      items: Array<{ projectId?: string; id?: string }>;
    };
    expect(payload.items.length).toBe(1);
  }, 60_000);

  it('**re-indexing with force replaces rather than collides**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    const first = await analyzeRepository({ path: root, projectId: PROJECT }, context);
    const firstCount = store.getAllNodes().length;

    const second = await analyzeRepository(
      { path: root, projectId: PROJECT, force: true },
      context,
    );
    const payload = JSON.parse(second.content[0]!.text ?? '{}') as {
      persisted: { nodes: number; duplicateNodes: number; reason: string | null };
    };

    expect(first.isError).toBeUndefined();
    expect(payload.persisted.duplicateNodes).toBe(0);
    expect(payload.persisted.reason).toBeNull();
    expect(store.getAllNodes().length).toBe(firstCount);
  }, 90_000);

  it('**a context with no store says so instead of reporting a successful index**', async () => {
    const result = await analyzeRepository({ path: root, projectId: PROJECT });
    const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
      persisted: { persisted: boolean; reason: string | null };
      nodeCount: number;
    };
    // The legacy path (no context) still runs the store-only branch and reports what it found; what it must never do
    // is claim persistence it did not perform.
    expect(payload.persisted?.persisted ?? false).toBe(false);
  }, 60_000);
});
