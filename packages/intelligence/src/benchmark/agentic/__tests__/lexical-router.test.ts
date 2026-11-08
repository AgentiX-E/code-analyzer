/**
 * @fileoverview The lexical arm, tested as a baseline rather than as a product.
 *
 * **What matters about a null is that it is strong enough to be worth beating and dull enough to be reproducible.** So
 * these cases check that it splits a tool name the way a person would read it, that it actually wins the easy tasks (a
 * baseline that lost everything would make the model's number look better than it is), and that two runs rank
 * identically — a resampled null would make the paired test nonsense.
 */

import { describe, expect, it } from 'vitest';

import { catalogDocuments, rankTools, tokenise } from '../lexical-router.js';

import type { ToolDefinition } from '../../../review/llm/provider.js';

const catalog: ToolDefinition[] = [
  {
    name: 'tests_for',
    description: 'Find the tests that cover a symbol',
    parameters: { properties: { symbol: { type: 'string' } } },
  },
  {
    name: 'test_generation',
    description: 'Generate test skeletons for functions and methods',
    parameters: { properties: { symbolName: { type: 'string' } } },
  },
  {
    name: 'find_dead_code',
    description: 'Find symbols that can never run',
    parameters: { properties: { projectId: { type: 'string' } } },
  },
  {
    name: 'hotspot_detection',
    description: 'Identify code hotspots with high structural complexity',
    parameters: { properties: { projectId: { type: 'string' } } },
  },
  {
    name: 'search_code',
    description: 'Search source code using full-text search',
    parameters: { properties: { query: { type: 'string' } } },
  },
];

describe('tokenising a tool name', () => {
  it('**splits snake_case into the words a person reads**', () => {
    expect(tokenise('find_dead_code')).toEqual(['find', 'dead', 'code']);
  });

  it('**splits camelCase the same way**', () => {
    expect(tokenise('searchGraphQuery')).toEqual(['search', 'graph', 'query']);
  });

  it('**drops single letters, which match everything and mean nothing**', () => {
    expect(tokenise('a b cd')).toEqual(['cd']);
  });
});

describe('ranking the catalog for a sentence', () => {
  const documents = catalogDocuments(catalog);

  it('**puts the tool that answers the easy version of a question first**', () => {
    // If the null could not do this, it would not be a floor - it would be a straw man.
    expect(rankTools('find dead code', documents)[0]?.name).toBe('find_dead_code');
  });

  it('**leaves the hard version to the model, which is the claim being tested**', () => {
    // "unused" appears nowhere in the description; "can never run" is what the description says. A lexical router can
    // only match the word, and this is the task class the measurement is about.
    const ranked = rankTools('what is unused in this project', documents);
    expect(ranked[0]?.name).not.toBe('find_dead_code');
  });

  it('**ranks identically twice, because the paired test needs one decision per task**', () => {
    const once = rankTools('which tests exercise HybridSearchEngine', documents);
    const twice = rankTools('which tests exercise HybridSearchEngine', documents);
    expect(twice).toEqual(once);
  });

  it('**returns every tool, ordered, so the top-k is readable at any k**', () => {
    const ranked = rankTools('hotspots', documents);
    expect(ranked).toHaveLength(catalog.length);
    expect(ranked[0]?.name).toBe('hotspot_detection');
  });

  it('**ranks nothing over an empty catalog instead of dividing by zero**', () => {
    expect(rankTools('find dead code', [])).toEqual([]);
  });

  it('**scores zero for a sentence that shares no token with the catalog**', () => {
    const ranked = rankTools('cancel my subscription', documents);
    expect(ranked.every((entry) => entry.score === 0)).toBe(true);
    // Every tool ties at zero, so the tie-break is the name - deterministic, and visibly arbitrary.
    expect(ranked[0]?.name).toBe([...catalog.map((tool) => tool.name)].sort()[0]);
  });
});
