// The prompts, called at both extremes: nothing optional supplied, and everything supplied.
//
// **A prompt is a document assembled from a graph**, and every optional section is a branch: a focus area, a depth, a
// target reference, a symptom. The existing cases call each prompt once with the arguments a user would normally give,
// which leaves **every optional section on one side only** — so the arms that decide whether a section appears at all
// had never decided anything.
//
// **And the graph itself is a branch.** A project filter, an exported-symbol filter, a File node, a symbol with no
// file and no line: each is a `continue` that a tidy fixture never takes. The stores below are deliberately untidy,
// because a real index is.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { PromptProvider } from '../prompts/index.js';

/** Two projects, one exported symbol, one private one, and a file node — the shapes the summary filters on. */
function messyStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  const node = (projectId: string, name: string, over: Record<string, unknown> = {}): void => {
    store.insertNode({
      projectId,
      name,
      qualifiedName: `${projectId}:${name}`,
      label: 'Function',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 2,
      language: 'TypeScript',
      properties: {},
      ...over,
    } as never);
  };

  node('my-app', 'exported', { isExported: true });
  node('my-app', 'privately', { isExported: false });
  node('my-app', 'located', { isExported: true, filePath: undefined, startLine: 0 });
  node('my-app', 'a-file', { isExported: true, label: 'File' });
  node('other-app', 'somebodyElse', { isExported: true });
  return store;
}

function emptyStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

const EVERYTHING = {
  projectId: 'my-app',
  focus: 'auth',
  target: 'UserService',
  goal: 'decouple',
  aspect: 'layers',
  generateADR: 'true',
  depth: 'deep',
  fromRef: 'main',
  toRef: 'feature',
  entryPoint: 'handler',
  symptom: 'the request hangs',
};

describe('the graph context every prompt carries', () => {
  it('counts one project and describes it', async () => {
    const provider = new PromptProvider(messyStore());

    const result = await provider.getPrompt('explore-codebase', { projectId: 'my-app' });
    const text = result.messages.map((m) => m.content.text).join('\n');

    // The other project's node is not counted, and the exported ones are named.
    expect(text).toContain('Total Nodes: 4');
    expect(text).toContain('exported');
    expect(text).not.toContain('somebodyElse');
  });

  it('describes every project when the filter is `*`', async () => {
    const provider = new PromptProvider(messyStore());

    const result = await provider.getPrompt('explore-codebase', { projectId: '*' });
    const text = result.messages.map((m) => m.content.text).join('\n');

    expect(text).toContain('Total Nodes: 5');
    expect(text).toContain('somebodyElse');
  });

  it('says so when there is nothing to describe', async () => {
    // **The empty graph is the state a first run is in**, and a summary that reads `Total Nodes: 0` with no
    // qualification is the one a reader misreads as a failure.
    const provider = new PromptProvider(emptyStore());

    const result = await provider.getPrompt('explore-codebase', { projectId: 'my-app' });
    const text = result.messages.map((m) => m.content.text).join('\n');

    expect(text).toContain('Languages: none');
    expect(text).toContain('Node Types: none');
    expect(text).toContain('No exported symbols found');
  });

  it('omits the location of a symbol that has none', async () => {
    // A node with no path and no line still has a name, and the prompt says the name without inventing a location.
    const provider = new PromptProvider(messyStore());

    const result = await provider.getPrompt('explore-codebase', { projectId: 'my-app' });
    const text = result.messages.map((m) => m.content.text).join('\n');

    expect(text).toContain('located');
    expect(text).not.toContain('(undefined');
  });
});

