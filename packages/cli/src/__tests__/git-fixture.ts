// @code-analyzer/cli — a real git repository to test against
//
// **Every review test runs on git, not on a stand-in for git.** `change-set.ts` exists to ask git three different
// questions — "what did this pull request change", "what did this branch add", "what is in this tree" — and a fake of
// `execFileSync` would answer all three with whatever the test author believed git says. The failures this module was
// written to prevent (a two-dot diff reporting the base's own commits, a deletion counted as an unreadable file, an
// `origin` URL in the wrong of its two spellings) are precisely the ones a fake cannot reproduce.
//
// The cost is a few hundred milliseconds per repository, which is why each file creates one and shares it across its
// cases rather than one per assertion.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A throwaway repository, driven through the git commands a developer would type. */
export interface GitFixture {
  /** Absolute path to the working tree. */
  readonly dir: string;
  /** Write a file, creating parent directories. */
  write(path: string, content: string): void;
  /** Stage everything and commit. */
  commit(message: string): void;
  /** Create a branch at the current commit and switch to it. */
  branch(name: string): void;
  /** Switch to an existing branch or ref. */
  checkout(ref: string): void;
  /** Point `origin` at `url`, whether or not `origin` already exists. */
  remote(url: string): void;
  /** Run any git command in the working tree and return its stdout. */
  git(...args: string[]): string;
  /** Delete the repository, ignoring failures: a leftover temp directory must not fail a passing test. */
  cleanup(): void;
}

function run(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Create an empty repository with one commit on `main`, so a branch always has a base to diff against. */
export function createRepo(): GitFixture {
  const dir = mkdtempSync(join(tmpdir(), 'code-analyzer-git-'));
  run(dir, ['init', '-q', '-b', 'main', '.']);
  // A local identity, because CI machines and sandboxes routinely have none and `git commit` then refuses.
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Code Analyzer Test']);
  run(dir, ['config', 'commit.gpgsign', 'false']);

  const fixture: GitFixture = {
    dir,
    write(path, content) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    commit(message) {
      run(dir, ['add', '-A']);
      run(dir, ['commit', '-qm', message]);
    },
    branch(name) {
      run(dir, ['checkout', '-q', '-b', name]);
    },
    checkout(ref) {
      run(dir, ['checkout', '-q', ref]);
    },
    remote(url) {
      const existing = run(dir, ['remote'])
        .split('\n')
        .map((line) => line.trim());
      if (existing.includes('origin')) run(dir, ['remote', 'set-url', 'origin', url]);
      else run(dir, ['remote', 'add', 'origin', url]);
    },
    git(...args) {
      return run(dir, args);
    },
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A directory that cannot be removed is the operating system's problem, not the test's.
      }
    },
  };

  // The starting point every fixture shares: one file, one commit, one branch that exists.
  fixture.write('src/base.ts', 'export const base = 1;\n');
  fixture.commit('base');
  return fixture;
}
