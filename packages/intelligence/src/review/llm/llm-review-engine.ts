// @code-analyzer/intelligence — LLM Review Engine
// Orchestrates LLM-powered code review across multiple lanes.

import {
  LANE_PROMPTS,
  LANE_LABELS,
  parseLLMResponse,
  type PromptContext,
  type ReviewLane,
  type LLMFinding,
} from './prompts.js';
import { collectDiffFacts, rankFindings } from '../actionability.js';

import type { LLMProvider, CompletionOptions } from './provider.js';
import type { ReviewComment, ReviewCategory, Severity, GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for controlling LLM review behavior. */
export interface LLMReviewOptions {
  /** Which review lanes to execute. Defaults to all 5. */
  lanes?: ReviewLane[];
  /** Maximum tokens per review lane completion. Defaults to 4096. */
  maxTokensPerLane?: number;
  /** Run lanes in parallel (true) or sequentially (false). Defaults to true. */
  parallel?: boolean;
  /** Maximum diff content length in characters before truncation. Defaults to 8000. */
  maxDiffLength?: number;
  /**
   * **Maximum diff content a pull-request call may show, in characters.** Defaults to 48000.
   *
   * **Why a pull request needs its own number.** `maxDiffLength` is sized for one file, and a pull request that
   * touches a hundred files exceeds it by an order of magnitude. **The first version of the pull-request scope reused
   * it, and the truncation kept the first four thousand characters and the last four thousand** - which on a
   * hundred-file pull request is **two files out of a hundred, shown perfectly, and ninety-eight not shown at all.**
   * The arms would then have differed by a truncation rather than by a scope, and the figure would have been a
   * measurement of the clip.
   */
  maxDiffLengthPerPullRequest?: number;
  /** LLM temperature for completions. Defaults to 0.3. */
  temperature?: number;
  /** Timeout per lane request in milliseconds. Defaults to 120000. */
  laneTimeout?: number;
  /** **Content-word overlap at which two findings are the same one.** */
  dedupThreshold?: number;
}

/** Result of an LLM review for a single diff. */
export interface LLMReviewResult {
  /** The file path that was reviewed. */
  filePath: string;
  /** The review lane that produced this result. */
  lane: ReviewLane;
  /** The findings produced by this lane. */
  findings: LLMFinding[];
  /** Whether the lane execution succeeded (false indicates an error). */
  success: boolean;
  /** Error message if the lane execution failed. */
  error?: string;
  /** Execution time in milliseconds. */
  durationMs: number;
  /** Optional token usage tracking. */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * **One spelling for a path, so a model's choice can be compared with a diff's header.**
 *
 * `git diff` writes `a/src/limit.ts b/src/limit.ts`; a prompt lists `src/limit.ts`; a model may answer `./src/limit.ts`
 * or `/src/limit.ts`. **All four name one file, and comparing them as strings says they name four.** The strip is
 * deliberately shallow - the `a/` and `b/` prefixes, a leading `./` and a leading `/` - because a deeper
 * normalisation (case folding, `..` resolution, symlinks) would start deciding that two different names are the same
 * file, which is the mistake in the other direction.
 */
function normaliseReviewPath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  while (path.startsWith('./')) path = path.slice(2);
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2);
  if (path.startsWith('/')) path = path.slice(1);
  return path;
}

/** One file's slice of a pull request's unified diff. */
export interface DiffSection {
  /** The path exactly as `git diff`'s `diff --git a/… b/X` header names it, prefixes stripped. */
  path: string;
  /** The section's own text, including its `diff --git` header so the concatenation stays a valid unified diff. */
  diffText: string;
}

/** What a pull-request review may spend. */
export interface PullRequestReviewOptions {
  /**
   * **Findings the whole pull request may return, across every lane.**
   *
   * Three is the number the file contract's third rule produced when the "file" became a pull request - and it is the
   * number at which precision was 0.40 and recall 0.12. **The point of the parameter is that this is a budget rather
   * than a law**: the curve in the artifact says what each budget buys, and a caller that wants recall moves it.
   */
  maxFindingsPerPullRequest?: number;
}

const DEFAULT_PULL_REQUEST_BUDGET = 16;

/**
 * **How far apart two findings may sit and still be the same construct.**
 *
 * The wording-only merge has no location evidence by definition - it exists for the case where two lanes describe one
 * defect in different words, and their ranges disagree because they disagree about where it starts. **Thirty lines is
 * a function, not a file**: past that, a shared sentence is a shared vocabulary rather than a shared defect.
 */
const sameConstructLines = 30;