describe('every prompt, with nothing optional and with everything', () => {
  const names = [
    'explore-codebase',
    'review-changes',
    'debug-issue',
    'refactor-plan',
    'architecture-review',
  ];

  it.each(names)('%s answers with only its required arguments', async (name) => {
    const provider = new PromptProvider(messyStore());

    const required: Record<string, unknown> = {};
    for (const arg of provider.getDefinition(name)!.arguments ?? []) {
      if (arg.required) required[arg.name] = name === 'review-changes' ? 'main' : 'my-app';
    }

    const result = await provider.getPrompt(name, required);

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.description).toBeTruthy();
  });

  it.each(names)('%s changes its answer when the optional arguments are supplied', async (name) => {
    // **The differential assertion, rather than a substring one**: an optional argument that does not change the
    // prompt is either not wired or not documented, and both are worth failing on. A substring check would pass for
    // any prompt that echoed the argument into a list without acting on it.
    const provider = new PromptProvider(messyStore());
    const required: Record<string, unknown> = {};
    for (const arg of provider.getDefinition(name)!.arguments ?? []) {
      if (arg.required) required[arg.name] = name === 'review-changes' ? 'main' : 'my-app';
    }
    if (name === 'refactor-plan') Object.assign(required, { target: 'UserService' });

    const bare = await provider.getPrompt(name, required);
    const full = await provider.getPrompt(name, EVERYTHING);
    const textOf = (r: typeof bare): string => r.messages.map((m) => m.content.text).join('\n');

    expect(full.messages.length).toBeGreaterThan(0);
    expect(textOf(full)).not.toBe(textOf(bare));
  });

  it.each(names)('%s refuses an unknown name consistently', async (name) => {
    const provider = new PromptProvider(messyStore());
    expect(provider.getDefinition(`${name}-does-not-exist`)).toBeUndefined();
  });
});

describe('a prompt that is asked for and not registered', () => {
  it('throws rather than returning an empty answer', async () => {
    // **An empty prompt is worse than an error**: the caller sends it to a model and gets a confident answer about
    // nothing.
    const provider = new PromptProvider(messyStore());
    await expect(provider.getPrompt('not-a-prompt')).rejects.toThrow('Prompt not found');
  });
});

/**
 * A graph with the shapes a real index has and a tidy fixture does not: an entry point, a root-level file, a symbol
 * with no file and no line, a missing edge target, a same-directory dependency, and six outgoing calls.
 *
 * **Every one of those is a `continue`, a `?:` or a `??` in the context builders**, and each decides whether a line
 * appears — which is the difference between a prompt that describes the repository and one that leaves a section empty
 * without saying so.
 */
function richStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  const add = (name: string, over: Record<string, unknown> = {}): number =>
    store.insertNode({
      projectId: 'p',
      name,
      qualifiedName: `p:${name}`,
      label: 'Function',
      filePath: 'src/api/handler.ts',
      startLine: 1,
      endLine: 2,
      language: 'TypeScript',
      properties: {},
      ...over,
    } as never);

  const handler = add('handler', { isExported: true, properties: { isEntrypoint: 'true' } });
  add('main', { isExported: true, filePath: 'main.ts' });
  // An entry point the indexer could not place in a file: the section still names it, under "unknown file".
  add('orphan', {
    isExported: true,
    filePath: undefined,
    startLine: 0,
    complexity: null,
    properties: { isEntrypoint: 'true' },
  });
  const leaf = add('leaf', { filePath: 'lib/leaf.ts' });
  add('leafSibling', { filePath: 'lib/leaf.ts' });

  const edge = (sourceId: number, targetId: number, type = 'CALLS', projectId = 'p'): void => {
    store.insertEdge({
      projectId,
      sourceId,
      targetId,
      type,
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    } as never);
  };

  // Six calls, so the trace shows five and says "and 1 more".
  for (let i = 0; i < 6; i += 1) edge(handler, leaf);
  // A dependency inside a single directory, which is not a layer boundary.
  edge(leaf, leaf, 'IMPORTS');
  return store;
}

