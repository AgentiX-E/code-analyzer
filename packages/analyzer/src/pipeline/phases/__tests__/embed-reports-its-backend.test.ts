// The embedding phase says which backend it used, and why - and says so where a caller can read it.
//
// **The defect this exists for.** `generateEmbeddings` has a working deterministic fallback, so the phase returned
// `success` - honestly, because it produced embeddings. **And it swallowed the error that sent it there:**
//
//   try { embedder = await loadEmbedder(); } catch { /* ONNX backend unavailable — use deterministic fallback */ }
//
// **"Which embeddings does this index hold" was unanswerable from the pipeline's own output**, which matters because
// the backend in this repository is **intermittent**: one probe threw `Tokenizer not found` and later runs report a
// loaded `onnx`. **A fixed defect without a guard is a defect that comes back**, so this holds the report in place.
//
// **The assertion is that the report exists and is well formed**, not that a particular backend was used - a test
// requiring `onnx` would fail wherever the model is absent, and a test requiring `deterministic` would fail wherever
// it is present. **Which one ran is the interesting part; that it is stated is the part that must not regress.**

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDefaultConfig } from '@code-analyzer/core';

import { PipelineOrchestrator } from '../../orchestrator.js';
import { createAllPhases } from '../index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/** Records what the embedding phase put where a caller can read it. */
interface EmbedReport {
  backend?: string;
  reason?: string | null;
}

describe('the embedding phase reports its backend', () => {
  it('writes what ran and why into the context, where a measurement can read it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'embed-report-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const source = readFileSync('packages/shared/src/types/graph.ts', 'utf8');
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(dir, 'src', `c${i}.ts`), source.replace(/PipelineContext/g, `PipelineContext${i}`), 'utf8');
    }

    const ctx = {
      projectId: 'embed-report',
      rootPath: dir,
      config: getDefaultConfig(),
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;

    try {
      const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
      const embed = result.phases.find((p) => p.phaseId === 'embed');
      // **The phase runs**, so the assertion below is about the report and not about an earlier failure.
      expect(embed?.status).toBe('success');

      const report = (ctx.phaseData as Map<string, unknown>).get('embedBackend') as EmbedReport | undefined;
      expect(report).toBeDefined();
      // **The two fields a reader needs**: which backend, and - when it is not the real one - why not.
      expect(['onnx', 'deterministic']).toContain(report?.backend);
      if (report?.backend === 'deterministic') {
        expect(typeof report.reason).toBe('string');
        expect((report.reason ?? '').length).toBeGreaterThan(0);
      } else {
        expect(report?.reason).toBeNull();
      }
      // eslint-disable-next-line no-console
      console.log(`EMBED-REPORT backend=${report?.backend} reason=${report?.reason ?? 'none'}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
