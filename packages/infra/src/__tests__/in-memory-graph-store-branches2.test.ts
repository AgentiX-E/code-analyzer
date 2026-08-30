// @code-analyzer/infra — InMemoryGraphStore Branch Coverage (Part 2)
// Exercises the remaining reachable branches of the in-memory store that the
// primary suites do not hit: deleteNode with a null qualified name, queryNodes
// pattern/label/filter mismatches on the full-scan fallback path, multi-edge
// index removal, cross-project edge filtering, decorator rank that does not
// improve the best rank, and optimize() with a null qualified name.

import { describe, it, expect } from 'vitest';
import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import { createTestNode, createTestEdge } from './helpers.js';

function dropProjectIndex(store: InMemoryGraphStore, projectId: string): void {
  (store as any).projectNodesIndex.delete(projectId);
}

describe('InMemoryGraphStore — deleteNode null qualified name', () => {
  it('removes a node whose qualified name is null', () => {
    const store = new InMemoryGraphStore();
    const id = store.insertNode(createTestNode({ qualifiedName: null }));
    expect(store.getNode(id)).not.toBeNull();
    store.deleteNode(id);
    expect(store.getNode(id)).toBeNull();
  });
});

describe('InMemoryGraphStore — queryNodes pattern mismatches', () => {
  it('skips nodes that do not match the qualified-name pattern', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ qualifiedName: 'pkg.Alpha' }));
    const result = store.queryNodes({ projectId: 'test-project', qualifiedNamePattern: 'nomatch' });
    expect(result.total).toBe(0);
  });
});

describe('InMemoryGraphStore — full-scan fallback with filters', () => {
  it('filters by a single label on the fallback path', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ label: 'Function', qualifiedName: 'pkg.A' }));
    store.insertNode(createTestNode({ label: 'Class', qualifiedName: 'pkg.B' }));
    dropProjectIndex(store, 'test-project');

    const onlyFunctions = store.queryNodes({ projectId: 'test-project', label: 'Function' });
    expect(onlyFunctions.total).toBe(1);
    expect(onlyFunctions.items[0]!.label).toBe('Function');
  });

  it('filters by an array of labels (union) on the fallback path', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ label: 'Function', qualifiedName: 'pkg.A' }));
    store.insertNode(createTestNode({ label: 'Interface', qualifiedName: 'pkg.B' }));
    dropProjectIndex(store, 'test-project');

    const result = store.queryNodes({
      projectId: 'test-project',
      label: ['Function', 'Interface'],
    });
    expect(result.total).toBe(2);
  });

  it('excludes a node whose label is not in the requested set', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ label: 'Function', qualifiedName: 'pkg.A' }));
    dropProjectIndex(store, 'test-project');

    const result = store.queryNodes({ projectId: 'test-project', label: ['Class'] });
    expect(result.total).toBe(0);
  });

  it('filters by name pattern on the fallback path', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ name: 'alpha', qualifiedName: 'pkg.alpha' }));
    dropProjectIndex(store, 'test-project');

    expect(store.queryNodes({ projectId: 'test-project', namePattern: 'nomatch' }).total).toBe(0);
  });

  it('filters by file pattern on the fallback path', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ filePath: 'src/alpha.ts', qualifiedName: 'pkg.alpha' }));
    store.insertNode(createTestNode({ filePath: null, qualifiedName: 'pkg.nullpath' }));
    dropProjectIndex(store, 'test-project');

    // Regex no-match and null filePath both fall through to `continue`.
    expect(store.queryNodes({ projectId: 'test-project', filePattern: 'nomatch' }).total).toBe(0);
    expect(store.queryNodes({ projectId: 'test-project', filePattern: 'src/*' }).total).toBe(1);
  });
});

describe('InMemoryGraphStore — multi-edge index removal', () => {
  it('keeps the project and type indexes when removing one of several edges', () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(createTestNode({ qualifiedName: 'pkg.A' }));
    const b = store.insertNode(createTestNode({ qualifiedName: 'pkg.B' }));
    const c = store.insertNode(createTestNode({ qualifiedName: 'pkg.C' }));
    const e1 = store.insertEdge(createTestEdge({ sourceId: a, targetId: b }));
    const e2 = store.insertEdge(createTestEdge({ sourceId: b, targetId: c }));

    store.deleteEdge(e1);

    // e2 remains, so the project and CALLS type indexes must still hold it.
    const remaining = store.queryEdges({ projectId: 'test-project' });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0]!.id).toBe(e2);
  });
});

describe('InMemoryGraphStore — queryEdges cross-project filtering', () => {
  it('excludes an edge whose project differs from the query for source and target', () => {
    const store = new InMemoryGraphStore();
    const a = store.insertNode(createTestNode({ projectId: 'p1', qualifiedName: 'p1.A' }));
    const b = store.insertNode(createTestNode({ projectId: 'p1', qualifiedName: 'p1.B' }));
    // The edge is stored in project p2 while its endpoints belong to p1.
    store.insertEdge(createTestEdge({ projectId: 'p2', sourceId: a, targetId: b }));

    const bySource = store.queryEdges({ projectId: 'p1', sourceId: a });
    expect(bySource.total).toBe(0);

    const byTarget = store.queryEdges({ projectId: 'p1', targetId: b });
    expect(byTarget.total).toBe(0);

    const byType = store.queryEdges({ projectId: 'p1', type: 'CALLS' });
    expect(byType.total).toBe(0);
  });
});

describe('InMemoryGraphStore — searchFts decorator rank not improving', () => {
  it('does not replace a higher name rank with the decorator rank', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      createTestNode({
        name: 'componentService',
        qualifiedName: 'pkg.componentService',
        properties: { name: 'componentService', decorators: ['@Component'] },
      }),
    );

    const results = store.searchFts('component');
    // The node matches by name (rank 10) and decorator (rank 1); the decorator
    // rank does not outrank the name rank.
    expect(results.length).toBe(1);
    expect(results[0]!.matchedColumn).toBe('name');
  });
});

describe('InMemoryGraphStore — optimize with null qualified name', () => {
  it('rebuilds indexes and skips the qualified-name index for null qnames', () => {
    const store = new InMemoryGraphStore();
    store.insertNode(createTestNode({ qualifiedName: null }));
    store.insertNode(createTestNode({ qualifiedName: 'pkg.Real' }));

    store.optimize();

    expect(store.getNodeByQualifiedName('pkg.Real')).not.toBeNull();
    expect(store.getNodeByQualifiedName('missing')).toBeNull();
  });
});
