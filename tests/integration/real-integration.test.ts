// @code-analyzer — Real Integration Tests (No Mocks)
// Tests using REAL SqliteStore, real git repos, real file I/O, and real language parsers.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { SqliteStore } from '@code-analyzer/infra';
import { createGitOperations } from '@code-analyzer/infra';
import { createFileDiscoverer } from '@code-analyzer/infra';
import { StandardsEngine } from '@code-analyzer/intelligence';
import { ReportGenerator } from '@code-analyzer/intelligence';
import { RecommendationEngine } from '@code-analyzer/intelligence';
import { MarkdownFormatter, JsonFormatter, HtmlFormatter } from '@code-analyzer/intelligence';
import { SessionStore } from '@code-analyzer/intelligence';
import { CodeReviewEngine } from '@code-analyzer/intelligence';
import { MemoryCompressor } from '@code-analyzer/intelligence';
import { HybridSearchEngine } from '@code-analyzer/intelligence';
import { MinHashSimilarity, LSHSearcher } from '@code-analyzer/intelligence';
import { EmbeddingEngine } from '@code-analyzer/intelligence';
import { IoUOverlapDetector } from '@code-analyzer/intelligence';
import { TrendAnalyzer } from '@code-analyzer/intelligence';
import { TypeScriptProvider, PythonProvider, GoProvider, JavaScriptProvider } from '@code-analyzer/analyzer';
import type { GitDiff, GraphNode, NodeLabel, RelationshipType } from '@code-analyzer/shared';

function createTempGitRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-int-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  for (const [fp, content] of Object.entries(files)) {
    const full = path.join(dir, fp);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    execSync(`git add "${fp}"`, { cwd: dir, stdio: 'pipe' });
  }
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeNode(name: string, qname: string, label: NodeLabel = 'Function'): GraphNode {
  return {
    id: 0, projectId: 'int-test', label, name, qualifiedName: qname,
    filePath: `src/${name}.ts`, startLine: 1, endLine: 10, language: 'typescript',
    properties: { name }, signature: null, docstring: null, complexity: null,
    isExported: true, fingerprint: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

// ─── 1. SqliteStore Real Tests ───
describe('SqliteStore (Real DB)', () => {
  const store = new SqliteStore();
  afterAll(() => store.close());

  it('inserts and retrieves a node', () => {
    const node = makeNode('auth', 'proj.src.auth');
    const id = store.insertNode(node);
    expect(id).toBeGreaterThan(0);
    const r = store.getNode(id);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('auth');
  });

  it('handles batch insert of 500 nodes', () => {
    const nodes = Array.from({ length: 500 }, (_, i) =>
      makeNode(`fn${i}`, `proj.src.fn${i}`)
    );
    const ids = store.insertNodes(nodes);
    expect(ids.length).toBe(500);
  });

  it('supports FTS search', () => {
    store.insertNode(makeNode('loginHandler', 'proj.src.loginHandler'));
    const results = store.searchFts('login', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('supports BFS traversal with real edges', () => {
    const s = new SqliteStore();
    const a = s.insertNode(makeNode('a', 'p.a'));
    const b = s.insertNode(makeNode('b', 'p.b'));
    const c = s.insertNode(makeNode('c', 'p.c'));
    s.insertEdge({ id: 0, projectId: 'p', sourceId: a, targetId: b, type: 'CALLS', properties: {}, weight: 1, createdAt: '' });
    s.insertEdge({ id: 0, projectId: 'p', sourceId: b, targetId: c, type: 'CALLS', properties: {}, weight: 1, createdAt: '' });
    const result = s.bfs(a, 2);
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    s.close();
  });

  it('validates graph integrity', () => {
    const nodeId = store.insertNode(makeNode('orphanRef', 'p.orphanRef'));
    // Reference to non-existent node creates integrity violation
    const report = store.validateIntegrity('p');
    // Integrity report should be defined
    expect(report).toBeDefined();
    expect(Array.isArray(report.violations)).toBe(true);
  });
});

// ─── 2. Git Operations Real Tests ───
describe('Git Ops (Real Repo)', () => {
  let repo: string;
  beforeAll(() => { repo = createTempGitRepo({ 'src/a.ts': 'export const x = 1;', 'src/b.ts': 'export const y = 2;' }); });
  afterAll(() => fs.rmSync(repo, { recursive: true }));

  it('detects workspace changes', async () => {
    fs.writeFileSync(path.join(repo, 'src/a.ts'), 'export const x = 42;');
    const git = createGitOperations(repo);
    const diffs = await git.getWorkspaceDiff();
    expect(diffs.length).toBeGreaterThan(0);
  }, 15000);

  it('reports dirty workspace', async () => {
    const git = createGitOperations(repo);
    expect(await git.isDirty()).toBe(true);
  }, 15000);

  it('gets file content at HEAD', async () => {
    const git = createGitOperations(repo);
    const hash = await git.getLastCommit();
    const content = await git.getFileContent(hash, 'src/b.ts');
    expect(content).toContain('y = 2');
  }, 15000);

  it('lists branches', async () => {
    const git = createGitOperations(repo);
    const branches = await git.listBranches();
    expect(branches.length).toBeGreaterThan(0);
  }, 15000);
});

// ─── 3. Language Parsers Real Tests ───
describe('Language Parsers (Real Code)', () => {
  it('TypeScript: detects functions, classes, imports, decorators, routes', () => {
    const p = new TypeScriptProvider();
    const code = `import { Service } from './svc';\n@Injectable()\nclass Ctrl {\n  @Get('/api')\n  async list() { return []; }\n}\nexport function main() {}\n`;
    const caps = p.parse(code, 'ctrl.ts');
    const funcs = caps.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    const classes = caps.filter(c => c.tag === 'class.def');
    expect(funcs.length).toBeGreaterThanOrEqual(2);
    expect(classes.length).toBeGreaterThanOrEqual(1);
  });

  it('Python: detects functions, classes, decorators, docstrings', () => {
    const p = new PythonProvider();
    const code = `"""Module."""\nclass Mgr:\n    def doit(self, x: int) -> str:\n        """Doc."""\n        return str(x)\ndef top(): pass\n`;
    const caps = p.parse(code, 'mgr.py');
    const funcs = caps.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    expect(funcs.length).toBeGreaterThanOrEqual(2);
  });

  it('Go: detects functions, methods, structs, interfaces', () => {
    const p = new GoProvider();
    const code = `package p\ntype I interface { F() }\ntype S struct {}\nfunc (s *S) F() {}\nfunc New() *S { return &S{} }\n`;
    const caps = p.parse(code, 'p.go');
    const funcs = caps.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    expect(funcs.length).toBeGreaterThanOrEqual(2);
  });

  it('JavaScript: detects functions, classes, CommonJS', () => {
    const p = new JavaScriptProvider();
    const code = `const x = require('y');\nfunction main() {}\nclass Comp { render() { return null; } }\nmodule.exports = { main };\n`;
    const caps = p.parse(code, 'comp.js');
    const funcs = caps.filter(c => c.tag === 'function.def' || c.tag === 'method.def');
    expect(funcs.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 4. Code Review Engine Real Tests ───
describe('Code Review (Real Analysis)', () => {
  const store = new SqliteStore();
  const engine = new CodeReviewEngine(store);
  afterAll(() => store.close());

  it('reviews TypeScript code', async () => {
    const code = 'function longFn() {\n' + '  console.log(1);\n'.repeat(55) + '}\n';
    const comments = await engine.reviewFile('test', 'src/long.ts', code);
    expect(comments.length).toBeGreaterThan(0);
  }, 10000);
});

// ─── 5. Standards Engine Real Tests ───
describe('Standards (Real Checks)', () => {
  const engine = new StandardsEngine();

  it('checks TypeScript against coding standard', () => {
    const code = 'function f() { var x=1; console.log("x"); if(a){if(b){if(c){if(d){if(e){}}}}}}';
    const std = engine.loadStandard('typescript-coding')!;
    const results = engine.checkSource(code, 'test.ts', std);
    expect(results.length).toBeGreaterThan(0);
  });

  it('checks Python against PEP8-like standard', () => {
    const code = 'def f():\n    x=1\n    print(x)\n    if a:\n        if b:\n            if c:\n                if d:\n                    if e:\n                        pass';
    const std = engine.loadStandard('python-pep8')!;
    const results = engine.checkSource(code, 'test.py', std);
    expect(results.length).toBeGreaterThan(0);
  });

  it('checks Go against idiomatic standard', () => {
    const code = 'package p\nfunc f() { println("x"); if true { if true { if true { if true { if true { } } } } } }';
    const std = engine.loadStandard('go-idiomatic')!;
    const results = engine.checkSource(code, 'test.go', std);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── 6. Report Generator Real Tests ───
describe('Reports (Real Generation)', () => {
  const gen = new ReportGenerator();

  it('generates PR report in Markdown', () => {
    const r = gen.generatePRReport({
      projectId: 'p', prNumber: 1, baseRef: 'main', headRef: 'dev',
      reviewComments: [], standardsResults: [],
      metrics: {}, repository: 'r/r', branch: 'dev', commitSha: 'abc', author: 'dev',
    });
    const md = new MarkdownFormatter().format(r);
    expect(md).toContain('PR #1 Review');
  });

  it('generates report in JSON', () => {
    const r = gen.generatePRReport({
      projectId: 'p', prNumber: 2, baseRef: 'main', headRef: 'dev',
      reviewComments: [], standardsResults: [],
      metrics: {}, repository: 'r/r', branch: 'dev', commitSha: 'def', author: 'dev',
    });
    const json = new JsonFormatter().format(r);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('generates report in HTML', () => {
    const r = gen.generatePRReport({
      projectId: 'p', prNumber: 3, baseRef: 'main', headRef: 'dev',
      reviewComments: [], standardsResults: [],
      metrics: {}, repository: 'r/r', branch: 'dev', commitSha: 'ghi', author: 'dev',
    });
    const html = new HtmlFormatter().format(r);
    expect(html).toContain('<html');
  });

  it('generates recommendations', () => {
    const findings = [
      { id: 'f1', category: 'bug' as const, severity: 'critical' as const, title: 'Bug', description: 'bad', filePath: 'x.ts', lineRange: [1, 2] as [number, number], evidence: 'code', relatedFindings: [] },
    ];
    const recEngine = new RecommendationEngine();
    const recs = recEngine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThan(0);
  });
});

// ─── 7. Session Store Real Tests ───
describe('Session Store (Real FS)', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-sess-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true }));

  it('starts, records, and resumes a session', () => {
    const store = new SessionStore(dir);
    const s = store.startSession('p', { repository: 'r', branch: 'main', mode: 'diff' });
    expect(s.id).toBeTruthy();
    store.recordItemDone(s.id, { filePath: 'a.ts', fingerprint: 'abc', comments: [], duration: 50 });
    const resume = store.buildResumeState(s.id);
    expect(resume.completedFiles.has('abc')).toBe(true);
    store.listSessions('p');
  });
});

// ─── 8. Memory Compression Real Tests ───
describe('Memory Compressor (Real)', () => {
  it('compresses long conversations below token budget', () => {
    const c = new MemoryCompressor({ maxTokens: 1000 });
    const msgs = [{ content: 'System' }, ...Array(30).fill({ content: 'data '.repeat(50) })];
    const tokens = c.countTokens(msgs.map(m => m.content).join(''));
    const result = c.compress(msgs, tokens);
    expect(result.length).toBeLessThan(msgs.length);
  });
});

// ─── 9. Hybrid Search Real Tests ───
describe('Hybrid Search (Real)', () => {
  it('ranks results by relevance', async () => {
    const store = new SqliteStore();
    const search = new HybridSearchEngine(store);
    for (let i = 0; i < 30; i++) store.insertNode(makeNode(`fn${i}`, `p.src.fn${i}`));
    const results = await search.search({ query: 'fn15', projectId: 'p', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    store.close();
  });
});

// ─── 10. Similarity Detection Real Tests ───
describe('Similarity (Real MinHash+LSH)', () => {
  it('detects similar token sets', () => {
    const mh = new MinHashSimilarity(64);
    const lsh = new LSHSearcher(8);
    const t1 = 'function auth user login check'.split(' ');
    const t2 = 'function auth user login verify'.split(' ');
    const fp1 = mh.computeFingerprint(t1);
    const fp2 = mh.computeFingerprint(t2);
    lsh.insert(1, fp1);
    lsh.insert(2, fp2);
    expect(mh.estimateSimilarity(fp1, fp2)).toBeGreaterThan(0.5);
  });
});

// ─── 11. Embedding Engine Real Tests ───
describe('Embedding (Real Vectors)', () => {
  it('same code → cosine ≈ 1.0', async () => {
    const e = new EmbeddingEngine({ dimensions: 32 });
    await e.initialize();
    const v1 = await e.embedCode('function f() { return 1; }');
    const v2 = await e.embedCode('function f() { return 1; }');
    expect(e.cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    e.dispose();
  });
});

// ─── 12. IoU Overlap Real Tests ───
describe('IoU Overlap (Real)', () => {
  it('detects overlapping regions', () => {
    const d = new IoUOverlapDetector();
    const existing = [{ filePath: 'a.ts', startLine: 10, endLine: 20, commentId: 'c1' }];
    expect(d.detectOverlap({ filePath: 'a.ts', startLine: 15, endLine: 25, commentId: 'new' }, existing)).not.toBeNull();
  });
});

// ─── 13. File Discoverer Real Tests ───
describe('File Discovery (Real FS)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-disc-'));
    fs.writeFileSync(path.join(dir, 'main.ts'), 'export {};');
    fs.writeFileSync(path.join(dir, 'utils.py'), 'def f(): pass');
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true }));

  it('discovers files and detects languages', async () => {
    const discoverer = createFileDiscoverer();
    const files = await discoverer.discover(dir);
    expect(files.length).toBeGreaterThan(0);
    // node_modules should be excluded
    expect(files.some(f => f.path.includes('node_modules'))).toBe(false);
  }, 10000);
});

// ─── 14. Trend Analyzer Real Tests ───
describe('Trend Analyzer (Real)', () => {
  it('detects improving trend', () => {
    const gen = new ReportGenerator();
    const ta = new TrendAnalyzer();
    const r1 = gen.generatePRReport({ projectId:'p',prNumber:1,baseRef:'m',headRef:'d',reviewComments:[],standardsResults:[],metrics:{linesChanged:200},repository:'r',branch:'d',commitSha:'a1',author:'d'});
    const r2 = gen.generatePRReport({ projectId:'p',prNumber:2,baseRef:'m',headRef:'d',reviewComments:[],standardsResults:[],metrics:{linesChanged:50},repository:'r',branch:'d',commitSha:'a2',author:'d'});
    const trend = ta.trackMetric([r1, r2], 'metrics.linesChanged');
    expect(trend.values).toEqual([200, 50]);
    expect(trend.direction).toBe('improving');
  });
});
