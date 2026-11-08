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

import { createAllPhases, PipelineOrchestrator } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeRepository, listProjects } from '../tools/indexing-lifecycle.js';
import { ToolContextImpl } from '../tools/tool-context.js';

import type { ExecutablePhase } from '@code-analyzer/analyzer';
import type { NewGraphEdge } from '@code-analyzer/infra';

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

  it('**force replaces this project and leaves every other project in the store untouched**', async () => {
    const OTHER = 'the-other-project';
    const store = new InMemoryGraphStore();
    const callerId = seedSymbol(store, OTHER, 'caller');
    const calleeId = seedSymbol(store, OTHER, 'callee');
    store.insertEdge({
      projectId: OTHER,
      type: 'CALLS',
      sourceId: callerId,
      targetId: calleeId,
    });

    const context = new ToolContextImpl(store, { llm: null });
    await analyzeRepository({ path: root, projectId: PROJECT }, context);
    const result = await analyzeRepository(
      { path: root, projectId: PROJECT, force: true },
      context,
    );
    const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
      persisted: { nodes: number; duplicateNodes: number; reason: string | null };
    };

    // **A `force` that emptied the whole store would pass the duplicate assertions above and delete a neighbour.**
    // The delete loops are per-project for exactly this reason, and the branches that skip a foreign node and a
    // foreign edge are the two no other case reaches.
    expect(result.isError).toBeUndefined();
    expect(payload.persisted.duplicateNodes).toBe(0);
    expect(payload.persisted.reason).toBeNull();
    expect(store.getAllNodes().filter((node) => node.projectId === OTHER)).toHaveLength(2);
    expect(store.getAllEdges().filter((edge) => edge.projectId === OTHER)).toHaveLength(1);
  }, 90_000);

  it('**a store that refuses an edge has the refusal counted, not thrown and not ignored**', async () => {
    // **The arm no pipeline reaches by itself.** `persistGraph` counts an edge the store would not take, and the
    // reason it records is the only thing that tells an operator a half-written graph from a complete one. The
    // pipeline's own edges always land, so the refusal has to come from a store that refuses.
    class RefusingStore extends InMemoryGraphStore {
      override insertEdge(_input: NewGraphEdge): number {
        throw new Error('edge rejected by the store');
      }
    }
    const store = new RefusingStore();
    const context = new ToolContextImpl(store, { llm: null });

    const result = await analyzeRepository({ path: root, projectId: PROJECT }, context);
    const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
      nodeCount: number;
      persisted: {
        persisted: boolean;
        nodes: number;
        edges: number;
        orphanEdges: number;
        reason: string | null;
      };
    };

    expect(result.isError).toBeUndefined();
    expect(payload.nodeCount).toBeGreaterThan(0);
    expect(payload.persisted.nodes).toBe(payload.nodeCount);
    expect(payload.persisted.edges).toBe(0);
    expect(payload.persisted.orphanEdges).toBeGreaterThan(0);
    expect(payload.persisted.reason).toContain('was not stored');
  }, 90_000);

  it('**a run whose parse phase failed stores nothing and still answers**', async () => {
    // **This is what a crashed parse looks like from here**: the phase writes nothing into `phaseData`, the taint
    // step finds no inputs, and the tool must report a run that produced no graph rather than throw or claim nodes.
    // The failure is injected at the phase boundary — the orchestrator's own extension point — because the real
    // parse phase swallows per-file errors and there is no file that makes it fail as a phase.
    const all = createAllPhases();
    const parse = all.find((phase) => phase.id === 'parse');
    if (!parse) throw new Error('the phase list no longer contains parse');
    const crashed: ExecutablePhase = {
      id: 'parse',
      dependencies: parse.dependencies,
      description: parse.description,
      parallelizable: parse.parallelizable,
      execute: async () => ({
        phaseId: 'parse',
        status: 'failed',
        error: 'parser crashed on every file',
      }),
    };
    const store = new InMemoryGraphStore();
    const context = new PhaseListContext(
      store,
      all.map((phase) => (phase.id === 'parse' ? crashed : phase)),
    );

    const result = await analyzeRepository({ path: root, projectId: PROJECT }, context);
    const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
      status: string;
      nodeCount: number;
      persisted: { persisted: boolean; nodes: number; reason: string | null };
      errors: Array<{ phaseId: string }>;
    };

    expect(result.isError).toBeUndefined();
    // `partial` is the orchestrator's word for a run in which some phases failed; what must never happen is
    // `complete`, which is the status a caller reads as "the graph is whole".
    expect(payload.status).not.toBe('complete');
    expect(payload.errors.some((error) => error.phaseId === 'parse')).toBe(true);
    expect(payload.persisted.persisted).toBe(true);
    // **Three structural nodes, no symbols.** `scan` and `structure` still ran, so the store holds Folders and Files;
    // what a failed parse cannot produce is a function, and the assertion is about the difference rather than a zero
    // that only holds while no other phase writes a node.
    expect(payload.persisted.nodes).toBe(store.getAllNodes().length);
    expect(store.getAllNodes().map((node) => node.label)).not.toContain('Function');
    expect(context.taintFindings).toHaveLength(0);
  }, 90_000);

  it('**a taint analysis that throws is reported, and the index still completes**', async () => {
    // **The catch that made five defects invisible** returned an empty array on failure, so "the analysis ran and
    // found nothing" and "the analysis broke" were the same value. It now keeps the empty array and says so.
    const parseData: ExecutablePhase = {
      id: 'parse',
      // No dependencies: a phase that declares one the list does not contain makes `validatePipeline` reject the
      // whole run, and then the taint step never sees the data this case is built to hand it.
      dependencies: [],
      description: 'parse data the taint analysis cannot read',
      parallelizable: false,
      execute: async (ctx) => {
        // `null` where a parsed file belongs: the real analysis dereferences it and throws, which is the arm under
        // test. A well-formed empty file list would be the happy path and would cover nothing.
        ctx.phaseData.set('parse', { parsedFiles: [null], taintExtraction: new Map() });
        return { phaseId: 'parse', status: 'success' };
      },
    };
    const scopeData: ExecutablePhase = {
      id: 'scopeResolution',
      dependencies: [],
      description: 'call sites the taint analysis cannot read',
      parallelizable: false,
      execute: async (ctx) => {
        ctx.phaseData.set('scopeResolution', { callSites: new Map() });
        return { phaseId: 'scopeResolution', status: 'success' };
      },
    };
    const store = new InMemoryGraphStore();
    const context = new PhaseListContext(store, [parseData, scopeData]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const result = await analyzeRepository({ path: root, projectId: PROJECT }, context);
      const payload = JSON.parse(result.content[0]!.text ?? '{}') as {
        persisted: { persisted: boolean };
      };

      expect(result.isError).toBeUndefined();
      expect(payload.persisted.persisted).toBe(true);
      expect(context.taintFindings).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        'taint analysis failed; continuing without its findings',
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A node the store can hold, so a second project can be present without a pipeline run. */
function seedSymbol(store: InMemoryGraphStore, projectId: string, name: string): number {
  return store.insertNode({
    projectId,
    label: 'Function',
    name,
    qualifiedName: `${projectId}:${name}`,
    filePath: null,
    startLine: null,
    endLine: null,
    language: 'typescript',
    properties: {},
    complexity: null,
    isExported: false,
  });
}

/**
 * A context whose pipeline is the **real orchestrator** over a chosen phase list.
 *
 * Swapping phases is how the orchestrator is meant to be composed (`new PipelineOrchestrator(phases)` is the public
 * constructor), so a case built this way runs the real ordering, the real `phaseData` channel and the real failure
 * handling. Nothing about the code under test is replaced: only the collaboration it is handed.
 */
class PhaseListContext extends ToolContextImpl {
  private readonly phaseList: ExecutablePhase[];

  constructor(store: InMemoryGraphStore, phaseList: ExecutablePhase[]) {
    super(store, { llm: null });
    this.phaseList = phaseList;
  }

  override async getPipeline(): Promise<PipelineOrchestrator> {
    return new PipelineOrchestrator(this.phaseList);
  }
}
