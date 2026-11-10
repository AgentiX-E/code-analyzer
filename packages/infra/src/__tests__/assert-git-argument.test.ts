// @code-analyzer/infra — the git-argument guard, on its own
//
// **The guard is the second half of a two-part fix and it was only tested through its callers.** `git-operations.ts` and
// `github/repo-sync.ts` each exercise one branch of it, which is why the file sat at 85.71 % statements while every test
// that touched it passed: **a guard tested only through its callers is tested on the branch the caller happens to use.**
// These cases are the guard's own contract, so a caller can rely on all four refusals rather than on the one it triggers.

import { describe, expect, it } from 'vitest';

import { assertGitArgument } from '../git/assert-git-argument.js';

describe('assertGitArgument', () => {
  it('accepts every shape a ref, a range or a commit actually has', () => {
    // **The bound must be a bound on options, not on git.** A SHA, a range, a tag with a slash, a branch with dots and an
    // upstream form all stay legal, and a space is legal too - it is a shell hazard, not an option hazard, and the shell
    // is gone.
    for (const value of [
      'HEAD',
      'main',
      'feature/deep-branch',
      'v1.0.0',
      'HEAD~3..HEAD',
      'abc1234^..def5678',
      'origin/main',
      'a b',
      '@',
    ]) {
      expect(() => assertGitArgument(value, 'the ref')).not.toThrow();
    }
  });

  it('refuses an empty argument, and names what was empty', () => {
    expect(() => assertGitArgument('', 'the from ref')).toThrow(/the from ref may not be empty/);
  });

  it('refuses a non-string, because a caller in JavaScript can pass one', () => {
    // The signature says `string`; the guard exists for the callers TypeScript does not check - a JSON payload, an
    // environment variable read as `any`, a `.mjs` script. **A runtime guard that is only reachable from a type error is
    // still the guard that runs in production**, so it is reached here the only way a test can reach it.
    const notAString = [undefined, null, 42] as unknown as string[];
    for (const value of notAString) {
      expect(() => assertGitArgument(value, 'the branch')).toThrow(/the branch may not be empty/);
    }
  });

  it('refuses a leading dash, and echoes the value it refused', () => {
    // **The message carries the value because the value is the evidence**: a branch called `--upload-pack=…` is the whole
    // of the injection, and a caller that only sees "invalid" cannot tell it from a typo.
    expect(() => assertGitArgument('--upload-pack=touch /tmp/pwned', 'the branch')).toThrow(
      /may not begin with '-' \(got "--upload-pack=touch \/tmp\/pwned"\)/,
    );
    expect(() => assertGitArgument('-', 'the branch')).toThrow(/may not begin with '-'/);
  });

  it('refuses the characters git itself refuses, in any position', () => {
    for (const value of ['a\0b', 'a\nb', 'a\rb', '\n', 'HEAD\n']) {
      expect(() => assertGitArgument(value, 'the commit')).toThrow(
        /may not contain a NUL, newline or carriage return/,
      );
    }
  });

  it('checks the option shape before the character shape, so the message names the likelier cause', () => {
    // A value that is both is refused as an option, because an option is what a leading dash means and the newline is
    // usually the thing that follows it.
    expect(() => assertGitArgument('--output=/tmp/x\n', 'the ref')).toThrow(
      /may not begin with '-'/,
    );
  });
});
