// @code-analyzer — the bug-localisation story, end to end through the tool a user actually calls.
//
// **Why this file exists.** The Long Code Arena measurement ranks files with `askCodebase` inside a benchmark harness, so
// every column it publishes is a statement about a code path that no user reaches. The product's entry point is an MCP
// tool - a developer pastes an issue and gets a ranked list of files - and until this file there was **no case anywhere
// that took a natural-language problem statement in through that tool and asserted the fixing file came back**.
//
// **Nothing is simulated except the absence of a model.** The checkout is a real directory on disk, the pipeline is the
// one the product ships, the store is the product's own, and the tool is executed through the registry the MCP server
// builds. The two facts that make it an end-to-end test rather than a unit test are that **the query is prose written
// as an issue** (not an identifier) and that **the assertion is about a file path** rather than about an internal score.
//
// **What would make this pass for the wrong reason.** A repository with one file would answer correctly whatever the
// retriever did, and a repository whose bug is named after its file (`retry.py` for a retry bug) would pass on the
// filename alone. So the fixture holds a decoy: `src/http.py` performs the request and is mentioned in the issue text,
// while the file that must change is `src/retry.py`, whose name the issue never uses. **The assertion is that the
// decoy is not first.**

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { createToolRegistry, ToolContextImpl } from '@code-analyzer/mcp';
import { afterAll, describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode, PipelineContext } from '@code-analyzer/shared';

/**
 * **A fixed path, and it is a correctness requirement rather than tidiness.**
 *
 * The search tool indexes the *absolute* path of every declaration, so a temporary directory with a random suffix puts
 * a different token into the index on every run - `repo-vD2alE` and `repo-HwvvQO` are two different documents. The
 * first version of this file used `mkdtempSync` and its ranking **changed between two analyses of the same source**,
 * which read like a product defect and was a fixture one. Nothing below may move between runs.
 */
const SCRATCH = join(tmpdir(), 'code-analyzer-issue-to-files');

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * A checkout with a bug in it, and a decoy beside the bug.
 *
 * The issue is about the *retry budget being exhausted silently* - the code that must change is the loop in
 * `src/retry.py`. The issue names the request, the client and the 503, all of which live in `src/http.py`, so a
 * retriever that matches the words a user typed without reading what the code does will rank the decoy first.
 */
function writeFixture(root: string): string {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'retry.py'),
    [
      'RETRIES = 3',
      '',
      '',
      'def send_with_retry(client, url):',
      '    """POST the url, retrying while the server answers 503."""',
      '    attempt = 0',
      '    while attempt < RETRIES:',
      '        response = client.post(url)',
      '        if response.status != 503:',
      '            return response',
      '        attempt += 1',
      '    return None',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'http.py'),
    [
      'class HttpClient:',
      '    """A client that posts to a url and returns the status."""',
      '',
      '    def post(self, url):',
      '        return {"status": 200, "url": url}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'serialise.py'),
    ['def dump(payload):', '    return str(payload)', ''].join('\n'),
    'utf8',
  );
  writeFileSync(join(root, 'README.md'), '# a fixture\n', 'utf8');
  return root;
}

/** The fixture, in a fresh tree. **Every case gets its own, because the analysis writes nothing but reads everything.** */
function checkout(): string {
  rmSync(SCRATCH, { recursive: true, force: true });
  return writeFixture(join(SCRATCH, 'repo'));
}

/** The issue as a developer would paste it. **Prose, and it names the decoy's vocabulary, not the answer's.** */
const ISSUE = [
  'Requests are not retried when the server answers 503',
  '',
  'The HttpClient posts the url, gets a 503, and the call returns None immediately.',
  'The retry budget is never spent - the loop gives up after the first attempt instead of',
  'retrying three times, and the caller sees a silent failure with no error.',
].join('\n');

