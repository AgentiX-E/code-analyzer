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
//
// **§74 found that the first contract admitted a tautology, and the second one closes it.** Under `quoted-falsifier-v1`
// the quotable set is the whole file's added lines - including the line the claim is anchored to. A claim's evidence
// *is* its line, so `the y component is doubled` at line 11 was "refuted" by quoting line 11. Nine of the twelve
// removals sampled from that run did exactly this, and the gate's removals carried **69 true positives against a pool
// rate of 21.3 %** - very slightly worse than deleting at random. `independent-evidence-v2` removes the claim's own
// range from the quotable set, in the prompt and in the checker, so what is left is the only thing that could ever
// refute a sentence: the rest of the change. **A gate whose only evidence is the claim itself keeps every claim**, which
// is the direction this device has always been allowed to fail in.

import { text } from './verdict.js';

import type { NumberedAddedLine } from './patch-lines.js';
import type { LLMFinding } from '../llm/prompts.js';
import type { CompletionOptions, LLMProvider } from '../llm/provider.js';

/**
 * **The two contracts a gate call can be run under, named in the artifact.**
 *
 * `v1` is the quote-verifying gate of §73; `v2` is the same device with the claim's own range removed from its evidence.
 * **The name travels with the report** rather than being a constant of the run, because the two contracts produce
 * different pools from the same prompts-shaped artefacts and a figure that could not say which one produced it would be a
 * figure the next iteration can contradict without being wrong.
 */
export const FALSIFIER_CONTRACTS = {
  v1: 'quoted-falsifier-v1',
  v2: 'independent-evidence-v2',
} as const;

/**
 * **A contract is named by its value, not by its key.**
 *
 * `'independent-evidence-v2'` rather than `'v2'`, because the name is what the artifact records and what a reader of a
 * report compares against `docs/EVAL-CONTRACT.md`; a key would be a second name for the same fact and the pair would
 * drift the first time one of them was renamed.
 */
export type FalsifierContract = (typeof FALSIFIER_CONTRACTS)[keyof typeof FALSIFIER_CONTRACTS];

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
  /**
   * **Which rules the reader is answering under.** Defaults to `quoted-falsifier-v1`, the contract §73 registered and
   * §74 falsified, so that every figure already in this repository stays reproducible from the code that measured it.
   */
  contract?: FalsifierContract;
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
  /** The claim's one-based position in the file's list, so the artifact can say *which* claim was removed. */
  claimIndex: number;
  /** The new-side line number of the line the quote was found on. */
  quoteLine: number;
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
  /**
   * **Claims whose refutation quoted only lines inside the claim's own range.**
   *
   * Kept apart from `keptBecauseQuoteMissing` because the two are different defects that print the same F1: one says the
   * reader cannot copy a line, the other says the reader copied the claim. **Only the second is evidence that the device
   * is tautological**, and §74 could only infer it by reading twelve sampled rows by hand.
   */
  keptBecauseSelfReferential: number;
  /** Which rules this call ran under, from `FALSIFIER_CONTRACTS`. */
  contract: string;
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

/**
 * **How many claims the prompt can carry, and the block that numbers them.**
 *
 * Under `v2` each claim is followed by the range that is not evidence for it. **The prohibition is stated per claim
 * rather than once for the file**, because a reader that has to apply a subtraction while composing its answer will
 * quote the claim's own line - which is what the sampled removals of §74 show twelve times in twelve.
 */
