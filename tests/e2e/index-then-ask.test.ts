// **The story this file tests is the one the product used to fail.**
//
// A developer points the MCP server at a checkout, indexes it, and then asks a question about the code: "who calls
// `clamp`?". That is the whole product in three steps, and for most of its life the third step was answered from an
// empty graph: `analyze_repository` ran the full pipeline, reported `nodeCount: 805`, and dropped the result, because
// `currentAnalysis` was assigned on the tool context and read by nothing. Every existing test passed — they insert
// their nodes by hand, so they all start from the state the product failed to reach.
//
// So this file starts from a real checkout on disk and never touches the store directly after that. `index` runs the
// pipeline, the questions run through the same registry the server exposes, and the second project proves the answers
// are scoped rather than global. **The last case is the control**: a store with nothing indexed must say it found
// nothing, because a tool that guesses is indistinguishable from a tool that knows.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { createToolRegistry, ToolContextImpl, type ToolRegistry } from '@code-analyzer/mcp';

/** A checkout of two files: one defines `clamp`, the other calls it across an import. */
function writeCheckout(root: string, options: { symbol: string; file: string }): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'limits.ts'),
    [
      `export function ${options.symbol}(value: number, max: number): number {`,
      '  return Math.min(value, max);',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'src', options.file),
    [
      `import { ${options.symbol} } from './limits';`,
      '',
      'export function apply(input: number): number {',
      `  return ${options.symbol}(input, 10);`,
      '}',
      '',
    ].join('\n'),
  );
}

interface ExplorePayload {
  symbol: { qualifiedName: string; filePath: string | null } | null;
  calledBy: Array<{ callerName?: string; callerFile?: string | null }>;
}

interface ProjectsPayload {
  items: Array<{ projectId: string; nodeCount: number; edgeCount: number }>;
  total: number;
}

function bodyOf<T>(text: string | undefined): T {
  return JSON.parse(text ?? '{}') as T;
}

let first: string;
let second: string;
let registry: ToolRegistry;

beforeAll(() => {
  first = mkdtempSync(join(tmpdir(), 'index-then-ask-first-'));
  second = mkdtempSync(join(tmpdir(), 'index-then-ask-second-'));
  writeCheckout(first, { symbol: 'clamp', file: 'handlers.ts' });
  writeCheckout(second, { symbol: 'scale', file: 'pipeline.ts' });
  registry = createToolRegistry();
});

afterAll(() => {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
});

describe('index a checkout, then ask it a question', () => {
  it('**the answer to "who calls clamp" comes from the code that was indexed**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });

    const indexed = await registry.execute(
      'analyze_repository',
      { path: first, projectId: 'first' },
      context,
    );
    const indexPayload = bodyOf<{
      nodeCount: number;
      persisted: { persisted: boolean; nodes: number; edges: number; reason: string | null };
    }>(indexed.content[0]?.text);

    expect(indexed.isError).toBeUndefined();
    expect(indexPayload.persisted.persisted).toBe(true);
    expect(indexPayload.persisted.nodes).toBe(indexPayload.nodeCount);
    // A graph of files with no edges would answer "nobody calls it" and look like an answer, so the edge count is the
    // half of this assertion that a store of nodes alone cannot satisfy.
    expect(indexPayload.persisted.edges).toBeGreaterThan(0);

    const listed = bodyOf<ProjectsPayload>(
      (await registry.execute('list_projects', {}, context)).content[0]?.text,
    );
    expect(listed.items.map((project) => project.projectId)).toEqual(['first']);
    expect(listed.items[0]!.nodeCount).toBe(indexPayload.persisted.nodes);

    const explored = bodyOf<ExplorePayload>(
      (
        await registry.execute(
          'explore_symbol',
          { symbolName: 'clamp', projectId: 'first', includeRelationships: true },
          context,
        )
      ).content[0]?.text,
    );

    expect(explored.symbol?.filePath).toMatch(/src\/limits\.ts$/);
    // **The call edge survived persistence with remapped ids.** A caller whose file is `handlers.ts` is a node the
    // pipeline produced and the store kept; a graph that was computed and discarded answers with an empty array here
    // and nowhere else, which is what made the defect invisible for so long.
    expect(explored.calledBy.map((call) => call.callerFile)).toContainEqual(
      expect.stringMatching(/src\/handlers\.ts$/),
    );
  }, 120_000);

  it('**a second checkout does not contaminate the first, and both are listed**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });

    await registry.execute('analyze_repository', { path: first, projectId: 'first' }, context);
    await registry.execute('analyze_repository', { path: second, projectId: 'second' }, context);

    const listed = bodyOf<ProjectsPayload>(
      (await registry.execute('list_projects', {}, context)).content[0]?.text,
    );
    expect(listed.items.map((project) => project.projectId).sort()).toEqual(['first', 'second']);
    expect(listed.total).toBe(2);

    // The question is asked once, of a store holding two checkouts, and each name resolves inside its own project.
    const clamped = bodyOf<ExplorePayload>(
      (
        await registry.execute(
          'explore_symbol',
          { symbolName: 'clamp', projectId: 'first', includeRelationships: true },
          context,
        )
      ).content[0]?.text,
    );
    const scaled = bodyOf<ExplorePayload>(
      (
        await registry.execute(
          'explore_symbol',
          { symbolName: 'scale', projectId: 'second', includeRelationships: true },
          context,
        )
      ).content[0]?.text,
    );
    // **The leak case, and the reason `projectId` had to start doing something.** `clamp` does not exist in the second
    // checkout, and the tool used to answer with the first one's, because the name index is global and the required
    // parameter was read by nothing. A scoped question answered from another project is a wrong answer that looks like
    // a right one.
    const leaked = bodyOf<ExplorePayload>(
      (
        await registry.execute(
          'explore_symbol',
          { symbolName: 'clamp', projectId: 'second', includeRelationships: true },
          context,
        )
      ).content[0]?.text,
    );

    expect(clamped.symbol?.filePath).toMatch(/^.*first.*src\/limits\.ts$/);
    expect(scaled.symbol?.filePath).toMatch(/^.*second.*src\/limits\.ts$/);
    expect(scaled.calledBy.map((call) => call.callerFile)).toContainEqual(
      expect.stringMatching(/src\/pipeline\.ts$/),
    );
    expect(leaked.symbol).toBeNull();
  }, 120_000);

  it('**with nothing indexed the same question is answered as unknown, not guessed**', async () => {
    // **The control.** Everything above proves a correct answer is reachable; this proves the answer is a function of
    // the index rather than of the name being recognised. A tool that returned a plausible caller here would make the
    // two cases above unfalsifiable.
    const context = new ToolContextImpl(new InMemoryGraphStore(), { llm: null });

    const explored = bodyOf<ExplorePayload>(
      (
        await registry.execute(
          'explore_symbol',
          { symbolName: 'clamp', projectId: 'nothing-indexed', includeRelationships: true },
          context,
        )
      ).content[0]?.text,
    );
    const listed = bodyOf<ProjectsPayload>(
      (await registry.execute('list_projects', {}, context)).content[0]?.text,
    );

    expect(explored.symbol).toBeNull();
    expect(explored.calledBy).toEqual([]);
    expect(listed.items).toEqual([]);
    expect(listed.total).toBe(0);
  }, 60_000);
});
