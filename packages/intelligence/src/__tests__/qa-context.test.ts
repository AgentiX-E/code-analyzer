// The context a question is answered from — unit tests.
//
// **Every case here is paired with the one that differs by a single fact**, because the interesting behaviour of an
// assembler is a boundary: a block with no path, a neighbour that is already present, a budget that is one block short,
// two candidates with the same score. A test that only asserts "the right block is there" passes for an assembler that
// also puts the wrong ones in.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { EDGE_CALLS, EDGE_CONTAINS, EDGE_IMPORTS, EDGE_TESTS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTEXT_OPTIONS,
  assembleContext,
  blockCost,
  contextChars,
  excerpt,
  filesOf,
  neighboursOf,
  nodeBody,
  rankCandidates,
} from '../qa/context.js';

import type { RetrievedCandidate } from '../qa/context.js';
import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// A repository small enough to reason about, built in a real store
// ---------------------------------------------------------------------------

interface Repo {
  store: InMemoryGraphStore;
  id: Record<string, number>;
}

/**
 * Two modules, four functions, one caller, one importer, one test.
 *
 * **A real `InMemoryGraphStore`, not a stub**: the two properties that matter here - `getEdgesForNode` direction and
 * node lookup - are the store's, and a hand-written stand-in would be a test of the stand-in.
 */
function buildRepo(): Repo {
  const store = new InMemoryGraphStore();
  const id: Record<string, number> = {};

  const node = (
    key: string,
    name: string,
    filePath: string | null,
    overrides: Partial<GraphNode> = {},
  ): void => {
    id[key] = store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name,
      qualifiedName: overrides.qualifiedName ?? `app.${name}`,
      filePath,
      startLine: overrides.startLine ?? 1,
      endLine: overrides.endLine ?? 20,
      language: 'python',
      properties: overrides.properties ?? {},
      complexity: null,
      isExported: true,
    } as never);
  };

  node('parse', 'parse_token', 'app/auth.py', {
    properties: { body: 'def parse_token(raw):\n    return raw.split(".")[0]\n' },
  });
  node('login', 'login', 'app/views.py', {
    properties: { body: 'def login(request):\n    token = parse_token(request.GET["t"])\n' },
  });
  node('logout', 'logout', 'app/views.py', {
    properties: { body: 'def logout(request):\n    return redirect("/")\n' },
  });
  node('orphan', 'orphan_helper', null, {
    properties: { body: 'def orphan_helper():\n    pass\n' },
  });
  node('testParse', 'test_parse_token', 'tests/test_auth.py', {
    properties: { body: 'def test_parse_token():\n    assert parse_token("a.b") == "a"\n' },
  });
  node('helpers', 'helpers', 'app/helpers.py');

  // login calls parse_token: the caller is the interesting end of the edge.
  store.insertEdge({
    projectId: 'qa',
    sourceId: id['login']!,
    targetId: id['parse']!,
    type: EDGE_CALLS,
  });
  // test_parse_token tests parse_token.
  store.insertEdge({
    projectId: 'qa',
    sourceId: id['testParse']!,
    targetId: id['parse']!,
    type: EDGE_TESTS,
  });
  // views.py imports helpers.
  store.insertEdge({
    projectId: 'qa',
    sourceId: id['login']!,
    targetId: id['helpers']!,
    type: EDGE_IMPORTS,
  });
  // a containment edge, so `out` direction has something to find
  store.insertEdge({
    projectId: 'qa',
    sourceId: id['helpers']!,
    targetId: id['parse']!,
    type: EDGE_CONTAINS,
  });

  return { store, id };
}

function candidate(store: InMemoryGraphStore, nodeId: number, score: number): RetrievedCandidate {
  const node = store.getNode(nodeId);
  if (!node) throw new Error(`no node ${String(nodeId)}`);
  return { node, score };
}

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

