// @code-analyzer/cli — `review pr`: the review a pull request actually gets
//
// **This module is the answer to a documented command that did not exist.** `docs/CODE-REVIEW.md`,
// `docs/CONFIGURATION.md`, `docs/scenario-guides.md` (twice), `.github/workflows/pr-review.yml` and the composite action
// all call `code-analyzer review pr`; the CLI had no such subcommand, so every one of them failed with
// `error: unknown option '--repo'` — and because the repository's own changes were pushed straight to the default
// branch, the pull-request workflow that was supposed to catch that never ran.
//
// **One change set, two engines, one report.** The change is resolved once (`change-set.ts`), handed to the review
// swarm for the eight-lens deterministic scan, and — when `--standard` or `--standards` is present — to the standards
// engine over the same files. Merging happens here rather than in either engine because *the report is the product*:
// a reader does not care which subsystem found a line, only that the line was found once, with evidence, at a
// severity they can compare against every other finding.
//
// **The JSON is a contract, not a dump.** `.github/workflows/pr-review.yml` reads `.findings[] | .file, .line` to post
// inline comments and to enforce that every finding carries evidence. The internal `Finding` type spells those fields
// `filePath` and `lineRange`, so serialising it directly would have satisfied the schema and broken the reader: every
// finding would look like it was missing a location. The fields below are named for the consumer, and the schema
// string is versioned so a later change to them is visible rather than silent.

import { basename } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  ReviewSwarm,
  type ActionItem,
  type LensFinding,
  type SwarmDecision,
} from '@code-analyzer/intelligence';

import {
  describeLanguages,
  diffMembership,
  extensionsForLanguages,
  resolveChangeSet,
  type ChangeMode,
  type ChangeSet,
} from './change-set.js';
import { describeSeverityLabels, failsOn, normalizeSeverity, severityRank } from './severity.js';
import {
  checkStandards,
  createStandardsEngine,
  flattenViolations,
  readStandardsFile,
  resolveStandards,
} from './standards-check.js';

import type { ProjectStandard, Severity, StandardsCheckResult } from '@code-analyzer/shared';

/** The shape of the JSON this command writes. Bumped when a field a consumer reads changes meaning. */
export const PR_REVIEW_SCHEMA = 'code-analyzer/pr-review/1';

/** Where a finding came from, which is not the same question as which file it is in. */
export type FindingSource = 'lens' | 'standards';

/**
 * One finding, flattened for a reader and a script.
 *
 * `file`/`line` are the names `.github/workflows/pr-review.yml` reads; `endLine`, `snippet` and `fixSuggestion` are
 * the ones it renders. Everything else exists so that a reader can decide whether to trust the finding without opening
 * the CLI's source.
 */
export interface PrReviewFinding {
  id: string;
  /** Repository-relative path. */
  file: string;
  line: number;
  endLine: number;
  severity: Severity;
  category: string;
  /** `dependencies`, `api-contract`, `logic`, … for lens findings; `standards` for rule findings. */
  lens: string;
  source: FindingSource;
  /** The rule or lens rule that produced this, when there is one. */
  rule?: string;
  title: string;
  description: string;
  /** What to do about it, when the engine had an opinion. */
  suggestion?: string;
  /** The same text under the name the workflow's inline comment renders. */
  fixSuggestion?: string;
  /** The changed code the finding points at. Never empty: a finding without evidence is not reported. */
  snippet: string;
  confidence: string;
  autoFixable: boolean;
  /**
   * Whether `line` falls inside a changed hunk of `file`.
   *
   * **A pull-request comment can only be attached to a changed line.** The lenses read whole files, so they legitimately
   * report lines the change never touched — the missing JSDoc on a function the pull request did not edit, for example.
   * Posting one of those as an inline comment makes GitHub reject the entire review with a 422, which is why the fact is
   * computed here, where the diff is, instead of being discovered by the consumer at the point of failure.
   */
  inDiff: boolean;
}

