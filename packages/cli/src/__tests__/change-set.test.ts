// @code-analyzer/cli — resolving the change a review runs on
//
// The three callers in `.github/workflows/pr-review.yml`, `.circleci/config.yml` and
// `docs/CODE-REVIEW.md` ask the same question in three shapes, and this is where the three become one answer.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRepo, type GitFixture } from './git-fixture.js';
import {
  ChangeSetError,
  describeLanguages,
  diffMembership,
  extensionsForLanguages,
  readIfPresent,
  repositorySlug,
  resolveChangeSet,
  slugFromRemote,
} from '../commands/change-set.js';

describe('repositorySlug', () => {
  it('accepts owner/name and nothing else', () => {
    expect(repositorySlug('AgentiX-E/code-analyzer')).toBe('AgentiX-E/code-analyzer');
    expect(repositorySlug('a/b/c')).toBeUndefined();
    expect(repositorySlug('.')).toBeUndefined();
    expect(repositorySlug('/tmp/x')).toBeUndefined();
    expect(repositorySlug(undefined)).toBeUndefined();
  });

  it('refuses a slug that is also a directory, because the caller meant the directory', () => {
    // `--repo .` and `--repo owner/name` are both legitimate; only one of them exists on disk. A path that does is
    // always the path, never a repository that happens to be named like one.
    expect(repositorySlug('packages/cli')).toBeUndefined();
  });
});

describe('slugFromRemote', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('reads the https spelling', () => {
    repo.remote('https://github.com/AgentiX-E/code-analyzer.git');
    expect(slugFromRemote(repo.dir)).toBe('AgentiX-E/code-analyzer');
  });

  it('reads the ssh spelling, which is what a developer clone has', () => {
    repo.remote('git@github.com:AgentiX-E/code-analyzer.git');
    expect(slugFromRemote(repo.dir)).toBe('AgentiX-E/code-analyzer');
  });

  it('reads a remote without the .git suffix', () => {
    repo.remote('ssh://git@github.com/AgentiX-E/code-analyzer');
    expect(slugFromRemote(repo.dir)).toBe('AgentiX-E/code-analyzer');
  });

  it('answers undefined for a repository with no origin, rather than guessing', () => {
    const bare = createRepo();
    try {
      expect(slugFromRemote(bare.dir)).toBeUndefined();
    } finally {
      bare.cleanup();
    }
  });

  it('answers undefined for a directory that is not a repository', () => {
    expect(slugFromRemote('/tmp')).toBeUndefined();
  });
});

