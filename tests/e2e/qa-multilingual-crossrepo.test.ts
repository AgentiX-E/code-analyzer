// @code-analyzer — the acceptance test for the question-answering surface, on real repositories in three languages.
//
// **A user's story, not a package's:** "I have a Java service, a JavaScript server and a Python one, all checked out
// in one workspace, and I want to ask one question and be told which code answers it - in any of them, and across
// them." Every unit test of the assembler ran on a graph the test itself built, where the author already knew which
// node the question should reach. These are released checkouts, indexed by the product's own pipeline, and the
// question has to find the file on its own.
//
// **The corpus is fetched, never committed** (`benchmarks/corpora/` is ignored): the workflow downloads the four
// checkouts at pinned tags and points `QA_CORPUS_DIR` at the directory holding them. Without it the suite skips
// rather than passing on an empty graph - a skip is visible in the report, an empty graph is not.
//
// **What is asserted, and what is not.** The expected file has to appear in the **first eight** files the context
// touches, because the default twelve-block context spends nine slots on retrieval and reserves three for graph
// neighbours, and a file at position nine is not in the answer. It is not asserted to be first: a retriever that puts
// the right file first is better, and a test that demanded it would be a test of the ranking rather than of the
// capability. The ranking is measured on a labelled corpus, which is a different instrument.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  CrossRepoIndexer,
  HybridSearchEngine,
  RepoGroupManager,
  askCodebase,
} from '@code-analyzer/intelligence';
import { describe, expect, it, beforeAll } from 'vitest';

import type { AnswerResult } from '@code-analyzer/intelligence';
import type { PipelineContext } from '@code-analyzer/shared';

const corpusRoot = process.env['QA_CORPUS_DIR'];
const enabled = corpusRoot !== undefined && existsSync(corpusRoot);

/** How deep into the file list an expected answer may sit. **Deeper than this and the context cannot hold it.** */
const DEPTH = 8;

/** The checkout whose directory name starts with `prefix`, so a different pinned tag still runs. */
function checkoutNamed(prefix: string): string | null {
  if (!corpusRoot) return null;
  const entry = readdirSync(corpusRoot).find((name) => name.startsWith(prefix));
  return entry ? join(corpusRoot, entry) : null;
}

interface Workspace {
  store: InMemoryGraphStore;
  search: HybridSearchEngine;
  projects: Map<string, string>;
}

const GROUP = 'qa-polyglot';

async function openWorkspace(): Promise<Workspace> {
  const checkouts: Array<{ owner: string; name: string; prefix: string; url: string }> = [
    {
      owner: 'spring-projects',
      name: 'spring-petclinic',
      prefix: 'spring-petclinic-',
      url: 'https://github.com/spring-projects/spring-petclinic',
    },
    {
      owner: 'expressjs',
      name: 'express',
      prefix: 'express-',
      url: 'https://github.com/expressjs/express',
    },
    { owner: 'pallets', name: 'flask', prefix: 'flask-', url: 'https://github.com/pallets/flask' },
    {
      owner: 'pallets',
      name: 'werkzeug',
      prefix: 'werkzeug-',
      url: 'https://github.com/pallets/werkzeug',
    },
  ];

  const store = new InMemoryGraphStore();
  const groups = new RepoGroupManager();
  const indexer = new CrossRepoIndexer(store, groups);
  groups.createGroup(GROUP, 'polyglot', 'one workspace, three languages, two libraries');

  const projects = new Map<string, string>();
  for (const checkout of checkouts) {
    const path = checkoutNamed(checkout.prefix);
    if (!path) throw new Error(`${checkout.prefix}* must be present in the corpus directory`);
    const fullName = `${checkout.owner}/${checkout.name}`;
    groups.addRepo(GROUP, checkout.owner, checkout.name, checkout.url, path);
    projects.set(checkout.name, fullName);
  }

  await indexer.indexGroup(GROUP);

  const search = new HybridSearchEngine(store);
  search.initialize();
  return { store, search, projects };
}

/** The position of the first file whose path ends with `suffix`, or `-1`. */
function positionOf(result: AnswerResult, suffix: string): number {
  return result.retrievedFiles.findIndex((file) => file.endsWith(suffix));
}

/**
 * What the context actually held, in the order a reader would meet it.
 *
 * **Carried into the assertion message**, because "expected -1 to be greater than or equal to 0" on a real corpus says
 * nothing about whether the retriever missed, the budget dropped the file, or the index never had it.
 */
function listing(result: AnswerResult): string {
  const blocks = result.context
    .map(
      (block) =>
        `  [${String(block.id)}] ${block.origin}${block.reachedBy ? ` ← ${block.reachedBy.relation} [${String(block.reachedBy.from)}]` : ''} ${block.filePath}:${String(block.startLine)} ${block.qualifiedName}`,
    )
    .join('\n');
  return `\nretrieved files: ${result.retrievedFiles.join(', ')}\nblocks:\n${blocks}`;
}