/** The report `review pr` produces, and the document `--format json` writes. */
export interface PrReviewReport {
  schema: string;
  /**
   * **Never `tree`**: `review pr` refuses a run with no change to review, so a report that said `tree` would describe
   * something this command cannot produce. Narrowing the type here is what lets the formatters stop carrying an arm for
   * a mode that never arrives.
   */
  mode: Exclude<ChangeMode, 'tree'>;
  /** `owner/name` in `github` mode, the checkout path otherwise. */
  repository: string;
  pullRequest?: number;
  baseRef?: string;
  headRef?: string;
  projectId: string;
  /** The standards that actually ran, by id. Empty when the caller named none — which is a different thing. */
  standardsApplied: string[];
  summary: {
    totalFindings: number;
    bySeverity: Record<Severity, number>;
    byCategory: Record<string, number>;
    byLens: Record<string, number>;
    /** Findings on lines the change did not touch, which cannot become inline comments. */
    outsideDiff: number;
    /** Files the change touched, before `--exclude`, `--languages` and `--max-files`. */
    changedFileCount: number;
    /** Files the engines actually read. */
    analyzedFileCount: number;
    /** Files the caller excluded with `--exclude` or `--languages`. Their own choice, and named as such. */
    filteredFileCount: number;
    /** Files dropped by `--max-files`. Reported so a clean report cannot hide an unread half of the change. */
    truncatedFileCount: number;
    /** Analyzed files whose text could not be read — a deletion, or a checkout at the base. */
    unreadable: string[];
    linesAnalyzed: number;
    /** Findings the swarm discarded for lack of a code anchor. */
    evidenceRejected: number;
    /** Findings the adversarial pass discarded. */
    adversarialRejected: number;
    /** Findings merged into another as the same location. */
    iouDeduped: number;
    /** Findings below the engine's own confidence bar, which a later LLM pass would arbitrate. */
    needsLLMValidation: number;
    /** Findings dropped because the report hit `--max-findings`. */
    truncatedFindings: number;
  };
  decision: SwarmDecision;
  actionPlan: ActionItem[];
  findings: PrReviewFinding[];
  durationMs: number;
}

/** What to review. Presentation (`--format`, `--output`) is the caller's, not this module's. */
export interface PrReviewOptions {
  repo?: string;
  pr?: number;
  token?: string;
  targetBranch?: string;
  sourceBranch?: string;
  checkout?: string;
  /** `--standard <id>`, repeatable: built-in templates or names registered from `--standards`. */
  standards?: string[];
  /** `--standards <path>`: a JSON file holding one standard, an array of them, or a rule selection. */
  standardsFile?: string;
  severity?: string;
  failOn?: string;
  maxFiles?: number;
  /** `--max-findings`. Also read from `CODE_ANALYZER_REVIEW_MAX_COMMENTS`, which `docs/CONFIGURATION.md` documents. */
  maxFindings?: number;
  exclude?: string[];
  languages?: string[];
  projectId?: string;
}

/** Either a report or the reason there is none. A thrown error would print a stack where a sentence belongs. */
export type PrReviewRun =
  | { ok: true; report: PrReviewReport; exitCode: number }
  | { ok: false; error: string; exitCode: number };

/** Exit codes, as numbers a workflow can branch on. */
export const EXIT_OK = 0;
/** The review ran and found something `--fail-on` was asked to fail on. */
export const EXIT_FINDINGS = 1;
/** The review could not run: a usage error, a missing token, no analysable change. */
export const EXIT_USAGE = 2;

// ---------------------------------------------------------------------------
// Turning engine output into findings
// ---------------------------------------------------------------------------

/**
 * The swarm's synthesized comments, joined back to the lens findings they came from.
 *
 * **The join is by id, not by position**, because synthesis reorders and deduplicates: pairing `comments[i]` with
 * `findings[i]` would attach one finding's title and lens to another's line as soon as a single finding was dropped.
 * A comment whose finding is absent keeps its own fields — the comment is still real, only its provenance is missing —
 * which is why this is exported: the fallback is a behaviour, and a behaviour that only a hand-built input can reach is
 * still a behaviour that has to be right.
 */
