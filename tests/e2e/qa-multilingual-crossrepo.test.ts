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
// touches, because eight is what the default twelve-block context can hold once graph neighbours are counted, and a
// file at position nine is not in the answer. It is not asserted to be first: a retriever that puts the right file
// first is better, and a test that demanded it would be a test of the ranking rather than of the capability. The
// ranking is measured on a labelled corpus, which is a different instrument.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  CrossRepoIndexer,
  HybridSearchEngine,
  RepoGroupManager,
  askCodebase,
} from '@code-analyzer/intelligence';
import { describe, expect, it, beforeAll } from 'vitest';

import type { AnswerResult } from '@code-analyzer/intelligence';

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
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(DEPTH);
  });

  it('answers a JavaScript question from the JavaScript checkout', async () => {
    const result = await askCodebase({
      question: 'where does an express application mount middleware and route handlers',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false },
    });
    const position = result.retrievedFiles.findIndex(
      (file) => file.includes('express') && file.endsWith('application.js'),
    );
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(DEPTH);
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
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(DEPTH);
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

  it('includes graph neighbours, and says which edge reached each one', async () => {
    const result = await askCodebase({
      question: 'where is the request object created for each incoming call',
      store: workspace.store,
      search: workspace.search,
      options: { generate: false, neighboursPerHit: 2 },
    });
    const structural = result.context.filter((block) => block.origin === 'graph');
    // **The product's claim is that structure adds context a bag of words cannot**, so a run on four real checkouts
    // has to have reached at least one neighbour through a named edge.
    expect(structural.length).toBeGreaterThan(0);
    for (const block of structural) {
      expect(block.reachedBy).not.toBeNull();
    }
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
