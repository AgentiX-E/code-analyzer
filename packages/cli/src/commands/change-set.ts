// @code-analyzer/cli — Resolving the change a review runs on
//
// **Three callers ask for the same three things** — the diff, the text of every file the diff touches, and the
// coordinates a report records — and they ask in three different shapes:
//
//   * `.github/workflows/pr-review.yml` passes `--repo ${{ github.repository }} --pr N --token …`: a slug and a
//     pull-request number, because the diff lives on GitHub and the checkout is incidental.
//   * `.circleci/config.yml` and `.gitlab-ci.yml` pass `--repo . --target-branch … --source-branch …`: a checkout and
//     two refs, because the diff is in the clone.
//   * `code-analyzer standards check --repo . --standard …` passes neither: there is no diff to speak of, and the
//     question is about the tree itself.
//
// **So the resolution is one module and the three shapes are branches of it**, not three modules that agree by luck.
// The mode a call ended up in is reported back and printed, because "which diff did you review" is the first question
// a reader of a review report asks and the last thing a script should have to infer.
//
// **`--repo .` with `--pr N` is not a contradiction.** The docs show exactly that pair, and it means *"the pull
// request, of the repository this checkout belongs to"*: the slug comes from `git remote get-url origin`. Rejecting
// it would have been the smaller change and the worse one — it would have turned a documented invocation into an
// error message telling the reader to go and find the slug themselves.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DiffParser, GitHubApiClient, LANGUAGES } from '@code-analyzer/intelligence';
import { globToRegExp } from '@code-analyzer/shared';

import type { GitDiff } from '@code-analyzer/shared';

/** How a change set was obtained. Printed, and part of every report, so a reader never has to guess. */
export type ChangeMode = 'github' | 'refs' | 'tree';

/** What to resolve. Every field is optional: the mode is *derived* from what was supplied, never declared. */
export interface ChangeRequest {
  /** A path to a checkout, or `owner/name`. Which one is detected, not required. */
  repo?: string;
  /** Pull request number, for `github` mode. */
  pr?: number;
  /** Token for `github` mode. */
  token?: string;
  /** Base ref for `refs` mode. */
  targetBranch?: string;
  /** Head ref for `refs` mode. */
  sourceBranch?: string;
  /**
   * Where the file texts are read from.
   *
   * **Separate from `repo` because in `github` mode `repo` is a slug.** `.github/workflows/pr-review.yml` checks the
   * pull request out before calling, so the texts are on disk under the working directory even though the diff comes
   * over the API.
   */
  checkout?: string;
  /** Drop files whose repository-relative path matches any of these globs. */
  exclude?: string[];
  /** Keep only files with one of these extensions, e.g. `.ts`, `.py`. */
  extensions?: string[];
  /** How many files to analyze, after filtering. The rest are counted as truncated, not silently dropped. */
  maxFiles?: number;
}

/** The change a review runs on. */
export interface ChangeSet {
  mode: ChangeMode;
  /** `owner/name` in `github` mode; the resolved directory otherwise. */
  repository: string;
  pullRequest?: number;
  baseRef?: string;
  headRef?: string;
  /** Parsed diffs for the files that survived filtering. Empty in `tree` mode, where there is no diff. */
  diffs: GitDiff[];
  /** Every file selected for analysis, repository-relative, in a stable order. */
  files: string[];
  /** The text of each selected file, keyed by the same path. A file that could not be read is absent. */
  contents: Map<string, string>;
  /** Files that survived filtering but whose text could not be read — analysed by path only, or not at all. */
  unreadable: string[];
  /** How many files the change touched **before** `--exclude`, `--languages` and `--max-files`. */
  changedFileCount: number;
  /**
   * Files dropped by `--exclude` and `--languages`.
   *
   * **Separate from `truncatedFileCount` because the two have different remedies.** A report that said "skipped by
   * --max-files" over files the caller excluded on purpose sends a reader to raise a limit that was never the cause.
   */
  filteredFileCount: number;
  /** Files dropped by `--max-files`, which is the only cause a reader can fix by raising a number. */
  truncatedFileCount: number;
}

/** Raised when the request describes no mode this module can serve. Message is shown to the user verbatim. */
export class ChangeSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeSetError';
  }
}

/** `owner/name`, or `undefined`. A slug is a slash and no filesystem entry at that path. */
export function repositorySlug(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) return undefined;
  if (existsSync(value)) return undefined;
  return value;
}

/**
 * The `owner/name` of the checkout at `directory`, read from `origin`.
 *
 * Both remote spellings are accepted — `https://github.com/o/r.git` and `git@github.com:o/r.git` — because a CI
 * checkout and a developer's clone are routinely the two different things, and the second is the one that makes
 * `--repo . --pr 12` work from a terminal.
 */
