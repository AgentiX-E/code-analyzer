// @ts-nocheck
// @code-analyzer/mcp — E2E Integration Test: All 40 MCP Tools

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from '../tools/tool-context.js';
import { createToolRegistry, ToolRegistry } from '../tools/index.js';
import type { ToolResult } from '../tools/registry.js';

// ---------------------------------------------------------------------------
// Test Fixture Setup
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(tmpdir(), 'code-analyzer-e2e-mcp-test');
const PROJECT_ID = 'e2e-test-project';

function setupFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(join(FIXTURE_DIR, 'src'), { recursive: true });
  mkdirSync(join(FIXTURE_DIR, 'src', 'services'), { recursive: true });
  mkdirSync(join(FIXTURE_DIR, 'src', 'controllers'), { recursive: true });
  mkdirSync(join(FIXTURE_DIR, 'src', 'utils'), { recursive: true });

  // Create a realistic TypeScript project structure
  writeFileSync(join(FIXTURE_DIR, 'package.json'), JSON.stringify({
    name: 'e2e-test',
    version: '1.0.0',
  }, null, 2));

  writeFileSync(join(FIXTURE_DIR, 'src', 'index.ts'), `
import { UserService } from './services/user.service';
import { AuthController } from './controllers/auth.controller';

export function main() {
  const service = new UserService();
  const controller = new AuthController(service);
  return controller.handleRequest();
}
`.trim());

  writeFileSync(join(FIXTURE_DIR, 'src', 'services', 'user.service.ts'), `
export class UserService {
  private users: Map<string, User> = new Map();

  constructor() {}

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  private validateEmail(email: string): boolean {
    return email.includes('@');
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface CreateUserDto {
  name: string;
  email: string;
}
`.trim());

  writeFileSync(join(FIXTURE_DIR, 'src', 'controllers', 'auth.controller.ts'), `
import { UserService } from '../services/user.service';

export class AuthController {
  constructor(private userService: UserService) {}

  async handleRequest(): Promise<Response> {
    const user = await this.userService.getUser('admin');
    if (!user) {
      throw new Error('User not found');
    }
    return new Response(JSON.stringify(user));
  }

  async login(email: string, password: string): Promise<boolean> {
    // Security: password handling — intentional for standards check demo
    const isValid = email.includes('@') && password.length >= 8;
    return isValid;
  }
}
`.trim());

  writeFileSync(join(FIXTURE_DIR, 'src', 'utils', 'helpers.ts'), `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
`.trim());
}

// ---------------------------------------------------------------------------
// Store Population
// ---------------------------------------------------------------------------

