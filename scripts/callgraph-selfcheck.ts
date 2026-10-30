// @code-analyzer — the call graph the product builds of the product, checked against itself.
//
// **A second producer of `CALLS` edges survived a suite of graph assertions, and this is the check that does not.**
// Every test that looked at the call graph asked whether the *right* edges exist; none asked whether an edge exists
// once. `TypeScriptProvider` emitted a call site twice for months, which doubled every fan-in in every TypeScript
// repository and cost nothing in any assertion - because two copies of a correct edge are still correct edges.
//
// The invariant is **`(caller, callee, line)` identifies a call site**, and it needs two facts that the graph did not
// carry until now: the caller and callee are the endpoints, and the line is `properties.sourceLine`. So this script is
// run over **this repository's own sources** - no download, no pinned corpus, nothing that can be absent on a runner -
// and reports the share of edges that are a second copy of a site that already has one.
//
// **A share rather than a count, because a function may legitimately call one callee twice on one line** - `f(f(x))`
// is two call sites and two edges - so zero is not the floor and pretending otherwise would make the check lie. What
// the share can say is that the figure is small and must not grow; a second producer takes it to roughly half.
//
// Usage:
//   npx tsx scripts/callgraph-selfcheck.ts --out benchmarks/callgraph-selfcheck.json

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '../packages/analyzer/src/index.js';
import { getDefaultConfig } from '../packages/core/src/index.js';

import type { KnowledgeGraph, NodeLabel, PipelineContext } from '../packages/shared/src/index.js';

/** The roots the check reads: every package's source, so the sample is the product and not a fixture. */
function defaultRoots(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, 'packages', entry.name, 'src'))
    .filter((directory) => {
      try {
        readdirSync(directory);
        return true;
      } catch {
        return false;
      }
    });
}

interface SiteStats {
  edges: number;
  distinctSites: number;
  repeatedEdges: number;
  share: number;
}

interface Report {
  readonly measuredAt: string;
  readonly roots: string[];
  readonly nodes: number;
  readonly byLabel: Record<string, number>;
  readonly calls: SiteStats;
  readonly byLanguage: Record<string, { edges: number; withReceiver: number }>;
  readonly byArm: Record<string, number>;
  /** `CALLS` edges whose `resolution` is missing, which is what the deleted cartesian pass produced. */
  readonly untagged: number;
}

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function indexRoot(root: string, projectId: string): Promise<KnowledgeGraph> {
  const config = getDefaultConfig();
  config.projectId = projectId;
  config.rootPath = root;
  const context = {
    projectId,
    rootPath: root,
    config,
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  // **Every phase but the embedding one.** The check is about structure, and the embedding phase reaches the network
  // when a key is set, which would make the figure depend on a quota.
  const phases = createAllPhases().filter((phase) => phase.id !== 'embed');
  const result = await new PipelineOrchestrator(phases).execute(context);
  return result.graph;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..');
  const roots = defaultRoots(repoRoot);
  const out = argOf('out') ?? join(repoRoot, 'benchmarks', 'callgraph-selfcheck.json');

  const byLabel: Record<string, number> = {};
  const byLanguage: Record<string, { edges: number; withReceiver: number }> = {};
  const byArm: Record<string, number> = {};
  const sites = new Map<string, number>();
  let nodes = 0;
  let edges = 0;
  let untagged = 0;

  for (const [index, root] of roots.entries()) {
    const projectId = `selfcheck-${String(index)}`;
    const graph = await indexRoot(root, projectId);
    nodes += graph.nodes.size;

    const labelOf = new Map<number, NodeLabel>();
    const languageOf = new Map<number, string | null>();
    const nameOf = new Map<number, string>();
    for (const node of graph.nodes.values()) {
      labelOf.set(node.id, node.label);
      languageOf.set(node.id, node.language);
      nameOf.set(node.id, node.qualifiedName);
      byLabel[node.label] = (byLabel[node.label] ?? 0) + 1;
    }

    for (const edge of graph.edges.values()) {
      if (edge.type !== 'CALLS') continue;
      edges++;
      const language = languageOf.get(edge.sourceId) ?? 'null';
      const bucket = byLanguage[language] ?? { edges: 0, withReceiver: 0 };
      bucket.edges++;
      if (edge.properties?.['receiver'] !== undefined) bucket.withReceiver++;
      byLanguage[language] = bucket;

      const arm = edge.properties?.['resolution'];
      if (typeof arm === 'string') byArm[arm] = (byArm[arm] ?? 0) + 1;
      else untagged++;

      // **The identity of a call site.** The endpoints are qualified names rather than ids, because two projects are
      // indexed side by side here and an id is only unique within one of them.
      const line = edge.properties?.['sourceLine'];
      const key = `${nameOf.get(edge.sourceId) ?? '?'}->${nameOf.get(edge.targetId) ?? '?'}@${String(line ?? 'none')}`;
      sites.set(key, (sites.get(key) ?? 0) + 1);
    }
  }

  const repeatedEdges = [...sites.values()].reduce((sum, count) => sum + (count - 1), 0);
  const report: Report = {
    measuredAt: new Date().toISOString().slice(0, 10),
    roots: roots.map((root) => root.slice(repoRoot.length + 1)),
    nodes,
    byLabel,
    calls: {
      edges,
      distinctSites: sites.size,
      repeatedEdges,
      share: edges === 0 ? 0 : Number((repeatedEdges / edges).toFixed(4)),
    },
    byLanguage,
    byArm,
    untagged,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `self-check: ${String(report.roots.length)} roots · ${String(nodes)} nodes · ${String(edges)} CALLS edges · ` +
      `${String(sites.size)} distinct sites · ${String(repeatedEdges)} repeated (${(report.calls.share * 100).toFixed(2)} %) · ` +
      `${String(untagged)} untagged`,
  );
  for (const [language, bucket] of Object.entries(byLanguage).sort()) {
    console.log(
      `  ${language.padEnd(12)} ${String(bucket.edges).padStart(6)} edges · ` +
        `${String(bucket.withReceiver).padStart(6)} with a receiver`,
    );
  }
  console.log(`wrote ${out.slice(repoRoot.length + 1)}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
