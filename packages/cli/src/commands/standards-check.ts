// @code-analyzer/cli — `standards check`: judging a checkout, or a change, against a standard
//
// **The second command that four documents called and the CLI did not have.** `docs/CODE-REVIEW.md`,
// `docs/CONFIGURATION.md`, `docs/scenario-guides.md` and the standards job in `.github/workflows/pr-review.yml` all
// invoke `code-analyzer standards check`; `standards` was not a command, so the job failed before its first assertion.
//
// **The JSON is an array, because two published examples parse it as one** — `for (const s of standards)` in
// `docs/CODE-REVIEW.md` and `jq '.[] | select(.summary.critical > 0)'` in `docs/CONFIGURATION.md`. That shape is a
// contract, so the facts about *which* files were judged ride on every entry instead of turning the document into an
// object those readers cannot parse. Repeating three integers is a smaller cost than a standards report that two
// documented pipelines silently read as empty.

import { existsSync, readFileSync } from 'node:fs';

import { DEFAULT_STANDARDS, StandardsEngine } from '@code-analyzer/intelligence';


import {
  ChangeSetError,
  describeLanguages,
  extensionsForLanguages,
  resolveChangeSet,
  type ChangeMode,
  type ChangeSet,
} from './change-set.js';
import { describeSeverityLabels, failsOn, normalizeSeverity, severityRank } from './severity.js';

import type {
  ProjectStandard,
  Severity,
  StandardsCheckResult,
  Violation,
} from '@code-analyzer/shared';

/** The shape of the JSON this command writes. */
export const STANDARDS_SCHEMA = 'code-analyzer/standards/1';

/** One violation, flattened for a reader and for the inline-comment step that renders `file` and `line`. */
export interface StandardsViolation {
  file: string;
  line: number;
  severity: Severity;
  /** The standard that found it. */
  standard: string;
  /** The rule that found it. */
  rule: string;
  description: string;
  fixSuggestion?: string;
  snippet: string;
  autoFixable: boolean;
}

/**
 * One standard's result, as the JSON array emits it.
 *
 * Every field `StandardsCheckResult` already carries is unchanged — `standardId`, `complianceScore` and `summary` are
 * what the documented readers use — and two are added: the flattened `violations` a comment poster needs, and the
 * `files` block that says how much of the change this verdict covers.
 */
export interface StandardsReportEntry extends StandardsCheckResult {
  violations: StandardsViolation[];
  files: {
    /** Files the change touched, before `--exclude`, `--languages` and `--max-files`. */
    changed: number;
    /** Files the caller excluded with `--exclude` or `--languages`. */
    filtered: number;
    /** Files dropped by `--max-files`. */
    truncated: number;
    /** Analyzed files whose text could not be read. */
    unreadable: string[];
  };
}

/** What to check. Presentation is the caller's. */
export interface StandardsCheckOptions {
  repo?: string;
  pr?: number;
  token?: string;
  targetBranch?: string;
  sourceBranch?: string;
  checkout?: string;
  /** `--standard <id>`, repeatable. Empty means the engine's default set. */
  standards?: string[];
  /** `--standards <path>`. */
  standardsFile?: string;
  severity?: string;
  failOn?: string;
  maxFiles?: number;
  exclude?: string[];
  languages?: string[];
}

/** Either the results or the reason there are none. */
export type StandardsCheckRun =
  | { ok: true; entries: StandardsReportEntry[]; exitCode: number }
  | { ok: false; error: string; exitCode: number };

export const EXIT_OK = 0;
/** Violations at or above `--fail-on`. */
export const EXIT_VIOLATIONS = 1;
/** The check could not run. */
export const EXIT_USAGE = 2;

// ---------------------------------------------------------------------------
// The engine and what it is given
// ---------------------------------------------------------------------------

/**
 * An engine that can resolve the standards this product ships.
 *
 * **`DEFAULT_STANDARDS` are registered rather than referenced**, because `checkFiles` looks a standard up by id: an
 * unregistered default would be a standard the engine owns and cannot name. `init` writes the same set into a project,
 * so `--standard std-func-length` means here exactly what it means there.
 */