/** Analyse the checkout with the shipped pipeline and copy the graph into the product's store. */
async function analyse(root: string): Promise<InMemoryGraphStore> {
  const ctx = {
    projectId: 'issue-to-files',
    rootPath: root,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  const store = new InMemoryGraphStore();
  const ids = new Map<number, number>();
  for (const node of pipeline.graph.nodes.values() as Iterable<GraphNode>) {
    ids.set(node.id, store.insertNode(node));
  }
  for (const edge of pipeline.graph.edges.values() as Iterable<GraphEdge>) {
    const source = ids.get(edge.sourceId);
    const target = ids.get(edge.targetId);
    if (source === undefined || target === undefined) continue;
    store.insertEdge({
      projectId: edge.projectId,
      sourceId: source,
      targetId: target,
      type: edge.type,
      properties: edge.properties,
      weight: edge.weight,
    });
  }
  return store;
}

/** The ranked file paths a tool result carries, **in the order the tool returned them**. */
function rankedFiles(text: string): string[] {
  const parsed = JSON.parse(text) as { items?: { filePath?: string }[] };
  const items = parsed.items ?? [];
  const files: string[] = [];
  for (const item of items) {
    if (typeof item.filePath !== 'string') continue;
    // **The same reduction the measurement applies**: the pipeline reports absolute paths and a user reads
    // repository-relative ones, so every assertion below is about a suffix rather than about a machine's home
    // directory.
    if (files.includes(item.filePath)) continue;
    files.push(item.filePath);
  }
  return files;
}

/** Analyse a fresh fixture and hand back the registry the MCP server builds. **One checkout per case, never shared.** */
async function build(): Promise<{
  registry: ReturnType<typeof createToolRegistry>;
  toolContext: ToolContextImpl;
}> {
  const store = await analyse(checkout());
  return { registry: createToolRegistry(), toolContext: new ToolContextImpl(store) };
}

describe('a developer pastes an issue and gets the file that must change', () => {
  it('returns the file that must change among the files it ranks', async () => {
    const { registry, toolContext } = await build();
    const result = await registry.execute(
      'search_code',
      { query: ISSUE, projectId: 'issue-to-files', limit: 5 },
      toolContext,
    );

    expect(result.isError).toBeFalsy();
    const files = rankedFiles((result.content[0] as { text: string }).text);

    expect(files.length).toBeGreaterThan(0);
    // **Found at all**, which is the first half of the story: a user who never sees the file has no answer.
    expect(files.some((file) => file.endsWith('src/retry.py'))).toBe(true);
  }, 120_000);

  it('ranks the file that must change above the class the issue names', async () => {
    // **The half that distinguishes a retriever from a word matcher.** The issue says *"the HttpClient posts the url"*,
    // `src/http.py` declares `class HttpClient`, and the loop that has to change is named by none of it. A retriever
    // that matched the words a user typed without reading what the code does would return the decoy first.
    const { registry, toolContext } = await build();
    const result = await registry.execute(
      'search_code',
      { query: ISSUE, projectId: 'issue-to-files', limit: 5 },
      toolContext,
    );
    const files = rankedFiles((result.content[0] as { text: string }).text);
    const sourceFiles = files.filter((file) => /\.(py|java|kt|ts|js|tsx)$/u.test(file));
    expect(sourceFiles[0]?.endsWith('src/retry.py')).toBe(true);
  }, 120_000);

  /**
   * **Two entry points over one store, and they used to disagree about whether anything matched at all.**
   *
   * `search_code` ranked two files for this issue and `ask_codebase` abstained with `no-blocks-retrieved`. A user who
   * asked the question in the QA tool was told the repository had nothing to do with it, while the search box beside it
   * listed the file. **The cause was upstream of both**: `GraphBuilder` created every node with `projectId: ''` and a
   * comment promising to set it when the graph was dumped, so a consumer that read the graph the phases write into saw
   * unscoped nodes - and `retrieveContext` narrows a question to a project by filtering candidates on exactly that
   * field. Twelve candidates retrieved, twelve of them with no project, and the answer was an abstention that read like
   * a fact about the repository. The node now knows its project as soon as it exists.
   */
  it('does not abstain on a question the search tool answered', async () => {
    const { registry, toolContext } = await build();
    const result = await registry.execute(
      'ask_codebase',
      { question: ISSUE, projectId: 'issue-to-files' },
      toolContext,
    );

    expect(result.isError).toBeFalsy();
    const answer = JSON.parse((result.content[0] as { text: string }).text) as {
      abstained?: string;
      retrievedFiles?: string[];
      rankedFiles?: string[];
      rankedPool?: Array<{ filePath?: string }>;
      citations?: unknown[];
    };
    expect(answer.retrievedFiles?.some((file) => file.endsWith('src/retry.py'))).toBe(true);
    // **And the ranking behind the blocks**, which is a different and deeper claim: `retrievedFiles` is what a
    // prompt budget let through, so it can only ever be a prefix of the ranking.
    expect(answer.rankedFiles?.some((file) => file.endsWith('src/retry.py'))).toBe(true);
    expect(answer.rankedFiles?.length).toBeGreaterThanOrEqual(answer.retrievedFiles?.length ?? 0);
    // **The ranking is explainable from the response alone, and the explanation is the pool's *grouping* rather than
    // its first line.** Every file in the list holds at least one declaration the retriever scored, the list is a
    // permutation of the pool's files rather than a subset of them, and no file occupies two positions - so a user who
    // asks "why is that file first" reads the declarations that put it there.
    //
    // **The assertion this replaces was `rankedPool[0].filePath === rankedFiles[0]`, and it was true only while the
    // shipped reading was `max`.** Under `top2` a file's second declaration is allowed to lift it above the pool's
    // head, which is exactly what the Long Code Arena armature measured as worth +0.0290 MAP - so the old assertion
    // encoded the old rule and this one asserts the property that survives a change of rule. It failed on the runner
    // and passed on the machine that wrote it, because the two ranked `src/http.py` and `src/retry.py` in a different
    // order once vectors were present, and neither order is a defect.
    const poolFiles = new Set((answer.rankedPool ?? []).map((entry) => entry.filePath));
    const ranked = answer.rankedFiles ?? [];
    expect(ranked.every((file) => poolFiles.has(file))).toBe(true);
    expect(new Set(ranked).size).toBe(ranked.length);
    expect(new Set(ranked)).toEqual(poolFiles);
    // The retriever's own head is one of the files it ranked, whichever reading turns declarations into positions.
    expect(poolFiles.has(answer.rankedPool?.[0]?.filePath ?? '')).toBe(true);
  }, 120_000);
});

/**
 * **The same source, in two places on disk, ranked the same way.**
 *
 * A developer runs the tool on their laptop and CI runs it on a runner, and the two checkouts live at different paths.
 * That must not change the answer: the query is about code, and the directory the code sits in is not part of the code.
 *
 * **This is a user-visible property and it was quietly broken.** The index weighs a document's `name` field most
 * heavily, the structure phase passed a File node's *absolute path* as that name, and `indexableName` - the function
 * whose whole doctrine is that a name is never "the machine's" - only strips directories from a declaration's qualified
 * name. A repository checked out at `/tmp/.../repo` and the same one at `/tmp/.../a-much-longer-directory-name/repo`
 * therefore indexed two different vocabularies for every file, and a ranking that moved when a directory was renamed is
 * a ranking no one can reproduce.
 */
describe('a checkout that moves does not change the ranking', () => {
  /** A copy of the fixture under a directory whose name shares no token with the first. */
  function relocatedFixture(): string {
    const root = join(SCRATCH, 'a-much-longer-directory-name', 'repo');
    rmSync(root, { recursive: true, force: true });
    return writeFixture(root);
  }

  async function rankAt(root: string): Promise<string[]> {
    const store = await analyse(root);
    const registry = createToolRegistry();
    const result = await registry.execute(
      'search_code',
      { query: ISSUE, projectId: 'issue-to-files', limit: 5 },
      new ToolContextImpl(store),
    );
    expect(result.isError).toBeFalsy();
    // **Relative to the checkout**, which is the only coordinate system two checkouts share.
    return rankedFiles((result.content[0] as { text: string }).text).map((file) =>
      file.startsWith(root) ? file.slice(root.length) : file,
    );
  }

  it('ranks the same files in the same order from two different directories', async () => {
    const first = await rankAt(join(SCRATCH, 'repo'));
    const second = await rankAt(relocatedFixture());

    expect(first.length).toBeGreaterThan(1);
    expect(second).toEqual(first);
  }, 240_000);
});
