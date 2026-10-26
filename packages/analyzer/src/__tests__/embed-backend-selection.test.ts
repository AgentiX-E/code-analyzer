// Which embedding backend a run uses, and why it is not the one that was there.
//
// **Both success arms were unreachable from a test, and that is a fact about the machine rather than about the code**:
// the ONNX backend needs a 137MB model that the published package does not ship, and the API backend needs a key.
// **The seam closes that without mocking anything**: the two loaders are parameters with the production defaults, so
// "the ONNX backend won", "the API backend won" and "neither did, and here is both reasons" become three ordinary
// cases that run anywhere.
//
// **The reason string is the part that matters commercially.** A report that says *"no embeddings"* is a report nobody
// can act on, and the field that says *which* backend produced a vector is the field whose absence once let a lexical
// figure be quoted as a semantic one.

import { describe, expect, it } from 'vitest';

import {
  embedderUnavailableReason,
  generateEmbeddings,
  loadEmbedder,
  loadRealEmbedder,
} from '../pipeline/phases/embed.js';

import type { Embedder } from '../pipeline/phases/embed.js';
import type { KnowledgeGraph } from '@code-analyzer/shared';

function embedderOf(tag: number): Embedder {
  const vector = () => Float32Array.from([tag, 0, 0]);
  return {
    embed: async () => vector(),
    embedBatch: async (texts: string[]) => texts.map(() => vector()),
    dispose: async () => undefined,
  };
}

/** Two named nodes, which is all `generateEmbeddings` needs to have something to embed. */
function graphWithTwoNodes(): KnowledgeGraph {
  const node = (id: number, name: string) => ({
    id,
    projectId: 'p',
    label: 'Function',
    name,
    qualifiedName: `p:src/a.ts:${name}`,
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 2,
    language: 'TypeScript',
    properties: {},
  });
  return {
    nodes: new Map([
      [1, node(1, 'alpha')],
      [2, node(2, 'beta')],
    ]),
    edges: new Map(),
  } as unknown as KnowledgeGraph;
}

describe('choosing a backend', () => {
  // **First in the file on purpose**: it asserts what the two placeholders say when *neither* loader has recorded a
  // reason, and the reason is module state that every later case writes. **A loader that returns null without saying
  // why is a state the seam allows** - and a report that reads "onnx: undefined · api: undefined" is a report that
  // explains nothing, which is the failure this message was added to end.
  it('says a loader gave no reason, rather than reporting none at all', async () => {
    const chosen = await loadEmbedder(
      async () => null,
      async () => null,
    );

    expect(chosen).toBeNull();
    expect(embedderUnavailableReason()).toContain(
      'the ONNX embedder returned null without a reason',
    );
    expect(embedderUnavailableReason()).toContain(
      'the API embedder returned null without a reason',
    );
  });

  it('prefers the ONNX backend when it loads, because it needs no network and no key', async () => {
    const chosen = await loadEmbedder(
      async () => embedderOf(1),
      async () => null,
    );

    expect(chosen?.backend).toBe('onnx');
  });

  it('falls back to the API backend when the ONNX model is absent', async () => {
    const chosen = await loadEmbedder(
      async () => null,
      async () => ({ embedder: embedderOf(2), backend: 'api' as const }),
    );

    expect(chosen?.backend).toBe('api');
  });

  it('tries the real API loader when no loader is injected', async () => {
    // **The default is the production path**, and it is the operand of a `??` that a test with an injected loader never
    // reaches. `ZHIPU_API_KEY` is removed for the duration, because the question here is what the *default* does on a
    // machine that has no key - and a key present in CI would turn this case into a network call.
    const saved = process.env['ZHIPU_API_KEY'];
    delete process.env['ZHIPU_API_KEY'];
    try {
      const chosen = await loadEmbedder(async () => null);

      expect(chosen).toBeNull();
      expect(embedderUnavailableReason()).toMatch(/ZHIPU_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env['ZHIPU_API_KEY'] = saved;
    }
  });

  it('reports both reasons when neither backend loads', async () => {
    // **The losing backend's reason is the evidence for the conclusion**, and one message naming only the last
    // attempt hides half the answer.
    const chosen = await loadEmbedder(
      async () => null,
      async () => null,
    );

    expect(chosen).toBeNull();
    expect(embedderUnavailableReason()).toMatch(/onnx:/);
    expect(embedderUnavailableReason()).toMatch(/api:/);
  });
});

describe('generating vectors', () => {
  it('uses the injected embedder and reports which backend ran', async () => {
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => ({
      backend: 'onnx' as const,
      embedder: embedderOf(3),
    }));

    expect(result.backend).toBe('onnx');
    expect(result.results.length).toBe(2);
    expect(result.results[0]!.embedding[0]).toBe(3);
  });

  it('falls back to the deterministic embedding when no backend loads, and says why', async () => {
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => null);

    expect(result.backend).toBe('deterministic');
    expect(result.reason).toBeTruthy();
    expect(result.results.length).toBe(2);
  });

  it('reports a loader that throws something other than an Error', async () => {
    // **A `throw` of a string is legal JavaScript**, and the message is what a report has to show; an
    // `error instanceof Error ? … : String(error)` that only ever saw `Error`s had never been asked.
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => {
      // A string, which is what a loader written without `Error` in mind produces; the phase has to record it.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'model file missing';
    });

    expect(result.backend).toBe('deterministic');
    expect(result.reason).toContain('model file missing');
  });

  it('records the message of a loader that throws an Error', async () => {
    // **The other arm of the same report**: a loader written with `Error` in mind is the ordinary case, and its
    // `message` is what the reason carries.
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => {
      throw new Error('model file missing');
    });

    expect(result.backend).toBe('deterministic');
    expect(result.reason).toContain('model file missing');
  });

  it('embeds a signature beside the label and the name', async () => {
    // **A signature is the most distinctive text a function has**: `label + name` for two overloads of one method is
    // the same string, and the parameters are what tells them apart in a similarity search.
    const nodes = new Map<number, unknown>([
      [
        1,
        {
          id: 1,
          label: 'Method',
          name: 'handle',
          properties: { signature: 'handle(id: string): Promise<void>' },
        },
      ],
    ]);

    let seen: string[] = [];
    const recorder: Embedder = {
      embed: async () => Float32Array.from([0, 1]),
      embedBatch: async (texts: string[]) => {
        seen = texts;
        return texts.map(() => Float32Array.from([0, 1]));
      },
      dispose: async () => undefined,
    };

    await generateEmbeddings(nodes as never, async () => ({
      backend: 'onnx' as const,
      embedder: recorder,
    }));

    expect(seen).toEqual(['Method handle handle(id: string): Promise<void>']);
  });

  it('skips the nodes that carry no text of their own', async () => {
    // **A file, a folder, a package and a nameless node are not embeddable** - embedding them would put a vector on a
    // container whose contents are already vectors.
    const nodes = new Map<number, unknown>([
      [1, { id: 1, label: 'File', name: 'a.ts', properties: {} }],
      [2, { id: 2, label: 'Folder', name: 'src', properties: {} }],
      [3, { id: 3, label: 'Function', name: '', properties: {} }],
      [4, { id: 4, label: 'Function', name: 'real', properties: {} }],
    ]);

    const result = await generateEmbeddings(nodes as never, async () => ({
      backend: 'onnx' as const,
      embedder: embedderOf(5),
    }));

    expect(result.results.map((r) => r.nodeId)).toEqual([4]);
  });

  it('keeps the results it has when the backend returns fewer vectors than texts', async () => {
    // **A backend that answers short is a failure the caller must see as a shorter result**, not as an exception that
    // loses the whole run - the per-node fallback below it exists for exactly this.
    const short: Embedder = {
      embed: async () => Float32Array.from([1, 0, 0]),
      embedBatch: async () => [Float32Array.from([1, 0, 0])],
      dispose: async () => undefined,
    };

    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => ({
      backend: 'onnx' as const,
      embedder: short,
    }));

    expect(result.results).toHaveLength(1);
    expect(result.backend).toBe('onnx');
  });

  it('reports a deterministic result for a graph with nothing to embed', async () => {
    const result = await generateEmbeddings(new Map(), async () => ({
      backend: 'onnx' as const,
      embedder: embedderOf(1),
    }));

    expect(result.backend).toBe('deterministic');
    expect(result.results).toEqual([]);
  });
});

