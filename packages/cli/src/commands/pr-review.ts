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
  CostLedger,
  DeepSeekProvider,
  MappedRepository,
  ReviewAgent,
  ReviewSwarm,
  MERGE_BUDGET_PER_PULL_REQUEST,
  SHIPPED_AGENT_OPTIONS,
  SHIPPED_EMISSION_STEPS,
  applyEmissionPolicy,
  decideGrounding,
  describeEmissionSteps,
  describeGrounding,
  mergeReviewers,
  splitPatchByPath,
  type ActionItem,
  type LensFinding,
  type LLMProvider,
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

import type {
  ProjectStandard,
  ReviewComment,
  Severity,
  StandardsCheckResult,
} from '@code-analyzer/shared';

/** The shape of the JSON this command writes. Bumped when a field a consumer reads changes meaning. */
export const PR_REVIEW_SCHEMA = 'code-analyzer/pr-review/1';

/** Where a finding came from, which is not the same question as which file it is in. */
export type FindingSource = 'lens' | 'standards' | 'agent';

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
    /** Findings dropped because the report hit `--max-findings` or the shipped emission policy. */
    truncatedFindings: number;
    /**
     * **What the shipped emission policy removed before the report was written** (§54), and the name of the rule.
     *
     * Absent when `--max-findings` decided: an explicit flag is a decision, and a decision has nothing to explain. **The
     * field exists because a reader who cannot see a comment the reviewer wrote deserves to know which rule refused
     * it** - the alternative is a report that quietly says a pull request was clean at one operating point while the
     * engine spoke at another.
     */
    /**
     * **What `--ensemble` merged, and which path decided** (§56): `model`, `budget` when the candidates already fit,
     * `fallback` when the answer was refused, `refused` when the provider failed and the lanes were kept alone.
     */
    ensemble?: {
      rule: string;
      candidates: number;
      kept: number;
      decidedBy: string;
      droppedByReason: Record<string, number>;
      error?: string;
    };
    emissionPolicy?: {
      rule: string;
      droppedByCategory: readonly { readonly category: string; readonly count: number }[];
      /** Findings the path-class step removed, by class. Absent on a policy that has no such step. */
      droppedByPathClass?: readonly { readonly pathClass: string; readonly count: number }[];
      truncatedByBudget: number;
    };
    /**
     * **What the grounding gate decided** (§132 step 1).
     *
     * The device asks four decidable questions about a finding - was its file read, does its range exist, is its
     * quotation in the file, do the names it puts in backticks occur there - and **drops the ones that are provably about
     * nothing**. It also refuses to drop anything when the run could not read every file the findings name, and
     * `withheld` is how that refusal is visible: a report whose `readable` is below `findings` is a report in which the
     * unchecked findings were emitted unchanged.
     *
     * **Present on every report this module builds, and optional in the type for one reason**: a renderer is also
     * handed reports assembled elsewhere - the test suite's fixtures are exactly that - and a formatter that threw on a
     * report from an older producer would be a renderer that refuses to render. Absent therefore means *not recorded*,
     * which prints nothing; `applied: false` means *recorded and withheld*, which prints the refusal.
     */
    grounding?: {
      rule: string;
      /** The same sentence the job log prints, so a log and a report cannot describe one decision two ways. */
      sentence: string;
      applied: boolean;
      withheld: 'no-readable-arm' | null;
      findings: number;
      readable: number;
      keptRatio: number;
      droppedByReason: Record<string, number>;
      /** Findings whose quotation was a paraphrase with an ellipsis, so the check could not read it verbatim. */
      unverifiableQuotes: number;
    };
  };
  decision: SwarmDecision;
  actionPlan: ActionItem[];
  findings: PrReviewFinding[];
  durationMs: number;
  /**
   * **Which reviewer ran and what it spent**, present only under `--agent`.
   *
   * **A report of a model reading a repository that does not say how much reading happened is a figure with no
   * coordinate.** The four counts are the ones the benchmark publishes for the same arm, so a report from the product and
   * a figure from the harness can be placed beside each other — and the accounts are here because *did the reviewer open
   * every changed file* is the question this arm exists to answer, and the answer is a count per file.
   */
  agent?: {
    modelCalls: number;
    toolCalls: number;
    readChars: number;
    draftsFiled: number;
    accounts: Record<string, number>;
  };
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
  /**
   * `--agent`: run the reading reviewer — a tool loop over the checkout — instead of the five single-shot lanes.
   *
   * **Why this is the flag that turns a measurement into a feature.** On AACR-Bench the reading arm scores F1 0.2416 on
   * thirty-six pull requests where the lanes score 0.2033, and until this existed the arm was reachable only from the
   * benchmark harness — **a capability that exists only in a harness is a measurement, not a product.** The lanes stay
   * the default, because every figure this repository published before the arm existed was measured on them.
   */
  agent?: boolean;
  /**
   * `--ensemble`: run both reviewers and post one merged list, at most twelve comments per pull request (§56).
   *
   * **The two reviewers are not two opinions about the same code.** On `43676036390` the lanes and the reader covered 198
   * and 171 distinct goldens with **93 in common** - a union of 276 of 724 against 198 for either alone - so the reader
   * reaches 78 goldens no lane finds. **What it also does is spend 1 920 comments to say what one reviewer says in 1 109**,
   * and that is the whole reason it has never paid for itself: the union cut to twelve per pull request scores F1 0.2243
   * against the lanes' 0.2121, and a merge that removed the restatements while keeping the unique goldens reaches 0.2422.
   *
   * **Requires `--agent`**, because a merge of one reviewer is not a merge; the flag is refused rather than silently
   * becoming a synonym for `--agent`.
   */
  ensemble?: boolean;
  /**
   * The provider the agent calls. Absent builds `DeepSeekProvider` from `DEEPSEEK_API_KEY`.
   *
   * **A seam rather than an environment variable**, because the end-to-end test that proves this path works must not
   * need a key, a network or a bill — and a provider injected here is the same object the benchmark hands the same
   * agent, so the test exercises the wiring rather than a stub of it.
   */
  provider?: LLMProvider;
  /** `--max-findings-per-file`: how many findings one file may carry. Default 3, recorded because it bounds the figure. */
  maxFindingsPerFile?: number;
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

