// Asking the codebase — unit tests for the composition.
//
// **The orchestration is where a correct part becomes a wrong answer**, so every case here is about what the pipeline
// does when one stage is missing or the model misbehaves: no provider, a provider that throws, an answer with no
// pointer, an answer that invents a pointer, an index with nothing in it. **None of those may throw**, because the
// caller is a tool and a CI job, and "no answer, and here is why" is a report rather than a crash.
//
// **The provider is a four-line object rather than a mocked module.** The interface has three methods; standing in for
// it at the seam the production code uses is how an LLM boundary is tested, and mocking the module under test would
// test the mock.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { EDGE_CALLS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { askCodebase, nodesForFiles, retrieveContext } from '../qa/ask.js';
import { ABSTAIN_REASONS } from '../qa/types.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../review/llm/provider.js';

// ---------------------------------------------------------------------------
// A repository and an engine over it
// ---------------------------------------------------------------------------

interface Fixture {
  store: InMemoryGraphStore;
  search: HybridSearchEngine;
  ids: Record<string, number>;
}

function buildFixture(): Fixture {
  const store = new InMemoryGraphStore();
  const ids: Record<string, number> = {};

  const add = (key: string, name: string, file: string, body: string, startLine: number): void => {
    ids[key] = store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name,
      qualifiedName: `app.auth.${name}`,
      filePath: file,
      startLine,
      endLine: startLine + 6,
      language: 'python',
      properties: { body },
      signature: `def ${name}(raw):`,
      complexity: null,
      isExported: true,
    } as never);
  };

  add(
    'parse',
    'parse_token',
    'app/auth.py',
    'def parse_token(raw):\n    return raw.split(".")[0]\n',
    10,
  );
  add(
    'login',
    'login',
    'app/views.py',
    'def login(request):\n    token = parse_token(request.GET["t"])\n',
    20,
  );
  add(
    'cookie',
    'set_cookie',
    'app/cookies.py',
    'def set_cookie(response, value):\n    response.set_cookie("s", value)\n',
    30,
  );

  store.insertEdge({
    projectId: 'qa',
    sourceId: ids['login']!,
    targetId: ids['parse']!,
    type: EDGE_CALLS,
  });

  const search = new HybridSearchEngine(store);
  search.initialize();
  return { store, search, ids };
}

