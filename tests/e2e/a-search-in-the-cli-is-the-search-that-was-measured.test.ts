// **The product's search and the measured search were two different retrievals.**
//
// `code-analyzer search <query>` is the first thing a new user types, and for most of its life it answered from a store
// it had constructed empty: `searchGraph` had no way to be told which checkout to search, so it built an
// `InMemoryGraphStore`, asked it a question, and printed "no results" — exiting 0, which is the exit code of an answer.
// Even with a store attached it called `searchFts`, the containment channel that finds 173 of 447 rewritten questions
// where the field-weighted BM25 beside it finds 358 (`EVAL-CONTRACT.md` §37.7).
//
// So this file asks the question from the outside: index a real checkout the way a user would, then require that the
// command's answer is the engine's answer — same items, same order — and that it is **not** the containment channel's.
// The containment channel is asserted in the same test rather than assumed: a corpus that stopped distinguishing the two
// would make the first assertion vacuous, and a control that is not checked is a control that silently expired.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { searchGraph } from '../../packages/cli/src/commands/search.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { createToolRegistry, ToolContextImpl } from '@code-analyzer/mcp';

/**
 * A checkout whose file name is also a word in a question about it.
 *
 * **The file is the point**: `limits.ts` is a `File` node named `limits`, so a containment search for "limits" answers
 * with the file and the engine — which returns code symbols — answers with the function inside it. One query, two
 * visibly different answers, and the difference is not a matter of degree.
 */
function writeCheckout(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'limits.ts'),
    [
      '/** Keep a number below a ceiling so the value stays finite. */',
      'export function clamp(value: number, max: number): number {',
      '  return Math.min(value, max);',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'src', 'handlers.ts'),
    [
      "import { clamp } from './limits';",
      '',
      'export function apply(input: number): number {',
      '  return clamp(input, 10);',
      '}',
      '',
    ].join('\n'),
  );
}

describe('the search a user runs is the search that was measured', () => {
  let checkout: string;
  let store: InMemoryGraphStore;
  let context: ToolContextImpl;

  beforeAll(async () => {
    checkout = mkdtempSync(join(tmpdir(), 'cli-search-is-measured-'));
    writeCheckout(checkout);

    store = new InMemoryGraphStore();
    context = new ToolContextImpl(store, { llm: null });
    await createToolRegistry().execute(
      'analyze_repository',
      { path: checkout, projectId: 'checkout' },
      context,
    );
  }, 120_000);

  afterAll(() => {
    rmSync(checkout, { recursive: true, force: true });
  });

  it('**answers with the engine the benchmarks ran, item for item and in the same order**', async () => {
    const engine = context.getFederatedSearch();
    const measured = await engine.search('number below a ceiling', { maxResults: 10 });

    const printed = await searchGraph({ query: 'number below a ceiling', limit: 10 }, store);

    expect(printed.success).toBe(true);
    expect(printed.results.map((result) => result.name)).toEqual(
      measured.results.map((item) => item.symbol),
    );
    // **A non-empty list, because two empty lists are equal and that is how the dead command passed for so long.** The
    // question is asked in the words of the doc comment and names no identifier, so an engine that answered it here is
    // answering from the field-weighted channel rather than from a name match.
    expect(printed.results.length).toBeGreaterThan(0);
    expect(printed.results[0]?.name).toBe('clamp');
  });

  it('**and the containment channel beside it would have answered differently**', () => {
    // The control, asserted rather than assumed: `searchFts` ranks by the weight of the best field and then adds three
    // per matched term, so a `File` node named `limits.ts` outranks the function whose doc comment describes it. If this
    // ever stops being true the test above stops being evidence, and this line is what says so.
    const containment = store.searchFts('limits', { limit: 10 });
    expect(containment.length).toBeGreaterThan(0);
    expect(containment[0]?.node.label).toBe('File');
  });

  it('**returns code symbols, not the files and directories beside them**', async () => {
    const printed = await searchGraph({ query: 'limits', limit: 20 }, store);

    // The label set is the engine's, and the difference is visible: a containment search for a file's own name answers
    // with the file, and a developer asking about a name wants the declaration that carries it.
    expect(printed.results.length).toBeGreaterThan(0);
    expect(printed.results.map((result) => result.type)).not.toContain('File');
    expect(printed.results.map((result) => result.name)).toContain('clamp');
  });

  it('**carries the identity a caller needs to ask the next question**', async () => {
    const printed = await searchGraph({ query: 'clamp', limit: 5 }, store);

    // A hit whose qualified name is missing is a dead end: every follow-up tool in the product is keyed by it, and a
    // surface that had to look it up again would be a second implementation of the ranking's own output.
    expect(printed.results[0]?.qualifiedName).toMatch(/limits\.ts.*clamp/);
    expect(printed.results[0]?.file).toMatch(/src\/limits\.ts$/);
    expect(printed.results[0]?.line).toBeGreaterThan(0);
  });

  it('**says it has nothing indexed rather than that it found nothing**', async () => {
    const empty = new InMemoryGraphStore();
    const printed = await searchGraph({ query: 'number below a ceiling', limit: 10 }, empty);

    // Both outcomes print zero rows, and they are not the same answer: one means "ask a different question" and the
    // other means "index something first". The dead command's exit code was indistinguishable from a real miss.
    expect(printed.results).toEqual([]);
    expect(printed.success).toBe(false);
    expect(printed.error).toMatch(/nothing indexed/i);
  });

  it('**indexes the directory it was given, so the command works on a fresh checkout**', async () => {
    const fresh = await searchGraph({
      query: 'number below a ceiling',
      directory: checkout,
      limit: 5,
    });

    expect(fresh.success).toBe(true);
    expect(fresh.results[0]?.name).toBe('clamp');
    expect(fresh.error).toBeUndefined();
  }, 120_000);

  it('**names a directory that is not there instead of searching nothing quietly**', async () => {
    const missing = join(tmpdir(), 'cli-search-no-such-checkout-8f3a');
    const result = await searchGraph({ query: 'anything', directory: missing });

    // "The directory you named does not exist" and "the code you named does not mention this" are different answers,
    // and the command used to give the second for the first. The indexing tool decides which one it is, because it is
    // the only thing that knows - a second existence check here could only disagree with it.
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path does not exist');
    expect(result.error).toContain(missing);
  });

  it('**refuses a checkout that produced no graph rather than reporting an empty search**', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'cli-search-empty-checkout-'));
    try {
      const result = await searchGraph({ query: 'anything', directory: bare });

      // **A directory with no code in it is not a successful index with no results.** The pipeline runs, finds nothing
      // to parse, and stores nothing; the command says so, because the alternative is a user concluding that their
      // question has no answer in a repository nobody read.
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing indexed/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  }, 120_000);
});
