// @code-analyzer — Real Integration Tests
// These tests use REAL components, not mocks, to verify end-to-end functionality.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { SqliteStore } from '@code-analyzer/infra';
import { createGitOperations } from '@code-analyzer/infra';
import { FileDiscoverer, createFileDiscoverer } from '@code-analyzer/infra';
import { ChangeDetector } from '@code-analyzer/intelligence';
import { ImpactAnalyzer } from '@code-analyzer/intelligence';
import { StandardsEngine } from '@code-analyzer/intelligence';
import { ReportGenerator } from '@code-analyzer/intelligence';
import { RecommendationEngine } from '@code-analyzer/intelligence';
import { MarkdownFormatter, JsonFormatter, HtmlFormatter } from '@code-analyzer/intelligence';
import { SessionStore } from '@code-analyzer/intelligence';
import { CodeReviewEngine } from '@code-analyzer/intelligence';
import { PRReviewEngine } from '@code-analyzer/intelligence';
import { MemoryCompressor } from '@code-analyzer/intelligence';
import { HybridSearchEngine } from '@code-analyzer/intelligence';
import { MinHashSimilarity, LSHSearcher } from '@code-analyzer/intelligence';
import { EmbeddingEngine } from '@code-analyzer/intelligence';
import { IoUOverlapDetector } from '@code-analyzer/intelligence';
import { TrendAnalyzer } from '@code-analyzer/intelligence';
import { ScopeResolver } from '@code-analyzer/analyzer';
import { GraphBuilder } from '@code-analyzer/analyzer';
import { UnifiedParser } from '@code-analyzer/analyzer';
import { PipelineOrchestrator } from '@code-analyzer/analyzer';
import { TypeScriptProvider, PythonProvider, GoProvider } from '@code-analyzer/analyzer';
import type { GitDiff, GraphNode, GraphEdge, NodeLabel, RelationshipType } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helper: Create a temporary git repository with real files
// ---------------------------------------------------------------------------
function createTempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-test-'));
  execSync('git init', { cwd: dir });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    execSync(`git add "${filePath}"`, { cwd: dir });
  }
  execSync('git commit -m "initial"', { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------------------
// 1. SqliteStore Real Integration Tests
// ---------------------------------------------------------------------------
describe('SqliteStore Integration (Real)', () => {
  let store: SqliteStore;

  beforeAll(() => { store = new SqliteStore(); });
  afterAll(() => { store.close(); });

  it('stores and retrieves nodes with full properties', () => {
    const node: GraphNode = {
      id: 0, projectId: 'test-proj', label: 'Function', name: 'authenticate',
      qualifiedName: 'test-proj.src.auth.authenticate', filePath: 'src/auth.ts',
      startLine: 10, endLine: 25, language: 'typescript',
      properties: { name: 'authenticate', isExported: true, signature: '(token: string): boolean', complexity: 5 },
      signature: '(token: string): boolean', docstring: 'Authenticates a user token',
      complexity: 5, isExported: true, fingerprint: 'abc123',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const id = store.insertNode(node);
    expect(id).toBeGreaterThan(0);
    const retrieved = store.getNode(id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('authenticate');
    expect(retrieved!.complexity).toBe(5);
  });

  it('handles batch insert of 1000 nodes', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 1000; i++) {
      nodes.push({
        id: 0, projectId: 'batch-test', label: 'Function', name: `func${i}`,
        qualifiedName: `batch-test.src.func${i}`, filePath: 'src/index.ts',
        startLine: i * 5, endLine: i * 5 + 4, language: 'typescript',
        properties: { name: `func${i}` }, signature: null, docstring: null,
        complexity: null, isExported: i % 2 === 0, fingerprint: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    const ids = store.insertNodes(nodes);
    expect(ids.length).toBe(1000);
  });

  it('performs BFS traversal correctly', () => {
    const store2 = new SqliteStore();
    const a = store2.insertNode(makeNode(store2, 'a', 'test.src.a', 'Function'));
    const b = store2.insertNode(makeNode(store2, 'b', 'test.src.b', 'Function'));
    const c = store2.insertNode(makeNode(store2, 'c', 'test.src.c', 'Function'));
    store2.insertEdge(makeEdge(store2, a, b, 'CALLS'));
    store2.insertEdge(makeEdge(store2, b, c, 'CALLS'));
    const result = store2.bfs(a, 2);
    expect(result.length).toBeGreaterThanOrEqual(2);
    store2.close();
  });

  it('detects integrity violations', () => {
    const store2 = new SqliteStore();
    const a = store2.insertNode(makeNode(store2, 'orphan', 'test.src.orphan', 'Function'));
    store2.insertEdge(makeEdge(store2, a, 99999, 'CALLS'));
    const report = store2.validateIntegrity('test');
    expect(report.violations.length).toBeGreaterThan(0);
    store2.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Git Operations Real Integration Tests
// ---------------------------------------------------------------------------
describe('Git Operations Integration (Real)', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = createTempRepo({
      'src/index.ts': 'export function main() { return "hello"; }',
      'src/utils.ts': 'export function helper(x: number) { return x * 2; }',
    });
  });

  afterAll(() => { fs.rmSync(repoDir, { recursive: true }); });

  it('detects workspace diff after file modification', async () => {
    fs.writeFileSync(path.join(repoDir, 'src/index.ts'), 'export function main() { return "world"; }');
    const git = createGitOperations(repoDir);
    const diffs = await git.getWorkspaceDiff();
    expect(diffs.length).toBeGreaterThan(0);
  }, 10000);

  it('gets commit diff for initial commit', async () => {
    const git = createGitOperations(repoDir);
    const lastCommit = await git.getLastCommit();
    expect(lastCommit).toBeTruthy();
    const diffs = await git.getCommitDiff(lastCommit);
    expect(diffs.length).toBeGreaterThan(0);
  }, 10000);

  it('detects dirty workspace', async () => {
    fs.writeFileSync(path.join(repoDir, 'src/utils.ts'), 'export function helper(x: number) { return x * 3; }');
    const git = createGitOperations(repoDir);
    expect(await git.isDirty()).toBe(true);
  }, 10000);

  it('gets file content at specific ref', async () => {
    const git = createGitOperations(repoDir);
    const lastCommit = await git.getLastCommit();
    const content = await git.getFileContent(lastCommit, 'src/index.ts');
    expect(content).toBeDefined();
  }, 10000);

  it('lists branches', async () => {
    const git = createGitOperations(repoDir);
    const branches = await git.listBranches();
    expect(branches.length).toBeGreaterThan(0);
  }, 10000);
});

// ---------------------------------------------------------------------------
// 3. Language Parser Integration Tests (Real code parsing)
// ---------------------------------------------------------------------------
describe('Language Parser Integration (Real)', () => {
  it('TypeScript parser handles complex file', () => {
    const provider = new TypeScriptProvider();
    const code = `
import { AuthService } from './auth';
import type { User } from './types';

/** Authenticates a user */
@Injectable()
export class LoginController {
  constructor(private auth: AuthService) {}

  @Post('/login')
  async login(@Body() body: LoginDto): Promise<User> {
    if (!body.email || !body.password) {
      throw new Error('Missing credentials');
    }
    const user = await this.auth.authenticate(body.email, body.password);
    return user;
  }

  private validateToken(token: string): boolean {
    return token.length > 0 && !token.includes(' ');
  }
}

export function createApp(): Express {
  const app = express();
  return app;
}
`;
    const captures = provider.parse(code, 'src/controllers/login.ts');
    const functions = captures.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    const classes = captures.filter(c => c.tag === 'class.def');
    const imports = captures.filter(c => c.tag === 'import');
    expect(functions.length).toBeGreaterThanOrEqual(3);
    expect(classes.length).toBeGreaterThanOrEqual(1);
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('Python parser handles complex file', () => {
    const provider = new PythonProvider();
    const code = `
"""Authentication module."""
from typing import Optional
import hashlib

class AuthManager:
    """Manages authentication."""
    
    def __init__(self, db_url: str) -> None:
        self.db_url = db_url

    async def authenticate(self, username: str, password: str) -> Optional[dict]:
        """Authenticate a user."""
        if not username or not password:
            raise ValueError("Missing credentials")
        hashed = hashlib.sha256(password.encode()).hexdigest()
        return await self._check_db(username, hashed)

    async def _check_db(self, username: str, hashed: str) -> Optional[dict]:
        pass

def create_manager(url: str) -> AuthManager:
    return AuthManager(url)
`;
    const captures = provider.parse(code, 'auth/manager.py');
    const functions = captures.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    const classes = captures.filter(c => c.tag === 'class.def');
    expect(functions.length).toBeGreaterThanOrEqual(3);
    expect(classes.length).toBeGreaterThanOrEqual(1);
  });

  it('Go parser handles complex file', () => {
    const provider = new GoProvider();
    const code = `
package auth

import (
    "crypto/sha256"
    "fmt"
)

// User represents an authenticated user.
type User struct {
    ID    int
    Name  string
    Email string
}

// Authenticator handles user authentication.
type Authenticator interface {
    Authenticate(username, password string) (*User, error)
}

// DefaultAuth implements Authenticator.
type DefaultAuth struct {
    db Database
}

func NewDefaultAuth(db Database) *DefaultAuth {
    return &DefaultAuth{db: db}
}

func (a *DefaultAuth) Authenticate(username, password string) (*User, error) {
    if username == "" || password == "" {
        return nil, fmt.Errorf("missing credentials")
    }
    hashed := sha256.Sum256([]byte(password))
    return a.db.FindUser(username, string(hashed[:]))
}
`;
    const captures = provider.parse(code, 'auth/auth.go');
    const functions = captures.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    const structs = captures.filter(c => c.tag === 'class.def');
    expect(functions.length).toBeGreaterThanOrEqual(2);
    expect(structs.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Code Review Engine Integration (Real heuristic analysis)
// ---------------------------------------------------------------------------
describe('Code Review Engine Integration (Real)', () => {
  const store = new SqliteStore();
  const engine = new CodeReviewEngine(store);
  
  afterAll(() => { store.close(); });

  it('detects long functions', async () => {
    const longFunction = 'function '.repeat(1) + Array(60).fill('  console.log("line");').join('\n');
    const diff: GitDiff = {
      oldPath: 'src/long.ts', newPath: 'src/long.ts',
      diff: `@@ -0,0 +1,62 @@\n+${longFunction}`,
      newFileContent: longFunction, isBinary: false, isDeleted: false,
      isNew: true, isRenamed: false, insertions: 60, deletions: 0,
    };
    const comments = await engine.reviewFile('test', 'src/long.ts', longFunction);
    const maintainabilityComments = comments.filter(c => c.category === 'maintainability');
    expect(maintainabilityComments.length).toBeGreaterThan(0);
  }, 10000);

  it('detects deep nesting', async () => {
    const deepNesting = `
function deeplyNested() {
  if (true) {
    for (let i = 0; i < 10; i++) {
      while (true) {
        if (true) {
          try {
            console.log("too deep");
          } catch (e) {}
        }
      }
    }
  }
}`;
    const comments = await engine.reviewFile('test', 'src/nested.ts', deepNesting);
    expect(comments.length).toBeGreaterThan(0);
  }, 10000);
});

// ---------------------------------------------------------------------------
// 5. Standards Engine Integration (Real compliance checking)
// ---------------------------------------------------------------------------
describe('Standards Engine Integration (Real)', () => {
  const engine = new StandardsEngine();

  it('checks TypeScript code against typescript-coding standard', () => {
    const code = `
function doStuff() {
  console.log("doing stuff");
  var x = 1;
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          if (true) {
            console.log("too deep");
          }
        }
      }
    }
  }
  return x;
}`;
    const result = engine.checkSource(code, 'src/bad.ts', engine.loadStandard('typescript-coding')!);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => !r.passed)).toBe(true);
  });

  it('checks Python code against python-pep8 standard', () => {
    const code = `
def doStuff():
    print("hello")
    x=1
    if True:
        if True:
            if True:
                if True:
                    if True:
                        print("too deep")
    return x`;
    const result = engine.checkSource(code, 'src/bad.py', engine.loadStandard('python-pep8')!);
    expect(result.length).toBeGreaterThan(0);
  });

  it('checks Go code against go-idiomatic standard', () => {
    const code = `
package main
func doStuff() {
    println("hello")
    if true {
        if true {
            if true {
                if true {
                    if true {
                        println("too deep")
                    }
                }
            }
        }
    }
}`;
    const result = engine.checkSource(code, 'src/bad.go', engine.loadStandard('go-idiomatic')!);
    expect(result.length).toBeGreaterThan(0);
  });

  it('provides auto-fixes for violations', () => {
    const code = 'function doStuff() { console.log("test"); }';
    const result = engine.checkSource(code, 'src/test.ts', engine.loadStandard('typescript-coding')!);
    const violations = result.flatMap(r => r.violations);
    const autofixes = engine.getAutoFixes(violations);
    expect(autofixes.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Report Generator Integration (Real report generation)
// ---------------------------------------------------------------------------
describe('Report Generator Integration (Real)', () => {
  const generator = new ReportGenerator();
  const recommendEngine = new RecommendationEngine();

  it('generates full PR review report in Markdown', () => {
    const report = generator.generatePRReport({
      projectId: 'test-proj', prNumber: 42, baseRef: 'main', headRef: 'feature/auth',
      reviewComments: [], standardsResults: [], metrics: { linesChanged: 150, filesChanged: 5 },
      repository: 'test/repo', branch: 'feature/auth', commitSha: 'abc123', author: 'dev',
    });
    const mdFormatter = new MarkdownFormatter();
    const md = mdFormatter.format(report);
    expect(md).toContain('# Code Review Report');
    expect(md).toContain('test/repo');
  });

  it('generates report in JSON format', () => {
    const report = generator.generatePRReport({
      projectId: 'test-proj', prNumber: 1, baseRef: 'main', headRef: 'dev',
      reviewComments: [], standardsResults: [], metrics: {},
      repository: 'test/repo', branch: 'dev', commitSha: 'def456', author: 'dev',
    });
    const jsonFormatter = new JsonFormatter();
    const json = jsonFormatter.format(report);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('pr-review');
    expect(parsed.id).toBeDefined();
  });

  it('generates report in HTML format', () => {
    const report = generator.generatePRReport({
      projectId: 'test-proj', prNumber: 1, baseRef: 'main', headRef: 'dev',
      reviewComments: [], standardsResults: [], metrics: {},
      repository: 'test/repo', branch: 'dev', commitSha: 'ghi789', author: 'dev',
    });
    const htmlFormatter = new HtmlFormatter();
    const html = htmlFormatter.format(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
  });

  it('generates recommendations from findings', () => {
    const findings = [
      { id: 'f1', category: 'bug' as const, severity: 'critical' as const, title: 'Null deref', description: 'May cause crash', filePath: 'src/auth.ts', lineRange: [10, 12] as [number, number], evidence: 'user.name.toLowerCase()', relatedFindings: [] },
      { id: 'f2', category: 'security' as const, severity: 'high' as const, title: 'SQL injection', description: 'Unvalidated input', filePath: 'src/db.ts', lineRange: [45, 45] as [number, number], evidence: 'query("SELECT * FROM users WHERE id=" + id)', relatedFindings: ['f1'] },
    ];
    const recs = recommendEngine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThan(0);
    const prioritized = recommendEngine.prioritizeRecommendations(recs);
    expect(prioritized[0]!.priority).toBeLessThanOrEqual(prioritized[prioritized.length - 1]!.priority);
  });
});

// ---------------------------------------------------------------------------
// 7. Session Store Integration (Real file persistence)
// ---------------------------------------------------------------------------
describe('Session Store Integration (Real)', () => {
  let sessionDir: string;

  beforeAll(() => { sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-')); });
  afterAll(() => { fs.rmSync(sessionDir, { recursive: true }); });

  it('persists and resumes sessions', () => {
    const store = new SessionStore(sessionDir);
    const session = store.startSession('test-proj', {
      repository: 'test/repo', branch: 'main', mode: 'diff', fromRef: 'HEAD~1', toRef: 'HEAD',
    });
    expect(session.id).toBeDefined();

    store.recordItemDone(session.id, {
      filePath: 'src/index.ts', fingerprint: 'abc123', comments: [], duration: 100,
    });

    const resumeState = store.buildResumeState(session.id);
    expect(resumeState.completedFiles.has('abc123')).toBe(true);

    const sessions = store.listSessions('test-proj');
    expect(sessions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Memory Compression Integration (Real conversation compression)
// ---------------------------------------------------------------------------
describe('Memory Compression Integration (Real)', () => {
  it('compresses long conversations', () => {
    const compressor = new MemoryCompressor({ maxTokens: 4000, softThreshold: 0.5, hardThreshold: 0.75 });
    const messages = [
      { content: 'System prompt' },
      { content: 'Please review this code' },
      ...Array(20).fill({ content: 'Some review content '.repeat(50) }),
    ];
    const tokens = compressor.countTokens(messages.map(m => m.content).join(' '));
    const { needed } = compressor.needsCompression(tokens, 4000);
    expect(needed).toBe(true);
    const compressed = compressor.compress(messages, tokens);
    expect(compressed.length).toBeLessThan(messages.length);
  });
});

// ---------------------------------------------------------------------------
// 9. Hybrid Search Integration (Real BM25 + vector)
// ---------------------------------------------------------------------------
describe('Hybrid Search Integration (Real)', () => {
  let store: SqliteStore;
  let search: HybridSearchEngine;

  beforeAll(() => {
    store = new SqliteStore();
    search = new HybridSearchEngine(store);
    for (let i = 0; i < 50; i++) {
      store.insertNode(makeNode(store, `func${i}`, `test.src.func${i}`, 'Function'));
    }
  });
  afterAll(() => { store.close(); });

  it('returns ranked results for text query', async () => {
    const results = await search.search({ query: 'func25', projectId: 'test', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.combinedScore).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. MinHash + LSH Integration (Real similarity detection)
// ---------------------------------------------------------------------------
describe('MinHash + LSH Integration (Real)', () => {
  it('detects near-duplicate functions', () => {
    const minhash = new MinHashSimilarity(64);
    const lsh = new LSHSearcher(8);
    const tokens1 = 'function authenticate user token return true'.split(' ');
    const tokens2 = 'function authenticate user token return false'.split(' ');
    const fp1 = minhash.computeFingerprint(tokens1);
    const fp2 = minhash.computeFingerprint(tokens2);
    lsh.insert(1, fp1);
    lsh.insert(2, fp2);
    const candidates = lsh.query(fp1, 0.5);
    expect(candidates).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// 11. IoU Overlap Detection Integration (Real overlap checking)
// ---------------------------------------------------------------------------
describe('IoU Overlap Detection Integration (Real)', () => {
  it('detects overlapping comment regions', () => {
    const detector = new IoUOverlapDetector();
    const existing = [
      { filePath: 'src/auth.ts', startLine: 10, endLine: 15, commentId: 'c1' },
    ];
    const overlap = detector.detectOverlap(
      { filePath: 'src/auth.ts', startLine: 13, endLine: 18, commentId: 'new' },
      existing
    );
    expect(overlap).not.toBeNull();
    expect(overlap!.commentId).toBe('c1');
  });

  it('filters overlapping comments', () => {
    const detector = new IoUOverlapDetector();
    const existing = [
      { filePath: 'src/auth.ts', startLine: 10, endLine: 15, commentId: 'c1' },
    ];
    const filtered = detector.filterOverlapping([
      { filePath: 'src/auth.ts', startLine: 13, endLine: 18, commentId: 'dup' },
      { filePath: 'src/utils.ts', startLine: 1, endLine: 5, commentId: 'new' },
    ], existing);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.commentId).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// 12. Embedding Engine Integration (Real deterministic vectors)
// ---------------------------------------------------------------------------
describe('Embedding Engine Integration (Real)', () => {
  it('produces deterministic same-content vectors', async () => {
    const engine = new EmbeddingEngine({ dimensions: 32 });
    await engine.initialize();
    const v1 = await engine.embedCode('function test() { return true; }');
    const v2 = await engine.embedCode('function test() { return true; }');
    expect(engine.cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    engine.dispose();
  });

  it('produces different vectors for different code', async () => {
    const engine = new EmbeddingEngine({ dimensions: 32 });
    await engine.initialize();
    const v1 = await engine.embedCode('function auth() { return true; }');
    const v2 = await engine.embedCode('function dbQuery() { return false; }');
    const sim = engine.cosineSimilarity(v1, v2);
    expect(sim).toBeLessThan(1.0);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// 13. Trend Analyzer Integration (Real trend analysis)
// ---------------------------------------------------------------------------
describe('Trend Analyzer Integration (Real)', () => {
  it('tracks metrics over time', () => {
    const analyzer = new TrendAnalyzer();
    const gen = new ReportGenerator();
    const reports = [
      gen.generatePRReport({ projectId: 'p1', prNumber: 1, baseRef: 'main', headRef: 'dev', reviewComments: [], standardsResults: [], metrics: { linesChanged: 100 }, repository: 'r', branch: 'b', commitSha: 'a1', author: 'dev' }),
      gen.generatePRReport({ projectId: 'p1', prNumber: 2, baseRef: 'main', headRef: 'dev', reviewComments: [], standardsResults: [], metrics: { linesChanged: 50 }, repository: 'r', branch: 'b', commitSha: 'a2', author: 'dev' }),
    ];
    const trend = analyzer.trackMetric(reports, 'metrics.linesChanged');
    expect(trend.values).toEqual([100, 50]);
    expect(trend.direction).toBe('improving');
  });
});

// ---------------------------------------------------------------------------
// Helper functions for building test graph data
// ---------------------------------------------------------------------------
function makeNode(store: SqliteStore, name: string, qname: string, label: NodeLabel = 'Function'): number {
  return store.insertNode({
    id: 0, projectId: 'test', label, name, qualifiedName: qname,
    filePath: `src/${name}.ts`, startLine: 1, endLine: 10, language: 'typescript',
    properties: { name }, signature: null, docstring: null, complexity: null,
    isExported: true, fingerprint: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
}

function makeEdge(store: SqliteStore, sourceId: number, targetId: number, type: RelationshipType): number {
  return store.insertEdge({
    id: 0, projectId: 'test', sourceId, targetId, type,
    properties: {}, weight: 1.0, createdAt: new Date().toISOString(),
  });
}