export function createStandardsEngine(): StandardsEngine {
  const engine = new StandardsEngine();
  for (const standard of DEFAULT_STANDARDS) engine.registerStandard(standard);
  return engine;
}

/**
 * The standards a run was asked for.
 *
 * **`--standard` takes an id and `--standards` a file, and they are different options**: the id selects a standard
 * this product ships, the file describes conventions a project wrote. Both are resolved here so `review pr` and
 * `standards check` cannot answer the same question differently.
 */
export function resolveStandards(
  engine: StandardsEngine,
  ids: readonly string[],
  file: { path: string; text: string } | undefined,
): ProjectStandard[] {
  const standards: ProjectStandard[] = [];

  for (const id of ids) {
    try {
      standards.push(engine.loadStandard(id));
    } catch {
      const known = [
        ...engine.listTemplates().map((template) => template.id),
        ...DEFAULT_STANDARDS.map((standard) => standard.id),
      ].join(', ');
      throw new ChangeSetError(`unknown standard "${id}". Known standards: ${known}`);
    }
  }

  if (file !== undefined) {
    for (const standard of parseStandardsFile(file.text, file.path)) {
      // **A clash with a shipped standard is refused, not renamed.** A project standard that shadowed
      // `security-baseline` would make every later reference to that id mean two different things in one run.
      try {
        engine.registerStandard(standard);
      } catch (error) {
        throw new ChangeSetError(`${file.path}: ${(error as Error).message}`);
      }
      standards.push(standard);
    }
  }

  return standards;
}

/**
 * Read a standards file: one standard, an array of them, or the flat rule selection `init` used to write.
 *
 * **The flat format is refused with a way out rather than ignored.** A rules array without `checkType` is what this
 * repository's `init` wrote until now; accepting it silently would have produced a standards check that found nothing
 * and a report that said the code was clean.
 */
export function parseStandardsFile(text: string, path: string): ProjectStandard[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ChangeSetError(`${path} is not JSON: ${(error as Error).message}`);
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  const standards: ProjectStandard[] = [];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') {
      throw new ChangeSetError(`${path} does not describe a standard: expected an object`);
    }
    const standard = candidate as Partial<ProjectStandard> & {
      rules?: { checkType?: string }[];
    };
    if (!Array.isArray(standard.rules)) {
      throw new ChangeSetError(
        `${path} does not describe a standard: expected an object with "id" and "rules", or an array of them`,
      );
    }
    // **Checked before the id, so the flat file `init` used to write gets the message that tells the reader what to do
    // about it.** That file has no `id` either; reporting the missing id first would have sent them looking for a field
    // that was never the problem.
    const missing = standard.rules.filter((rule) => typeof rule.checkType !== 'string').length;
    if (missing > 0) {
      throw new ChangeSetError(
        `${path} has ${missing} rule(s) without "checkType". That is the format \`code-analyzer init\` wrote before ` +
          'this release: re-run `code-analyzer init --force` to upgrade it, or give each rule a "checkType" of ' +
          'regex, metric, ast-pattern, graph-query or llm-check.',
      );
    }
    if (typeof standard.id !== 'string') {
      throw new ChangeSetError(
        `${path} does not describe a standard: expected an object with "id" and "rules", or an array of them`,
      );
    }
    standards.push(standard as ProjectStandard);
  }
  return standards;
}

/** Run every standard over the analyzed files. One entry per standard, in the order asked for. */
export function checkStandards(
  engine: StandardsEngine,
  standards: readonly ProjectStandard[],
  change: ChangeSet,
): StandardsCheckResult[] {
  const files = readableFiles(change);
  return standards.map((standard) => engine.checkFiles(files, standard.id));
}

/** The analyzed files whose text was available, in the change set's order. */
function readableFiles(change: ChangeSet): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  for (const path of change.files) {
    const content = change.contents.get(path);
    if (content !== undefined) files.push({ path, content });
  }
  return files;
}

