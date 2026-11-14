// @code-analyzer/cli — CLI E2E Integration Tests
// Full workflow tests: init → analyze → search → review → status.
// Tests command structure, error handling, and agent setup.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

/**
 * **A checkout on disk, because the search command now reads one.**
 *
 * The two workflow tests below used to call `searchGraph({ query })` with no directory and assert `success: true` -
 * which it was, because the command constructed an empty store, found nothing and called that a success. A test that
 * asserts the exit code of an answer nobody could have is the test that kept the defect alive, so the checkout is real
 * and the question is answerable from it.
 */
function writeSearchableCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-e2e-search-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'widget.ts'),
    [
      '/** Assemble the widget a request asks for. */',
      'export function assembleWidget(request: string): string {',
      '  return request;',
      '}',
      '',
    ].join('\n'),
  );
  return root;
}

// ---------------------------------------------------------------------------
// CLI Command Structure Tests
// ---------------------------------------------------------------------------

describe('CLI E2E — Command Structure', () => {
  it('should have agent command with 4 subcommands', async () => {
    const { createAgentCommand } = await import('../commands/agent.js');
    const cmd = createAgentCommand();
    const names = cmd.commands.map((c: Command) => c.name());
    expect(names).toContain('detect');
    expect(names).toContain('configure');
    expect(names).toContain('list');
    expect(names).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// Full Workflow Tests
// ---------------------------------------------------------------------------

describe('CLI E2E — Full Workflow', () => {
  it('should execute init → status workflow', async () => {
    const { initProject } = await import('../commands/init.js');
    const { getStatus, formatStatusReport } = await import('../commands/status.js');

    // **A directory the platform named, not a fixed path under `/tmp`.** A literal `/tmp/code-analyzer-e2e` is shared by
    // every process on the machine, so two runs collide and anyone can pre-create it; `mkdtempSync` is unique and
    // created atomically, which is what makes this a temporary directory rather than a predictable one.
    const projectDir = mkdtempSync(join(tmpdir(), 'code-analyzer-e2e-'));
    try {
      // Init
      const initResult = initProject({ directory: projectDir, force: true });
      expect(initResult.success).toBe(true);

      // Status
      const statusReport = getStatus({ directory: projectDir });
      expect(statusReport.project.initialized).toBe(true);

      const formatted = formatStatusReport(statusReport, 'text');
      expect(formatted).toContain('Initialized');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('should execute analyze → search workflow', { timeout: 30_000 }, async () => {
    const { analyzeRepository, formatAnalyzeResult } = await import('../commands/analyze.js');
    const { searchGraph, formatSearchResult } = await import('../commands/search.js');

    // Analyze a non-existent path (graceful failure)
    const analyzeResult = await analyzeRepository({
      path: '/tmp/nonexistent-project',
      format: 'json',
    });
    expect(analyzeResult.success).toBe(false);

    const analyzeOutput = formatAnalyzeResult(analyzeResult, 'text');
    expect(analyzeOutput).toContain('Failed');

    // Search the checkout that was actually written, so the workflow has an answer to print
    const checkout = writeSearchableCheckout();
    try {
      const searchResult = await searchGraph({
        query: 'assemble the widget',
        directory: checkout,
        format: 'json',
      });
      expect(searchResult.success).toBe(true);
      expect(searchResult.results[0]?.name).toBe('assembleWidget');

      const searchOutput = formatSearchResult(searchResult, 'text');
      expect(searchOutput).toContain('Search');
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('should execute review workflow', async () => {
    const { reviewCode, formatReviewResult } = await import('../commands/review.js');

    const result = await reviewCode({
      target: '/tmp/nonexistent-file.ts',
      mode: 'file',
      severity: 'warning',
      format: 'json',
      maxIssues: 10,
    });
    // Review should handle missing file gracefully
    expect(result).toBeDefined();

    const output = formatReviewResult(result, 'text');
    expect(typeof output).toBe('string');
  });

  it('should generate status report with all sections', async () => {
    const { getStatus, formatStatusReport } = await import('../commands/status.js');

    const report = getStatus();
    const json = formatStatusReport(report, 'json');
    const parsed = JSON.parse(json);

    expect(parsed.system).toBeDefined();
    expect(parsed.system.platform).toBeTruthy();
    expect(parsed.project).toBeDefined();
    expect(parsed.index).toBeDefined();
    expect(parsed.health).toBeDefined();
    expect(parsed.timestamp).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error Handling Tests
// ---------------------------------------------------------------------------

describe('CLI E2E — Error Handling', () => {
  it('should handle analyze with empty path gracefully', async () => {
    const { analyzeRepository } = await import('../commands/analyze.js');
    const result = await analyzeRepository({
      path: '',
      format: 'text',
    });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should handle search with empty query', async () => {
    const { searchGraph } = await import('../commands/search.js');
    const result = await searchGraph({
      query: '',
      format: 'text',
    });
    // Empty query should still return results (or empty results)
    expect(result).toBeDefined();
  });

  it('should handle review with invalid mode gracefully', async () => {
    const { reviewCode } = await import('../commands/review.js');
    const result = await reviewCode({
      target: '.',
      mode: 'invalid_mode' as any,
      severity: 'warning',
      format: 'text',
      maxIssues: 10,
    });
    expect(result).toBeDefined();
    // Should not crash, even with invalid mode
  });

  it('should format search results as JSON correctly', async () => {
    const { searchGraph, formatSearchResult } = await import('../commands/search.js');
    const checkout = writeSearchableCheckout();
    try {
      const result = await searchGraph({
        query: 'assemble the widget',
        directory: checkout,
        format: 'json',
      });
      const output = formatSearchResult(result, 'json');
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.results)).toBe(true);
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('should format analyze results as summary', async () => {
    const { analyzeRepository, formatAnalyzeResult } = await import('../commands/analyze.js');
    const result = await analyzeRepository({
      path: '/tmp/test-project',
      format: 'summary',
    });
    const output = formatAnalyzeResult(result, 'summary');
    expect(typeof output).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Agent Setup E2E Tests
// ---------------------------------------------------------------------------

describe('CLI E2E — Agent Setup', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'code-analyzer-cli-e2e-'));
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('should detect and configure agents', async () => {
    const { AgentSetupManager } = await import('../agent-setup.js');
    mkdirSync(join(tempHome, '.cursor'), { recursive: true });

    const manager = new AgentSetupManager(tempHome);
    const installed = manager.detectInstalled();
    expect(installed).toContain('cursor');

    const results = manager.configureAgents(installed);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r: { configured: boolean }) => r.configured)).toBe(true);
  });

  it('should configure all 11 supported agents', async () => {
    const { AgentSetupManager } = await import('../agent-setup.js');
    const manager = new AgentSetupManager(tempHome);
    const configs = manager.getAllConfigs();
    expect(configs.length).toBe(11);

    // Each agent should have required properties
    for (const config of configs) {
      expect(config.name).toBeTruthy();
      expect(config.displayName).toBeTruthy();
      expect(config.configPath).toBeTruthy();
      expect(config.configFormat).toBeTruthy();
    }
  });
});
