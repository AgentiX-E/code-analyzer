// **The user story this iteration exists for: the answer is in the file, not in its name.**
//
// A developer has a checkout too large for the analyser, an issue, and no index. The issue is written in the words the
// *code* is written in - a logger call, a retry loop, a null check - and those words appear in no file name and in no
// import statement. Before iteration 81 the product's only no-index reading was a path and an import block, so on this
// checkout it had nothing to match against: measured on Long Code Arena that reading scored **0.1441** on the instances
// the analyser refuses, where a bag of words over the whole file scored **0.3116**.
//
// **So the test is written the way the failure looked.** One of the four files is the answer, and every piece of evidence
// that identifies it lives in its body. The path-and-imports arm is asserted to miss it - that assertion is the whole
// reason the test is not vacuous - and the body arm to find it. The command is then asserted to find it too, and to be
// able to stop finding it when the arm is switched off (`body: false`), which is the difference between a feature and a
// coincidence.
//
// **Three languages in one checkout**, because "which file does this issue touch" is asked of a workspace and not of a
// language: the fixture holds a Python module, a Java class, a Kotlin file and a TypeScript file, and only one of them
// is about the issue.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { locateRepository } from '../../packages/cli/src/commands/locate.js';
import { rankByFileBody } from '../../packages/intelligence/src/search/file-body.js';
import { locateFiles } from '../../packages/intelligence/src/search/locate.js';
import { pathImportsRanking } from '../../packages/intelligence/src/search/path-imports.js';

const QUESTION = 'the connection pool leaks because the release callback never returns the socket';

/** The answer, and the three files that share the checkout's vocabulary without being about it. */
const ANSWER = 'pkg/net/transport.py';

