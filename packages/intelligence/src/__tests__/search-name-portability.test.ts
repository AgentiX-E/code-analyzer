// A figure that depends on where the repository is checked out is not a figure.
//
// **Found by a discrepancy that looked like noise.** The pinned corpus reported lexical MRR 0.9819 on a laptop and
// 0.9796 on a runner - same corpus, same code, same 214 questions. A probe that analysed the corpus twice, once at its
// real path and once through a longer symlink, reproduced both numbers on one machine:
//
//     PATH-PROBE short={"mrr":0.9819} long={"mrr":0.9796}
//
// So the difference was the checkout path. `InvertedIndex.addDocument` indexed `node.qualifiedName`, and a file-scoped
// qualified name is `project:<id>:file:<absolute path>:<symbol>`: every document in the graph carried the path of the
// machine that indexed it, which changes the document frequency of every term the path happens to contain, and with it
// the order of every near-tie.
//
// **The rule this file holds.** The text a document is indexed under must be a function of the code and of nothing
// else - not of the root it was found under, not of the workspace id, not of the platform's separators. The two tests
// below are that rule at its two ends: what one name becomes, and whether a whole corpus keeps the same vocabulary when
// it is moved.

import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { describe, expect, it } from 'vitest';

import { indexableName } from '../search/hybrid-search.js';

import type { PipelineContext } from '@code-analyzer/shared';

const name = (qualifiedName: string): string => indexableName({ qualifiedName });

describe('the name a document is indexed under', () => {
  it('drops every directory, because the index is never told which one is the root', () => {
    // The shape the index actually holds: a symbol, with the whole checkout path in the middle of its name.
    expect(
      name(
        'project:docstring-search:file:/home/runner/work/code-analyzer/code-analyzer/benchmarks/retrieval-corpus/__tests__/arkts.test.ts:provider',
      ),
    ).toBe('file:arkts.test:provider');
    // **The file's own name stays**, because "the parser in arkts" is a question somebody asks; `/home/runner` is not.
    expect(name('file:/home/runner/work/code-analyzer/code-analyzer/arkts.ts')).toBe('file:arkts');
    expect(name('folder:/home/runner/work/code-analyzer/arkts-helpers')).toBe(
      'folder:arkts-helpers',
    );
  });

  it('drops the workspace id, which names a place rather than a symbol', () => {
    expect(name('project:code-analyzer:ArkTSProvider.walkAndCapture')).toBe(
      'ArkTSProvider.walkAndCapture',
    );
    expect(name('project:paraphrase-search:parse')).toBe('parse');
  });

  it('leaves a name with no path in it alone, and does not mistake a colon for one', () => {
    expect(name('community:42')).toBe('community:42');
    expect(name('parse')).toBe('parse');
    // **An empty segment is not a path**, and a name that merely contains a slash in a segment is not absolute.
    expect(name('project:p:a/b')).toBe('a/b');
  });

  it('is the same name under a longer root, which is the whole point', () => {
    const short = 'project:p:file:/repo/corpus/arkts.ts:walk';
    const long =
      'project:p:file:/home/runner/work/code-analyzer/code-analyzer/corpus/arkts.ts:walk';
    expect(name(long)).toBe(name(short));
  });
});

describe('a corpus that is moved', () => {
  /** Every name the index would hold for a corpus at this root, sorted so two roots can be compared as sets. */
  async function vocabulary(root: string): Promise<string[]> {
    const corpusRoot = resolve(process.cwd(), root);
    const ctx = {
      projectId: 'portability',
      rootPath: corpusRoot,
      config: getDefaultConfig(),
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;
    const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
    return [...result.graph.nodes.values()].map((node) => indexableName(node)).sort();
  }

  it('indexes the same words whether it lives here or one directory deeper', async () => {
    const corpus = 'benchmarks/retrieval-corpus';
    const scratch = join('tmp-portability-probe', 'a-checkout-with-a-longer-name');
    mkdirSync(resolve(process.cwd(), 'tmp-portability-probe'), { recursive: true });
    rmSync(resolve(process.cwd(), scratch), { recursive: true, force: true });
    symlinkSync(resolve(process.cwd(), corpus), resolve(process.cwd(), scratch), 'dir');
    try {
      const here = await vocabulary(corpus);
      const there = await vocabulary(scratch);
      // **Absent the rule, these differ by the path of the machine**, and the retrieval figure moves with them.
      expect(there).toEqual(here);
      expect(here.length).toBeGreaterThan(1_000);
    } finally {
      rmSync(resolve(process.cwd(), 'tmp-portability-probe'), { recursive: true, force: true });
    }
  }, 120_000);
});
