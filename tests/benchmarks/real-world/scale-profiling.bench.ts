// @code-analyzer — Scale Profiling Benchmark
// Measures indexing throughput, memory consumption, and query latency
// at increasing file counts: 100, 500, 2000 files.
// Uses synthetic code generation to avoid external dependencies.

import { InMemoryGraphStore, createFileDiscoverer, AutoIndexer } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Synthetic Code Generation
// ---------------------------------------------------------------------------

const SAMPLE_TYPESCRIPT = `
// Module: {moduleName}
// Generated synthetic file for scale profiling

export interface {TypePrefix}Config {{
  id: string;
  name: string;
  enabled: boolean;
  timeout: number;
  retryCount: number;
  metadata: Record<string, string>;
}}

export class {TypePrefix}Service {{
  private config: {TypePrefix}Config;

  constructor(config: {TypePrefix}Config) {{
    this.config = config;
  }}

  async execute(input: string): Promise<{TypePrefix}Result> {{
    if (!this.config.enabled) {{
      return {{ success: false, error: 'Service disabled' }};
    }}
    return this.process(input);
  }}

  private async process(input: string): Promise<{TypePrefix}Result> {{
    const startTime = Date.now();
    try {{
      const result = await this.doWork(input);
      return {{
        success: true,
        data: result,
        duration: Date.now() - startTime,
      }};
    }} catch (error) {{
      return {{
        success: false,
        error: String(error),
        duration: Date.now() - startTime,
      }};
    }}
  }}

  private async doWork(input: string): Promise<string> {{
    await new Promise((resolve) => setTimeout(resolve, 1));
    return input.toUpperCase();
  }}

  validate(input: string): boolean {{
    return input.length > 0 && input.length < this.config.timeout;
  }}

  getStats(): {{ processed: number; errors: number }} {{
    return {{ processed: 0, errors: 0 }};
  }}
}}

export type {TypePrefix}Result = {{
  success: boolean;
  data?: string;
  error?: string;
  duration: number;
}};

export function create{TypePrefix}Service(config: {TypePrefix}Config): {TypePrefix}Service {{
  return new {TypePrefix}Service(config);
}}

export { create{TypePrefix}Service as new{TypePrefix}Service };
`.trim();

function generateSyntheticProject(
  baseDir: string,
  fileCount: number,
): string {
  fs.mkdirSync(baseDir, { recursive: true });

  const modulesPerDir = 50;
  const dirCount = Math.ceil(fileCount / modulesPerDir);

  let created = 0;
  for (let d = 0; d < dirCount && created < fileCount; d++) {
    const dirPath = path.join(baseDir, `module-${String(d).padStart(3, '0')}`);
    fs.mkdirSync(dirPath, { recursive: true });

    const filesInDir = Math.min(modulesPerDir, fileCount - created);
    for (let f = 0; f < filesInDir; f++) {
      const moduleName = `Module${String(d).padStart(3, '0')}${String(f).padStart(3, '0')}`;
      const typePrefix = `M${d}${f}`;
      const content = SAMPLE_TYPESCRIPT
        .replace(/\{moduleName\}/g, moduleName)
        .replace(/\{TypePrefix\}/g, typePrefix);

      const filePath = path.join(dirPath, `${moduleName}.ts`);
      fs.writeFileSync(filePath, content, 'utf-8');
      created++;
    }
  }

  return baseDir;
}

// ---------------------------------------------------------------------------
// Profiling Types
// ---------------------------------------------------------------------------

export interface ScaleProfilePoint {
  fileCount: number;
  scanTimeMs: number;
  indexTimeMs: number;
  totalTimeMs: number;
  filesPerSecond: number;
  memoryBeforeMB: number;
  memoryAfterMB: number;
  memoryDeltaMB: number;
  nodeCount: number;
  edgeCount: number;
  queryTimeMs: number;
}