export function joinLensFindings(
  result: {
    comments: readonly {
      id: string;
      path: string;
      content: string;
      startLine: number;
      endLine: number;
      severity: Severity;
      category: string;
      existingCode: string;
      suggestionCode?: string;
    }[];
    lensReports: readonly { findings: readonly LensFinding[] }[];
  },
  inDiff: (file: string, line: number) => boolean,
): PrReviewFinding[] {
  const byId = new Map<string, LensFinding>();
  for (const report of result.lensReports) {
    for (const finding of report.findings) byId.set(finding.id, finding);
  }

  return result.comments.map((comment) => {
    const finding = byId.get(comment.id);
    const suggestion = finding?.suggestion ?? comment.suggestionCode;
    const file = finding?.evidence.filePath ?? comment.path;
    const line = finding?.evidence.startLine ?? comment.startLine;
    return {
      id: comment.id,
      file,
      line,
      endLine: finding?.evidence.endLine ?? comment.endLine,
      severity: finding?.severity ?? comment.severity,
      category: finding?.category ?? comment.category,
      lens: finding?.lens ?? 'unknown',
      source: 'lens' as const,
      // **The rule id lives on the evidence anchor, not on the finding** — that is where the lens records which of its
      // rules matched, and reading it from the finding would have been a rule name that never exists.
      ...(finding?.evidence.ruleId === undefined ? {} : { rule: finding.evidence.ruleId }),
      title: finding?.title ?? comment.content,
      description: finding?.description ?? comment.content,
      ...(suggestion === undefined ? {} : { suggestion, fixSuggestion: suggestion }),
      snippet: finding?.evidence.codeSnippet ?? comment.existingCode,
      confidence: finding?.confidence ?? 'rule',
      autoFixable: finding?.autoFixable ?? false,
      inDiff: inDiff(file, line),
    };
  });
}

/** The standards engine's violations, flattened. Severity lives on the rule, so it is read from there. */
function standardsFindings(
  results: readonly StandardsCheckResult[],
  inDiff: (file: string, line: number) => boolean,
): PrReviewFinding[] {
  const findings: PrReviewFinding[] = [];
  for (const result of results) {
    for (const violation of flattenViolations(result, result.standardId)) {
      findings.push({
        id: `${violation.standard}/${violation.rule}/${violation.file}:${violation.line}`,
        file: violation.file,
        line: violation.line,
        endLine: violation.line,
        severity: violation.severity,
        category: 'style',
        lens: 'standards',
        source: 'standards',
        rule: violation.rule,
        title: violation.rule,
        description: violation.description,
        ...(violation.fixSuggestion === undefined
          ? {}
          : { suggestion: violation.fixSuggestion, fixSuggestion: violation.fixSuggestion }),
        snippet: violation.snippet,
        confidence: 'rule',
        autoFixable: violation.autoFixable,
        inDiff: inDiff(violation.file, violation.line),
      });
    }
  }
  return findings;
}

/**
 * **`diffMembership` moved to `change-set.ts`**, which owns the ranges it reads. It stayed here first, and
 * `standards check` grew a second copy of the same eleven lines rather than a second idea about which lines GitHub will
 * accept a comment on — the duplicate is the version of this that drifts.
 */
export { diffMembership };

/**
 * Order findings the way a reviewer reads them: worst first, then by file, then down the file.
 *
 * **Ties are broken by `id`** so that two identical runs produce byte-identical reports — a report that reorders
 * itself between runs cannot be diffed, and diffing it is how a team sees that a fix removed a finding.
 */
function sortFindings(findings: PrReviewFinding[]): PrReviewFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Count findings into the three maps the summary carries. */
function tally(findings: readonly PrReviewFinding[]): {
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  byLens: Record<string, number>;
} {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory: Record<string, number> = {};
  const byLens: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    byLens[finding.lens] = (byLens[finding.lens] ?? 0) + 1;
  }
  return { bySeverity, byCategory, byLens };
}

/**
 * How many findings to keep.
 *
 * `docs/CONFIGURATION.md` documents `CODE_ANALYZER_REVIEW_MAX_COMMENTS`; the flag wins when both are present, because
 * a command line is a decision and an inherited environment is a default. A non-numeric value is ignored rather than
 * read as zero, which would have produced an empty report that looked like a clean pull request.
 */
