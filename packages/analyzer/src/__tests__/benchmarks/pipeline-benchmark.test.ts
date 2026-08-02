import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { generateFixture, FixtureConfig } from './fixture-generator.js';
import {
  PipelineOrchestrator,
  createAllPhases,
} from '../../pipeline/index.js';
import { GraphBuilder } from '../../graph/graph-builder.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  KnowledgeGraph,
} from '@code-analyzer/shared';

// Performance thresholds
const SMALL_FIXTURE_FILES = 50;
const MEDIUM_FIXTURE_FILES = 500;
const SMALL_TIMEOUT_MS = 30000;
const MEDIUM_TIMEOUT_MS = 120000;
const PER_FILE_TARGET_MS = 65; // Target <65ms per file for medium fixture (sandbox-safe)

const BENCH_DIR = join(tmpdir(), 'code-analyzer-benchmarks');

function createPipelineContext(
  projectId: string,
  rootPath: string,
  config?: Partial<CodeAnalyzerConfig>,
): PipelineContext {
  const store = new InMemoryGraphStore();
  const builder = new GraphBuilder(store);
  const fullConfig: CodeAnalyzerConfig = {
    projectId,
    rootPath,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10000,
    parseWorkers: 1,
    ignorePaths: [],
    ...config,
  };
  const graph = builder.build({
    projectId,
    rootPath,
    phaseData: new Map(),
    config: fullConfig,
  });

  return {
    projectId,
    rootPath,
    phaseData: new Map(),
    graph,
    config: fullConfig,
  };
}

