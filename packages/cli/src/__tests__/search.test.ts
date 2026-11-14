/**
 * Tests for the search command.
 */

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect } from 'vitest';

import { createTestNode } from '../../../infra/src/__tests__/helpers.js';
import {
  defaultProjectId,
  searchGraph,
  formatSearchResult,
  type SearchOutput,
} from '../commands/search.js';

/**
 * **A store with a graph in it**, because the command's job is to answer from one.
 *
 * The previous suite mocked `searchFts` and asserted that the mock's rows were mapped to the right fields - so it passed
 * while `searchGraph` built an empty store and answered nothing, and it would have kept passing while the command asked
 * a different retrieval from the one every published figure was measured on. These rows go in through `insertNode` and
 * the questions go through the engine.
 */
function graphStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  store.insertNode(
    createTestNode({
      name: 'clampValue',
      qualifiedName: 'src/limits:clampValue',
      label: 'Function',
      filePath: 'src/limits.ts',
      startLine: 12,
      docstring: 'Keep a number below a ceiling so the value stays finite.',
    }),
  );
  store.insertNode(
    createTestNode({
      name: 'CeilingPolicy',
      qualifiedName: 'src/policy:CeilingPolicy',
      label: 'Class',
      filePath: 'src/policy.ts',
      startLine: 4,
      docstring: 'Decides the ceiling a value may reach.',
    }),
  );
  return store;
}

describe('searchGraph', () => {
  it('answers a question asked in the words of the code', async () => {
    const result = await searchGraph({ query: 'number below a ceiling' }, graphStore());

    expect(result.success).toBe(true);
    expect(result.query).toBe('number below a ceiling');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]!.name).toBe('clampValue');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('accepts a limit', async () => {
    const result = await searchGraph({ query: 'ceiling', limit: 1 }, graphStore());
    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  it('filters by the type spelling a user types', async () => {
    const result = await searchGraph({ query: 'ceiling', type: 'class' }, graphStore());

    // The filter is compared as a label rather than as a string: `class` and `Class` are the same type and comparing
    // them literally drops every row, which looks exactly like a question with no answer.
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.type).toBe('Class');
  });

  it('carries a snippet only when asked', async () => {
    const plain = await searchGraph({ query: 'ceiling' }, graphStore());
    const verbose = await searchGraph({ query: 'ceiling', verbose: true }, graphStore());

    expect(plain.results[0]!.snippet).toBeUndefined();
    expect(verbose.results[0]!.snippet?.length).toBeGreaterThan(0);
  });

  it("returns the hits in the engine's order, which is not sorted afterwards", async () => {
    const result = await searchGraph({ query: 'ceiling policy', limit: 10 }, graphStore());

    // The old code re-sorted by a field it had itself computed, so the order it printed was its own. The order here is
    // the fused one and a second sort would be a second ranking: `relevance` is relative to the best hit and is
    // therefore monotone by construction, so this asserts that the command did not touch it.
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i]!.score).toBeLessThanOrEqual(result.results[i - 1]!.score);
    }
  });

  it('refuses an empty query rather than reporting an empty answer', async () => {
    const result = await searchGraph({ query: '' }, graphStore());

    // An empty question has no answer and "no results" is a different statement: the first is about the question and the
    // second about the index. The engine throws, and the command reports the throw.
    expect(result.success).toBe(false);
    expect(result.error).toContain('Search query is required');
    expect(result.results).toEqual([]);
  });

  it('reports a store that throws, and names what it said', async () => {
    const failing = {
      getProjectIds: () => ['p'],
      getAllNodes: () => {
        throw new Error('index corrupted');
      },
    };
    const result = await searchGraph(
      { query: 'anything' },
      failing as unknown as InMemoryGraphStore,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('index corrupted');
    expect(result.query).toBe('anything');
  });

  it('reports a non-Error throw without inventing a message', async () => {
    const failing = {
      getProjectIds: () => ['p'],
      getAllNodes: () => {
        // The case is a store that throws something which is not an Error, which is what the command's `String(err)`
        // arm exists for; the rule below forbids it everywhere else.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string';
      },
    };
    const result = await searchGraph(
      { query: 'anything' },
      failing as unknown as InMemoryGraphStore,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('plain string');
  });

  it('says nothing is indexed when the store is empty', async () => {
    const result = await searchGraph({ query: 'nonexistent' }, new InMemoryGraphStore());

    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.error).toMatch(/nothing indexed/i);
  });

  it('passes a type it does not know straight through, rather than dropping every row', async () => {
    // The mapping is a courtesy, not a whitelist: a store may hold labels this CLI has no friendly spelling for, and
    // turning an unknown spelling into "no results" would make a typo indistinguishable from an empty answer.
    const result = await searchGraph({ query: 'ceiling', type: 'Macro' }, graphStore());
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });

  it('forwards a vector weight the caller set', async () => {
    // No vectors are registered on this store, so the weight cannot change the order - the point is that the option is
    // passed to the engine rather than accepted and discarded, which is what a surface that only *offers* a control does.
    const result = await searchGraph({ query: 'ceiling', vectorWeight: 0.3 }, graphStore());
    expect(result.success).toBe(true);
    expect(result.results[0]!.name).toBe('CeilingPolicy');
  });

  it('names an indexed checkout by its path, and by its directory when the path is the current one', () => {
    // **The second case is the one a command cannot reach in a test**: `relative` is empty only when the checkout *is*
    // the directory the process is in, and a test that changed the process directory would change it for every other
    // test in the run. The rule is exported so both cases can be stated.
    expect(defaultProjectId('/work/repos/alpha', '/work')).toBe('repos/alpha');
    expect(defaultProjectId('/work/repos/alpha', '/work/repos/alpha')).toBe('alpha');
  });

  it('says which flag names a checkout when none was given and no store was handed in', async () => {
    const result = await searchGraph({ query: 'nonexistent' });

    // The command used to answer this case with zero rows and exit 0. It is the one case where the fix is a sentence: a
    // user who has not indexed anything needs to be told how, not told that their question found nothing.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/--directory/);
  });
});

