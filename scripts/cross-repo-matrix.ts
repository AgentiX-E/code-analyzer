// @code-analyzer — the cross-repository matrix, measured on two real checkouts.
//
// **Story 5 is the product's strongest claim and its evidence was a fixture.** `cross-repo-e2e` builds two
// temporary directories with a few files each and asserts that an import between them resolves; no run had ever
// pointed the group indexer at two repositories that were released separately and depend on each other through a
// package name rather than through `../`.
//
// This script does that and writes the answers as numbers:
//
//   1. **resolution** — of the (importing file, imported file) pairs that Python's own parser says exist, how many
//      did the graph resolve, and did any edge appear that the parser does not corroborate?
//   2. **trace** — "who uses this symbol in my other repository?" answered from the graph, checked against the
//      files the parser says name it.
//   3. **impact** — "what breaks in flask if this werkzeug module changes?" checked against the same list.
//
// **The expected answers are never produced by the code under test.** They come from
// `scripts/cross-repo-ground-truth.py`, which uses `ast`; this script only reads its output.
//
// Usage: npx tsx scripts/cross-repo-matrix.ts \
//   --repo pallets/flask=<dir> --repo pallets/werkzeug=<dir> \
//   --gt pallets/flask=<gt.json> --out benchmarks/cross-repo-matrix.json

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { InMemoryGraphStore } from '../packages/infra/src/index.js';
import { CrossRepoIndexer, RepoGroupManager } from '../packages/intelligence/src/index.js';

/** One entry of the ground-truth file written by the Python script. */
interface GroundTruthPair {
  importer: string;
  module: string;
  target: string;
  names: string[];
}

interface GroundTruth {
  importer: string;
  package: string;
  pairCount: number;
  importStatements: number;
  filesScanned: number;
  pairs: GroundTruthPair[];
  unresolved: { module: string; statements: number }[];
}