// The packaged ONNX loader, called the way production calls it.
//
// **Every other case injects a loader**, so the one function that would run on a developer's machine had never run in a
// test. It is a real question with a real answer here: **the published `@agentix-e/embed-code-node` declares
// `files: ['dist', 'models']` and ships no `models/`**, so `createFromPackage()` throws on every machine and the
// loader's job is to **say which file is missing** rather than to return a silent null.
describe('the packaged ONNX loader', () => {
  it('returns null and records why, rather than throwing into the pipeline', async () => {
    const embedder = await loadRealEmbedder();

    expect(embedder).toBeNull();
    // **The message names the failure**, and the phase carries it out as the reason a run used the fallback.
    expect(embedderUnavailableReason()).toMatch(/createFromPackage failed|embed-code-node/);
  });

  it('leaves the last failure readable after the attempt', () => {
    // The reason is module state, so a caller asks after the call rather than receiving it as a return value.
    expect(embedderUnavailableReason()).toBeTruthy();
  });

  it('returns the embedder when the package can build one', async () => {
    // **The success arm no machine in this repository can reach**: it needs the 137MB model, so the seam is the only
    // instrument. **What is under test is the branch** - that a module whose `createFromPackage()` resolves is
    // returned, and that the failure record is cleared rather than left describing the previous attempt.
    const built = embedderOf(7);
    const loaded = await loadRealEmbedder(async () => ({
      NodeEmbedder: { createFromPackage: async () => built },
    }));

    expect(loaded).toBe(built);
    expect(embedderUnavailableReason()).toBeNull();
  });

  it('reports a package whose factory throws a string', async () => {
    // **A native addon is not obliged to throw `Error`**, and `String(err)` is the arm that keeps such a throw from
    // becoming `[object Object]` in the one message that explains why a run used the fallback.
    const loaded = await loadRealEmbedder(async () => ({
      NodeEmbedder: {
        createFromPackage: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'Tokenizer not found';
        },
      },
    }));

    expect(loaded).toBeNull();
    expect(embedderUnavailableReason()).toContain('Tokenizer not found');
  });

  it('reports an import that fails, and one that fails with something other than an Error', async () => {
    // **The outer `catch` is the whole point of the loader**: a package that cannot be imported must read as an absent
    // backend with a reason, not as a crash in the middle of an indexing run.
    const withError = await loadRealEmbedder(async () => {
      throw new Error('Cannot find module');
    });
    expect(withError).toBeNull();
    expect(embedderUnavailableReason()).toContain('could not be imported');
    expect(embedderUnavailableReason()).toContain('Cannot find module');

    const withString = await loadRealEmbedder(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'loader exploded';
    });
    expect(withString).toBeNull();
    expect(embedderUnavailableReason()).toContain('loader exploded');
  });
});