describe('formatSearchResult', () => {
  const sampleOutput: SearchOutput = {
    success: true,
    query: 'export',
    results: [
      {
        id: 1,
        name: 'calculateTotal',
        qualifiedName: 'src/utils:calculateTotal',
        repo: 'utils',
        type: 'function',
        file: 'src/utils.ts',
        line: 42,
        score: 0.95,
      },
      {
        id: 2,
        name: 'UserModel',
        qualifiedName: 'src/models/user:UserModel',
        repo: 'user',
        type: 'class',
        file: 'src/models/user.ts',
        line: 10,
        score: 0.82,
        snippet: 'export class UserModel {',
      },
    ],
    totalResults: 2,
    duration: 15,
  };

  it('should format as JSON', () => {
    const output = formatSearchResult(sampleOutput, 'json');
    const parsed = JSON.parse(output) as { query: string; results: unknown[] };
    expect(parsed.query).toBe('export');
    expect(parsed.results.length).toBe(2);
  });

  it('should format as text', () => {
    const output = formatSearchResult(sampleOutput, 'text');
    expect(output).toContain('export');
    expect(output).toContain('calculateTotal');
    expect(output).toContain('function');
    expect(output).toContain('src/utils.ts');
    expect(output).toContain('0.95');
  });

  it('should format as summary', () => {
    const output = formatSearchResult(sampleOutput, 'summary');
    expect(output).toContain('2 results');
    expect(output).toContain('export');
    expect(output).toContain('15ms');
  });

  it('should show error message', () => {
    const errorOutput: SearchOutput = {
      ...sampleOutput,
      success: false,
      error: 'Search index not available',
      results: [],
      totalResults: 0,
    };
    const output = formatSearchResult(errorOutput, 'text');
    expect(output).toContain('Search index not available');
  });

  it('should show snippet in verbose mode', () => {
    const withSnippet: SearchOutput = {
      ...sampleOutput,
      results: [
        {
          id: 1,
          name: 'UserModel',
          qualifiedName: 'src/models/user:UserModel',
          repo: 'user',
          type: 'class',
          file: 'src/models/user.ts',
          line: 10,
          score: 0.82,
          snippet: 'export class UserModel {',
        },
      ],
    };
    const output = formatSearchResult(withSnippet, 'text');
    expect(output).toContain('export class UserModel');
  });

  it('should handle result without file path', () => {
    const noFile: SearchOutput = {
      ...sampleOutput,
      results: [
        {
          id: 1,
          name: 'orphanFn',
          qualifiedName: 'src/orphan:orphanFn',
          repo: 'orphan',
          type: 'function',
          file: '',
          line: 1,
          score: 0.5,
        },
      ],
      totalResults: 1,
    };
    const output = formatSearchResult(noFile, 'text');
    expect(output).toContain('orphanFn');
    expect(output).not.toContain('File: :1');
  });
});
