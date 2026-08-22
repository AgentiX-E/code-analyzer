/**
 * Tests for the analyze command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock the analyzer and infra modules
// ---------------------------------------------------------------------------
vi.mock('@code-analyzer/analyzer', () => {
  return {
    PipelineOrchestrator: vi.fn(),
    createAllPhases: vi.fn(),
  };
});

vi.mock('@code-analyzer/infra', () => {
  return {
    InMemoryGraphStore: vi.fn(),
  };
});

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { analyzeRepository, formatAnalyzeResult, type AnalyzeOutput } from '../commands/analyze.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMockOrchestrator(
  overrides: {
    status?: string;
    nodeCount?: number;
    edgeCount?: number;
    fileCount?: number;
    errors?: Array<{ phaseId: string; message: string }>;
    phases?: Array<{
      phaseId: string;
      status: string;
      duration: number;
      output?: unknown;
      error?: string | null;
    }>;
    duration?: number;
  } = {},
) {
  const executeMock = vi.fn().mockResolvedValue({
    status: overrides.status ?? 'success',
    graph: {
      nodes: new Map(
        Array.from({ length: overrides.nodeCount ?? 2 }, (_, i) => [
          String(i),
          { id: String(i), type: 'function', name: `fn${i}` },
        ]),
      ),
      edges: new Map(
        Array.from({ length: overrides.edgeCount ?? 3 }, (_, i) => [
          `e${i}`,
          { from: String(i), to: String(i + 1), type: 'import' },
        ]),
      ),
      fileIndex: new Map(
        Array.from({ length: overrides.fileCount ?? 1 }, (_, i) => [
          `file${i}.ts`,
          { path: `file${i}.ts` },
        ]),
      ),
    },
    errors: overrides.errors ?? [],
    phases: overrides.phases ?? [
      { phaseId: 'scan', status: 'success', duration: 100, output: {} },
      { phaseId: 'parse', status: 'success', duration: 200, output: {} },
    ],
    duration: overrides.duration ?? 300,
  });

  (PipelineOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(function () {
    return { execute: executeMock };
  });

  (createAllPhases as ReturnType<typeof vi.fn>).mockResolvedValue([
    { name: 'scan', execute: vi.fn() },
    { name: 'parse', execute: vi.fn() },
  ]);

  (InMemoryGraphStore as ReturnType<typeof vi.fn>).mockImplementation(function () {
    this.close = vi.fn();
  });

  return executeMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeRepository', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `ca-analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('should fail gracefully for non-existent path', async () => {
    const result = await analyzeRepository({
      path: '/tmp/non-existent-repo-xyz-12345',
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found');
  });

  it('should return structured output for non-existent path', async () => {
    const result = await analyzeRepository({
      path: '/tmp/non-existent-repo-xyz-12345',
    });
    expect(result.projectId).toBeTruthy();
    expect(result.repoPath).toBeTruthy();
    expect(result.graph).toBeDefined();
    expect(result.graph.nodeCount).toBe(0);
    expect(result.phases).toBeInstanceOf(Array);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should accept format option', async () => {
    const result = await analyzeRepository({
      path: '/tmp/non-existent-repo-xyz-12345',
      format: 'json',
    });
    expect(result.success).toBe(false);
  });

  it('should accept projectId option', async () => {
    const result = await analyzeRepository({
      path: '/tmp/non-existent-repo-xyz-12345',
      projectId: 'my-custom-project',
    });
    expect(result.projectId).toBe('my-custom-project');
  });

  it('should generate projectId from path when not specified', async () => {
    const result = await analyzeRepository({
      path: '/tmp/test-repo',
    });
    expect(result.projectId).toBeTruthy();
  });

  it('should run the analysis pipeline successfully on a real directory', async () => {
    setupMockOrchestrator({
      nodeCount: 5,
      edgeCount: 8,
      fileCount: 3,
      errors: [{ phaseId: 'dump', message: 'Disk almost full' }],
      phases: [
        { phaseId: 'scan', status: 'success', duration: 100, output: { filesFound: 3 } },
        { phaseId: 'parse', status: 'success', duration: 200, output: { asts: 3 } },
        { phaseId: 'dump', status: 'success', duration: 50, output: {} },
      ],
      duration: 500,
    });

    const result = await analyzeRepository({
      path: testDir,
      projectId: 'test-run',
    });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe('test-run');
    expect(result.repoPath).toBe(testDir);
    expect(result.graph.nodeCount).toBe(5);
    expect(result.graph.edgeCount).toBe(8);
    expect(result.graph.fileCount).toBe(3);
    expect(result.graph.phaseCount).toBe(3);
    expect(result.phases.length).toBe(3);
    expect(result.phases[0].id).toBe('scan');
    expect(result.phases[0].status).toBe('success');
    expect(result.phases[0].duration).toBe(100);
    expect(result.duration).toBe(500);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('[dump] Disk almost full');
  });

  it('should handle pipeline failure status', async () => {
    setupMockOrchestrator({
      status: 'failed',
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      phases: [
        { phaseId: 'scan', status: 'success', duration: 10, output: {} },
        { phaseId: 'parse', status: 'failed', duration: 500, error: 'Syntax error', output: null },
      ],
      errors: [{ phaseId: 'parse', message: 'Module parse failed' }],
      duration: 510,
    });

    const result = await analyzeRepository({
      path: testDir,
      projectId: 'failed-run',
    });

    expect(result.success).toBe(false);
    expect(result.graph.nodeCount).toBe(0);
    expect(result.phases[1].status).toBe('failed');
    expect(result.phases[1].error).toBe('Syntax error');
  });

  it('should handle orchestrator throwing an error', async () => {
    (PipelineOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(new Error('Pipeline crashed')),
      };
    });

    (createAllPhases as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (InMemoryGraphStore as ReturnType<typeof vi.fn>).mockImplementation(function () {
      this.close = vi.fn();
    });

    const result = await analyzeRepository({
      path: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Pipeline crashed');
    expect(result.graph.nodeCount).toBe(0);
  });

  it('should handle non-Error throw in orchestrator', async () => {
    (PipelineOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue('raw error string'),
      };
    });

    (createAllPhases as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (InMemoryGraphStore as ReturnType<typeof vi.fn>).mockImplementation(function () {
      this.close = vi.fn();
    });

    const result = await analyzeRepository({
      path: testDir,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('raw error string');
  });

  it('should handle phases with null output and skipped status', async () => {
    setupMockOrchestrator({
      phases: [
        { phaseId: 'scan', status: 'skipped', duration: 0, output: null },
        { phaseId: 'parse', status: 'running', duration: 150, output: null, error: null },
      ],
      errors: [],
      duration: 150,
    });

    const result = await analyzeRepository({
      path: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.phases[0].status).toBe('skipped');
    expect(result.phases[0].duration).toBe(0);
  });

  it('should handle orchestrator returning graph without nodes', async () => {
    (PipelineOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          status: 'success',
          graph: {},
          errors: undefined,
          phases: [],
          duration: 10,
        }),
      };
    });

    (createAllPhases as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (InMemoryGraphStore as ReturnType<typeof vi.fn>).mockImplementation(function () {
      this.close = vi.fn();
    });

    const result = await analyzeRepository({
      path: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.graph.nodeCount).toBe(0);
    expect(result.graph.edgeCount).toBe(0);
    expect(result.graph.fileCount).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe('formatAnalyzeResult', () => {
  const sampleOutput: AnalyzeOutput = {
    success: true,
    projectId: 'test-project',
    repoPath: '/home/user/project',
    graph: {
      nodeCount: 150,
      edgeCount: 300,
      fileCount: 25,
      phaseCount: 18,
    },
    phases: [
      { id: 'scan', status: 'success', duration: 45 },
      { id: 'parse', status: 'success', duration: 230 },
      { id: 'dump', status: 'failed', duration: 12, error: 'Disk full' },
    ],
    duration: 1450,
    errors: ['[dump] Disk full'],
  };

  it('should format as JSON', () => {
    const output = formatAnalyzeResult(sampleOutput, 'json');
    const parsed = JSON.parse(output);
    expect(parsed.projectId).toBe('test-project');
    expect(parsed.graph.nodeCount).toBe(150);
  });

  it('should format as text', () => {
    const output = formatAnalyzeResult(sampleOutput, 'text');
    expect(output).toContain('test-project');
    expect(output).toContain('Knowledge Graph');
    expect(output).toContain('Pipeline Phases');
    expect(output).toContain('Nodes:');
    expect(output).toContain('150');
    expect(output).toContain('✓ scan');
    expect(output).toContain('✗ dump');
  });

  it('should format as summary', () => {
    const output = formatAnalyzeResult(sampleOutput, 'summary');
    expect(output).toContain('test-project');
    expect(output).toContain('150 nodes');
    expect(output).toContain('300 edges');
  });

  it('should show failure status symbol', () => {
    const failed: AnalyzeOutput = {
      ...sampleOutput,
      success: false,
    };
    const output = formatAnalyzeResult(failed, 'summary');
    expect(output).toContain('✗');
  });

  it('should handle empty phases', () => {
    const empty: AnalyzeOutput = {
      ...sampleOutput,
      phases: [],
      graph: { ...sampleOutput.graph, phaseCount: 0 },
    };
    const output = formatAnalyzeResult(empty, 'text');
    expect(output).toContain('Pipeline Phases');
    expect(output).toContain('(0)');
  });

  it('should show errors in text format', () => {
    const output = formatAnalyzeResult(sampleOutput, 'text');
    expect(output).toContain('Errors');
    expect(output).toContain('Disk full');
  });

  it('should show Complete status for successful analysis', () => {
    const output = formatAnalyzeResult(sampleOutput, 'text');
    expect(output).toContain('Complete');
  });

  it('should show Failed status for failed analysis', () => {
    const failed: AnalyzeOutput = {
      ...sampleOutput,
      success: false,
    };
    const output = formatAnalyzeResult(failed, 'text');
    expect(output).toContain('Failed');
  });

  it('should skip errors section when none', () => {
    const noErrors: AnalyzeOutput = {
      ...sampleOutput,
      phases: [
        { id: 'scan', status: 'success', duration: 45 },
        { id: 'parse', status: 'success', duration: 230 },
      ],
      errors: [],
      graph: { ...sampleOutput.graph, phaseCount: 2 },
    };
    const output = formatAnalyzeResult(noErrors, 'text');
    // Should NOT have an "Errors" section line
    const hasErrorSection = output.includes(`${'\u2500'.repeat(40)}\nErrors`);
    expect(hasErrorSection).toBe(false);
  });

  it('should show errors count in summary format', () => {
    const withMany: AnalyzeOutput = {
      ...sampleOutput,
      errors: ['err1', 'err2', 'err3'],
    };
    const output = formatAnalyzeResult(withMany, 'summary');
    expect(output).toContain('Errors: 3');
  });

  it('should not show errors count in summary when empty', () => {
    const noErrors: AnalyzeOutput = {
      ...sampleOutput,
      errors: [],
    };
    const output = formatAnalyzeResult(noErrors, 'summary');
    expect(output).not.toContain('Errors:');
  });

  it('should handle empty repo path', () => {
    const emptyPath: AnalyzeOutput = {
      ...sampleOutput,
      repoPath: '',
    };
    const output = formatAnalyzeResult(emptyPath, 'text');
    expect(output).toContain('Path:');
  });

  it('should show neutral icon for non-success/failed phases', () => {
    const withSkipped: AnalyzeOutput = {
      ...sampleOutput,
      phases: [
        { id: 'scan', status: 'skipped', duration: 0 },
        { id: 'parse', status: 'success', duration: 100 },
      ],
      graph: { ...sampleOutput.graph, phaseCount: 2 },
    };
    const output = formatAnalyzeResult(withSkipped, 'text');
    expect(output).toContain('○ scan');
    expect(output).toContain('✓ parse');
  });
});
