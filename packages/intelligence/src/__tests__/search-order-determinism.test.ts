// The same query, on two machines, in the same order.
//
// **What this file is about.** The published `docstring-search.json` carried `lexical.mrr = 0.9856` on the machine that
// produced it and `0.9815` on a GitHub runner, from the same commit, the same corpus and the same code. The score of a
// document is arithmetic over its own text, so the only thing that can differ is **the order of equal scores**: every
// ranking function in this package sorted by score alone, `Array.prototype.sort` is stable, and the input order is
// whatever the directory walk produced. **A figure that depends on the filesystem's `readdir` order is not a
// measurement**, and the evaluation workflow caught it only because it compares a fresh run against the committed file.
//
// **The rule these tests state.** A tie is broken by the node's own name — qualified name, then file path, then line —
// so the order is a property of the corpus rather than of the machine that walked it. id is the last resort and not the
// first, because ids are assigned in insertion order and therefore carry the same machine dependence the tie-break is
// there to remove.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  HybridSearchEngine,
  compareNodeIdentity,
  sortByScoreThenIdentity,
  sortByScoreThenKey,
} from '@code-analyzer/intelligence';
import { describe, expect, it } from 'vitest';

import type { GraphNode } from '@code-analyzer/shared';

/** A node whose text is identical to every other node's, so every BM25 score ties exactly. */
function tiedNode(index: number): { name: string; qualifiedName: string; filePath: string } {
  return {
    name: 'processWidget',
    // Distinct qualified names, identical tokens: `mod0` and `mod1` tokenise to `mod0`/`mod1` plus `processwidget`, so
    // the query below matches both equally and the scores are equal to the last bit.
    qualifiedName: `mod${String(index).padStart(2, '0')}.processWidget`,
    filePath: `src/mod${String(index).padStart(2, '0')}.ts`,
  };
}

function storeWith(order: readonly number[]): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (const index of order) {
    const spec = tiedNode(index);
    store.insertNode({
      projectId: 'p',
      label: 'Function',
      name: spec.name,
      qualifiedName: spec.qualifiedName,
      filePath: spec.filePath,
      startLine: 1,
      endLine: 2,
      language: 'typescript',
      signature: 'function processWidget()',
      docstring: null,
      complexity: 1,
      isExported: true,
      properties: {},
    });
  }
  return store;
}