/**
 * **The spend ceiling the reading arm runs under, and where the number comes from.**
 *
 * `docs/EVAL-CONTRACT.md` §23.3 registers 0.35 USD per pull request as an estimate that the first measurement replaces;
 * **the measurement replaced it with 0.024** (0.88 USD over thirty-six pull requests, of which 0.51 was the arm itself).
 * It is not tightened to the measured figure on purpose: a ceiling set at the measured cost is a budget that fails the
 * first pull request larger than the average, and **a review that refuses to finish because it spent what it usually
 * spends is a worse reviewer than one that costs more.** The number stays where it was registered, and a run that
 * approaches it is a finding rather than a silent truncation.
 */
const AGENT_CEILING_USD = 0.35;

/**
 * How many findings one file may carry under `--agent`. **Read from the shipped arm rather than written here**, because
 * the same number used to be written in three places - this constant, `ReviewAgent`'s own default, and the benchmark's
 * `AACR_MAX_FINDINGS_PER_FILE` - and the benchmark's cap is the one the per-file truncation measurements were taken at.
 */
const AGENT_FINDINGS_PER_FILE = SHIPPED_AGENT_OPTIONS.maxFindingsPerFile;

/**
 * **The reading reviewer, wired to what the command already resolved.**
 *
 * The repository is `MappedRepository` rather than `DirectoryRepository`: a pull request is reviewed at its head commit,
 * and `change.contents` holds every selected file's text at exactly that revision — so the reviewer reads the code the
 * change produced, not whatever happens to be on disk, **and a checkout at the base cannot make it quote a line the pull
 * request has not written yet.**
 *
 * The patch is split rather than re-rendered (§`splitPatchByPath`), because git's own text is the only diff that is
 * guaranteed to agree with the pull request.
 */
async function reviewWithTheAgent(
  change: ChangeSet,
  options: PrReviewOptions,
): Promise<
  | { ok: true; comments: ReviewComment[]; spend: AgentSpend; provider: LLMProvider }
  | { ok: false; error: string }
