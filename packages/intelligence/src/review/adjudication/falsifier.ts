// @code-analyzer/intelligence — the gate that keeps by default and only drops what it can quote
//
// **Why this is a second device rather than a third prompt paragraph.** §44–§45's `ClaimAdjudicator` is the same idea
// asked one finding at a time and answered without evidence: on fifty pull requests it took precision to 45.5 % and
// recall to 6.6 %, and F1 from 19.5 % to 11.6 %. **A gate that accepts "refuted" on the reader's word is not a filter,
// it is a quieter reviewer** - and the corpus's own acceptance study (`arXiv 2607.03316`, 31 073 pairs) puts the same
// trade in the field's numbers: 56.3 % of AI comments are rejected, 43.3 % of them flat false positives, and the
// deployable device is a *pre-filter*, not a rewrite.
//
// **So three things are inverted here.**
//
//   1. **One call per file, not per finding.** The adjudicator spent 5 032 calls on 146 pull requests; a file's whole
//      claim list fits in one prompt, and this spends 1 415 - the price of the device is not the reason to skip it.
//   2. **Keep is the default and silence is a keep.** The question is *"which of these is contradicted by a line this
//      diff added?"*, so a reader with nothing to say removes nothing.
//   3. **A drop must quote an added line, and the quote is checked.** `verdict.ts` trusts a refutation's reason;
//      here the quote is verified against the added lines, must be long enough to identify one (ten characters), and is
//      matched with whitespace reflowed because a reader copying indentation is not a reader in error. **A refutation
//      that cannot produce the line is not applied** - it is counted, so a run can tell a strict gate from a broken one.
//
// **And it may not edit.** No rewrite, no re-anchor, no severity change: the survivors go back as the same objects. A
// gate that edits is a second author of the comment, and then a figure measures the gate rather than the reviewer.

import { text } from './verdict.js';

import type { NumberedAddedLine } from './patch-lines.js';
import type { LLMFinding } from '../llm/prompts.js';
import type { CompletionOptions, LLMProvider } from '../llm/provider.js';

/**
 * **The shortest quote that can identify a line.**
 *
 * Ten characters, because a shorter one is satisfied by almost every line in the file: `if (x` is on the added line the
 * claim is about and is not evidence of anything. **The floor exists because a substring check with no floor is a check
 * that any three characters pass**, which is the defect `golden-attribution` had when it matched on `return`.
 */
export const FALSIFIER_MIN_QUOTE = 10;

/** **How much of a file's added lines the reader is shown**, in characters. */
export const FALSIFIER_CODE_BUDGET = 12_000;

/**
 * **How many claims one call may carry.**
 *
 * A file with more than sixty findings is not a file whose sixty-first finding is the one a reader would settle; the rest
 * are kept unasked and counted as `notAsked`, so the artifact says how much of the pool the gate ever saw.
 */
export const FALSIFIER_MAX_CLAIMS = 60;

/** What one gate call is given. */
export interface FalsifierRequest {
  /** The file the claims are about. */
  path: string;
  /** Every claim that survived the merge, in the order the lanes filed them. */
  findings: ReadonlyArray<LLMFinding>;
  /**
   * **The added lines of this file, numbered - or `null` when the text handed in is not a patch.**
   *
   * `null` means *no quote can be verified*, so the gate keeps everything and spends nothing: a gate whose evidence
   * cannot be checked would be dropping on the reader's word, which is the device this one exists to replace.
   */
  addedLines: ReadonlyArray<NumberedAddedLine> | null;
}

/** One claim the reader says a line contradicts, before the quote is checked. */
export interface FalsifierRefutation {
  /** The claim's number, one-based, as the prompt printed it. */
  claim: number;
  /** The added line, as the reader copied it. */
  quote: string;
  /** One sentence naming the failure in the claim. */
  reason: string;
}

/** What reading an answer produced, with "unreadable" kept apart from "silent". */
export type FalsifierRead =
  { kind: 'answer'; refuted: FalsifierRefutation[] } | { kind: 'unreadable'; why: string };

/** One claim the gate removed, with the evidence that removed it. */
export interface FalsifierDrop {
  finding: LLMFinding;
  quote: string;
  reason: string;
}

/** What the gate did, in numbers a run can print and a next iteration can act on. */
export interface FalsifierReport {
  /** Claims the gate was shown. */
  candidates: number;
  /** Claims removed. */
  dropped: number;
  /** Claims whose refutation did not quote an added line, or quoted fewer than `FALSIFIER_MIN_QUOTE` characters. */
  keptBecauseQuoteMissing: number;
  /** Claims the reader refuted but the answer could not be read at all. */
  unreadable: number;
  /** Claims beyond `FALSIFIER_MAX_CLAIMS`, which were never asked about. */
  notAsked: number;
  /** Whether the text handed in was a patch at all. */
  notAPatch: boolean;
  /** Model calls spent. */
  calls: number;
}

