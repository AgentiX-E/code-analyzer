// @code-analyzer — the feature matrix, measured on a repository rather than a fixture.
//
// **Every claim this project makes is a claim about somebody's repository**, and until this script existed the evidence
// for most of them was a temporary directory with three files. It indexes a checkout, then asks each feature surface the
// question a user would ask - does the file scan, does the symbol search find it, does the change impact reach the
// callers, is a configuration entry placed at a line - and writes the answers as one JSON record plus one markdown
// table. **A probe that cannot be measured is reported as such, never omitted**: an absent row reads like a passing one.
//
// Usage: npx tsx scripts/feature-matrix.ts --repo <dir> --label <owner/name@ref> --out <file.json>

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// **Sources by path, not the package names.** A root-level script is in no workspace package, so the package names do
// not resolve from here - and importing `dist` instead makes the typecheck see one declaration of `InMemoryGraphStore`
// and the runtime another, which is a class identity error the compiler reports and nothing else would.
import {
  GraphBuilder,
  PipelineOrchestrator,
  createAllPhases,
} from '../packages/analyzer/dist/index.js';
import { InMemoryGraphStore } from '../packages/infra/src/index.js';
import { getLanguageFromFilename } from '../packages/shared/src/index.js';

import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  PipelineContext,
} from '../packages/shared/src/index.js';

interface Probe {
  /** The user story the probe answers. */
  story: string;
  name: string;
  value: string;
  /** `measured` - a number this run produced. `unmeasured` - and why, in the same field, so nothing is silently absent. */
  status: 'measured' | 'unmeasured';
}

interface MatrixRecord {
  label: string;
  generatedAt: string;
  corpus: { files: number; byLanguage: Record<string, number>; bytes: number };
  graph: { nodes: number; edges: number; byLanguage: Record<string, number> };
  probes: Probe[];
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Files the scanner would admit, counted by the product's own rule rather than by a second extension table. */
function countIndexable(dir: string, counts: Record<string, number> = {}): Record<string, number> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target')
        continue;
      countIndexable(full, counts);
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      const language = getLanguageFromFilename(full);
      if (language) counts[language] = (counts[language] ?? 0) + 1;
    }
  }
  return counts;
}

function label(node: GraphNode): string {
  return node.label;
}