export function slugFromRemote(directory: string): string | undefined {
  let url: string;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: directory,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
  const match =
    /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(url);
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

/** One `git` invocation in `cwd`, as text. Throws `ChangeSetError` rather than letting `execFileSync`'s message out. */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new ChangeSetError(
      `git ${args.join(' ')} failed in ${cwd}${stderr ? `: ${stderr}` : ''}`,
    );
  }
}

/** Whether a repository-relative path is kept by `--exclude` and `--languages`. */
function keep(path: string, exclude: readonly string[], extensions: readonly string[]): boolean {
  const posix = path.replace(/\\/g, '/');
  const name = posix.slice(posix.lastIndexOf('/') + 1);
  for (const pattern of exclude) {
    if (pattern.length === 0) continue;
    const regex = globToRegExp(pattern);
    if (regex.test(posix) || regex.test(name)) return false;
  }
  if (extensions.length > 0 && !extensions.some((extension) => posix.endsWith(extension)))
    return false;
  return true;
}

/** Read the texts of the selected files from a checkout. Missing and unreadable files are reported, not thrown on. */
function readContents(
  directory: string,
  files: readonly string[],
): { contents: Map<string, string>; unreadable: string[] } {
  const contents = new Map<string, string>();
  const unreadable: string[] = [];
  for (const file of files) {
    try {
      contents.set(file, readFileSync(join(directory, file), 'utf-8'));
    } catch {
      // **A path the diff names but the checkout does not have is normal** — a deletion, or a checkout made at the
      // base rather than the head. It is recorded so a report can say how much of the change it actually read.
      unreadable.push(file);
    }
  }
  return { contents, unreadable };
}

/** Apply `--exclude`, `--languages` and `--max-files` to a list of paths, preserving order and the two counts. */
function select(
  files: readonly string[],
  request: ChangeRequest,
): { files: string[]; filtered: number; truncated: number } {
  const excluded = request.exclude ?? [];
  const extensions = request.extensions ?? [];
  const kept = files.filter((file) => keep(file, excluded, extensions));
  const selected = request.maxFiles === undefined ? kept : kept.slice(0, request.maxFiles);
  return {
    files: selected,
    filtered: files.length - kept.length,
    truncated: kept.length - selected.length,
  };
}

/**
 * A predicate answering "is this line inside a changed hunk".
 *
 * **This lives beside the diff because the ranges are the diff's.** Two commands ask the question — `review pr` before
 * it reports a finding, `standards check` before it publishes one — and both are asking whether GitHub will accept an
 * inline comment at that position. GitHub answers 422 and rejects the **whole review** when any comment in it names a
 * line outside the diff, so a single unqualified finding does not degrade the report, it replaces it with an error.
 *
 * In `tree` mode the answer is `false` for every line, which is not a special case: there is no diff, so no line is in
 * one. `standards check` uses `mode` rather than this predicate to decide whether the report carries the field at all —
 * "not in the diff" would describe a change nobody made.
 *
 * Built once from the change set's own ranges rather than by scanning the diff per finding: a review of a thousand-file
 * change would otherwise walk the diff a thousand times to answer the same question.
 */
export function diffMembership(change: ChangeSet): (file: string, line: number) => boolean {
  const ranges = new Map<string, [number, number][]>();
  for (const diff of change.diffs) {
    const list = ranges.get(diff.filePath) ?? [];
    for (const range of diff.ranges) list.push([range.newStart, range.newEnd]);
    ranges.set(diff.filePath, list);
  }
  return (file, line) => {
    const list = ranges.get(file);
    if (list === undefined) return false;
    return list.some(([start, end]) => line >= start && line <= end);
  };
}

/**
 * Resolve what a review runs on.
 *
 * Throws `ChangeSetError` when the request names no analysable change — the message says which two options would have
 * worked, because a usage error a caller cannot act on is the same as a crash.
 */
