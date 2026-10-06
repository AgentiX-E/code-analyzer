import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { createAllPhases } from '../pipeline/phases/index.js';
import { getDefaultConfig } from '@code-analyzer/core';
import type { PipelineContext } from '@code-analyzer/shared';

const phases = createAllPhases().filter((p) => p.id !== 'embed');
const content = readFileSync('packages/shared/src/types/graph.ts', 'utf8');
const LOG = '/tmp/bisect2.out';

async function run(n: number) {
  const dir = mkdtempSync(join(tmpdir(), `b2-${n}-`));
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(dir, 'src', `c${i}.ts`), content.replace(/PipelineContext/g, `PipelineContext${i}`), 'utf8');
  const ctx = { projectId: 'b2', rootPath: dir, config: getDefaultConfig(), signal: new AbortController().signal, metadata: {} } as unknown as PipelineContext;
  const t0 = Date.now();
  const r = await new PipelineOrchestrator(phases).execute(ctx);
  const ms = Date.now() - t0;
  const nodes = (r.graph as any)?.nodes?.size ?? 0;
  const parse = r.phases.find((p) => p.phaseId === 'parse')?.duration ?? 0;
  const scan = r.phases.find((p) => p.phaseId === 'scan')?.duration ?? 0;
  rmSync(dir, { recursive: true, force: true });
  const line = `BISECT2 ${String(n).padStart(4)}f ${String(ms).padStart(7)}ms total ${String(parse).padStart(7)}ms parse ${String(scan).padStart(6)}ms scan ${String(Math.round(ms / n)).padStart(5)}ms/f nodes=${nodes}`;
  appendFileSync(LOG, line + '\n');
  console.log(line);
  return { n, ms, parse, nodes };
}

describe('bisect2', () => {
  it('extends the series where the answer is', async () => {
    writeFileSync(LOG, '');
    for (const n of [45, 90, 180]) await run(n);
    expect(true).toBe(true);
  }, 900_000);
});