interface PathArgument {
  name: string;
  path: string;
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}`) out.push(process.argv[index + 1] ?? '');
  });
  return out;
}

/** `owner/name=/path` → its two halves. */
function parsePair(raw: string): PathArgument {
  const split = raw.lastIndexOf('=');
  if (split <= 0) throw new Error(`expected owner/name=path, got "${raw}"`);
  return { name: raw.slice(0, split), path: raw.slice(split + 1) };
}

/** `hit` over `expected`, guarded so an empty denominator is reported as 0 rather than as a pass. */
function ratio(hit: number, expected: number): number {
  return expected === 0 ? 0 : Number((hit / expected).toFixed(4));
}

async function main(): Promise<void> {
  const repos = args('repo').map(parsePair);
  const groundTruthPaths = args('gt').map(parsePair);
  const outPath = args('out')[0];

  if (repos.length < 2) {
    console.error(
      'usage: cross-repo-matrix --repo owner/name=<dir> (twice or more) --gt owner/name=<json>',
    );
    process.exit(2);
  }

  const groupId = 'cross-repo-matrix';
  const store = new InMemoryGraphStore();
  const groupManager = new RepoGroupManager();
  const indexer = new CrossRepoIndexer(store, groupManager);

  groupManager.createGroup(groupId, 'cross-repo-matrix', 'two real checkouts in one workspace');
  for (const repo of repos) {
    const [owner, name] = repo.name.split('/');
    groupManager.addRepo(groupId, owner ?? '', name ?? repo.name, '', repo.path);
  }

  // **The pipeline, so the workspace holds what a single-repository analysis holds.** Without it the graph below is
  // imports and nothing else, and the three questions this script answers are answered from a graph with no calls in
  // it. `index.census` publishes every relation the store ended up with, because "1 201 edges" cannot say that none
  // of them is a call.
  const started = Date.now();
  const index = await indexer.indexGroup(groupId, { pipeline: true });
  const indexMs = Date.now() - started;

  const allEdges = store.getAllEdges();
  const crossByType: Record<string, number> = {};
  for (const edge of allEdges) {
    if (!edge.type.startsWith('CROSS_REPO_')) continue;
    crossByType[edge.type] = (crossByType[edge.type] ?? 0) + 1;
  }

  // The repository whose package is imported — the one ground truth does not speak for.
  const importingRepos = new Set(groundTruthPaths.map((entry) => entry.name));
  const declaringRepos = repos
    .filter((repo) => !importingRepos.has(repo.name))
    .map((repo) => repo.name);
  if (declaringRepos.length !== 1) {
    console.error(
      `expected exactly one repository to be the imported one, found ${declaringRepos.join(', ') || 'none'}`,
    );
    process.exit(2);
  }
  const declaringRepo = declaringRepos[0]!;

  const groundTruths = groundTruthPaths.map(
    (entry) => JSON.parse(readFileSync(entry.path, 'utf-8')) as GroundTruth,
  );
  const repoOfPair = new Map<GroundTruthPair, string>();
  for (const truth of groundTruths) {
    for (const pair of truth.pairs) repoOfPair.set(pair, truth.importer);
  }

  // -------------------------------------------------------------------------
  // 1. Resolution, against the parser's pairs
  // -------------------------------------------------------------------------
  /** `importing repo` → the (imported file, importing file) pairs the graph claims, keyed by `\0`. */
  const claimedPairs = new Map<string, Set<string>>();
  const namesByPair = new Map<string, Set<string>>();
  for (const edge of allEdges) {
    if (edge.type !== 'IMPORTS') continue;
    if (edge.properties?.['resolution'] !== 'package') continue;
    const source = store.getNode(edge.sourceId);
    const target = store.getNode(edge.targetId);
    if (!source?.filePath || !target?.filePath) continue;
    if (source.projectId === target.projectId) continue;

    // `source` is the imported file and `target` the importing one — the edge direction the indexer uses —
    // while a ground-truth pair is written `(imported, importer)`.
    const key = `${source.filePath}\u0000${target.filePath}`;
    const claimed = claimedPairs.get(target.projectId) ?? new Set<string>();
    claimed.add(key);
    claimedPairs.set(target.projectId, claimed);

    const names = namesByPair.get(key) ?? new Set<string>();
    const recorded = edge.properties['importedSymbols'];
    if (Array.isArray(recorded)) for (const name of recorded) names.add(String(name));
    namesByPair.set(key, names);
  }

  const perImporter: Array<Record<string, unknown>> = [];
  const falseEdges: string[] = [];
  let expectedPairs = 0;
  let resolvedPairs = 0;
  let expectedNames = 0;
  let foundNames = 0;

  for (const truth of groundTruths) {
    const expected = new Set(truth.pairs.map((pair) => `${pair.target}\u0000${pair.importer}`));
    const claimed = claimedPairs.get(truth.importer) ?? new Set<string>();

    let resolved = 0;
    let namesExpected = 0;
    let namesFound = 0;
    for (const pair of truth.pairs) {
      const key = `${pair.target}\u0000${pair.importer}`;
      if (!claimed.has(key)) continue;
      resolved += 1;
      const recorded = namesByPair.get(key) ?? new Set<string>();
      for (const name of pair.names) {
        namesExpected += 1;
        if (recorded.has(name)) namesFound += 1;
      }
    }
    for (const key of claimed) {
      if (expected.has(key)) continue;
      const [target, importer] = key.split('\u0000');
      falseEdges.push(`${importer} → ${target}`);
    }

    expectedPairs += expected.size;
    resolvedPairs += resolved;
    expectedNames += namesExpected;
    foundNames += namesFound;

    perImporter.push({
      importer: truth.importer,
      package: truth.package,
      groundTruthPairs: expected.size,
      importStatements: truth.importStatements,
      resolvedPairs: resolved,
      recall: ratio(resolved, expected.size),
      nameRecall: ratio(namesFound, namesExpected),
      unresolvedModules: truth.unresolved,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Trace — "who uses this symbol in my other repository?"
  // -------------------------------------------------------------------------
  const importersBySymbol = new Map<string, Set<string>>();
  for (const truth of groundTruths) {
    for (const pair of truth.pairs) {
      for (const name of pair.names) {
        // `*` is a namespace import, not a symbol: asking the graph who uses a symbol called `*` is not a
        // question, and counting it as a miss would report a perfect answer as 94 %.
        if (name === '*') continue;
        const importers = importersBySymbol.get(name) ?? new Set<string>();
        importers.add(pair.importer);
        importersBySymbol.set(name, importers);
      }
    }
  }

  let traceExpected = 0;
  let traceFound = 0;
  const traceMisses: string[] = [];
  for (const symbol of [...importersBySymbol.keys()].sort()) {
    const traces = await indexer.traceSymbolDependencies(groupId, declaringRepo, symbol);
    const found = new Set(traces.map((trace) => trace.targetFile));
    for (const importer of [...importersBySymbol.get(symbol)!].sort()) {
      traceExpected += 1;
      if (found.has(importer)) {
        traceFound += 1;
      } else {
        traceMisses.push(`${symbol} → ${importer}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Impact — "what breaks if this module changes?"
  // -------------------------------------------------------------------------
  const importersByFile = new Map<string, Set<string>>();
  const symbolsByFile = new Map<string, Set<string>>();
  for (const [pair, repo] of repoOfPair) {
    const key = `${repo}\u0000${pair.target}`;
    const importers = importersByFile.get(key) ?? new Set<string>();
    importers.add(pair.importer);
    importersByFile.set(key, importers);

    const symbols = symbolsByFile.get(key) ?? new Set<string>();
    for (const name of pair.names) symbols.add(name);
    symbolsByFile.set(key, symbols);
  }

  let impactExpected = 0;
  let impactFound = 0;
  let impactExtra = 0;
  const impactMisses: string[] = [];
  const impactExtras: string[] = [];

  for (const key of [...importersByFile.keys()].sort()) {
    const importers = importersByFile.get(key)!;
    const result = await indexer.analyzeCrossRepoImpact(groupId, declaringRepo, [
      ...(symbolsByFile.get(key) ?? []),
    ]);
    const reported = new Set(result.analysis.flatMap((item) => item.affectedFiles));
    for (const importer of [...importers].sort()) {
      impactExpected += 1;
      if (reported.has(importer)) {
        impactFound += 1;
      } else {
        impactMisses.push(`${key.split('\u0000')[1]} → ${importer}`);
      }
    }
    for (const file of reported) {
      if (importers.has(file)) continue;
      impactExtra += 1;
      impactExtras.push(`${key.split('\u0000')[1]} → ${file}`);
    }
  }

  const record = {
    comment: [
      'Cross-repository analysis on two real checkouts, in one workspace.',
      '',
      '**Every expected answer comes from `scripts/cross-repo-ground-truth.py`**, which parses the importing',
      "repository with Python's `ast` and resolves modules with the interpreter's own rules. The product never",
      'contributes to its own expected answers.',
      '',
      '**`falseEdges` is the precision half**: an edge the graph claims that the parser does not corroborate is',
      'listed by name, because a wrong edge is worse than a missing one for every question that follows.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    corpora: repos.map((repo) => ({ repo: repo.name })),
    index: {
      durationMs: indexMs,
      nodes: store.getNodeCount(),
      edges: store.getEdgeCount(),
      imports: allEdges.filter((edge) => edge.type === 'IMPORTS').length,
      // **The relation a workspace did not have.** A number in the record rather than a claim in a document.
      calls: index.edgesByType['CALLS'] ?? 0,
      crossRepoEdges: crossByType['CROSS_REPO_IMPORTS'] ?? 0,
      byType: crossByType,
      /**
       * Cross-repository edges that are neither an import nor a call the pipeline resolved.
       *
       * **A workspace may not claim a dependency nothing else supports.** Two repositories share relative paths
       * (`.github`, `.devcontainer`) and every community detector numbers from one, so merging their graphs without
       * scoping the names made one repository's folder edges point at the other's nodes - **375 `CROSS_REPO_DEPENDS`
       * edges** that no import, call or contract corroborates. The figure is written so a gate can hold it at zero.
       */
      unsupportedCrossRepoEdges: Object.entries(crossByType)
        .filter(([type]) => type !== 'CROSS_REPO_IMPORTS' && type !== 'CROSS_REPO_CALLS')
        .reduce((total, [, count]) => total + count, 0),
      census: index.edgesByType,
      reposIndexed: index.reposIndexed,
      errors: index.errors,
    },
    resolution: {
      groundTruthPairs: expectedPairs,
      resolvedPairs,
      recall: ratio(resolvedPairs, expectedPairs),
      precision: ratio(resolvedPairs, resolvedPairs + falseEdges.length),
      nameRecall: ratio(foundNames, expectedNames),
      falseEdges,
      perImporter,
    },
    trace: {
      expectations: traceExpected,
      found: traceFound,
      recall: ratio(traceFound, traceExpected),
      misses: traceMisses.slice(0, 20),
    },
    impact: {
      expectations: impactExpected,
      found: impactFound,
      recall: ratio(impactFound, impactExpected),
      reportedFiles: impactFound + impactExtra,
      /**
       * **The strict figure, and why it is not the plain one.**
       *
       * The expected answer is "the files whose import statement names the changed symbol". The product also
       * reports a file that reaches the symbol through a **re-export** (`from werkzeug import Request`, served by
       * `werkzeug/__init__.py`) or through a **namespace import** (`import werkzeug`, then `werkzeug.Request`).
       * Both are genuinely affected — that is why the trace figure is 100 % — and neither is in a ground truth
       * built from explicit names, so the excess is counted here rather than argued away.
       */
      strictPrecision: ratio(impactFound, impactFound + impactExtra),
      extras: impactExtras.slice(0, 20),
      misses: impactMisses.slice(0, 20),
    },
  };

  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, 'utf-8');
  } else {
    process.stdout.write(text);
  }

  console.log(
    `resolution ${resolvedPairs}/${expectedPairs} · nameRecall ${record.resolution.nameRecall}` +
      ` · trace ${traceFound}/${traceExpected}` +
      ` · impact ${impactFound}/${impactExpected} (strict precision ${record.impact.strictPrecision})`,
  );
}

void main();
