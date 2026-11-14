// @code-analyzer/intelligence — the pass that checks a finding's claim before it is filed
//
// **What this is, and the measurement it was written for.** On AACR-Bench's fifty pull requests this reviewer files
// 569 comments and a judge accepts 160 of them, while a direct competitor's recorded output is close to twice as precise
// on the same corpus, the same judge and the same model. **Two of the three failures the artifact attributes are not
// recall failures**:
//
//   - **302 false positives** against 160 accepted - and the block of them that made the list unreadable is not wrong
//     about the code, it is **not about the code**: *"Public API change: balloonArrow() return type changed from int to
//     ArrowType"* and *"Forward-declared enum used as return type"*, whose own body argues the declaration is legal.
//   - **141 goldens missed by a comment standing on the golden's own line** - right place, wrong sentence.
//
// **Neither is repaired by a better finder.** A finder asked to be more careful writes fewer of the same comments; a
// finder asked to be more accurate writes the same comments with more confidence. **What both need is a reader that is
// asked a different question**: is this sentence true of this code, and if not, what is true at this line. That is this
// class, and it is deliberately a *separate call with a separate job* rather than a self-critique inside the lane -
// **a claim checked by the process that produced it is checked by an instrument that agrees with itself.**
//
// **Why it can raise recall as well as precision, which is the part that matters.** Filtering alone trades one for the
// other, and this repository has already measured that trade on this corpus and refused it: the category floor moved
// precision 0.1622 → 0.2559 and F1 by +0.0079, inside the instrument's own resolution, losing 68 goldens for every 38
// it gained (`docs/EVAL-CONTRACT.md` §19.3). **A device that can only subtract cannot win that trade.** A repair can:
// a comment on the right line describing the wrong defect is rewritten into one describing the right defect, which is a
// false positive *and* a false negative repaired in a single move.

import { buildAdjudicationPrompt, type AdjudicationRequest } from './prompt.js';
import {
  applyVerdict,
  readAdjudication,
  resolveAnchor,
  text,
  type AppliedVerdict,
} from './verdict.js';

import type { LLMFinding } from '../llm/prompts.js';
import type { LLMProvider, CompletionOptions } from '../llm/provider.js';

/** What one candidate is, with everything the second reader needs and nothing it does not. */
export interface AdjudicationCandidate {
  finding: LLMFinding;
  /** The added lines of the finding's own file, numbered, as the diff states them. */
  addedCode: string;
  /**
   * The union of the new-side line numbers of every hunk in the file, or **`null` when the text handed in is not a
   * patch** - see `addedLinesOf`. A null constraint files the comment where the reader put it rather than nowhere.
   */
  addedLines: ReadonlySet<number> | null;
  /** The block the hunks sit in, when the review was given one. */
  fileContext?: string;
}

/**
 * **One comment the pass threw away, with the sentence that threw it away.**
 *
 * `why` is a code rather than a sentence - `refuted`, `unanchored`, `narration:<rule>` - because the artifact tabulates
 * codes and **a table is what a next iteration can act on**. `reason` is the reader's own words, on one line, because
 * the question *"is this device too strict, or is it looking at the wrong line?"* is answered by reading fifty of them
 * and by nothing else the run records.
 */
export interface RefusedClaim {
  /** The file the comment was about. */
  path: string;
  /** The first line it was filed on. */
  startLine: number;
  /** The last line it was filed on. */
  endLine: number;
  /** The comment's title, which is the sentence the gate and the reader both see first. */
  title: string;
  /** Which stage refused it and, for the free half, which rule. */
  why: string;
  /** The reader's own sentence, whitespace collapsed and truncated to one line. */
  reason: string;
}

/**
 * **A sentence made safe to store in an artifact.**
 *
 * Newlines collapse because a reason carrying a fenced code block turns one row of a table into ten, and truncation is
 * explicit rather than silent: **a stored reason that ends mid-word without saying so is a reason a reader will
 * misquote.**
 */
