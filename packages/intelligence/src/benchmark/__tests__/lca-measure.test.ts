// One instance of the bug-localisation measurement, exercised on a real checkout.
//
// **What this file is for.** `scripts/lca-instance.ts` runs in a child process the runner may kill, so the arithmetic
// inside `measureInstance` would otherwise have no test that could reach it without a corpus and network - and the
// figure it produces is the one the gate judges. The fixture here is a small Python repository on disk, analysed by
// the real pipeline, asked a real question: nothing about the retriever is simulated, because the retriever is what
// this module is a measurement of.
//
// **The three things a row can get wrong** are the three cases below, and each one published a wrong figure once:
// a path in the wrong coordinate system (0.0000 on every instance), a ranking restricted in a way that reordered it,
// and an answer arm that ran without a model and reported an empty set as a model that cited nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterAll, describe, expect, it } from 'vitest';

import { FILE_AGGREGATION } from '../../search/file-ranking.js';
import { MAP_DEPTH, insertGraph, measureInstance } from '../lca-measure.js';

import type { LLMProvider } from '../../review/llm/provider.js';
import type { LcaCorpusRow } from '../lca-measure.js';
import type { GraphEdge, GraphNode } from '@code-analyzer/shared';

const SCRATCH = mkdtempSync(join(tmpdir(), 'lca-measure-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * A checkout whose answer is known: `retry.py` holds the retry loop, `http.py` writes the request, and `README.md`
 * sits in the directory and **outside the answer space**, which is what the `outside` column has to count.
 */
function checkout(): { root: string; allFiles: string[] } {
  const root = mkdtempSync(join(SCRATCH, 'repo-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'retry.py'),
    [
      'RETRIES = 3',
      '',
      '',
      'def send_with_retry(client, url):',
      '    """POST the url, retrying on a 503."""',
      '    for attempt in range(RETRIES):',
      '        response = client.post(url)',
      '        if response.status != 503:',
      '            return response',
      '    raise RuntimeError("retry budget exhausted")',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'http.py'),
    ['def post(url):', '    return {"status": 200, "url": url}', ''].join('\n'),
    'utf8',
  );
  writeFileSync(join(root, 'README.md'), '# a fixture\n', 'utf8');
  return { root, allFiles: ['src/http.py', 'src/retry.py'] };
}

/** The corpus row this fixture answers: an issue about retrying a request. */
function row(expected: string[]): LcaCorpusRow {
  return {
    id: 42,
    repo_owner: 'fixture',
    repo_name: 'retry',
    issue_title: 'Requests are not retried when the server answers 503',
    issue_body: 'send_with_retry gives up after the first attempt instead of retrying.',
    changed_files: expected,
  };
}

/**
 * A provider that cites the block whose path the question is about.
 *
 * **Not a mock of this project's code**: the provider is the boundary to a service no test can call, and the contract
 * under test is what this module does with a completion, not what a vendor's model would say. The citation format is
 * the prompt's own - `[n]`, where `n` is the block number - so the answer is read by the same `verifyCitations` path a
 * real completion goes through, rather than by a shortcut written for the test.
 */
function citingProvider(file: string): LLMProvider {
  const answerFor = (prompt: string): string => {
    // **`undefined` and not `null`**: `find` answers `undefined` when nothing matches, and the first version of this
    // line tested `=== null`, so a prompt with no matching block would have cited block `1` and passed anyway. The
    // typecheck caught it; the test could not, because the fixture's prompt always has the block.
    const line = prompt.split('\n').find((candidate) => candidate.includes(`— ${file}`));
    const id = line === undefined ? '1' : (/^\[(\d+)\]/.exec(line)?.[1] ?? '1');
    return `The retry loop is declared in \`${file}\` [${id}].`;
  };
  return {
    name: 'fixture',
    model: 'fixture-1',
    complete: (prompt: string) =>
      Promise.resolve({
        content: answerFor(prompt),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: 'fixture-1',
      } as never),
    completeWithTools: (prompt: string) =>
      Promise.resolve({
        content: answerFor(prompt),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: 'fixture-1',
      } as never),
    healthCheck: () => Promise.resolve(true),
    listModels: () => Promise.resolve(['fixture-1']),
  } as unknown as LLMProvider;
}

describe('measureInstance', () => {
  it('scores the retriever on a real checkout, in the corpus\u2019s own coordinate system', async () => {
    const { root, allFiles } = checkout();
    const scored = await measureInstance({
      row: row(['src/retry.py']),
      checkout: root,
      allFiles,
    });

    expect(scored.id).toBe(42);
    expect(scored.repo).toBe('fixture/retry');
    expect(scored.corpusFiles).toBe(2);
    expect(scored.expectedFiles).toBe(1);
    expect(scored.skipped).toBeNull();
    // **The coordinate system is the point**: a repository-relative path, not an absolute one.
    for (const path of scored.offeredPaths) expect(path.startsWith('/')).toBe(false);
    // The question names `send_with_retry`, so the file that declares it is the first candidate.
    expect(scored.offeredPaths[0]).toBe('src/retry.py');
    expect(scored.retrieval['at1']?.recall).toBe(1);
    // **Average precision is a number between zero and one**, and the answer at rank one is a full one.
    expect(scored.map).toBe(1);
    // No provider, no answer arm: the difference between "cited nothing" and "was never asked".
    expect(scored.answer).toBeNull();
  });

  it('counts what the answer space removed instead of dropping it silently', async () => {
    const { root, allFiles } = checkout();
    const scored = await measureInstance({
      row: row(['README.md']),
      checkout: root,
      allFiles,
    });
    // **The row's own answer is outside the universe here**, which is a fact about the corpus row and is published
    // rather than smoothed: `expectedOutside` is the ceiling the restriction puts on recall.
    expect(scored.expectedOutside).toBe(1);
    expect(scored.retrieval['at1']?.recall).toBe(0);
    expect(scored.map).toBe(0);
    expect(scored.outside).toBeGreaterThanOrEqual(0);
  });

  it('runs the answer arm when a provider is present, and scores what it cited', async () => {
    const { root, allFiles } = checkout();
    const scored = await measureInstance({
      row: row(['src/retry.py']),
      checkout: root,
      allFiles,
      provider: citingProvider('src/retry.py'),
    });
    expect(scored.answer).not.toBeNull();
    expect(scored.answer?.recall).toBe(1);
    expect(scored.answer?.precision).toBe(1);
  });

  it('drops a pool entry outside the answer space instead of ranking a file the corpus never counted', async () => {
    // **The pool and the answer space are two different sets**, and the armature reads the intersection: a declaration
    // in `README.md` is a real candidate the retriever offered and a file the corpus's baselines never ranked, so it is
    // counted as `outside` and removed from every arm. A question that names it is how that branch is reached.
    const { root, allFiles } = checkout();
    const question: LcaCorpusRow = {
      ...row(['src/retry.py']),
      issue_title: 'the fixture README does not mention that requests are retried on 503',
    };
    const scored = await measureInstance({ row: question, checkout: root, allFiles });

    expect(scored.outside).toBeGreaterThan(0);
    expect(scored.offered).toBeLessThanOrEqual(allFiles.length);
    for (const arm of scored.fileArms ?? []) expect(arm.answerRank).toBe(1);
  });

  it('publishes the same pool read as a ranking of files five ways, with the shipped one reproducible', async () => {
    // **A choice the product made without measuring it.** The retrieval stage ranks declarations and the corpus asks
    // which files must change; every arm below reads the identical pool, so what differs between them is the rule for
    // turning a file's declarations into a file's position - and the shipped rule has to reproduce the row's own
    // figures, or the armature is measuring a second implementation of the product instead of the product.
    const { root, allFiles } = checkout();
    const scored = await measureInstance({ row: row(['src/retry.py']), checkout: root, allFiles });

    expect(scored.fileArms?.map((arm) => arm.aggregation)).toEqual([
      'max',
      'sum',
      'top2',
      'top3',
      'count',
      'blend25',
      'blend50',
      'blend75',
    ]);
    // **The arm named by the product's own constant, not the first one in the list** - the list's order is the table's
    // order and the shipped reading sits nowhere in particular in it.
    const shipped = scored.fileArms?.find((arm) => arm.aggregation === FILE_AGGREGATION);
    expect(shipped?.map).toBe(scored.map);
    expect(shipped?.answerRank).toBe(scored.answerRank);
    // **Every arm ranks the same set of files**, because they read the same pool: an arm that lost a file would be a
    // filter rather than a reordering.
    for (const arm of scored.fileArms ?? []) expect(arm.answerRank === null).toBe(false);
  });

  it('states the depth average precision reads, so the column has a definition', () => {
    // **A figure whose depth is not stated is a figure about a list nobody described.** The pool is the retriever's
    // own, and the artifact publishes the number beside the column.
    expect(MAP_DEPTH).toBe(200);
  });
});

describe('insertGraph', () => {
  /** A node the store can hold, with the fields `insertNode` requires and nothing else. */
  function node(id: number, name: string): GraphNode {
    return {
      id,
      projectId: 'p',
      label: 'Function',
      name,
      qualifiedName: `p.${name}`,
      filePath: 'src/a.py',
      startLine: 1,
      endLine: 2,
      language: 'python',
      properties: {},
      complexity: null,
      isExported: false,
    } as unknown as GraphNode;
  }

  function edge(sourceId: number, targetId: number): GraphEdge {
    return {
      id: sourceId * 100 + targetId,
      projectId: 'p',
      sourceId,
      targetId,
      type: 'CALLS',
      properties: {},
      weight: 1,
    } as unknown as GraphEdge;
  }

  it('renumbers the nodes and keeps the edges that join them', () => {
    const store = new InMemoryGraphStore();
    insertGraph(store, [node(7, 'a'), node(9, 'b')], [edge(7, 9)]);
    expect(store.getNodeCount()).toBe(2);
    expect(store.getEdgeCount()).toBe(1);
    store.close();
  });

  it('skips an edge whose endpoint the graph never registered', () => {
    // **A resolver fact rather than a hypothetical**: an edge can name a symbol no node was created for, and inserting
    // it would leave a target id the store cannot resolve. The row is what makes this case visible instead of fatal.
    const store = new InMemoryGraphStore();
    insertGraph(store, [node(7, 'a')], [edge(7, 9)]);
    expect(store.getNodeCount()).toBe(1);
    expect(store.getEdgeCount()).toBe(0);
    store.close();
  });
});