function maxFindingsOf(options: PrReviewOptions): number | undefined {
  if (options.maxFindings !== undefined) return options.maxFindings;
  const fromEnv = process.env['CODE_ANALYZER_REVIEW_MAX_COMMENTS'];
  if (fromEnv === undefined || fromEnv.trim().length === 0) return undefined;
  const parsed = Number.parseInt(fromEnv, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** The project id the engines key their graph lookups on. */
function projectIdOf(options: PrReviewOptions, change: ChangeSet): string {
  if (options.projectId !== undefined && options.projectId.length > 0) return options.projectId;
  const fromEnv = process.env['CODE_ANALYZER_PROJECT_ID'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  // **`basename` rather than splitting on `/`**: in `github` mode the repository is `owner/name` and in the other modes
  // it is a directory, and `basename` answers both. It is also never empty for anything that exists — including `/`,
  // where splitting on the separator yields `''` and left a fallback whose only reachable input was the filesystem root.
  return basename(change.repository);
}

/**
 * Review the change the request describes.
 *
 * Returns a discriminated result rather than throwing on a usage error: the caller prints the message and exits, and a
 * workflow log that shows one sentence instead of a stack trace is the difference between a maintainer fixing the flag
 * and a maintainer guessing.
 */
export async function runPrReview(options: PrReviewOptions): Promise<PrReviewRun> {
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

  const languages = options.languages ?? [];
  const { extensions, unknown } = extensionsForLanguages(languages);
  if (unknown.length > 0) {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error: `--languages does not know ${unknown.join(', ')}. Supported: ${describeLanguages()}`,
    };
  }

  const started = Date.now();

  let change: ChangeSet;
  try {
    // **Assigned rather than conditionally spread.** `exactOptionalPropertyTypes` is off in this repository, so an
    // absent option and an explicit `undefined` mean the same thing to the module below — and six conditional spreads
    // per call site were six branches that could only ever be half-taken, hiding no bug and costing a reader the effort
    // of proving it.
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

  // **A review of a tree is not a review.** With neither a pull request nor two refs there is no change to review, and
  // reporting "0 findings" for it would be the same lie as reporting a clean pull request that was never read.
  if (change.mode === 'tree') {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error:
        'review pr needs a change to review: pass --pr and --token, or --target-branch and --source-branch. ' +
        'To judge a checkout as it stands, use `standards check --repo .`.',
    };
  }

  const projectId = projectIdOf(options, change);
  const swarm = new ReviewSwarm(new InMemoryGraphStore(), { minSeverity: 'info' });
  const swarmResult = await swarm.reviewWithGraphContext(projectId, change.diffs, change.contents);

  const engine = createStandardsEngine();
  let standards: ProjectStandard[] = [];
  try {
    standards = resolveStandards(
      engine,
      options.standards ?? [],
      options.standardsFile === undefined ? undefined : readStandardsFile(options.standardsFile),
    );
  } catch (error) {
    return { ok: false, exitCode: EXIT_USAGE, error: (error as Error).message };
  }
  const standardsResults = checkStandards(engine, standards, change);

  const inDiff = diffMembership(change);
  const merged = sortFindings([
    ...joinLensFindings(swarmResult, inDiff),
    ...standardsFindings(standardsResults, inDiff),
  ]);

  // **The threshold filters, it does not discard the count.** `--severity` decides what is reported; the number that
  // did not reach the report is kept so a reader can lower the bar instead of wondering where the findings went.
  const reported = merged.filter(
    (finding) => severityRank(finding.severity) >= severityRank(severity),
  );
  const cap = maxFindingsOf(options);
  const findings = cap === undefined ? reported : reported.slice(0, cap);

  const report: PrReviewReport = {
    schema: PR_REVIEW_SCHEMA,
    mode: change.mode,
    repository: change.repository,
    ...(change.pullRequest === undefined ? {} : { pullRequest: change.pullRequest }),
    ...(change.baseRef === undefined ? {} : { baseRef: change.baseRef }),
    ...(change.headRef === undefined ? {} : { headRef: change.headRef }),
    projectId,
    standardsApplied: standards.map((standard) => standard.id),
    summary: {
      totalFindings: findings.length,
      ...tally(findings),
      outsideDiff: findings.filter((finding) => !finding.inDiff).length,
      changedFileCount: change.changedFileCount,
      analyzedFileCount: change.files.length,
      filteredFileCount: change.filteredFileCount,
      truncatedFileCount: change.truncatedFileCount,
      unreadable: change.unreadable,
      linesAnalyzed: swarmResult.summary.linesAnalyzed,
      evidenceRejected: swarmResult.summary.evidenceRejected,
      adversarialRejected: swarmResult.summary.adversarialRejected,
      iouDeduped: swarmResult.summary.iouDeduped,
      needsLLMValidation: swarmResult.summary.needsLLMValidation,
      truncatedFindings: reported.length - findings.length,
    },
    decision: swarmResult.decision,
    actionPlan: swarmResult.actionPlan,
    findings,
    durationMs: Date.now() - started,
  };

  return {
    ok: true,
    report,
    exitCode: failsOn(
      findings.map((finding) => finding.severity),
      failOn,
    )
      ? EXIT_FINDINGS
      : EXIT_OK,
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** A one-line description of what was reviewed, printed by every format. */
function scopeLine(report: PrReviewReport): string {
  const where =
    report.mode === 'github'
      ? `${report.repository}${report.pullRequest === undefined ? '' : `#${report.pullRequest}`}`
      : `${report.baseRef}...${report.headRef}`;
  return `${where} (${report.mode} mode)`;
}

/** How the run ended, in the words the decision uses. */
function decisionLine(report: PrReviewReport): string {
  const { recommendation, canMerge, reason } = report.decision;
  return `${canMerge ? 'mergeable' : 'not mergeable'} — ${recommendation}: ${reason}`;
}

/**
 * Why the report covers fewer files than the change touched, in the caller's own words.
 *
 * **Three causes, three remedies**: an excluded file is the caller's decision, a truncated one is a number they can
 * raise, and an unreadable one is a checkout at the wrong commit. Collapsing them into one "skipped" count would send a
 * reader to fix the wrong thing.
 */
function fileNotes(summary: PrReviewReport['summary']): string[] {
  const notes: string[] = [];
  if (summary.filteredFileCount > 0) {
    notes.push(`${summary.filteredFileCount} excluded by --exclude/--languages`);
  }
  if (summary.truncatedFileCount > 0) {
    notes.push(`${summary.truncatedFileCount} skipped by --max-files`);
  }
  if (summary.unreadable.length > 0) {
    notes.push(`${summary.unreadable.length} unreadable`);
  }
  return notes;
}

/**
 * The report as Markdown, which is what a pull-request comment renders.
 *
 * **Every number a reader could be misled by is printed**: files truncated by `--max-files`, findings truncated by
 * `--max-findings`, and files the diff named that the checkout did not have. A summary that says "3 findings" over a
 * change it only half read is worse than one that says so.
 */
export function formatPrReviewMarkdown(report: PrReviewReport): string {
  const lines: string[] = [];
  lines.push('## Code Analyzer — Pull Request Review');
  lines.push('');
  lines.push(`**Reviewed:** \`${scopeLine(report)}\``);
  const notes = fileNotes(report.summary);
  lines.push(
    `**Files:** ${report.summary.analyzedFileCount} analyzed of ${report.summary.changedFileCount} changed` +
      (notes.length === 0 ? '' : ` (${notes.join(' · ')})`),
  );
  lines.push(`**Decision:** ${decisionLine(report)}`);
  if (report.standardsApplied.length > 0) {
    lines.push(`**Standards applied:** ${report.standardsApplied.join(', ')}`);
  }
  // **A report that could not read part of the change says so above the findings, not in a footnote.** Without this a
  // checkout made at the base produces "no issues found, safe to merge" over a file it never opened — the exact failure
  // mode that makes an automated reviewer worse than none.
  if (report.summary.unreadable.length > 0) {
    lines.push(
      `**Warning:** ${report.summary.unreadable.length} changed file(s) could not be read, so the findings below do ` +
        'not cover them. Check the change out at its head before reviewing.',
    );
  }
  lines.push('');

  lines.push('| Severity | Findings |');
  lines.push('| --- | --- |');
  for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    lines.push(`| ${severity} | ${report.summary.bySeverity[severity]} |`);
  }
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('No findings at or above the reported severity.');
    if (report.summary.truncatedFindings > 0) {
      lines.push('');
      lines.push(
        `_${report.summary.truncatedFindings} finding(s) beyond \`--max-findings\` were not reported._`,
      );
    }
    return lines.join('\n');
  }

  lines.push('### Findings');
  for (const finding of report.findings) {
    lines.push('');
    lines.push(
      `#### \`${finding.severity}\` · \`${finding.file}:${finding.line}\` · ${finding.lens}` +
        (finding.rule === undefined ? '' : ` · \`${finding.rule}\``),
    );
    lines.push(`**${finding.title}**`);
    lines.push('');
    lines.push(finding.description);
    if (finding.snippet.length > 0) {
      lines.push('');
      lines.push('```');
      lines.push(finding.snippet);
      lines.push('```');
    }
    if (finding.fixSuggestion !== undefined) {
      lines.push('');
      lines.push(`**Suggestion:** ${finding.fixSuggestion}`);
    }
  }

  if (report.summary.truncatedFindings > 0) {
    lines.push('');
    lines.push(
      `_${report.summary.truncatedFindings} finding(s) beyond \`--max-findings\` were not reported._`,
    );
  }

  if (report.summary.outsideDiff > 0) {
    lines.push('');
    lines.push(
      `_${report.summary.outsideDiff} finding(s) are on lines this change did not touch: they are listed here rather ` +
        'than posted as inline comments, which a pull request can only attach to a changed line._',
    );
  }

  lines.push('');
  lines.push(
    `<sub>${report.summary.linesAnalyzed} lines across ${report.summary.analyzedFileCount} file(s) in ` +
      `${report.durationMs} ms · ${report.summary.evidenceRejected} rejected for missing evidence · ` +
      `${report.summary.iouDeduped} merged as duplicates</sub>`,
  );
  return lines.join('\n');
}

/** The report for a terminal: the same facts, no Markdown to read around. */
export function formatPrReviewText(report: PrReviewReport): string {
  const lines: string[] = [];
  lines.push(`PR review — ${scopeLine(report)}`);
  const textNotes = fileNotes(report.summary);
  lines.push(
    `Files: ${report.summary.analyzedFileCount} analyzed of ${report.summary.changedFileCount} changed` +
      (textNotes.length === 0 ? '' : ` (${textNotes.join(', ')})`),
  );
  lines.push(`Decision: ${decisionLine(report)}`);
  if (report.standardsApplied.length > 0) {
    lines.push(`Standards: ${report.standardsApplied.join(', ')}`);
  }
  if (report.summary.unreadable.length > 0) {
    lines.push(
      `Warning: ${report.summary.unreadable.length} changed file(s) could not be read; ` +
        'the findings below do not cover them.',
    );
  }
  lines.push(
    `Findings: ${report.summary.totalFindings} ` +
      `(critical ${report.summary.bySeverity.critical}, high ${report.summary.bySeverity.high}, ` +
      `medium ${report.summary.bySeverity.medium}, low ${report.summary.bySeverity.low}, ` +
      `info ${report.summary.bySeverity.info})`,
  );

  for (const finding of report.findings) {
    lines.push('');
    lines.push(
      `[${finding.severity.toUpperCase()}] ${finding.file}:${finding.line} — ${finding.title} (${finding.lens})`,
    );
    lines.push(`  ${finding.description}`);
    if (finding.fixSuggestion !== undefined) lines.push(`  Fix: ${finding.fixSuggestion}`);
  }

  if (report.summary.truncatedFindings > 0) {
    lines.push('');
    lines.push(
      `${report.summary.truncatedFindings} finding(s) beyond --max-findings were not reported.`,
    );
  }
  return lines.join('\n');
}

/** The report in the format that was asked for. */
export function formatPrReviewReport(
  report: PrReviewReport,
  format: 'text' | 'json' | 'markdown',
): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'markdown') return `${formatPrReviewMarkdown(report)}\n`;
  return `${formatPrReviewText(report)}\n`;
}
