// @code-analyzer — can this product index a repository that contains something it did not choose?
//
// **`redis/ioredis@5.4.2` produced a call graph with zero edges.** Not a wrong graph - no graph: the `parse` phase
// failed as a whole because one generated API page in the checkout's `docs/` overflowed the stack in the doc-comment
// pass, and every other file's captures went with it. 174 files discovered, 20 457 nodes, **0 `CALLS` edges**, and
// nothing in this repository noticed, because every corpus it measured was hand-picked source.
//
// This script indexes **whole checkouts**, documentation and generated files included, and reports what the phase
// could not read. It measures the property a real repository has and a curated one does not: most of what is in it
// was written by a tool, and a tool's output is not shaped like a person's.
//
// Usage:
//   npx tsx scripts/corpus-robustness.ts --repo redis/ioredis=<dir> [--repo …] --out <file.json>

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '../packages/analyzer/src/index.js';
import { getDefaultConfig } from '../packages/core/src/index.js';

import type { PipelineContext } from '../packages/shared/src/index.js';

interface RepoArgument {
  name: string;
  path: string;
}

interface ParsePhaseData {
  parsedFiles: Array<{ filePath: string }>;
  filesFailed: number;
  failurePaths: Array<{ filePath: string; message: string }>;
  regexFallbackFiles: number;
}

interface Row {
  corpus: string;
  filesDiscovered: number;
  filesParsed: number;
  filesFailed: number;
  failureSamples: Array<{ filePath: string; message: string }>;
  regexFallbackFiles: number;
  nodes: number;
  calls: number;
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

async function measure(repo: RepoArgument): Promise<Row> {
  const root = join(process.cwd(), repo.path);
  const ctx = {
    projectId: repo.name,
    rootPath: root,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  const parseData = ctx.phaseData.get('parse') as ParsePhaseData | undefined;
  const scanData = ctx.phaseData.get('scan') as { discoveredFiles: unknown[] } | undefined;
  const calls = [...result.graph.edges.values()].filter((edge) => edge.type === 'CALLS').length;

  return {
    corpus: repo.name,
    filesDiscovered: scanData?.discoveredFiles.length ?? 0,
    filesParsed: parseData?.parsedFiles.length ?? 0,
    filesFailed: parseData?.filesFailed ?? 0,
    // **The path is what a reader acts on**, relative to the checkout so the record does not carry a machine's paths.
    failureSamples: (parseData?.failurePaths ?? []).slice(0, 5).map((entry) => ({
      filePath: relative(root, entry.filePath).split(sep).join('/'),
      message: entry.message,
    })),
    regexFallbackFiles: parseData?.regexFallbackFiles ?? 0,
    nodes: result.graph.nodes.size,
    calls,
  };
}

function line(row: Row): string {
  return [
    row.corpus.padEnd(24),
    `files ${String(row.filesParsed).padStart(5)}/${String(row.filesDiscovered).padEnd(5)}`,
    `failed ${String(row.filesFailed).padStart(3)}`,
    `nodes ${String(row.nodes).padStart(6)}`,
    `calls ${String(row.calls).padStart(6)}`,
  ].join('  ');
}

async function main(): Promise<void> {
  const repos = args('repo').map(parsePair);
  const outPath = args('out')[0] ?? 'benchmarks/corpus-robustness.json';
  if (repos.length === 0) {
    console.error('usage: corpus-robustness --repo owner/name=<dir> [--repo …] --out <file.json>');
    process.exit(2);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const rows: Row[] = [];
  for (const repo of repos) {
    const row = await measure(repo);
    rows.push(row);
    console.log(line(row));
  }

  writeFileSync(
    outPath,
    `${JSON.stringify({ generatedBy: 'scripts/corpus-robustness.ts', corpora: rows }, null, 2)}\n`,
  );
  console.log(`\nwrote ${outPath}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