function renderClaims(
  findings: ReadonlyArray<LLMFinding>,
  contract: FalsifierContract,
): { body: string; asked: number } {
  const asked = Math.min(findings.length, FALSIFIER_MAX_CLAIMS);
  const body = findings
    .slice(0, asked)
    .map((finding, at) => {
      const where =
        finding.endLine > finding.startLine
          ? `lines ${finding.startLine}-${finding.endLine}`
          : `line ${finding.startLine}`;
      const head = `[${at + 1}] (${where}) ${finding.title}`;
      if (contract !== FALSIFIER_CONTRACTS.v2) return head;
      const verb = finding.endLine > finding.startLine ? 'are' : 'is';
      return `${head}\n    claim ${at + 1}'s own ${where} ${verb} not evidence for claim ${at + 1}`;
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
  const contract = request.contract ?? FALSIFIER_CONTRACTS.v1;
  const lines = renderLines(request.addedLines);
  const claims = renderClaims(request.findings, contract);
  const rules =
    contract !== FALSIFIER_CONTRACTS.v2
      ? [
          'Three rules, and they are the whole contract:',
          '',
          '1. Only the added lines above are evidence. Code this change did not touch is not evidence, and neither is',
          '   code you cannot see.',
          '2. The quote must be one of the lines above, copied exactly. A quote that is not on an added line is not a',
          '   refutation, and the claim stays.',
          '3. You may not rewrite a claim, re-anchor it, or lower its severity. A claim is either refuted by a quoted',
          '   line or kept as it was written.',
        ]
      : [
          'Four rules, and they are the whole contract:',
          '',
          '1. Only the added lines above are evidence. Code this change did not touch is not evidence, and neither is',
          '   code you cannot see.',
          "2. **A claim's own range is not evidence for that claim.** The line a claim points at is what the claim is",
          '   about, not a reason to disbelieve it: quoting it says the code is the code. The quote has to be a line',
          '   **outside** the range printed under that claim.',
          '3. The quote must be one of the lines above, copied exactly. A quote that is not on an added line, or that is',
          '   only inside the claim it attacks, is not a refutation, and the claim stays.',
          '4. You may not rewrite a claim, re-anchor it, or lower its severity. A claim is either refuted by a quoted',
          '   line or kept as it was written.',
        ];
  return [
    `Contract: ${contract}.`,
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
    contract !== FALSIFIER_CONTRACTS.v2
      ? 'Question: which of these claims does one of the added lines directly contradict?'
      : "Question: which of these claims does one of the added lines outside the claim's own range directly contradict?",
    '',
    "Answer with the claim's number and the exact text of the line that contradicts it, copied character for character",
    'from the list above. If no added line contradicts a claim, do not mention it - a claim you cannot refute is kept.',
    '',
    ...rules,
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
  private readonly contract: FalsifierContract;

  constructor(
    provider: LLMProvider,
    options: { timeout?: number; contract?: FalsifierContract } = {},
  ) {
    this.provider = provider;
    this.timeout = options.timeout;
    this.contract = options.contract ?? FALSIFIER_CONTRACTS.v1;
  }

  /** Run the gate over one file's claims. */
  async gate(request: FalsifierRequest): Promise<FalsifierOutcome> {
    const contract = request.contract ?? this.contract;
    const report: FalsifierReport = {
      candidates: request.findings.length,
      dropped: 0,
      keptBecauseQuoteMissing: 0,
      keptBecauseSelfReferential: 0,
      contract,
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

    const prompt = buildFalsifierPrompt({ ...request, addedLines, contract });
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

    // **The lines the reader was allowed to quote**, in comparison form and carrying the number they were shown, so a
    // quote is checked against what it saw rather than against the whole file's added lines beyond the budget - and so
    // that a removal can say *which* line it stood on.
    const quotable = addedLines
      .slice(0, renderLines(addedLines).shown)
      .map((line) => ({ line: line.line, text: compareForm(line.text) }));

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
      const matches =
        quote.length < FALSIFIER_MIN_QUOTE
          ? []
          : quotable.filter((line) => line.text.includes(quote));
      if (matches.length === 0) {
        report.keptBecauseQuoteMissing += 1;
        continue;
      }

      // **`v2`: the claim's own range is not evidence for the claim.** The test is existential - if *any* line carrying
      // that text lies outside the range, the reader has quoted evidence that survives the subtraction - and a quote
      // whose every match is inside the claim is the tautology §74 found, so it keeps the claim and is counted.
      const claim = request.findings[at]!;
      const usable =
        contract !== FALSIFIER_CONTRACTS.v2
          ? matches
          : matches.filter((line) => line.line < claim.startLine || line.line > claim.endLine);
      if (usable.length === 0) {
        report.keptBecauseSelfReferential += 1;
        continue;
      }

      droppedAt.set(at, {
        finding: claim,
        claimIndex: at + 1,
        quoteLine: usable[0]!.line,
        quote: refutation.quote,
        reason: refutation.reason,
      });
    }

    report.dropped = droppedAt.size;
    const kept = request.findings.filter((_finding, at) => !droppedAt.has(at));
    return { kept: [...kept], dropped: [...droppedAt.values()], report };
  }
}
