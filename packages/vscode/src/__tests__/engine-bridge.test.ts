// @code-analyzer/vscode — Engine Bridge Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { EngineBridge } from '../services/engine-bridge.js';
import { PROJECT, insertEdge, makeNode, seedGraph } from './fixtures/seeded-graph.js';
import type { SeededGraph } from './fixtures/seeded-graph.js';

function run(cwd: string, command: string): void {
  execSync(command, { cwd, stdio: 'pipe' });
}

/** A git repository with one commit, built from the given files. */
function createRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vscode-bridge-'));
  run(dir, 'git init -q');
  run(dir, 'git config user.email tester@example.com');
  run(dir, 'git config user.name Tester');
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  run(dir, 'git add -A');
  run(dir, 'git commit -qm init');
  return dir;
}

/** Source with a function long enough to trip the >50-line heuristic. */
function longFunction(name: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  const v${i} = ${i};`).join('\n');
  return `export function ${name}() {\n${body}\n  return 0;\n}\n`;
}

describe('EngineBridge', () => {
  let bridge: EngineBridge;

  beforeEach(() => {
    // An explicit empty root is the "no workspace" configuration. It is chosen
    // here so these tests never depend on the state of the machine's checkout,
    // and it is a real option value: `''` is not nullish, so `??` passes it on.
    bridge = new EngineBridge({ workspaceRoot: '' });
  });

  afterEach(() => {
    bridge.dispose();
  });

  // -------------------------------------------------------------------------
  // Construction and Lifecycle
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates an instance without context', () => {
      const plain = new EngineBridge();
      expect(plain).toBeDefined();
      plain.dispose();
    });

    it('creates an instance with extension context', () => {
      const b2 = new EngineBridge({ globalStorageUri: { fsPath: '/tmp/test' } });
      expect(b2).toBeDefined();
      b2.dispose();
    });

    it('is not initialized by default', () => {
      expect(bridge.isInitialized).toBe(false);
    });
  });

  describe('initialize', () => {
    it('initializes the engine', async () => {
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);
    });

    it('is idempotent', async () => {
      await bridge.initialize();
      await bridge.initialize();
      expect(bridge.isInitialized).toBe(true);
    });
  });

  describe('dispose', () => {
    it('marks engine as not initialized', async () => {
      await bridge.initialize();
      bridge.dispose();
      expect(bridge.isInitialized).toBe(false);
    });

    it('can be re-initialized after dispose', async () => {
      await bridge.initialize();
      bridge.dispose();
      await bridge.initialize();

      expect(bridge.isInitialized).toBe(true);
      // dispose() closes the graph it owns, so a re-initialize that did not build
      // a fresh one would leave every query throwing "InMemoryGraphStore is
      // closed". Reading the graph back is what proves the store was rebuilt.
      expect(bridge.getIndexingState()).toEqual({ status: 'ready', symbolCount: 0, progress: 100 });
    });

    it('does not close a caller-supplied store', async () => {
      const seeded = await seedGraph();
      expect(seeded.bridge.isInitialized).toBe(true);

      seeded.bridge.dispose();

      // The store outlives the bridge: reading it after dispose still works.
      expect(seeded.store.getNodeCount()).toBe(6);
      seeded.bridge.dispose();
    });

    it('rebuilds its engines against a caller-supplied store when re-initialized', async () => {
      const seeded = await seedGraph();
      seeded.bridge.dispose();
      await seeded.bridge.initialize();

      // The graph survived, and the rebuilt search index still sees it.
      expect(seeded.store.getNodeCount()).toBe(6);
      expect(await seeded.bridge.search('Alpha')).toHaveLength(2);
      seeded.bridge.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // Project Management
  // -------------------------------------------------------------------------

  describe('project management', () => {
    it('returns null projectId by default', () => {
      expect(bridge.getProjectId()).toBeNull();
    });

    it('sets and gets projectId', () => {
      bridge.setProjectId('my-awesome-project');
      expect(bridge.getProjectId()).toBe('my-awesome-project');
    });

    it('overwrites previous projectId', () => {
      bridge.setProjectId('project-a');
      bridge.setProjectId('project-b');
      expect(bridge.getProjectId()).toBe('project-b');
    });
  });

  // -------------------------------------------------------------------------
  // Queries against a populated graph
  // -------------------------------------------------------------------------

  describe('queries over a populated graph', () => {
    let seeded: SeededGraph;

    beforeEach(async () => {
      seeded = await seedGraph();
    });

    afterEach(() => {
      seeded.bridge.dispose();
    });

    it('search maps every hit to its name, path and label', async () => {
      expect(await seeded.bridge.search('Alpha')).toEqual([
        {
          name: 'AlphaService',
          qualifiedName: `${PROJECT}.AlphaService`,
          filePath: 'src/a.ts',
          label: 'Class',
        },
        {
          name: 'AlphaServiceTest',
          qualifiedName: `${PROJECT}.AlphaServiceTest`,
          filePath: 'src/a.test.ts',
          label: 'Function',
        },
      ]);
    });

    it('search returns nothing for a query that matches no document', async () => {
      expect(await seeded.bridge.search('')).toEqual([]);
    });

    it('search reports an empty path for a symbol the graph has no file for', async () => {
      expect(await seeded.bridge.search('BareSymbol')).toEqual([
        {
          name: 'BareSymbol',
          qualifiedName: `${PROJECT}.BareSymbol`,
          filePath: '',
          label: 'Class',
        },
      ]);
    });

    it('searchWithScores reports an empty path for a symbol the graph has no file for', async () => {
      const scored = await seeded.bridge.searchWithScores('BareSymbol');

      expect(scored.map((s) => ({ name: s.name, filePath: s.filePath }))).toEqual([
        { name: 'BareSymbol', filePath: '' },
      ]);
    });

    it('findRelatedSymbols reports an empty path for a symbol the graph has no file for', async () => {
      expect(await seeded.bridge.findRelatedSymbols('BareSymbol')).toEqual([
        { name: 'BareSymbol', qualifiedName: `${PROJECT}.BareSymbol`, filePath: '' },
      ]);
    });

    it('traceCallPath reports an empty path for a symbol the graph has no file for', async () => {
      expect(await seeded.bridge.traceCallPath(`${PROJECT}.BareSymbol`)).toEqual([
        { name: 'BareSymbol', qualifiedName: `${PROJECT}.BareSymbol`, filePath: '' },
      ]);
    });

    it('findCallees reports an empty path for a callee the graph has no file for', async () => {
      expect(await seeded.bridge.findCallees(`${PROJECT}.UnfiledCaller`)).toEqual([
        { name: 'BareSymbol', qualifiedName: `${PROJECT}.BareSymbol`, filePath: '' },
      ]);
    });

    it('findRelatedTests reports an empty path for a test the graph has no file for', async () => {
      expect(await seeded.bridge.findRelatedTests(`${PROJECT}.BareSymbol`)).toEqual([
        { name: 'UnfiledTest', qualifiedName: `${PROJECT}.UnfiledTest`, filePath: '' },
      ]);
    });

    it('listProjectSymbols lists every symbol with the identity it is queried by', async () => {
      expect(await seeded.bridge.listProjectSymbols()).toEqual([
        {
          name: 'AlphaService',
          qualifiedName: `${PROJECT}.AlphaService`,
          filePath: 'src/a.ts',
          label: 'Class',
        },
        {
          name: 'BetaService',
          qualifiedName: `${PROJECT}.BetaService`,
          filePath: 'src/b.ts',
          label: 'Class',
        },
        {
          name: 'AlphaServiceTest',
          qualifiedName: `${PROJECT}.AlphaServiceTest`,
          filePath: 'src/a.test.ts',
          label: 'Function',
        },
        {
          name: 'BareSymbol',
          qualifiedName: `${PROJECT}.BareSymbol`,
          filePath: '',
          label: 'Class',
        },
        {
          name: 'UnfiledCaller',
          qualifiedName: `${PROJECT}.UnfiledCaller`,
          filePath: '',
          label: 'Function',
        },
        {
          name: 'UnfiledTest',
          qualifiedName: `${PROJECT}.UnfiledTest`,
          filePath: '',
          label: 'Function',
        },
      ]);
    });

    it('listProjectSymbols stops at the requested limit', async () => {
      const page = await seeded.bridge.listProjectSymbols(2);

      // Without an explicit limit the store answers with its default page of 20,
      // so a caller cannot rely on getting the whole project back.
      expect(page.map((s) => s.name)).toEqual(['AlphaService', 'BetaService']);
    });

    it('listProjectSymbols is what makes a qualified-name requery resolve', async () => {
      const [first] = await seeded.bridge.listProjectSymbols(1);

      // The listing carries the graph-qualified name; the bare `name` does not
      // resolve, which is how every "browse the graph" surface came to be empty.
      expect(await seeded.bridge.getSymbolDetail(first!.qualifiedName)).toBeDefined();
      expect(await seeded.bridge.getSymbolDetail(first!.name)).toBeUndefined();
    });

    it('searchWithScores carries the engine relevance score through', async () => {
      const scored = await seeded.bridge.searchWithScores('Alpha');

      expect(scored.map((s) => ({ name: s.name, filePath: s.filePath, label: s.label }))).toEqual([
        { name: 'AlphaService', filePath: 'src/a.ts', label: 'Class' },
        { name: 'AlphaServiceTest', filePath: 'src/a.test.ts', label: 'Function' },
      ]);
      // The exact-ranked (shorter) document must score strictly higher, so the
      // mapping cannot be satisfied by a constant in place of combinedScore.
      expect(scored[0]!.relevanceScore).toBeGreaterThan(scored[1]!.relevanceScore);
    });

    it('findRelatedSymbols maps hits without a label', async () => {
      expect(await seeded.bridge.findRelatedSymbols('Alpha')).toEqual([
        { name: 'AlphaService', qualifiedName: `${PROJECT}.AlphaService`, filePath: 'src/a.ts' },
        {
          name: 'AlphaServiceTest',
          qualifiedName: `${PROJECT}.AlphaServiceTest`,
          filePath: 'src/a.test.ts',
        },
      ]);
    });

    it('findImplementations delegates to findRelatedSymbols', async () => {
      expect(await seeded.bridge.findImplementations('Alpha')).toEqual(
        await seeded.bridge.findRelatedSymbols('Alpha'),
      );
    });

    it('traceCallPath walks the call edges from the seed node', async () => {
      expect(await seeded.bridge.traceCallPath(`${PROJECT}.AlphaService`)).toEqual([
        { name: 'AlphaService', qualifiedName: `${PROJECT}.AlphaService`, filePath: 'src/a.ts' },
        { name: 'BetaService', qualifiedName: `${PROJECT}.BetaService`, filePath: 'src/b.ts' },
      ]);
    });

    it('findCallers delegates to traceCallPath', async () => {
      expect(await seeded.bridge.findCallers(`${PROJECT}.AlphaService`)).toEqual(
        await seeded.bridge.traceCallPath(`${PROJECT}.AlphaService`),
      );
    });

    it('findCallees follows the outgoing CALLS edges of a symbol', async () => {
      expect(await seeded.bridge.findCallees(`${PROJECT}.AlphaService`)).toEqual([
        { name: 'BetaService', qualifiedName: `${PROJECT}.BetaService`, filePath: 'src/b.ts' },
      ]);
    });

    it('findCallees is empty for a symbol that calls nothing', async () => {
      expect(await seeded.bridge.findCallees(`${PROJECT}.BetaService`)).toEqual([]);
    });

    it('findRelatedTests reports the tests that cover a symbol', async () => {
      expect(await seeded.bridge.findRelatedTests(`${PROJECT}.AlphaService`)).toEqual([
        {
          name: 'AlphaServiceTest',
          qualifiedName: `${PROJECT}.AlphaServiceTest`,
          filePath: 'src/a.test.ts',
        },
      ]);
    });

    it('getSymbolDetail returns the full symbol record', async () => {
      expect(await seeded.bridge.getSymbolDetail(`${PROJECT}.AlphaService`)).toEqual({
        name: 'AlphaService',
        qualifiedName: `${PROJECT}.AlphaService`,
        filePath: 'src/a.ts',
        signature: 'function AlphaService()',
        docstring: 'Documentation for AlphaService',
        label: 'Class',
        isExported: true,
      });
    });

    it('getSymbolDetail omits the optional fields the graph has no value for', async () => {
      const detail = await seeded.bridge.getSymbolDetail(`${PROJECT}.BareSymbol`);

      expect(detail).toEqual({
        name: 'BareSymbol',
        qualifiedName: `${PROJECT}.BareSymbol`,
        filePath: '',
        signature: undefined,
        docstring: undefined,
        label: 'Class',
        isExported: true,
      });
    });

    it('getComplexityMetrics reports the recorded complexity and the line span', async () => {
      expect(await seeded.bridge.getComplexityMetrics(`${PROJECT}.AlphaService`)).toEqual({
        cyclomaticComplexity: 5,
        linesOfCode: 10,
        parameterCount: 0,
        nestingDepth: 0,
      });
    });

    it('getComplexityMetrics reports zero lines when the graph has no line range', async () => {
      expect(await seeded.bridge.getComplexityMetrics(`${PROJECT}.BareSymbol`)).toEqual({
        cyclomaticComplexity: 0,
        linesOfCode: 0,
        parameterCount: 0,
        nestingDepth: 0,
      });
    });

    it('getIndexingState reports the graph size once initialized', async () => {
      expect(seeded.bridge.getIndexingState()).toEqual({
        status: 'ready',
        symbolCount: 6,
        progress: 100,
      });
    });

    it('reports the symbol count of an unqueried graph before initialize', async () => {
      const store = new InMemoryGraphStore();
      store.insertNode(makeNode('Solo', `${PROJECT}.Solo`));
      const idle = new EngineBridge({ store });

      expect(idle.getIndexingState()).toEqual({
        status: 'idle',
        symbolCount: 1,
        progress: 0,
      });

      idle.dispose();
    });

    it('incrementalReindex rebuilds the index and notifies listeners', async () => {
      let notified = 0;
      seeded.bridge.onIndexingComplete(() => {
        notified++;
      });

      await seeded.bridge.incrementalReindex(['src/a.ts']);

      expect(notified).toBe(1);
      expect(await seeded.bridge.search('Alpha')).toHaveLength(2);
    });
  });

  describe('queries before a project is selected', () => {
    it('returns empty results while no project id is set', async () => {
      const store = new InMemoryGraphStore();
      store.insertNode(makeNode('AlphaService', `${PROJECT}.AlphaService`));
      const unset = new EngineBridge({ store });
      await unset.initialize();

      expect(await unset.search('Alpha')).toEqual([]);
      expect(await unset.searchWithScores('Alpha')).toEqual([]);
      expect(await unset.getSymbolDetail(`${PROJECT}.AlphaService`)).toBeUndefined();
      expect(await unset.findCallees(`${PROJECT}.AlphaService`)).toEqual([]);
      expect(await unset.findRelatedTests(`${PROJECT}.AlphaService`)).toEqual([]);
      expect(await unset.listProjectSymbols()).toEqual([]);
      expect(await unset.getComplexityMetrics(`${PROJECT}.AlphaService`)).toEqual({
        cyclomaticComplexity: 0,
        linesOfCode: 0,
        parameterCount: 0,
        nestingDepth: 0,
      });

      unset.dispose();
    });

    it('incrementalReindex does nothing before initialize', async () => {
      let notified = 0;
      bridge.onIndexingComplete(() => {
        notified++;
      });

      await bridge.incrementalReindex(['src/a.ts']);

      expect(notified).toBe(0);
      expect(bridge.isInitialized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Standards
  // -------------------------------------------------------------------------

  describe('checkStandards', () => {
    it('reports the built-in TypeScript standard results', async () => {
      const results = await bridge.checkStandards('test.ts');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => typeof r.passed === 'boolean')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  describe('indexWorkspace', () => {
    it('initializes if not already initialized', async () => {
      expect(bridge.isInitialized).toBe(false);
      await bridge.indexWorkspace('/tmp/test-workspace');
      expect(bridge.isInitialized).toBe(true);
      expect(bridge.getProjectId()).toBe('/tmp/test-workspace');
    });

    it('does not re-initialize if already initialized', async () => {
      await bridge.initialize();
      await bridge.indexWorkspace('/tmp/another');
      expect(bridge.isInitialized).toBe(true);
      expect(bridge.getProjectId()).toBe('/tmp/another');
    });
  });

  describe('onIndexingComplete', () => {
    it('calls listeners when indexing completes', async () => {
      let called = false;
      bridge.onIndexingComplete(() => {
        called = true;
      });
      await bridge.indexWorkspace('/tmp/test');
      expect(called).toBe(true);
    });

    it('calls multiple listeners', async () => {
      let count = 0;
      bridge.onIndexingComplete(() => {
        count++;
      });
      bridge.onIndexingComplete(() => {
        count++;
      });
      await bridge.indexWorkspace('/tmp/test');
      expect(count).toBe(2);
    });

    it('does not call listeners when added after completion', async () => {
      await bridge.indexWorkspace('/tmp/test');
      let called = false;
      bridge.onIndexingComplete(() => {
        called = true;
      });
      expect(called).toBe(false);
    });

    it('publishes a ready state with the store symbol count', async () => {
      const states: Array<{ status: string; symbolCount: number; progress: number }> = [];
      bridge.onIndexingProgress((state) => states.push(state));

      await bridge.indexWorkspace('/tmp/test');

      expect(states).toEqual([{ status: 'ready', symbolCount: 0, progress: 100 }]);
    });
  });

  // -------------------------------------------------------------------------
  // Workspace-backed queries
  // -------------------------------------------------------------------------

  describe('workspace review', () => {
    it('reviews the working tree content of every changed file', async () => {
      const dir = createRepo({
        'src/gone.ts': 'export const gone = 1;\n',
        'src/keep.ts': 'export const keep = 1;\n',
        'src/long.ts': 'export function short() {\n  return 1;\n}\n',
      });
      writeFileSync(join(dir, 'src/long.ts'), longFunction('longOne', 60));
      unlinkSync(join(dir, 'src/gone.ts'));
      writeFileSync(join(dir, 'src/fresh.ts'), longFunction('freshOne', 60));
      run(dir, 'git add src/fresh.ts');

      const store = new InMemoryGraphStore();
      const reviewing = new EngineBridge({ workspaceRoot: dir, store });
      await reviewing.initialize();

      const comments = await reviewing.reviewWorkspace();

      // Heuristics need the real source: against a metadata stub they report
      // nothing at all, which is exactly what this guards against.
      expect(comments).toHaveLength(4);
      expect(comments[0]).toEqual({
        severity: 'medium',
        title: 'Long function: freshOne',
        path: 'src/fresh.ts',
        startLine: 1,
        endLine: 63,
        message: 'Long function: freshOne',
      });
      expect(comments.map((c) => c.title)).toContain('Missing return type annotation');
      expect(comments.every((c) => c.path.startsWith('src/'))).toBe(true);

      reviewing.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    it('classifies every kind of workspace change', async () => {
      const dir = createRepo({
        'src/gone.ts': 'export const gone = 1;\n',
        'src/long.ts': 'export function short() {\n  return 1;\n}\n',
      });
      writeFileSync(join(dir, 'src/long.ts'), longFunction('longOne', 60));
      unlinkSync(join(dir, 'src/gone.ts'));
      writeFileSync(join(dir, 'src/fresh.ts'), 'export const fresh = 1;\n');
      run(dir, 'git add src/fresh.ts');

      const changed = new EngineBridge({ workspaceRoot: dir, store: new InMemoryGraphStore() });
      await changed.initialize();

      const files = await changed.getChangedFiles();

      expect(Object.fromEntries(files.map((f) => [f.path, f.status]))).toEqual({
        'src/fresh.ts': 'added',
        'src/gone.ts': 'deleted',
        'src/long.ts': 'modified',
      });

      changed.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    it('falls back to the change metadata when the changed path is unreadable', async () => {
      const dir = createRepo({ 'link.ts': longFunction('viaLink', 60) });
      // A tracked file replaced by a broken symlink: git still reports a change,
      // but the path cannot be read, so there is no content to review.
      unlinkSync(join(dir, 'link.ts'));
      symlinkSync('/nonexistent/vscode-bridge-target.ts', join(dir, 'link.ts'));

      const store = new InMemoryGraphStore();
      const broken = new EngineBridge({ workspaceRoot: dir, store });
      await broken.initialize();

      expect(await broken.reviewWorkspace()).toEqual([]);
      const files = await broken.getChangedFiles();
      expect(files.map((f) => f.status).sort()).toEqual(['added', 'deleted']);

      broken.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    it('skips a deleted file rather than reviewing its change metadata', async () => {
      // The path is deliberately one the fallback stub would itself trip: the
      // stub embeds `diff.filePath`, and the missing-error-handling heuristic
      // matches `.readFile`. So if a deleted file were still read — and thereby
      // fell through to the stub — this review would report a finding against a
      // file that no longer exists, which is also how the short-circuit on
      // `changeType === 'deleted'` stays observable at all.
      const dir = createRepo({ 'src/probe.readFile.ts': longFunction('probe', 60) });
      unlinkSync(join(dir, 'src/probe.readFile.ts'));

      const store = new InMemoryGraphStore();
      const deleting = new EngineBridge({ workspaceRoot: dir, store });
      await deleting.initialize();

      // The deletion is the change under review, so the diff is not empty.
      expect((await deleting.getChangedFiles()).map((f) => f.path)).toEqual([
        'src/probe.readFile.ts',
      ]);
      expect(await deleting.reviewWorkspace()).toEqual([]);

      deleting.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    it('treats an empty workspace root as no workspace', async () => {
      bridge.setProjectId('test-project');

      expect(await bridge.reviewWorkspace()).toEqual([]);
      expect(await bridge.getChangedFiles()).toEqual([]);
      expect(await bridge.detectChanges()).toEqual([]);
    });

    it('reviews nothing when the working tree has no changes', async () => {
      const dir = createRepo({ 'src/keep.ts': 'export const keep = 1;\n' });

      const store = new InMemoryGraphStore();
      const clean = new EngineBridge({ workspaceRoot: dir, store });
      await clean.initialize();

      // No diff means no file to read, so the graph is never touched — reading it
      // would throw once the store is closed.
      expect(await clean.reviewWorkspace()).toEqual([]);

      clean.dispose();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('change detection and impact', () => {
    it('maps a modified region onto the symbol that occupies it', async () => {
      const dir = createRepo({ 'src/svc.ts': 'export function alpha() {\n  return 1;\n}\n' });
      writeFileSync(
        join(dir, 'src/svc.ts'),
        'export function alpha() {\n  const x = 2;\n  return x;\n}\n',
      );

      const store = new InMemoryGraphStore();
      const alpha = store.insertNode(
        makeNode('alpha', `${PROJECT}.alpha`, { filePath: 'src/svc.ts', startLine: 1, endLine: 3 }),
      );
      const caller = store.insertNode(
        makeNode('caller', `${PROJECT}.caller`, {
          filePath: 'src/other.ts',
          startLine: 1,
          endLine: 5,
        }),
      );
      insertEdge(store, caller, alpha, 'CALLS');

      const impacted = new EngineBridge({ workspaceRoot: dir, store });
      await impacted.initialize();
      impacted.setProjectId(PROJECT);

      // A caller raises the risk, so the edge has to have been consulted.
      expect(await impacted.detectChanges()).toEqual([
        { name: 'alpha', qualifiedName: `${PROJECT}.alpha`, riskLevel: 'medium' },
      ]);

      // Resolution goes through the qualified name: the impact tree is empty
      // when the changed symbol cannot be resolved in the graph.
      expect(await impacted.analyzeImpact('alpha')).toEqual({
        riskLevel: 'low',
        affectedSymbols: 1,
      });

      impacted.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    it('reports low risk when a diff touches no known symbol', async () => {
      const dir = createRepo({ 'src/svc.ts': 'export const a = 1;\n' });
      writeFileSync(join(dir, 'src/svc.ts'), 'export const a = 2;\n');

      const store = new InMemoryGraphStore();
      store.insertNode(
        makeNode('unrelated', `${PROJECT}.unrelated`, {
          filePath: 'src/elsewhere.ts',
          startLine: 1,
          endLine: 2,
        }),
      );

      const untouched = new EngineBridge({ workspaceRoot: dir, store });
      await untouched.initialize();
      untouched.setProjectId(PROJECT);

      expect(await untouched.detectChanges()).toEqual([]);
      expect(await untouched.analyzeImpact('unrelated')).toEqual({
        riskLevel: 'low',
        affectedSymbols: 0,
      });

      untouched.dispose();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy expectations kept from the pre-seam suite
  // -------------------------------------------------------------------------

  describe('legacy empty-result expectations', () => {
    it('returns empty array when no project ID is set', async () => {
      expect(await bridge.search('anything')).toEqual([]);
      expect(await bridge.traceCallPath('anything')).toEqual([]);
      expect(await bridge.findRelatedSymbols('anything')).toEqual([]);
      expect(await bridge.findImplementations('anything')).toEqual([]);
      expect(await bridge.findCallers('anything')).toEqual([]);
      expect(await bridge.detectChanges()).toEqual([]);
    });

    it('returns low risk with 0 symbols when no project ID', async () => {
      expect(await bridge.analyzeImpact('anything')).toEqual({
        riskLevel: 'low',
        affectedSymbols: 0,
      });
    });

    it('returns empty array for a symbol the graph does not know', async () => {
      bridge.setProjectId('test');
      await bridge.initialize();

      expect(await bridge.traceCallPath('nonexistent.Symbol')).toEqual([]);
      expect(await bridge.getSymbolDetail('nonexistent.Symbol')).toBeUndefined();
    });
  });
});