/** The outcome of one file's gate: what survived, what did not, and the numbers. */
export interface FalsifierOutcome {
  kept: LLMFinding[];
  dropped: FalsifierDrop[];
  report: FalsifierReport;
}

/** Strip the code fence a model puts around JSON when it was told not to. */
function unfence(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) return trimmed;
  const body = trimmed.slice(firstNewline + 1);
  return body.endsWith('```') ? body.slice(0, -3).trim() : body.trim();
}

/**
 * **One line of whitespace-collapsed text, for comparing a quote against the line it came from.**
 *
 * A reader that copies `if (x < FLT_EPSILON) {` as `  if (x < FLT_EPSILON) {` is quoting the line, and a byte comparison
 * would refuse it and keep a claim whose refutation is sitting in front of it. **What the quote has to establish is
 * which line it is, and indentation does not change that.**
 */
function compareForm(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Render the added lines the reader may quote, subject to the character budget. */
function renderLines(lines: ReadonlyArray<NumberedAddedLine>): {
  body: string;
  shown: number;
} {
  const rendered: string[] = [];
  let used = 0;
  for (const line of lines) {
    const one = `${line.line}| ${line.text}\n`;
    if (used + one.length > FALSIFIER_CODE_BUDGET) break;
    rendered.push(one);
    used += one.length;
  }
  return { body: rendered.join(''), shown: rendered.length };
}

/** How many claims the prompt can carry, and the block that numbers them. */
function renderClaims(findings: ReadonlyArray<LLMFinding>): { body: string; asked: number } {
  const asked = Math.min(findings.length, FALSIFIER_MAX_CLAIMS);
  const body = findings
    .slice(0, asked)
    .map((finding, at) => {
      const where =
        finding.endLine > finding.startLine
          ? `lines ${finding.startLine}-${finding.endLine}`
          : `line ${finding.startLine}`;
      return `[${at + 1}] (${where}) ${finding.title}`;
    })
    .join('\n');
  return { body, asked };
}

/**
 * **The question, and the four sentences that make it a falsification request rather than an opinion poll.**
 *
 * The reader is shown the added lines with their numbers, the claims with their numbers, and nothing else: **not the
 * lane, not the severity, not the description's argument**. A reader told which lane wrote a claim anchors on that
 * lane's concerns, and a reader shown a severity anchors on the severity.
 */
export function buildFalsifierPrompt(
  request: FalsifierRequest & { addedLines: ReadonlyArray<NumberedAddedLine> },
): string {
  const lines = renderLines(request.addedLines);
  const claims = renderClaims(request.findings);
  return [
    `You are the independent reader of one file's change: ${request.path}.`,
    '',
    'Below are the added lines, with the number the new file gives each one. Below them are claims another reader made',
    'about this change, numbered.',
    '',
    'The added lines:',
    lines.body.trimEnd(),
    '',
    'The claims:',
    claims.body,
    '',
    'Question: which of these claims does one of the added lines directly contradict?',
    '',
    "Answer with the claim's number and the exact text of the line that contradicts it, copied character for character",
    'from the list above. If no added line contradicts a claim, do not mention it - a claim you cannot refute is kept.',
    '',
    'Three rules, and they are the whole contract:',
    '',
    '1. Only the added lines above are evidence. Code this change did not touch is not evidence, and neither is code',
    '   you cannot see.',
    '2. The quote must be one of the lines above, copied exactly. A quote that is not on an added line is not a',
    '   refutation, and the claim stays.',
    '3. You may not rewrite a claim, re-anchor it, or lower its severity. A claim is either refuted by a quoted line or',
    '   kept as it was written.',
    '',
    'Answer as JSON only:',
    '{"refuted":[{"claim":<number>,"quote":"<the added line, character for character>","reason":"<one sentence>"}]}',
  ].join('\n');
}

/**
 * **Read one answer, keeping "silent" and "unreadable" apart.**
 *
 * `{}` is a legitimate answer: it says nothing is contradicted, which is what most files should produce. **Prose is not
 * an answer**, and a caller that read it as silence would be unable to tell a reader with nothing to say from a
 * provider that stopped returning JSON — the same confusion §44's artifact had when an empty answer and a dropped claim
 * both printed as zero.
 */
export function readFalsifierAnswer(raw: string): FalsifierRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    return { kind: 'unreadable', why: 'the answer is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { kind: 'unreadable', why: 'the answer is not an object' };

  const record = parsed as Record<string, unknown>;
  if (record['refuted'] === undefined) return { kind: 'answer', refuted: [] };
  if (!Array.isArray(record['refuted']))
    return { kind: 'unreadable', why: 'refuted is not a list' };

  const refuted: FalsifierRefutation[] = [];
  for (const entry of record['refuted']) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const one = entry as Record<string, unknown>;
    const claim = Number(one['claim']);
    if (!Number.isFinite(claim) || claim < 1) continue;
    refuted.push({
      claim: Math.trunc(claim),
      quote: text(one['quote']),
      reason: text(one['reason']).trim().replace(/\s+/g, ' '),
    });
  }
  return { kind: 'answer', refuted };
}

