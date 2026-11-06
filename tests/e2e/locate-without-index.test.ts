// **The end-to-end story this file tests is the one the product used to fail.**
//
// A reader clones a repository of two thousand two hundred files, asks "where is the retry policy", and asks the CLI.
// The analysis path - `analyze`, `search`, `ask` - begins by building the graph, and the harness refuses a checkout of
// that size before it starts, because the analysis it would need is the one that gets killed. Until iteration 76 the
// reader's answer was that refusal.
//
// `locate` is the fallback: it reads a path and an import block per file and nothing else. This test builds a checkout
// at the size the analyser refuses, proves the refusal on the same checkout, and then proves that `locate` answers the
// question anyway - **on the same files, in the same coordinate system, with no index**.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { locateRepository } from '../../packages/cli/src/commands/locate.js';
import {
  checkoutFileCount,
  corpusFiles,
  decideInstance,
} from '../../packages/intelligence/src/benchmark/lca-instrument.js';

/** The stated cap the harness applies to one instance. **The same number the workflow passes as `LCA_MAX_FILES`.** */
const STATED_CAP_FILES = 4_000;

describe('locate on a checkout the analysis refuses', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'locate-e2e-'));
    mkdirSync(join(root, 'src', 'main', 'java', 'io'), { recursive: true });
    // **Ninety-nine files of noise and one answer**, which is the shape of a real issue: the fixing file is one among
    // thousands and the only reason to find it is that the question names it.
    for (let index = 0; index < 99; index += 1) {
      writeFileSync(
        join(root, 'src', 'main', 'java', 'io', `Helper${String(index)}.java`),
        `package io;\npublic class Helper${String(index)} {}\n`,
      );
    }
    writeFileSync(
      join(root, 'src', 'main', 'java', 'io', 'RetryPolicy.java'),
      'package io;\nimport io.grpc.ManagedChannel;\npublic class RetryPolicy {}\n',
    );
    // ...and enough files under a skipped directory that the answer space is still refused for its *own* size. The
    // noise lives in `src/`, so the count below is the count the harness would see.
    for (let index = 0; index < STATED_CAP_FILES + 150; index += 1) {
      const shard = join(root, 'src', 'main', 'java', 'gen', `d${String(index % 40)}`);
      mkdirSync(shard, { recursive: true });
      writeFileSync(
        join(shard, `Generated${String(index)}.java`),
        'package gen;\npublic class G {}\n',
      );
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('**the analysis path refuses this checkout, and says which bound refused it**', () => {
    const files = checkoutFileCount(root);
    expect(files).toBeGreaterThan(STATED_CAP_FILES);
    const verdict = decideInstance(files, {
      capFiles: STATED_CAP_FILES,
      budgetFiles: Number.MAX_SAFE_INTEGER,
      elapsedMs: 0,
      budgetMs: Number.MAX_SAFE_INTEGER,
      residentMb: 0,
      reserveMb: 0,
    });
    expect(verdict.analyse).toBe(false);
    // The sentence is what the artifact publishes on a refused row; a refusal without one is a hole.
    expect(verdict.analyse === false ? verdict.because : '').toContain(
      `above the stated cap of ${String(STATED_CAP_FILES)}`,
    );
  });

  it('**locate answers it anyway, on the same answer space**', () => {
    const output = locateRepository({
      question: 'the retry policy drops the timeout on the managed channel',
      directory: root,
      limit: 10,
    });
    expect(output.success).toBe(true);
    expect(output.files[0]).toBe('src/main/java/io/RetryPolicy.java');
    expect(output.answerSpace).toBeGreaterThan(STATED_CAP_FILES);
    expect(output.truncated).toBe(false);
    // **The import block is what made the ranking a document rather than a filename match**: the answer's file imports
    // `io.grpc.ManagedChannel`, and the question names that concept without naming the file.
    expect(output.importLines).toBeGreaterThan(0);
  });

  it('reports paths in the coordinate system a corpus counts in', () => {
    // **The coordinate system, not the same set.** `corpusFiles` is the `java` configuration's universe: one extension,
    // test paths removed. `locate`'s universe is every source extension, so the two coincide here only because this
    // checkout holds nothing else - and the property worth pinning is the one that makes a benchmark able to score a
    // locate at all: every path it returns is repository-relative POSIX and is a member of the corpus's universe.
    const universe = corpusFiles(root, '.java');
    const output = locateRepository({ question: 'retry policy', directory: root, limit: 5 });
    for (const file of output.files) expect(universe).toContain(file);
    expect(output.files.every((file) => !file.startsWith('/') && !file.includes('\\'))).toBe(true);
  });
});
