// @ts-nocheck
// @code-analyzer/mcp — Hallucination Detection Tool Tests

import { describe, it, expect } from 'vitest';
import type { ReviewComment, GraphNode } from '@code-analyzer/shared';
import {
  detectHallucinations,
  validateComment,
  computeValidationConfidence,
  generateDetectionSummary,
  formatHallucinationReport,
  hallucinationDetectionTool,
} from '../tools/hallucination-detection.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    path: '/src/test.ts',
    content: 'Test issue with `myFunc`',
    existingCode: 'const x = 1;',
    startLine: 10,
    endLine: 15,
    category: 'bug',
    severity: 'medium',
    filtered: false,
    createdAt: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 1,
    projectId: 'test-project',
    label: 'Function',
    name: 'myFunc',
    qualifiedName: 'pkg.myFunc',
    filePath: '/src/test.ts',
    startLine: 5,
    endLine: 50,
    language: 'typescript',
    properties: { name: 'myFunc' },
    signature: 'myFunc(): void',
    docstring: null,
    complexity: 3,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildKnownData(nodes: GraphNode[] = []) {
  const knownFiles = new Set<string>();
  const knownSymbols = new Map<string, GraphNode>();
  const fileLineRanges = new Map<string, { startLine: number; endLine: number }>();

  for (const node of nodes) {
    if (node.filePath) {
      knownFiles.add(node.filePath);
      const existing = fileLineRanges.get(node.filePath);
      if (existing) {
        existing.startLine = Math.min(existing.startLine, node.startLine ?? 1);
        existing.endLine = Math.max(existing.endLine, node.endLine ?? 1);
      } else {
        fileLineRanges.set(node.filePath, {
          startLine: node.startLine ?? 1,
          endLine: node.endLine ?? 1,
        });
      }
    }
    if (node.qualifiedName) {
      knownSymbols.set(node.qualifiedName, node);
    }
  }

  return { knownFiles, knownSymbols, fileLineRanges };
}

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('hallucinationDetectionTool definition', () => {
  it('should have the correct tool name', () => {
    expect(hallucinationDetectionTool.name).toBe('hallucination_detection');
  });

  it('should have a non-empty description', () => {
    expect(hallucinationDetectionTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(hallucinationDetectionTool.inputSchema.type).toBe('object');
    expect(hallucinationDetectionTool.inputSchema.properties).toBeDefined();
    expect(hallucinationDetectionTool.inputSchema.required).toContain('projectId');
    expect(hallucinationDetectionTool.inputSchema.required).toContain('reviewComments');
  });

  it('should have a callable handler', () => {
    expect(typeof hallucinationDetectionTool.handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('hallucinationDetectionTool handler', () => {
  it('should return error for invalid JSON review comments', async () => {
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test',
      reviewComments: 'invalid json{{{',
    });
    expect(result.isError).toBe(true);
  });

  it('should validate comments successfully', async () => {
    const comments = [makeComment()];
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Hallucination Detection Report');
  });

  it('should validate with source nodes', async () => {
    const comments = [makeComment()];
    const nodes = [makeGraphNode()];
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
      sourceNodes: JSON.stringify(nodes),
    });
    expect(result.isError).toBeUndefined();
    expect(result.metadata.projectId).toBe('test-project');
  });

  it('should handle strict mode', async () => {
    const comments = [makeComment()];
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
      strictMode: true,
    });
    expect(result.isError).toBeUndefined();
  });

  it('should handle empty comments', async () => {
    const result = await hallucinationDetectionTool.handler({
      projectId: 'empty-project',
      reviewComments: JSON.stringify([]),
    });
    expect(result.isError).toBeUndefined();
    expect(result.metadata.totalComments).toBe(0);
  });

  it('should handle invalid sourceNodes gracefully', async () => {
    const comments = [makeComment()];
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: JSON.stringify(comments),
      sourceNodes: 'not valid json',
    });
    // Should not error — sourceNodes parse failure is non-fatal
    expect(result.isError).toBeUndefined();
  });

  it('should handle sourceNodes as object (not string)', async () => {
    const comments = [makeComment()];
    const nodes = [makeGraphNode()];
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: comments,
      sourceNodes: nodes,
    });
    expect(result.isError).toBeUndefined();
  });

  it('should handle reviewComments as object (not string)', async () => {
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test-project',
      reviewComments: [makeComment()],
    });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateComment — File Path Validation
