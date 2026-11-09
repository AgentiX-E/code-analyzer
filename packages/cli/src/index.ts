#!/usr/bin/env node
// @code-analyzer/cli — Command Line Interface
// Full-featured CLI for Code Analyzer: init, analyze, search, review, status, agent.
// Includes global error handling and signal handling for production readiness.

import { writeFileSync } from 'node:fs';
import { EOL } from 'node:os';

import { Command } from 'commander';

import { createAgentCommand } from './commands/agent.js';
import { analyzeRepository, formatAnalyzeResult, type AnalyzeOptions } from './commands/analyze.js';
import { extensionsForLanguages } from './commands/change-set.js';
import { initProject, type InitOptions } from './commands/init.js';
import {
  formatLocateOutput,
  locateRepository,
  type LocateCommandOptions,
} from './commands/locate.js';
import {
  formatPrReviewReport,
  runPrReview,
  type PrReviewOptions,
} from './commands/pr-review.js';
import { reviewCode, formatReviewResult, type ReviewOptions } from './commands/review.js';
import { searchGraph, formatSearchResult, type SearchOptions } from './commands/search.js';
import { describeSeverityLabels } from './commands/severity.js';
import {
  formatStandardsReport,
  runStandardsCheck,
  type StandardsCheckOptions,
} from './commands/standards-check.js';
import { getStatus, formatStatusReport, type StatusOptions } from './commands/status.js';

// ---------------------------------------------------------------------------
// Global Error Handlers
// ---------------------------------------------------------------------------

function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    console.error(`[code-analyzer] Uncaught exception: ${error.message}`);
    if (process.env['CODE_ANALYZER_DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(`[code-analyzer] Unhandled rejection: ${message}`);
    if (process.env['CODE_ANALYZER_DEBUG'] && reason instanceof Error) {
      console.error(reason.stack);
    }
    process.exit(1);
  });

  // Handle SIGINT (Ctrl+C) gracefully for long-running commands
  process.on('SIGINT', () => {
    console.error(`${EOL}[code-analyzer] Interrupted by user (SIGINT)`);
    process.exit(130);
  });

  // Handle SIGTERM for graceful termination
  process.on('SIGTERM', () => {
    console.error(`${EOL}[code-analyzer] Terminated (SIGTERM)`);
    process.exit(143);
  });
}

// ---------------------------------------------------------------------------
// Commander Program
// ---------------------------------------------------------------------------

/**
 * Accumulate a repeatable option, `commander`'s shape for one flag stated several times.
 *
 * **A parser rather than a comma-split**, because a glob may contain a comma (`{a,b}.kt` is a brace expansion) and a
 * split on that character would turn one pattern into two that match nothing.
 */
function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const program = new Command();

// **`enablePositionalOptions` is what makes `review pr --format json` mean what it says.** `review` and its `pr`
// subcommand legitimately share flag names — `--severity`, `--format` — and without this, commander resolves the shared
// flag against the *parent* while parsing, then hands the child its default: `--format json` produced a text report and
// said nothing about why. Turning it on makes the parent stop looking for options once the subcommand appears; the
// parent's own form, `review ./src --format json`, still parses exactly as before.
program.enablePositionalOptions();

program
  .name('code-analyzer')
  .description(
    'World-class code intelligence platform — analyze, search, and review code with AI-powered tools',
  )
  .version('0.1.0');

// ---------------------------------------------------------------------------
// init — Initialize project configuration
// ---------------------------------------------------------------------------
program
  .command('init')
  .description('Initialize Code Analyzer configuration in a project')
  .option('-d, --directory <path>', 'Target directory', process.cwd())
  .option('-f, --force', 'Overwrite existing configuration')
  .action((opts: { directory?: string; force?: boolean }) => {
    const options: InitOptions = {
      directory: opts.directory,
      force: opts.force,
    };
    const result = initProject(options);
    process.stdout.write(`${result.message}${EOL}`);
    if (result.filesExisting.length > 0) {
      process.stdout.write(`  Existing: ${result.filesExisting.join(', ')}${EOL}`);
    }
  });

