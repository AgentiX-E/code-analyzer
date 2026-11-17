// @code-analyzer/intelligence — LLM Review Engine
// Orchestrates LLM-powered code review across multiple lanes.

import {
  LANE_PROMPTS,
  LANE_LABELS,
  parseLLMResponse,
  type PromptContext,
  type PromptOrder,
  type ReviewLane,
  type LLMFinding,
} from './prompts.js';
import { collectDiffFacts, diffHeaderPaths, rankFindings } from '../actionability.js';
import { detectIdioms } from '../idiom-rules.js';
import { remarkPrompt, selectRemarks, type RemarkSelection } from '../remark-lane.js';
import { codeContextForSections, type CodeContextLimits } from './code-context.js';
import {
  ClaimAdjudicator,
  oneLine,
  type AdjudicationReport,
  type RefusedClaim,
} from '../adjudication/adjudicator.js';
import {
  FalsifierGate,
  type FalsifierContract,
  type FalsifierDrop,
  type FalsifierReport,
} from '../adjudication/falsifier.js';
import { applyNarrationVeto, type NarrationVetoReport } from '../adjudication/narration.js';
import { addedLinesOf, numberedAddedLines } from '../adjudication/patch-lines.js';

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
  /**
   * **Whether a finding of a different category is a second concern at a site rather than a duplicate of it.** Defaults
   * to **false**, because every published figure was measured with the range rule merging unconditionally.
   *
   * **The range rule is a claim about defects and it was being applied to categories.** Two findings whose ranges
   * overlap are one finding "because the same defect has one location" - and the rule never read a word of either, which
   * on the discovery rows merged **2 273 of 2 295** removals. The corpus carries the case the rule loses:
   * `electron#47361` has a use-after-free and an O(n²) erase on one line, and **a reviewer that says one true thing per
   * site loses the second every time.**
   *
   * **What the switch does not do.** It keeps one extra finding per site and only when the category differs, so two
   * findings of one category in one range are still one finding - a lane that marks a twelve-line block for one problem
   * has made every other finding of its own kind inside that block a duplicate of it, and keeping those files the same
   * remark twice. See `docs/EVAL-CONTRACT.md` §59.
   */
  secondConcern?: boolean;
  /**
   * **Whether every lane prompt carries the per-language defect checklist.** Defaults to **false**, on measurement.
   *
   * The switch exists because the checklist is a **claim about precision**, and the only way to settle a claim about a
   * prompt device is to run the same corpus with it and without it: `AACR_CHECKLIST` in the benchmark workflow is that
   * second run, and it is a product flag rather than a harness hack so that what was measured is what ships. **Two
   * paired runs later the claim is falsified in both directions** - the gain is negative and so is the mechanism - so the
   * shipped default follows the measurement. See `docs/EVAL-CONTRACT.md` §15.3.
   */
  /**
   * **Whether a finding's claim is checked before it is filed.** Defaults to **false**, and the default is the
   * unmeasured side until a run says otherwise.
   *
   * **Why the product needs this at all.** On AACR-Bench's fifty pull requests this engine files 569 comments and a
   * judge accepts 160: **73 of the 302 false positives are comments that assert nothing about the code**, and **141 of
   * the 452 goldens it misses are missed by a comment standing on the golden's own line**. Neither is a reading failure
   * and neither is repaired by a better prompt - **the first needs a reader that asks "is this true", and the second
   * needs one that asks "what is true here".** `ClaimAdjudicator` is that reader, and this flag is where it is switched
   * on so that what is measured is what ships.
   */
  adjudicate?: boolean;
  /** How many adjudication calls may be in flight at once. Defaults to 4. */
  adjudicateConcurrency?: number;
  /**
   * **Whether each file's claims are put to an independent reader that must quote a line to remove one.** Defaults to
   * **false**, which is the side every published figure was measured on.
   *
   * **This is not `adjudicate` with a different prompt.** That device is asked once per finding and trusts the answer's
   * reason; on fifty pull requests it took precision to 45.5 % and recall to 6.6 %, and F1 from 19.5 % to 11.6 %
   * (§44-§45). This one is asked **once per file**, keeps by default, and **applies a removal only when the reader
   * quotes an added line that the gate can find in the diff** - so the worst case of a reader that hallucinates is a
   * pool that did not shrink, rather than a reviewer that stopped speaking.
   *
   * **It is a product flag rather than a harness flag** for the reason every other one is: what a run measures has to be
   * what ships. See `docs/EVAL-CONTRACT.md` §73 and §74.
   *
   * **Its value is the contract, not a boolean**, because the two contracts are one device with two rules and **§74 is
   * the record of a run that had to infer which rule produced its pool from twelve sampled rows.** `falsify:
   * 'quoted-falsifier-v1'` admits the claim's own line as evidence; `'independent-evidence-v2'` removes the claim's own
   * range from the quotable set, so the only thing that can refute a sentence is the rest of the change.
   */
  falsify?: false | FalsifierContract;
  languageChecklist?: boolean;
  /**
   * **Where the target-and-diff block sits in every lane prompt.** Undefined means `boilerplate-first`, the arrangement
   * that ships; the other two exist so the same corpus can be run with the device and without it. See
   * `EVAL-CONTRACT.md` §10 and `composeLanePrompt`.
   */
  promptOrder?: PromptOrder;
  /**
   * **How many rounds of lane calls are sent. Defaults to one, and the reason it is not two is the whole of §10.**
   *
   * A cache entry is created by a request and reused by a *later* one, so **a device whose shared block is
   * file-specific cannot pay while five calls for that file are in flight together** - the other four ask before
   * anything is stored. `2` sends the first lane alone, waits, then sends the remaining four together: one round that
   * builds the entry and one that reuses it, **for twice the latency.**
   *
   * **That round is worth it only for the arrangement `EVAL-CONTRACT.md` §9 registered**, where the reusable block is
   * one file's diff and there is nothing else to reuse. **Under the arrangement that ships, the reusable block is the
   * lane's own wording, which is identical for every file the lane ever reads** - so the first *file* stores it and
   * the remaining files hit it with no warm-up round at all. **A round that buys nothing and costs latency is not a
   * safety margin**, so the default is `1` and this option exists to make §9's arrangement measurable rather than to
   * be used.
   *
   * `lanes.length` sends one lane per round, which is the fully sequential arrangement.
   */
  laneWaves?: number;
  /**
   * **Whether a pull-request call is shown the code each hunk sits in.** Defaults to `false`, which is the behaviour
   * every figure this repository has published was measured under.
   *
   * The window is built by `code-context.ts`: the block around each hunk, headed by its path, its line numbers and the
   * lines that changed. **It is off by default because it costs tokens and nothing has measured it yet**, and it is an
   * engine option rather than a harness flag because a device a user cannot turn on is a device only the benchmark has.
   */
  codeContext?: boolean;
  /**
   * **Whether the deterministic idiom lane runs beside the five model lanes. Defaults to `false`.**
   *
   * The five lanes are asked for defects, and a model asked for defects describes defects: on fifty pull requests of
   * `Alibaba-Aone/aacr-bench`, **forty-one of fifty goldens the file arm missed are remarks the lanes never attempt** -
   * `const auto&` on a loop variable that is only read, a `2.0` that should be `2.0f`, a commented-out `Fill(0.0)`, an
   * `async` with nothing to await. Each is decidable from the syntax of one construct, so each is decided here rather
   * than argued with a prompt, and **`idiom-rules.ts` names the golden behind every rule.**
   *
   * **Why it is off by default.** It changes what the product says, so a figure measured with it on belongs to a
   * different product than one measured with it off - and every figure this repository has published was measured
   * with it off. `AACR_IDIOMS` in the benchmark is how it is turned on for a run that says so.
   */
  idioms?: boolean;
  /**
   * **Whether the remark pass runs beside the five lanes. Defaults to `false`.**
   *
   * The deterministic lane decides six constructs it can see in the patch; **this is the device for the rest of the
   * bucket** - one extra call whose contract is *the remarks a senior reviewer leaves and a compiler cannot check*,
   * with the family list in `remark-lane.ts` standing where a lane prompt puts a defect checklist.
   *
   * **Why it is a second device rather than a longer rule list.** R-21 measured the six rules at +0.0148 against a
   * registered +0.02 (p = 0.2615): directionally right and short of the bar, which is what a fixed list looks like
   * against the remark vocabulary of a whole corpus. **A rule fires on the construct its author thought of.**
   *
   * **Off by default for the same reason the idiom lane is**: every figure this repository has published was measured
   * without it, and `AACR_REMARKS` in the benchmark is how a run says which side of the switch it was.
   */
  remarks?: boolean;
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
  /**
   * **What produced these findings when the producer was not a model call.**
   *
   * Absent means a lane. `'idioms'` means the deterministic lane and `'remarks'` means the remark pass - a model call
   * that is not one of the five lanes and whose findings must not be counted as one: **a lane table that counted either
   * as a sixth lane would report a call the five did not make, and a reader comparing two runs would see the same lane
   * names and different products.**
   */
  source?: 'idioms' | 'remarks';
  /** Optional token usage tracking. */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Prompt tokens the vendor served from its prefix cache, when it reported a split. */
    cacheHitTokens?: number;
    /** Prompt tokens the vendor read fresh, when it reported a split. */
    cacheMissTokens?: number;
  };
  /**
   * **What this lane cost, in USD, when the provider could price it.**
   *
   * **The field above was declared and never written.** `provider.ts` returned a usage object for every completion and
   * `executeLane` destructured only `content`, so **a five-lane review of a hundred files made five hundred billable
   * calls and reported none of them** - which is how a job can move an account balance by sixty-two yuan while every
   * figure this repository publishes stays silent about it.
   */
  costUsd?: number;
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
  /**
   * **The file at the revision being reviewed, when the caller could read it.**
   *
   * Optional because the engine is also used on a diff alone, and because **a caller that cannot read the file must say
   * so by omission rather than by passing an empty string** - an empty string is a file that exists and has no content,
   * and the two would be indistinguishable in the prompt. When it is present and `codeContext` is on, the lane call is
   * given the block each hunk sits in; when it is absent the call is exactly what it was before the option existed.
   */
  fileText?: string;
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
  /**
   * **Whether the lanes are shown the code each hunk sits in.**
   *
   * A hunk carries the change and not the contract the change has to keep, and **160 of 282 goldens on the measured
   * corpus were rejected with a finding standing on their own line** - which is what a review looks like when it can
   * see five added lines and not the function around them. **Undefined reads `LLMReviewOptions.codeContext`**, so a
   * caller can set it once for the engine or per call without the two disagreeing silently.
   */
  codeContext?: boolean;
  /** The window's bounds, when the defaults in `code-context.ts` are not what the caller wants to pay for. */
  codeContextLimits?: CodeContextLimits;
  /** Characters every file's window may contribute together. Defaults to 12000. */
  maxCodeContextChars?: number;
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
  // **Off, and it is off because it was measured twice and lost twice.**
  //
  // `docs/EVAL-CONTRACT.md` §15.3: paired over pull request and golden index, the checklist lost 12 goldens on one prompt
  // order (6 / 19, p = 0.029) and 13 on another (6 / 19, p = 0.0146). **It halves emission - 357 findings to 202 - and
  // buys precision with recall at a rate F1 prices as a loss.** A device registered as a targeting aid turned out to be a
  // suppression aid, and §15.4 says why: the goldens it was aimed at were never in the wrong place.
  //
  // **The flag stays, because turning a device off is not the same experiment as replacing it**, and because what the
  // checklist is good at is real: 76 fewer false positives per 170 goldens. **A product that prefers precision to F1
  // should turn it back on**, and this line is where it does so.
  languageChecklist: false,
  adjudicate: false,
  adjudicateConcurrency: 4,
  falsify: false,
  promptOrder: 'boilerplate-first',
  laneWaves: 1,
  codeContext: false,
  // **Off, and off is the honest default rather than a conservatism.** The lane is a measurement: it is turned on by
  // `AACR_IDIOMS=on` for a run that reports it, and a default that was on would make every figure this repository has
  // already published describe a product that no longer exists.
  idioms: false,
  // **Off, for the same reason and with the same switch.** The remark pass is the model-driven half of §47.1's bucket:
  // a run that turns it on says so in its artifact, and a default of `true` would silently re-price every published
  // lane figure by one call per file.
  remarks: false,
  // **Off, because the range rule has merged unconditionally since the first run and every published figure was measured
  // under it.** The switch is §59's device: a finding of a *different category* whose range overlaps a survivor's is a
  // second concern at the site rather than a duplicate of it, and the run that turns it on says so in its artifact.
  secondConcern: false,
};