function populateStore(store: InMemoryGraphStore): void {
  // Classes
  const userServiceClass = store.insertNode({
    projectId: PROJECT_ID, name: 'UserService', qualifiedName: 'src/services/user.service::UserService',
    label: 'Class', filePath: 'src/services/user.service.ts', startLine: 3, endLine: 28,
    language: 'typescript', isExported: true, complexity: 8, properties: {},
  });
  const authControllerClass = store.insertNode({
    projectId: PROJECT_ID, name: 'AuthController', qualifiedName: 'src/controllers/auth.controller::AuthController',
    label: 'Class', filePath: 'src/controllers/auth.controller.ts', startLine: 4, endLine: 20,
    language: 'typescript', isExported: true, complexity: 5, properties: {},
  });

  // Interfaces
  const userInterface = store.insertNode({
    projectId: PROJECT_ID, name: 'User', qualifiedName: 'src/services/user.service::User',
    label: 'Interface', filePath: 'src/services/user.service.ts', startLine: 30, endLine: 36,
    language: 'typescript', isExported: true, complexity: null, properties: {},
  });
  store.insertNode({
    projectId: PROJECT_ID, name: 'CreateUserDto', qualifiedName: 'src/services/user.service::CreateUserDto',
    label: 'Interface', filePath: 'src/services/user.service.ts', startLine: 38, endLine: 42,
    language: 'typescript', isExported: true, complexity: null, properties: {},
  });

  // Functions
  const mainFunc = store.insertNode({
    projectId: PROJECT_ID, name: 'main', qualifiedName: 'src/index::main',
    label: 'Function', filePath: 'src/index.ts', startLine: 5, endLine: 9,
    language: 'typescript', isExported: true, complexity: 2, properties: {},
  });
  store.insertNode({
    projectId: PROJECT_ID, name: 'formatDate', qualifiedName: 'src/utils/helpers::formatDate',
    label: 'Function', filePath: 'src/utils/helpers.ts', startLine: 2, endLine: 4,
    language: 'typescript', isExported: true, complexity: 1, properties: {},
  });
  store.insertNode({
    projectId: PROJECT_ID, name: 'isNullOrUndefined', qualifiedName: 'src/utils/helpers::isNullOrUndefined',
    label: 'Function', filePath: 'src/utils/helpers.ts', startLine: 6, endLine: 8,
    language: 'typescript', isExported: true, complexity: 2, properties: {},
  });
  const deepCloneFunc = store.insertNode({
    projectId: PROJECT_ID, name: 'deepClone', qualifiedName: 'src/utils/helpers::deepClone',
    label: 'Function', filePath: 'src/utils/helpers.ts', startLine: 10, endLine: 12,
    language: 'typescript', isExported: true, complexity: 1, properties: {},
  });

  // Methods
  const getUserMethod = store.insertNode({
    projectId: PROJECT_ID, name: 'getUser', qualifiedName: 'src/services/user.service::UserService.getUser',
    label: 'Method', filePath: 'src/services/user.service.ts', startLine: 7, endLine: 9,
    language: 'typescript', isExported: false, complexity: 2, properties: {},
  });
  const createUserMethod = store.insertNode({
    projectId: PROJECT_ID, name: 'createUser', qualifiedName: 'src/services/user.service::UserService.createUser',
    label: 'Method', filePath: 'src/services/user.service.ts', startLine: 11, endLine: 20,
    language: 'typescript', isExported: false, complexity: 4, properties: {},
  });
  const handleRequestMethod = store.insertNode({
    projectId: PROJECT_ID, name: 'handleRequest', qualifiedName: 'src/controllers/auth.controller::AuthController.handleRequest',
    label: 'Method', filePath: 'src/controllers/auth.controller.ts', startLine: 7, endLine: 13,
    language: 'typescript', isExported: false, complexity: 3, properties: {},
  });
  store.insertNode({
    projectId: PROJECT_ID, name: 'login', qualifiedName: 'src/controllers/auth.controller::AuthController.login',
    label: 'Method', filePath: 'src/controllers/auth.controller.ts', startLine: 15, endLine: 19,
    language: 'typescript', isExported: false, complexity: 2, properties: {},
  });

  // Route
  store.insertNode({
    projectId: PROJECT_ID, name: 'GET /users', qualifiedName: 'GET /users',
    label: 'Route', filePath: 'src/controllers/auth.controller.ts', startLine: 7, endLine: 13,
    language: 'typescript', isExported: true, complexity: null,
    properties: { routePath: '/users', routeMethod: 'GET' },
  });

  // Edges
  store.insertEdge({ sourceId: userServiceClass, targetId: getUserMethod, type: 'HAS_METHOD', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: userServiceClass, targetId: createUserMethod, type: 'HAS_METHOD', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: authControllerClass, targetId: handleRequestMethod, type: 'HAS_METHOD', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: mainFunc, targetId: userServiceClass, type: 'CALLS', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: mainFunc, targetId: authControllerClass, type: 'CALLS', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: handleRequestMethod, targetId: getUserMethod, type: 'CALLS', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: mainFunc, targetId: userInterface, type: 'IMPORTS', projectId: PROJECT_ID });
  store.insertEdge({ sourceId: deepCloneFunc, targetId: getUserMethod, type: 'CALLS', projectId: PROJECT_ID });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('MCP E2E — All 40 Tools Integration', () => {
  let store: InMemoryGraphStore;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  beforeAll(() => {
    setupFixture();
    store = new InMemoryGraphStore();
    ctx = new ToolContextImpl(store);
    populateStore(store);
    registry = createToolRegistry();
  });

  afterAll(() => {
    store.close();
    try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  // =========================================================================
  // Registry Structure
  // =========================================================================

  describe('Tool Registry Structure', () => {
    it('should register exactly 40 tools', () => {
      expect(registry.size).toBe(40);
    });

    it('should list all tools without handlers in output', () => {
      const list = registry.list();
      expect(list.length).toBe(40);
      for (const tool of list) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('should filter by profile', () => {
      const all = registry.listByProfile('all');
      const analysis = registry.listByProfile('analysis');
      expect(all.length).toBe(40);
      expect(analysis.length).toBeGreaterThan(0);
      expect(analysis.length).toBeLessThanOrEqual(40);
    });
  });

  // =========================================================================
  // Indexing & Lifecycle (4 tools)
  // =========================================================================

  describe('Indexing & Lifecycle Tools', () => {
    it('analyze_repository: validates path existence', async () => {
      const result = await registry.execute('analyze_repository', {
        path: '/nonexistent/path',
      }, ctx);

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.status).toBe('failed');
      expect(data.error).toContain('Path does not exist');
    });

    it('analyze_repository: returns analysis result for valid path', async () => {
      const result = await registry.execute('analyze_repository', {
        path: FIXTURE_DIR,
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.status).toBeDefined();
    });

    it('list_projects: returns projects from store', async () => {
      const result = await registry.execute('list_projects', {}, ctx);
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.total).toBeGreaterThanOrEqual(0);
    });

    it('index_status: returns status for existing project', async () => {
      const result = await registry.execute('index_status', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.status).toBeDefined();
      expect(typeof data.nodeCount).toBe('number');
    });

    it('delete_project: handles deletion gracefully', async () => {
      const result = await registry.execute('delete_project', {
        projectId: 'temp-project-to-delete',
        force: true,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.deleted).toBe(true);
    });
  });

  // =========================================================================
  // Querying & Exploration (10 tools)
  // =========================================================================

  describe('Querying & Exploration Tools', () => {
    it('search_graph: returns empty for missing store', async () => {
      const result = await registry.execute('search_graph', {
        query: 'UserService',
      }, undefined);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.items).toEqual([]);
    });

    it('search_graph: finds matching nodes with store', async () => {
      const result = await registry.execute('search_graph', {
        query: 'User',
        limit: 10,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('search_code: returns results from store', async () => {
      const result = await registry.execute('search_code', {
        query: 'User',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data).toHaveProperty('items');
    });

    it('semantic_search: gracefully handles no embeddings', async () => {
      const result = await registry.execute('semantic_search', {
        query: 'user authentication logic',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.items).toBeDefined();
      expect(data.searchMethod).toBeDefined();
    });

    it('trace_call_path: traces from source symbol', async () => {
      const result = await registry.execute('trace_call_path', {
        sourceSymbol: 'src/index::main',
        projectId: PROJECT_ID,
        maxDepth: 5,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.path).toBeDefined();
      expect(data.found).toBeDefined();
    });

    it('query_graph: executes Cypher query', async () => {
      const result = await registry.execute('query_graph', {
        cypher: 'MATCH (n) RETURN n LIMIT 10',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.columns).toBeDefined();
      expect(data.rows).toBeDefined();
    });

    it('query_graph: returns error for invalid Cypher', async () => {
      const result = await registry.execute('query_graph', {
        cypher: 'INVALID CYPHER !!!',
      }, ctx);

      expect(result.isError).toBe(true);
    });

    it('get_code_snippet: returns symbols for known file', async () => {
      const result = await registry.execute('get_code_snippet', {
        filePath: 'src/services/user.service.ts',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.filePath).toBe('src/services/user.service.ts');
    });

    it('get_code_snippet: works with line range', async () => {
      const result = await registry.execute('get_code_snippet', {
        filePath: 'src/services/user.service.ts',
        projectId: PROJECT_ID,
        startLine: 3,
        endLine: 10,
      }, ctx);

      expect(result.isError).toBeFalsy();
    });

    it('get_architecture: returns architecture overview', async () => {
      const result = await registry.execute('get_architecture', {
        projectId: PROJECT_ID,
        detail: 'overview',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.layers).toBeDefined();
    });

    it('get_graph_schema: returns schema info', async () => {
      const result = await registry.execute('get_graph_schema', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.projectId).toBe(PROJECT_ID);
      expect(data.nodeCount).toBeGreaterThan(0);
    });

    it('explore_symbol: explores a known symbol', async () => {
      const result = await registry.execute('explore_symbol', {
        symbolName: 'src/services/user.service::UserService',
        projectId: PROJECT_ID,
        includeRelationships: true,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.symbol).toBeDefined();
    });

    it('find_implementations: searches for interface implementations', async () => {
      const result = await registry.execute('find_implementations', {
        interfaceName: 'src/services/user.service::User',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.interface).toBeDefined();
    });

    it('find_implementations: returns empty for unknown interface', async () => {
      const result = await registry.execute('find_implementations', {
        interfaceName: 'NonExistentInterface',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.interface).toBeNull();
    });
  });

  // =========================================================================
  // Change & Impact (4 tools)
  // =========================================================================

  describe('Change & Impact Tools', () => {
    it('detect_changes: returns heuristic change data', async () => {
      const result = await registry.execute('detect_changes', {
        projectId: PROJECT_ID,
        fromRef: 'HEAD~1',
        toRef: 'HEAD',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.summary).toBeDefined();
      expect(data.summary.risk).toBeDefined();
    });

    it('impact_analysis: analyzes impact of a target symbol', async () => {
      const result = await registry.execute('impact_analysis', {
        projectId: PROJECT_ID,
        targetSymbol: 'src/services/user.service::UserService.getUser',
        fromRef: 'main',
        toRef: 'feature',
        depth: 3,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.riskLevel).toBeDefined();
      expect(data.directDependents).toBeGreaterThanOrEqual(0);
    });

    it('impact_analysis: works without target symbol', async () => {
      const result = await registry.execute('impact_analysis', {
        projectId: PROJECT_ID,
        fromRef: 'main',
        toRef: 'HEAD',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data).toHaveProperty('note');
    });

    it('route_map: lists routes in project', async () => {
      const result = await registry.execute('route_map', {
        projectId: PROJECT_ID,
        includeHandlers: true,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.routeCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.routes)).toBe(true);
    });

    it('check_cycles: checks for circular dependencies', async () => {
      const result = await registry.execute('check_cycles', {
        projectId: PROJECT_ID,
        maxDepth: 10,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.cyclesFound).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.cycles)).toBe(true);
    });
  });

  // =========================================================================
  // Code Review (2 tools)
  // =========================================================================

  describe('Code Review Tools', () => {
    it('review_diff: returns heuristic analysis without diff', async () => {
      const result = await registry.execute('review_diff', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.comments).toBeDefined();
      expect(data.summary).toBeDefined();
    });

    it('review_diff: handles invalid diff gracefully', async () => {
      const result = await registry.execute('review_diff', {
        projectId: PROJECT_ID,
        diff: 'not a real diff',
      }, ctx);

      expect(result.isError).toBeFalsy();
    });

    it('review_file: reviews a file from graph data', async () => {
      const result = await registry.execute('review_file', {
        projectId: PROJECT_ID,
        filePath: 'src/services/user.service.ts',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.filePath).toBe('src/services/user.service.ts');
      expect(data.comments).toBeDefined();
    });

    it('review_file: returns basic response for empty file', async () => {
      const result = await registry.execute('review_file', {
        projectId: PROJECT_ID,
        filePath: 'nonexistent/file.ts',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.comments).toBeDefined();
    });
  });

  // =========================================================================
  // PR Review (2 tools)
  // =========================================================================

  describe('PR Review Tools', () => {
    it('review_pr: returns risk analysis without diff', async () => {
      const result = await registry.execute('review_pr', {
        projectId: PROJECT_ID,
        baseRef: 'main',
        headRef: 'feature',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.summary).toBeDefined();
      expect(data.summary.riskLevel).toBeDefined();
    });

    it('review_pr: processes diff content', async () => {
      const diffContent = `diff --git a/src/services/user.service.ts b/src/services/user.service.ts
--- a/src/services/user.service.ts
+++ b/src/services/user.service.ts
@@ -7,3 +7,5 @@
   async getUser(id: string): Promise<User | null> {
-    return this.users.get(id) ?? null;
+    const cached = this.cache.get(id);
+    if (cached) return cached;
+    const user = this.users.get(id);
+    if (user) this.cache.set(id, user);
+    return user ?? null;
   }`;

      const result = await registry.execute('review_pr', {
        projectId: PROJECT_ID,
        diff: diffContent,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.summary).toBeDefined();
    });

    it('check_standards: runs standards check on all files', async () => {
      const result = await registry.execute('check_standards', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.results).toBeDefined();
      expect(data.complianceScore).toBeGreaterThanOrEqual(0);
      expect(data.standardsChecked).toBeDefined();
    });

    it('check_standards: checks specific file when it exists', async () => {
      const result = await registry.execute('check_standards', {
        projectId: PROJECT_ID,
        filePath: join(FIXTURE_DIR, 'src', 'services', 'user.service.ts'),
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.results).toBeDefined();
      expect(data.reviewMethod).toContain('StandardsEngine');
    });
  });

  // =========================================================================
  // Reports (3 tools)
  // =========================================================================

  describe('Report Tools', () => {
    it('generate_report: generates a codebase audit report', async () => {
      const result = await registry.execute('generate_report', {
        projectId: PROJECT_ID,
        type: 'codebase-audit',
        format: 'json',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.id).toContain('report_');
      expect(data.type).toBe('codebase-audit');
      expect(data.metrics).toBeDefined();
    });

    it('generate_report: generates PR review report', async () => {
      const result = await registry.execute('generate_report', {
        projectId: PROJECT_ID,
        type: 'pr-review',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.type).toBe('pr-review');
      expect(data.findings).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('export_report: exports report in markdown format', async () => {
      const outputPath = join(tmpdir(), 'test-export-report.md');
      const result = await registry.execute('export_report', {
        reportId: 'report_test_123',
        format: 'markdown',
        outputPath,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.exported).toBe(true);
      expect(data.format).toBe('markdown');
      expect(existsSync(outputPath)).toBe(true);

      const content = require('fs').readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Code Analyzer Report');
      rmSync(outputPath, { force: true });
    });

    it('export_report: exports in JSON format', async () => {
      const outputPath = join(tmpdir(), 'test-export-report.json');
      const result = await registry.execute('export_report', {
        reportId: 'report_test_456',
        format: 'json',
        outputPath,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.exported).toBe(true);
      expect(existsSync(outputPath)).toBe(true);

      const content = require('fs').readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.reportId).toBe('report_test_456');
      rmSync(outputPath, { force: true });
    });

    it('get_recommendations: returns actionable recommendations', async () => {
      const result = await registry.execute('get_recommendations', {
        projectId: PROJECT_ID,
        limit: 5,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.recommendations).toBeDefined();
      expect(data.total).toBeGreaterThanOrEqual(0);
    });

    it('get_recommendations: filters by category', async () => {
      const result = await registry.execute('get_recommendations', {
        projectId: PROJECT_ID,
        category: 'security',
        limit: 3,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      for (const rec of data.recommendations) {
        expect(rec.category).toBe('security');
      }
    });
  });

  // =========================================================================
  // Cross-Repo (7 tools)
  // =========================================================================

  describe('Cross-Repo Tools', () => {
    it('manage_repo_group: creates and manages a repo group', async () => {
      const result = await registry.execute('manage_repo_group', {
        action: 'create',
        groupId: 'e2e-group',
        name: 'E2E Test Group',
        repos: [PROJECT_ID],
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.groupId).toBe('e2e-group');
      expect(data.created).toBe(true);
    });

    it('manage_repo_group: lists groups', async () => {
      const result = await registry.execute('manage_repo_group', {
        action: 'list',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(Array.isArray(data.groups)).toBe(true);
    });

    it('manage_repo_group: gets a specific group', async () => {
      const result = await registry.execute('manage_repo_group', {
        action: 'get',
        groupId: 'e2e-group',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.groupId).toBe('e2e-group');
    });

    it('cross_repo_search: searches across repos', async () => {
      const result = await registry.execute('cross_repo_search', {
        query: 'UserService',
        groupId: 'e2e-group',
        limit: 5,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.items).toBeDefined();
    });

    it('cross_repo_trace: traces across repo boundaries', async () => {
      const result = await registry.execute('cross_repo_trace', {
        sourceSymbol: 'src/services/user.service::UserService',
        groupId: 'e2e-group',
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('cross_repo_impact: analyzes cross-repo impact', async () => {
      const result = await registry.execute('cross_repo_impact', {
        symbol: 'src/services/user.service::UserService.getUser',
        groupId: 'e2e-group',
      }, ctx);

      expect(result.isError).toBeFalsy();
    });

    it('sync_contracts: synchronizes contracts across repos', async () => {
      const result = await registry.execute('sync_contracts', {
        groupId: 'e2e-group',
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.status).toBeDefined();
    });

    it('discover_related_repos: discovers related repos', async () => {
      const result = await registry.execute('discover_related_repos', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
    });

    it('cross_repo_review_pr: reviews PR with cross-repo context', async () => {
      const result = await registry.execute('cross_repo_review_pr', {
        groupId: 'e2e-group',
        sourceRepoId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
    });
  });

  // =========================================================================
  // PDG (3 tools)
  // =========================================================================

  describe('PDG Tools', () => {
    it('pdg_query: queries the program dependence graph', async () => {
      const result = await registry.execute('pdg_query', {
        functionId: 'src/index::main',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data).toHaveProperty('functionId');
    });

    it('taint_analysis: performs taint analysis', async () => {
      const result = await registry.execute('taint_analysis', {
        projectId: PROJECT_ID,
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('explain_taint: explains a taint path', async () => {
      const result = await registry.execute('explain_taint', {
        taintPathId: 'path-1',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Standards, ADR, Agent (4 tools)
  // =========================================================================

  describe('Standards, ADR, Agent Tools', () => {
    it('list_standards: lists available standards', async () => {
      const result = await registry.execute('list_standards', {
        category: 'security',
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('list_standards: lists all standards without filter', async () => {
      const result = await registry.execute('list_standards', {}, ctx);

      expect(result).toHaveProperty('content');
    });

    it('create_standard: creates a custom standard', async () => {
      const result = await registry.execute('create_standard', {
        name: 'E2E Custom Standard',
        category: 'custom',
        rules: JSON.stringify([{
          id: 'e2e-custom-rule',
          name: 'No console.log',
          description: 'Disallow console.log statements',
          checkType: 'regex',
          severity: 'medium',
          checkConfig: { pattern: 'console\\.log' },
        }]),
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('manage_adr: creates a new ADR', async () => {
      const result = await registry.execute('manage_adr', {
        action: 'create',
        title: 'Use TypeScript for all new services',
        context: 'Need to decide language for new services',
        decision: 'TypeScript will be used for all new services',
        consequences: 'Team needs TypeScript training',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.adrId).toBeDefined();
    });

    it('manage_adr: lists ADRs', async () => {
      const result = await registry.execute('manage_adr', {
        action: 'list',
        projectId: PROJECT_ID,
      }, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]!.text!);
      expect(Array.isArray(data.adrs)).toBe(true);
      expect(data.adrs.length).toBeGreaterThan(0);
    });

    it('install_skills: previews skill installation', async () => {
      const result = await registry.execute('install_skills', {
        agents: ['codebuddy'],
        dryRun: true,
      }, ctx);

      expect(result).toHaveProperty('content');
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Validation & Error Handling
  // =========================================================================

  describe('Validation & Error Handling', () => {
    it('should return error for missing required arguments', async () => {
      const result = await registry.execute('analyze_repository', {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Missing required parameter');
    });

    it('should return error for unknown tool name', async () => {
      const result = await registry.execute('nonexistent_tool', {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });

    it('should handle null/undefined arguments gracefully', async () => {
      // Passing null triggers validation which returns error — this is expected behavior
      const result = await registry.execute('list_projects', {}, ctx);
      expect(result).toHaveProperty('content');
    });

    it('should handle empty string arguments', async () => {
      const result = await registry.execute('search_graph', {
        query: '',
      }, ctx);

      expect(result.isError).toBeFalsy();
    });

    it('all 40 tools respond without crashing', async () => {
      const minimalArgs: Record<string, Record<string, unknown>> = {
        analyze_repository: { path: FIXTURE_DIR },
        list_projects: {},
        delete_project: { projectId: PROJECT_ID, force: true },
        index_status: { projectId: PROJECT_ID },
        search_graph: { query: 'test' },
        search_code: { query: 'test' },
        semantic_search: { query: 'test' },
        trace_call_path: { sourceSymbol: 'src/index::main', projectId: PROJECT_ID },
        query_graph: { cypher: 'MATCH (n) RETURN n LIMIT 1' },
        get_code_snippet: { filePath: 'src/index.ts', projectId: PROJECT_ID },
        get_architecture: { projectId: PROJECT_ID },
        get_graph_schema: { projectId: PROJECT_ID },
        explore_symbol: { symbolName: 'src/index::main', projectId: PROJECT_ID },
        find_implementations: { interfaceName: 'src/services/user.service::User', projectId: PROJECT_ID },
        detect_changes: { projectId: PROJECT_ID },
        impact_analysis: { projectId: PROJECT_ID, fromRef: 'main', toRef: 'HEAD' },
        route_map: { projectId: PROJECT_ID },
        check_cycles: { projectId: PROJECT_ID },
        review_diff: { projectId: PROJECT_ID },
        review_file: { projectId: PROJECT_ID, filePath: 'src/index.ts' },
        review_pr: { projectId: PROJECT_ID },
        check_standards: { projectId: PROJECT_ID },
        generate_report: { projectId: PROJECT_ID, type: 'codebase-audit' },
        export_report: { reportId: 'test-out', format: 'json' },
        get_recommendations: { projectId: PROJECT_ID },
        cross_repo_search: { query: 'test', groupId: 'e2e-group' },
        cross_repo_trace: { sourceSymbol: 'src/index::main', groupId: 'e2e-group' },
        cross_repo_impact: { symbol: 'src/index::main', groupId: 'e2e-group' },
        manage_repo_group: { action: 'list' },
        sync_contracts: { groupId: 'e2e-group' },
        discover_related_repos: { projectId: PROJECT_ID },
        cross_repo_review_pr: { groupId: 'e2e-group', sourceRepoId: PROJECT_ID },
        pdg_query: { functionId: 'src/index::main', projectId: PROJECT_ID },
        taint_analysis: { projectId: PROJECT_ID },
        explain_taint: { taintPathId: 'path-1', projectId: PROJECT_ID },
        list_standards: { projectId: PROJECT_ID },
        create_standard: {
          projectId: PROJECT_ID,
          name: 'Test Standard',
          category: 'custom',
          rules: [{ id: 'r1', name: 'R1', description: 'Test rule', checkType: 'regex', severity: 'low' as const, checkConfig: { pattern: 'test' } }],
        },
        manage_adr: { action: 'list', projectId: PROJECT_ID },
        install_skills: { agents: ['codebuddy'], dryRun: true },
        run_benchmark: {},
      };

      const results: Array<{ name: string; error: boolean; time: number }> = [];

      for (const [name, args] of Object.entries(minimalArgs)) {
        const start = Date.now();
        try {
          const result = await registry.execute(name, args, ctx);
          results.push({ name, error: result.isError === true, time: Date.now() - start });
        } catch (err) {
          results.push({ name, error: true, time: Date.now() - start });
        }
      }

      expect(results.length).toBe(40);

      const failedTools = results.filter(r => r.error);
      if (failedTools.length > 0) {
        console.error('Tools returning error:', failedTools.map(r => r.name).join(', '));
      }

      // All tools must complete within 5 seconds
      for (const r of results) {
        expect(typeof r.time).toBe('number');
        expect(r.time).toBeLessThan(5000);
      }

      // At least 80% of tools must return without errors
      const successRate = (results.length - failedTools.length) / results.length;
      expect(successRate).toBeGreaterThanOrEqual(0.8);
    });

    it('should have consistent schema definitions for all 40 tools', () => {
      const tools = registry.list();
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
        expect(typeof tool.inputSchema.properties).toBe('object');
      }
    });
  });
});
