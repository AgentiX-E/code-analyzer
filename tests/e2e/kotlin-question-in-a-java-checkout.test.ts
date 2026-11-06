// @code-analyzer — a question about one language, asked of a repository written in two.
//
// **Why this file exists.** `includePatterns` has been in the configuration schema, in the loader, in the validator and
// in `docs/CONFIGURATION.md` ("glob patterns to restrict which files are analyzed") since the schema was written, and
// **no phase read it**. A reader who asked for `src/**` paid for the whole checkout and got an index of the whole
// checkout. On Long Code Arena the same defect is what refused a quarter of the corpus: `airbnb/lottie-android` was
// killed at 6 146 MB while ranking a hundred and thirty-one Kotlin files, `quarkusio/quarkus` was refused for holding
// fifteen thousand files around a hundred and twenty-eight Kotlin ones.
//
// **The story is a developer's, not a harness's.** "I have a polyglot repository and I am asking about the Kotlin" is a
// question with a cost attached, and the cost used to be the repository's rather than the question's.
//
// **What would make this pass for the wrong reason.** A checkout with no other language would prove nothing, so the
// fixture is mostly Java: forty files with real declarations and a real import graph, and three Kotlin files where the
// answer lives. The assertion is not only that the answer is found but that **the Java files are absent from the graph
// the scoped analysis built** - the two halves of the claim, on one fixture, in one run.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { afterAll, describe, expect, it } from 'vitest';

import { locateFiles } from '../../packages/intelligence/src/search/locate.js';

import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

/**
 * **A fixed path**, because the analysis indexes the absolute path of every declaration and a random suffix would put a
 * different token into the index on every run.
 */
const SCRATCH = join(tmpdir(), 'code-analyzer-kotlin-in-a-java-checkout');

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** The Kotlin files, **and the bug is in the second of them**. */
const KOTLIN = {
  'src/main/kotlin/RetryPolicy.kt': [
    'package com.example.client',
    '',
    'class RetryPolicy(private val budget: Int) {',
    '    private var spent = 0',
    '',
    '    fun canRetry(): Boolean {',
    '        return spent < budget',
    '    }',
    '',
    '    fun record() {',
    '        spent += 1',
    '    }',
    '}',
    '',
  ].join('\n'),
  'src/main/kotlin/RequestSender.kt': [
    'package com.example.client',
    '',
    'class RequestSender(private val policy: RetryPolicy) {',
    '    fun send(url: String): String {',
    '        if (policy.canRetry()) {',
    '            policy.record()',
    '            return "retrying $url"',
    '        }',
    '        return "gave up"',
    '    }',
    '}',
    '',
  ].join('\n'),
  'src/main/kotlin/Serialiser.kt': [
    'package com.example.client',
    '',
    'object Serialiser {',
    '    fun dump(value: Any): String = value.toString()',
    '}',
    '',
  ].join('\n'),
} as const;

/** The other language, **with declarations that a whole-checkout analysis would have to parse**. */
function javaFixture(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index++) {
    files[`src/main/java/com/example/client/Sender${String(index)}.java`] = [
      'package com.example.client;',
      '',
      `public class Sender${String(index)} {`,
      '    private final String url;',
      '',
      `    public Sender${String(index)}(String url) {`,
      '        this.url = url;',
      '    }',
      '',
      '    public String post() {',
      '        return this.url;',
      '    }',
      '}',
      '',
    ].join('\n');
  }
  return files;
}

/** Write the fixture and answer with the root. **Every case gets a fresh tree.** */
function checkout(): { readonly root: string; readonly kotlin: string[] } {
  rmSync(SCRATCH, { recursive: true, force: true });
  const root = join(SCRATCH, 'repo');
  mkdirSync(root, { recursive: true });
  const files = { ...KOTLIN, ...javaFixture(40) };
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return { root, kotlin: Object.keys(KOTLIN) };
}

/** Analyse the checkout with the shipped pipeline, **scoped or not**, and answer with the graph. */
async function analyse(root: string, includePatterns: string[]): Promise<GraphNode[]> {
  const ctx = {
    projectId: 'kotlin-in-a-java-checkout',
    rootPath: root,
    config: { ...getDefaultConfig(), includePatterns },
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  return [...(result.graph.nodes.values() as Iterable<GraphNode>)];
}

/** The files a graph holds, **repository-relative and de-duplicated**. */
function filesOf(nodes: readonly GraphNode[], root: string): string[] {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.label !== 'File') continue;
    const path = String(node.properties['filePath'] ?? '');
    paths.add(path.startsWith(root) ? path.slice(root.length + 1) : path);
  }
  return [...paths].sort();
}

/**
 * The issue as a developer would paste it. **Prose, and it points at the caller rather than at the policy.**
 *
 * **The wording is the fixture.** The policy is the vocabulary of the issue - "budget", "retry", "policy" - so naming
 * it as the culprit would make the decoy the answer and the case would pass on the words alone. What the issue says is
 * that the *sending* stops after one attempt, which is `RequestSender.kt`'s loop that is not a loop.
 */
const ISSUE = [
  'The sender gives up after one attempt when the server answers 503',
  '',
  'A request that the server rejects is sent once and then abandoned. The retry budget is',
  'consulted and there are attempts left, but the caller never goes round again, so a',
  'transient failure reaches the user as a silent one.',
].join('\n');

describe('a question about Kotlin, asked of a repository that is mostly Java', () => {
  it('analyses only the files the scope names, and still finds the answer', async () => {
    const { root, kotlin } = checkout();

    const scoped = filesOf(await analyse(root, ['**/*.kt']), root);
    // **The claim, both halves at once**: the Kotlin files are all there and **not one** Java file is.
    expect(scoped).toEqual([...kotlin].sort());

    const whole = filesOf(await analyse(root, []), root);
    // **The default is unchanged.** A caller who never mentioned a scope still gets the checkout, which is what the
    // forty Java files are here to prove: the fixture would otherwise be indistinguishable from a Kotlin repository.
    expect(whole.length).toBe(43);
    expect(whole).toContain('src/main/kotlin/RequestSender.kt');
    expect(whole).toContain('src/main/java/com/example/client/Sender0.java');
  }, 120_000);

  it('ranks the file that must change first, with the scoped declarations fused in', async () => {
    const { root, kotlin } = checkout();
    const nodes = await analyse(root, ['**/*.kt']);

    // The declaration arm the graph yields, reduced to files, **which is what a caller with an index hands over**.
    const declarations: string[] = [];
    for (const node of nodes) {
      if (node.label !== 'Function' && node.label !== 'Method' && node.label !== 'Class') continue;
      const path = String(node.properties['filePath'] ?? '');
      if (path.length === 0) continue;
      declarations.push(path.startsWith(root) ? path.slice(root.length + 1) : path);
    }

    const located = locateFiles(root, ISSUE, {
      files: kotlin.map((path) => join(root, path)),
      declarations,
      limit: 3,
    });

    const ranked = located.ranked.map((path) =>
      path.startsWith(root) ? path.slice(root.length + 1) : path,
    );
    // **`RequestSender.kt` is the file that must change**: it is where the sender gives up, and the policy is the
    // vocabulary the issue uses. The assertion is the ranking a user acts on, not an internal score.
    expect(ranked[0]).toBe('src/main/kotlin/RequestSender.kt');
    expect(located.fusion).not.toBeNull();
    // **And the universe is stated**: three files, none truncated.
    expect(located.answerSpace).toBe(3);
    expect(located.truncated).toBe(false);
  }, 120_000);
});