describe('extensionsForLanguages', () => {
  it('maps a language to every extension the engine recognises for it', () => {
    const { extensions, unknown } = extensionsForLanguages(['typescript']);
    expect(extensions).toContain('.ts');
    expect(extensions).toContain('.tsx');
    expect(unknown).toEqual([]);
  });

  it('is case-insensitive and trims, because a workflow input arrives as written', () => {
    const { extensions } = extensionsForLanguages(['  PYTHON ']);
    expect(extensions).toContain('.py');
  });

  it('reports an unknown language instead of silently analysing nothing', () => {
    const { extensions, unknown } = extensionsForLanguages(['typescript', 'cobol']);
    expect(unknown).toEqual(['cobol']);
    expect(extensions).toContain('.ts');
  });

  it('deduplicates when two languages share an extension', () => {
    const { extensions } = extensionsForLanguages(['typescript', 'typescript']);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it('ignores empty entries, which a trailing comma produces', () => {
    expect(extensionsForLanguages(['', '  ']).unknown).toEqual([]);
  });

  it('lists the languages it accepts, for the error message', () => {
    const listed = describeLanguages();
    for (const language of ['java', 'typescript', 'python', 'kotlin', 'swift', 'arkts']) {
      expect(listed).toContain(language);
    }
  });
});

describe('resolveChangeSet — refs mode', () => {
  let repo: GitFixture;

  beforeAll(() => {
    repo = createRepo();
    repo.branch('feature');
    repo.write('src/feature.ts', 'export const feature = 2;\n');
    repo.commit('feature work');
    // **A commit on the base after the branch point**, which is what makes the three-dot assertion below meaningful:
    // `main..feature` would report this file as a deletion made by the feature branch.
    repo.checkout('main');
    repo.write('src/unrelated.ts', 'export const unrelated = 3;\n');
    repo.commit('base work');
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('reviews what the branch added, not what the base did in the meantime', async () => {
    const change = await resolveChangeSet({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
    });

    expect(change.mode).toBe('refs');
    expect(change.files).toEqual(['src/feature.ts']);
    expect(change.files).not.toContain('src/unrelated.ts');
    expect(change.baseRef).toBe('main');
    expect(change.headRef).toBe('feature');
    expect(change.changedFileCount).toBe(1);
    // **This checkout is at `main`, so the file the branch added is not on disk** — and the change set says so instead
    // of pretending it read a file it could not open. `.github/workflows/pr-review.yml` checks the head out first, which
    // is why its run does get the text; the two facts are different and both are reported.
    expect(change.unreadable).toEqual(['src/feature.ts']);
  });

  it('reads the text of an added file when the checkout is at the head', async () => {
    repo.checkout('feature');
    try {
      const change = await resolveChangeSet({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'feature',
      });
      expect(change.contents.get('src/feature.ts')).toContain('export const feature');
      expect(change.unreadable).toEqual([]);
    } finally {
      repo.checkout('main');
    }
  });

  it('honours maxFiles while still reporting how many files the change touched', async () => {
    const change = await resolveChangeSet({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      maxFiles: 0,
    });

    expect(change.files).toEqual([]);
    // The number a reader needs in order to know the review saw nothing: not zero, because nothing was zero.
    expect(change.changedFileCount).toBe(1);
  });

  it('drops excluded paths', async () => {
    const change = await resolveChangeSet({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      exclude: ['src/**'],
    });

    expect(change.files).toEqual([]);
    expect(change.changedFileCount).toBe(1);
  });

  it('keeps only the extensions asked for', async () => {
    const kept = await resolveChangeSet({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      extensions: ['.ts'],
    });
    const dropped = await resolveChangeSet({
      repo: repo.dir,
      targetBranch: 'main',
      sourceBranch: 'feature',
      extensions: ['.py'],
    });

    expect(kept.files).toEqual(['src/feature.ts']);
    expect(dropped.files).toEqual([]);
  });

  it('reports a path the diff names but the checkout cannot read', async () => {
    const deleting = createRepo();
    try {
      deleting.write('src/gone.ts', 'export const gone = 1;\n');
      deleting.commit('add');
      deleting.branch('removes');
      deleting.git('rm', '-q', 'src/gone.ts');
      deleting.commit('remove');

      const change = await resolveChangeSet({
        repo: deleting.dir,
        targetBranch: 'main',
        sourceBranch: 'removes',
      });

      // A deletion cannot be reviewed as text, and saying so is the difference between a report that read 9 of 10
      // files and one that claims to have read 10.
      expect(change.files).toEqual(['src/gone.ts']);
      expect(change.unreadable).toEqual(['src/gone.ts']);
      expect(change.contents.has('src/gone.ts')).toBe(false);
    } finally {
      deleting.cleanup();
    }
  });

  it('defaults a missing ref to HEAD rather than refusing to run', async () => {
    const change = await resolveChangeSet({ repo: repo.dir, targetBranch: 'main' });
    expect(change.baseRef).toBe('main');
    expect(change.headRef).toBe('HEAD');
  });

  it('raises a readable error when the ref does not exist', async () => {
    await expect(
      resolveChangeSet({ repo: repo.dir, targetBranch: 'no-such-branch' }),
    ).rejects.toThrow(ChangeSetError);
  });
});

describe('resolveChangeSet — tree mode', () => {
  it('lists tracked files, because `standards check --repo .` judges a checkout', async () => {
    const repo = createRepo();
    try {
      repo.write('src/second.ts', 'export const second = 1;\n');
      repo.commit('second');

      const change = await resolveChangeSet({ repo: repo.dir });

      expect(change.mode).toBe('tree');
      expect(change.files).toContain('src/base.ts');
      expect(change.files).toContain('src/second.ts');
      expect(change.diffs).toEqual([]);
      expect(change.changedFileCount).toBe(change.files.length);
    } finally {
      repo.cleanup();
    }
  });

  it('refuses a slug without a pull request instead of reviewing the current directory', async () => {
    await expect(resolveChangeSet({ repo: 'owner/name' })).rejects.toThrow(
      /names a repository on GitHub/,
    );
  });

  it('answers "not in a diff" for every line when there is no diff', async () => {
    const repo = createRepo();
    try {
      const change = await resolveChangeSet({ repo: repo.dir });
      const inDiff = diffMembership(change);

      // **Not an exception and not a special case at the call site.** A tree has no hunks, so no line is in one; the
      // question has a correct answer and asking it should not require the caller to know the mode first.
      expect(inDiff('src/base.ts', 1)).toBe(false);
      expect(inDiff('src/anything.ts', 42)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it('refuses a path that does not exist instead of reviewing the current directory', async () => {
    await expect(resolveChangeSet({ repo: '/tmp/no-such-checkout-anywhere' })).rejects.toThrow(
      /neither a path that exists/,
    );
  });
});

describe('resolveChangeSet — github mode', () => {
  const diff = [
    'diff --git a/src/changed.ts b/src/changed.ts',
    'index 1111111..2222222 100644',
    '--- a/src/changed.ts',
    '+++ b/src/changed.ts',
    '@@ -0,0 +1,2 @@',
    '+export const changed = 1;',
    '+',
    'diff --git a/src/deleted.ts b/src/deleted.ts',
    'index 3333333..4444444 100644',
    '--- a/src/deleted.ts',
    '+++ b/src/deleted.ts',
    '@@ -1 +0,0 @@',
    '-export const deleted = 1;',
    '',
  ].join('\n');

  it('reads the diff over the API and the texts from the checkout', async () => {
    const repo = createRepo();
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(diff, { status: 200 }));
    try {
      repo.write('src/changed.ts', 'export const changed = 1;\n');

      const change = await resolveChangeSet({
        repo: 'AgentiX-E/code-analyzer',
        pr: 7,
        token: 'token',
        checkout: repo.dir,
      });

      expect(change.mode).toBe('github');
      expect(change.repository).toBe('AgentiX-E/code-analyzer');
      expect(change.pullRequest).toBe(7);
      expect(change.files).toEqual(['src/changed.ts', 'src/deleted.ts']);
      expect(change.changedFileCount).toBe(2);
      // The checkout has the added file and not the deleted one, and the report says exactly that.
      expect(change.contents.get('src/changed.ts')).toContain('export const changed');
      expect(change.unreadable).toEqual(['src/deleted.ts']);
    } finally {
      stub.mockRestore();
      repo.cleanup();
    }
  });

  it('derives the slug from origin when --repo is a checkout', async () => {
    const repo = createRepo();
    repo.remote('git@github.com:AgentiX-E/code-analyzer.git');
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(diff, { status: 200 }));
    try {
      const change = await resolveChangeSet({
        repo: repo.dir,
        pr: 12,
        token: 'token',
      });

      // `docs/CODE-REVIEW.md` writes exactly `--repo . --pr N`: the pull request, of the repository this checkout is.
      expect(change.repository).toBe('AgentiX-E/code-analyzer');
    } finally {
      stub.mockRestore();
      repo.cleanup();
    }
  });

  it('reads file texts from --repo when it is a directory and --checkout is absent', async () => {
    const repo = createRepo();
    repo.remote('git@github.com:AgentiX-E/code-analyzer.git');
    repo.write('src/changed.ts', 'export const changed = 1;\n');
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(diff, { status: 200 }));
    try {
      // Without this, a run started from another directory would read the wrong tree and report the difference as
      // "unreadable" — a broken review that looks like an empty change.
      const change = await resolveChangeSet({ repo: repo.dir, pr: 7, token: 'token' });
      expect(change.contents.get('src/changed.ts')).toContain('export const changed');
    } finally {
      stub.mockRestore();
      repo.cleanup();
    }
  });

  it('derives the slug from the checkout when neither --repo nor a checkout argument names one', async () => {
    const repo = createRepo();
    repo.remote('git@github.com:AgentiX-E/code-analyzer.git');
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(diff, { status: 200 }));
    try {
      // **`--pr` with a working directory and no `--repo` at all.** The lookup has three sources and the middle one -
      // "ask the directory the user passed" - only runs when `repo` is undefined, so **a suite whose every case passed
      // `--repo` left one arm of that lookup unexecuted and reported it as a coverage regression** the day the counter
      // started counting nullish and ternary arms separately. The behaviour was correct and untested, which is the
      // distinction that matters here.
      const change = await resolveChangeSet({ pr: 7, token: 'token', checkout: repo.dir });
      expect(change.mode).toBe('github');
      expect(change.repository).toBe('AgentiX-E/code-analyzer');
      expect(change.pullRequest).toBe(7);
    } finally {
      stub.mockRestore();
      repo.cleanup();
    }
  });

  it('refuses a pull request with no token', async () => {
    await expect(resolveChangeSet({ repo: 'AgentiX-E/code-analyzer', pr: 1 })).rejects.toThrow(
      /--pr needs --token/,
    );
  });

  it('refuses a pull request whose repository cannot be determined', async () => {
    const bare = createRepo();
    try {
      await expect(resolveChangeSet({ repo: bare.dir, pr: 1, token: 'token' })).rejects.toThrow(
        /--pr needs a repository/,
      );
    } finally {
      bare.cleanup();
    }
  });
});

describe('readIfPresent', () => {
  it('reads a file that is there and answers undefined for one that is not', () => {
    const repo = createRepo();
    try {
      expect(readIfPresent(repo.dir, 'src/base.ts')).toContain('export const base');
      expect(readIfPresent(repo.dir, 'src/absent.ts')).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});

describe('resolveChangeSet — the checkout alone', () => {
  it('judges a checkout passed as --checkout, with no --repo at all', async () => {
    const repo = createRepo();
    try {
      const change = await resolveChangeSet({ checkout: repo.dir });
      expect(change.mode).toBe('tree');
      expect(change.repository).toBe(repo.dir);
      expect(change.files).toEqual(['src/base.ts']);
    } finally {
      repo.cleanup();
    }
  });

  it('takes the head from --source-branch when only that is given', async () => {
    const repo = createRepo();
    try {
      repo.branch('only-head');
      repo.write('src/head.ts', 'export const head = 1;\n');
      repo.commit('head work');

      const change = await resolveChangeSet({ repo: repo.dir, sourceBranch: 'only-head' });
      expect(change.baseRef).toBe('HEAD');
      expect(change.headRef).toBe('only-head');
    } finally {
      repo.cleanup();
    }
  });

  it('matches an exclude glob against the bare file name as well as the whole path', async () => {
    const repo = createRepo();
    try {
      repo.branch('named');
      repo.write('src/named.ts', 'export const named = 1;\n');
      repo.commit('named');

      const byName = await resolveChangeSet({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'named',
        exclude: ['named.ts'],
      });
      const byPath = await resolveChangeSet({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'named',
        exclude: ['src/named.ts'],
      });

      expect(byName.files).toEqual([]);
      expect(byPath.files).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it('ignores an empty exclude pattern instead of excluding everything', async () => {
    const repo = createRepo();
    try {
      repo.branch('kept');
      repo.write('src/kept.ts', 'export const kept = 1;\n');
      repo.commit('kept');

      const change = await resolveChangeSet({
        repo: repo.dir,
        targetBranch: 'main',
        sourceBranch: 'kept',
        exclude: ['', '   '],
      });
      // An empty pattern matches every path under a naive implementation, which would silently review nothing.
      expect(change.files).toEqual(['src/kept.ts']);
    } finally {
      repo.cleanup();
    }
  });

  it('puts git’s own complaint into the error it raises', async () => {
    const repo = createRepo();
    try {
      const failure = resolveChangeSet({ repo: repo.dir, targetBranch: 'no-such-ref' });
      await expect(failure).rejects.toThrow(/git diff .* failed in/);
      // A caller reading the log needs git's sentence, not only the command that failed.
      await expect(
        resolveChangeSet({ repo: repo.dir, targetBranch: 'no-such-ref' }),
      ).rejects.toThrow(/no-such-ref|unknown revision/);
    } finally {
      repo.cleanup();
    }
  });
});