> {
  let provider: LLMProvider;
  try {
    provider =
      options.provider ??
      new DeepSeekProvider({ ledger: new CostLedger(), ceilingUsd: AGENT_CEILING_USD });
  } catch (error) {
    // **A missing key is a usage error with a sentence, not a stack.** `DeepSeekProvider` throws `LLMAuthError` at
    // construction, which is the right place for it — but a caller reading `DEEPSEEK_API_KEY is not set` learns what
    // went wrong and what to do, and a caller reading an error trace does not.
    return {
      ok: false,
      error:
        `--agent needs a model provider: ${(error as Error).message}. ` +
        'Set DEEPSEEK_API_KEY, or run without --agent to use the deterministic lanes.',
    };
  }

  const agent = new ReviewAgent(provider, {
    // **Named, not spelled out.** `SHIPPED_AGENT_OPTIONS` is the arm this command runs; `BASELINE_AGENT_OPTIONS` is the
    // arm every published figure was measured on, and the two differ in `allowOffDiff` alone - see
    // `review-agent.ts`, where that pair and its one-key difference are declared and asserted.
    ...SHIPPED_AGENT_OPTIONS,
    maxFindingsPerFile: options.maxFindingsPerFile ?? AGENT_FINDINGS_PER_FILE,
    tag: 'pr-review:agent',
  });

  const outcome = await agent.review({
    repository: new MappedRepository({
      files: change.contents,
      changed: splitPatchByPath(change.patch),
    }),
    changedPaths: change.files,
  });

  const accounts: Record<string, number> = {};
  for (const account of outcome.accounts) {
    accounts[account.status] = (accounts[account.status] ?? 0) + 1;
  }
  const drops: Record<string, number> = {};
  for (const drop of outcome.drops) drops[drop.reason] = (drops[drop.reason] ?? 0) + 1;

  return {
    ok: true,
    comments: outcome.comments,
    // **The provider comes back with the comments**, because `--ensemble` buys a second opinion about the same pull
    // request and a second `DeepSeekProvider` would be a second ledger - one bill printed twice, each half of it.
    provider,
    spend: {
      modelCalls: outcome.ledger.modelCalls,
      toolCalls: outcome.ledger.toolCalls,
      readChars: outcome.ledger.readChars,
      draftsFiled: outcome.ledger.draftsFiled,
      accounts,
      drops,
    },
  };
}

/** What the reviewer did, in the four counts the benchmark publishes for the same arm. */
interface AgentSpend {
  modelCalls: number;
  toolCalls: number;
  readChars: number;
  draftsFiled: number;
  accounts: Record<string, number>;
  /** Why a draft did not become a finding, by reason. **`0` is "none", and an absent key is "did not apply".** */
  drops: Record<string, number>;
}

/**
 * One of the reading reviewer's comments as a report finding.
 *
 * **The split between `title` and `description` is the first line and the rest**, which is the same convention the
 * benchmark applies when it gives the same comment to a judge — so a figure from the product and a figure from the
 * harness are computed over the same text rather than over two readings of it.
 */
export function agentFindings(
  comments: readonly ReviewComment[],
  inDiff: (file: string, line: number) => boolean,
): PrReviewFinding[] {
  return comments.map((comment, at) => {
    const text = String(comment.content ?? '');
    const breakAt = text.indexOf('\n');
    const title = (breakAt === -1 ? text : text.slice(0, breakAt)).trim();
    return {
      id: comment.id ?? `agent-${at}-${comment.path}`,
      file: comment.path,
      line: comment.startLine,
      endLine: comment.endLine,
      severity: comment.severity,
      category: comment.category,
      lens: 'agent',
      source: 'agent',
      title: title.length === 0 ? `Finding on ${comment.path}` : title,
      description: text,
      ...(comment.suggestionCode === undefined ? {} : { suggestion: comment.suggestionCode }),
      ...(comment.suggestionCode === undefined ? {} : { fixSuggestion: comment.suggestionCode }),
      // **Never empty**: the comment survived only because the code it quotes was found in the file, so the quote is the
      // evidence and `existingCode` is where it is kept.
      snippet: comment.existingCode,
      confidence: 'high',
      autoFixable: comment.suggestionCode !== undefined,
      inDiff: inDiff(comment.path, comment.startLine),
    };
  });
}

/**
 * The merge decision, from findings rather than from a swarm.
 *
 * **The same four-way rule the lanes' decision uses** — critical blocks, more than three high requests changes, any
 * finding comments, nothing approves — because a caller that switches `--agent` must not also get a different meaning of
 * "mergeable". `tests/unit/cli` pins the two against the same inputs.
 */
