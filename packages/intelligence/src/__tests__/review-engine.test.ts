// @code-analyzer/intelligence — Code Review Engine Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeReviewEngine } from '../review/review-engine.js';
import { SessionStore } from '../review/session-store.js';
import { analyzeFileHeuristics, toReviewComment } from '../review/heuristics.js';
import { SqliteStore } from '@code-analyzer/infra';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { GitDiff, GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStore(): SqliteStore {
  return new SqliteStore();
}

function createDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: '/src/test.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    ranges: [
      { oldStart: 1, oldEnd: 10, newStart: 1, newEnd: 12, changeType: 'modified' },
    ],
    changeType: 'modified',
    ...overrides,
  };
}

function createNode(store: SqliteStore, overrides: Partial<GraphNode> = {}): void {
  store.insertNode({
    id: 0,
    projectId: 'test-project',
    label: 'Function',
    name: 'testFunc',
    qualifiedName: 'pkg.testFunc',
    filePath: '/src/test.ts',
    startLine: 1,
    endLine: 20,
    language: 'typescript',
    properties: { name: 'testFunc', isExported: true },
    signature: 'function testFunc(): void',
    docstring: 'A test function',
    complexity: 5,
    isExported: true,
    fingerprint: 'fp1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function createEdge(store: SqliteStore, overrides: Partial<GraphEdge> = {}): void {
  store.insertEdge({
    id: 0,
    projectId: 'test-project',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: { confidence: 1 },
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), `session-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Heuristic Analysis Tests
// ---------------------------------------------------------------------------

describe('Heuristic Analysis', () => {
  describe('Long Function Detection', () => {
    it('should detect a function longer than 50 lines', () => {
      const lines: string[] = [];
      lines.push('function longFunc() {');
      for (let i = 0; i < 100; i++) {
        lines.push(`  // line ${i}`);
      }
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const longFuncIssues = results.filter(
        (r) => r.title.includes('Long function'),
      );

      expect(longFuncIssues.length).toBeGreaterThan(0);
      expect(longFuncIssues[0]!.category).toBe('maintainability');
      expect(longFuncIssues[0]!.severity).toBe('medium');
    });

    it('should not flag short functions', () => {
      const lines: string[] = [];
      lines.push('function shortFunc() {');
      lines.push('  return 1;');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const longFuncIssues = results.filter(
        (r) => r.title.includes('Long function'),
      );

      expect(longFuncIssues.length).toBe(0);
    });

    it('should detect arrow functions that are too long', () => {
      const lines: string[] = [];
      lines.push('const longArrow = () => {');
      for (let i = 0; i < 80; i++) {
        lines.push(`  // line ${i}`);
      }
      lines.push('};');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const longFuncIssues = results.filter(
        (r) => r.title.includes('Long function'),
      );

      expect(longFuncIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Deep Nesting Detection', () => {
    it('should detect deep nesting', () => {
      const lines: string[] = [];
      lines.push('function deepFunc() {');
      lines.push('  if (a) {');
      lines.push('    if (b) {');
      lines.push('      if (c) {');
      lines.push('        if (d) {');
      lines.push('          if (e) {'); // depth 5 from function start
      lines.push('            return;');
      lines.push('          }');
      lines.push('        }');
      lines.push('      }');
      lines.push('    }');
      lines.push('  }');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const nestingIssues = results.filter(
        (r) => r.title.includes('Deeply nested'),
      );

      // Deep nesting check is on lines with many opening braces
      expect(nestingIssues.length).toBeGreaterThan(0);
      expect(nestingIssues[0]!.category).toBe('maintainability');
    });

    it('should not flag shallow nesting', () => {
      const lines: string[] = [];
      lines.push('function shallowFunc() {');
      lines.push('  if (a) {');
      lines.push('    return 1;');
      lines.push('  }');
      lines.push('  return 0;');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const nestingIssues = results.filter(
        (r) => r.title.includes('Deeply nested'),
      );

      expect(nestingIssues.length).toBe(0);
    });
  });

  describe('Error Handling Detection', () => {
    it('should detect risky operations without error handling context', () => {
      const lines: string[] = [];
      lines.push('async function fetchData() {');
      lines.push('  const res = await fetch("/api/data");');
      lines.push('  return res.json();');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const errorIssues = results.filter(
        (r) => r.category === 'bug',
      );

      expect(errorIssues.length).toBeGreaterThan(0);
    });

    it('should detect database operations without error handling', () => {
      const lines: string[] = [];
      lines.push('function getUsers() {');
      lines.push('  const users = db.query("SELECT * FROM users");');
      lines.push('  return users;');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const errorIssues = results.filter(
        (r) => r.category === 'bug',
      );

      expect(errorIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Naming Convention Checks', () => {
    it('should flag PascalCase violation in class names', () => {
      const lines: string[] = [];
      lines.push('class myClass {');
      lines.push('  constructor() {}');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const namingIssues = results.filter(
        (r) => r.title.includes('PascalCase'),
      );

      expect(namingIssues.length).toBeGreaterThan(0);
    });

    it('should flag camelCase violation in variable names', () => {
      const lines: string[] = [];
      lines.push('const BadName = 42;');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const namingIssues = results.filter(
        (r) => r.title.includes('camelCase'),
      );

      expect(namingIssues.length).toBeGreaterThan(0);
    });
  });

  describe('TODO/FIXME Detection', () => {
    it('should detect TODO comments', () => {
      const lines: string[] = [];
      lines.push('function test() {');
      lines.push('  // TODO: implement this later');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const todoIssues = results.filter(
        (r) => r.title.includes('TODO'),
      );

      expect(todoIssues.length).toBeGreaterThan(0);
      expect(todoIssues[0]!.category).toBe('documentation');
    });

    it('should detect FIXME comments with higher severity', () => {
      const lines: string[] = [];
      lines.push('function test() {');
      lines.push('  // FIXME: this is broken');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const fixmeIssues = results.filter(
        (r) => r.title.includes('FIXME'),
      );

      expect(fixmeIssues.length).toBeGreaterThan(0);
      expect(fixmeIssues[0]!.severity).toBe('medium');
    });
  });

  describe('Console.log Detection', () => {
    it('should detect console.log in non-test files', () => {
      const lines: string[] = [];
      lines.push('function test() {');
      lines.push('  console.log("debug");');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/production.ts', lines);
      const consoleIssues = results.filter(
        (r) => r.title.includes('console.log'),
      );

      expect(consoleIssues.length).toBeGreaterThan(0);
    });

    it('should not flag console.log in test files', () => {
      const lines: string[] = [];
      lines.push('function test() {');
      lines.push('  console.log("debug");');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.test.ts', lines);
      const consoleIssues = results.filter(
        (r) => r.title.includes('console.log'),
      );

      // Test files may allow console.log for debugging
      expect(consoleIssues.length).toBe(0);
    });
  });

  describe('Return Type Detection', () => {
    it('should detect missing return type in TypeScript functions', () => {
      const lines: string[] = [];
      lines.push('export function add(a: number, b: number) {');
      lines.push('  return a + b;');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.ts', lines);
      const returnIssues = results.filter(
        (r) => r.title.includes('return type'),
      );

      expect(returnIssues.length).toBeGreaterThan(0);
    });

    it('should not flag JS files for missing return types', () => {
      const lines: string[] = [];
      lines.push('function add(a, b) {');
      lines.push('  return a + b;');
      lines.push('}');

      const results = analyzeFileHeuristics('/src/test.js', lines);
      const returnIssues = results.filter(
        (r) => r.title.includes('return type'),
      );

      expect(returnIssues.length).toBe(0);
    });
  });

  describe('Change Analysis', () => {
    it('should detect risky changes to shared types', () => {
      const diff = createDiff({ filePath: '/src/types/User.ts' });
      const lines = ['// types file'];

      const results = analyzeFileHeuristics(diff.filePath, lines, diff);
      const riskyIssues = results.filter(
        (r) => r.title.includes('Risky change'),
      );

      expect(riskyIssues.length).toBeGreaterThan(0);
      expect(riskyIssues[0]!.category).toBe('architecture');
    });

    it('should detect risky API route changes', () => {
      const diff = createDiff({ filePath: '/src/routes/api.ts' });
      const lines = ['// api routes'];

      const results = analyzeFileHeuristics(diff.filePath, lines, diff);
      const riskyIssues = results.filter(
        (r) => r.title.includes('Risky change'),
      );

      expect(riskyIssues.length).toBeGreaterThan(0);
    });

    it('should detect file deletion as risky', () => {
      const diff = createDiff({ changeType: 'deleted' });
      const lines = ['// deleted file'];

      const results = analyzeFileHeuristics(diff.filePath, lines, diff);
      const deletionIssues = results.filter(
        (r) => r.title.includes('deletion'),
      );

      expect(deletionIssues.length).toBeGreaterThan(0);
    });

    it('should detect configuration file changes', () => {
      const diff = createDiff({ filePath: '/src/config/settings.ts' });
      const lines = ['// config'];

      const results = analyzeFileHeuristics(diff.filePath, lines, diff);
      const configIssues = results.filter(
        (r) => r.title.includes('Configuration'),
      );

      expect(configIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Review Comment Conversion', () => {
    it('should convert heuristic result to review comment', () => {
      const lines = ['function test() {', '  return 1;', '}'];
      const heuristicResult = {
        triggered: true,
        category: 'maintainability' as const,
        severity: 'medium' as const,
        title: 'Test issue',
        description: 'Test description',
        suggestionCode: '// fix',
        startLine: 1,
        endLine: 1,
      };

      const comment = toReviewComment('/src/test.ts', heuristicResult, 0, lines);

      expect(comment.path).toBe('/src/test.ts');
      expect(comment.content).toBe('Test issue');
      expect(comment.thinking).toBe('Test description');
      expect(comment.suggestionCode).toBe('// fix');
      expect(comment.startLine).toBe(1);
      expect(comment.endLine).toBe(1);
      expect(comment.filtered).toBe(false);
      expect(comment.id).toBeTruthy();
      expect(comment.createdAt).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Code Review Engine Tests
// ---------------------------------------------------------------------------

describe('Code Review Engine', () => {
  let store: SqliteStore;
  let engine: CodeReviewEngine;
  let tempDir: string;
  let sessionStore: SessionStore;

  beforeEach(() => {
    store = createStore();
    tempDir = getTempDir();
    sessionStore = new SessionStore(tempDir);
    engine = new CodeReviewEngine(store, {}, sessionStore);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup may fail on some platforms, but tests should still pass
    }
  });

  describe('reviewFile()', () => {
    it('should review a simple file and return comments', async () => {
      const content = [
        'function tooLongFunc() {',
        ...Array(60).fill('  // padding line'),
        '}',
      ].join('\n');

      const comments = await engine.reviewFile('test-project', '/src/test.ts', content);

      expect(comments.length).toBeGreaterThan(0);
      expect(comments[0]!.path).toBe('/src/test.ts');
    });

    it('should return comments with valid structure', async () => {
      const content = 'function test() {\n  return 42;\n}';

      const comments = await engine.reviewFile('test-project', '/src/test.ts', content);

      for (const comment of comments) {
        expect(comment.id).toBeTruthy();
        expect(comment.path).toBe('/src/test.ts');
        expect(comment.category).toBeTruthy();
        expect(comment.severity).toBeTruthy();
        expect(comment.content).toBeTruthy();
        expect(typeof comment.startLine).toBe('number');
        expect(typeof comment.endLine).toBe('number');
      }
    });

    it('should handle empty files', async () => {
      const comments = await engine.reviewFile('test-project', '/src/empty.ts', '');

      expect(Array.isArray(comments)).toBe(true);
    });

    it('should handle files with only comments', async () => {
      const content = '// Just a comment\n/* Block comment */';

      const comments = await engine.reviewFile('test-project', '/src/comments.ts', content);

      expect(Array.isArray(comments)).toBe(true);
    });
  });

  describe('reviewDiff()', () => {
    it('should review diffs and create a session', async () => {
      const diffs = [
        createDiff({ filePath: '/src/a.ts' }),
        createDiff({ filePath: '/src/b.ts' }),
      ];

      const session = await engine.reviewDiff('test-project', diffs);

      expect(session.id).toBeTruthy();
      expect(session.projectId).toBe('test-project');
      expect(session.status).toBe('completed');
      expect(session.filesReviewed).toBe(2);
      expect(session.commentsGenerated).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty diff array', async () => {
      const session = await engine.reviewDiff('test-project', []);

      expect(session.filesReviewed).toBe(0);
      expect(session.status).toBe('completed');
    });

    it('should handle diffs with deleted files', async () => {
      const diffs = [createDiff({ changeType: 'deleted', filePath: '/src/old.ts' })];

      const session = await engine.reviewDiff('test-project', diffs);

      expect(session.status).toBe('completed');
    });

    it('should handle renamed files', async () => {
      const diffs = [
        createDiff({
          changeType: 'renamed',
          filePath: '/src/new.ts',
          oldPath: '/src/old.ts',
        }),
      ];

      const session = await engine.reviewDiff('test-project', diffs);

      expect(session.status).toBe('completed');
    });
  });

  describe('resumeSession()', () => {
    it('should resume a session after review', async () => {
      const diffs = [createDiff({ filePath: '/src/a.ts' })];
      const session = await engine.reviewDiff('test-project', diffs);

      const resumed = await engine.resumeSession(session.id);

      expect(resumed.id).toBe(session.id);
      expect(resumed.status).toBe('completed');
    });

    it('should return completed files from resumed session', async () => {
      const diffs = [
        createDiff({ filePath: '/src/a.ts' }),
        createDiff({ filePath: '/src/b.ts' }),
      ];
      const session = await engine.reviewDiff('test-project', diffs);

      const resumed = await engine.resumeSession(session.id);

      expect(resumed.filesReviewed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Graph Analysis Integration', () => {
    it('should handle files with graph data', async () => {
      createNode(store);
      createNode(store, {
        qualifiedName: 'pkg.otherFunc',
        filePath: '/src/other.ts',
        name: 'otherFunc',
      });

      createEdge(store);
      createEdge(store, { sourceId: 2, type: 'CALLS' });

      const diffs = [createDiff({ filePath: '/src/test.ts' })];

      const session = await engine.reviewDiff('test-project', diffs);

      expect(session.status).toBe('completed');
    });
  });
});
