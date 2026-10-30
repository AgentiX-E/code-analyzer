// @code-analyzer — how good the call graph is, measured against Python's own parser.
//
// **The call graph had numbers and no accuracy.** Every figure published about `CALLS` so far was a count - 6 690
// edges on `pallets/flask`, 21 549 in a workspace - and a count cannot tell a resolution from a guess. When the
// count was finally checked, the pass producing most of it turned out to join every function of a file to every
// name the file mentions: `__getattr__ -> pop`, `__getattr__ -> setdefault`, 88 % of same-file edges wrong.
//
// This script answers the question the count could not: **of the edges the graph claims, how many does an
// independent implementation agree with, and which of the true ones is it missing?** The independent
// implementation is `scripts/callgraph-oracle.py`, which parses the same checkout with CPython's `ast` and
// resolves each call site by Python's own scoping and module rules. Neither implementation reads the other.
//
// **A metric that can only go up is not a metric**, so recall is reported next to precision with the same weight,
// the oracle's silence is excluded from both rather than counted as agreement, and the collisions the graph's
// `(file, name)` identity cannot represent are published as the ceiling.
//
// **And a second oracle, for the language the product is written in.** The figures above describe Python; nothing
// scored a TypeScript edge, so a rule that resolved `this.index.buildIndex()` or `request.args.get(key)` the same way
// could not be told from one that did. `--oracle ts` runs `scripts/callgraph-oracle-ts.mjs`, which asks the TypeScript
// checker the same question the Python oracle asks `ast`, and produces the same report shape - so the two languages
// are measured by one table, one gate and one habit.
//
// Usage:
//   npx tsx scripts/callgraph-quality.ts --repo pallets/flask=<dir> --out benchmarks/callgraph-quality.json
//   npx tsx scripts/callgraph-quality.ts --oracle ts --repo colinhacks/zod=<dir> --out benchmarks/callgraph-ts-quality.json

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '../packages/analyzer/src/index.js';
import { getDefaultConfig } from '../packages/core/src/index.js';

import type { PipelineContext } from '../packages/shared/src/index.js';

interface RepoArgument {
  name: string;
  path: string;
}

interface OracleReport {
  corpus: string;
  files: number;
  definitions: { moduleLevel: number; simpleNameCollisionsPerFile: number };
  sites: Record<string, number>;
  expectedPairs: number;
  claimedPairs: number;
  precision: { correct: number; wrong: number; value: number | null };
  recall: { found: number; missed: number; value: number | null };
  byArm: Record<string, { claimed: number; correct: number; precision: number | null }>;
  callers: Record<string, number>;
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}`) out.push(process.argv[index + 1] ?? '');
  });
  return out;
}

function parsePair(raw: string): RepoArgument {
  const split = raw.lastIndexOf('=');
  if (split <= 0) throw new Error(`expected owner/name=path, got "${raw}"`);
  return { name: raw.slice(0, split), path: raw.slice(split + 1) };
}

/** The path a symbol is filed under, in the coordinates the corpus is walked in. */
function repoPath(root: string, filePath: string): string {
  const rel = relative(root, filePath);
  return rel.split(sep).join('/');
}

async function measure(
  repo: RepoArgument,
  dumpPath: string,
  oracle: 'py' | 'ts',
): Promise<OracleReport> {
  const root = join(process.cwd(), repo.path);
  const ctx = {
    projectId: repo.name,
    rootPath: root,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);

  const nodes = [...result.graph.nodes.values()].map((node) => ({
    id: node.id,
    name: String(node.name ?? ''),
    label: String(node.label),
    file: node.filePath ? repoPath(root, node.filePath) : '',
  }));
  const edges = [...result.graph.edges.values()]
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => ({ s: edge.sourceId, t: edge.targetId, properties: edge.properties ?? {} }));

  writeFileSync(dumpPath, JSON.stringify({ project: repo.name, nodes, edges }));

  const reportPath = dumpPath.replace(/\.graph\.json$/, '.oracle.json');
  const [command, prefix] =
    oracle === 'ts'
      ? ['node', ['scripts/callgraph-oracle-ts.mjs']]
      : ['python3', ['scripts/callgraph-oracle.py']];
  const output = execFileSync(
    command,
    [...prefix, '--root', root, '--graph', dumpPath, '--name', repo.name, '--out', reportPath],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(output) as OracleReport;
}

function line(label: string, report: OracleReport): string {
  const pct = (value: number | null): string =>
    value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  return [
    label.padEnd(24),
    `edges ${String(report.claimedPairs).padStart(6)}`,
    `precision ${pct(report.precision.value).padStart(6)} (${report.precision.correct}/${report.claimedPairs})`,
    `recall ${pct(report.recall.value).padStart(6)} (${report.recall.found}/${report.expectedPairs})`,
    `callers ${String(report.callers.graph).padStart(5)}/${report.callers.oracle}`,
  ].join('  ');
}

async function main(): Promise<void> {
  const repos = args('repo').map(parsePair);
  const outPath = args('out')[0] ?? 'benchmarks/callgraph-quality.json';
  const oracle = args('oracle')[0] === 'ts' ? 'ts' : 'py';
  if (repos.length === 0) {
    console.error('usage: callgraph-quality --repo owner/name=<dir> [--repo …] --out <file.json>');
    process.exit(2);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const workDir = join(process.cwd(), '.callgraph-quality');
  mkdirSync(workDir, { recursive: true });

  const reports: OracleReport[] = [];
  for (const repo of repos) {
    const slug = repo.name.replace(/[^\w.-]+/g, '_');
    const report = await measure(repo, join(workDir, `${slug}.graph.json`), oracle);
    reports.push(report);
    console.log(line(repo.name, report));
    for (const [arm, value] of Object.entries(report.byArm)) {
      console.log(
        `  ${arm.padEnd(22)} claimed ${String(value.claimed).padStart(5)}  correct ${String(value.correct).padStart(5)}  precision ${((value.precision ?? 0) * 100).toFixed(1)}%`,
      );
    }
  }

  const payload = {
    generatedBy: 'scripts/callgraph-quality.ts',
    oracle: oracle === 'ts' ? 'scripts/callgraph-oracle-ts.mjs' : 'scripts/callgraph-oracle.py',
    corpora: reports,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${outPath}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