const DEFAULT_OPTIONS: Required<LLMReviewOptions> = {
  lanes: ['security', 'architecture', 'performance', 'maintainability', 'testing'],
  maxTokensPerLane: 4096,
  parallel: true,
  maxDiffLength: 8000,
  maxDiffLengthPerPullRequest: 48_000,
  temperature: 0.3,
  laneTimeout: 120_000,
  // **The content-word overlap at which two findings are the same one.**
  // **At 0.6 the merge removed 360 of 488 and cost ten true positives**, so **it is a starting value that a
  // measurement has already contradicted rather than a settled one** - and **a constant a measurement has contradicted
  // is a constant that has to become a parameter.**
  dedupThreshold: 0.6,
};

// ---------------------------------------------------------------------------
// LLM Review Engine
// ---------------------------------------------------------------------------

export class LLMReviewEngine {
  private readonly options: Required<LLMReviewOptions>;

  constructor(
    private readonly provider: LLMProvider,
    options?: LLMReviewOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Review a single git diff using LLM-powered analysis.
   * Runs the specified review lanes and returns aggregated results.
   */
  async reviewDiff(diff: GitDiff, fileContext?: string): Promise<LLMReviewResult[]> {
    const diffContent = this.buildDiffContent(diff);

    const ctx: PromptContext = {
      diffContent: this.truncateDiff(diffContent),
      filePath: diff.filePath,
      changeType: diff.changeType,
      fileContext,
    };

    const lanes = this.options.lanes;

    const results = this.options.parallel
      ? await this.runLanesParallel(ctx, lanes)
      : await this.runLanesSequential(ctx, lanes);
    return this.deduplicateAcrossLanes(results);
  }

  /**
   * **What the threshold is, and why it is a number rather than a constant.**
   *
   * **At 0.6 the merge removed 360 of 488 findings, raised precision 2.3 times and lowered recall from 0.56 to 0.36** -
   * **because ten true positives were merged with neighbours that shared most of their vocabulary.** **So 0.6 is
   * measurably too low**, and **a constant that a measurement has contradicted is a constant that has to become a
   * parameter.**
   */
  static readonly DEFAULT_DEDUP_THRESHOLD = 0.6;

  /** **What the last deduplication did**, so a caller can tell a quiet reviewer from a collapsing one. */
  lastDeduplication: { before: number; after: number; dropped: number } | null = null;

  /**
   * **One defect reported by five lanes is one defect.**
   *
   * **Why this exists, in the measurement's own numbers.** **After the coordinate-system fix in the emission filter, the
   * engine emitted 459 findings over 199 files with 28 true positives and 431 false positives** - **a precision of 0.061
   * against a competitor's 0.5357.**
   *
   * **And five lanes review the same diff independently**, each with its own prompt: **security, performance,
   * maintainability, correctness and documentation.** **A defect that is arguably two of those is reported by both**,
   * and **`Promise.all` returned both** - **so the same repair appeared once per angle it could be seen from, and every
   * copy after the first was a false positive by construction.**
   *
   * **And the identity is a location and a shape rather than a string**, because **two lanes word one defect
   * differently.** **Two findings are the same when their ranges overlap in the same file**, or **when most of their
   * content words agree** - and **the survivor is the highest severity**, because **a defect is as serious as its worst
   * reading.**
   *
   * **And it is deterministic**: **severity first and lane order second**, so **the same five answers produce the same
   * output**, which is **what makes the deduplicated count comparable between runs.**
   */
  private deduplicateAcrossLanes(results: LLMReviewResult[]): LLMReviewResult[] {
    // **Typed by the union it is an index of, so the lookup needs no fallback**: every `LLMFinding` carries a
    // `Severity` that `normalizeSeverity` has already restricted to these five keys, and `rank[...] ?? 0` was a
    // fallback for a key the type excludes.
    const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    // **`value: string`, because that is what the parser guarantees**: a finding's title and description are typed
    // `string`, and **the `typeof value === 'string'` guard that stood here was a second opinion about a type the
    // caller had already established** - an arm no caller could take, sitting where it read as if one could.
    const words = (value: string): Set<string> =>
      new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3),
      );
    const shares = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 || b.size === 0) return 0;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared += 1;
      return shared / Math.min(a.size, b.size);
    };

    type Entry = { result: LLMReviewResult; finding: LLMFinding; words: Set<string> };
    /**
     * **Which file an entry is about, from the finding first and the result second.**
     *
     * A file call has one answer for every finding in the result, so the fallback is the whole truth there. **A
     * pull-request call has one result per lane and many files**, so a merge key read from the result would compare the
     * label of the call rather than the file of the finding - and **two files both have a line 10.**
     */
    const fileOf = (entry: Entry): string => String(entry.finding.path ?? entry.result.filePath);
    const all: Entry[] = [];
    for (const result of results) {
      for (const finding of result.findings) {
        all.push({
          result,
          finding,
          // **No `?? ''`**: both fields are required strings on `LLMFinding`, so the fallbacks were arms the type
          // had already ruled out.
          words: words(`${finding.title} ${finding.description}`),
        });
      }
    }
    // **Severity first, then lane order**, because **the survivor of a duplicate should be the worst reading** and
    // **a stable tie-break is what makes the output reproducible.**
    all.sort((x, y) => rank[y.finding.severity] - rank[x.finding.severity]);

    const survivors: Array<Entry & { absorbed: number }> = [];
    /**
     * **How many findings each survivor absorbed**, because **agreement between lanes is free evidence and this
     * function was discarding it.**
     *
     * **A defect three angles name is likelier a defect than one only a single angle saw** - and until now the survivor
     * and the lone finding were the same shape in the output, so nothing downstream could tell them apart. **The count
     * is kept beside the survivor rather than on it until the end**, so a later pass cannot read a half-built number.
     */
    for (const entry of all) {
      // **Which survivor this is a duplicate of, rather than whether it is one.** The predicate is the same two
      // conditions it was; what changed is that the answer is now an index, because a duplicate has somebody to be a
      // duplicate of and the count is what the ranking needs.
      const sameLocation = survivors.findIndex(
        (k) =>
          // **Same file, overlapping ranges** - the same defect has one location.
          fileOf(k) === fileOf(entry) &&
          entry.finding.startLine <= k.finding.endLine &&
          entry.finding.endLine >= k.finding.startLine,
      );
      const duplicateAt =
        sameLocation !== -1
          ? sameLocation
          : survivors.findIndex(
              (k) =>
                // **Or the same shape of sentence, close enough to be the same construct**, because **two lanes do not
                // word a defect identically** and a range is a hint that this iteration already watched a filter
                // discard 207 findings over.
                //
                // **Both constraints are load-bearing, and the second was missing.** Within one file, because **two
                // files each with an unfixed null check are two comments a developer has to make**; and within
                // `sameConstructLines` of each other, because **a five-lane review of one pull request writes the same
                // sentence about different defects** - "this value is not checked" is one string at line 20 and at line
                // 900 - and **the first pull-request run merged 50 of 83 surviving findings this way, leaving 6.6
                // comments for a whole pull request when the budget allowed 16.** That is a merge keyed on vocabulary,
                // and vocabulary does not know which defect it is describing.
                fileOf(k) === fileOf(entry) &&
                Math.abs(k.finding.startLine - entry.finding.startLine) <= sameConstructLines &&
                shares(k.words, entry.words) >= this.options.dedupThreshold,
            );
      const survivor = duplicateAt === -1 ? undefined : survivors[duplicateAt];
      if (survivor === undefined) survivors.push({ ...entry, absorbed: 1 });
      else survivor.absorbed += 1;
    }

    for (const survivor of survivors) {
      if (survivor.absorbed > 1) survivor.finding.agreement = survivor.absorbed;
    }

    const keep = new Set(survivors.map((e) => e.finding));
    for (const result of results) {
      result.findings = result.findings.filter((f) => keep.has(f));
    }
    this.lastDeduplication = {
      before: all.length,
      after: survivors.length,
      dropped: all.length - survivors.length,
    };
    return results;
  }

  /**
   * **A review whose comments arrive in the order a developer should read them.**
   *
   * **Why this is a method rather than an option on the one above.** Ordering needs the patch, and the patch is the one
   * thing a `GitDiff` does not carry - it has ranges and hashes, and the lines themselves live in whatever the caller
   * fetched. **So the caller that has the patch says so by calling this**, and a caller that does not gets the unordered
   * behaviour it always had rather than a ranking computed against a diff nobody can check.
   *
   * **Nothing is dropped.** *Sifting the Noise* (arXiv 2601.22952) measured aggressive filtering suppressing 22% of
   * true vulnerabilities, so the order changes and the set does not - and the reader can stop reading at any point,
   * which is the same control a filter gives them without the risk of a filter.
   */
  async reviewDiffRanked(
    diff: GitDiff,
    patch: string,
    fileContext?: string,
  ): Promise<ReviewComment[]> {
    const results = await this.reviewDiff(diff, fileContext);
    const located = results
      .filter((result) => result.success)
      .flatMap((result) => result.findings.map((finding) => ({ finding, path: diff.filePath })));
    const order = new Map<LLMFinding, number>();
    rankFindings(located, collectDiffFacts(patch)).forEach((entry, at) => {
      order.set(entry.finding, at);
    });
    return this.convertToReviewComments(diff, results, order);
  }

  /**
   * Review a git diff and convert LLM findings to ReviewComment format,
   * compatible with the existing heuristic review engine output.
   */
  async reviewDiffAsComments(diff: GitDiff, fileContext?: string): Promise<ReviewComment[]> {
    const results = await this.reviewDiff(diff, fileContext);
    return this.convertToReviewComments(diff, results);
  }

  /**
   * **One review per pull request, with one budget for the whole pull request.**
   *
   * **What this is for, in the measurement's own numbers.** The per-file path above, over AACR-Bench's five pull
   * requests and 199 files, emits **183 findings carrying 21 goldens** - precision 0.2019, F1 0.2727. The same five
   * lanes given the whole pull request in one call emitted **15 findings carrying 6** - precision **0.40**, F1 0.1846.
   * **Precision doubled on exactly the same diffs, the same model and the same contract, because the budget has to
   * compete.** The recall that fell with it is what this method's budget parameter is for: three slots per pull
   * request was never the intent, it was what the file contract happened to mean when the "file" became a pull
   * request.
   *
   * **Three things are enforced here rather than asked for**, because a prompt is a request:
   *
   *   1. **Every finding names a file the call showed.** No path, or a path not in the request, is dropped and counted
   *      separately - `missingPath` and `unknownPath`. **Neither is defaulted to a neighbouring file**, because a
   *      comment filed against a file the model did not choose is worse than no comment.
   *   2. **A range is judged against its own file's hunks.** Two files both have a line 10; a single flat set of
   *      ranges would answer a question nobody asked, which is the coordinate defect this repository already paid
   *      for once.
   *   3. **The budget is filled by the order, not by the model's position in the array** - `rankFindings` scores every
   *      survivor against the whole pull request's added lines and the lowest-scoring ones are what fall off, counted
   *      as `capped`.
   */
  async reviewPullRequest(
    sections: ReadonlyArray<DiffSection>,
    options?: PullRequestReviewOptions,
  ): Promise<LLMReviewResult[]> {
    const paths = sections.map((section) => section.path);
    // **Each call explains itself**, so a sample from the previous pull request cannot be read as this one's.
    this.droppedSamples = [];
    // **A pull request with no file sections is a review of nothing**, and running five lanes over an empty diff would
    // spend five calls to be told so.
    if (paths.length === 0) {
      this.lastCounts = {
        parsed: 0,
        kept: 0,
        dropped: {
          invalidLine: 0,
          beyondDiffLength: 0,
          missingPath: 0,
          unknownPath: 0,
          capped: 0,
          kept: 0,
          total: 0,
        },
      };
      return [];
    }
    const budget = options?.maxFindingsPerPullRequest ?? DEFAULT_PULL_REQUEST_BUDGET;
    const diffContent = this.showPullRequestDiff(sections);

    const ctx: PromptContext = {
      diffContent: this.truncateDiff(diffContent),
      // **A label rather than a path**, because there is no single file. `convertToReviewComments` prefers the
      // finding's own path, so this is only what a caller logs.
      filePath:
        paths.length === 1 ? String(paths[0]) : `${String(paths[0])} (+${paths.length - 1} more)`,
      changeType: 'pull-request',
      paths,
      maxFindings: budget,
      scope: 'pull-request',
    };

    const results = this.options.parallel
      ? await this.runLanesParallel(ctx, this.options.lanes)
      : await this.runLanesSequential(ctx, this.options.lanes);

    const parsed = [...this.parsedByLane.values()].reduce((sum, count) => sum + count, 0);
    const deduplicated = this.deduplicateAcrossLanes(results);

    // **The budget, spent in score order across every lane at once.** Applying it per lane would give five lanes three
    // slots each, which is fifteen - the number the file contract happened to produce, and the number this exists to
    // leave behind.
    const facts = collectDiffFacts(diffContent);
    const survivors: Array<{ result: LLMReviewResult; finding: LLMFinding }> = [];
    for (const result of deduplicated) {
      if (!result.success) continue;
      for (const finding of result.findings) survivors.push({ result, finding });
    }
    const ranked = rankFindings(
      survivors.map((entry) => ({ finding: entry.finding, path: String(entry.finding.path) })),
      facts,
    );
    const kept = new Set(ranked.slice(0, budget).map((entry) => entry.finding));

    let capped = 0;
    for (const result of deduplicated) {
      const before = result.findings.length;
      result.findings = result.findings.filter((finding) => kept.has(finding));
      capped += before - result.findings.length;
    }

    const dropped = [...this.droppedByLane.values()].reduce(
      (sum, own) => ({
        invalidLine: sum.invalidLine + own.invalidLine,
        beyondDiffLength: sum.beyondDiffLength + own.beyondDiffLength,
        missingPath: sum.missingPath + own.missingPath,
        unknownPath: sum.unknownPath + own.unknownPath,
        capped: 0,
      }),
      { invalidLine: 0, beyondDiffLength: 0, missingPath: 0, unknownPath: 0, capped: 0 },
    );
    dropped.capped = capped;
    this.lastCounts = {
      parsed,
      kept: deduplicated.reduce((sum, result) => sum + result.findings.length, 0),
      dropped: { ...dropped, kept: 0, total: parsed, samples: this.droppedSamples },
    };
    return deduplicated;
  }

  // -------------------------------------------------------------------------
  // Lane Execution
  // -------------------------------------------------------------------------

  private async runLanesParallel(
    ctx: PromptContext,
    lanes: ReviewLane[],
  ): Promise<LLMReviewResult[]> {
    const promises = lanes.map((lane) => this.executeLane(ctx, lane));
    return Promise.all(promises);
  }

  private async runLanesSequential(
    ctx: PromptContext,
    lanes: ReviewLane[],
  ): Promise<LLMReviewResult[]> {
    const results: LLMReviewResult[] = [];
    for (const lane of lanes) {
      const result = await this.executeLane(ctx, lane);
      results.push(result);
    }
    return results;
  }

  private async executeLane(ctx: PromptContext, lane: ReviewLane): Promise<LLMReviewResult> {
    const startTime = Date.now();

    try {
      const promptFn = LANE_PROMPTS[lane];
      if (!promptFn) {
        return {
          filePath: ctx.filePath,
          lane,
          findings: [],
          success: false,
          error: `Unknown review lane: ${lane}`,
          durationMs: Date.now() - startTime,
        };
      }

      const prompt = promptFn(ctx);

      const llmOptions: CompletionOptions = {
        maxTokens: this.options.maxTokensPerLane,
        temperature: this.options.temperature,
        timeout: this.options.laneTimeout,
      };

      const result = await this.provider.complete(prompt, llmOptions);
      // **The parse and the filter are counted separately**, because **`parseLLMResponse` returning an empty array and
      // `filterFindings` removing everything produce the same zero and are different defects.**
      const parsedFindings = parseLLMResponse(result.content);
      const findings = this.filterFindings(parsedFindings, ctx);
      // **Kept per lane as well as last**, because a pull-request call has five lanes and one report, and a caller
      // reading only the last lane's counters would be reading a fifth of the story.
      this.parsedByLane.set(lane, parsedFindings.length);
      this.droppedByLane.set(lane, this.lastDropped);
      this.lastCounts = {
        parsed: parsedFindings.length,
        kept: findings.length,
        dropped: this.lastDropped,
      };

      return {
        filePath: ctx.filePath,
        lane,
        findings,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        filePath: ctx.filePath,
        lane,
        findings: [],
        success: false,
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Finding Filtering & Conversion
  // -------------------------------------------------------------------------

  /**
   * Filter LLM findings to ensure they reference valid line ranges
   * within the diff content.
   */
  /** **What the last lane's parse and filter did**, for a caller that needs to know why a count is zero. */
  lastCounts: {
    parsed: number;
    kept: number;
    dropped: {
      invalidLine: number;
      beyondDiffLength: number;
      missingPath: number;
      unknownPath: number;
      capped: number;
      kept: number;
      total: number;
      /** **The first few findings a rule removed**, so a count can be explained rather than guessed at. */
      samples?: Array<{ path?: string; title: string; rule: string }>;
    };
  } | null = null;

  private lastDropped = {
    invalidLine: 0,
    beyondDiffLength: 0,
    missingPath: 0,
    unknownPath: 0,
    capped: 0,
    kept: 0,
    total: 0,
  };

  /**
   * **The first few findings each rule removed, with the path they claimed**, so a count can be explained rather than
   * guessed at.
   *
   * **Why this exists, in one number.** The first pull-request run dropped **31 of 120** parsed findings as
   * `unknownPath`, and nothing in the artifact said which paths they named - so the next reader could only hypothesise
   * about renames, separators or prefixes. **A counter that cannot be explained is a counter that gets explained by
   * whoever is writing the report.**
   */
  private droppedSamples: Array<{ path?: string; title: string; rule: string }> = [];

  private noteDrop(sample: { path?: string; title: string; rule: string }): void {
    if (this.droppedSamples.length < 20) this.droppedSamples.push(sample);
  }

  /** **What each lane parsed and what it lost**, kept per lane so a pull-request call can report the whole call. */
  private readonly parsedByLane = new Map<ReviewLane, number>();
  private readonly droppedByLane = new Map<ReviewLane, typeof this.lastDropped>();

  private filterFindings(findings: LLMFinding[], ctx: PromptContext): LLMFinding[] {
    /**
     * **The lines the review was shown, taken from the hunk headers rather than from the text's length.**
     *
     * **Why this is a second attempt at the same defect.** The first version compared a finding's line numbers against
     * the number of lines in the diff and **clamped anything past it to the last line** - which stopped the finding
     * being discarded and **moved it to a line it did not name.** The counters said how often that happened:
     * `beyondDiffLength` fired on **194 of 199 lanes** on AACR-Bench, so **almost every finding in that run was
     * relocated before anything read it.**
     *
     * **A unified diff states where each hunk sits in the new file** - `@@ -a,b +c,d @@` says the hunk covers lines
     * `c` to `c+d-1` - **and it states nothing about how long the file is.** So the only question this function can
     * answer is *is the line inside a hunk the model was shown*, and **the answer is a diagnostic**: a hint outside
     * every hunk means the model named a line it was not looking at, which is worth counting and is **not** grounds for
     * moving the line. **The ranker grounds a finding by intersecting its range with the diff's added lines**, and a
     * range that has been rewritten to fit the diff grounds every finding against the same line.
     */
    const hunkText = `${ctx.diffContent}\n${ctx.fileContext ?? ''}`;
    const hunks = [...hunkText.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(
      (match) => {
        const start = Number(match[1]);
        return { start, end: start + Number(match[2] ?? 1) - 1 };
      },
    );
    /**
     * **The same ranges, per file, when one call covered more than one.**
     *
     * **Two files both have a line 10**, so a pull-request call holding one flat set of ranges cannot answer *is this
     * line one the model was looking at* - it can only answer *does some file have a line 10*, which is a different
     * question and the one the discarded first version of this filter accidentally answered. A file call keeps the flat
     * set, because there one file is the argument and the flat set is that file's.
     */
    const rangesByPath = new Map<string, Array<{ start: number; end: number }>>();
    // **The list the current section appends to, rather than a lookup per hunk.** A header registers an empty list and
    // every hunk of that section pushes into the same one, so **a file whose section holds no hunk is still present
    // with no ranges** - which is the answer a rename needs, and which a lookup-per-hunk could not tell apart from a
    // file the diff never mentioned.
    /**
     * **Both spellings a section can be named by, and the one it is stored under.**
     *
     * `diff --git a/old.ts b/new.ts` names one file twice, and **a finding about a renamed file may name either** - so a
     * path that matches the left-hand side is the same file rather than a file the call did not show. **The stored
     * spelling is the right-hand one**, because that is the file a comment can anchor on.
     */
    const canonicalOf = new Map<string, string>();
    let section: Array<{ start: number; end: number }> | null = null;
    for (const raw of String(ctx.diffContent).split('\n')) {
      const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      if (header) {
        const canonical = normaliseReviewPath(String(header[2]));
        section = [];
        rangesByPath.set(canonical, section);
        canonicalOf.set(canonical, canonical);
        // Only when the two sides differ, so the ordinary case adds nothing a reader has to hold.
        const before = normaliseReviewPath(String(header[1]));
        if (before !== canonical) canonicalOf.set(before, canonical);
        continue;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (hunk && section !== null) {
        const start = Number(hunk[1]);
        section.push({ start, end: start + Number(hunk[2] ?? 1) - 1 });
      }
    }
    const pullRequestScope = ctx.scope === 'pull-request';

    // **And the filter counts what it removes, because it was removing almost everything in silence.**
    //
    // **What the measurement found and this explains**: **995 lanes succeeded and produced one finding**, and **the
    // competitor produced twenty-nine on the same pull requests with the same model.** **The emission chain is
    // `complete` -> `parseLLMResponse` -> `filterFindings`, and the last of the three ran a check with the wrong
    // coordinate system.** **So the counters are per rule**, because **a filter with three rules and one counter cannot
    // say which rule a finding died of** - **the same distinction this repository draws in every other loop.**
    const dropped = {
      invalidLine: 0,
      beyondDiffLength: 0,
      missingPath: 0,
      unknownPath: 0,
      capped: 0,
      kept: 0,
      total: findings.length,
    };
    this.lastDropped = dropped;
    return findings
      .filter((f) => {
        // **A pull-request call has to say which file it is about, and the two ways of failing to say it are different
        // mistakes.** A finding with no path was never attributed; a finding with a path the call did not show was
        // attributed to something else. **Neither is defaulted**, because the default would be a neighbouring file.
        // **The ranges this finding is judged against**: its own file's, or the one file the call was given.
        let own = hunks;
        if (pullRequestScope) {
          if (typeof f.path !== 'string' || f.path === '') {
            dropped.missingPath += 1;
            this.noteDrop({ path: f.path, title: f.title, rule: 'missingPath' });
            return false;
          }
          // **One lookup that both validates and resolves**, rather than a `has` followed by a `get` whose fallback no
          // path could ever take: a branch that cannot be reached is a branch a reader has to prove is unreachable.
          const canonical = canonicalOf.get(normaliseReviewPath(f.path));
          const ownRanges = canonical === undefined ? undefined : rangesByPath.get(canonical);
          if (canonical === undefined || ownRanges === undefined) {
            dropped.unknownPath += 1;
            this.noteDrop({ path: f.path, title: f.title, rule: 'unknownPath' });
            return false;
          }
          // **The path is rewritten to the spelling the diff used**, which is the same file rather than a relocated
          // finding - a comment has to name the path a repository has.
          f.path = canonical;
          own = ownRanges;
        } else {
          // **A file call's file is the argument, so a path the model volunteered is discarded.** It is not that the
          // model is wrong - it is that in this scope the field has no meaning, and **a field with no meaning that
          // nevertheless reaches `deduplicateAcrossLanes` decides which findings are compared with which.** A finding
          // in a file call is about the file that was passed, and that is the whole truth here.
          delete f.path;
        }
        // Must have valid line numbers
        if (f.startLine < 1 || f.endLine < 1) {
          dropped.invalidLine += 1;
          return false;
        }
        // **A hint outside every hunk is counted and left alone.** With no hunk header there is no evidence either
        // way, so nothing is counted: **an unknown extent is not a finding about the finding.**
        const inside = (line: number): boolean =>
          own.some((hunk) => line >= hunk.start && line <= hunk.end);
        if (own.length > 0 && !(inside(f.startLine) && inside(f.endLine))) {
          dropped.beyondDiffLength += 1;
        }
        // Start must be before or equal to end
        if (f.startLine > f.endLine) {
          f.startLine = f.endLine;
        }
        return true;
      })
      .map((f) => ({
        ...f,
        // Normalize severity
        severity: this.normalizeSeverity(f.severity),
        // Normalize category
        category: this.normalizeCategory(f.category),
      }));
  }

  /**
   * Convert LLM review results to the standard ReviewComment format.
   *
   * **`order` is a finding-to-rank map, and a finding it does not mention is kept and placed last.** That is a contract
   * rather than a fallback: a caller that ranked a subset - one lane, one file, one budget - still gets every comment,
   * because **an ordering function that could silently drop a comment would be a filter wearing an order's name.**
   */
  convertToReviewComments(
    diff: GitDiff,
    results: LLMReviewResult[],
    order?: ReadonlyMap<LLMFinding, number>,
  ): ReviewComment[] {
    const built: Array<{ comment: ReviewComment; finding: LLMFinding }> = [];
    const now = new Date().toISOString();

    for (const result of results) {
      if (!result.success) continue;

      for (const finding of result.findings) {
        const rangeText = this.extractRangeText(diff, finding);

        built.push({
          finding,
          comment: {
            id: `llm-${result.lane}-${built.length}-${Date.now()}`,
            // **The finding's own file when it named one**, which is the only correct answer in a pull-request call
            // and the same answer as before in a file call.
            path: finding.path ?? diff.filePath,
            content: finding.title,
            thinking: `${finding.description}\n\n[Review Lane: ${LANE_LABELS[result.lane]}]`,
            existingCode: rangeText,
            suggestionCode: finding.suggestion ?? undefined,
            startLine: finding.startLine,
            endLine: finding.endLine,
            category: finding.category,
            severity: finding.severity,
            filtered: false,
            createdAt: now,
          },
        });
      }
    }

    if (order) {
      built.sort(
        (a, b) =>
          (order.get(a.finding) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.finding) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return built.map((entry) => entry.comment);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build a text representation of a git diff for the LLM prompt. */
  private buildDiffContent(diff: GitDiff): string {
    const parts: string[] = [];
    parts.push(`// File: ${diff.filePath}`);
    parts.push(`// Change type: ${diff.changeType}`);

    if (diff.oldPath) {
      parts.push(`// Old path: ${diff.oldPath}`);
    }

    for (const range of diff.ranges) {
      parts.push(
        `@@ -${range.oldStart},${range.oldEnd} +${range.newStart},${range.newEnd} @@ (${range.changeType})`,
      );
    }

    return parts.join('\n');
  }

  /** Truncate diff content to fit within the configured context window. */
  /**
   * **Every file gets a share of the budget, because a review of a pull request that shows two files is not a review of
   * the pull request.**
   *
   * The clipping is per section and the leftover is redistributed once, so **a pull request of ninety-nine small files
   * and one large one shows the small ones whole and clips the large one**, rather than clipping everything to equal
   * length. **A clipped section says so, by name and in characters**, because a model that is not told what it was not
   * shown will report the absence as a finding.
   */
  private showPullRequestDiff(sections: ReadonlyArray<DiffSection>): string {
    const budget = this.options.maxDiffLengthPerPullRequest;
    const total = sections.reduce((sum, section) => sum + section.diffText.length, 0);
    if (total <= budget) return sections.map((section) => section.diffText).join('\n');

    // **Every section's allowance starts at an equal share, and the share nobody used is not thrown away.**
    const share = Math.floor(budget / sections.length);
    const allowance = sections.map((section) => Math.min(section.diffText.length, share));
    // **Only the share a section did not need is spare** - the difference the other way is demand, and spending demand
    // as if it were supply is how a budget silently becomes four times its size.
    let spare = sections.reduce(
      (sum, _section, at) => sum + Math.max(0, share - allowance[at]!),
      0,
    );
    // **And the spare fills the clipped sections in file order, to completion, before the next one.** A proportional
    // split would leave every large file equally short, which is the one outcome that shows nothing in full; this way a
    // pull request of ninety-nine small files and one large one shows the small ones whole.
    for (let at = 0; at < sections.length && spare > 0; at += 1) {
      const wants = sections[at]!.diffText.length - allowance[at]!;
      const give = Math.min(spare, wants);
      allowance[at] = allowance[at]! + give;
      spare -= give;
    }

    return sections
      .map((section, at) => {
        const shown = allowance[at]!;
        if (shown >= section.diffText.length) return section.diffText;
        const half = Math.floor(shown / 2);
        const hidden = section.diffText.length - half * 2;
        // **A clipped section says so, by name and in characters**, because **a model that is not told what it was not
        // shown reports the absence as a finding** - and that finding is about the clip, not the code.
        return `${section.diffText.slice(0, half)}\n\n... [${hidden} characters of ${section.path} not shown] ...\n\n${section.diffText.slice(section.diffText.length - half)}`;
      })
      .join('\n');
  }

  private truncateDiff(content: string): string {
    if (content.length <= this.options.maxDiffLength) {
      return content;
    }

    const half = Math.floor(this.options.maxDiffLength / 2);
    const start = content.slice(0, half);
    const end = content.slice(content.length - half);
    return `${start}\n\n... [${content.length - this.options.maxDiffLength} characters truncated] ...\n\n${end}`;
  }

  /** Extract relevant code text for a specific finding from the diff. */
  private extractRangeText(diff: GitDiff, finding: LLMFinding): string {
    const parts: string[] = [];
    for (const range of diff.ranges) {
      parts.push(
        `[Lines ${range.oldStart}-${range.oldEnd} -> ${range.newStart}-${range.newEnd}] ${range.changeType}`,
      );
    }
    return parts.length > 0 ? parts.join('\n') : `Line ${finding.startLine}-${finding.endLine}`;
  }

  /** Normalize severity string to valid Severity type. */
  private normalizeSeverity(raw: string): Severity {
    const valid: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const lower = raw.toLowerCase();
    if (valid.includes(lower as Severity)) {
      return lower as Severity;
    }
    return 'medium';
  }

  /** Normalize category string to valid ReviewCategory type. */
  private normalizeCategory(raw: string): ReviewCategory {
    const valid: ReviewCategory[] = [
      'bug',
      'security',
      'performance',
      'maintainability',
      'test',
      'style',
      'documentation',
      'architecture',
      'other',
    ];
    const lower = raw.toLowerCase();
    if (valid.includes(lower as ReviewCategory)) {
      return lower as ReviewCategory;
    }
    return 'other';
  }
}