/**
 * The violations of one result, flattening the rule level away.
 *
 * **Severity is read from the rule, not the violation**, because a violation does not carry one: the engine records how
 * bad a rule's failures are once, on the rule, and every violation of that rule inherits it.
 */
export function flattenViolations(
  result: StandardsCheckResult,
  standardId: string,
): StandardsViolation[] {
  const violations: StandardsViolation[] = [];
  for (const ruleResult of result.ruleResults) {
    for (const violation of ruleResult.violations) {
      violations.push(toViolation(violation, standardId, ruleResult.ruleId, ruleResult.severity, ruleResult.autoFixable, ruleResult.ruleDescription));
    }
  }
  return violations;
}

function toViolation(
  violation: Violation,
  standard: string,
  rule: string,
  severity: Severity,
  autoFixable: boolean,
  ruleDescription: string,
): StandardsViolation {
  const fix = violation.suggestion ?? violation.autoFix;
  return {
    file: violation.filePath,
    line: violation.lineNumber,
    severity,
    standard,
    rule,
    description: violation.message.length > 0 ? violation.message : ruleDescription,
    ...(fix === undefined ? {} : { fixSuggestion: fix }),
    snippet: violation.codeSnippet,
    autoFixable,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Read a standards file, or explain which path was wrong. */
export function readStandardsFile(path: string): { path: string; text: string } {
  if (!existsSync(path)) throw new ChangeSetError(`--standards ${path} does not exist`);
  try {
    return { path, text: readFileSync(path, 'utf-8') };
  } catch (error) {
    throw new ChangeSetError(`--standards ${path} could not be read: ${(error as Error).message}`);
  }
}

/** Resolve the change, run every standard over it, and report one entry per standard. */
export async function runStandardsCheck(
  options: StandardsCheckOptions,
): Promise<StandardsCheckRun> {
  const severity = normalizeSeverity(options.severity ?? 'warning');
  if (severity === undefined) {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error: `--severity ${options.severity} is not a severity. Use one of: ${describeSeverityLabels()}`,
    };
  }

  const failOn = options.failOn ?? 'off';
  if (failOn.trim().toLowerCase() !== 'off' && normalizeSeverity(failOn) === undefined) {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error: `--fail-on ${failOn} is not a severity. Use one of: ${describeSeverityLabels()}, off`,
    };
  }

  const { extensions, unknown } = extensionsForLanguages(options.languages ?? []);
  if (unknown.length > 0) {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error: `--languages does not know ${unknown.join(', ')}. Supported: ${describeLanguages()}`,
    };
  }

  let change: ChangeSet;
  try {
    // Assigned rather than conditionally spread — see the same note in `pr-review.ts`.
    change = await resolveChangeSet({
      repo: options.repo,
      pr: options.pr,
      token: options.token,
      targetBranch: options.targetBranch,
      sourceBranch: options.sourceBranch,
      checkout: options.checkout,
      maxFiles: options.maxFiles,
      exclude: options.exclude ?? [],
      extensions,
    });
  } catch (error) {
    return { ok: false, exitCode: EXIT_USAGE, error: (error as Error).message };
  }

  const engine = createStandardsEngine();
  let standards: ProjectStandard[];
  try {
    standards = resolveStandards(
      engine,
      options.standards ?? [],
      options.standardsFile === undefined ? undefined : readStandardsFile(options.standardsFile),
    );
  } catch (error) {
    return { ok: false, exitCode: EXIT_USAGE, error: (error as Error).message };
  }
  // **`standards check` with nothing named judges against the built-in set.** That is the command's whole question —
  // "is this code up to our standard" — and answering "no standards were given" would make a bare invocation useless.
  // `review pr` deliberately does *not* inherit this default: a lens review that silently also applied fifteen rule
  // sets would report findings the caller never asked for, and the flag that names a standard would read as additive
  // when the documents mean it as a choice.
  if (standards.length === 0) standards = [...DEFAULT_STANDARDS];

  const results = checkStandards(engine, standards, change);
  const changed = change.changedFileCount;

  const entries: StandardsReportEntry[] = results.map((result) => {
    const violations = flattenViolations(result, result.standardId).filter(
      (violation) => severityRank(violation.severity) >= severityRank(severity),
    );
    return {
      ...result,
      // **The threshold narrows what is listed, never what was measured.** `summary` and `complianceScore` come from
      // the engine over every rule, so `--severity critical` cannot make a standard look compliant.
      violations,
      files: {
        changed,
        filtered: change.filteredFileCount,
        truncated: change.truncatedFileCount,
        unreadable: change.unreadable,
      },
    };
  });

  const reported = entries.flatMap((entry) => entry.violations.map((violation) => violation.severity));

  return {
    ok: true,
    entries,
    exitCode: failsOn(reported, failOn) ? EXIT_VIOLATIONS : EXIT_OK,
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** The entries as JSON: an array, which is the shape both published examples parse. */
export function formatStandardsJson(entries: readonly StandardsReportEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/** The entries as Markdown, for the sticky comment `.github/workflows/pr-review.yml` posts. */
export function formatStandardsMarkdown(entries: readonly StandardsReportEntry[]): string {
  const lines: string[] = [];
  lines.push('## Code Analyzer — Standards Compliance');
  lines.push('');
  lines.push('| Standard | Compliance | Files | Critical | High | Medium | Low | Info |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const entry of entries) {
    lines.push(
      `| ${entry.standardId} | ${entry.complianceScore}% | ${entry.filesChecked} | ${entry.summary.critical} | ` +
        `${entry.summary.high} | ${entry.summary.medium} | ${entry.summary.low} | ${entry.summary.info} |`,
    );
  }

  const files = entries[0]?.files;
  if (files !== undefined) {
    const notes: string[] = [];
    if (files.filtered > 0) notes.push(`${files.filtered} excluded by --exclude/--languages`);
    if (files.truncated > 0) notes.push(`${files.truncated} skipped by --max-files`);
    if (files.unreadable.length > 0) notes.push(`${files.unreadable.length} unreadable`);
    if (notes.length > 0) {
      lines.push('');
      lines.push(`_Judged over ${files.changed - files.filtered - files.truncated} of ${files.changed} changed file(s): ${notes.join('; ')}._`);
    }
  }

  const violations = entries.flatMap((entry) => entry.violations);
  if (violations.length === 0) {
    lines.push('');
    lines.push('No violations at or above the reported severity.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('### Violations');
  for (const violation of violations) {
    lines.push('');
    lines.push(
      `- **\`${violation.severity}\`** \`${violation.file}:${violation.line}\` — ${violation.description} ` +
        `(_${violation.standard}/${violation.rule}_)` +
        (violation.fixSuggestion === undefined ? '' : ` — ${violation.fixSuggestion}`),
    );
  }
  return lines.join('\n');
}

/** The entries for a terminal. */
export function formatStandardsText(entries: readonly StandardsReportEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(
      `${entry.standardId}: ${entry.complianceScore}% compliant over ${entry.filesChecked} file(s) ` +
        `(${entry.summary.critical} critical, ${entry.summary.high} high, ${entry.summary.medium} medium, ` +
        `${entry.summary.low} low, ${entry.summary.info} info)`,
    );
    for (const violation of entry.violations) {
      lines.push(
        `  [${violation.severity.toUpperCase()}] ${violation.file}:${violation.line} — ${violation.description} ` +
          `(${violation.rule})` +
          (violation.fixSuggestion === undefined ? '' : ` — fix: ${violation.fixSuggestion}`),
      );
    }
  }
  if (lines.length === 0) lines.push('No standards were checked.');
  return lines.join('\n');
}

/** The entries in the format that was asked for. */
export function formatStandardsReport(
  entries: readonly StandardsReportEntry[],
  format: 'text' | 'json' | 'markdown',
): string {
  if (format === 'json') return formatStandardsJson(entries);
  if (format === 'markdown') return `${formatStandardsMarkdown(entries)}\n`;
  return `${formatStandardsText(entries)}\n`;
}

/** The change a standards run judged, for a caller that wants to print it. */
export type { ChangeMode, ChangeSet };