// ---------------------------------------------------------------------------
// analyze — Index a repository into the knowledge graph
// ---------------------------------------------------------------------------
program
  .command('analyze')
  .description('Analyze and index a repository into the knowledge graph')
  .argument('[path]', 'Path to the repository', '.')
  .option('-f, --format <format>', 'Output format: text, json, or summary', 'text')
  // **`--repo` is the spelling every CI sample uses** (`.gitlab-ci.yml`, `.circleci/config.yml`, three documents)
  // and the positional argument is the spelling the shell uses. Both name one thing: the checkout to analyze.
  .option('--repo <path>', 'Repository to analyze (same as the positional argument)')
  .option('-l, --languages <list>', 'Comma-separated languages to analyze, e.g. typescript,python')
  .option('-o, --output <file>', 'Write the result to this file instead of stdout')
  .option('-p, --project-id <id>', 'Project identifier')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '300000')
  // **The scope flags, and they are the difference between an analysis and an analysis of the checkout.** Repeatable,
  // because one glob rarely describes a repository: `--include "**/*.kt" --include "**/*.java"` is a Kotlin-and-Java
  // question, and a list that replaced itself would answer only the second.
  .option(
    '-i, --include <glob>',
    'Only analyze files matching this glob (repeatable; empty means everything)',
    collectValues,
    [] as string[],
  )
  .option(
    '-x, --exclude <glob>',
    'Skip files matching this glob (repeatable; added to the defaults)',
    collectValues,
    [] as string[],
  )
  .action(async (repoPath: string, opts: Record<string, string | string[]>) => {
    // **`--languages` becomes include globs, read from the engine's own language table**, so
    // `--languages typescript` analyzes exactly the files whose extension that table assigns to TypeScript. An unknown
    // name is a usage error: the alternative is an analysis of nothing while the log says the flag was honoured.
    const { extensions, unknown } = extensionsForLanguages(splitList(opts['languages']));
    if (unknown.length > 0) {
      console.error(`[code-analyzer] --languages does not know ${unknown.join(', ')}`);
      process.exit(2);
    }

    const target = textOption(opts['repo']) ?? repoPath;
    const include = [...(opts['include'] as string[]), ...extensions.map((extension) => `**/*${extension}`)];
    const exclude = opts['exclude'] as string[];
    const options: AnalyzeOptions = {
      path: target,
      format: (opts['format'] as AnalyzeOptions['format']) ?? 'text',
      projectId: opts['projectId'] as string,
      timeout: parseInt(opts['timeout'] as string, 10) || 300_000,
      ...(include.length === 0 ? {} : { include }),
      ...(exclude.length === 0 ? {} : { exclude }),
    };

    process.stdout.write(`Analyzing ${target}...${EOL}`);
    const result = await analyzeRepository(options);
    const output = formatAnalyzeResult(result, options.format ?? 'text');
    emit(`${output}${EOL}`, opts['output']);
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// search — Search the knowledge graph
// ---------------------------------------------------------------------------
program
  .command('search')
  .description('Search the code knowledge graph')
  .argument('<query>', 'Search query')
  .option('-f, --format <format>', 'Output format: text, json, or summary', 'text')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('-t, --type <type>', 'Filter by node type')
  .option('-v, --verbose', 'Include file content snippets')
  .action(async (query: string, opts: Record<string, string>) => {
    const options: SearchOptions = {
      query,
      format: (opts['format'] as SearchOptions['format']) ?? 'text',
      limit: parseInt(opts['limit'] ?? '50', 10) || 50,
      type: opts['type'],
      verbose: opts['verbose'] !== undefined ? true : undefined,
    };

    const result = await searchGraph(options);
    const output = formatSearchResult(result, options.format ?? 'text');
    process.stdout.write(`${output}${EOL}`);
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// locate — Rank the files a question is about, without building an index
// ---------------------------------------------------------------------------
program
  .command('locate')
  .description(
    'Rank the files a question is about, reading paths, imports and file bodies (no index, no parser)',
  )
  .argument('<question>', 'The question, in your own words')
  .option('-d, --directory <path>', 'Checkout to rank', process.cwd())
  .option('-l, --limit <number>', 'How many paths to print', '10')
  .option('-f, --format <format>', 'Output format: text or json', 'text')
  .option(
    '-e, --extensions <list>',
    'Comma-separated extensions to consider, e.g. .java,.kt (defaults to every supported language)',
  )
  .option(
    '-D, --declarations <file>',
    'A ranking to fuse in - paths best first, as JSON or one per line - e.g. from an earlier search',
  )
  .option(
    '--no-body',
    'Do not read the files’ bodies - cheaper, and measurably weaker on questions written in the code’s own words',
  )
  .action((question: string, opts: Record<string, string | undefined>) => {
    const extensions = (opts['extensions'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));
    const options: LocateCommandOptions = {
      question,
      directory: opts['directory'] ?? process.cwd(),
      limit: parseInt(opts['limit'] ?? '10', 10) || 10,
      extensions: extensions.length === 0 ? undefined : extensions,
      ...(opts['declarations'] === undefined ? {} : { declarationsFile: opts['declarations'] }),
      // **Commander reads `--no-body` as `body: false` and its absence as `true`**, which is why this is passed through
      // rather than defaulted here: the command's default is the module's, so a caller of the module and a caller of the
      // CLI get one answer to "does it read the body".
      ...(opts['body'] === undefined ? {} : { body: opts['body'] !== 'false' }),
    };
    const result = locateRepository(options);
    // `process.stdout.write` rather than `console.log`: the ranking is the command's whole output and its trailing
    // newline is part of the format, so it is written rather than printed.
    process.stdout.write(formatLocateOutput(result, opts['format'] === 'json' ? 'json' : 'text'));
    process.exit(result.success ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// review pr — the review a pull request actually gets
// ---------------------------------------------------------------------------

/**
 * Read an option as text, or `undefined` when it is not text.
 *
 * **`String(raw)` was the wrong tool**: it turns an unexpected object into `"[object Object]"` and hands that to a
 * path, a token or a repository slug. An option value that is not a string means commander's contract was broken, and
 * the honest answer is "no value" rather than a string that will fail somewhere less obvious.
 */
function textOption(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
}

/**
 * Read a positive whole number from an option, or say which option was wrong.
 *
 * **A bad number is a usage error, not a missing option.** `--pr twelve` silently becoming "no pull request" would
 * send the run down the branch that reviews a checkout instead, and the reader would get a report about the wrong
 * thing rather than a sentence about their typo.
 */
function readPositiveInt(raw: unknown, label: string): { value?: number; error?: string } {
  const text = textOption(raw)?.trim();
  if (text === undefined || text.length === 0) return {};
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `--${label} expects a positive whole number, not "${text}"` };
  }
  return { value: parsed };
}

/**
 * Split a list option into its parts.
 *
 * **Two shapes arrive here and both are documented.** `--exclude a --exclude b` is commander's repeatable form, which
 * yields an array; `--exclude "a,b"` is the comma-separated form the composite action passes. Handling only one of them
 * would drop the other silently — and a dropped `--exclude` is a review that scans `node_modules`.
 */
function splitList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const parts: string[] = [];
  for (const value of values) {
    const text = textOption(value);
    if (text === undefined) continue;
    for (const part of text.split(',')) {
      const trimmed = part.trim();
      if (trimmed.length > 0) parts.push(trimmed);
    }
  }
  return parts;
}

/**
 * The change-scope options both review commands share.
 *
 * **The names below are commander's, and two of them are counter-intuitive on purpose.** The documents and the
 * composite action spell the flags `--standard <id>` (repeatable) and `--standards <path>` (a file), so the option
 * keys are `standard` and `standards` — while the typed request calls the first list `standards` and the second
 * `standardsFile`. The translation happens here, once, and nowhere else.
 */
interface ScopeOptionBag {
  repo?: unknown;
  pr?: unknown;
  token?: unknown;
  targetBranch?: unknown;
  sourceBranch?: unknown;
  /** `--standard <id>`, repeatable. */
  standard?: unknown;
  /** `--standards <path>`. */
  standards?: unknown;
  /** The typed name for the same option, for a caller that assembles the bag itself rather than through commander. */
  standardsFile?: unknown;
  severity?: unknown;
  failOn?: unknown;
  maxFiles?: unknown;
  maxFindings?: unknown;
  exclude?: unknown;
  languages?: unknown;
  projectId?: unknown;
}

/** Build the change-scope half of a review request, or the reason it cannot be built. */
function scopeOf(
  opts: ScopeOptionBag,
): { scope?: Pick<PrReviewOptions, 'repo' | 'pr' | 'token' | 'targetBranch' | 'sourceBranch' | 'standards' | 'standardsFile' | 'severity' | 'failOn' | 'maxFiles' | 'maxFindings' | 'exclude' | 'languages' | 'projectId'>; error?: string } {
  const pr = readPositiveInt(opts.pr, 'pr');
  if (pr.error !== undefined) return { error: pr.error };
  const maxFiles = readPositiveInt(opts.maxFiles, 'max-files');
  if (maxFiles.error !== undefined) return { error: maxFiles.error };
  const maxFindings = readPositiveInt(opts.maxFindings, 'max-findings');
  if (maxFindings.error !== undefined) return { error: maxFindings.error };

  // **`--token` falls back to GITHUB_TOKEN**, which every GitHub runner already exports: an invocation that names a
  // pull request and not a token is a caller who expected the environment to supply it, and refusing is not a favour.
  const token = textOption(opts.token) ?? process.env['GITHUB_TOKEN'];
  const standardIds = Array.isArray(opts.standard) ? (opts.standard as string[]) : [];

  return {
    scope: {
      repo: textOption(opts.repo),
      pr: pr.value,
      token: token !== undefined && token.length > 0 ? token : undefined,
      targetBranch: textOption(opts.targetBranch),
      sourceBranch: textOption(opts.sourceBranch),
      standards: standardIds.length === 0 ? undefined : standardIds,
      standardsFile: textOption(opts.standards) ?? textOption(opts.standardsFile),
      severity: textOption(opts.severity),
      failOn: textOption(opts.failOn),
      maxFiles: maxFiles.value,
      maxFindings: maxFindings.value,
      exclude: splitList(opts.exclude),
      languages: splitList(opts.languages),
      projectId: textOption(opts.projectId),
    },
  };
}

/** Emit a report, to stdout or to the file `--output` names. A written file is announced on stderr, not stdout. */
function emit(text: string, output: unknown): void {
  const target = textOption(output);
  if (target === undefined || target.length === 0) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(target, text);
  // Announced on stderr, so `--output` leaves stdout empty for the caller that redirected it.
  console.error(`Wrote ${target}`);
}

/** The options `review pr` and `review-pr` share, declared once so the two spellings cannot drift apart. */
function prReviewOptionFlags(command: Command): Command {
  return command
    .option('--repo <path-or-slug>', 'Checkout to review, or owner/name. Inferred from origin when omitted')
    .option('--pr <number>', 'Pull request number. Needs --token, or GITHUB_TOKEN in the environment')
    .option('--token <token>', 'GitHub token for reading the pull request (default: $GITHUB_TOKEN)')
    .option('--target-branch <ref>', 'Base ref, for a review inside a clone (e.g. origin/main)')
    .option('--source-branch <ref>', 'Head ref, for a review inside a clone (e.g. HEAD)')
    .option('--standard <id>', 'Standard to apply as well (repeatable)', collectValues, [] as string[])
    .option('--standards <path>', 'Standards JSON file to apply as well')
    .option('-s, --severity <level>', `Minimum severity to report: ${describeSeverityLabels()}`, 'warning')
    .option('--fail-on <level>', `Exit 1 at this severity or above, or "off" (default: off)`, 'off')
    .option('--max-files <number>', 'Analyze at most this many changed files (default: no limit)')
    .option('--max-findings <number>', 'Report at most this many findings (default: no limit)')
    .option(
      '-x, --exclude <glob>',
      'Skip files matching this glob (repeatable, added to the defaults)',
      collectValues,
      [] as string[],
    )
    .option('-l, --languages <list>', 'Comma-separated languages, e.g. typescript,python')
    .option('-p, --project-id <id>', 'Project identifier for graph lookups (default: $CODE_ANALYZER_PROJECT_ID)')
    .option('-f, --format <format>', 'Output format: text, json, or markdown', 'text')
    .option('-o, --output <file>', 'Write the report to this file instead of stdout');
}

/** Run `review pr` and print what came back. Returns nothing; it exits. */
async function reviewPullRequest(opts: Record<string, unknown>): Promise<void> {
  const { scope, error } = scopeOf(opts);
  if (error !== undefined) {
    console.error(`[code-analyzer] ${error}`);
    process.exit(2);
  }
  if (scope === undefined) {
    console.error('[code-analyzer] no review scope could be built');
    process.exit(2);
  }

  const format = textOption(opts['format']) ?? 'text';
  if (format !== 'text' && format !== 'json' && format !== 'markdown') {
    console.error(`[code-analyzer] --format ${format} is not a format. Use text, json, or markdown`);
    process.exit(2);
  }

  const run = await runPrReview(scope);
  if (!run.ok) {
    console.error(`[code-analyzer] ${run.error}`);
    process.exit(run.exitCode);
  }
  emit(formatPrReviewReport(run.report, format), opts['output']);
  process.exit(run.exitCode);
}

const reviewCommand = program
  .command('review')
  .description('Review code for quality, security, and maintainability issues')
  .argument('[target]', 'File, directory, or skip for git diff', '.')
  .option('-m, --mode <mode>', 'Review mode: diff, file, or dir', 'file')
  // **`--diff` is the spelling `docs/USER_GUIDE.md` uses** — `code-analyzer review ./src --diff` — and it says what
  // `--mode diff` says. A documented flag that is not a flag is a CLI that argues with its own manual.
  .option('--diff', 'Review the git diff instead of the files (same as --mode diff)')
  .option('-s, --severity <level>', 'Minimum severity: info, warning, error, critical', 'warning')
  .option('-f, --format <format>', 'Output format: text, json, or markdown', 'text')
  .option('-M, --max-issues <number>', 'Maximum issues to report', '500')
  .action(async (target: string, opts: Record<string, string | boolean>) => {
    const flag = (key: string): string | undefined => {
      const value = opts[key];
      return typeof value === 'string' ? value : undefined;
    };
    const options: ReviewOptions = {
      target,
      mode: opts['diff'] === true ? 'diff' : ((flag('mode') as ReviewOptions['mode']) ?? 'file'),
      severity: (flag('severity') as ReviewOptions['severity']) ?? 'warning',
      format: (flag('format') as ReviewOptions['format']) ?? 'text',
      maxIssues: parseInt(flag('maxIssues') ?? '500', 10) || 500,
    };

    const result = await reviewCode(options);
    const output = formatReviewResult(result, options.format ?? 'text');
    process.stdout.write(`${output}${EOL}`);
    process.exit(result.success ? 0 : 1);
  });

// `review pr` — a subcommand on the command above. **Commander routes this correctly even though `review` also takes a
// positional `[target]`**, which was verified against the installed version before five documented invocations were
// trusted to it: `review pr --repo a/b --pr 7` reaches this action, not the file reviewer.
prReviewOptionFlags(
  reviewCommand
    .command('pr')
    .description('Review a pull request, or a branch range, against the review lenses and project standards'),
).action(async (opts: Record<string, unknown>) => {
  await reviewPullRequest(opts);
});

// `review-pr` — the spelling `docs/USER_GUIDE.md` and the composite action use, with `--from`/`--to` as ref names.
// **A second name for one behaviour, not a second implementation**: the moment these diverge, one of the two
// documented invocations starts reviewing something other than what it says.
prReviewOptionFlags(
  program
    .command('review-pr')
    .description('Alias of `review pr`, with --from/--to for the base and head refs')
    .option('--from <ref>', 'Base ref (same as --target-branch)')
    .option('--to <ref>', 'Head ref (same as --source-branch)'),
).action(async (opts: Record<string, unknown>) => {
  const from = opts['from'];
  const to = opts['to'];
  await reviewPullRequest({
    ...opts,
    ...(from === undefined ? {} : { targetBranch: from }),
    ...(to === undefined ? {} : { sourceBranch: to }),
  });
});

// ---------------------------------------------------------------------------
// standards — judge a checkout, or a change, against a standard
// ---------------------------------------------------------------------------
program
  .command('standards')
  .description('Check code against project standards')
  .command('check')
  .description('Check a checkout, a branch range, or a pull request against one or more standards')
  .option('--repo <path-or-slug>', 'Checkout to judge, or owner/name. Defaults to the working directory')
  .option('--pr <number>', 'Pull request number, to judge only what it changed')
  .option('--token <token>', 'GitHub token for reading the pull request (default: $GITHUB_TOKEN)')
  .option('--target-branch <ref>', 'Base ref, to judge only what the head added')
  .option('--source-branch <ref>', 'Head ref')
  .option('--standard <id>', 'Standard to apply (repeatable; default: the built-in set)', collectValues, [] as string[])
  .option('--standards <path>', 'Standards JSON file to apply (repeatable in effect: it may hold an array)')
  .option('-s, --severity <level>', `Minimum severity to list: ${describeSeverityLabels()}`, 'warning')
  .option('--fail-on <level>', 'Exit 1 at this severity or above, or "off" (default: off)', 'off')
  .option('--max-files <number>', 'Judge at most this many files (default: no limit)')
  .option(
    '-x, --exclude <glob>',
    'Skip files matching this glob (repeatable, added to the defaults)',
    collectValues,
    [] as string[],
  )
  .option('-l, --languages <list>', 'Comma-separated languages, e.g. typescript,python')
  .option('-f, --format <format>', 'Output format: text, json, or markdown', 'text')
  .option('-o, --output <file>', 'Write the report to this file instead of stdout')
  .action(async (opts: Record<string, unknown>) => {
    const { scope, error } = scopeOf(opts);
    if (error !== undefined) {
      console.error(`[code-analyzer] ${error}`);
      process.exit(2);
    }
    if (scope === undefined) {
      console.error('[code-analyzer] no scope could be built');
      process.exit(2);
    }

    const format = textOption(opts['format']) ?? 'text';
    if (format !== 'text' && format !== 'json' && format !== 'markdown') {
      console.error(`[code-analyzer] --format ${format} is not a format. Use text, json, or markdown`);
      process.exit(2);
    }

    const request: StandardsCheckOptions = {
      ...(scope.repo === undefined ? {} : { repo: scope.repo }),
      ...(scope.pr === undefined ? {} : { pr: scope.pr }),
      ...(scope.token === undefined ? {} : { token: scope.token }),
      ...(scope.targetBranch === undefined ? {} : { targetBranch: scope.targetBranch }),
      ...(scope.sourceBranch === undefined ? {} : { sourceBranch: scope.sourceBranch }),
      ...(scope.standards === undefined ? {} : { standards: scope.standards }),
      ...(scope.standardsFile === undefined ? {} : { standardsFile: scope.standardsFile }),
      ...(scope.severity === undefined ? {} : { severity: scope.severity }),
      ...(scope.failOn === undefined ? {} : { failOn: scope.failOn }),
      ...(scope.maxFiles === undefined ? {} : { maxFiles: scope.maxFiles }),
      exclude: scope.exclude ?? [],
      languages: scope.languages ?? [],
    };

    const run = await runStandardsCheck(request);
    if (!run.ok) {
      console.error(`[code-analyzer] ${run.error}`);
      process.exit(run.exitCode);
    }
    emit(formatStandardsReport(run.entries, format), opts['output']);
    process.exit(run.exitCode);
  });

// ---------------------------------------------------------------------------
// status — Show project and index status
// ---------------------------------------------------------------------------
program
  .command('status')
  .description('Show Code Analyzer project and index status')
  .option('-d, --directory <path>', 'Project directory', process.cwd())
  .option('-f, --format <format>', 'Output format: text or json', 'text')
  .option('-v, --verbose', 'Show detailed status')
  .action((opts: Record<string, string>) => {
    const options: StatusOptions = {
      directory: opts['directory'],
      format: (opts['format'] as StatusOptions['format']) ?? 'text',
      verbose: opts['verbose'] !== undefined ? true : undefined,
    };

    const report = getStatus(options);
    const output = formatStatusReport(report, options.format ?? 'text');
    process.stdout.write(`${output}${EOL}`);
  });

// ---------------------------------------------------------------------------
// Agent integration commands
// ---------------------------------------------------------------------------
program.addCommand(createAgentCommand());

// ---------------------------------------------------------------------------
// Parse and execute
// ---------------------------------------------------------------------------
setupGlobalErrorHandlers();
program.parse();