/** A provider that returns whatever the test tells it to, and records what it was asked. */
function stubProvider(answer: string | (() => never), calls: string[] = []): LLMProvider {
  return {
    name: 'stub',
    model: 'stub-1',
    async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
      calls.push(prompt);
      if (typeof answer === 'function') answer();
      return {
        content: typeof answer === 'string' ? answer : '',
        model: 'stub-1',
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      };
    },
    async completeWithTools(): Promise<CompletionResult> {
      throw new Error('not used');
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// The retrieval arm
// ---------------------------------------------------------------------------

describe('retrieveContext', () => {
  it('finds the function a question names and numbers it', async () => {
    const { store, search } = buildFixture();
    const result = await retrieveContext({ question: 'parse token', store, search });
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0]!.id).toBe(1);
    expect(result.blocks.map((block) => block.name)).toContain('parse_token');
  });

  it('records that no rerank happened when there is no provider', async () => {
    const { store, search } = buildFixture();
    const result = await retrieveContext({ question: 'parse token', store, search });
    expect(result.rerankApplied).toBe(false);
    expect(result.rerankReason).toBe('no LLM provider is configured');
  });

  it('does not attempt a rerank when the caller turned it off', async () => {
    const { store, search } = buildFixture();
    const calls: string[] = [];
    const result = await retrieveContext({
      question: 'parse token',
      store,
      search,
      provider: stubProvider('[1]', calls),
      options: { rerank: false },
    });
    expect(calls).toEqual([]);
    expect(result.rerankApplied).toBe(false);
    expect(result.rerankReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The answer arm
// ---------------------------------------------------------------------------

describe('askCodebase', () => {
  it('returns an answer with the citation the model made', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'where is the session token parsed',
      store,
      search,
      provider: stubProvider('It is parsed in [1].'),
      options: { rerank: false, neighboursPerHit: 0 },
    });
    expect(result.abstained).toBeNull();
    expect(result.answer).toBe('It is parsed in [1].');
    expect(result.citations).toHaveLength(1);
    expect(result.files).toEqual([result.citations[0]!.filePath]);
    expect(result.grounding.allCitationsResolve).toBe(true);
  });

  it('derives the file set from citations, not from the context', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse token login cookie',
      store,
      search,
      provider: stubProvider('Only [1] matters.'),
      options: { rerank: false, neighboursPerHit: 0 },
    });
    // **The context holds more files than the answer rests on**, and the two fields must say so.
    expect(result.retrievedFiles.length).toBeGreaterThan(result.files.length);
    expect(result.files).toEqual([result.citations[0]!.filePath]);
  });

  it('reports an invented citation without discarding the prose', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider: stubProvider('Definitely [42].'),
      options: { rerank: false, neighboursPerHit: 0 },
    });
    expect(result.grounding.unknownIds).toEqual([42]);
    expect(result.grounding.allCitationsResolve).toBe(false);
    // **The answer is still returned**: a measurement that dropped it would be measuring the parser.
    expect(result.answer).toBe('Definitely [42].');
    expect(result.files).toEqual([]);
    expect(result.abstained).toBe('no-grounded-claim');
  });

  it('abstains with a reason when the answer cites nothing', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider: stubProvider('I think it is somewhere in the auth module.'),
      options: { rerank: false, neighboursPerHit: 0 },
    });
    expect(result.abstained).toBe('no-grounded-claim');
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.notes.join(' ')).toContain('no claim in the answer');
  });

  it('abstains with no-provider and still returns the retrieval', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({ question: 'parse token', store, search });
    expect(result.abstained).toBe('no-provider');
    expect(result.answer).toBe('');
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.retrievedFiles.length).toBeGreaterThan(0);
  });

  it('separates "generation was not requested" from "no provider exists"', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider: stubProvider('unused'),
      options: { generate: false },
    });
    expect(result.abstained).toBe('no-provider');
    expect(result.notes.join(' ')).toContain('generation was not requested');
  });

  it('reports a provider failure rather than throwing', async () => {
    const { store, search } = buildFixture();
    const failing = stubProvider(() => {
      throw new Error('429 rate limited');
    });
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider: failing,
      options: { rerank: false },
    });
    expect(result.abstained).toBe('provider-failed');
    expect(result.notes.join(' ')).toContain('429 rate limited');
  });

  it('reports an empty completion as an empty answer', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider: stubProvider('   '),
      options: { rerank: false },
    });
    expect(result.abstained).toBe('empty-answer');
  });

  it('abstains with no-blocks-retrieved on an empty index', async () => {
    const store = new InMemoryGraphStore();
    const search = new HybridSearchEngine(store);
    search.initialize();
    const result = await askCodebase({ question: 'anything', store, search });
    expect(result.abstained).toBe('no-blocks-retrieved');
    expect(result.context).toEqual([]);
  });

  it('counts what the graph added', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      question: 'parse_token',
      store,
      search,
      options: { rerank: false, neighboursPerHit: 2 },
    });
    expect(result.stats.fromGraph).toBeGreaterThan(0);
    expect(result.stats.retrieved).toBeGreaterThan(0);
    expect(result.stats.contextChars).toBeGreaterThan(0);
  });

  it('puts the answer prompt in front of the model, with the blocks numbered', async () => {
    const { store, search } = buildFixture();
    const calls: string[] = [];
    await askCodebase({
      question: 'where is the token parsed',
      store,
      search,
      provider: stubProvider('[1]', calls),
      options: { rerank: false, neighboursPerHit: 0 },
    });
    // **The last call is the answer**, because a rerank would have been an earlier one.
    const prompt = calls.at(-1)!;
    expect(prompt).toContain('where is the token parsed');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('Cite only numbers that appear above');
  });

  it('reports a latency for every outcome', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({ question: 'parse token', store, search });
    expect(result.stats.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Paths back into the graph
// ---------------------------------------------------------------------------

describe('nodesForFiles', () => {
  it('returns the nodes in the named files, ordered by identity', () => {
    const { store } = buildFixture();
    // **Three files, so the ordering is actually exercised**: a one-element list would pass for a function that
    // returned its input unsorted, which is the shape a comparator bug hides in.
    const nodes = nodesForFiles(store, ['app/views.py', 'app/auth.py', 'app/cookies.py']);
    expect(nodes.map((node) => node.name).sort()).toEqual(['login', 'parse_token', 'set_cookie']);
    const ids = nodes.map((node) => node.id);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
  });

  it('returns nothing for a file the index does not hold', () => {
    const { store } = buildFixture();
    expect(nodesForFiles(store, ['app/nope.py'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rerank arm, and the closed set of reasons
// ---------------------------------------------------------------------------

/** A provider that answers each call with the next scripted line, and records the prompts. */
function scriptedProvider(lines: string[], prompts: string[] = []): LLMProvider {
  let index = 0;
  return {
    name: 'scripted',
    model: 'scripted-1',
    async complete(prompt: string): Promise<CompletionResult> {
      prompts.push(prompt);
      const content = lines[Math.min(index, lines.length - 1)] ?? '';
      index += 1;
      return {
        content,
        model: 'scripted-1',
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      };
    },
    async completeWithTools(): Promise<CompletionResult> {
      throw new Error('not used');
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

describe('askCodebase — the rerank arm', () => {
  it('reorders the fused list before assembling, and says so', async () => {
    const { store, search } = buildFixture();
    const prompts: string[] = [];
    const result = await askCodebase({
      question: 'parse token login cookie',
      store,
      search,
      // **First call is the rerank, second is the answer**: the rerank is asked for numbers, the answer for prose.
      provider: scriptedProvider(['[2] [1] [3]', 'see [2]'], prompts),
      options: { neighboursPerHit: 0 },
    });
    expect(result.notes.join(' ')).toContain('reordered by a listwise rerank');
    expect(prompts[0]).toContain('Order the candidates');
    expect(prompts.at(-1)).toContain('You are answering a question about a codebase');
    expect(result.abstained).toBeNull();
  });

  it('keeps the fused order when the model answers with nothing usable', async () => {
    const { store, search } = buildFixture();
    const result = await askCodebase({
      // **A question that matches more than one node**, because a list of one is not a list with an order - and the
      // case here is a rerank that produced nothing usable, not a rerank that was never asked for.
      question: 'parse token login cookie',
      store,
      search,
      provider: scriptedProvider(['not a list at all', 'answer [1]']),
      options: { neighboursPerHit: 0 },
    });
    expect(result.notes.join(' ')).toMatch(/kept its order/);
    expect(result.abstained).toBeNull();
  });

  it('reports every reason through the documented set', async () => {
    const { store, search } = buildFixture();
    const outcomes = await Promise.all([
      askCodebase({ question: 'parse token', store, search }),
      askCodebase({
        question: 'parse token',
        store,
        search,
        provider: scriptedProvider(['   ']),
        options: { rerank: false },
      }),
      askCodebase({
        question: 'parse token',
        store,
        search,
        provider: stubProvider(() => {
          throw new Error('boom');
        }),
        options: { rerank: false },
      }),
      askCodebase({
        question: 'parse token',
        store,
        search,
        provider: scriptedProvider(['nothing cited here']),
        options: { rerank: false },
      }),
      askCodebase({
        question: 'zzzzz nothing matches this',
        store: new InMemoryGraphStore(),
        search: (() => {
          const empty = new HybridSearchEngine(new InMemoryGraphStore());
          empty.initialize();
          return empty;
        })(),
      }),
    ]);
    const reasons = outcomes.map((outcome) => outcome.abstained);
    // **The set is closed**: a reason outside `ABSTAIN_REASONS` would be a string that reads like one.
    for (const reason of reasons) {
      if (reason === null) continue;
      expect(ABSTAIN_REASONS).toContain(reason);
    }
    expect(new Set(reasons.filter((reason) => reason !== null)).size).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// The semantic half and the project filter
// ---------------------------------------------------------------------------

describe('retrieveContext — the vector half and the project filter', () => {
  it('fuses the semantic list as well as the lexical one when vectors are registered', async () => {
    const { store, search } = buildFixture();
    // **A one-dimensional space**, because what is under test is that the second list is *read*, not that a cosine is
    // arithmetic - that is `hybrid-search`'s test.
    let called = 0;
    search.registerEmbeddings(
      () => Float32Array.from([1]),
      async () => {
        called += 1;
        return Float32Array.from([1]);
      },
    );
    const result = await retrieveContext({ question: 'parse token login', store, search });
    expect(called).toBeGreaterThan(0);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('drops the hits that belong to another project, before the rerank', async () => {
    const { store, search, ids } = buildFixture();
    // **A second workspace in the same store**, which is the cross-repository case: a hit from it would answer a
    // question about this project with code that is not here.
    store.insertNode({
      projectId: 'other',
      label: 'Function',
      name: 'parse_token',
      qualifiedName: 'other.parse_token',
      filePath: 'other/auth.py',
      startLine: 1,
      endLine: 8,
      language: 'python',
      properties: { body: 'def parse_token(raw): pass' },
      signature: 'def parse_token(raw):',
      complexity: null,
      isExported: true,
    } as never);
    // **The inverted index is built from the store at `initialize()`**, so a node inserted afterwards is invisible to
    // the lexical half until it is rebuilt - which is also the honest statement of what the product does.
    search.initialize();

    const unrestricted = await retrieveContext({ question: 'parse token', store, search });
    const restricted = await retrieveContext({
      question: 'parse token',
      store,
      search,
      projectId: 'qa',
    });
    expect(unrestricted.blocks.some((block) => block.filePath === 'other/auth.py')).toBe(true);
    expect(restricted.blocks.some((block) => block.filePath === 'other/auth.py')).toBe(false);
    expect(restricted.blocks.length).toBeGreaterThan(0);
    expect(ids['parse']).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The remaining edges: a timeout, a bodyless candidate, and a non-Error rejection
// ---------------------------------------------------------------------------

describe('askCodebase — defensive edges', () => {
  it('passes a caller-supplied timeout to both stages', async () => {
    const { store, search } = buildFixture();
    const seen: Array<number | undefined> = [];
    const provider: LLMProvider = {
      name: 'recording',
      model: 'recording-1',
      async complete(_prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
        seen.push(options?.timeout);
        return {
          content: seen.length === 1 ? '[1]' : 'see [1]',
          model: 'recording-1',
          createdAt: new Date().toISOString(),
          finishReason: 'stop',
        };
      },
      async completeWithTools(): Promise<CompletionResult> {
        throw new Error('not used');
      },
      async healthCheck(): Promise<boolean> {
        return true;
      },
    };
    await askCodebase({
      question: 'parse token login cookie',
      store,
      search,
      provider,
      options: { timeoutMs: 1_234, neighboursPerHit: 0 },
    });
    // **The budget is the caller's, at every stage**: a rerank that ran on the default while the answer ran on the
    // caller's number would make the stated timeout a half-truth.
    expect(seen).toEqual([1_234, 1_234]);
  });

  it('gives the reranker a null excerpt for a candidate whose provider recorded no body', async () => {
    const { store, search } = buildFixture();
    store.insertNode({
      projectId: 'qa',
      label: 'Function',
      name: 'parse_token_meta',
      qualifiedName: 'app.auth.parse_token_meta',
      filePath: 'app/meta.py',
      startLine: 1,
      endLine: 3,
      language: 'python',
      properties: {},
      signature: 'def parse_token_meta():',
      complexity: null,
      isExported: true,
    } as never);
    search.initialize();
    const result = await askCodebase({
      question: 'parse token meta login',
      store,
      search,
      provider: scriptedProvider(['[1]', 'see [1]']),
      options: { neighboursPerHit: 0 },
    });
    expect(result.context.length).toBeGreaterThan(1);
    expect(result.abstained).toBeNull();
  });

  it('reports a rejection that is not an Error', async () => {
    const { store, search } = buildFixture();
    const provider = {
      name: 'string-thrower',
      model: 'string-thrower-1',
      async complete(): Promise<CompletionResult> {
        // **A `throw` of a string is permitted by the language** and a transport library may do it, so the formatter
        // must not assume an `Error` - `String(error)` is the arm for it. The lint rule that forbids it is right about
        // production code and wrong about this test, which exists to exercise the formatter's other arm.
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the subject of the test is a non-Error rejection
        throw 'upstream said no';
      },
      async completeWithTools(): Promise<CompletionResult> {
        throw new Error('not used');
      },
      async healthCheck(): Promise<boolean> {
        return true;
      },
    } as LLMProvider;
    const result = await askCodebase({
      question: 'parse token',
      store,
      search,
      provider,
      options: { rerank: false },
    });
    expect(result.abstained).toBe('provider-failed');
    expect(result.notes.join(' ')).toContain('upstream said no');
  });
});

// ---------------------------------------------------------------------------
// The repository a question names
// ---------------------------------------------------------------------------

/**
 * Two repositories in one store, each with the vocabulary a question about the other would use.
 *
 * **The collision is the point**: `express`'s mount function and `werkzeug`'s middleware class share the word
 * "middleware", and the workspace has to decide which of them the question is about from the question itself.
 */
function buildTwoProjects(): { store: InMemoryGraphStore; search: HybridSearchEngine } {
  const store = new InMemoryGraphStore();
  const insert = (projectId: string, name: string, filePath: string, body: string): void => {
    store.insertNode({
      projectId,
      label: 'Function',
      name,
      qualifiedName: `project:${projectId}:${filePath}:${name}`,
      filePath,
      startLine: 10,
      endLine: 20,
      language: projectId === 'expressjs/express' ? 'javascript' : 'python',
      properties: { body, docstring: body },
      signature: null,
      docstring: body,
      complexity: null,
      isExported: true,
    } as never);
  };

  insert(
    'expressjs/express',
    'use',
    'lib/application.js',
    'add middleware to the app router and mount a route handler on a path',
  );
  insert(
    'pallets/werkzeug',
    'DispatcherMiddleware',
    'src/werkzeug/middleware/dispatcher.py',
    'Dispatch to another middleware application mounted at a path',
  );

  const search = new HybridSearchEngine(store);
  search.initialize();
  return { store, search };
}

describe('the scope a question implies', () => {
  const QUESTION = 'where does express mount a middleware route handler';

  it('narrows the workspace to the repository the question names', async () => {
    // **The measured failure this exists for**: on four released checkouts the express node that answers a question
    // about mounting middleware ranked 22nd, because another repository in the same workspace is a library whose every
    // module is named after a kind of middleware. The name in the question is the one signal the product already has.
    const { store, search } = buildTwoProjects();
    const result = await askCodebase({
      question: QUESTION,
      store,
      search,
      options: { generate: false },
    });
    expect(result.scope).toEqual({
      projectId: 'expressjs/express',
      because: 'named in the question',
    });
    expect(result.context.length).toBeGreaterThan(0);
    for (const block of result.context) {
      expect(block.qualifiedName).toContain('project:expressjs/express:');
    }
  });

  it('says so in the notes, because a restriction a caller cannot see is a bug', async () => {
    const { store, search } = buildTwoProjects();
    const result = await askCodebase({
      question: QUESTION,
      store,
      search,
      options: { generate: false },
    });
    expect(result.notes).toContain(
      'the question names expressjs/express, so the workspace was narrowed to it',
    );
  });

  it('searches every repository when the question names none', async () => {
    const { store, search } = buildTwoProjects();
    const result = await askCodebase({
      question: 'where is a middleware handler mounted on a path',
      store,
      search,
      options: { generate: false },
    });
    expect(result.scope).toBeNull();
    const projects = new Set(result.context.map((block) => block.qualifiedName.split(':')[1]));
    expect(projects.size).toBe(2);
  });

  it('searches every repository when the caller asks for the workspace', async () => {
    // **The escape hatch**: a caller that wants a sweep of a question that happens to mention a repository passes
    // `scope: 'workspace'`, and the result says it searched everything.
    const { store, search } = buildTwoProjects();
    const result = await askCodebase({
      question: QUESTION,
      store,
      search,
      options: { generate: false, scope: 'workspace' },
    });
    expect(result.scope).toBeNull();
    expect(result.notes).not.toContain(
      'the question names expressjs/express, so the workspace was narrowed to it',
    );
  });

  it('lets an explicit projectId win over the name in the question', async () => {
    // **A caller that decided is not second-guessed**, and the report says the restriction was its idea rather than
    // the question's.
    const { store, search } = buildTwoProjects();
    const result = await askCodebase({
      question: QUESTION,
      store,
      search,
      projectId: 'pallets/werkzeug',
      options: { generate: false },
    });
    expect(result.scope).toEqual({
      projectId: 'pallets/werkzeug',
      because: 'requested by the caller',
    });
  });

  it('does not narrow a single-repository store, where there is nothing to choose', async () => {
    const fixture = buildFixture();
    const result = await askCodebase({
      question: 'where is the token parsed',
      store: fixture.store,
      search: fixture.search,
      options: { generate: false },
    });
    expect(result.scope).toBeNull();
  });

  it('reports the scope from the retrieval arm as well as from the answer', async () => {
    // **`retrieveContext` is the exported half of the pipeline**, and a measurement that reads it has to be able to
    // say which repository it searched.
    const { store, search } = buildTwoProjects();
    const context = await retrieveContext({ question: QUESTION, store, search });
    expect(context.scope?.projectId).toBe('expressjs/express');
  });
});