export function oneLine(value: unknown, max = 240): string {
  const flat = text(value).replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** What a whole pass did, in counts a report can print without re-reading anything. */
export interface AdjudicationReport {
  /** Candidates handed to the pass. */
  candidates: number;
  /** Filed unchanged. */
  upheld: number;
  /** Filed with a rewritten claim, which is where a gain in recall comes from. */
  repaired: number;
  /** Dropped because the claim did not hold. */
  refuted: number;
  /** Dropped because nobody could say which added line the comment was about. */
  unanchored: number;
  /**
   * **Kept because the call failed, which is a decision and not an oversight.**
   *
   * A provider outage that deleted every finding would report a reviewer with perfect precision and no recall, and the
   * two causes - *"everything was refuted"* and *"nothing was read"* - have opposite repairs. **So the pass fails open
   * and counts what it could not check**, and a run whose `unchecked` is not zero is a run whose figure describes a
   * reviewer without this device.
   */
  unchecked: number;
  /** Model calls actually made. */
  calls: number;
  /** The verdicts the reader could not be parsed out of, kept apart from refutations. */
  unreadable: number;
}

/**
 * **One model call per candidate finding, and a decision that survives a failed one.**
 *
 * **Concurrency is bounded rather than unbounded**, for the reason the lane runner bounds it: this pass runs once per
 * finding over a file that produced ten of them, and a hundred simultaneous requests to one endpoint is a rate limit
 * measured in the report as a review that silently stopped. The bound is a constructor option so a caller with a
 * different provider can say so.
 */
export class ClaimAdjudicator {
  constructor(
    private readonly provider: LLMProvider,
    private readonly options: { concurrency?: number; maxTokens?: number; timeout?: number } = {},
  ) {}

  /** The last pass's counts, or `null` before the first one. */
  lastReport: AdjudicationReport | null = null;

  /**
   * **Check one candidate and decide what happens to it.**
   *
   * The three outcomes are returned as a value rather than applied to a list here, because **a pass that mutates a
   * shared list is a pass whose order decides its result** - and the caller needs the refusals as much as the survivors
   * when it writes an artifact.
   */
  async adjudicateOne(
    candidate: AdjudicationCandidate,
    path: string,
  ): Promise<{ applied: AppliedVerdict; call: 'answered' | 'unreadable' | 'failed' }> {
    const request: AdjudicationRequest = {
      path,
      finding: candidate.finding,
      addedCode: candidate.addedCode,
      ...(candidate.fileContext === undefined ? {} : { fileContext: candidate.fileContext }),
    };

    let raw: string;
    try {
      const completion = await this.provider.complete(
        buildAdjudicationPrompt(request),
        this.completionOptions(),
      );
      raw = completion.content;
    } catch {
      // **Open, not closed** - see `AdjudicationReport.unchecked`. The comment is filed as the lane wrote it, and the
      // count says the device did not run for it.
      const anchor = resolveAnchor(
        null,
        { startLine: candidate.finding.startLine, endLine: candidate.finding.endLine },
        candidate.addedLines,
      );
      return anchor === null
        ? {
            applied: {
              kind: 'dropped',
              why: 'unanchored',
              reason: 'the check failed and no line is added',
            },
            call: 'failed',
          }
        : {
            applied: {
              kind: 'kept',
              anchored: false,
              finding: {
                ...candidate.finding,
                startLine: anchor.startLine,
                endLine: anchor.endLine,
              },
            },
            call: 'failed',
          };
    }

    const read = readAdjudication(raw);
    if (read.kind === 'unreadable') {
      // **Unreadable is also open**, and for the same reason: the answer is not a refutation, and deleting a finding
      // because a parser did not understand a sentence converts a provider defect into a recall figure.
      const anchor = resolveAnchor(
        null,
        { startLine: candidate.finding.startLine, endLine: candidate.finding.endLine },
        candidate.addedLines,
      );
      return anchor === null
        ? { applied: { kind: 'dropped', why: 'unanchored', reason: read.why }, call: 'unreadable' }
        : {
            applied: {
              kind: 'kept',
              anchored: false,
              finding: {
                ...candidate.finding,
                startLine: anchor.startLine,
                endLine: anchor.endLine,
              },
            },
            call: 'unreadable',
          };
    }

    return {
      applied: applyVerdict(candidate.finding, read.verdict, candidate.addedLines),
      call: 'answered',
    };
  }

  /**
   * **Check a file's findings, in a bounded number of parallel calls, and return what is filed.**
   *
   * `context` carries the file, because every call in the pass is about the same one - **and passing it per candidate
   * would let two candidates be checked against different code, which is the class of defect this repository already
   * paid for once when a golden's path was dropped from a measurement.**
   */
  async adjudicate(
    candidates: ReadonlyArray<AdjudicationCandidate>,
    context: { path: string },
  ): Promise<{
    /**
     * What is filed, each carrying **the index of the candidate it came from**.
     *
     * The index is returned rather than inferred from position, because a kept list in candidate order and a filtered
     * candidate list look identical and are not: **a caller that zipped them by position would report a repair against
     * the wrong original the first time one candidate in the middle was refuted**, and the report would be internally
     * consistent while attributing a sentence to a finding that never said it.
     */
    kept: Array<{ index: number; finding: LLMFinding }>;
    dropped: Array<{ index: number; finding: LLMFinding; why: string; reason: string }>;
    report: AdjudicationReport;
  }> {
    const report: AdjudicationReport = {
      candidates: candidates.length,
      upheld: 0,
      repaired: 0,
      refuted: 0,
      unanchored: 0,
      unchecked: 0,
      calls: 0,
      unreadable: 0,
    };

    const kept: Array<{ index: number; finding: LLMFinding }> = [];
    const dropped: Array<{ index: number; finding: LLMFinding; why: string; reason: string }> = [];
    const limit = Math.max(1, this.options.concurrency ?? 4);

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const at = next;
        next += 1;
        const candidate = candidates[at];
        if (candidate === undefined) return;

        const { applied, call } = await this.adjudicateOne(candidate, context.path);
        if (call === 'answered') report.calls += 1;
        else report.unchecked += 1;
        if (call === 'unreadable') report.unreadable += 1;

        if (applied.kind === 'kept') {
          kept.push({ index: at, finding: applied.finding });
          // **A repair is counted as a repair and not as an upheld with a different sentence**, because the two are
          // different bets: one says the reviewer was right, the other says the reviewer was looking at the right code.
          if (applied.finding.repaired === true) report.repaired += 1;
          else report.upheld += 1;
          continue;
        }

        if (applied.why === 'unanchored') report.unanchored += 1;
        else report.refuted += 1;
        dropped.push({
          index: at,
          finding: candidate.finding,
          why: applied.why,
          reason: applied.reason,
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(limit, Math.max(1, candidates.length)) }, worker),
    );

    // **The kept list is put back into the order the candidates arrived in**, because the ranking a caller applies next
    // is a function of order and completion order is not one. The index each entry carries is what makes this a sort
    // rather than a guess: sorting by score would make this pass a second ranker.
    kept.sort((left, right) => left.index - right.index);

    this.lastReport = report;
    return { kept, dropped, report };
  }

  /** The call parameters, in one place so the two call sites cannot disagree. */
  private completionOptions(): CompletionOptions {
    return {
      temperature: 0,
      maxTokens: this.options.maxTokens ?? 600,
      // **Tagged, because the ledger groups by tag and this device is a line item somebody will want to argue about.**
      // A pass that adds one call per finding is the difference between a reviewer that costs 0.29 USD a run and one
      // that costs more, and a bill that cannot separate the two cannot settle whether the device is worth it.
      tag: 'review:adjudicate',
      ...(this.options.timeout === undefined ? {} : { timeout: this.options.timeout }),
    };
  }
}
