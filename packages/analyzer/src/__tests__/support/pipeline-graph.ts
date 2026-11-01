// @code-analyzer/analyzer — one pipeline, five phases, and the questions a resolution test asks of it.
//
// **Three copies of this scaffolding had grown in three test files, and the copies had drifted** — one returned
// `{target, resolution}`, another returned bare names, a third resolved a node id by a different suffix rule — so a
// positive result in one file said nothing about the same rule in another. It is written once here, and the fixture
// directory is the only parameter.
//
// **Five phases and no more.** Anything later would answer a question these tests do not ask (communities, processes,
// semantics), and anything earlier would not have the edges they are about.

import { PipelineOrchestrator } from '../../pipeline/orchestrator.js';
import {
  CrossFilePhase,
  ParsePhase,
  ScanPhase,
  ScopeResolutionPhase,
  StructurePhase,
} from '../../pipeline/phases/index.js';

import type { KnowledgeGraph, PipelineContext } from '@code-analyzer/shared';

/** The absolute path of a fixture directory under `__tests__/fixtures/`. */
export function fixturePath(name: string): string {
  return new URL(`../fixtures/${name}/`, import.meta.url).pathname;
}

/**
 * The graph of every file in one fixture directory.
 *
 * The configuration is the minimum the five phases need, spelled out rather than defaulted, so a test that fails
 * because a file was not scanned fails on this line and not inside a default.
 */
export async function buildGraph(fixture: string): Promise<KnowledgeGraph> {
  const rootPath = fixturePath(fixture);
  const config = {
    projectId: fixture,
    rootPath,
    ignorePaths: [],
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 1000,
    parseWorkers: 1,
    cacheDir: '.code-analyzer-test',
  };
  const ctx = {
    projectId: fixture,
    rootPath,
    graph: {
      projectId: fixture,
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    },
    config,
    phaseData: new Map<string, unknown>(),
  } as unknown as PipelineContext;
  await new PipelineOrchestrator([
    new ScanPhase(),
    new StructurePhase(),
    new ParsePhase(),
    new CrossFilePhase(),
    new ScopeResolutionPhase(),
  ]).execute(ctx);
  return ctx.graph as KnowledgeGraph;
}

/** The id of the one node whose qualified name ends with `suffix`. */
export function idOf(graph: KnowledgeGraph, suffix: string): number {
  const id = [...graph.nodes.values()].find(
    (node) => node.qualifiedName !== null && node.qualifiedName.endsWith(suffix),
  )?.id;
  if (id === undefined) throw new Error(`no node named …${suffix}`);
  return id;
}

/** One `CALLS` edge, as the target's last name, the file it is declared in, and the arm that made the edge. */
export interface Call {
  readonly target: string;
  /** The target's file name alone, which is the only identity a name declared in two files leaves. */
  readonly file: string;
  readonly resolution: unknown;
  readonly sourceLine: unknown;
}

/**
 * The file a node is declared in, by name.
 *
 * **`split('/').pop()` reads as if it can be empty and cannot be.** A `pop()` on the result of a `split` returns
 * `undefined` only for an empty array, and a `split` always produces at least one element - so the `?? ''` that used to
 * guard it was a branch no input could reach, which is a statement the coverage gate would have asked to be *tested*
 * rather than deleted. `slice` from the last separator has no such branch and answers the same thing.
 *
 * **And a property is not a string until one has been read as a string.** `String(x ?? '')` looks like the same
 * expression, but the type of `unknown ?? ''` is `{}` - the null and undefined members are what `??` removed - so the
 * call reads as a stringification of an object. Narrowing on `typeof` says what the property is, and the branch it
 * adds is one a test can reach: a node whose path was never filed.
 */
function fileNameOf(node: { readonly properties?: Record<string, unknown> } | undefined): string {
  const filed = node?.properties?.['filePath'];
  const path = typeof filed === 'string' ? filed : '';
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Every call edge out of the declarations ending with `suffix`. */
export function callsFrom(graph: KnowledgeGraph, suffix: string): Call[] {
  const sources = [...graph.nodes.values()].filter(
    (node) => node.qualifiedName !== null && node.qualifiedName.endsWith(suffix),
  );
  const out: Call[] = [];
  for (const source of sources) {
    for (const edge of graph.edges.values()) {
      if (edge.type !== 'CALLS' || edge.sourceId !== source.id) continue;
      const target = graph.nodes.get(edge.targetId);
      const qualified = String(target?.qualifiedName ?? '');
      out.push({
        target: qualified.slice(qualified.lastIndexOf(':') + 1),
        file: fileNameOf(target),
        resolution: edge.properties['resolution'],
        sourceLine: edge.properties['sourceLine'],
      });
    }
  }
  return out;
}

/** The targets alone, for the tests that are about which calls exist rather than which rule answered. */
export function targets(graph: KnowledgeGraph, suffix: string): string[] {
  return callsFrom(graph, suffix).map((call) => call.target);
}
