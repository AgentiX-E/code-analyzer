// **One question, four surfaces, and until this iteration four different answers.**
//
// The product exposes a search through the CLI, through an MCP tool, and through two GraphQL fields, and the published
// figures describe a fifth caller — `FederatedSearchEngine`, which the benchmarks drive directly. Three of the four
// surfaces called `store.searchFts`, the containment channel that finds 173 of 447 rewritten questions where the
// field-weighted BM25 beside it finds 358 (`EVAL-CONTRACT.md` §37.7); the CLI called it on an empty store and found
// nothing at all. A measurement of a retrieval nobody could reach is a measurement of a library.
//
// So this file asks the same question of every surface and requires the same list in the same order. **The comparison is
// against the engine rather than against a recorded constant**, because a constant would be a fifth opinion: the engine
// is the thing `benchmarks/*.json` reports, and a surface that agrees with it agrees with the figures.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { createToolRegistry, ToolContextImpl, type ToolRegistry } from '@code-analyzer/mcp';
import { resolvers } from '@code-analyzer/server/graphql/resolvers';

import { searchGraph as cliSearchGraph } from '../../packages/cli/src/commands/search.js';

import type { GraphQLContext } from '@code-analyzer/server/graphql/context';

/** A checkout of one function whose doc comment describes it in words the name does not contain. */
function writeCheckout(root: string, symbol: string, noun: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', `${noun}.ts`),
    [
      `/** Assemble the ${noun} a request asks for, in the order it asks. */`,
      `export function ${symbol}(request: string): string {`,
      '  return request;',
      '}',
      '',
    ].join('\n'),
  );
}

interface GraphQLSearchPayload {
  items: Array<{ node: { name: string; qualifiedName: string }; score: number }>;
}

function names(payload: GraphQLSearchPayload | undefined): string[] {
  return (payload?.items ?? []).map((item) => item.node.name);
}

interface McpSearchPayload {
  items: Array<{ name: string; qualifiedName: string }>;
}

describe('a question asked of four surfaces is one answer', () => {
  let alpha: string;
  let beta: string;
  let store: InMemoryGraphStore;
  let context: ToolContextImpl;
  let registry: ToolRegistry;

  beforeAll(async () => {
    alpha = mkdtempSync(join(tmpdir(), 'one-answer-alpha-'));
    beta = mkdtempSync(join(tmpdir(), 'one-answer-beta-'));
    writeCheckout(alpha, 'assembleWidget', 'widget');
    writeCheckout(beta, 'assembleGadget', 'gadget');

    store = new InMemoryGraphStore();
    context = new ToolContextImpl(store, { llm: null });
    registry = createToolRegistry();
    await registry.execute('analyze_repository', { path: alpha, projectId: 'alpha' }, context);
    await registry.execute('analyze_repository', { path: beta, projectId: 'beta' }, context);
  }, 180_000);

  afterAll(() => {
    rmSync(alpha, { recursive: true, force: true });
    rmSync(beta, { recursive: true, force: true });
  });

  it('**the CLI prints the engine’s list**', async () => {
    const engine = await context
      .getFederatedSearch()
      .search('assemble the widget', { maxResults: 10 });
    const printed = await cliSearchGraph({ query: 'assemble the widget', limit: 10 }, store);

    expect(printed.success).toBe(true);
    expect(printed.results.map((result) => result.name)).toEqual(
      engine.results.map((item) => item.symbol),
    );
    // The whole point of asking this question: the function's name shares no word with it, so only the field-weighted
    // channel over the doc comment can answer at all.
    expect(printed.results[0]?.name).toBe('assembleWidget');
  });

  it('**the MCP tool returns the engine’s list**', async () => {
    const engine = await context
      .getFederatedSearch()
      .search('assemble the widget', { maxResults: 10 });
    const payload = JSON.parse(
      (await registry.execute('search_graph', { query: 'assemble the widget', limit: 10 }, context))
        .content[0]?.text ?? '{}',
    ) as McpSearchPayload;

    expect(payload.items.map((item) => item.name)).toEqual(
      engine.results.map((item) => item.symbol),
    );
    expect(payload.items[0]?.name).toBe('assembleWidget');
  });

  it('**and the GraphQL fields do too, scoped and unscoped**', async () => {
    const ctx = { store } as unknown as GraphQLContext;
    const engine = await context
      .getFederatedSearch()
      .search('assemble the widget', { maxResults: 10 });

    const across = (await resolvers.Query!.crossRepoSearch!(
      null,
      { query: 'assemble the widget', limit: 10 },
      ctx,
      {} as never,
    )) as GraphQLSearchPayload;
    expect(names(across)).toEqual(engine.results.map((item) => item.symbol));

    // **The scope is applied inside the ranking**, so a question asked of `beta` answers from `beta` even when the
    // global winner belongs to `alpha`. The old resolver fetched a global page and filtered it afterwards, which
    // answered nothing whenever the scoped winner was outside that page - and always when it was the only hit.
    const scoped = (await resolvers.Query!.searchGraph!(
      null,
      { projectId: 'beta', query: 'assemble the widget', limit: 10 },
      ctx,
      {} as never,
    )) as GraphQLSearchPayload;
    expect(names(scoped)).toEqual(['assembleGadget']);

    const scopedEngine = await context
      .getFederatedSearch()
      .search('assemble the widget', { maxResults: 10, repoFilter: ['beta'] });
    expect(names(scoped)).toEqual(scopedEngine.results.map((item) => item.symbol));
  });

  it('**and the fusion mechanism is a product option rather than a harness one**', async () => {
    // §40 measured eight mechanisms and retired four; the ones that remain could only be compared by someone who could
    // run them, and that someone was a benchmark. A user whose corpus disagrees with ours can now check the claim
    // instead of taking it on trust - and the surface fuses with the rule that was asked for rather than with the
    // default plus a label saying otherwise.
    const engine = context.getFederatedSearch();
    for (const rule of ['rrf', 'combmnz'] as const) {
      const measured = await engine.search('assemble the widget', {
        maxResults: 10,
        fusionRule: rule,
      });
      const printed = await cliSearchGraph(
        { query: 'assemble the widget', limit: 10, fusionRule: rule },
        store,
      );
      expect(printed.results.map((result) => result.name)).toEqual(
        measured.results.map((item) => item.symbol),
      );
    }
  });

  it('**every surface carries the identity the next question needs**', async () => {
    const printed = await cliSearchGraph({ query: 'assemble the widget', limit: 5 }, store);
    const payload = JSON.parse(
      (await registry.execute('search_graph', { query: 'assemble the widget', limit: 5 }, context))
        .content[0]?.text ?? '{}',
    ) as McpSearchPayload;

    // A hit is the beginning of a conversation - "who calls this", "show me the file" - and every follow-up is keyed by
    // the qualified name. A surface that dropped it would have to search again to answer its own result.
    const engine = await context
      .getFederatedSearch()
      .search('assemble the widget', { maxResults: 5 });
    expect(printed.results[0]?.qualifiedName).toBe(engine.results[0]?.qualifiedName);
    expect(payload.items[0]?.qualifiedName).toBe(engine.results[0]?.qualifiedName);
  });
});