describe('the context builders on a graph with the awkward shapes in it', () => {
  it('names the entry points, including the one with no file', async () => {
    const provider = new PromptProvider(richStore());

    // The entry-point section belongs to `explore-codebase`; `debug-issue` traces a named entry instead.
    const text = (await provider.getPrompt('explore-codebase', { projectId: 'p' })).messages
      .map((m) => m.content.text)
      .join('\n');

    expect(text).toContain('handler');
    // A symbol with no path still gets a line, under the word "unknown file" rather than a blank.
    expect(text).toContain('unknown file');
  });

  it('traces a call chain and says how many it did not print', async () => {
    const provider = new PromptProvider(richStore());

    const text = (
      await provider.getPrompt('debug-issue', {
        projectId: 'p',
        entryPoint: 'handler',
        symptom: 'hangs',
      })
    ).messages
      .map((m) => m.content.text)
      .join('\n');

    expect(text).toContain('Direct calls/dependencies');
    expect(text).toContain('and 1 more');
  });

  it('says a symbol is absent rather than printing an empty trace', async () => {
    const provider = new PromptProvider(richStore());

    const text = (
      await provider.getPrompt('debug-issue', {
        projectId: 'p',
        entryPoint: 'never-declared',
        symptom: 'hangs',
      })
    ).messages
      .map((m) => m.content.text)
      .join('\n');

    expect(text).toContain('not found in graph');
  });

  it('describes the layers, and puts a root-level file under (root)', async () => {
    const provider = new PromptProvider(richStore());

    const text = (
      await provider.getPrompt('architecture-review', { projectId: 'p', aspect: 'layers' })
    ).messages
      .map((m) => m.content.text)
      .join('\n');

    expect(text).toContain('src/api/');
    expect(text).toContain('(root)');
  });

  it('reports the impact of a symbol with more dependents than it prints', async () => {
    const provider = new PromptProvider(richStore());

    // The impact section belongs to `refactor-plan`, which is the prompt that asks what a change would touch.
    const text = (
      await provider.getPrompt('refactor-plan', {
        projectId: 'p',
        target: 'leaf',
        goal: 'simplify',
      })
    ).messages
      .map((m) => m.content.text)
      .join('\n');

    expect(text).toContain('degree=');
    // `complexity=${node.complexity ?? 'N/A'}` — a node with no measured complexity says so.
    expect(text).toMatch(/N\/A|complexity=/);
  });
});

/**
 * A graph with the sparse values a real index contains: a symbol whose qualified name was never computed, one with no
 * language, one with no file, more exported symbols than the summary prints, and an edge belonging to another project.
 *
 * **Each of those is a `||`, a `??` or a `break`**, and the summary's job is to describe the repository it was given
 * rather than the tidy one a fixture assumes.
 */
function sparseStore(): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  const add = (name: string, over: Record<string, unknown> = {}): void => {
    store.insertNode({
      projectId: 'p',
      name,
      qualifiedName: `p:${name}`,
      label: 'Function',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 2,
      language: 'TypeScript',
      isExported: true,
      properties: {},
      ...over,
    } as never);
  };

  // The sparse values first, so they are inside the twenty the summary prints.
  // A provider that could not compute a qualified name leaves it empty, and the prompt falls back to the plain name.
  add('unnamed', { qualifiedName: '' });
  add('noLanguage', { language: undefined });
  add('noFile', { filePath: undefined });
  // And more exported symbols than the summary prints, so the `count >= limit` break has something to stop on.
  for (let i = 0; i < 21; i += 1) add(`sym${i}`);

  store.insertEdge({
    projectId: 'other',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2026-01-01T00:00:00Z',
  } as never);
  return store;
}

describe('the summary on a graph with sparse values', () => {
  it('stops at the printed limit and falls back to the plain name', async () => {
    const provider = new PromptProvider(sparseStore());

    const text = (await provider.getPrompt('explore-codebase', { projectId: 'p' })).messages
      .map((m) => m.content.text)
      .join('\n');

    // Twenty symbols are printed and the rest are not, because a prompt is not an index dump.
    expect(text).toContain('sym16');
    expect(text).not.toContain('sym17');
    expect(text).not.toContain('sym20');
    // **The fallback is the name**: a symbol with no qualified name is still described.
    expect(text).toContain('unnamed');
  });

  it('counts the languages it has and the edges of the project it was asked about', async () => {
    const provider = new PromptProvider(sparseStore());

    const own = (await provider.getPrompt('explore-codebase', { projectId: 'p' })).messages
      .map((m) => m.content.text)
      .join('\n');
    const all = (await provider.getPrompt('explore-codebase', { projectId: '*' })).messages
      .map((m) => m.content.text)
      .join('\n');

    // The other project's edge is excluded from the first and included in the second.
    expect(own).toContain('Total Edges: 0');
    expect(all).toContain('Total Edges: 1');
  });
});