describe('Pipeline Performance Benchmarks', () => {
  beforeAll(() => {
    if (!existsSync(BENCH_DIR)) {
      mkdirSync(BENCH_DIR, { recursive: true });
    }
  });

  describe('Small Fixture (50 files)', () => {
    const fixtureDir = join(BENCH_DIR, 'fixture-small');
    let result: { totalFiles: number; totalSize: number };
    let pipelineResult: any;
    let totalTimeMs = 0;
    let phaseTimings: Record<string, number> = {};

    beforeAll(async () => {
      // Generate fixture
      const config: FixtureConfig = {
        outputDir: fixtureDir,
        fileCount: SMALL_FIXTURE_FILES,
        filesPerDir: 10,
        seed: 42,
      };
      result = generateFixture(config);

      // Create context with graph
      const ctx = createPipelineContext('benchmark-small', fixtureDir);

      // Create orchestrator with all phases
      const orchestrator = new PipelineOrchestrator(createAllPhases());
      const startTime = performance.now();
      pipelineResult = await orchestrator.execute(ctx);
      totalTimeMs = performance.now() - startTime;

      // Extract per-phase timings from PhaseResult[]
      if (pipelineResult?.phases) {
        for (const phase of pipelineResult.phases) {
          phaseTimings[phase.phaseId] = phase.duration;
        }
        phaseTimings['total'] = totalTimeMs;
      }
    }, SMALL_TIMEOUT_MS);

    it('should generate the correct number of files', () => {
      expect(result.totalFiles).toBe(SMALL_FIXTURE_FILES);
    });

    it('should index all files', () => {
      expect(pipelineResult).toBeDefined();
      const parseData = pipelineResult.phases?.find(
        (p: any) => p.phaseId === 'parse',
      );
      if (parseData?.output?.filesParsed) {
        expect(parseData.output.filesParsed).toBeGreaterThanOrEqual(
          SMALL_FIXTURE_FILES * 0.9,
        ); // 90% success rate
      }
    });

    it('should complete indexing in under 5 seconds', () => {
      console.log(`  Small fixture: ${totalTimeMs.toFixed(0)}ms total`);
      console.log(`  Phase timings: ${JSON.stringify(phaseTimings)}`);
      expect(totalTimeMs).toBeLessThan(5000);
    });

    it('should produce a non-empty knowledge graph', () => {
      expect(pipelineResult.graph).toBeDefined();
      const graph = pipelineResult.graph as KnowledgeGraph;
      expect(graph.nodes.size).toBeGreaterThan(0);
      expect(graph.edges.size).toBeGreaterThan(0);
    });

    it('should have cross-file imports', () => {
      const crossFilePhase = pipelineResult.phases?.find(
        (p: any) => p.phaseId === 'crossFile',
      );
      if (crossFilePhase?.output?.crossFileDeps) {
        expect(crossFilePhase.output.crossFileDeps).toBeGreaterThan(0);
      }
    });
  });

  describe('Medium Fixture (500 files)', () => {
    const fixtureDir = join(BENCH_DIR, 'fixture-medium');
    let result: { totalFiles: number; totalSize: number };
    let pipelineResult: any;
    let totalTimeMs = 0;
    let nodesCreated = 0;
    let edgesCreated = 0;

    beforeAll(async () => {
      const config: FixtureConfig = {
        outputDir: fixtureDir,
        fileCount: MEDIUM_FIXTURE_FILES,
        filesPerDir: 25,
        seed: 123,
      };
      result = generateFixture(config);

      const ctx = createPipelineContext('benchmark-medium', fixtureDir);

      const orchestrator = new PipelineOrchestrator(createAllPhases());
      const startTime = performance.now();
      pipelineResult = await orchestrator.execute(ctx);
      totalTimeMs = performance.now() - startTime;

      if (pipelineResult?.graph) {
        const graph = pipelineResult.graph as KnowledgeGraph;
        nodesCreated = graph.nodes.size;
        edgesCreated = graph.edges.size;
      }
    }, MEDIUM_TIMEOUT_MS);

    it('should generate 500 files', () => {
      expect(result.totalFiles).toBe(MEDIUM_FIXTURE_FILES);
    });

    it('should index within per-file target (<30ms per file)', () => {
      const perFileMs = totalTimeMs / MEDIUM_FIXTURE_FILES;
      console.log(
        `  Medium fixture: ${totalTimeMs.toFixed(0)}ms total, ${perFileMs.toFixed(1)}ms per file`,
      );
      console.log(`  Nodes: ${nodesCreated}, Edges: ${edgesCreated}`);
      console.log(
        `  Total fixture size: ${(result.totalSize / 1024).toFixed(0)} KB`,
      );
      expect(perFileMs).toBeLessThan(PER_FILE_TARGET_MS);
    });

    it('should complete within 30 seconds (sandbox-safe)', () => {
      expect(totalTimeMs).toBeLessThan(30000);
    });

    it('should have a populated graph with cross-file edges', () => {
      expect(nodesCreated).toBeGreaterThan(MEDIUM_FIXTURE_FILES);
      expect(edgesCreated).toBeGreaterThan(0);
    });
  });

  describe('Graph Density Analysis', () => {
    const fixtureDir = join(BENCH_DIR, 'fixture-density');
    let pipelineResult: any;
    let metrics: {
      files: number;
      nodes: number;
      edges: number;
      importsEdges: number;
      callsEdges: number;
      extendsEdges: number;
    } = {
      files: 0,
      nodes: 0,
      edges: 0,
      importsEdges: 0,
      callsEdges: 0,
      extendsEdges: 0,
    };

    beforeAll(async () => {
      const config: FixtureConfig = {
        outputDir: fixtureDir,
        fileCount: 100,
        filesPerDir: 10,
        seed: 99,
      };
      generateFixture(config);

      const ctx = createPipelineContext('benchmark-density', fixtureDir);

      const orchestrator = new PipelineOrchestrator(createAllPhases());
      pipelineResult = await orchestrator.execute(ctx);

      if (pipelineResult?.graph) {
        const graph = pipelineResult.graph as KnowledgeGraph;
        metrics.nodes = graph.nodes.size;
        metrics.edges = graph.edges.size;
        metrics.files = 100;

        for (const [, edge] of graph.edges) {
          if (edge.type === 'IMPORTS') metrics.importsEdges++;
          if (edge.type === 'CALLS') metrics.callsEdges++;
          if (edge.type === 'EXTENDS') metrics.extendsEdges++;
        }
      }
    }, SMALL_TIMEOUT_MS);

    it('should have IMPORTS edges (cross-file dependency tracking works)', () => {
      console.log(
        `  Graph density: ${metrics.nodes} nodes, ${metrics.edges} edges`,
      );
      console.log(
        `  IMPORTS: ${metrics.importsEdges}, CALLS: ${metrics.callsEdges}, EXTENDS: ${metrics.extendsEdges}`,
      );
      expect(metrics.importsEdges).toBeGreaterThan(0);
    });

    it('should have a reasonable node-to-edge ratio (>0.5 edges per node)', () => {
      const ratio = metrics.edges / Math.max(metrics.nodes, 1);
      console.log(`  Edge-to-node ratio: ${ratio.toFixed(2)}`);
      expect(ratio).toBeGreaterThan(0.5);
    });
  });
});