export function decisionFor(findings: readonly PrReviewFinding[]): SwarmDecision {
  const critical = findings.filter((finding) => finding.severity === 'critical');
  const high = findings.filter((finding) => finding.severity === 'high');
  return {
    canMerge: critical.length === 0,
    recommendation:
      critical.length > 0
        ? 'block'
        : high.length > 3
          ? 'request-changes'
          : findings.length > 0
            ? 'approve-with-comments'
            : 'approve',
    reason:
      critical.length > 0
        ? `${String(critical.length)} critical finding(s) must be resolved before merge.`
        : high.length > 0
          ? `${String(high.length)} high-severity finding(s) should be reviewed.`
          : findings.length === 0
            ? 'No issues found. Safe to merge.'
            : `${String(findings.length)} finding(s) — review recommended.`,
    blockingCount: critical.length,
    requiredCorrections: critical.map(
      (finding) => `[${finding.lens}] ${finding.file}:${String(finding.line)} — ${finding.title}`,
    ),
  };
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
 * **The grounding gate, as one function, so the decision is testable without a checkout.**
 *
 * The rules live in `review/grounding-gate.ts`; what this adds is the command's own vocabulary - `PrReviewFinding`
 * names its fields `file`/`line`/`snippet`, the gate names them `path`/`startLine`/`existingCode` - and the shape the
 * report carries. **A device whose only entry point is inside a 400-line function is a device tested by the function
 * that happens to call it**, and §133's two over-drops were found precisely because the end-to-end fixture ran it: the
 * cases below can now construct a partial-coverage list and a paraphrased quotation without a git repository.
 *
 * **It returns the findings unchanged when the gate withheld**, rather than a filtered copy that happens to be equal:
 * a caller that got a new array could not tell the two states apart by identity, and the report says which one it was.
 */
export function groundFindings(
  findings: readonly PrReviewFinding[],
  contents: ReadonlyMap<string, string>,
  diffs: ReadonlyMap<string, string>,
): {
  findings: PrReviewFinding[];
  grounding: NonNullable<PrReviewReport['summary']['grounding']>;
} {
  const decision = decideGrounding(
    findings.map((found) => ({
      finding: found,
      path: found.file,
      startLine: found.line,
      endLine: found.endLine,
      existingCode: found.snippet,
      content: found.title,
      suggestionCode: found.suggestion,
    })),
    contents,
    diffs,
  );
  return {
    findings: decision.applied ? decision.kept.map((entry) => entry.finding) : [...findings],
    grounding: {
      rule: 'path read, range exists, quotation present, backticked names present',
      sentence: describeGrounding(decision),
      applied: decision.applied,
      withheld: decision.withheld,
      findings: decision.coverage.findings,
      readable: decision.coverage.readable,
      keptRatio: decision.report.keptRatio,
      unverifiableQuotes: decision.report.unverifiableQuotes,
      droppedByReason: countDropReasons(decision.report.ungrounded),
    },
  };
}

/**
 * **The drop reasons as a tally**, which is the one shape a reader can argue with: *"four findings for a reason I do not
 * accept"* is a review comment, and *"four dropped"* is not.
 *
 * **Exported and therefore tested on its own**, because `decideGrounding` never produces a verdict without a reason and
 * the fallback would otherwise be a branch that no test can reach - which is how a fallback becomes a line nobody has
 * ever executed. A caller assembling a decision from a stored artifact can hand it one.
 */
export function countDropReasons(
  ungrounded: ReadonlyArray<{ reason: string | null }>,
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const verdict of ungrounded) {
    const reason = verdict.reason ?? 'unnamed';
    tally[reason] = (tally[reason] ?? 0) + 1;
  }
  return tally;
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

  /**
   * **`--ensemble` without `--agent` is refused, not silently downgraded.**
   *
   * The flag promises two reviewers merged into one list. A run that took it with the lanes alone would post one
   * reviewer's comments and report `ensemble: {decidedBy: 'budget'}` - **a report describing a merge of two things one of
   * which never ran** - and the only way to notice would be to read the artifact against the command line.
   */
  if (options.ensemble === true && options.agent !== true) {
    return {
      ok: false,
      exitCode: EXIT_USAGE,
      error:
        '--ensemble needs --agent: the merge is of two reviewers, and one of them is the reading reviewer',
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

  // **The reviewer is chosen once, here, and the rest of the command does not know which one ran** beyond the counts it
  // reports. Two variables carry the difference: the findings the reviewer produced and the summary the swarm would
  // have filled in, so every branch below is written once instead of twice.
  const inDiff = diffMembership(change);
  let lensFindings: PrReviewFinding[];
  let lensSummary: {
    linesAnalyzed: number;
    evidenceRejected: number;
    adversarialRejected: number;
    iouDeduped: number;
    needsLLMValidation: number;
    truncatedFindings: number;
  };
  let decision: SwarmDecision;
  let actionPlan: ActionItem[];
  let spend: AgentSpend | undefined;
  /** What `--ensemble` did, when it ran. **Present only under the flag**, so a report cannot claim a merge it never made. */
  let ensemble:
    | {
        rule: string;
        candidates: number;
        kept: number;
        decidedBy: string;
        droppedByReason: Record<string, number>;
        error?: string;
      }
    | undefined;

  if (options.agent === true) {
    const reviewed = await reviewWithTheAgent(change, options);
    if (!reviewed.ok) return { ok: false, exitCode: EXIT_USAGE, error: reviewed.error };
    spend = reviewed.spend;
    lensFindings = agentFindings(reviewed.comments, inDiff);
    // **The swarm's counters, read from the agent's own drop reasons rather than reported as zeros.** A zero for
    // `evidenceRejected` would say a quote was never checked when the check may simply never have failed; these four
    // counts are the same facts in the vocabulary the report already uses, which is what lets two reports be compared.
    lensSummary = {
      linesAnalyzed: [...change.contents.values()].reduce(
        (total, text) => total + text.split('\n').length,
        0,
      ),
      evidenceRejected: reviewed.spend.drops['snippet-not-found'] ?? 0,
      adversarialRejected: reviewed.spend.drops['filtered'] ?? 0,
      iouDeduped: reviewed.spend.drops['duplicate'] ?? 0,
      needsLLMValidation: 0,
      truncatedFindings: reviewed.spend.drops['over-budget'] ?? 0,
    };
    decision = decisionFor(lensFindings);
    actionPlan = [];
    /**
     * **`--ensemble`: the same pull request, reviewed twice, merged once** (§56).
     *
     * The reviewer above reads the repository; the swarm below reads the diff. **They find different goldens** - 198 and
     * 171 with 93 in common on the hundred pull requests of `43676036390` - and the merge is what turns the second field
     * of view into comments a person sees. The lanes are bought only here, so a run without the flag pays for one
     * reviewer exactly as it did before.
     */
    if (options.ensemble === true) {
      const swarm = new ReviewSwarm(new InMemoryGraphStore(), { minSeverity: 'info' });
      const swarmResult = await swarm.reviewWithGraphContext(
        projectId,
        change.diffs,
        change.contents,
      );
      const laneFindings = joinLensFindings(swarmResult, inDiff);
      const merged = await mergeTwoReviewers({
        lanes: laneFindings,
        reader: lensFindings,
        provider: reviewed.provider,
        budget: MERGE_BUDGET_PER_PULL_REQUEST,
      });
      lensFindings = merged.kept;
      // **What the merge removed is reported as truncation**, because that is what it is: a comment the reviewer wrote
      // and the report does not carry. The reason is kept beside it so the sentence the reader sees can name the rule.
      lensSummary.truncatedFindings += Math.max(0, merged.candidates - merged.kept.length);
      decision = decisionFor(lensFindings);
      ensemble = {
        rule: 'two reviewers, merged at twelve comments per pull request',
        candidates: merged.candidates,
        kept: merged.kept.length,
        decidedBy: merged.decidedBy,
        droppedByReason: merged.dropped,
        ...(merged.error === undefined ? {} : { error: merged.error }),
      };
    }
  } else {
    const swarm = new ReviewSwarm(new InMemoryGraphStore(), { minSeverity: 'info' });
    const swarmResult = await swarm.reviewWithGraphContext(
      projectId,
      change.diffs,
      change.contents,
    );
    lensFindings = joinLensFindings(swarmResult, inDiff);
    lensSummary = {
      linesAnalyzed: swarmResult.summary.linesAnalyzed,
      evidenceRejected: swarmResult.summary.evidenceRejected,
      adversarialRejected: swarmResult.summary.adversarialRejected,
      iouDeduped: swarmResult.summary.iouDeduped,
      needsLLMValidation: swarmResult.summary.needsLLMValidation,
      truncatedFindings: 0,
    };
    decision = swarmResult.decision;
    actionPlan = swarmResult.actionPlan;
  }

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

  /**
   * **The grounding gate, applied where findings become a report** (§132 step 1).
   *
   * `judgeGrounding` answers four decidable questions - was this finding's file read, does its range exist, is its
   * quotation in the file, do its backticked names occur there - and until now **it was called from four test files and
   * no product path**, so the capability existed and nothing delivered it. The three checks need the file, and this
   * command is the one place that has the whole change on disk: `change.contents`, already read for the lenses.
   *
   * **What it may not do is delete from a list it could only read half of.** A finding on a file this run did not fetch
   * would be dropped for the reason *"the review never read it"*, which is a fact about the fetch and not about the
   * finding - §23.7's regression, where a gate calibrated on one arm took the other from F1 0.2092 to 0.0523. So
   * `decideGrounding` applies the drop only at full coverage and reports `withheld: 'no-readable-arm'` otherwise, and
   * **the report carries the counts either way**, because a run that could not check is still a run that can say so.
   *
   * **Findings from the standards engine are not passed through it**, and that is a scope rather than an oversight: a
   * rule finding is produced by matching the file's own text, so its snippet is in the file by construction and the
   * gate would be measuring the rule engine's output with the rule engine's input.
   */
  const grounded = groundFindings(lensFindings, change.contents, splitPatchByPath(change.patch));
  const grounding = grounded.grounding;
  lensFindings = grounded.findings;

  const merged = sortFindings([...lensFindings, ...standardsFindings(standardsResults, inDiff)]);

  // **The threshold filters, it does not discard the count.** `--severity` decides what is reported; the number that
  // did not reach the report is kept so a reader can lower the bar instead of wondering where the findings went.
  const reported = merged.filter(
    (finding) => severityRank(finding.severity) >= severityRank(severity),
  );
  const cap = maxFindingsOf(options);
  /**
   * **The shipped emission policy, applied where the comments become a report.**
   *
   * `docs/EVAL-CONTRACT.md` §54 prices twenty-three cuts of one run's verdicts and finds the gate this command's figures
   * were filed under 0.0298 below a better cut of the same findings: **`drop test, budget 12` scores F1 0.2121 against
   * 0.1823, with precision 0.2236 against 0.1735 and 148 fewer comments.** The policy is the package's own function, and
   * the harness imports the same one, so the figure a run publishes and the comments a user receives are one object.
   *
   * **An explicit `--max-findings` wins**, because a command line is a decision and the policy is a default - and
   * `CODE_ANALYZER_REVIEW_MAX_COMMENTS` is read the same way it always was.
   */
  const policy = cap === undefined ? applyEmissionPolicy(reported, SHIPPED_EMISSION_STEPS) : null;
  const findings = policy === null ? reported.slice(0, cap) : [...policy.kept];

  const report: PrReviewReport = {
    schema: PR_REVIEW_SCHEMA,
    mode: change.mode,
    repository: change.repository,
    ...(change.pullRequest === undefined ? {} : { pullRequest: change.pullRequest }),
    ...(change.baseRef === undefined ? {} : { baseRef: change.baseRef }),
    ...(change.headRef === undefined ? {} : { headRef: change.headRef }),
    projectId,
    standardsApplied: standards.map((standard) => standard.id),
    // **Present only when the reading reviewer ran**, because a report that carried the field with zeros under the lanes
    // would say a reviewer spent nothing rather than that it did not run.
    ...(spend === undefined
      ? {}
      : {
          agent: {
            modelCalls: spend.modelCalls,
            toolCalls: spend.toolCalls,
            readChars: spend.readChars,
            draftsFiled: spend.draftsFiled,
            accounts: spend.accounts,
          },
        }),
    summary: {
      totalFindings: findings.length,
      ...tally(findings),
      outsideDiff: findings.filter((finding) => !finding.inDiff).length,
      changedFileCount: change.changedFileCount,
      analyzedFileCount: change.files.length,
      filteredFileCount: change.filteredFileCount,
      truncatedFileCount: change.truncatedFileCount,
      unreadable: change.unreadable,
      linesAnalyzed: lensSummary.linesAnalyzed,
      evidenceRejected: lensSummary.evidenceRejected,
      adversarialRejected: lensSummary.adversarialRejected,
      iouDeduped: lensSummary.iouDeduped,
      needsLLMValidation: lensSummary.needsLLMValidation,
      truncatedFindings: reported.length - findings.length,
      // **What the policy removed, and which rule it is**, so a reader who misses a comment the run wrote can see the
      // rule rather than infer one. Absent when `--max-findings` decided, because then there is no policy to name.
      ...(policy === null
        ? {}
        : {
            emissionPolicy: {
              rule: describeEmissionSteps(SHIPPED_EMISSION_STEPS),
              droppedByCategory: policy.droppedByCategory,
              // **What the path-class step removed, beside the categories**, because §106's step drops findings whose
              // category the rule keeps: a reader who misses a comment on a test file must be able to see that it was the
              // file's class and not the lane's category that refused it.
              droppedByPathClass: policy.droppedByPathClass,
              truncatedByBudget: policy.truncated,
            },
          }),
      // **What the merge did, when it ran.** Absent without `--ensemble`, because a report that carried a merge it never
      // made would describe a reviewer two of whose passes did not happen.
      ...(ensemble === undefined ? {} : { ensemble }),
      /**
       * **What the grounding gate decided, printed whether or not it could act.**
       *
       * A report that showed this only when it dropped something would make *"the gate ran and found nothing"* and
       * *"the gate could not read the change"* the same absence - and the second is the state in which every finding
       * reaching this report is unchecked. `sentence` is the same text a job log prints, so the two renderings cannot
       * describe the decision differently.
       */
      grounding,
    },
    decision,
    actionPlan,
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
 * The gate's sentence, or `null` when there is nothing a reader needs told.
 *
 * **Two states are worth a line and one is not.** A report whose gate could not read part of the change says so; a
 * report whose gate ran and drops nothing stays quiet, because *"grounding applied: 0 of 3 dropped"* on every comment
 * is the noise that teaches a reader to skip the line that matters. Absent is not a third state to call out here: it
 * means the producer did not record the decision, and inventing a sentence for it would describe a gate nobody ran.
 */
function groundingNote(summary: PrReviewReport['summary']): string | null {
  const grounding = summary.grounding;
  if (grounding === undefined) return null;
  if (!grounding.applied || grounding.findings !== grounding.readable) return grounding.sentence;
  return Object.keys(grounding.droppedByReason).length > 0 ? grounding.sentence : null;
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
  // **Above the findings, not in a footnote.** A reader who is told three findings and not told that the gate could not
  // read four of the nine files has no way to tell a clean review from a partial one.
  const groundingMarkdown = groundingNote(report.summary);
  if (groundingMarkdown !== null) lines.push(`**Grounding:** ${groundingMarkdown}`);
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
      lines.push(`_${truncationNote(report.summary, 'markdown')}_`);
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
    lines.push(`_${truncationNote(report.summary, 'markdown')}_`);
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
  // **A gate that could not read the change is printed even when it dropped nothing**, because "checked and clean" and
  // "never checked" are the same sentence to a reader who is only shown the second one's silence.
  const groundingText = groundingNote(report.summary);
  if (groundingText !== null) lines.push(`Grounding: ${groundingText}`);
  if (report.agent !== undefined) {
    // **One line, because the four numbers are one fact**: a model read the repository, this is how much it read, and
    // this is how many drafts it wrote before the code it quoted had to exist.
    lines.push(
      `Reviewer: agent — ${String(report.agent.modelCalls)} model calls, ` +
        `${String(report.agent.toolCalls)} tool calls, ` +
        `${String(report.agent.readChars)} characters read, ` +
        `${String(report.agent.draftsFiled)} drafts filed`,
    );
    const unaccounted = report.agent.accounts['unaccounted'] ?? 0;
    if (unaccounted > 0) {
      lines.push(
        `Warning: ${String(unaccounted)} changed file(s) the reviewer neither reviewed nor declared; ` +
          'the findings below do not cover them.',
      );
    }
  }
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
    lines.push(truncationNote(report.summary, 'text'));
  }
  return lines.join('\n');
}

/**
 * **The severity a merge is scored by, when the caller has no actionability score.**
 *
 * The harness ranks findings with `rankFindings` and merges on that score; this command's findings carry a severity and
 * no score, so the order a merge falls back to is severity. **That substitution is measured rather than assumed**:
 * `docs/EVAL-CONTRACT.md` §54.2 priced the shipped policy under the same substitution and got 0.2062 and 0.1946 where
 * the score order gave 0.2121 and 0.1960 - **the same ordering, four thousandths apart**, which is why shipping it did not
 * require moving the command's ranking into the package first.
 */
const MERGE_SEVERITY_SCORE: Record<string, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.6,
  low: 0.4,
  info: 0.2,
};

/**
 * **Two reviewers, one list, at most twelve comments** (§56).
 *
 * Returns the findings to keep and a record of what the merge removed, **by reason**, so a report can say why a comment
 * a reader expected is missing. A merge that failed - a provider error, an answer that did not parse - returns the lanes'
 * findings and an `error`, because **a second reviewer that cannot be merged must not take the first reviewer's findings
 * with it.**
 */
export async function mergeTwoReviewers(input: {
  lanes: readonly PrReviewFinding[];
  reader: readonly PrReviewFinding[];
  provider: LLMProvider;
  budget: number;
}): Promise<{
  kept: PrReviewFinding[];
  dropped: Record<string, number>;
  decidedBy: string;
  candidates: number;
  error?: string;
}> {
  const byRef = new Map<string, PrReviewFinding>();
  const candidates = [
    ...input.lanes.map((finding, at) => {
      const ref = `l${String(at)}`;
      byRef.set(ref, finding);
      return { ref, source: 'lanes' as const, finding };
    }),
    ...input.reader.map((finding, at) => {
      const ref = `r${String(at)}`;
      byRef.set(ref, finding);
      return { ref, source: 'reader' as const, finding };
    }),
  ].map((entry) => ({
    ref: entry.ref,
    source: entry.source,
    path: entry.finding.file,
    line: entry.finding.line,
    category: entry.finding.category,
    score: MERGE_SEVERITY_SCORE[entry.finding.severity] ?? 0.4,
    text: `${entry.finding.title} :: ${entry.finding.description}`,
  }));
  try {
    const outcome = await mergeReviewers({
      lanes: candidates.filter((entry) => entry.source === 'lanes'),
      reader: candidates.filter((entry) => entry.source === 'reader'),
      provider: input.provider,
      budget: input.budget,
      tag: 'pr-review:merge',
    });
    const dropped: Record<string, number> = {};
    for (const entry of outcome.dropped) dropped[entry.reason] = (dropped[entry.reason] ?? 0) + 1;
    return {
      kept: outcome.kept
        .map((entry) => byRef.get(entry.ref))
        .filter((entry): entry is PrReviewFinding => entry !== undefined),
      dropped,
      decidedBy: outcome.decidedBy,
      candidates: candidates.length,
      ...(outcome.decidedBy === 'fallback' ? { error: outcome.detail } : {}),
    };
  } catch (error) {
    /**
     * **The lanes survive a failed merge.** A merge is a second opinion about comments that already exist; a provider
     * that is down, rate-limited or out of credit is a reason for one reviewer rather than a reason for no review - and
     * **the report says so**, because a run that silently posted one reviewer's comments under a flag that promised two
     * is the defect this whole campaign exists to remove.
     */
    const dropped: Record<string, number> = {};
    if (input.reader.length > 0) dropped['merge-failed'] = input.reader.length;
    return {
      kept: [...input.lanes],
      dropped,
      decidedBy: 'refused',
      candidates: candidates.length,
      error: String((error as Error)?.message ?? error).slice(0, 200),
    };
  }
}

/**
 * **Why a finding the reviewer wrote is not in the report, in the rule's own words.**
 *
 * Until §54 there was one reason a finding could be missing - `--max-findings` - so every sentence said so. The shipped
 * emission policy is now the second reason and the commoner one, and **a sentence that names the wrong rule sends the
 * reader to a flag that was never set.** The text is derived from the report's own field rather than from a constant, so
 * a run that changes the policy changes the sentence without changing this function.
 */
function truncationNote(summary: PrReviewReport['summary'], style: 'text' | 'markdown'): string {
  const count = summary.truncatedFindings;
  const policy = summary.emissionPolicy;
  const flag = style === 'markdown' ? '`--max-findings`' : '--max-findings';
  if (policy === undefined) return `${count} finding(s) beyond ${flag} were not reported.`;
  const dropped =
    [
      ...policy.droppedByCategory.map((entry) => `${entry.category} ${entry.count}`),
      // **A second list and not a merge into the first**, because a category and a path class are different reasons and a
      // sentence that printed `test 2` for both would be a sentence a reader cannot act on.
      ...(policy.droppedByPathClass ?? []).map((entry) => `path ${entry.pathClass} ${entry.count}`),
    ].join(', ') || 'nothing';
  return (
    `${count} finding(s) were not reported: the shipped emission policy (${policy.rule}) removed ` +
    `${dropped} and ${policy.truncatedByBudget} beyond the per-pull-request budget.`
  );
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