/**
 * **The gate.**
 *
 * One call per file, one pass over the answer, and no other effect on the pool: a claim is either removed with a verified
 * quote or returned as the object it arrived as.
 */
export class FalsifierGate {
  private readonly provider: LLMProvider;
  private readonly timeout: number | undefined;

  constructor(provider: LLMProvider, options: { timeout?: number } = {}) {
    this.provider = provider;
    this.timeout = options.timeout;
  }

  /** Run the gate over one file's claims. */
  async gate(request: FalsifierRequest): Promise<FalsifierOutcome> {
    const report: FalsifierReport = {
      candidates: request.findings.length,
      dropped: 0,
      keptBecauseQuoteMissing: 0,
      unreadable: 0,
      notAsked: 0,
      notAPatch: request.addedLines === null,
      calls: 0,
    };

    // **Nothing to verify, nothing to spend.** A file with no claims has no question, and a text that is not a patch
    // has no quotable line - both keep everything and cost nothing, which is the direction a gate that keeps by default
    // is allowed to fail in.
    if (request.findings.length === 0 || request.addedLines === null)
      return { kept: [...request.findings], dropped: [], report };

    // **The narrowing is taken into a binding rather than trusted to survive three calls**, because what follows reads
    // it twice - once to render the prompt and once to verify the quotes against what that prompt showed - and the two
    // readings have to be of the same list.
    const addedLines = request.addedLines;

    const asked = Math.min(request.findings.length, FALSIFIER_MAX_CLAIMS);
    report.notAsked = request.findings.length - asked;

    const prompt = buildFalsifierPrompt({ ...request, addedLines });
    let raw: string;
    try {
      const options: CompletionOptions = {
        temperature: 0,
        maxTokens: 900,
        tag: 'review:falsifier',
      };
      if (this.timeout !== undefined) options.timeout = this.timeout;
      const answer = await this.provider.complete(prompt, options);
      raw = answer.content;
    } catch {
      // **A provider that threw is an unreadable answer, not a refutation.** The claims stay, and the count says the
      // gate did not run rather than that it ran and found nothing.
      report.unreadable = 1;
      return { kept: [...request.findings], dropped: [], report };
    }
    report.calls = 1;

    const read = readFalsifierAnswer(raw);
    if (read.kind === 'unreadable') {
      report.unreadable = 1;
      return { kept: [...request.findings], dropped: [], report };
    }

    // **The strings the reader was allowed to quote**, in comparison form, so a quote is checked against what it was
    // shown rather than against the whole file's added lines beyond the budget.
    const quotable = addedLines
      .slice(0, renderLines(addedLines).shown)
      .map((line) => compareForm(line.text));

    const droppedAt = new Map<number, FalsifierDrop>();
    for (const refutation of read.refuted) {
      const at = refutation.claim - 1;
      // **A number outside the claims asked about is ignored**, because the alternative is applying a refutation to a
      // claim whose title the reader never saw.
      if (at < 0 || at >= asked) continue;
      // **The first refutation of a claim wins**, so a reader that names one claim twice cannot change the reason the
      // artifact records by saying it again.
      if (droppedAt.has(at)) continue;

      const quote = compareForm(refutation.quote);
      if (quote.length < FALSIFIER_MIN_QUOTE || !quotable.some((line) => line.includes(quote))) {
        report.keptBecauseQuoteMissing += 1;
        continue;
      }
      droppedAt.set(at, {
        finding: request.findings[at]!,
        quote: refutation.quote,
        reason: refutation.reason,
      });
    }

    report.dropped = droppedAt.size;
    const kept = request.findings.filter((_finding, at) => !droppedAt.has(at));
    return { kept: [...kept], dropped: [...droppedAt.values()], report };
  }
}
