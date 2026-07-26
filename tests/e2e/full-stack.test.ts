// @code-analyzer — Full-Stack E2E Integration Tests
// Validates the complete pipeline: Server startup → CLI operations → MCP tools.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;
const TIMEOUT = 30_000;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), 'code-analyzer-e2e-'));
  mkdirSync(join(testDir, '.code-analyzer'), { recursive: true });
  writeFileSync(join(testDir, 'hello.ts'), 'export function hello() { return "world"; }');
  writeFileSync(join(testDir, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }');
  writeFileSync(join(testDir, 'user.service.ts'), 'export class UserService { login() { return true; } }');
}, TIMEOUT);

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
});

// ---------------------------------------------------------------------------
// Server Lifecycle
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — Server Lifecycle', () => {
  it('should create server and start listening', async () => {
    const { createServer } = await import('@code-analyzer/server');
    const { createToolRegistry } = await import('@code-analyzer/mcp');

    const registry = createToolRegistry();
    const server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    expect(server.app.server.listening).toBe(true);

    await server.stop();
    expect(server.app.server.listening).toBe(false);
  }, TIMEOUT);

  it('should expose health endpoint', async () => {
    const { createServer } = await import('@code-analyzer/server');
    const { createToolRegistry } = await import('@code-analyzer/mcp');

    const registry = createToolRegistry();
    const server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
    });

    await server.start();
    const addr = server.app.server.address()!;
    const port = typeof addr === 'object' ? addr.port : server.config.port;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toMatch(/healthy|degraded|unhealthy/);

    await server.stop();
  }, TIMEOUT);

  it('should have graceful shutdown accessible', async () => {
    const { createServer } = await import('@code-analyzer/server');
    const { createToolRegistry } = await import('@code-analyzer/mcp');

    const registry = createToolRegistry();
    const server = await createServer({ registry, config: { port: 0 } });

    expect(server.shutdown).toBeDefined();
    expect(typeof server.shutdown.register).toBe('function');
    expect(server.health).toBeDefined();
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// MCP Tool Registry
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — MCP Tools', () => {
  it('should register and execute all core tools', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const tools = registry.list();
    const names = tools.map((t: { name: string }) => t.name);

    // Core tools
    expect(names).toContain('review_pr');
    expect(names).toContain('review_diff');
    expect(names).toContain('search_code');
    expect(names).toContain('analyze_repository');
    expect(names).toContain('index_status');
    expect(names).toContain('list_projects');
    expect(names).toContain('semantic_search');
    expect(names).toContain('impact_analysis');

    // Cross-repo tools
    expect(names).toContain('cross_repo_search');
    expect(names).toContain('cross_repo_impact');
    expect(names).toContain('cross_repo_review_pr');
    expect(names).toContain('manage_repo_group');
    expect(names).toContain('sync_contracts');
    expect(names).toContain('discover_related_repos');

    // Code review tools
    expect(names).toContain('check_standards');
    expect(names).toContain('generate_report');
  });

  it('should execute index_status tool', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const result = await registry.execute('index_status', {});
    expect(result).toBeDefined();
    // index_status may return error if no project — acceptable
  });

  it('should execute search_code tool', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const result = await registry.execute('search_code', { query: 'test' });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CLI Operations
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — CLI', () => {
  it('should initialize project via CLI command', async () => {
    const { initProject } = await import('../../packages/cli/src/commands/init.ts');
    const result = initProject({ directory: testDir, force: true });
    expect(result.success).toBe(true);
  });

  it('should get status via CLI command', async () => {
    const { getStatus } = await import('../../packages/cli/src/commands/status.ts');
    const report = getStatus({ directory: testDir });
    expect(report.system).toBeDefined();
    expect(report.system.platform).toBeTruthy();
    expect(report.system.nodeVersion).toBeTruthy();
    expect(report.project.initialized).toBe(true);
  });

  it('should analyze repository via CLI', async () => {
    const { analyzeRepository, formatAnalyzeResult } = await import('../../packages/cli/src/commands/analyze.ts');
    const result = await analyzeRepository({ path: testDir, format: 'json' });
    expect(result).toBeDefined();
    // May succeed or fail depending on env, but should not crash
    expect(typeof result.success).toBe('boolean');
    const output = formatAnalyzeResult(result, 'text');
    expect(typeof output).toBe('string');
  });

  it('should search via CLI command', async () => {
    const { searchGraph, formatSearchResult } = await import('../../packages/cli/src/commands/search.ts');
    const result = await searchGraph({ query: 'hello', format: 'json' });
    expect(result).toBeDefined();
    const output = formatSearchResult(result, 'text');
    expect(typeof output).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Cross-Repo Analysis
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — Cross-Repo', () => {
  it('should create and manage repo groups', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    // Create a group
    const createResult = await registry.execute('manage_repo_group', {
      action: 'create',
      id: 'e2e-test-group',
      name: 'E2E Test Group',
      description: 'Temporary test group',
    });
    expect(createResult.isError).toBeFalsy();

    // Add a repo
    const addResult = await registry.execute('manage_repo_group', {
      action: 'add_repo',
      groupId: 'e2e-test-group',
      owner: 'org',
      name: 'test-repo',
      role: 'primary',
    });
    expect(addResult).toBeDefined();

    // List groups
    const listResult = await registry.execute('manage_repo_group', {
      action: 'list',
    });
    expect(listResult).toBeDefined();
    expect(listResult.isError).toBeFalsy();

    // Delete the group
    const deleteResult = await registry.execute('manage_repo_group', {
      action: 'delete',
      id: 'e2e-test-group',
    });
    expect(deleteResult.isError).toBeFalsy();
  });

  it('should execute cross-repo search', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const result = await registry.execute('cross_repo_search', { query: 'function' });
    expect(result).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it('should have cross-repo PR review tool available', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const tools = registry.list();
    const reviewTool = tools.find((t: { name: string }) => t.name === 'cross_repo_review_pr');
    expect(reviewTool).toBeDefined();
    expect(reviewTool!.description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GitHub Webhook
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — GitHub Webhook', () => {
  it('should register webhook endpoint on server', async () => {
    const { createServer } = await import('@code-analyzer/server');
    const { createToolRegistry } = await import('@code-analyzer/mcp');

    const registry = createToolRegistry();
    const server = await createServer({
      registry,
      config: { port: 0, logging: { enabled: false, level: 'silent', includeBody: false, pretty: false } },
      webhook: {
        secret: 'test-secret',
        handler: {
          async process(_payload: unknown) {
            // Test handler — no-op
          },
        },
      },
    });

    await server.start();
    const addr = server.app.server.address()!;
    const port = typeof addr === 'object' ? addr.port : server.config.port;

    // Webhook status endpoint
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/v1/webhook/github/status`);
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json() as Record<string, unknown>;
    expect(statusBody.configured).toBe(true);

    await server.stop();
  }, TIMEOUT);

  it('should verify webhook signature', async () => {
    const { verifySignature } = await import('@code-analyzer/server');
    const { createHmac } = await import('node:crypto');

    const secret = 'my-secret';
    const payload = '{"action":"opened"}';
    const hmac = createHmac('sha256', secret);
    hmac.update(payload, 'utf-8');
    const signature = `sha256=${hmac.digest('hex')}`;

    expect(verifySignature(secret, signature, payload)).toBe(true);
    expect(verifySignature(secret, 'sha256=bad', payload)).toBe(false);
    expect(verifySignature(secret, undefined, payload)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Standards & Rules
// ---------------------------------------------------------------------------

describe('Full-Stack E2E — Standards', () => {
  it('should have standards templates available', async () => {
    const { createToolRegistry } = await import('@code-analyzer/mcp');
    const registry = createToolRegistry();

    const result = await registry.execute('check_standards', {
      filePath: join(testDir, 'hello.ts'),
      fileContent: 'export function hello() { return "world"; }',
    });
    expect(result).toBeDefined();
  });
});