export interface ScaleProfileResult {
  profilePoints: ScaleProfilePoint[];
  summary: {
    maxThroughput: number;
    maxMemoryMB: number;
    maxLatencyMs: number;
    bottleneck: string | null;
  };
}

// ---------------------------------------------------------------------------
// Memory Measurement
// ---------------------------------------------------------------------------

function getMemoryMB(): number {
  const usage = process.memoryUsage();
  return Math.round(usage.heapUsed / 1024 / 1024);
}

// ---------------------------------------------------------------------------
// Query Latency Measurement
// ---------------------------------------------------------------------------

function measureQueryLatency(store: InMemoryGraphStore): number {
  const start = Date.now();
  const nodes = Array.from(store.nodes.values());
  const edges = Array.from(store.edges.values());

  // Simulate a search query
  let count = 0;
  for (const node of nodes) {
    if ((node.name as string)?.includes('Service')) {
      count++;
      // Trace edges from this node
      const nodeEdges = edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);
      count += nodeEdges.length;
    }
  }

  const elapsed = Date.now() - start;
  // Return 0 if no data to prevent misleading metrics
  return nodes.length > 0 ? elapsed : 0;
}

// ---------------------------------------------------------------------------
// Main Benchmark
// ---------------------------------------------------------------------------

export async function runScaleProfile(): Promise<ScaleProfileResult> {
  const profilePoints: ScaleProfilePoint[] = [];
  const scales = [100, 500, 2000];

  for (const fileCount of scales) {
    const baseDir = path.join(os.tmpdir(), `scale-profile-${fileCount}-${Date.now()}`);
    const memoryBefore = getMemoryMB();

    // Generate synthetic project
    const scanStart = Date.now();
    generateSyntheticProject(baseDir, fileCount);
    const scanTimeMs = Date.now() - scanStart;

    // Index the project
    const store = new InMemoryGraphStore(':memory:');
    const discoverer = createFileDiscoverer();
    const indexer = new AutoIndexer(discoverer, store);

    const indexStart = Date.now();
    await indexer.onProjectOpen(baseDir);
    const indexTimeMs = Date.now() - indexStart;

    // Measure query latency
    const queryTimeMs = measureQueryLatency(store);

    const totalTimeMs = scanTimeMs + indexTimeMs;
    const memoryAfter = getMemoryMB();
    const filesPerSecond = indexTimeMs > 0 ? Math.round((fileCount / (indexTimeMs / 1000)) * 100) / 100 : 0;

    profilePoints.push({
      fileCount,
      scanTimeMs,
      indexTimeMs,
      totalTimeMs,
      filesPerSecond,
      memoryBeforeMB: memoryBefore,
      memoryAfterMB: memoryAfter,
      memoryDeltaMB: memoryAfter - memoryBefore,
      nodeCount: store.nodes.size,
      edgeCount: store.edges.size,
      queryTimeMs,
    });

    // Cleanup
    try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // Summary
  const maxThroughput = Math.max(...profilePoints.map((p) => p.filesPerSecond));
  const maxMemory = Math.max(...profilePoints.map((p) => p.memoryAfterMB));
  const maxLatency = Math.max(...profilePoints.map((p) => p.queryTimeMs));

  // Bottleneck detection: if latency grows faster than linear with file count
  const bottleneck = profilePoints.length >= 2
    ? ((): string | null => {
        const first = profilePoints[0]!;
        const last = profilePoints[profilePoints.length - 1]!;
        const expectedLinear = first.queryTimeMs * (last.fileCount / first.fileCount);
        if (last.queryTimeMs > expectedLinear * 1.5) return 'Query latency grows super-linearly';
        if (last.filesPerSecond < first.filesPerSecond * 0.5) return 'Indexing throughput degrades at scale';
        return null;
      })()
    : null;

  return {
    profilePoints,
    summary: {
      maxThroughput,
      maxMemoryMB: maxMemory,
      maxLatencyMs: maxLatency,
      bottleneck,
    },
  };
}
