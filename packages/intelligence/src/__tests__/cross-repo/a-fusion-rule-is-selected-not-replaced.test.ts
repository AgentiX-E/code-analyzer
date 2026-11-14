// **A fusion rule is something a measurement selects, not something a candidate replaces.**
//
// §39 retired two candidate weights on a single question and the product kept the rule it had; §40 registers four
// mechanisms instead of five weights. The difference between a mechanism and a weight is that a mechanism is reached
// through the same call the product makes - **so this file tests the wiring, at the product's own surface, and leaves
// every figure to the artifact.**
//
// What it can hold without a model: naming the shipped rule reproduces the shipped order exactly, every candidate returns
// the same documents as the shipped rule (a rule that dropped what it disagreed with would score better by never being
// wrong about it), and the one candidate whose claim is structural - `combmnz` rewards documents both channels returned -
// actually does so through this call rather than only inside its own unit test.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { FederatedSearchEngine } from '../../cross-repo/federated-search.js';
import { FUSION_RULE_NAMES, fuseByRule } from '../../search/fusion-rules.js';

import type { GraphNode } from '@code-analyzer/shared';

let nextId = 1;

function node(projectId: string, name: string, docstring: string): GraphNode {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const filePath = `src/${name}.ts`;
  return {
    id: nextId++,
    projectId,
    label: 'Function',
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, filePath, startLine: 1, endLine: 5, language: 'typescript' },
    signature: `function ${name}(): void`,
    docstring,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as GraphNode;
}

/** A unit vector along one axis; different axes are orthogonal, which is a cosine of exactly zero. */
function axis(index: number, dimensions = 4): Float32Array {
  const vector = new Float32Array(dimensions);
  vector[index] = 1;
  return vector;
}

describe('the federated engine reaches a fusion rule through its own call', () => {
  const store = new InMemoryGraphStore();
  const shared = node('repo-a', 'startServer', 'Start the server.');
  const lexical = node('repo-a', 'startWorker', 'Start a worker thread.');
  const semanticOnly = node('repo-b', 'begin', 'Begin.');
  for (const item of [shared, lexical, semanticOnly]) store.insertNode(item);
  const ids = new Map(store.getAllNodes().map((stored) => [stored.name, stored.id]));

  const engine = new FederatedSearchEngine(store);
  engine.registerEmbeddings(
    (nodeId) =>
      nodeId === ids.get('begin')
        ? axis(0)
        : nodeId === ids.get('startServer')
          ? new Float32Array([0.8, 0.6, 0, 0])
          : new Float32Array([0.6, 0.8, 0, 0]),
    async () => axis(0),
  );

  const question = 'start server';

  it('returns the shipped order when the shipped rule is named', async () => {
    // **The branch has to be able to say "nothing changed"**, or the first candidate's win would be indistinguishable
    // from the branch having reordered something.
    const named = await engine.search(question, { maxResults: 10, fusionRule: 'rrf' });
    const shipped = await engine.search(question, { maxResults: 10 });
    expect(named.results.map((hit) => hit.symbol)).toEqual(
      shipped.results.map((hit) => hit.symbol),
    );
  });

  it('returns the same documents under every candidate rule', async () => {
    const shipped = await engine.search(question, { maxResults: 10 });
    for (const rule of FUSION_RULE_NAMES) {
      const candidate = await engine.search(question, { maxResults: 10, fusionRule: rule });
      expect(candidate.results.map((hit) => hit.symbol).sort(), rule).toEqual(
        shipped.results.map((hit) => hit.symbol).sort(),
      );
    }
  });

  it('reaches the rule itself rather than a rule of its own', async () => {
    // **The engine's candidate list must be the module's**, computed from the same two lists the engine fuses. A second
    // fusion path inside the engine would let an artifact report a rule that the product does not run.
    const channels = await engine.channels(question, { maxResults: 10 });
    const expected = fuseByRule('combmnz', channels.lexical, channels.vector, { limit: 10 });
    const answered = await engine.search(question, { maxResults: 10, fusionRule: 'combmnz' });
    expect(answered.results.map((hit) => hit.symbol)).toEqual(expected.map((hit) => hit.node.name));
  });

  it('reorders the same two lists under combmnz, which is what makes the mechanism measurable', async () => {
    // **A rule that agreed with the shipped one on this fixture would be a rule with nothing to measure.** Reciprocal
    // ranks put the two documents the lexical list answered first and second in that order, with the vector-only
    // document last; CombMNZ puts it second, because its z-score is the vector list's highest while `startWorker`'s is
    // its lowest **and the agreement multiplier doubles the second one**. That is a real property of the rule rather
    // than a bug in the fixture - CombMNZ rewards agreement in both directions - and it is exactly the kind of
    // property a corpus has to arbitrate, which is why the column exists and nothing is adopted here.
    const shipped = await engine.search(question, { maxResults: 10, vectorWeight: 1 });
    const combmnz = await engine.search(question, { maxResults: 10, fusionRule: 'combmnz' });
    expect(shipped.results.map((hit) => hit.symbol)).toEqual([
      'startServer',
      'startWorker',
      'begin',
    ]);
    expect(combmnz.results.map((hit) => hit.symbol)).toEqual([
      'startServer',
      'begin',
      'startWorker',
    ]);
  });
});