describe.skipIf(!enabled)('QA on real repositories — one workspace, three languages', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await openWorkspace();
  }, 600_000);

  it('indexes every checkout into one store', () => {
    const nodes = workspace.store.getAllNodes();
    expect(nodes.length).toBeGreaterThan(5_000);
    const languages = new Set(nodes.map((node) => node.language).filter(Boolean));
    // **Three languages in one graph is the precondition for the rest of this file**: a single-language workspace
    // would let a question be answered by accident.
    expect(languages.has('java')).toBe(true);
    expect(languages.has('javascript')).toBe(true);
    expect(languages.has('python')).toBe(true);
  });

  it('answers a Java question from the Java checkout', async () => {
    const result = await askCodebase({
      question:
        'where does the owner controller render the page that lists an owner with their pets',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.abstained).toBe('no-provider');
    // **The file the question is about is in the context**, and it is not the only thing there.
    const position = positionOf(result, 'OwnerController.java');
    expect(position, listing(result)).toBeGreaterThanOrEqual(0);
    expect(position, listing(result)).toBeLessThan(DEPTH);
  });

  it('answers a JavaScript question from the JavaScript checkout', async () => {
    // **The question names one repository and vier of them are in the workspace**, and the word that looks most
    // specific in it - "middleware" - is the name of another repository's entire package: werkzeug has
    // `middleware/dispatcher.py`, `middleware/lint.py`, `middleware/profiler.py` and more, and every one of them scored
    // above express's `lib/application.js:use` (measured: rank 22 of the fused list, which is not in the twelve-block
    // context at all). **The product reads the name it already has**: the question says "express", the store holds a
    // project called `express`, and the workspace narrows to it - which is what a person meant.
    const result = await askCodebase({
      question: 'where does an express application mount middleware and route handlers',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    expect(result.scope).toEqual({
      projectId: 'expressjs/express',
      because: 'named in the question',
    });
    // **The path is relative to the checkout**, so it carries no repository name: `application.js` is express's
    // `lib/application.js` and nothing else in the workspace has that file name.
    const position = positionOf(result, 'application.js');
    expect(position, listing(result)).toBeGreaterThanOrEqual(0);
    expect(position, listing(result)).toBeLessThan(DEPTH);
    // **And everything in the context comes from the repository the question named.** Symbol nodes qualify as
    // `project:<id>:<path>:<name>` and file nodes as `file:<id>:<path>`, so the test looks for the id rather than for
    // one of the two prefixes.
    for (const block of result.context) {
      expect(block.qualifiedName).toContain(':expressjs/express:');
    }
  });

  it('sweeps the workspace when the caller asks for it by name', async () => {
    // **The escape hatch, asserted**: the same question with `scope: 'workspace'` searches all four checkouts, and the
    // result says it did. A restriction a caller cannot turn off is a bug that looks like a feature.
    const result = await askCodebase({
      question: 'where does an express application mount middleware and route handlers',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false, scope: 'workspace' },
    });
    expect(result.scope).toBeNull();
    expect(
      result.retrievedFiles.some((file) => file.startsWith('src/werkzeug/')),
      listing(result),
    ).toBe(true);
  });

  it('does not narrow a question that names two repositories, which is a comparison', async () => {
    const result = await askCodebase({
      question: 'how does the flask session use werkzeug to sign a cookie',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    // **Two names is not a scope**: answering half a comparison silently is worse than answering all of it noisily.
    expect(result.scope).toBeNull();
  });

  it('answers a Python question from the Python checkout', async () => {
    const result = await askCodebase({
      question: 'how does flask dispatch an incoming request to the view function that handles it',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    const position = result.retrievedFiles.findIndex(
      (file) => file.includes('/flask/') && file.endsWith('app.py'),
    );
    expect(position, listing(result)).toBeGreaterThanOrEqual(0);
    expect(position, listing(result)).toBeLessThan(DEPTH);
  });

  it('answers a question whose answer is in the other repository of the workspace', async () => {
    const result = await askCodebase({
      question:
        'where is a session cookie signed and serialised before it is written to the response',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    const flaskSessions = result.retrievedFiles.findIndex(
      (file) => file.includes('/flask/') && file.endsWith('sessions.py'),
    );
    // **This is the cross-repository claim**: the question names no repository, and the answer has to come out of the
    // graph the workspace built rather than out of a path the caller supplied.
    expect(flaskSessions).toBeGreaterThanOrEqual(0);
    expect(result.retrievedFiles.some((file) => file.includes('/werkzeug/'))).toBe(true);
  });

  it('labels every block with the language it is in, so a polyglot answer can be judged', async () => {
    const result = await askCodebase({
      question: 'parse the request body as json',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false, maxBlocks: 40 },
    });
    const known = new Set(['java', 'javascript', 'python']);
    for (const block of result.context) {
      expect(known.has(block.language ?? '')).toBe(true);
      expect(block.filePath.length).toBeGreaterThan(0);
    }
  });

  it('numbers every block from one and cites the number, never the node identity', async () => {
    const result = await askCodebase({
      question: 'how is a cookie read from the request',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    expect(result.context.map((block) => block.id)).toEqual(
      result.context.map((_block, index) => index + 1),
    );
    for (const block of result.context) {
      if (block.reachedBy) {
        // **The parent is a citation id that exists and came earlier**, because a reader follows `[3]`, not a node.
        expect(block.reachedBy.from).toBeGreaterThanOrEqual(1);
        expect(block.reachedBy.from).toBeLessThan(block.id);
      }
    }
  });

  it('holds imports and no calls, which is why the structural half is empty here', () => {
    // **The defect, asserted with its number rather than described.** A cross-repository indexing pass builds `File`
    // nodes, symbol nodes and `IMPORTS` edges, and it does not run the pipeline that resolves calls, containment and
    // tests - so the six relations the answer surface expands along exist in a single-repository analysis and do not
    // exist here. Four released checkouts, 1 201 import edges, **0 `CALLS`**: the graph cannot contribute a neighbour
    // to any question, and the twelve blocks a reader sees are twelve retrieval hits.
    //
    // **This case is a ratchet and it is meant to fail the day the indexer gains a call graph.** The fix is to index a
    // repository in a group with the same pipeline that indexes it alone, which is the first move recorded for the
    // next iteration; when that lands, this case turns red and the number in it has to be replaced by the new one.
    const counts = new Map<string, number>();
    for (const edge of workspace.store.getAllEdges()) {
      counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    }
    const census = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([type, count]) => `${type}=${String(count)}`)
      .join(' ');
    expect(counts.get('IMPORTS') ?? 0, census).toBeGreaterThan(0);
    expect(counts.get('CALLS') ?? 0, census).toBe(0);
    expect((counts.get('CONTAINS') ?? 0) + (counts.get('TESTS') ?? 0), census).toBe(0);
  });

  it('reaches a graph neighbour on a repository the pipeline indexed, where the calls exist', async () => {
    // **The other half of the same finding.** The assembler's reservation, its direction table and its parent-id rule
    // are exercised here on a graph that has `CALLS` edges, because the reason the cross-repository workspace shows no
    // structural block is the indexer and not the assembly.
    const petclinic = checkoutNamed('spring-petclinic-');
    expect(petclinic).not.toBeNull();
    const context = {
      projectId: 'spring-projects/spring-petclinic',
      rootPath: petclinic!,
      config: getDefaultConfig(),
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;
    const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(context);

    const store = new InMemoryGraphStore();
    const storeIdOf = new Map<number, number>();
    for (const node of pipeline.graph.nodes.values()) {
      storeIdOf.set(node.id, store.insertNode(node));
    }
    for (const edge of pipeline.graph.edges.values()) {
      const source = storeIdOf.get(edge.sourceId);
      const target = storeIdOf.get(edge.targetId);
      if (source === undefined || target === undefined) continue;
      store.insertEdge({
        projectId: edge.projectId,
        sourceId: source,
        targetId: target,
        type: edge.type,
        properties: edge.properties,
        weight: edge.weight,
      });
    }

    const search = new HybridSearchEngine(store);
    search.initialize();

    let structural = 0;
    const rows: string[] = [];
    for (const question of [
      'where does the owner controller render the page that lists an owner with their pets',
      'where is a pet saved to the database',
      'where is the visit added for a pet',
    ]) {
      const result = await askCodebase({
        question,
        store,
        search,
        options: { generate: false, neighboursPerHit: 2 },
      });
      const fromGraph = result.context.filter((block) => block.origin === 'graph');
      structural += fromGraph.length;
      rows.push(
        `  ${String(fromGraph.length)} graph / ${String(result.stats.retrieved)} retrieved — ${question}`,
      );
      for (const block of fromGraph) {
        // **A structural block always names the edge that reached it and the block it came from.**
        expect(block.reachedBy, listing(result)).not.toBeNull();
        expect(block.reachedBy!.from).toBeLessThan(block.id);
      }
    }
    expect(structural, `\n${rows.join('\n')}`).toBeGreaterThan(0);
    store.close();
  });

  it('is deterministic: the same question over the same index gives the same context', async () => {
    const ask = (): Promise<AnswerResult> =>
      askCodebase({
        question: 'where are http headers parsed into a mapping',
        store: workspace.store,
        search: workspace.search,
        options: { generate: false },
      });
    const first = await ask();
    const second = await ask();
    expect(first.context.map((block) => `${String(block.id)}:${block.filePath}`)).toEqual(
      second.context.map((block) => `${String(block.id)}:${block.filePath}`),
    );
  });

  it('restricts an answer to one project when the caller names one', async () => {
    const flaskProject = workspace.projects.get('flask')!;
    const result = await askCodebase({
      question: 'where is the request context pushed',
      store: workspace.store,
      search: workspace.search,
      projectId: flaskProject,
      options: { generate: false },
    });
    expect(result.context.length).toBeGreaterThan(0);
    for (const block of result.context) {
      const node = workspace.store.getNode(block.nodeId)!;
      // **A hit from another checkout would answer a question about this one with code that is not here.**
      expect(node.projectId).toBe(flaskProject);
    }
  });
});
