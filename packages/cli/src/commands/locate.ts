// @code-analyzer/cli — Locate Command
//
// **The command for the repository the analyser cannot enter.** `analyze` and `search` both start by building the graph,
// and the graph is the thing that costs memory and time; on a checkout of twenty thousand files that cost is a refusal.
// `locate` reads a path and an import block per file and nothing else, so it answers on exactly the checkouts where the
// rest of the product declines - and it says in its own output which of the two it did.

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
    const result = locateFiles(options.directory, options.question, {
      limit: options.limit ?? 10,
      extensions: options.extensions,
    });
    return {
      success: true,
      question: options.question,
      directory: options.directory,
      files: result.ranked,
      answerSpace: result.answerSpace,
      truncated: result.truncated,
      importLines: result.importLines,
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
      `${String(output.durationMs)}ms`,
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