describe('search order is a property of the corpus, not of the walk', () => {
  it('ranks a tie by name, so two ingestion orders answer identically', async () => {
    const forward = new HybridSearchEngine(storeWith([0, 1, 2, 3, 4, 5]));
    const reverse = new HybridSearchEngine(storeWith([5, 4, 3, 2, 1, 0]));

    const a = await forward.search({ query: 'processWidget', limit: 10 });
    const b = await reverse.search({ query: 'processWidget', limit: 10 });

    // **The lexical list is where the tie actually lives.** Fusion assigns `1/(k + rank + 1)`, so a fused list can
    // never tie with itself — the fused order is the lexical order, which is exactly why the lexical order has to be a
    // property of the corpus. Both assertions are therefore made against `bm25Search`.
    const lexicalA = forward.bm25Search('processWidget');
    const lexicalB = reverse.bm25Search('processWidget');
    expect(lexicalA.every((result) => result.score === lexicalA[0]!.score)).toBe(true);
    expect(lexicalA.map((result) => result.node.qualifiedName)).toEqual(
      lexicalB.map((result) => result.node.qualifiedName),
    );
    expect(a.map((result) => result.node.qualifiedName)).toEqual(
      b.map((result) => result.node.qualifiedName),
    );
    // And the order is stated rather than merely agreed: ascending by qualified name.
    expect(a.map((result) => result.node.qualifiedName)).toEqual([
      'mod00.processWidget',
      'mod01.processWidget',
      'mod02.processWidget',
      'mod03.processWidget',
      'mod04.processWidget',
      'mod05.processWidget',
    ]);
  });

  it('still puts a better score first, so the tie-break did not replace the ranking', async () => {
    const store = storeWith([0, 1]);
    // A third node that is an exact name match, which the index boosts.
    store.insertNode({
      projectId: 'p',
      label: 'Function',
      name: 'unique',
      qualifiedName: 'zzz.unique',
      filePath: 'src/zzz.ts',
      startLine: 1,
      endLine: 2,
      language: 'typescript',
      signature: 'function unique()',
      docstring: null,
      complexity: 1,
      isExported: true,
      properties: {},
    });
    const engine = new HybridSearchEngine(store);
    const ranked = await engine.search({ query: 'unique', limit: 10 });
    // `zzz.unique` sorts last by identity and first by score: the score wins.
    expect(ranked[0]!.node.qualifiedName).toBe('zzz.unique');
  });

  it('breaks a fused-score tie by identity rather than by which list arrived first', () => {
    const nodes = [0, 1, 2].map((index) => {
      const spec = tiedNode(index);
      return { id: 100 - index, qualifiedName: spec.qualifiedName } as unknown as GraphNode;
    });
    // Deliberately handed over in descending identity order, all with the same combined score.
    const input = [...nodes].reverse().map((node) => ({
      node,
      bm25Score: 1,
      vectorScore: 0,
      combinedScore: 1 / 61,
    }));

    const sorted = sortByScoreThenIdentity(input, (result) => result.combinedScore);
    expect(sorted.map((result) => result.node.qualifiedName)).toEqual([
      'mod00.processWidget',
      'mod01.processWidget',
      'mod02.processWidget',
    ]);
  });

  it('falls through its key levels in a stated order, each one reachable', () => {
    const node = (overrides: Partial<GraphNode>): GraphNode =>
      ({
        id: 1,
        qualifiedName: 'a.b',
        filePath: 'src/a.ts',
        startLine: 1,
        name: 'b',
        ...overrides,
      }) as GraphNode;

    // Each assertion isolates one level: the fields before it are equal, the field at it differs.
    expect(
      compareNodeIdentity(node({ qualifiedName: 'a.b' }), node({ qualifiedName: 'a.c' })),
    ).toBeLessThan(0);
    expect(
      compareNodeIdentity(node({ filePath: 'src/a.ts' }), node({ filePath: 'src/b.ts' })),
    ).toBeLessThan(0);
    expect(compareNodeIdentity(node({ startLine: 1 }), node({ startLine: 2 }))).toBeLessThan(0);
    expect(compareNodeIdentity(node({ name: 'b' }), node({ name: 'c' }))).toBeLessThan(0);
    expect(compareNodeIdentity(node({ id: 1 }), node({ id: 2 }))).toBeLessThan(0);
    // A node with no path or line is ordered by what it does have rather than throwing.
    expect(
      compareNodeIdentity(
        node({ filePath: null, startLine: null }),
        node({ filePath: null, startLine: null }),
      ),
    ).toBe(0);
  });

  it('orders by a caller-supplied key too, for the search paths that carry no graph node', () => {
    // `MultiSignalSearch` and the flow-path list rank documents that have an id and nothing else, so they supply the key.
    const items = [
      { id: 'b', score: 1 },
      { id: 'a', score: 1 },
      { id: 'c', score: 2 },
    ];
    const sorted = sortByScoreThenKey(
      items,
      (item) => item.score,
      (item) => item.id,
    );
    expect(sorted.map((item) => item.id)).toEqual(['c', 'a', 'b']);

    // And a genuinely better score still wins over a key that would have come first.
    const better = sortByScoreThenKey(
      [
        { id: 'a', score: 1 },
        { id: 'z', score: 3 },
      ],
      (item) => item.score,
      (item) => item.id,
    );
    expect(better.map((item) => item.id)).toEqual(['z', 'a']);
  });

  it('compares by code unit, so the order does not depend on the locale of the machine', () => {
    const make = (qualifiedName: string, id: number): { node: GraphNode; score: number } => ({
      node: { id, qualifiedName } as unknown as GraphNode,
      score: 1,
    });
    // `Z` sorts before `a` in code-unit order and after it under a locale collation; the expected order below is the
    // code-unit one, which is the same on every machine.
    const sorted = sortByScoreThenIdentity(
      [make('a.b', 1), make('Z.b', 2)],
      (result) => result.score,
    );
    expect(sorted.map((result) => result.node.qualifiedName)).toEqual(['Z.b', 'a.b']);
  });
});
