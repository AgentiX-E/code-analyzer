// @code-analyzer/analyzer — an index that stopped early says so
//
// **The scan phase has always been able to stop before the tree is exhausted**, and it has always reported the same
// thing when it did: `filesDiscovered: N`. A caller reading that number cannot tell a checkout of N files from a
// checkout of 40,000 files of which N were read, so a question answered "not in the index" is an answer about the
// prefix the walk happened to reach - stated as an answer about the repository.
//
// Three ways the walk drops a file without saying so, all of them read here: the `maxFiles` ceiling, the
// `maxFileSize` ceiling, and a file whose bytes cannot be read. The contract is the same for all three - **the count
// that describes the index carries the count that describes what the index did not see.**

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { GraphBuilder } from '../graph/graph-builder.js';
import { walkDirectory } from '../pipeline/phase-helpers.js';
import { ScanPhase } from '../pipeline/phases/scan.js';

import type { WalkReport } from '../pipeline/phase-helpers.js';
import type { CodeAnalyzerConfig, DiscoveredFile, PipelineContext } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'ca-walk-report-'));
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function write(dir: string, relativePath: string, content: string): string {
  const full = join(dir, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function emptyReport(): WalkReport {
  return { stoppedAtLimit: false, skippedOverSize: 0, skippedUnreadable: 0 };
}

/** A context is four fields and a graph, and the scan phase reads only three of them. */
function contextOf(rootPath: string, config: Partial<CodeAnalyzerConfig> = {}): PipelineContext {
  const base: CodeAnalyzerConfig = {
    projectId: 'walk-report',
    rootPath,
    excludePatterns: [],
    includePatterns: ['**/*'],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10_000,
    parseWorkers: 1,
    ignorePaths: [],
  };
  const ctx: PipelineContext = {
    projectId: 'walk-report',
    rootPath,
    phaseData: new Map(),
    config: { ...base, ...config },
  };
  ctx.graph = new GraphBuilder(new InMemoryGraphStore()).build(ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// walkDirectory
// ---------------------------------------------------------------------------

describe('walkDirectory reports what it did not read', () => {
  it('says the walk stopped at the ceiling rather than that the repository is that small', async () => {
    await withTempDir(async (dir) => {
      for (const name of ['a.ts', 'b.ts', 'c.ts']) write(dir, name, 'export const x = 1;\n');

      const all: DiscoveredFile[] = [];
      const full = emptyReport();
      await walkDirectory(dir, dir, all, [], 1024 * 1024, 1000, { report: full });
      // The tree fits: nothing was left unvisited, so the walk does not claim it stopped.
      expect(all).toHaveLength(3);
      expect(full.stoppedAtLimit).toBe(false);

      const some: DiscoveredFile[] = [];
      const capped = emptyReport();
      await walkDirectory(dir, dir, some, [], 1024 * 1024, 2, { report: capped });
      // **Two files and a tree that had a third**: the count alone reads as "this checkout has two files".
      expect(some).toHaveLength(2);
      expect(capped.stoppedAtLimit).toBe(true);
    });
  });

  it('counts the files too large to read instead of passing over them silently', async () => {
    await withTempDir(async (dir) => {
      write(dir, 'small.ts', 'export const x = 1;\n');
      write(dir, 'huge.ts', `export const y = "${'a'.repeat(4096)}";\n`);

      const results: DiscoveredFile[] = [];
      const report = emptyReport();
      await walkDirectory(dir, dir, results, [], 1024, 1000, { report });

      expect(results.map((file) => file.filePath.split('/').pop())).toEqual(['small.ts']);
      expect(report.skippedOverSize).toBe(1);
      // A size refusal is not a truncation: the walk saw the whole tree and decided about every file in it.
      expect(report.stoppedAtLimit).toBe(false);
    });
  });

  it('counts a file whose bytes cannot be read, which used to be an empty catch', async () => {
    await withTempDir(async (dir) => {
      write(dir, 'readable.ts', 'export const x = 1;\n');
      write(dir, 'locked.ts', 'export const y = 2;\n');

      const results: DiscoveredFile[] = [];
      const report = emptyReport();
      await walkDirectory(dir, dir, results, [], 1024 * 1024, 1000, {
        report,
        readSource: (filePath, language) => {
          if (filePath.endsWith('locked.ts')) return Promise.reject(new Error('EACCES'));
          return Promise.resolve(`// ${language}\n`);
        },
      });

      expect(results).toHaveLength(1);
      expect(report.skippedUnreadable).toBe(1);
    });
  });

  it('carries the same three counts into the phase a caller reads', async () => {
    await withTempDir(async (dir) => {
      write(dir, 'a.ts', 'export const a = 1;\n');
      write(dir, 'b.ts', 'export const b = 2;\n');
      write(dir, 'c.ts', 'export const c = 3;\n');

      const ctx = contextOf(dir, { maxFiles: 2 });
      const result = await new ScanPhase().execute(ctx);

      expect(result.status).toBe('success');
      const output = result.output as {
        filesDiscovered: number;
        walk: { stoppedAtLimit: boolean; skippedOverSize: number; skippedUnreadable: number };
      };
      expect(output.filesDiscovered).toBe(2);
      expect(output.walk.stoppedAtLimit).toBe(true);
      expect(output.walk.skippedOverSize).toBe(0);
      expect(output.walk.skippedUnreadable).toBe(0);

      // **The same object the graph was built from**, so a report read from `phaseData` and a report read from the
      // phase output cannot disagree about how complete the index is.
      const scanData = ctx.phaseData.get('scan') as {
        discoveredFiles: DiscoveredFile[];
        walk: WalkReport;
      };
      expect(scanData.discoveredFiles).toHaveLength(2);
      expect(scanData.walk.stoppedAtLimit).toBe(true);
    });
  });

  it('reports a complete index as complete, so the flag is evidence and not a constant', async () => {
    await withTempDir(async (dir) => {
      write(dir, 'a.ts', 'export const a = 1;\n');

      const result = await new ScanPhase().execute(contextOf(dir));
      const output = result.output as { walk: { stoppedAtLimit: boolean } };
      expect(output.walk.stoppedAtLimit).toBe(false);
    });
  });
});