describe('a question whose answer lives in a file body', () => {
  let root: string;
  let universe: string[];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'body-e2e-'));
    const write = (path: string, content: string): void => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    // **The answer**: the issue's nouns are all here, in the body, and none of them is the file's name or an import.
    write(
      ANSWER,
      [
        'import socket',
        '',
        '# The connection pool hands out sockets and this releases nothing.',
        'def acquire(host):',
        '    """Take a socket from the pool."""',
        '    return socket.create_connection((host, 80))',
        '',
        'def release(conn):',
        '    # BUG: the release callback never returns the socket to the pool, so the pool leaks.',
        '    pass',
        '',
      ].join('\n'),
    );
    // **The near misses**: names and imports that a path-and-imports reading ranks highly, and bodies that say nothing
    // about the issue.
    write('pkg/net/pool.py', 'import pkg.net.transport\n\nclass Pool:\n    pass\n');
    write('src/main/java/io/Pool.java', 'package io;\nimport java.net.Socket;\nclass Pool {}\n');
    write('web/src/pool.ts', "import { Socket } from 'net';\nexport class Pool {}\n");

    universe = [
      ANSWER,
      'pkg/net/pool.py',
      'src/main/java/io/Pool.java',
      'web/src/pool.ts',
      'pkg/net/__init__.py',
      'web/package.json',
    ];
    // The last two exist so the universe is not exactly the four files above: a ranking over a hand-picked answer space
    // would not be a ranking.
    write('pkg/net/__init__.py', '');
    write('web/package.json', '{ "name": "web" }\n');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('**the path-and-imports arm cannot see the answer**, which is what makes the next case a repair', () => {
    const arm = pathImportsRanking({ checkout: root, files: universe, query: QUESTION, limit: 10 });
    expect(arm.ranked.length).toBeGreaterThan(0);
    expect(arm.ranked[0]).not.toBe(ANSWER);
  });

  it('**the body arm reads it out of the text**, and puts it first', () => {
    const arm = rankByFileBody({ checkout: root, files: universe, query: QUESTION, limit: 10 });
    expect(arm.ranked[0]).toBe(ANSWER);
    // The arm reports the universe it ranked and what it read, **because a ranking over a prefix is not a ranking**.
    expect(arm.documents).toBe(universe.length);
    expect(arm.bytesRead).toBeGreaterThan(0);
  });

  it('**the command answers it**, with the arm this product did not have until iteration 81', () => {
    const output = locateRepository({ question: QUESTION, directory: root, limit: 5 });
    expect(output.success).toBe(true);
    expect(output.files[0]).toBe(ANSWER);
    // Both file-level arms ran, and the result says so: `fused` stays about the caller's own declaration list, so a
    // caller reading it is not told its evidence was used when it was not.
    expect(output.fused).toBe(false);
    expect(output.bodyRanked[0]).toBe(ANSWER);
  });

  it('**switching the arm off restores the old, weaker answer**, so the gain is the arm and not the fixture', () => {
    // **The falsification of the previous case.** If the answer led with the body arm disabled, the fixture would be
    // ranking on its paths and the new arm would be decoration. It does not lead, which is the measurement.
    const without = locateRepository({
      question: QUESTION,
      directory: root,
      limit: 5,
      body: false,
    });
    expect(without.bodyRanked).toEqual([]);
    expect(without.files[0]).not.toBe(ANSWER);
  });

  it('**every path it returns is repository-relative and inside the universe it ranked**', () => {
    const output = locateRepository({ question: QUESTION, directory: root, limit: 20 });
    for (const file of output.files) {
      expect(universe).toContain(file);
      expect(file.startsWith('/')).toBe(false);
      expect(file.includes('\\')).toBe(false);
    }
  });

  it('**and it fuses the caller’s own list over both file arms**, admitting a path neither arm ranked first', () => {
    // The three-arm case: a caller arrives with one path. The command must keep it - a fusion is a union, and dropping
    // the caller's evidence would make `--declarations` an intersection with whatever the filesystem thinks.
    const output = locateRepository({
      question: QUESTION,
      directory: root,
      limit: 10,
      declarations: ['web/src/pool.ts'],
    });
    expect(output.fused).toBe(true);
    expect(output.files).toContain('web/src/pool.ts');
    expect(output.files).toContain(ANSWER);
    // **The answer stays in the top two**, because the file arms put it first and second and the caller's path is one
    // of the four the checkout holds.
    expect(output.files.slice(0, 2)).toContain(ANSWER);
  });

  it('**a one-entry arm outweighs a two-hundred-entry one, and that is a defect this iteration measures rather than fixes**', () => {
    // **The honest limitation, asserted so that it cannot be quietly believed to be absent.** Reciprocal rank fusion
    // reads positions and nothing else: a single path supplied by the caller sits at rank 1 of its arm and is therefore
    // worth exactly what rank 1 of a whole ranking is worth, and if the file arms *also* rank that path - even third -
    // the sum puts it first. `web/src/pool.ts` is third in the fused file ranking and first once the caller's one-line
    // list is added, above a file both arms rank higher. **That is the pathology the roadmap's "measure the fusion rule
    // itself" entry is about**, and publishing it is the alternative to a test that asserts the answer always wins.
    const without = locateRepository({ question: QUESTION, directory: root, limit: 10 });
    const withCaller = locateRepository({
      question: QUESTION,
      directory: root,
      limit: 10,
      declarations: ['web/src/pool.ts'],
    });
    expect(without.files[0]).toBe(ANSWER);
    expect(withCaller.files[0]).toBe('web/src/pool.ts');
    // The mechanism, recorded per path: the caller's path earns a contribution from each arm it appears in, and the
    // answer earns one from a single arm.
    // **Read from the module rather than from the command's output**: the command prints a ranking, and the per-path
    // contribution record is the module's business - a CLI that grew a map of floats would be answering a question
    // nobody asked it at the terminal.
    const detailed = locateFiles(root, QUESTION, {
      limit: 10,
      declarations: ['web/src/pool.ts'],
    });
    const answer = detailed.fusion?.scores.find((score) => score.path === ANSWER);
    const called = detailed.fusion?.scores.find((score) => score.path === 'web/src/pool.ts');
    expect(Object.keys(answer?.arms ?? {})).toEqual(['file-level']);
    expect(Object.keys(called?.arms ?? {}).sort()).toEqual(['declarations', 'file-level']);
  });
});
