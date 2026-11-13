// A federated question is answered by what the answer *says*, not by whether a field contains one of its words.
//
// **The cross-repository search used to rank with `InMemoryGraphStore.searchFts`**, which asks of each term whether a
// lowercased field contains it, gives the node the weight of its best single match (name 10, qualified name 8,
// signature 5, docstring 3, path 2) and adds three per matched term. There is no term frequency, no inverse document
// frequency, no per-field weight and no length normalisation. On four released repositories that costs **173 of 447
// rewritten questions** at the top ten, against **358 for the field-weighted BM25 the product already owns** - and the
// loss is not uniform: it is the questions whose doc comment shares its words with neighbouring *names*, which in a
// repository of a few hundred declarations is most of them. A two-node fixture cannot reproduce a crowding effect and
// this file does not pretend to; it holds the shape of the answer in place, and `federated-search.ts` records the
// measurement.
//
// The eviction test below is the one that is about crowding: twelve functions that answer the question, one that
// answers it better, and a tenth place that only exists if the scope is applied before the cut.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { FederatedSearchEngine } from '../../cross-repo/federated-search.js';

import type { GraphNode } from '@code-analyzer/shared';

let nextId = 1;

function node(
  projectId: string,
  name: string,
  docstring: string | null,
  options: { filePath?: string; label?: GraphNode['label'] } = {},
): GraphNode {
  const filePath = options.filePath ?? `src/${name.toLowerCase()}.ts`;
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const id = nextId++;
  return {
    id,
    projectId,
    label: options.label ?? 'Function',
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, filePath, startLine: 1, endLine: 5, language: 'typescript' },
    signature: `function ${name}(): void`,
    docstring,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

function storeWith(nodes: GraphNode[]): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (const item of nodes) store.insertNode(item);
  return store;
}

/**
 * The question shares no word with the correct answer's *name*, and shares one word with the wrong answer's name.
 *
 * That asymmetry is the whole test: it is the shape of a real question, and it is the shape the containment channel
 * gets wrong.
 */
const QUESTION = 'How does the widget get painted onto the surface with the render backend?';

describe('a federated question is answered by what the answer says', () => {
  const correct = node(
    'repo-paint',
    'paintSurface',
    'Paints the widget onto the surface using the render backend and the current theme.',
  );
  const decoy = node('repo-store', 'widgetStore', 'Unrelated bookkeeping for the store.');

  it('is answered by the field-weighted BM25 and not by a name that shares one of its words', async () => {
    const store = storeWith([decoy, correct]);

    const engine = new FederatedSearchEngine(store);
    const result = await engine.search(QUESTION, { maxResults: 10 });
    expect(result.results[0]?.symbol).toBe('paintSurface');
    // The decoy's name is a match for the question's words and it is still not the answer: it is a result, ordered
    // below the declaration whose documentation answers the question.
    expect(result.results.map((hit) => hit.symbol)).toContain('widgetStore');
  });

  it('reports a relevance that is the answer relative to the best one', async () => {
    const engine = new FederatedSearchEngine(storeWith([decoy, correct]));
    const result = await engine.search(QUESTION, { maxResults: 10 });

    expect(result.results[0]?.relevance).toBe(1);
    for (let index = 1; index < result.results.length; index++) {
      expect(result.results[index]!.relevance).toBeLessThanOrEqual(
        result.results[index - 1]!.relevance,
      );
    }
  });

  it('carries the sentence that describes the hit, not the path it was found under', async () => {
    const engine = new FederatedSearchEngine(storeWith([decoy, correct]));
    const result = await engine.search(QUESTION, { maxResults: 10 });
    expect(result.results[0]?.snippet).toContain('Paints the widget onto the surface');
  });
});

describe('a scope is applied where the ranking is', () => {
  it('answers a scoped question from its own repository even when the open list was filled by another', async () => {
    // Twelve declarations that answer the question at least as well as the one we are looking for, all in one
    // repository, and one answer in a second repository that the open top ten cannot reach.
    const crowd = Array.from({ length: 12 }, (_, index) =>
      node(
        'repo-crowd',
        `paintSurfaceVariant${index}`,
        'Paints the widget onto the surface with the render backend.',
      ),
    );
    const wanted = node('repo-own', 'applyTheme', 'Paints the widget onto the surface.');

    const engine = new FederatedSearchEngine(storeWith([...crowd, wanted]));

    const open = await engine.search(QUESTION, { maxResults: 10 });
    expect(open.results.map((hit) => hit.repo)).not.toContain('repo-own');

    // **Filtering a page cannot find what the page never held.** The scope has to narrow the candidates, which is why
    // it is a parameter of the search rather than a loop over the results.
    const scoped = await engine.search(QUESTION, {
      maxResults: 10,
      repoFilter: ['repo-own'],
    });
    expect(scoped.results[0]?.symbol).toBe('applyTheme');
    expect(scoped.repoBreakdown['repo-own']).toBe(1);
  });
});

describe('the labels a federated question may answer with', () => {
  it('does not answer with a file node that contains the question’s words', async () => {
    const fileNode = node('repo-a', 'paint-surface', null, {
      label: 'File',
      filePath: 'src/paint-surface.ts',
    });
    const answer = node(
      'repo-a',
      'paint',
      'Paints the widget onto the surface with the render backend.',
    );

    const engine = new FederatedSearchEngine(storeWith([fileNode, answer]));
    const result = await engine.search(QUESTION, { maxResults: 10 });
    expect(result.results.map((hit) => hit.symbol)).not.toContain('paint-surface');
  });

  it('keeps answering with a declaration when the only thing that matches is its documentation', async () => {
    const answer = node(
      'repo-a',
      'paint',
      'Paints the widget onto the surface with the render backend and the theme.',
    );
    const engine = new FederatedSearchEngine(storeWith([answer]));
    const result = await engine.search(QUESTION, { maxResults: 10 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.symbol).toBe('paint');
  });
});