describe('excerpt', () => {
  it('keeps a body that fits, unchanged', () => {
    expect(excerpt('a\nb\nc', 100)).toBe('a\nb\nc');
  });

  it('cuts on a line boundary and says it cut', () => {
    const body = 'line one\nline two\nline three\n';
    const cut = excerpt(body, 18);
    expect(cut).toBe('line one\nline two\n… (truncated)');
    // **The property that matters**: every line of the excerpt is a whole line of the input.
    for (const line of cut!.split('\n').slice(0, -1)) {
      expect(body.split('\n')).toContain(line);
    }
  });

  it('drops a body with no newline in the budget rather than truncating mid-token', () => {
    // **A half expression is a claim about code that does not exist**, so nothing is better than something.
    expect(excerpt('x'.repeat(100), 10)).toBeNull();
  });

  it('returns null for a body that is not there', () => {
    expect(excerpt(null, 100)).toBeNull();
  });
});

describe('nodeBody', () => {
  it('reads the first recorded body key', () => {
    const { store, id } = buildRepo();
    expect(nodeBody(store.getNode(id['parse']!)!)).toContain('raw.split');
  });

  it('does not treat a docstring as a body', () => {
    const store = new InMemoryGraphStore();
    const nodeId = store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name: 'f',
      qualifiedName: 'f',
      filePath: 'a.py',
      startLine: 1,
      endLine: 2,
      language: 'python',
      properties: {},
      docstring: 'Returns the thing.',
      complexity: null,
      isExported: true,
    } as never);
    // **A context built from docstrings answers from the comments**, which is the shortcut the paraphrase corpus
    // exists to measure. The body is the code, and a node without one has no body.
    expect(nodeBody(store.getNode(nodeId)!)).toBeNull();
  });

  it('ignores a blank body', () => {
    const store = new InMemoryGraphStore();
    const nodeId = store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name: 'f',
      qualifiedName: 'f',
      filePath: 'a.py',
      startLine: 1,
      endLine: 2,
      language: 'python',
      properties: { body: '   \n  ' },
      complexity: null,
      isExported: true,
    } as never);
    expect(nodeBody(store.getNode(nodeId)!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('rankCandidates', () => {
  it('orders by score descending', () => {
    const { store, id } = buildRepo();
    const ranked = rankCandidates([
      candidate(store, id['parse']!, 1),
      candidate(store, id['login']!, 3),
      candidate(store, id['logout']!, 2),
    ]);
    expect(ranked.map((entry) => entry.node.name)).toEqual(['login', 'logout', 'parse_token']);
  });

  it('breaks a tie by node identity, not by the order it was handed', () => {
    const { store, id } = buildRepo();
    const forward = rankCandidates([
      candidate(store, id['login']!, 2),
      candidate(store, id['parse']!, 2),
    ]);
    const backward = rankCandidates([
      candidate(store, id['parse']!, 2),
      candidate(store, id['login']!, 2),
    ]);
    // **Equal scores are equal on every machine**, so the order among them cannot be an accident of the caller.
    expect(forward.map((entry) => entry.node.id)).toEqual(backward.map((entry) => entry.node.id));
    expect(forward[0]!.node.id).toBeLessThan(forward[1]!.node.id);
  });

  it('does not mutate its input', () => {
    const { store, id } = buildRepo();
    const input = [candidate(store, id['parse']!, 1), candidate(store, id['login']!, 3)];
    rankCandidates(input);
    expect(input[0]!.node.name).toBe('parse_token');
  });
});

// ---------------------------------------------------------------------------
// Graph neighbours
// ---------------------------------------------------------------------------

describe('neighboursOf', () => {
  it('follows CALLS backwards, because the caller is what a change breaks', () => {
    const { store, id } = buildRepo();
    const found = neighboursOf(store, id['parse']!, [EDGE_CALLS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['login']);
    expect(found[0]!.relation).toBe(EDGE_CALLS);
  });

  it('follows IMPORTS backwards as well, which is the importing module', () => {
    const { store, id } = buildRepo();
    const found = neighboursOf(store, id['helpers']!, [EDGE_IMPORTS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['login']);
  });

  it('follows CONTAINS forwards, because the member is inside the container', () => {
    const { store, id } = buildRepo();
    const found = neighboursOf(store, id['helpers']!, [EDGE_CONTAINS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['parse_token']);
  });

  it('skips a neighbour that is already in the context', () => {
    const { store, id } = buildRepo();
    const seen = new Set([id['login']!]);
    expect(neighboursOf(store, id['parse']!, [EDGE_CALLS], 5, seen)).toEqual([]);
  });

  it('skips a neighbour with no file path, because a citation has to name a place', () => {
    const { store, id } = buildRepo();
    store.insertEdge({
      projectId: 'qa',
      sourceId: id['orphan']!,
      targetId: id['parse']!,
      type: EDGE_CALLS,
    });
    const found = neighboursOf(store, id['parse']!, [EDGE_CALLS], 20, new Set());
    expect(found.map((entry) => entry.node.name)).not.toContain('orphan_helper');
    expect(found.map((entry) => entry.node.name)).toContain('login');
  });

  it('honours the budget and takes relations in the order given', () => {
    const { store, id } = buildRepo();
    const callsFirst = neighboursOf(store, id['parse']!, [EDGE_CALLS, EDGE_TESTS], 1, new Set());
    const testsFirst = neighboursOf(store, id['parse']!, [EDGE_TESTS, EDGE_CALLS], 1, new Set());
    expect(callsFirst.map((entry) => entry.node.name)).toEqual(['login']);
    // **Priority is not decoration**: same node, same budget, different stated preference, different answer.
    expect(testsFirst.map((entry) => entry.node.name)).toEqual(['test_parse_token']);
  });

  it('returns nothing when the budget is zero', () => {
    const { store, id } = buildRepo();
    expect(neighboursOf(store, id['parse']!, [EDGE_CALLS], 0, new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

describe('assembleContext', () => {
  it('numbers blocks from one, in rank order', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(
      store,
      [candidate(store, id['parse']!, 3), candidate(store, id['logout']!, 1)],
      { neighboursPerHit: 0 },
    );
    expect(blocks.map((block) => block.id)).toEqual([1, 2]);
    expect(blocks[0]!.name).toBe('parse_token');
    expect(blocks[1]!.name).toBe('logout');
  });

  it('drops a block with no file path rather than numbering it', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(
      store,
      [candidate(store, id['orphan']!, 9), candidate(store, id['parse']!, 1)],
      { neighboursPerHit: 0 },
    );
    // **A numbered block with nowhere to point is a citation that cannot be followed**, and the count the prompt
    // states would be wrong.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe(1);
    expect(blocks[0]!.filePath).toBe('app/auth.py');
  });

  it('adds graph neighbours after the retrieved blocks and records the edge', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 2,
      relations: [EDGE_CALLS, EDGE_TESTS],
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.origin).toBe('retrieved');
    expect(blocks.slice(1).map((block) => block.origin)).toEqual(['graph', 'graph']);
    // **The parent is cited by its number, not by its node id**, because the number is the only identifier the prompt
    // shows and a reader can follow it.
    expect(blocks[1]!.reachedBy).toEqual({ relation: EDGE_CALLS, from: 1 });
    expect(blocks[2]!.reachedBy).toEqual({ relation: EDGE_TESTS, from: 1 });
  });

  it('does not repeat a node that retrieval already placed', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(
      store,
      [candidate(store, id['parse']!, 5), candidate(store, id['login']!, 4)],
      { neighboursPerHit: 3, relations: [EDGE_CALLS] },
    );
    const names = blocks.map((block) => block.name);
    expect(names.filter((name) => name === 'login')).toHaveLength(1);
  });

  it('stops at maxBlocks', () => {
    const { store, id } = buildRepo();
    const every = ['parse', 'login', 'logout', 'testParse', 'helpers'].map((key, index) =>
      candidate(store, id[key]!, 10 - index),
    );
    const blocks = assembleContext(store, every, { maxBlocks: 2, neighboursPerHit: 0 });
    expect(blocks).toHaveLength(2);
  });

  it('stops at the character budget, and the block it dropped has no id', () => {
    const { store, id } = buildRepo();
    const one = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 0,
      excerptChars: 10_000,
    });
    const cost = blockCost(one[0]!);
    // **One character short of the single block it needs**: nothing is admitted, so nothing is numbered.
    const starved = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 0,
      excerptChars: 10_000,
      maxChars: cost - 1,
    });
    expect(starved).toEqual([]);
  });

  it('counts the characters it says it counted', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 1,
      relations: [EDGE_CALLS],
    });
    expect(contextChars(blocks)).toBe(blocks.reduce((sum, block) => sum + blockCost(block), 0));
    expect(contextChars(blocks)).toBeGreaterThan(0);
  });

  it('is deterministic for one index and one candidate list', () => {
    const { store, id } = buildRepo();
    const candidates = [candidate(store, id['parse']!, 5), candidate(store, id['login']!, 5)];
    const first = assembleContext(store, candidates, { neighboursPerHit: 2 });
    const second = assembleContext(store, [...candidates].reverse(), { neighboursPerHit: 2 });
    expect(first.map((block) => `${block.id}:${block.qualifiedName}`)).toEqual(
      second.map((block) => `${block.id}:${block.qualifiedName}`),
    );
  });

  it('disables expansion when the neighbour budget is zero', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 0,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.origin).toBe('retrieved');
  });

  it('publishes the defaults it applies', () => {
    expect(DEFAULT_CONTEXT_OPTIONS.maxBlocks).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_OPTIONS.maxChars).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_OPTIONS.relations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

describe('filesOf', () => {
  it('lists distinct files in first-appearance order', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(
      store,
      [
        candidate(store, id['parse']!, 3),
        candidate(store, id['login']!, 2),
        candidate(store, id['logout']!, 1),
      ],
      { neighboursPerHit: 0 },
    );
    expect(filesOf(blocks)).toEqual(['app/auth.py', 'app/views.py']);
  });

  it('is empty for an empty context', () => {
    expect(filesOf([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The boundaries the assembler refuses at
// ---------------------------------------------------------------------------

describe('neighboursOf — the refusals', () => {
  it('treats a relation with no stated direction as inbound', () => {
    const { store, id } = buildRepo();
    store.insertEdge({
      projectId: 'qa',
      sourceId: id['logout']!,
      targetId: id['parse']!,
      type: 'USES_TYPE',
    });
    // **`USES_TYPE` is not in the table**, so the default has to be the useful direction rather than `undefined`
    // reaching `getEdgesForNode` - which would silently return nothing and read as "no neighbours".
    const found = neighboursOf(store, id['parse']!, ['USES_TYPE'], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['logout']);
  });

  it('skips an edge that points at its own node', () => {
    const { store, id } = buildRepo();
    store.insertEdge({
      projectId: 'qa',
      sourceId: id['parse']!,
      targetId: id['parse']!,
      type: EDGE_CALLS,
    });
    const found = neighboursOf(store, id['parse']!, [EDGE_CALLS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['login']);
  });

  it('does not add the same neighbour twice through two relations', () => {
    const { store, id } = buildRepo();
    // **`login` calls `parse` and `views.py` also imports `helpers`**, so a relation pair can reach one node twice
    // when a provider records both edges - and one block is what the budget should pay for.
    const found = neighboursOf(store, id['parse']!, [EDGE_CALLS, EDGE_CALLS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).toEqual(['login']);
  });

  it('skips a neighbour whose label cannot be explained in prose', () => {
    const { store, id } = buildRepo();
    const folder = store.insertNode({
      projectId: 'qa',
      label: 'Folder',
      name: 'app',
      qualifiedName: 'app',
      filePath: 'app',
      startLine: null,
      endLine: null,
      language: null,
      properties: {},
      complexity: null,
      isExported: false,
    } as never);
    // **`CONTAINS` is followed outwards**, so the container is the *source*: `parse_token` contains `app`. A folder is
    // a path segment, and a question answered with a line of a path is a question answered badly.
    store.insertEdge({
      projectId: 'qa',
      sourceId: id['parse']!,
      targetId: folder,
      type: EDGE_CONTAINS,
    });
    const found = neighboursOf(store, id['parse']!, [EDGE_CONTAINS], 5, new Set());
    expect(found.map((entry) => entry.node.name)).not.toContain('app');
  });
});

describe('assembleContext — the refusals', () => {
  it('drops a candidate whose label cannot be explained in prose', () => {
    const { store } = buildRepo();
    const folder = store.insertNode({
      projectId: 'qa',
      label: 'Folder',
      name: 'app',
      qualifiedName: 'app',
      filePath: 'app',
      startLine: null,
      endLine: null,
      language: null,
      properties: {},
      complexity: null,
      isExported: false,
    } as never);
    const blocks = assembleContext(store, [candidate(store, folder, 100)], { neighboursPerHit: 0 });
    expect(blocks).toEqual([]);
  });

  it('admits a node once even when it is offered twice', () => {
    const { store, id } = buildRepo();
    const one = candidate(store, id['parse']!, 10);
    const blocks = assembleContext(store, [one, { ...one, score: 9 }], { neighboursPerHit: 0 });
    expect(blocks).toHaveLength(1);
  });

  it('stops the inner walk as soon as the budget is full', () => {
    const { store, id } = buildRepo();
    // **Two callers and room for one**: the second edge has to be abandoned mid-walk rather than counted, and the
    // arity of the result is what says so.
    store.insertEdge({
      projectId: 'qa',
      sourceId: id['logout']!,
      targetId: id['parse']!,
      type: EDGE_CALLS,
    });
    const found = neighboursOf(store, id['parse']!, [EDGE_CALLS], 1, new Set());
    expect(found).toHaveLength(1);
    expect(found[0]!.node.name).toBe('login');
  });

  it('applies the neighbour budget across relations, not per relation', () => {
    const { store, id } = buildRepo();
    const blocks = assembleContext(store, [candidate(store, id['parse']!, 5)], {
      neighboursPerHit: 1,
      relations: [EDGE_CALLS, EDGE_TESTS],
    });
    // **One neighbour in total**, because the budget is what the prompt can hold, not a per-relation allowance.
    expect(blocks.filter((block) => block.origin === 'graph')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The structural reservation
// ---------------------------------------------------------------------------

/**
 * A repository where retrieval can always fill the context: `count` functions in one file, and `callers` functions
 * outside the candidate list that call the first few of them.
 *
 * **The callers are deliberately not candidates**, because a neighbour that is already a retrieval hit is refused as a
 * duplicate and would make a reservation test pass for the wrong reason.
 */
function oversubscribedRepo(
  count: number,
  callers: number,
): { store: InMemoryGraphStore; ids: number[] } {
  const store = new InMemoryGraphStore();
  const insert = (name: string, filePath: string): number =>
    store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name,
      qualifiedName: `app.${name}`,
      filePath,
      startLine: 1,
      endLine: 3,
      language: 'python',
      properties: { body: `def ${name}():\n    return 1\n` },
      complexity: null,
      isExported: true,
    } as never);

  const ids: number[] = [];
  for (let index = 0; index < count; index += 1)
    ids.push(insert(`fn_${String(index)}`, 'app/flat.py'));
  for (let index = 0; index < callers; index += 1) {
    const caller = insert(`caller_${String(index)}`, 'app/callers.py');
    store.insertEdge({
      projectId: 'qa',
      sourceId: caller,
      targetId: ids[index % ids.length]!,
      type: EDGE_CALLS,
    });
  }
  return { store, ids };
}

describe('the structural reservation', () => {
  const asksWith = (
    store: InMemoryGraphStore,
    ids: number[],
    options: Parameters<typeof assembleContext>[2],
  ): ReturnType<typeof assembleContext> =>
    assembleContext(
      store,
      ids.map((id, index) => candidate(store, id, 100 - index)),
      options,
    );

  it('keeps the graph from being starved by a retrieval list longer than the context', () => {
    // **This is the defect the fourth acceptance case found on four real checkouts**: sixty candidates and twelve
    // slots meant the retrieved pass filled every slot, the second pass walked the edges, and every neighbour it
    // found was refused - so the "structural" half of the context was empty on every question ever asked.
    const { store, ids } = oversubscribedRepo(20, 9);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 2,
      structuralBlocks: 3,
    });
    expect(blocks).toHaveLength(12);
    expect(blocks.filter((block) => block.origin === 'retrieved')).toHaveLength(9);
    expect(blocks.filter((block) => block.origin === 'graph')).toHaveLength(3);
  });

  it('gives an unused reservation back to retrieval', () => {
    // **One caller and room for three**: two slots would otherwise sit empty while nineteen candidates are unread.
    const { store, ids } = oversubscribedRepo(20, 1);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 2,
      structuralBlocks: 3,
    });
    expect(blocks).toHaveLength(12);
    expect(blocks.filter((block) => block.origin === 'graph')).toHaveLength(1);
    // **The tail is retrieval again**, and it says so: eleven blocks are hits, one is a caller.
    expect(blocks.filter((block) => block.origin === 'retrieved')).toHaveLength(11);
    expect(blocks.at(-1)!.origin).toBe('retrieved');
  });

  it('uses every slot for retrieval when the graph is asked for nothing', () => {
    const { store, ids } = oversubscribedRepo(20, 9);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 2,
      structuralBlocks: 0,
    });
    expect(blocks).toHaveLength(12);
    expect(blocks.filter((block) => block.origin === 'graph')).toEqual([]);
  });

  it('uses every slot for retrieval when expansion is disabled', () => {
    // **A reservation for neighbours that cannot exist is a bug in the other direction**, and this is the case that
    // separates "the graph had nothing to add" from "the caller turned the graph off".
    const { store, ids } = oversubscribedRepo(20, 9);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 0,
      structuralBlocks: 3,
    });
    expect(blocks).toHaveLength(12);
    expect(blocks.filter((block) => block.origin === 'graph')).toEqual([]);
  });

  it('never reserves the last slot', () => {
    // **A context of one block cannot hold a neighbourhood**, and a reservation that took the only slot would answer
    // the question with nothing at all.
    const { store, ids } = oversubscribedRepo(5, 3);
    const blocks = asksWith(store, ids, { maxBlocks: 2, neighboursPerHit: 2, structuralBlocks: 5 });
    expect(blocks).toHaveLength(2);
    expect(blocks.filter((block) => block.origin === 'retrieved')).toHaveLength(1);
  });

  it('does not let the graph exceed its reservation', () => {
    // **Five callers per hit and room for three**: the reservation is a bound, not a starting point.
    const { store, ids } = oversubscribedRepo(20, 15);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 2,
      structuralBlocks: 3,
    });
    expect(blocks.filter((block) => block.origin === 'graph')).toHaveLength(3);
  });

  it('numbers the structure after the hits and the tail after the structure', () => {
    const { store, ids } = oversubscribedRepo(20, 1);
    const blocks = asksWith(store, ids, {
      maxBlocks: 12,
      neighboursPerHit: 2,
      structuralBlocks: 3,
    });
    expect(blocks.map((block) => block.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const structural = blocks.filter((block) => block.origin === 'graph');
    expect(structural.map((block) => block.id)).toEqual([10]);
    // **A parent is a citation id that exists and came earlier**, which is the invariant the prompt relies on.
    for (const block of structural) {
      expect(block.reachedBy!.from).toBeGreaterThanOrEqual(1);
      expect(block.reachedBy!.from).toBeLessThan(block.id);
    }
  });
});
