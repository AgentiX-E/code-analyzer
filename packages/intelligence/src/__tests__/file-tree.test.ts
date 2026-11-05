// **The answer space of a checkout, produced from the filesystem alone.** Every ranking the fallback publishes is a
// ranking over this list, so the list's rules - what counts as source, what is skipped, what happens at the cap - are
// the ranking's rules. They are tested here rather than through a ranking, because a defect in the walk would show up as
// a movement in a mean and would be attributed to the scorer.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SKIPPED_DIRECTORIES, SOURCE_EXTENSIONS, walkSourceFiles } from '../search/file-tree.js';

describe('walkSourceFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'file-tree-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists source files as repository-relative POSIX paths, sorted', () => {
    mkdirSync(join(root, 'src', 'main'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# title');
    writeFileSync(join(root, 'src', 'b.py'), '');
    writeFileSync(join(root, 'src', 'main', 'a.java'), '');

    expect(walkSourceFiles(root).files).toEqual(['src/b.py', 'src/main/a.java']);
  });

  it('**skips the directories that are not the project’s code**, and only those', () => {
    // A dependency directory holds more files than the repository it is installed into, and none of them can be the
    // answer to a question about this project. The negative half of this test matters as much as the positive one: a
    // list that skipped too much would hide the answer and look like a ranking failure.
    for (const skipped of ['node_modules', 'target', 'build', '.git', 'vendor']) {
      mkdirSync(join(root, skipped), { recursive: true });
      writeFileSync(join(root, skipped, 'dependency.java'), '');
    }
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'real.java'), '');

    expect(walkSourceFiles(root).files).toEqual(['src/real.java']);
    expect(SKIPPED_DIRECTORIES).toContain('node_modules');
  });

  it('matches an extension case-insensitively, because a checkout can hold `.JAVA`', () => {
    writeFileSync(join(root, 'Loud.JAVA'), '');
    expect(walkSourceFiles(root).files).toEqual(['Loud.JAVA']);
  });

  it('**does not treat a directory named like an extension as a file**', () => {
    // The suffix test is on the file's own name. A directory called `json` - which appears in real repositories - must
    // not make every file beneath it a candidate, and it must not itself be listed.
    mkdirSync(join(root, 'json'), { recursive: true });
    writeFileSync(join(root, 'json', 'notes.txt'), '');
    expect(walkSourceFiles(root).files).toEqual([]);
  });

  it('keeps the configuration formats a question can name', () => {
    // `where is the retry timeout configured` has an answer in a manifest, and a fallback that could only see `.java`
    // would answer a narrower question than the one asked.
    writeFileSync(join(root, 'pom.xml'), '');
    writeFileSync(join(root, 'application.yml'), '');
    writeFileSync(join(root, 'package.json'), '');
    expect(walkSourceFiles(root).files).toEqual(['application.yml', 'package.json', 'pom.xml']);
    expect(SOURCE_EXTENSIONS).toContain('.xml');
  });

  it('honours an explicit extension list instead of the default', () => {
    writeFileSync(join(root, 'a.java'), '');
    writeFileSync(join(root, 'b.kt'), '');
    expect(walkSourceFiles(root, { extensions: ['.kt'] }).files).toEqual(['b.kt']);
  });

  it('**stops at the cap and says so**, rather than truncating silently', () => {
    // **Three sibling directories, because the cap is hit inside one of them.** A checkout is a tree and a cap reached
    // in one branch has to stop the others too: a walk that kept descending into the next directory would report
    // `truncated` and then rank a universe larger than the one it said it was ranking.
    for (const directory of ['a', 'b', 'c']) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'file.py'), '');
    }
    const walked = walkSourceFiles(root, { maxFiles: 1 });
    expect(walked.files).toHaveLength(1);
    expect(walked.truncated).toBe(true);
  });

  it('does not claim truncation when the checkout fits', () => {
    writeFileSync(join(root, 'only.py'), '');
    expect(walkSourceFiles(root, { maxFiles: 3 })).toEqual({
      files: ['only.py'],
      truncated: false,
    });
  });

  it('answers an empty directory with an empty tree rather than with undefined', () => {
    expect(walkSourceFiles(root)).toEqual({ files: [], truncated: false });
  });

  it('does not follow a symlinked directory, so a cycle cannot make the walk infinite', () => {
    // A `node_modules` symlinked from three packages is the real case; a self-referential link is the one that would
    // never return. `readdir` reports a symlink as neither file nor directory, and that is the whole of the rule.
    mkdirSync(join(root, 'pkg'), { recursive: true });
    writeFileSync(join(root, 'pkg', 'real.py'), '');
    symlinkSync(join(root, 'pkg'), join(root, 'loop'), 'dir');
    expect(walkSourceFiles(root).files).toEqual(['pkg/real.py']);
  });
});