/**
 * **The lanes, grouped into the rounds they will be sent in.**
 *
 * One round is the shipped arrangement and returns the lanes untouched. More than one puts a single lane in the first
 * round - **it is the request that fills the cache** - and spreads the rest as widely as the arithmetic allows, so the
 * warm-up costs one call's latency rather than four more.
 *
 * **Exported and pure because it is the part of the device that can be checked without a provider.** The claim a run
 * makes is about a ratio of cached tokens; the claim this function makes is that exactly one call precedes the rest,
 * and it is the only one of the two a unit test can settle.
 *
 * `waves` is clamped rather than trusted: `0`, `1`, `NaN` and anything below a single round mean **one round**, and
 * more rounds than lanes means one lane per round. **A schedule is not a place for a thrown exception** - a
 * misconfigured run should cost more money, not produce no review at all.
 */
export function planLaneWaves(lanes: readonly ReviewLane[], waves: number): ReviewLane[][] {
  if (lanes.length === 0) return [];
  const rounds = Number.isFinite(waves) ? Math.trunc(waves) : 1;
  const wanted = Math.min(Math.max(rounds, 1), lanes.length);
  if (wanted <= 1) return [lanes.slice()];
  const rest = lanes.slice(1);
  const perRound = Math.ceil(rest.length / (wanted - 1));
  const plan: ReviewLane[][] = [[lanes[0]!]];
  for (let at = 0; at < rest.length; at += perRound) plan.push(rest.slice(at, at + perRound));
  return plan;
}

