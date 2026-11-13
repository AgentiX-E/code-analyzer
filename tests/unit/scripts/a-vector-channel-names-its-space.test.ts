// **A vector channel that does not say which space it used cannot be compared with anything.**
//
// Iteration 135 moved the cross-repository paraphrase condition from 0.3870 to 0.8010 found@10 by replacing one call
// site, and what was left - 89 of 447 questions - is the part no lexical channel reaches. The product has had a vector
// channel for many iterations (`registerEmbeddings`, reciprocal-rank fusion, `deriveVectorWeight`) and **no figure on
// this corpus**, because both multi-repository scripts measured the lexical half alone.
//
// `scripts/lib/multirepo-harness.ts` now builds that channel, and this file holds the three properties a semantic
// figure depends on:
//
//   1. **The index and the queries come from one loader**, so the cosine is between two vectors of one space rather
//      than two vectors that happen to have the same length. This project has already published a 0.638 that was
//      exactly that defect.
//   2. **A run with no model says so** - the space is `deterministic` and the caller refuses the figure - instead of
//      reporting the lexical number under a semantic name.
//   3. **A question is embedded once however many conditions ask it**, which is what makes a four-column run cost the
//      same as a one-column run.
//
// None of these is visible in a retrieval figure, and all three can be false while the figure looks plausible.

import { describe, expect, it } from 'vitest';

import { InMemoryGraphStore, type InMemoryGraphStore as Store } from '@code-analyzer/infra';
import { embedWorkspace, type Workspace } from '../../../scripts/lib/multirepo-harness.js';

import type { Embedder } from '@code-analyzer/analyzer';

/** Two dimensions, so a vector is a point on a unit circle and equality is checkable by hand. */
const DIMENSIONS = 2;

/**
 * A stand-in model: **a deterministic function of the text**, so two runs produce the same vectors and a test can assert
 * on them. What the loader *reports* as its backend is the loader's business and is set per test, because that name is
 * what the channel copies into its `space` block and therefore what the test is checking.
 */
function fakeEmbedder(calls: string[]): Embedder {
  return {
    embed: async (text: string) => {
      calls.push(text);
      const seed = text.length % DIMENSIONS;
      const vector = new Float32Array(DIMENSIONS);
      vector[seed] = 1;
      return vector;
    },
    embedBatch: async (texts: string[]) => {
      const out: Float32Array[] = [];
      for (const text of texts) {
        calls.push(text);
        const vector = new Float32Array(DIMENSIONS);
        vector[text.length % DIMENSIONS] = 1;
        out.push(vector);
      }
      return out;
    },
    dispose: async () => undefined,
  };
}

function node(name: string, projectId: string): Parameters<Store['insertNode']>[0] {
  return {
    projectId,
    label: 'Function',
    name,
    qualifiedName: `${projectId}:src/${name}.ts:${name}`,
    filePath: `src/${name}.ts`,
    startLine: 1,
    endLine: 4,
    language: 'typescript',
    properties: {
      name,
      filePath: `src/${name}.ts`,
      startLine: 1,
      endLine: 4,
      language: 'typescript',
    },
    signature: `function ${name}(): void`,
    docstring: `Does the ${name} thing, at length, so that it is a candidate.`,
    complexity: 1,
    isExported: true,
    fingerprint: null,
  };
}

/** A workspace over three declarations, built by hand: this file measures the channel, not the indexer. */
function workspaceWith(names: string[]): Workspace {
  const store = new InMemoryGraphStore();
  for (const name of names) store.insertNode(node(name, 'AgentiX-E/repo'));
  return {
    store,
    manager: undefined as unknown as Workspace['manager'],
    index: {
      reposIndexed: 1,
      totalNodes: names.length,
      totalEdges: 0,
      crossRepoEdges: 0,
      errors: [],
    },
    indexMs: 0,
  };
}

describe('the vector channel the cross-repository measurement never had', () => {
  it('builds both sides from one loader, and reports the space it used', async () => {
    const workspace = workspaceWith(['alpha', 'beta', 'gamma']);
    const calls: string[] = [];

    const channel = await embedWorkspace(workspace, {
      model: 'test-embed',
      loader: async () => ({ embedder: fakeEmbedder(calls), backend: 'api' }),
    });

    expect(channel).not.toBeNull();
    // **The two sides are the same space or there is no channel**, and the space is the loader's own name rather than
    // a constant: an index labelled `onnx` because it was once the only backend is a label a reader cannot check.
    expect(channel!.index).toBe('api');
    expect(channel!.query).toBe('api');
    expect(channel!.model).toBe('test-embed');
    expect(channel!.reason).toBeNull();
    // One vector per declaration, and the labels a question can answer with are the ones that got one.
    expect(channel!.vectors).toBe(3);
  });

  it('answers a lookup for every declaration and nothing for a node it did not embed', async () => {
    const workspace = workspaceWith(['alpha', 'beta']);
    const channel = await embedWorkspace(workspace, {
      loader: async () => ({ embedder: fakeEmbedder([]), backend: 'api' }),
    });

    const ids = workspace.store.getAllNodes().map((stored) => stored.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const vector = channel!.lookup(id);
      expect(vector).toBeInstanceOf(Float32Array);
      expect(vector!.length).toBe(DIMENSIONS);
    }
    // **A miss is `null` and not a zero vector**, because a zero vector has a cosine of zero with everything and would
    // read as "unrelated" rather than "not in the index".
    expect(channel!.lookup(999_999)).toBeNull();
  });

  it('embeds a question once, however many conditions ask it', async () => {
    const workspace = workspaceWith(['alpha']);
    const calls: string[] = [];
    const channel = await embedWorkspace(workspace, {
      loader: async () => ({ embedder: fakeEmbedder(calls), backend: 'api' }),
    });
    const afterIndex = calls.length;

    // The same question asked of four repositories open and then of one - which is exactly what the script does, twice
    // per question, for every condition that has vectors registered.
    const first = await channel!.embed('how does the alpha thing work');
    const second = await channel!.embed('how does the alpha thing work');
    const other = await channel!.embed('how does the beta thing work');

    expect(calls.length).toBe(afterIndex + 2);
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it('calls a run with no model deterministic, and leaves the refusal to the caller', async () => {
    const workspace = workspaceWith(['alpha']);
    const channel = await embedWorkspace(workspace, { loader: async () => null });

    // **The phase falls back to a hash of the text**, which is reproducible without a model and is therefore usable
    // offline - and is not a semantic channel. The name is what lets `--embed` refuse the figure instead of publishing
    // a lexical number under a semantic label.
    expect(channel).not.toBeNull();
    expect(channel!.index).toBe('deterministic');
    expect(channel!.query).toBe('deterministic');
    // No model's name, because no model ran. `null` here is a statement and not a missing field.
    expect(channel!.model).toBeNull();
  });

  it('carries the reason a backend could not be loaded into the artifact it produces', async () => {
    const workspace = workspaceWith(['alpha']);
    const channel = await embedWorkspace(workspace, {
      loader: async () => {
        throw new Error('models/ is not in the published package');
      },
    });

    // **The same sentence `embedding-backend.yml` prints**, so a reader of a fallback export does not have to infer
    // which of the two absences produced it.
    expect(channel!.index).toBe('deterministic');
    expect(channel!.reason).toContain('models/ is not in the published package');
  });
});
