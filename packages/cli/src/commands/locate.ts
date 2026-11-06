// @code-analyzer/cli — Locate Command
//
// **The command for the repository the analyser cannot enter.** `analyze` and `search` both start by building the graph,
// and the graph is the thing that costs memory and time; on a checkout of twenty thousand files that cost is a refusal.
// `locate` reads a path and an import block per file and nothing else, so it answers on exactly the checkouts where the
// rest of the product declines - and it says in its own output which of the two it did.
//
// **And it takes the list the caller already has.** `--declarations <file>` is a ranking from an earlier `search`, an
// editor's symbol list, or another revision - paths, best first, one per line or as a JSON array. Measured on Long Code
// Arena, the two readings win on different bands (the declaration pool by 0.15 on the smallest checkouts, this one by
// 0.12 on the 200-500-file ones), so the command fuses them (`reciprocalRankFusion`, `k = 10`) rather than choosing.

import { readFileSync } from 'node:fs';
import { EOL } from 'node:os';

import { locateFiles } from '@code-analyzer/intelligence';

export interface LocateCommandOptions {
  /** The question, in the words the reader would use. */
  readonly question: string;
  /** The checkout to rank. */
  readonly directory: string;
  /** How many paths to print. */
  readonly limit?: number;
  /** Output format. */
  readonly format?: 'text' | 'json';
  /** Restrict the extensions, when the reader knows the answer's shape. **An empty value means the defaults.** */
  readonly extensions?: readonly string[];
  /**
   * A declaration ranking to fuse in, **as the caller holds it**: paths, best first.
   *
   * The command does not check that these paths exist in the checkout. A ranking from another revision names files this
   * one may have deleted, and dropping them would quietly turn a fusion into an intersection.
   */
  readonly declarations?: readonly string[];
  /** The same ranking, **as a file**: a JSON array of paths or one path per line, which is what a shell can produce. */
  readonly declarationsFile?: string;
  /**
   * Whether to read the files' bodies. **Default `true`**, and `false` is kept for a caller paying for the I/O.
   *
   * The body arm is what makes this command answer a question written in the words the code is written in rather than in
   * the words its imports are: on Long Code Arena the path-and-imports reading scored **0.1441** on the instances the
   * analyser refuses, where the whole-body reading scored **0.3116**. Both run without a parser; the command fuses them.
   */
  readonly body?: boolean;
}

/**
 * Read a declaration ranking from a file.
 *
 * **Two forms, because two callers produce one.** A JSON array is what a program writes; one path per line is what
 * `git`, `grep` and a terminal pipeline write. Blank lines and `#` comments are skipped, since both forms are hand-edited
 * often enough that a trailing newline should not become an entry named `''`.
 *
 * **It does not check that the paths exist.** A ranking from another revision names files this one may have deleted;
 * filtering them would turn the fusion into an intersection, which is the opposite of what the second arm is for.
 */
export function readDeclarations(path: string): string[] {
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return [];
  if (text.startsWith('[')) {
    const parsed: unknown = JSON.parse(text);
    // **Checked rather than cast**, because this file is an interface a caller writes by hand: an array of numbers
    // would fuse as `1`, `2`, `3` and produce a ranking of paths that do not exist.
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string'))
      throw new Error(`${path} is a JSON array that is not an array of strings`);
    return parsed as string[];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export interface LocateOutput {
  readonly success: boolean;
  readonly question: string;
  readonly directory: string;
  /** The ranked paths, best first. */
  readonly files: readonly string[];
  /** How many files the answer space held. **The denominator of the ranking.** */
  readonly answerSpace: number;
  /** The walk hit its cap, so the universe is a prefix of the checkout rather than all of it. */
  readonly truncated: boolean;
  /** Import statements the extraction found. **Zero means it missed the language, not that files have no imports.** */
  readonly importLines: number;
  /** The path-and-imports arm alone, **before any fusion** - present only when `declarations` was supplied. */
  readonly fileLevel?: readonly string[];
  /** The whole-body arm alone, **before any fusion**. Empty when the caller disabled it. */
  readonly bodyRanked: readonly string[];
  /** Whether the printed order is a fusion of two arms. **A reader has to be able to tell.** */
  readonly fused: boolean;
  /** The rank constant the fusion used, or `null` when nothing was fused. */
  readonly k: number | null;
  /** Files whose head could not be read. */
  readonly unreadableFiles: number;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Rank a checkout's files against a question, **without building an index**.
 *
 * The failure mode this command exists for is a repository too large to parse; a command that parsed it first would fail
 * with it. So the only filesystem work here is one bounded read per file, and the only state is a token array per file.
 */
export function locateRepository(options: LocateCommandOptions): LocateOutput {
  const started = Date.now();
  try {
    // **`declarations` wins over `declarationsFile`**, because a caller that passed both has one list and one copy of it.
    const declarations =
      options.declarations ??
      (options.declarationsFile === undefined
        ? undefined
        : readDeclarations(options.declarationsFile));
    const result = locateFiles(options.directory, options.question, {
      limit: options.limit ?? 10,
      extensions: options.extensions,
      ...(declarations === undefined ? {} : { declarations }),
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    const fused = result.fusion !== null;
    return {
      success: true,
      question: options.question,
      directory: options.directory,
      files: result.ranked,
      answerSpace: result.answerSpace,
      truncated: result.truncated,
      importLines: result.importLines,
      ...(fused ? { fileLevel: result.fileLevel } : {}),
      bodyRanked: result.bodyRanked,
      fused,
      k: result.fusion === null ? null : result.fusion.k,
      unreadableFiles: result.unreadableFiles,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      success: false,
      question: options.question,
      directory: options.directory,
      files: [],
      answerSpace: 0,
      truncated: false,
      importLines: 0,
      bodyRanked: [],
      fused: false,
      k: null,
      unreadableFiles: 0,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Render a locate for a terminal or for a program. */
export function formatLocateOutput(output: LocateOutput, format: 'text' | 'json'): string {
  if (format === 'json') return JSON.stringify(output, null, 2);

  if (!output.success) return `Locate failed: ${output.error ?? 'unknown error'}${EOL}`;

  // **The universe is printed before the ranking**, because a ranking of ten files out of nineteen is a different claim
  // from a ranking of ten out of twenty thousand, and a reader who sees only the ten cannot tell which they have.
  const lines = [
    `Question: ${output.question}`,
    `Answer space: ${String(output.answerSpace)} files` +
      (output.truncated ? ' (walk capped, the ranking is a lower bound)' : '') +
      ` · ${String(output.importLines)} import statements · ${String(output.unreadableFiles)} unreadable · ` +
      `${String(output.durationMs)}ms` +
      (output.fused ? ` · fused with the declaration arm (k = ${String(output.k ?? 0)})` : ''),
    EOL,
  ];
  if (output.files.length === 0) {
    lines.push('No file matched the question.', EOL);
    return lines.join(EOL);
  }
  output.files.forEach((file, index) => {
    lines.push(`${String(index + 1).padStart(3, ' ')}. ${file}`);
  });
  return lines.join(EOL) + EOL;
}
