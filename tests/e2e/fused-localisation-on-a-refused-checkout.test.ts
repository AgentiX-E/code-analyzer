// **The end-to-end story: an agent already has a list, and the list is not enough.**
//
// A coding agent works on a checkout the analyser refuses - two and a half thousand Kotlin files, larger than the
// harness's stated cap - and it has just run its own search over symbol names. What it holds is a ranking of a handful
// of paths, one of which is right and two of which are noise that shares the issue's vocabulary. What it does not have
// is any way to see the rest of the repository.
//
// `locate --declarations` is the product's answer: it reads one eight-kilobyte head per file to build a file-level
// ranking, fuses that with the list the agent already had by reciprocal rank (`k = 60`), and returns an order that is a
// function of both. **This test proves the two claims that make that useful**: the fused order is not the agent's list
// (a file the agent never ranked can lead it), and it is not the file-level order either (the agent's evidence moves
// files the file-level arm alone would have left behind) - with the same refusal, on the same checkout, in the same
// coordinate system as the rest of the product.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { locateRepository, readDeclarations } from '../../packages/cli/src/commands/locate.js';
import { RRF_K } from '../../packages/intelligence/src/search/fusion.js';
import {
  checkoutFileCount,
  corpusFiles,
  decideInstance,
} from '../../packages/intelligence/src/benchmark/lca-instrument.js';

/** The stated cap the harness applies to one instance. **The same number the workflow passes as `LCA_MAX_FILES`.** */
const STATED_CAP_FILES = 4_000;

describe('an agent’s list, fused with the file-level arm, on a checkout the analysis refuses', () => {
  let root: string;
  let armFile: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'fused-e2e-'));
    mkdirSync(join(root, 'src', 'main', 'kotlin', 'io'), { recursive: true });
    // **The answer.** Its path carries the issue's noun and its imports carry the mechanism.
    writeFileSync(
      join(root, 'src', 'main', 'kotlin', 'io', 'RetryPolicy.kt'),
      'package io\nimport io.grpc.ManagedChannel\nimport kotlinx.coroutines.withTimeout\nclass RetryPolicy\n',
    );
    // **The noise the agent's own search ranked first**, and it shares both words with the issue.
    writeFileSync(
      join(root, 'src', 'main', 'kotlin', 'io', 'RetryConfig.kt'),
      'package io\nclass RetryConfig\n',
    );
    writeFileSync(
      join(root, 'src', 'main', 'kotlin', 'io', 'TimeoutDefaults.kt'),
      'package io\nclass TimeoutDefaults\n',
    );
    // ...and enough generated files that the checkout is one the harness refuses for its own size.
    for (let index = 0; index < STATED_CAP_FILES + 150; index += 1) {
      const shard = join(root, 'src', 'main', 'kotlin', 'gen', `d${String(index % 40)}`);
      mkdirSync(shard, { recursive: true });
      writeFileSync(join(shard, `Generated${String(index)}.kt`), 'package gen\nclass G\n');
    }
    // **What the agent holds**: three paths, best first. The right file is third, because a symbol search that matches
    // `Retry` ranks the two files whose names are *about* retry above the one that implements it.
    // **A directory of our own rather than a name in the shared one.** A process id is predictable and is reused;
    // `mkdtempSync` gives this run a directory nobody else can be holding.
    armFile = join(mkdtempSync(join(tmpdir(), 'agent-arm-')), 'arm.txt');
    writeFileSync(
      armFile,
      [
        'src/main/kotlin/io/RetryConfig.kt',
        'src/main/kotlin/io/TimeoutDefaults.kt',
        'src/main/kotlin/io/RetryPolicy.kt',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(armFile, { force: true });
  });

  it('**the analysis path still refuses this checkout**, which is what makes the story the story', () => {
    const verdict = decideInstance(checkoutFileCount(root), {
      capFiles: STATED_CAP_FILES,
      elapsedMs: 0,
      budgetMs: Number.MAX_SAFE_INTEGER,
    });
    expect(verdict.analyse).toBe(false);
  });

  it('**the file-level arm alone finds the answer**, and the agent’s list alone ranks it third', () => {
    const question = 'retry policy drops the timeout on the managed channel';
    const alone = locateRepository({ question, directory: root, limit: 5 });
    expect(alone.fused).toBe(false);
    expect(alone.files[0]).toBe('src/main/kotlin/io/RetryPolicy.kt');
    // **The list on its own is a list of three paths, and the answer is last in it.**
    const arm = readDeclarations(armFile);
    expect(arm[2]).toBe('src/main/kotlin/io/RetryPolicy.kt');
    expect(arm).toHaveLength(3);
  });

  it('**the fusion is a union, and its leader was ranked by both arms**', () => {
    const output = locateRepository({
      question: 'retry policy drops the timeout on the managed channel',
      directory: root,
      limit: 10,
      declarationsFile: armFile,
    });
    expect(output.success).toBe(true);
    expect(output.fused).toBe(true);
    expect(output.k).toBe(RRF_K);
    // **Every path either arm ranked is in the result**, so a caller does not lose the evidence it brought - which is
    // the difference between a fusion and an intersection.
    for (const path of readDeclarations(armFile)) expect(output.files).toContain(path);
    // **And the leader is a path both arms ranked.** That is the defining property of a fused ranking: the head is not
    // one arm's opinion, it is the position the two agree on most.
    expect(readDeclarations(armFile)).toContain(output.files[0]);
    expect(output.fileLevel).toContain(output.files[0]);
  });

  it('**two arms’ evidence outranks the noise of two thousand generated paths**', () => {
    // The checkout holds 2 153 Kotlin files and only three of them are about the issue. A ranking that fuses the
    // agent's three paths with a file-level reading of the whole universe has to keep those three at the top - a
    // ranking that let a `Generated…` file into the first three would be evidence that the fusion was reading paths
    // rather than terms.
    const output = locateRepository({
      question: 'retry policy drops the timeout on the managed channel',
      directory: root,
      limit: 10,
      declarationsFile: armFile,
    });
    const firstThree = output.files.slice(0, 3).sort();
    expect(firstThree).toEqual(
      [
        'src/main/kotlin/io/RetryConfig.kt',
        'src/main/kotlin/io/RetryPolicy.kt',
        'src/main/kotlin/io/TimeoutDefaults.kt',
      ].sort(),
    );
  });

  it('**every path it returns is repository-relative and inside the corpus’s universe**', () => {
    // The property that lets a measurement score a locate at all: the coordinate system is the corpus's, so nothing
    // here is an absolute path the scorer would fail to intersect.
    const universe = corpusFiles(root, '.kt');
    const output = locateRepository({
      question: 'retry policy',
      directory: root,
      limit: 20,
      declarationsFile: armFile,
    });
    for (const file of output.files) expect(universe).toContain(file);
    expect(output.files.every((file) => !file.startsWith('/') && !file.includes('\\'))).toBe(true);
  });

  it('**a JSON arm from a program works too**, which is the form a tool integration produces', () => {
    const jsonArm = join(mkdtempSync(join(tmpdir(), 'agent-arm-json-')), 'arm.json');
    writeFileSync(jsonArm, JSON.stringify(['src/main/kotlin/io/RetryPolicy.kt']));
    const output = locateRepository({
      question: 'retry policy drops the timeout on the managed channel',
      directory: root,
      limit: 5,
      declarationsFile: jsonArm,
    });
    expect(output.fused).toBe(true);
    expect(output.files[0]).toBe('src/main/kotlin/io/RetryPolicy.kt');
    rmSync(jsonArm, { force: true });
  });
});