// ---------------------------------------------------------------------------

describe('validateComment — file path validation', () => {
  it('should flag empty file path', () => {
    const comment = makeComment({ path: '' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'non_existent_file')).toBe(true);
  });

  it('should flag non-existent file when knownFiles is populated', () => {
    const comment = makeComment({ path: '/src/unknown.ts' });
    const nodes = [makeGraphNode({ filePath: '/src/known.ts' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'non_existent_file')).toBe(true);
  });

  it('should not flag file that exists in knownFiles', () => {
    const comment = makeComment({ path: '/src/test.ts' });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'non_existent_file')).toBe(false);
  });

  it('should accept partial path match', () => {
    const comment = makeComment({ path: '/src/test' });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'non_existent_file')).toBe(false);
  });

  it('should accept reversed partial path match', () => {
    const comment = makeComment({ path: '/src/test.ts' });
    const nodes = [makeGraphNode({ filePath: '/src/test' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'non_existent_file')).toBe(false);
  });

  it('should downgrade to warning in non-strict mode', () => {
    const comment = makeComment({ path: '/src/nonexistent.ts' });
    const nodes = [makeGraphNode({ filePath: '/src/real.ts' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    const fileIssue = issues.find((i) => i.type === 'non_existent_file');
    expect(fileIssue).toBeDefined();
    expect(fileIssue!.severity).toBe('warning');
  });

  it('should escalate to error in strict mode', () => {
    const comment = makeComment({ path: '/src/nonexistent.ts' });
    const nodes = [makeGraphNode({ filePath: '/src/real.ts' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    const fileIssue = issues.find((i) => i.type === 'non_existent_file');
    expect(fileIssue).toBeDefined();
    expect(fileIssue!.severity).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// validateComment — Line Number Validation
// ---------------------------------------------------------------------------

describe('validateComment — line number validation', () => {
  it('should flag line numbers beyond file range', () => {
    const comment = makeComment({ path: '/src/test.ts', startLine: 100, endLine: 120 });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts', startLine: 1, endLine: 50 })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(true);
  });

  it('should flag end line exceeding range', () => {
    const comment = makeComment({ path: '/src/test.ts', startLine: 10, endLine: 200 });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts', startLine: 1, endLine: 50 })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(true);
  });

  it('should flag negative line numbers', () => {
    const comment = makeComment({ startLine: -5 });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(true);
  });

  it('should flag line 0 in strict mode', () => {
    const comment = makeComment({ startLine: 0 });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(true);
  });

  it('should not flag line 0 in non-strict mode', () => {
    const comment = makeComment({ startLine: 0 });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(false);
  });

  it('should accept valid line numbers within range', () => {
    const comment = makeComment({ path: '/src/test.ts', startLine: 10, endLine: 20 });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts', startLine: 1, endLine: 50 })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateComment — Content & Symbol Validation
// ---------------------------------------------------------------------------

describe('validateComment — content validation', () => {
  it('should flag empty content in strict mode', () => {
    const comment = makeComment({ content: '' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'mismatched_content')).toBe(true);
  });

  it('should not flag empty content in non-strict mode', () => {
    const comment = makeComment({ content: '' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    expect(issues.some((i) => i.type === 'mismatched_content')).toBe(false);
  });

  it('should flag non-existent symbols in strict mode', () => {
    const comment = makeComment({ content: 'Check `nonexistentFunc` for issues' });
    const nodes = [makeGraphNode({ qualifiedName: 'pkg.myFunc' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'non_existent_symbol')).toBe(true);
  });

  it('should not flag existing symbols', () => {
    const comment = makeComment({ content: 'Check `pkg.myFunc` for issues' });
    const nodes = [makeGraphNode({ qualifiedName: 'pkg.myFunc' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'non_existent_symbol')).toBe(false);
  });

  it('should not flag non-existent symbols in non-strict mode', () => {
    const comment = makeComment({ content: 'Check `fakeFunc`' });
    const nodes = [makeGraphNode({ qualifiedName: 'pkg.realFunc' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    // In non-strict mode, symbol validation only runs in strict mode
    expect(issues.some((i) => i.type === 'non_existent_symbol')).toBe(false);
  });

  it('should flag empty existingCode in strict mode', () => {
    const comment = makeComment({ existingCode: '' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'fabricated_reference')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeValidationConfidence
// ---------------------------------------------------------------------------

describe('computeValidationConfidence', () => {
  it('should return 1.0 for no issues', () => {
    expect(computeValidationConfidence([])).toBe(1.0);
  });

  it('should reduce by 0.25 per error', () => {
    const issues = [
      { type: 'non_existent_file', severity: 'error', message: 'test' },
    ];
    expect(computeValidationConfidence(issues)).toBe(0.75);
  });

  it('should reduce by 0.1 per warning', () => {
    const issues = [
      { type: 'line_out_of_range', severity: 'warning', message: 'test' },
    ];
    expect(computeValidationConfidence(issues)).toBe(0.9);
  });

  it('should handle multiple issues', () => {
    const issues = [
      { type: 'non_existent_file', severity: 'error', message: 'e1' },
      { type: 'line_out_of_range', severity: 'error', message: 'e2' },
      { type: 'mismatched_content', severity: 'warning', message: 'w1' },
    ];
    // 1.0 - 0.25 - 0.25 - 0.1 = 0.4
    expect(computeValidationConfidence(issues)).toBe(0.4);
  });

  it('should not go below 0', () => {
    const issues = Array.from({ length: 10 }, (_, i) => ({
      type: 'non_existent_file',
      severity: 'error' as const,
      message: `e${i}`,
    }));
    expect(computeValidationConfidence(issues)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectHallucinations (integration)
// ---------------------------------------------------------------------------

describe('detectHallucinations', () => {
  it('should handle empty comments', () => {
    const report = detectHallucinations('test', []);
    expect(report.totalComments).toBe(0);
    expect(report.validComments).toBe(0);
    expect(report.hallucinatedComments).toBe(0);
    expect(report.overallConfidence).toBe(1.0);
  });

  it('should detect file path hallucination', () => {
    const comments = [makeComment({ path: '/src/fake.ts' })];
    const nodes = [makeGraphNode({ filePath: '/src/real.ts' })];
    const report = detectHallucinations('test', comments, nodes);
    expect(report.totalComments).toBe(1);
    expect(report.hallucinatedComments).toBeGreaterThanOrEqual(0);
    // In non-strict mode this is a warning, not error
    expect(report.results).toHaveLength(1);
  });

  it('should mark comment as invalid when it has errors', () => {
    const comments = [
      makeComment({ path: '/src/fake.ts', startLine: 100 }),
    ];
    const nodes = [makeGraphNode({ filePath: '/src/real.ts' })];
    const report = detectHallucinations('test', comments, nodes, true);
    // In strict mode, non-existent file is an error
    expect(report.results[0]!.isValid).toBe(false);
  });

  it('should mark comment as valid when no errors', () => {
    const comments = [makeComment()];
    const report = detectHallucinations('test', comments, []);
    expect(report.results[0]!.isValid).toBe(true);
  });

  it('should compute overall confidence', () => {
    const comments = [
      makeComment({ id: 'c1' }),
      makeComment({ id: 'c2' }),
    ];
    const report = detectHallucinations('test', comments, []);
    expect(report.overallConfidence).toBe(1.0);
  });

  it('should handle strict mode detection', () => {
    const comments = [
      makeComment({ path: '/src/fake.ts' }),
      makeComment({ path: '/src/real.ts' }),
    ];
    const nodes = [makeGraphNode({ filePath: '/src/real.ts' })];
    const report = detectHallucinations('test', comments, nodes, true);
    expect(report.totalComments).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateDetectionSummary
// ---------------------------------------------------------------------------

describe('generateDetectionSummary', () => {
  it('should handle empty results', () => {
    expect(generateDetectionSummary([])).toContain('No review comments');
  });

  it('should report all valid', () => {
    const results = [
      { commentId: 'c1', isValid: true, issues: [], confidence: 1.0 },
    ];
    expect(generateDetectionSummary(results)).toContain('no hallucinated content');
  });

  it('should report hallucinated comments', () => {
    const results = [
      {
        commentId: 'c1',
        isValid: false,
        issues: [
          { type: 'non_existent_file', severity: 'error', message: 'File not found' },
        ],
        confidence: 0.75,
      },
    ];
    const summary = generateDetectionSummary(results);
    expect(summary).toContain('potential hallucinations');
    expect(summary).toContain('non-existent files');
  });

  it('should report line number issues', () => {
    const results = [
      {
        commentId: 'c1',
        isValid: false,
        issues: [
          { type: 'line_out_of_range', severity: 'error', message: 'Line out of range' },
        ],
        confidence: 0.75,
      },
    ];
    expect(generateDetectionSummary(results)).toContain('line number');
  });

  it('should report non-existent symbol issues', () => {
    const results = [
      {
        commentId: 'c1',
        isValid: false,
        issues: [
          { type: 'non_existent_symbol', severity: 'error', message: 'Symbol not found' },
        ],
        confidence: 0.75,
      },
    ];
    expect(generateDetectionSummary(results)).toContain('non-existent symbols');
  });
});

// ---------------------------------------------------------------------------
// formatHallucinationReport
// ---------------------------------------------------------------------------

describe('formatHallucinationReport', () => {
  it('should format an empty report', () => {
    const report = detectHallucinations('test', []);
    const formatted = formatHallucinationReport(report);
    expect(formatted).toContain('Hallucination Detection Report');
    expect(formatted).toContain('**Project:** test');
  });

  it('should show valid comments section', () => {
    const report = detectHallucinations('test', [makeComment()]);
    const formatted = formatHallucinationReport(report);
    expect(formatted).toContain('### Valid Comments');
  });

  it('should show flagged comments section when issues exist', () => {
    const comments = [makeComment({ path: '' })];
    const report = detectHallucinations('test', comments);
    const formatted = formatHallucinationReport(report);
    expect(formatted).toContain('### Flagged Comments');
  });

  it('should include confidence percentage', () => {
    const report = detectHallucinations('test', [makeComment()]);
    const formatted = formatHallucinationReport(report);
    expect(formatted).toContain('**Overall Confidence:**');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle comments with all empty fields', () => {
    const comment = {
      id: 'minimal',
      path: '',
      content: '',
      existingCode: '',
      startLine: 0,
      endLine: 0,
      category: 'other' as const,
      severity: 'info' as const,
      filtered: false,
      createdAt: '',
    };
    const report = detectHallucinations('test', [comment], []);
    expect(report.totalComments).toBe(1);
  });

  it('should handle empty known files but with nodes', () => {
    const comment = makeComment({ path: '/src/test.ts' });
    // Node without filePath
    const node = makeGraphNode({ filePath: null });
    const report = detectHallucinations('test', [comment], [node]);
    expect(report.results).toHaveLength(1);
    // No files known, so no file validation
    expect(report.results[0]!.isValid).toBe(true);
  });

  it('should handle nodes with no qualifiedName', () => {
    const comment = makeComment({ content: 'Check `myFunc`' });
    const node = makeGraphNode({ qualifiedName: '' });
    const report = detectHallucinations('test', [comment], [node]);
    expect(report.results).toHaveLength(1);
  });

  it('should compute correct metadata counts', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/a.ts' }),
      makeComment({ id: 'c2', path: '' }),  // has error
      makeComment({ id: 'c3', path: '/src/b.ts' }),
    ];
    const nodes = [makeGraphNode({ filePath: '/src/a.ts' })];
    const report = detectHallucinations('test', comments, nodes);
    expect(report.totalComments).toBe(3);
    expect(report.validComments + report.hallucinatedComments).toBe(3);
  });

  // --- Additional branch coverage ---

  it('should flag whitespace-only content in strict mode', () => {
    const comment = makeComment({ content: '   ' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'mismatched_content')).toBe(true);
  });

  it('should flag whitespace-only existingCode in strict mode', () => {
    const comment = makeComment({ existingCode: '  \t\n ' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    expect(issues.some((i) => i.type === 'fabricated_reference')).toBe(true);
  });

  it('should match symbols by suffix when full name not found', () => {
    const comment = makeComment({ content: 'Check `myFunc` for issues' });
    const nodes = [makeGraphNode({ qualifiedName: 'com.example.pkg.myFunc' })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    // Symbol `myFunc` should match by suffix of 'com.example.pkg.myFunc'
    expect(issues.some((i) => i.type === 'non_existent_symbol')).toBe(false);
  });

  it('should not check symbols when knownSymbols is empty', () => {
    const comment = makeComment({ content: 'Check `anySymbol`' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData([]);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, true);
    // No symbols to check against — no symbol-related issues
    expect(issues.some((i) => i.type === 'non_existent_symbol')).toBe(false);
  });

  it('should not flag existingCode when not in strict mode', () => {
    const comment = makeComment({ existingCode: '' });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    expect(issues.some((i) => i.type === 'fabricated_reference')).toBe(false);
  });

  it('should handle comment with null existingCode', () => {
    const comment = makeComment({ existingCode: null as any });
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData();
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges, false);
    // null existingCode should not trigger fabricated_reference
    expect(issues.some((i) => i.type === 'fabricated_reference')).toBe(false);
  });

  it('should handle startLine in range but endLine out of range', () => {
    const comment = makeComment({ path: '/src/test.ts', startLine: 10, endLine: 200 });
    const nodes = [makeGraphNode({ filePath: '/src/test.ts', startLine: 1, endLine: 50 })];
    const { knownFiles, knownSymbols, fileLineRanges } = buildKnownData(nodes);
    const issues = validateComment(comment, knownFiles, knownSymbols, fileLineRanges);
    expect(issues.some((i) => i.type === 'line_out_of_range')).toBe(true);
    const endIssue = issues.find((i) => i.type === 'line_out_of_range' && i.message.includes('End line'));
    expect(endIssue).toBeDefined();
  });

  it('should format report detail line when issue has detail', () => {
    const report = detectHallucinations('test', [makeComment({ path: '/src/nonexistent.ts' })], [makeGraphNode({ filePath: '/src/real.ts' })], true);
    const formatted = formatHallucinationReport(report);
    expect(formatted).toContain('> The referenced file does not match');
  });

  it('should handle reviewComments as array object in handler', async () => {
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test',
      reviewComments: [makeComment()],
    });
    expect(result.isError).toBeUndefined();
  });

  it('should handle sourceNodes parse failure in handler', async () => {
    const result = await hallucinationDetectionTool.handler({
      projectId: 'test',
      reviewComments: JSON.stringify([makeComment()]),
      sourceNodes: '{invalid',
    });
    // sourceNodes parse failure is non-fatal
    expect(result.isError).toBeUndefined();
  });
});