export async function resolveChangeSet(
  request: ChangeRequest,
  parser: DiffParser = new DiffParser(),
): Promise<ChangeSet> {
  // **Where the file texts live, decided once.** In `github` mode `--repo` is a slug and says nothing about the disk;
  // in every other mode it *is* the disk. `--checkout` overrides both, for the caller that reviews a pull request
  // against a checkout somewhere else. Reading from `process.cwd()` after a `--repo ../other-clone --pr 1` would have
  // produced a report about the wrong tree with no warning at all.
  const repoDirectory =
    request.repo !== undefined && existsSync(request.repo) ? resolve(request.repo) : undefined;
  const checkout = resolve(request.checkout ?? repoDirectory ?? '.');

  // ---- github: a pull request, over the API ----------------------------------------------------------------
  if (request.pr !== undefined) {
    if (request.token === undefined || request.token.length === 0) {
      throw new ChangeSetError(
        '--pr needs --token: reading a pull request means authenticating to the API',
      );
    }
    const slug =
      repositorySlug(request.repo) ??
      (request.repo === undefined ? undefined : slugFromRemote(resolve(request.repo))) ??
      slugFromRemote(checkout);
    if (slug === undefined) {
      throw new ChangeSetError(
        '--pr needs a repository: pass --repo owner/name, or run inside a checkout whose origin is on GitHub',
      );
    }
    const [owner, name] = slug.split('/') as [string, string];
    const client = new GitHubApiClient({ token: request.token });
    const diffText = await client.getPRDiff(owner, name, request.pr);
    const diffs = parser.parseUnifiedDiff(diffText);
    const selection = select(
      diffs.map((diff) => diff.filePath),
      request,
    );
    const kept = new Set(selection.files);
    const { contents, unreadable } = readContents(checkout, selection.files);
    return {
      mode: 'github',
      repository: slug,
      pullRequest: request.pr,
      diffs: diffs.filter((diff) => kept.has(diff.filePath)),
      files: selection.files,
      contents,
      unreadable,
      changedFileCount: diffs.length,
      filteredFileCount: selection.filtered,
      truncatedFileCount: selection.truncated,
    };
  }

  // **A slug without a pull request has no local meaning, and guessing one is the worst option.** `--repo owner/name`
  // here once fell through to the working directory and reviewed *this* checkout under someone else's name — a report
  // about the wrong tree with nothing in it saying so.
  const slug = repositorySlug(request.repo);
  if (slug !== undefined) {
    throw new ChangeSetError(
      `--repo ${slug} names a repository on GitHub, so it needs the pull request to review: add --pr N and --token. ` +
        'To review a checkout instead, pass its path.',
    );
  }

  // **A `--repo` that names nothing is an error, not an invitation to review the current directory.** The same
  // fall-through that made a slug mean "here" made a mistyped path mean "here", which is indistinguishable from a
  // correct run until somebody reads the report and finds it is about another repository.
  if (request.repo !== undefined && repoDirectory === undefined) {
    throw new ChangeSetError(
      `--repo ${request.repo} is neither a path that exists nor an owner/name slug`,
    );
  }

  const directory = repoDirectory ?? checkout;

  // ---- refs: a diff inside the clone -----------------------------------------------------------------------
  if (request.targetBranch !== undefined || request.sourceBranch !== undefined) {
    const base = request.targetBranch ?? 'HEAD';
    const head = request.sourceBranch ?? 'HEAD';
    // **Three dots, because a review is about what the branch added**, not about everything the base has done since
    // the two diverged: `a..b` reports the base's own commits as if the head had removed them.
    const diffText = git(['diff', '--no-color', '--unified=3', `${base}...${head}`], directory);
    const diffs = parser.parseUnifiedDiff(diffText);
    const selection = select(
      diffs.map((diff) => diff.filePath),
      request,
    );
    const kept = new Set(selection.files);
    const { contents, unreadable } = readContents(directory, selection.files);
    return {
      mode: 'refs',
      repository: directory,
      baseRef: base,
      headRef: head,
      diffs: diffs.filter((diff) => kept.has(diff.filePath)),
      files: selection.files,
      contents,
      unreadable,
      changedFileCount: diffs.length,
      filteredFileCount: selection.filtered,
      truncatedFileCount: selection.truncated,
    };
  }

  // ---- tree: no diff, the tracked files themselves ----------------------------------------------------------
  // **`standards check` with no refs lands here**, which is what `--repo . --standard …` means: judge this checkout.
  const tracked = git(['ls-files'], directory)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const selection = select(tracked, request);
  const { contents, unreadable } = readContents(directory, selection.files);
  return {
    mode: 'tree',
    repository: directory,
    diffs: [],
    files: selection.files,
    contents,
    unreadable,
    changedFileCount: tracked.length,
    filteredFileCount: selection.filtered,
    truncatedFileCount: selection.truncated,
  };
}

/** Read one file from a checkout, for the callers that need a single text rather than a change set. */
export function readIfPresent(directory: string, file: string): string | undefined {
  try {
    return readFileSync(join(directory, file), 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * The file extensions `--languages typescript,python` selects.
 *
 * **Read from the engine's own language table** rather than a second list kept here. `LANGUAGES` already decides that
 * `.tsx` is TypeScript and `.kt` is Kotlin; a copy in the CLI would eventually disagree — and then `--languages
 * typescript` would analyze a different set of files than the reviewer that later reads them.
 *
 * Unknown names are **returned, not dropped**: `--languages typesript` has to be an error, because the alternative is
 * a pull request reviewed for no language at all while the log says the flag was honoured.
 */
export function extensionsForLanguages(names: readonly string[]): {
  extensions: string[];
  unknown: string[];
} {
  const extensions: string[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (name.length === 0) continue;
    const definition = LANGUAGES.find((entry) => entry.language === name);
    if (definition === undefined) {
      unknown.push(raw.trim());
      continue;
    }
    for (const extension of definition.extensions) {
      if (!extensions.includes(extension)) extensions.push(extension);
    }
  }
  return { extensions, unknown };
}

/** Every language name `--languages` accepts, for the error message that lists them. */
export function describeLanguages(): string {
  return LANGUAGES.map((entry) => entry.language).join(', ');
}