// ---------------------------------------------------------------------------
// LLM Review Engine
// ---------------------------------------------------------------------------

/**
 * **One finding the merge removed, and the finding that removed it.**
 *
 * The pair is the whole point: a count of removals is compatible with "the five lanes said the same thing five ways"
 * and with "the bug lane's finding was absorbed by the architecture lane's design remark because their ranges
 * overlapped", and those two are opposite verdicts on the merge. **Only the pair distinguishes them**, and only the
 * category pair can be counted without a human reading the sentences.
 */
export interface DroppedFinding {
  /** The file the removed finding was about. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The removed finding's own category, which is what the engine said the defect was. */
  readonly category: string;
  readonly severity: Severity;
  /** Its title, truncated, because the artifact is diffed by hand and a paragraph has no reader. */
  readonly title: string;
  /** Which of the three merge rules removed it. */
  readonly rule: 'rangeAndWords' | 'rangeOnly' | 'wordsNearby';
  /** The survivor's range and category - the finding this one became part of. */
  readonly swallowedByStartLine: number;
  readonly swallowedByEndLine: number;
  readonly swallowedByCategory: string;
}

/** How many removals one review may record. Beyond this the count still rises and the list says so. */
export const DROPPED_FINDINGS_CEILING = 400;

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
    this.resetSpend();
    const diffContent = this.buildDiffContent(diff);

    const ctx: PromptContext = {
      diffContent: this.truncateDiff(diffContent),
      filePath: diff.filePath,
      changeType: diff.changeType,
      fileContext,
      languageChecklist: this.options.languageChecklist,
      promptOrder: this.options.promptOrder,
    };

    const lanes = this.options.lanes;

    const results = await this.runLanes(ctx, lanes);
    // **The deterministic lane joins the list before the merge, not after it.** A remark that both a lane and this
    // pass made is one remark, and a merge that ran first would file it twice - which costs a reader's attention and,
    // on the corpus, a false positive.
    if (this.options.idioms) {
      const idiomFindings = this.reviewIdioms(diff, fileContext);
      if (idiomFindings.length > 0) {
        results.push({
          filePath: diff.filePath,
          lane: 'maintainability',
          findings: idiomFindings,
          success: true,
          durationMs: 0,
          source: 'idioms',
        });
      }
    }
    // **The remark pass joins the list on the same side of the merge as the deterministic lane**, and for the same
    // reason: a remark that a lane and this pass both made is one remark, and a merge that ran first would file it
    // twice. **It is pushed even when it filed nothing**, because it was paid for: a pass that spoke and a pass that
    // was never asked are the same zero in a figure, and the lane table is where the difference is visible.
    if (this.options.remarks) {
      results.push(await this.reviewRemarks(diff, fileContext));
    }
    const merged = this.deduplicateAcrossLanes(results);
    // **The free gate before the paid one**, and the order is not cosmetic: a claim a quoted line refutes is one the
    // adjudicator would have been paid to look at. **Neither device is on by default**, so this branch is empty on every
    // run that produced a figure in this repository.
    const gated = this.options.falsify ? await this.gateClaims(merged, diff, fileContext) : merged;
    if (!this.options.adjudicate) return gated;
    return this.checkClaims(gated, diff, fileContext);
  }

  /**
   * **One model call, asked for the remarks the five lanes were never asked for, with three rails on what it may file.**
   *
   * The prompt, the families and the ceiling are `remark-lane.ts`'s, and **the parse and the diff filter are the same
   * two every lane goes through** - a pass with its own parser would be a second place for a coordinate to be wrong.
   * What this method adds is the one rail the lanes do not have: **only added lines**, read from the patch text.
   *
   * **It returns a result rather than findings**, because a pass that is paid for and files nothing still has to appear
   * in the lane table: an empty `findings` and a call that was never made are the same zero in a figure, and only one of
   * them is a reason to keep the switch.
   */
  async reviewRemarks(diff: GitDiff, fileContext?: string): Promise<LLMReviewResult> {
    const startTime = Date.now();
    // **No patch text means no added lines, and a rail that cannot name the lines this pull request added cannot
    // approve a remark on any of them.** `buildDiffContent` is the header plus the hunk coordinates and carries no line
    // text at all, so falling back to it would buy a call whose every finding the rail then discards - a paid silence.
    // **The pass still returns**, because it was switched on and the lane table is where a switched-on device appears,
    // but it is not paid for. This is the one place the remark pass diverges from `reviewIdioms`, which reads the diff
    // ranges and answers from them alone.
    if (!fileContext) {
      this.lastRemarks = { kept: [], notAddedLine: 0, capped: 0, notAPatch: true };
      return {
        filePath: diff.filePath,
        lane: 'maintainability',
        findings: [],
        success: true,
        durationMs: Date.now() - startTime,
        source: 'remarks',
      };
    }
    const patch = fileContext;
    const ctx: PromptContext = {
      diffContent: this.truncateDiff(patch),
      filePath: diff.filePath,
      changeType: diff.changeType,
      fileContext,
      languageChecklist: this.options.languageChecklist,
      promptOrder: this.options.promptOrder,
    };
    try {
      const result = await this.provider.complete(remarkPrompt(ctx), {
        maxTokens: this.options.maxTokensPerLane,
        temperature: this.options.temperature,
        timeout: this.options.laneTimeout,
        tag: 'review:remarks',
      });
      this.spend.calls += 1;
      if (result.usage) {
        this.spend.promptTokens += result.usage.promptTokens;
        this.spend.completionTokens += result.usage.completionTokens;
        this.spend.cacheHitTokens += result.usage.cacheHitTokens ?? 0;
      }
      this.spend.costUsd += result.costUsd ?? 0;

      const parsed = parseLLMResponse(result.content);
      // **The coordinate filter runs first and the rail second**, because the two answer different questions: the filter
      // asks whether the line is inside a hunk the model was shown, and the rail asks whether the pull request added it.
      const selection = selectRemarks(this.filterFindings(parsed, ctx), patch);
      this.lastRemarks = selection;
      return {
        filePath: diff.filePath,
        lane: 'maintainability',
        findings: [...selection.kept],
        success: true,
        durationMs: Date.now() - startTime,
        source: 'remarks',
        // **Assigned rather than conditionally spread**: `exactOptionalPropertyTypes` is off, so a field the vendor did
        // not report is written as `undefined` and drops out of the artifact - one code path instead of two on a return
        // that runs once per file per pass.
        tokenUsage: result.usage,
        costUsd: result.costUsd,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastRemarks = { kept: [], notAddedLine: 0, capped: 0, notAPatch: true };
      return {
        filePath: diff.filePath,
        lane: 'maintainability',
        findings: [],
        success: false,
        error: message,
        durationMs: Date.now() - startTime,
        source: 'remarks',
      };
    }
  }

  /** **What the last remark pass kept and what the two rails removed**, so a low count can be explained. */
  lastRemarks: RemarkSelection = { kept: [], notAddedLine: 0, capped: 0, notAPatch: false };

  /**
   * **The remarks the deterministic lane has to make about one diff, with no model call.**
   *
   * **The patch is the only input, and the added lines are read out of it** rather than out of `diff.ranges`: the
   * benchmark builds its diffs from patch text, where `ranges` counts the patch's own lines, and **a rule that fired on
   * a context line would file a comment on code the pull request did not touch** - a remark a reviewer could not have
   * made and a coordinate the comment positioner cannot place.
   *
   * Public because the benchmark turns it on and a product caller may want it without a model provider at all: **a
   * deterministic lane is exactly the part of the review that works when the API does not.**
   */
  reviewIdioms(diff: GitDiff, fileContext?: string): LLMFinding[] {
    const patch = fileContext ?? this.buildDiffContent(diff);
    const numbered = numberedAddedLines(patch);
    // **`null` means the text is not a patch**, so no line constraint exists and the lane says nothing: a remark
    // without a coordinate is a remark the positioner drops after it has been paid for.
    if (numbered === null || numbered.length === 0) return [];
    return detectIdioms({
      path: diff.filePath,
      addedLines: new Map(numbered.map((line) => [line.line, line.text])),
      patch,
    });
  }

  /**
   * **What the claim check did, and it is `null` when the check did not run.**
   *
   * Two reports rather than one, because the two halves are different bets: `narration` refuses a sentence that is not
   * a claim and costs nothing, `claims` buys one model call per survivor. **A single count would hide which half
   * produced a figure**, and the next iteration would have to buy the run again to find out.
   */
  lastAdjudication: {
    narration: NarrationVetoReport;
    claims: AdjudicationReport | null;
    /**
     * **Every comment the pass threw away, with the sentence that threw it away.**
     *
     * The counters say *"494 refuted"* and a counter cannot be read: **the reason a reader refused a comment is the only
     * evidence that distinguishes a device that is too strict from a reader that is looking at the wrong line**, and
     * without it the next iteration is a guess with a price. Recorded here rather than written to a log because the
     * artifact is what survives the runner, and truncated to one line because **an artifact that carries a thousand
     * paragraphs is an artifact nobody opens.**
     */
    refused: RefusedClaim[];
  } | null = null;

  /**
   * **What the independent gate did to one file, or `null` when it was not switched on.**
   *
   * The report rather than a count, because the numbers are the registration: `candidates` is the pool the gate was
   * shown, `dropped` is what it removed with a verified quote, and **`keptBecauseQuoteMissing` is the number that says
   * whether the device is strict or broken** - a gate that refutes twenty claims and can quote a line for none of them
   * has a reader that is guessing, and it is indistinguishable from a working gate without this counter.
   */
  lastFalsifier: { report: FalsifierReport; dropped: FalsifierDrop[] } | null = null;

  /**
   * **Put one file's claims to a reader that must quote a line to remove one.**
   *
   * **One call per file**, which is the difference in price between this and `checkClaims`: 1 415 calls for the 146
   * pull-request corpus against that device's 5 032. **The pool it is shown is the merged one** - after the range rule
   * and after the narration-free merge - because a claim the merge already removed is not a claim a reader should be
   * paid to look at.
   *
   * **A file with no patch text keeps everything and spends nothing**: the gate's only warrant is a quoted added line,
   * and `numberedAddedLines` returns `null` for a code window rather than an empty set precisely so that the two cases
   * cannot be confused here.
   */
  private async gateClaims(
    results: LLMReviewResult[],
    diff: GitDiff,
    fileContext?: string,
  ): Promise<LLMReviewResult[]> {
    const patch = fileContext ?? this.buildDiffContent(diff);
    const entries = results.flatMap((result, resultAt) =>
      result.success
        ? result.findings.map((finding, findingAt) => ({ resultAt, findingAt, finding }))
        : [],
    );

    const gate = new FalsifierGate(this.provider, {
      timeout: this.options.laneTimeout,
      contract: this.options.falsify === false ? undefined : this.options.falsify,
    });
    const outcome = await gate.gate({
      path: diff.filePath,
      findings: entries.map((entry) => entry.finding),
      addedLines: numberedAddedLines(patch),
    });

    this.lastFalsifier = { report: outcome.report, dropped: outcome.dropped };

    // **The survivors are found by identity rather than by index**, because the gate is forbidden to rewrite what it
    // keeps: a finding it returns is the object it was given, so membership is the whole test and a re-anchoring bug
    // cannot hide behind a coordinate comparison.
    const kept = new Set(outcome.kept);
    return results.map((result) =>
      result.success
        ? { ...result, findings: result.findings.filter((finding) => kept.has(finding)) }
        : result,
    );
  }

  /**
   * **Check every merged finding's claim before it can be filed.**
   *
   * The order is deliberate and it is the cheap half first: **the narration veto is deterministic and free**, so a
   * comment that restates the diff never reaches a paid call. On the recorded artifact that is 10 of 569 - **the device
   * is small, and its size is the reason it is allowed to run first rather than being trusted with the decision.**
   *
   * **What happens to the lane structure.** The pass works on a flat list and then rebuilds each lane's own result from
   * the survivors, because `ReviewComment` conversion, the per-lane tables and the benchmark's lane counters are all
   * keyed by lane. **A reviewer that returned one flat list would be simpler and would silently stop being able to say
   * which lane earned a golden**, which is the measurement every prompt decision in this file was made with.
   */
  private async checkClaims(
    results: LLMReviewResult[],
    diff: GitDiff,
    fileContext?: string,
  ): Promise<LLMReviewResult[]> {
    const patch = fileContext ?? this.buildDiffContent(diff);
    // **Read from the patch, not from `diff.ranges`** - see `addedLinesOf`. The benchmark builds its diffs out of patch
    // text, where `ranges` counts the patch's own lines and a file's line 900 does not exist.
    const addedLines = addedLinesOf(patch);

    const entries = results.flatMap((result, resultAt) =>
      result.success
        ? result.findings.map((finding, findingAt) => ({ resultAt, findingAt, finding }))
        : [],
    );

    const veto = applyNarrationVeto(entries.map((entry) => entry.finding));
    const refused = new Set(veto.refused.map((entry) => entry.finding));
    const survivors = entries.filter((entry) => !refused.has(entry.finding));

    const adjudicator = new ClaimAdjudicator(this.provider, {
      concurrency: this.options.adjudicateConcurrency,
      timeout: this.options.laneTimeout,
    });
    const outcome = await adjudicator.adjudicate(
      survivors.map((entry) => ({
        finding: entry.finding,
        addedCode: patch,
        addedLines,
        ...(fileContext === undefined ? {} : { fileContext }),
      })),
      { path: diff.filePath },
    );

    // **What was refused, by whom, in the reader's own words.** Both halves are recorded, because the free half is
    // allowed to refuse comments too and **a report that only audited the half that costs money would audit the half
    // that is already deterministic** - the price of a mistake is the same whichever half made it.
    this.lastAdjudication = {
      narration: veto.report,
      claims: outcome.report,
      refused: [
        ...veto.refused.map((entry) => ({
          path: diff.filePath,
          startLine: entry.finding.startLine,
          endLine: entry.finding.endLine,
          title: oneLine(entry.finding.title, 120),
          why: `narration:${entry.rule}`,
          reason: 'the sentence restates the change and states no consequence',
        })),
        ...outcome.dropped.map((entry) => ({
          path: diff.filePath,
          startLine: entry.finding.startLine,
          endLine: entry.finding.endLine,
          title: oneLine(entry.finding.title, 120),
          why: entry.why,
          reason: oneLine(entry.reason),
        })),
      ],
    };

    // **The survivors are placed back at the coordinates they came from.** Position is not enough - a refutation in the
    // middle shifts every later index - so the candidate's own index travels with it, and the lane a finding is
    // attributed to is the lane that produced it rather than the lane that happened to be first.
    const keptBySlot = new Map<string, LLMFinding>();
    for (const entry of outcome.kept) {
      const origin = survivors[entry.index];
      if (origin === undefined) continue;
      keptBySlot.set(`${origin.resultAt}:${origin.findingAt}`, entry.finding);
    }

    return results.map((result, resultAt) => {
      if (!result.success) return result;
      const findings: LLMFinding[] = [];
      result.findings.forEach((_finding, findingAt) => {
        const kept = keptBySlot.get(`${resultAt}:${findingAt}`);
        if (kept !== undefined) findings.push(kept);
      });
      return { ...result, findings };
    });
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
  /**
   * **What the merge did, split by the rule that did it, because "1186 absorbed" is not a diagnosis.**
   *
   * Two findings are one finding here for one of three reasons, and they are not the same reason: **overlapping ranges**
   * (the same defect has one location), **overlapping ranges whose sentences also share most of their vocabulary**
   * (unambiguously the same), or **the same vocabulary within a few lines** (two lanes wording one construct
   * differently). **The first of those three is the only one with no textual evidence in it at all**, so a merge report
   * that says only `dropped: 1186` cannot distinguish a merge that removed restatements from a merge that removed a
   * second defect filed on a range that happened to overlap the first.
   */
  lastDeduplication: {
    before: number;
    after: number;
    dropped: number;
    mergedBy: { rangeAndWords: number; rangeOnly: number; wordsNearby: number };
    /**
     * **How many findings the range rule would have removed and did not, because they were a different category.**
     *
     * **The number the switch has to publish, because the switch's effect is invisible in `dropped`.** A run with it on
     * removes fewer findings, which reads as a quieter dedup rather than as a decision - and a device whose only trace is
     * a smaller number in a different column cannot be told from a run that happened to produce fewer duplicates.
     */
    keptAsSecondConcern: number;
    /**
     * **The findings the merge removed, one record each, because the total cannot be read.**
     *
     * `dropped: 2 301` is compatible with two opposite readings and §46.8 says so: a merge that removed restatements is
     * free and correct, and a merge that removed a second defect because its range happened to overlap the first's is a
     * recall defect that no figure in this repository can see. **The record is what makes the question answerable
     * offline**, because the alternative is a dispatch: every entry here names the rule, the finding that was removed,
     * and the finding that removed it - so a cross-category absorb can be counted without a model call.
     *
     * **Bounded, and it says when it bounded.** A pull request with three hundred findings would otherwise put three
     * hundred records in an artifact that exists to be diffed by hand.
     */
    droppedFindings: readonly DroppedFinding[];
    /** How many were removed past the recording ceiling, so a truncated list is not read as a complete one. */
    droppedFindingsBeyondCeiling: number;
  } | null = null;

  /**
   * **What the last review spent**, accumulated at the point each lane returns.
   *
   * **Why the engine keeps its own figure when the provider already has a ledger.** The ledger answers *"what did this
   * process cost"*, which is the right question for a bill and the wrong one for a review: **a benchmark job reviews
   * fourteen pull requests in one process**, and *"this review cost 0.04 USD"* cannot be recovered from a process-wide
   * total by division when the pull requests differ in size by an order of magnitude. Both figures exist and they answer
   * different questions - the same reason this repository keeps a per-row figure beside a protocol-wide one.
   */
  private readonly spend = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
    costUsd: 0,
  };

  /** The last review's calls and what they cost, in USD. */
  costSummary(): {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    cacheHitTokens: number;
    costUsd: number;
    /** `cacheHitTokens / promptTokens`, or `null` when no call reported a cache split. */
    cacheHitRatio: number | null;
  } {
    return {
      ...this.spend,
      cacheHitRatio:
        this.spend.promptTokens > 0 ? this.spend.cacheHitTokens / this.spend.promptTokens : null,
    };
  }

  /** Zero the accumulator, at the start of every public review call, so the figure describes one unit of work. */
  private resetSpend(): void {
    this.spend.calls = 0;
    this.spend.promptTokens = 0;
    this.spend.completionTokens = 0;
    this.spend.cacheHitTokens = 0;
    this.spend.costUsd = 0;
  }

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

    const survivors: Array<Entry & { absorbed: number; secondKept?: boolean }> = [];
    const mergedBy = { rangeAndWords: 0, rangeOnly: 0, wordsNearby: 0 };
    let keptAsSecondConcern = 0;
    const droppedFindings: DroppedFinding[] = [];
    let droppedFindingsBeyondCeiling = 0;
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
      const nearLocation =
        sameLocation !== -1
          ? -1
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
      const duplicateAt = sameLocation !== -1 ? sameLocation : nearLocation;
      const survivor = duplicateAt === -1 ? undefined : survivors[duplicateAt];
      if (survivor === undefined) {
        survivors.push({ ...entry, absorbed: 1 });
        continue;
      }
      // **A different category in the same range is a second concern rather than a restatement**, when the switch is on.
      //
      // **Why the range rule is the wrong evidence and the other two are not.** `rangeOnly` means the ranges overlap and
      // the sentences do not: **that is the definition of two findings that happened to be marked on the same lines**,
      // and it was the reason 2 273 of the run's 2 295 removals happened. The other two rules read the words. So the
      // switch is scoped to the rule that never did.
      //
      // **One per site, and the cap is the corpus's own shape.** A site with three findings of three categories is a
      // lane marking a block, and the third is a third comment on one line; **the round's own records put one
      // cross-category second concern at 602 sites across 404 files**, with a median of one per file.
      const secondConcernHere =
        this.options.secondConcern === true &&
        sameLocation !== -1 &&
        survivor.secondKept !== true &&
        shares(survivor.words, entry.words) < this.options.dedupThreshold &&
        String(entry.finding.category) !== String(survivor.finding.category);
      if (secondConcernHere) {
        // **The survivor is marked rather than the new finding**, because the mark says *this site has had its second
        // concern*, which is a fact about the site and not about the sentence that filled it.
        survivor.secondKept = true;
        survivors.push({ ...entry, absorbed: 1, secondKept: true });
        keptAsSecondConcern += 1;
        continue;
      }
      survivor.absorbed += 1;
      // **Which rule absorbed it**, and the distinction the report needs: a merge under the range rule alone has no
      // textual evidence, so it is the one that can remove a second defect.
      const rule: DroppedFinding['rule'] =
        sameLocation !== -1
          ? shares(survivor.words, entry.words) >= this.options.dedupThreshold
            ? 'rangeAndWords'
            : 'rangeOnly'
          : 'wordsNearby';
      mergedBy[rule] += 1;
      // **The removal, recorded as a pair rather than as a count**, because the count is what this repository has had
      // for four iterations and it is what §46.8 says cannot be read.
      if (droppedFindings.length < DROPPED_FINDINGS_CEILING) {
        droppedFindings.push({
          path: fileOf(entry),
          startLine: entry.finding.startLine,
          endLine: entry.finding.endLine,
          category: String(entry.finding.category),
          severity: entry.finding.severity,
          title: entry.finding.title.slice(0, 120),
          rule,
          swallowedByStartLine: survivor.finding.startLine,
          swallowedByEndLine: survivor.finding.endLine,
          swallowedByCategory: String(survivor.finding.category),
        });
      } else droppedFindingsBeyondCeiling += 1;
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
      mergedBy,
      keptAsSecondConcern,
      droppedFindings,
      droppedFindingsBeyondCeiling,
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
    this.resetSpend();
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
    // **The window, when the caller asked for it and gave the engine something to build one from.** A section without
    // `fileText` contributes nothing, so a caller that could read four of seven files gets four windows and the review
    // is otherwise what it was - **silence about the three it could not read is the behaviour this option already had**,
    // and inventing an empty window for them would tell a model the file is empty.
    const codeContext =
      (options?.codeContext ?? this.options.codeContext)
        ? codeContextForSections(
            sections,
            options?.codeContextLimits,
            options?.maxCodeContextChars ?? 12_000,
          )
        : '';

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
      languageChecklist: this.options.languageChecklist,
      promptOrder: this.options.promptOrder,
      ...(codeContext.length > 0 ? { fileContext: codeContext } : {}),
    };

    const results = await this.runLanes(ctx, this.options.lanes);

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

  /**
   * **The same lanes, in rounds, so that a round can exist to fill the cache rather than to empty it.**
   *
   * Only one arrangement needs it - the file-scoped prefix of §9 - and the default wave count is one; this method is
   * what makes the other arrangement measurable without a second engine. **`await` on the round rather than on each
   * call**, so the lanes inside a round are still concurrent, and the results are concatenated in lane order, which is
   * the order the deduplication and the budget have always seen.
   */
  private async runLanesInWaves(
    ctx: PromptContext,
    lanes: ReviewLane[],
    waves: number,
  ): Promise<LLMReviewResult[]> {
    const results: LLMReviewResult[] = [];
    for (const wave of planLaneWaves(lanes, waves)) {
      // **`await` on the round, not on each call**: the lanes inside a round are still concurrent, which is the
      // latency this arrangement keeps.
      const settled = await Promise.all(wave.map((lane) => this.executeLane(ctx, lane)));
      results.push(...settled);
    }
    return results;
  }

  /** Which of the three arrangements a call asked for, in one place so both scopes agree. */
  private async runLanes(ctx: PromptContext, lanes: ReviewLane[]): Promise<LLMReviewResult[]> {
    if (!this.options.parallel) return this.runLanesSequential(ctx, lanes);
    return this.runLanesInWaves(ctx, lanes, this.options.laneWaves);
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
        // **The lane, not the file**: the ledger's question is which *part of the product* the money went to, and a tag
        // that carried a path would produce one row per file and no answer.
        tag: `review:${lane}`,
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

      // **The spend is accumulated where the lane returns, so every public entry point reports it** - the file scope,
      // the ranked scope and the pull-request scope all go through this method.
      this.spend.calls += 1;
      if (result.usage) {
        this.spend.promptTokens += result.usage.promptTokens;
        this.spend.completionTokens += result.usage.completionTokens;
        this.spend.cacheHitTokens += result.usage.cacheHitTokens ?? 0;
      }
      this.spend.costUsd += result.costUsd ?? 0;

      return {
        filePath: ctx.filePath,
        lane,
        findings,
        success: true,
        durationMs: Date.now() - startTime,
        ...(result.usage ? { tokenUsage: result.usage } : {}),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
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
      // **A search rather than two lazy groups.** `^diff --git a\/(.+?) b\/(.+)$` is quadratic on a header line
      // holding many ` b/` candidates, and a diff is text this module did not write. The split is at the first ` b/`,
      // which is where the lazy group stopped, so **the answers are the ones this function already gave** - a fix for a
      // quadratic scan that also moved a boundary would be two changes, and only one of them was measured.
      const header = diffHeaderPaths(raw);
      if (header) {
        const canonical = normaliseReviewPath(header.right);
        section = [];
        rangesByPath.set(canonical, section);
        canonicalOf.set(canonical, canonical);
        // Only when the two sides differ, so the ordinary case adds nothing a reader has to hold.
        const before = normaliseReviewPath(header.left);
        if (before !== canonical) canonicalOf.set(before, canonical);
        continue;
      }
      // **`{1,9}` and not `+`.** A line of the form `@@ -1111…1` with no second coordinate makes `\d+` rescan the run
      // from every start position, and a hunk header is attacker text. **A line number wider than nine digits is not a
      // line number**; the bound is stated rather than implied by the size of the file being read.
      const hunk = /^@@ -\d{1,9}(?:,\d{1,9})? \+(\d{1,9})(?:,(\d{1,9}))? @@/.exec(raw);
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
