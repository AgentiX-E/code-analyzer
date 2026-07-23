/**
 * Tests for the analyze command.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeRepository,
  formatAnalyzeResult,
  type AnalyzeOutput,
} from '../commands/analyze.js';

describe('analyzeRepository', () => {
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
    // Uses the path relative to cwd
    const result = await analyzeRepository({
      path: '/tmp/test-repo',
    });
    expect(result.projectId).toBeTruthy();
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

  it('should show failure status', () => {
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
  });

  it('should show errors in text format', () => {
    const output = formatAnalyzeResult(sampleOutput, 'text');
    expect(output).toContain('Errors');
    expect(output).toContain('Disk full');
  });
});
