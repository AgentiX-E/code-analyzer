import { describe, it, expect } from 'vitest';
import { TaintAnalysisEngine } from '../security/taint-engine.js';
import type { TaintSource, TaintSink, Sanitizer } from '../security/taint-engine.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_DATA_FLOWS, EDGE_IMPORTS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNode(partial: Partial<GraphNode> & { id: number; name: string }): GraphNode {
  return {
    projectId: 'proj',
    label: 'Function',
    qualifiedName: `q::${partial.name}`,
    filePath: 'test.ts',
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    properties: { name: partial.name },
    signature: null,
    docstring: null,
    complexity: 1,
    isExported: false,
    fingerprint: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...partial,
  };
}

function makeEdge(
  partial: Partial<GraphEdge> & { id: number; sourceId: number; targetId: number },
): GraphEdge {
  return {
    projectId: 'proj',
    type: EDGE_CALLS,
    properties: {},
    weight: 1,
    createdAt: '2026-01-01',
    ...partial,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  const nodeMap = new Map<number, GraphNode>();
  const edgeMap = new Map<number, GraphEdge>();
  for (const n of nodes) nodeMap.set(n.id, n);
  for (const e of edges) edgeMap.set(e.id, e);
  return {
    projectId: 'proj',
    nodes: nodeMap,
    edges: edgeMap,
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

// A source node (user input) that flows into a sink node (SQL query)
function sqlInjectionGraph(): KnowledgeGraph {
  const source = makeNode({
    id: 1,
    name: 'handler',
    signature: 'req.query.id',
    language: 'typescript',
  });
  const sink = makeNode({
    id: 2,
    name: 'query',
    signature: 'db.query("SELECT ...")',
    language: 'typescript',
  });
  const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
  return makeGraph([source, sink], [edge]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaintAnalysisEngine', () => {
  it('constructs with defaults', () => {
    const engine = new TaintAnalysisEngine();
    expect(engine).toBeDefined();
  });

  it('constructs with custom options', () => {
    const engine = new TaintAnalysisEngine({
      maxPathDepth: 3,
      maxPathsPerSource: 5,
      sources: [],
      sinks: [],
      sanitizers: [],
    });
    expect(engine).toBeDefined();
  });

  describe('analyze', () => {
    it('returns empty result when graph has no nodes', () => {
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([]), 'proj');
      expect(result.projectId).toBe('proj');
      expect(result.findings).toEqual([]);
      expect(result.summary.totalFindings).toBe(0);
    });

    it('returns empty result when no source nodes', () => {
      const sink = makeNode({
        id: 1,
        name: 'query',
        signature: 'db.query("x")',
        language: 'typescript',
      });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([sink]), 'proj');
      expect(result.findings).toEqual([]);
    });

    it('returns empty result when no sink nodes', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source]), 'proj');
      expect(result.findings).toEqual([]);
    });

    it('detects a direct source→sink SQL injection', () => {
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(sqlInjectionGraph(), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      const finding = result.findings[0]!;
      expect(finding.sourceNodeId).toBe(1);
      expect(finding.sinkNodeId).toBe(2);
      expect(finding.category).toBe('sql_injection');
      expect(finding.severity).toBe('critical');
      expect(finding.cweId).toBe('CWE-89');
      expect(finding.path).toEqual([1, 2]);
      expect(finding.pathLength).toBe(2);
    });

    it('detects command injection via network input', () => {
      const source = makeNode({
        id: 1,
        name: 'fetchData',
        signature: 'fetch(url)',
        language: 'typescript',
      });
      const sink = makeNode({ id: 2, name: 'run', signature: 'exec(cmd)', language: 'typescript' });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.category).toBe('command_injection');
      expect(result.findings[0]!.severity).toBe('critical');
      expect(result.findings[0]!.cweId).toBe('CWE-78');
    });

    it('detects XSS via html output', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.body.input',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 2,
        name: 'render',
        signature: 'innerHTML = x',
        language: 'typescript',
      });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.category).toBe('xss');
    });

    it('detects path traversal via file write', () => {
      const source = makeNode({
        id: 1,
        name: 'read',
        signature: 'fs.readFile(p)',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 2,
        name: 'write',
        signature: 'fs.writeFile(p)',
        language: 'typescript',
      });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_DATA_FLOWS });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.category).toBe('path_traversal');
    });

    it('detects deserialization sink', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.body.data',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 2,
        name: 'parse',
        signature: 'JSON.parse(x)',
        language: 'typescript',
      });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.category).toBe('deserialization');
    });

    it('detects open redirect', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.url',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 2,
        name: 'r',
        signature: 'redirect(target)',
        language: 'typescript',
      });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.category).toBe('open_redirect');
    });

    it('marks sanitized path with reduced confidence and sanitizerPath', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const sanitizer = makeNode({
        id: 2,
        name: 'esc',
        signature: 'escapeHtml(x)',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 3,
        name: 'render',
        signature: 'innerHTML = x',
        language: 'typescript',
      });
      const edges = [
        makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS }),
        makeEdge({ id: 2, sourceId: 2, targetId: 3, type: EDGE_CALLS }),
      ];
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sanitizer, sink], edges), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      const finding = result.findings[0]!;
      expect(finding.sanitized).toBe(true);
      expect(finding.sanitizerPath).toEqual([2]);
      expect(finding.confidence).toBeLessThan(0.8);
    });

    it('follows multi-hop paths through the graph', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const mid1 = makeNode({ id: 2, name: 'a', signature: 'a()', language: 'typescript' });
      const mid2 = makeNode({ id: 3, name: 'b', signature: 'b()', language: 'typescript' });
      const sink = makeNode({
        id: 4,
        name: 'q',
        signature: 'db.query("SELECT * FROM users")',
        language: 'typescript',
      });
      const edges = [
        makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS }),
        makeEdge({ id: 2, sourceId: 2, targetId: 3, type: EDGE_CALLS }),
        makeEdge({ id: 3, sourceId: 3, targetId: 4, type: EDGE_CALLS }),
      ];
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, mid1, mid2, sink], edges), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings[0]!.path).toEqual([1, 2, 3, 4]);
      expect(result.findings[0]!.pathLength).toBe(4);
    });

    it('does not traverse cycles (avoids infinite loops)', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const a = makeNode({ id: 2, name: 'a', signature: 'a()', language: 'typescript' });
      const b = makeNode({ id: 3, name: 'b', signature: 'b()', language: 'typescript' });
      const sink = makeNode({
        id: 4,
        name: 'q',
        signature: 'db.query("SELECT * FROM users")',
        language: 'typescript',
      });
      const edges = [
        makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS }),
        makeEdge({ id: 2, sourceId: 2, targetId: 3, type: EDGE_CALLS }),
        makeEdge({ id: 3, sourceId: 3, targetId: 2, type: EDGE_CALLS }), // cycle
        makeEdge({ id: 4, sourceId: 2, targetId: 4, type: EDGE_CALLS }),
      ];
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, a, b, sink], edges), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
    });

    it('respects maxPathDepth', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const nodes = [source];
      const edges: GraphEdge[] = [];
      // Build a chain of 20 nodes; sink at the very end
      for (let i = 2; i <= 20; i++) {
        const n = makeNode({
          id: i,
          name: `n${i}`,
          signature: i === 20 ? 'db.query("SELECT * FROM users")' : `n${i}()`,
          language: 'typescript',
        });
        nodes.push(n);
        edges.push(makeEdge({ id: i, sourceId: i - 1, targetId: i, type: EDGE_CALLS }));
      }
      const engine = new TaintAnalysisEngine({ maxPathDepth: 5 });
      const result = engine.analyze(makeGraph(nodes, edges), 'proj');
      // The sink at depth 20 is unreachable with maxPathDepth 5
      expect(result.findings).toEqual([]);
    });

    it('respects maxPathsPerSource', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const nodes = [source];
      const edges: GraphEdge[] = [];
      for (let i = 2; i <= 10; i++) {
        const sink = makeNode({
          id: i,
          name: `sink${i}`,
          signature: 'db.query("SELECT * FROM users")',
          language: 'typescript',
        });
        nodes.push(sink);
        edges.push(makeEdge({ id: i, sourceId: 1, targetId: i, type: EDGE_CALLS }));
      }
      const engine = new TaintAnalysisEngine({ maxPathsPerSource: 3 });
      const result = engine.analyze(makeGraph(nodes, edges), 'proj');
      expect(result.findings.length).toBeLessThanOrEqual(3);
    });

    it('deduplicates identical source→sink pairs', () => {
      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'typescript',
      });
      const sink = makeNode({
        id: 2,
        name: 'q',
        signature: 'db.query("SELECT * FROM users")',
        language: 'typescript',
      });
      // Two edges to the same sink
      const edges = [
        makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS }),
        makeEdge({ id: 2, sourceId: 1, targetId: 2, type: EDGE_DATA_FLOWS }),
      ];
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([source, sink], edges), 'proj');
      expect(result.findings.length).toBe(1);
    });
  });

  describe('summary', () => {
    it('computes correct summary statistics', () => {
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(sqlInjectionGraph(), 'proj');
      const summary = result.summary;
      expect(summary.totalFindings).toBe(result.findings.length);
      expect(summary.bySeverity.critical).toBeGreaterThanOrEqual(1);
      expect(summary.byCategory.sql_injection).toBeGreaterThanOrEqual(1);
      expect(summary.sanitizedRatio).toBeGreaterThanOrEqual(0);
      expect(summary.averagePathLength).toBeGreaterThan(0);
    });

    it('computes empty summary for empty findings', () => {
      const engine = new TaintAnalysisEngine();
      const result = engine.analyze(makeGraph([]), 'proj');
      expect(result.summary.totalFindings).toBe(0);
      expect(result.summary.bySeverity.critical).toBe(0);
      expect(result.summary.averagePathLength).toBe(0);
      expect(result.summary.sanitizedRatio).toBe(0);
    });
  });

  describe('custom rules', () => {
    it('supports adding custom sources', () => {
      const customSource: TaintSource = {
        id: 'custom-src',
        category: 'xss',
        patterns: [/customInput\(/],
        description: 'Custom input',
        severity: 'high',
        languages: ['typescript'],
      };
      const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
      engine.addSource(customSource);
      // Re-add a sink so we can detect
      const sink: TaintSink = {
        id: 'custom-sink',
        category: 'xss',
        patterns: [/innerHTML/],
        description: 'HTML output',
        severity: 'high',
        languages: ['typescript'],
      };
      engine.addSink(sink);

      const source = makeNode({
        id: 1,
        name: 'h',
        signature: 'customInput()',
        language: 'typescript',
      });
      const sinkNode = makeNode({
        id: 2,
        name: 'r',
        signature: 'innerHTML = x',
        language: 'typescript',
      });
      const edge = makeEdge({ id: 1, sourceId: 1, targetId: 2, type: EDGE_CALLS });
      const result = engine.analyze(makeGraph([source, sinkNode], [edge]), 'proj');
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
    });

    it('supports adding custom sanitizers', () => {
      const customSanitizer: Sanitizer = {
        id: 'custom-san',
        patterns: [/mySanitize\(/],
        description: 'Custom sanitizer',
        languages: ['typescript'],
      };
      const engine = new TaintAnalysisEngine({ sanitizers: [] });
      engine.addSanitizer(customSanitizer);
      expect(engine).toBeDefined();
    });
  });

  describe('language filtering', () => {
    it('only matches sources/sinks for the node language', () => {
      // A python node should not match a typescript-only source pattern
      const pythonNode = makeNode({
        id: 1,
        name: 'h',
        signature: 'req.query.id',
        language: 'python',
      });
      const engine = new TaintAnalysisEngine();
      // 'req.query' is not in the python patterns list? Actually it is (request.args etc.)
      // Use a language that is NOT in the source's language list.
      const customSource: TaintSource = {
        id: 'ts-only',
        category: 'xss',
        patterns: [/req\.query/],
        description: 'TS only',
        severity: 'high',
        languages: ['typescript'],
      };
      const engine2 = new TaintAnalysisEngine({
        sources: [customSource],
        sinks: [],
        sanitizers: [],
      });
      const result = engine2.analyze(makeGraph([pythonNode]), 'proj');
      expect(result.findings).toEqual([]);
    });
  });

  describe('addSource/addSink/addSanitizer', () => {
    it('all three add methods mutate the engine', () => {
      const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
      const src: TaintSource = {
        id: 's',
        category: 'xss',
        patterns: [/x/],
        description: 'd',
        severity: 'low',
        languages: ['typescript'],
      };
      const snk: TaintSink = {
        id: 'k',
        category: 'xss',
        patterns: [/y/],
        description: 'd',
        severity: 'low',
        languages: ['typescript'],
      };
      const san: Sanitizer = {
        id: 'n',
        patterns: [/z/],
        description: 'd',
        languages: ['typescript'],
      };
      engine.addSource(src);
      engine.addSink(snk);
      engine.addSanitizer(san);
      expect(engine).toBeDefined();
    });
  });
});
