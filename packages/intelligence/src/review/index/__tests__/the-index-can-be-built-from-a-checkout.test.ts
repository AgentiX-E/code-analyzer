// @code-analyzer/intelligence — the index has a reader that can see a checkout, which is what it never had
//
// **§100 put the index in front of the sentence and then found that nothing supplies it.** `buildRepoIndex` takes
// `{path, text}` pairs and every caller of it had already decided which files to read: a benchmark that fetched the
// changed files, a report that globbed `packages/*/src`. **A repository on disk is the one source neither of them had**,
// and it is the source the product has — an action runs inside a checkout.
//
// **The tests below are about the three ways a walk can lie.** It can read what it was told not to (a dependency, a
// build output, a test fixture), it can silently stop at a cap and report a small repository, and it can hand back an
// order that depends on the filesystem rather than on the input. **Each of those has a case**, because each of them
// would produce an index that is wrong in a direction nobody can see from the counts.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRepoFiles } from '../repo-files.js';
import { buildRepoIndex, impactOf } from '../repo-index.js';

let root = '';

/** Write one file into the fixture tree, creating its directories. */
function write(path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'repo-files-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('what a checkout gives the index', () => {
  it('reads the files an index can use, repo-relative and in sorted order', () => {
    write('src/b.ts', 'export const b = 1;\n');
    write('src/a.ts', 'import { b } from "./b.js";\nexport const a = b;\n');
    write('README.md', '# hi\n');

    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    // **Sorted, and repo-relative with forward slashes.** A walk that returned `readdir` order would build two indexes
    // from one repository and call the difference a fact - and the edge list this feeds is sorted by path.
    expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(tree.files[0]!.text).toContain('import { b }');
  });

  it('does not read a dependency, a build output, or a directory it was told to skip', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('node_modules/pkg/index.ts', 'export const vendored = 1;\n');
    write('dist/a.js', 'exports.a = 1;\n');
    write('src/__tests__/a.test.ts', 'export const fixture = 1;\n');

    const tree = readRepoFiles(root, {
      extensions: ['.ts', '.js'],
      skipDirectories: ['node_modules', 'dist', '__tests__'],
    });
    // **The reason this is a test and not a default**: the index over a checkout with `node_modules` in it would hold
    // forty thousand files of other people's code, and every rate it reported would be a rate over a dependency tree.
    expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('reports what a cap hid instead of returning a small repository', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 2;\n');
    write('src/c.ts', 'export const c = 3;\n');

    const tree = readRepoFiles(root, { extensions: ['.ts'], maxFiles: 2 });
    expect(tree.files).toHaveLength(2);
    // **`skippedOverCap` is the field that makes the cap honest.** A caller that only read `files.length` would believe
    // it had indexed a repository of two files rather than two of three.
    expect(tree.stats.skippedOverCap).toBe(1);
    expect(tree.stats.considered).toBe(3);
  });

  it('skips a file too large to be source, and says how many bytes it refused', () => {
    write('src/small.ts', 'export const a = 1;\n');
    write('src/generated.ts', `export const big = "${'x'.repeat(4000)}";\n`);

    const tree = readRepoFiles(root, { extensions: ['.ts'], maxFileBytes: 1024 });
    expect(tree.files.map((file) => file.path)).toEqual(['src/small.ts']);
    expect(tree.stats.skippedBySize).toBe(1);
  });

  it('counts the bytes it read, because the walk is a purchase like any other', () => {
    write('src/a.ts', 'export const a = 1;\n');
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    expect(tree.stats.bytes).toBe('export const a = 1;\n'.length);
  });

  it('answers the same twice, which is what makes an index a measurement', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/z/b.ts', 'export const b = 2;\n');
    const first = readRepoFiles(root, { extensions: ['.ts'] });
    const second = readRepoFiles(root, { extensions: ['.ts'] });
    expect(second.files).toEqual(first.files);
    expect(second.stats).toEqual(first.stats);
  });

  it('feeds buildRepoIndex, so a change reaches the file that reads it', () => {
    write('src/limit.ts', 'export function withinLimit(n) { return n; }\n');
    write('src/caller.ts', 'import { withinLimit } from "./limit.js";\nwithinLimit(1);\n');

    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    const index = buildRepoIndex(tree.files);
    expect(impactOf(index, 'src/limit.ts', ['withinLimit']).paths).toEqual(['src/caller.ts']);
  });

  it('counts the directories it refused, so a skip list is visible in the numbers', () => {
    write('src/a.ts', 'export const a = 1;\n');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    const tree = readRepoFiles(root, { extensions: ['.ts'], skipDirectories: ['node_modules'] });
    // **One directory, counted at the top of the tree it names** - a walk that descended into `node_modules/pkg` and
    // counted each package would report a number that depends on how many dependencies the repository has.
    expect(tree.stats.directoriesSkipped).toBe(1);
    expect(tree.files).toHaveLength(1);
  });

  it('ignores a name with no extension, and a link to something outside the tree', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('LICENSE', 'MIT\n');
    symlinkSync(join(root, 'src'), join(root, 'src-link'));
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    // **A link is not followed**, because a checkout can hold one that points at its own parent and a walk that
    // followed it would index the repository once per link, or never finish.
    expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('lets the caller refuse a file the index would have read, without counting it as considered', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/a.d.ts', 'export declare const a: number;\n');
    const tree = readRepoFiles(root, {
      extensions: ['.ts'],
      accept: (path) => !path.endsWith('.d.ts'),
    });
    // **A declaration of a file the walk already read is not a second file**, and counting it would make every rate a
    // rate over both the source and a copy of its signature.
    expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(tree.stats.considered).toBe(1);
  });

  it('skips a name that is neither a file nor a directory, and counts nothing it could not read', () => {
    write('src/a.ts', 'export const a = 1;\n');
    // **A pipe is not source**, and a walk that tried to read one would block for as long as the writer lived.
    execFileSync('mkfifo', [join(root, 'src', 'pipe.ts')]);
    const tree = readRepoFiles(root, { extensions: ['.ts'] });
    expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  // **Both of the next two cases need a filesystem that refuses a read, and root is not refused one.** They run on the
  // CI runner, which is not root, and they are skipped where the OS cannot produce the failure - **a test that lies
  // about having produced it would be worse than a skipped one**.
  const refuses = process.getuid?.() === 0 ? it.skip : it;

  refuses('reports a directory it could not list instead of throwing', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('closed/b.ts', 'export const b = 1;\n');
    chmodSync(join(root, 'closed'), 0o000);
    try {
      const tree = readRepoFiles(root, { extensions: ['.ts'] });
      expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
      expect(tree.stats.readable).toBe(true);
    } finally {
      chmodSync(join(root, 'closed'), 0o755);
    }
  });

  refuses('counts a file it could not read, rather than indexing it as empty', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/locked.ts', 'export const locked = 1;\n');
    chmodSync(join(root, 'src/locked.ts'), 0o000);
    try {
      const tree = readRepoFiles(root, { extensions: ['.ts'] });
      expect(tree.files.map((file) => file.path)).toEqual(['src/a.ts']);
      // **An empty read and an unreadable file are different facts**: the first is a file with no code and the second is
      // a file this index does not know, and reporting the second as the first would make a change to it look contained.
      expect(tree.stats.skippedUnreadable).toBe(1);
    } finally {
      chmodSync(join(root, 'src/locked.ts'), 0o644);
    }
  });

  it('stops at a byte budget for the walk, counted apart from the file cap', () => {
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 2;\n');
    // **Thirty bytes, and the arithmetic is the test**: each fixture is twenty, so the first fits and the second would
    // cross the budget - a budget of forty admits both, which is what the first version of this case claimed it did not.
    const tree = readRepoFiles(root, { extensions: ['.ts'], maxTotalBytes: 30 });
    // **One file fits and the second does not**, and the count that says so is its own field: a caller that raised the
    // file cap to index a monorepo would otherwise be told the repository was smaller than it is.
    expect(tree.files).toHaveLength(1);
    expect(tree.stats.skippedOverBytes).toBe(1);
  });

  it('reports a root that is a file, as well as one that is absent', () => {
    write('src/a.ts', 'export const a = 1;\n');
    expect(readRepoFiles(join(root, 'src/a.ts'), { extensions: ['.ts'] }).stats.readable).toBe(
      false,
    );
  });

  it('reports a root that is not a directory rather than throwing', () => {
    const tree = readRepoFiles(join(root, 'absent'), { extensions: ['.ts'] });
    // **A review that cannot see a checkout must still run**, and the empty tree with a stated reason is the answer
    // that lets it: the caller decides whether to review without an index, and the artifact records which it did.
    expect(tree.files).toHaveLength(0);
    expect(tree.stats.readable).toBe(false);
  });
});