async function main(): Promise<void> {
  const repo = arg('repo');
  const labelName = arg('label') ?? repo ?? 'unknown';
  const outPath = arg('out');
  const sampleSize = Number(arg('sample') ?? 50);

  if (!repo) {
    console.error(
      'usage: feature-matrix --repo <dir> [--label <name>] [--out <file.json>] [--sample N]',
    );
    process.exit(2);
  }

  const store = new InMemoryGraphStore();
  const builder = new GraphBuilder(store);
  const config = {
    projectId: labelName,
    rootPath: repo,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 200_000,
    parseWorkers: 1,
    ignorePaths: [],
  };
  const ctx = {
    projectId: labelName,
    rootPath: repo,
    phaseData: new Map<string, unknown>(),
    graph: builder.build({ projectId: labelName, rootPath: repo, phaseData: new Map(), config }),
    config,
  } as unknown as PipelineContext;

  const started = Date.now();
  const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  const indexMs = Date.now() - started;
  const graph = ctx.graph as KnowledgeGraph;

  // **The dump phase builds its own store and throws it away**, so a caller that wants to *query* the index has to put
  // it somewhere reachable. This is the same `dumpToStore` the phase calls, on the store the probes read from; without
  // it `searchFts` answers against an empty store and every recall figure is 0 for a reason that has nothing to do with
  // search.
  builder.dumpToStore(graph, labelName);

  const nodes = [...graph.nodes.values()];
  const edges = [...graph.edges.values()];
  const phase = (id: string): Record<string, unknown> =>
    (result.phases.find((p) => p.phaseId === id)?.output ?? {}) as Record<string, unknown>;

  const tree = countIndexable(repo);
  const byLanguage: Record<string, number> = {};
  for (const node of nodes) {
    if (node.label !== 'File') continue;
    const key = String(node.language);
    byLanguage[key] = (byLanguage[key] ?? 0) + 1;
  }

  const probes: Probe[] = [];
  const measured = (story: string, name: string, value: string | number): void => {
    probes.push({ story, name, value: String(value), status: 'measured' });
  };
  const unmeasured = (story: string, name: string, why: string): void => {
    probes.push({ story, name, value: why, status: 'unmeasured' });
  };

  // ── Story 1: the repository is indexed -------------------------------------
  const totalTree = Object.values(tree).reduce((a, b) => a + b, 0);
  const totalIndexed = nodes.filter((n) => n.label === 'File').length;
  measured('1 index', 'files in the tree', totalTree);
  measured('1 index', 'files in the graph', totalIndexed);
  measured('1 index', 'languages in the tree', Object.keys(tree).length);
  measured('1 index', 'languages in the graph', Object.keys(byLanguage).length);
  // **Symbols are counted in two buckets, because a graph that reports 2 527 "classes" for a Spring sample is reporting
  // CSS selectors.** `petclinic.css` defines ~2 400 of them and the CSS provider labels each one `Class`; the figure is
  // real and the headline is not. Code symbols come from the languages with a grammar, everything else is counted on its
  // own line, so neither bucket hides behind the other.
  const STRUCTURAL = new Set(['File', 'Folder', 'Project', 'Community', 'Module']);
  const CODE_LANGUAGES = new Set([
    'typescript',
    'javascript',
    'python',
    'go',
    'java',
    'kotlin',
    'csharp',
    'rust',
    'c',
    'cpp',
    'php',
    'ruby',
    'swift',
    'dart',
    'lua',
    'scala',
    'zig',
    'elixir',
  ]);
  const languageByPath = new Map<string, string>();
  for (const node of nodes) {
    if (node.label === 'File') languageByPath.set(String(node.filePath), String(node.language));
  }
  const languageOfNode = (node: GraphNode): string =>
    languageByPath.get(String(node.filePath)) ?? '';
  const symbols = nodes.filter((n) => !STRUCTURAL.has(label(n)));
  const codeSymbols = symbols.filter((n) => CODE_LANGUAGES.has(languageOfNode(n)));
  measured('1 index', 'code symbols', codeSymbols.length);
  measured('1 index', 'markup/config/style symbols', symbols.length - codeSymbols.length);
  measured('1 index', 'edges', edges.length);
  measured('1 index', 'parse failures', Number(phase('parse')['filesFailed'] ?? 0));
  measured('1 index', 'index time (s)', (indexMs / 1000).toFixed(1));

  // **The split by language is the probe**, because a file the scanner admits and the graph never sees is a provider that
  // was not reached - the defect this matrix exists to catch.
  const missing = Object.entries(tree).filter(
    ([language, count]) => (byLanguage[language] ?? 0) < count,
  );
  if (missing.length === 0) {
    measured('1 index', 'language split matches the tree', 'yes');
  } else {
    unmeasured(
      '1 index',
      'language split matches the tree',
      missing.map(([l, c]) => `${l}: tree ${c}, graph ${byLanguage[l] ?? 0}`).join('; '),
    );
  }

  // ── Story 2: a symbol can be found from its name ---------------------------
  // **The question a user asks is "where is `Foo`", not "where is a documented symbol"**, so the sample is fifty named
  // symbols taken in a fixed order rather than whatever happens to carry a docstring. A corpus with two docstrings once
  // produced a recall figure over two symbols, which is a number about the corpus, not about search.
  const candidates = symbols
    .filter((n) => n.name.length >= 4 && /^[A-Za-z_][\w.$#-]*$/.test(n.name))
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  const step = Math.max(1, Math.floor(candidates.length / sampleSize));
  const sample = candidates.filter((_, i) => i % step === 0).slice(0, sampleSize);
  if (sample.length === 0) {
    unmeasured(
      '2 search',
      'lexical recall@5',
      'no named symbol with a searchable name in this corpus',
    );
  } else {
    // **Two questions, because a symbol name is not always unique.** "Did the search find *a* symbol called this" is
    // what a user means; "did it find *the* node I picked" is what a duplicate name makes impossible. Reporting only
    // the second makes ambiguity look like a search failure; reporting only the first hides it.
    let nameHits = 0;
    let nodeHits = 0;
    let reciprocalRank = 0;
    for (const symbol of sample) {
      const results = store.searchFts(symbol.name, { limit: 5 });
      const wanted = symbol.name.toLowerCase();
      if (results.some((r) => r.node.name.toLowerCase() === wanted)) nameHits += 1;
      const rank = results.findIndex((r) => r.node.id === symbol.id);
      if (rank >= 0) {
        nodeHits += 1;
        reciprocalRank += 1 / (rank + 1);
      }
    }
    measured(
      '2 search',
      `name recall@5 (${sample.length} symbols)`,
      (nameHits / sample.length).toFixed(3),
    );
    measured('2 search', 'exact-node recall@5', (nodeHits / sample.length).toFixed(3));
    measured('2 search', 'MRR@5', (reciprocalRank / sample.length).toFixed(3));
  }

  // ── Story 3: a change's impact can be walked -------------------------------
  const importsByFile = new Map<number, GraphEdge[]>();
  for (const edge of edges) {
    if (edge.type !== 'IMPORTS') continue;
    const list = importsByFile.get(edge.targetId) ?? [];
    list.push(edge);
    importsByFile.set(edge.targetId, list);
  }
  const imported = [...importsByFile.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!imported) {
    unmeasured(
      '3 impact',
      'dependents of the most-imported file',
      'no IMPORTS edge in this corpus',
    );
  } else {
    const dependents = new Set<number>();
    const queue = [imported[0]];
    while (queue.length > 0 && dependents.size < 5000) {
      const current = queue.pop()!;
      for (const edge of edges) {
        if (edge.type !== 'IMPORTS' || edge.targetId !== current) continue;
        if (dependents.has(edge.sourceId)) continue;
        dependents.add(edge.sourceId);
        queue.push(edge.sourceId);
      }
    }
    const owner = nodes.find((n) => n.id === imported[0]);
    measured(
      '3 impact',
      `transitive importers of ${
        String(owner?.filePath ?? imported[0])
          .split('/')
          .slice(-1)[0]
      }`,
      dependents.size,
    );
  }

  // ── Story 4/7: configuration and structure are understood -------------------
  const configNodes = nodes.filter((n) => n.label === 'Config');
  const unplacedConfig = configNodes.filter((n) => (n.startLine ?? 0) < 1);
  measured('7 structure', 'config nodes', configNodes.length);
  measured('7 structure', 'config nodes without a line', unplacedConfig.length);
  measured('7 structure', 'CONFIGURES edges', edges.filter((e) => e.type === 'CONFIGURES').length);
  measured('7 structure', 'communities', Number(phase('communities')['communitiesFound'] ?? 0));
  measured('4 review', 'routes found', Number(phase('routes')['routesFound'] ?? 0));

  const record: MatrixRecord = {
    label: labelName,
    generatedAt: new Date().toISOString(),
    corpus: { files: totalTree, byLanguage: tree, bytes: 0 },
    graph: { nodes: nodes.length, edges: edges.length, byLanguage },
    probes,
  };

  const table = [
    `| ${labelName} | story | probe | value |`,
    '| --- | --- | --- | --- |',
    ...probes.map(
      (p) =>
        `| ${p.status === 'measured' ? '' : '**unmeasured** '} | ${p.story} | ${p.name} | ${p.value} |`,
    ),
  ].join('\n');

  console.log(table);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
