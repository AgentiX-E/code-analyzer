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
  v3: 'independent-evidence-v3',
  /**
   * **The same evidence rule as `v3`, but the second block is an index extract rather than a window.**
   *
   * §78 bought its second block with 6 000 characters of surrounding lines and returned −0.0022: **a window shows a
   * reader the lines around a change without saying what those lines belong to.** `v4` shows the file's export surface,
   * the declaration each claim stands in and the guards inside it - 600 characters, a tenth of the window, and the only
   * part of the file that can be about the claim.
   */
  v4: 'independent-evidence-v4',
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
 * **How many characters of the file's untouched lines one call may carry.**
 *
 * Half the block the hunk gets, because the surrounding lines are context rather than the thing under review: **a
 * contract that spends more on the file than on the change has inverted what the reader is being asked about**, and the
 * context-dump reviewers report 60-80 % of their findings as false for exactly that reason.
 */
export const FALSIFIER_CONTEXT_BUDGET = 6_000;

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
  /**
   * **The lines around each claim that this change did not touch, when the caller has them.**
   *
   * `v2` ran out of material rather than out of judgement: on 146 pull requests it removed 169 claims and left 148
   * behind because the only line the reader could quote lay inside the claim's own range. **A hunk of three lines
   * carries no independent evidence about those three lines**, so the contract that asks for independent evidence needs
   * a second place to look - and the file is that place.
   *
   * **`null` is a `v2` run, not a broken one.** A caller that cannot produce the surrounding text still gets a gate; it
   * gets the gate that keeps everything it cannot refute, which is the direction this device has always been allowed to
   * fail in.
   */
  surrounding?: ReadonlyArray<NumberedAddedLine> | null;
  /**
   * **The file as structure, when the caller built an index instead of a window** (`v4`).
   *
   * `text` is what the prompt carries and `shown` is what a quote may be verified against; they are returned together by
   * `selectIndexedContext` because two derivations of "which lines did the reader see" is the defect `renderLines`'s
   * `shown` field exists to prevent.
   *
   * **Empty is a `v3` run rather than a broken one.** A caller with no index still gets a gate, and it gets the gate
   * whose second block is the window - the direction this device is always allowed to fail in.
   */
  indexed?: { readonly text: string; readonly shown: ReadonlyArray<NumberedAddedLine> } | null;
  /**
   * **The new-side line numbers this change actually touched, when the caller computed them.**
   *
   * `change-shape` decides from the diff which hunks are `reformatted`, `comment-only` or `moved`; what it leaves is the
   * set of lines a compiler would see as new. **A finding standing entirely outside that set is a finding about code the
   * pull request did not change**, and the gate can say so without spending a call - which is the only way a review of a
   * 24-file pull request gets cheaper rather than merely better.
   *
   * **The set is the change's *standing* surface, not its *written* lines.** They were the same thing in the first
   * reading of this device and the difference cost three true positives: a hunk that only deleted wrote no line, so the
   * written-lines set was empty and the gate refuted every finding about the removal. `classifyPatch(...).allowedLines`
   * includes the deletion point and the hunk's own span; a substantive hunk therefore never contributes nothing.
   *
   * **Absent is not empty.** `undefined`/`null` means the caller made no decision and the gate behaves exactly as it did
   * before this field existed; an **empty set means the file has no substantive hunk at all** - a pure reformat, or a
   * relocation - and a review of it has nothing to say. The two are kept apart because collapsing them would make a pure
   * reformat the one file the gate cannot see, and because the two ways of being untouched are priced differently.
   */
  touchedLines?: ReadonlySet<number> | null;
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
  /**
   * **Claims removed because no line of them was a line this change touched.**
   *
   * Kept apart from `dropped` for the same reason `keptBecauseSelfReferential` is kept apart from
   * `keptBecauseQuoteMissing`: the two removals are different devices with the same effect on F1. One is the reader
   * refuting a sentence; the other is the diff saying the sentence was never about this change - **and only the second
   * costs nothing.**
   */
  droppedBecauseUntouched: number;
  /**
   * **And the two ways of being untouched, counted apart.**
   *
   * `wholeFile` is a file whose every hunk was a reformat, a comment edit or a relocation: the finding was about a file
   * this pull request did not change in any way a compiler sees. `offTheChange` is a file that did change, at a
   * distance from the finding. **They are different claims about the corpus** - one says the pull request touched a
   * file to no purpose, the other says a reader wandered - and a single total cannot tell an iteration which of the two
   * it removed.
   */
  untouchedFrom: { wholeFile: number; offTheChange: number };
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
function renderLines(
  lines: ReadonlyArray<NumberedAddedLine>,
  budget: number = FALSIFIER_CODE_BUDGET,
): {
  body: string;
  shown: number;
} {
  const rendered: string[] = [];
  let used = 0;
  for (const line of lines) {
    const one = `${line.line}| ${line.text}\n`;
    if (used + one.length > budget) break;
    rendered.push(one);
    used += one.length;
  }
  return { body: rendered.join(''), shown: rendered.length };
}

/**
 * **The lines around each claim that the change did not touch, in the file's own numbering.**
 *
 * **A window, not a file.** Three sources agree that handing a reviewer the whole of a large file costs precision rather
 * than buying it: `arXiv 2411.03079` derives a precise and complete slice before asking a model, `arXiv 2610.36010`
 * verifies a claim by intervening on the code it names, and the field's context-dump reviewers report 60-80 % of their
 * findings as false. **So each claim gets `radius` lines either side of it, the windows are merged, and the result is
 * capped at `budget` lines by distance to the nearest claim** - the nearest lines win, because the line that refutes a
 * claim is almost never two hundred lines away.
 *
 * **The added lines are excluded rather than deduplicated by text.** A line the hunk already showed has one number, and
 * printing it twice under two headings would let a reader quote line 23 as if it were line 41.
 */
export function selectSurrounding(request: {
  fileText: string;
  findings: ReadonlyArray<LLMFinding>;
  addedLines: ReadonlyArray<NumberedAddedLine> | null;
  radius?: number;
  budget?: number;
}): NumberedAddedLine[] {
  const radius = Math.max(0, Math.trunc(Number(request.radius ?? 40)));
  const budget = Math.max(1, Math.trunc(Number(request.budget ?? 200)));
  const lines = String(request.fileText ?? '').split('\n');
  const added = new Set((request.addedLines ?? []).map((line) => line.line));

  const distance = new Map<number, number>();
  for (const claim of request.findings) {
    const from = Math.max(1, claim.startLine - radius);
    const to = Math.min(lines.length, claim.endLine + radius);
    for (let at = from; at <= to; at += 1) {
      if (added.has(at)) continue;
      const away =
        at < claim.startLine ? claim.startLine - at : at > claim.endLine ? at - claim.endLine : 0;
      const seen = distance.get(at);
      if (seen === undefined || away < seen) distance.set(at, away);
    }
  }

  const chosen = [...distance.entries()]
    .sort((left, right) => left[1] - right[1] || left[0] - right[0])
    .slice(0, budget)
    .map(([line]) => line)
    .sort((left, right) => left - right);

  return chosen.map((line) => ({ line, text: lines[line - 1] ?? '' }));
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
      if (contract === FALSIFIER_CONTRACTS.v1) return head;
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
  // **The surrounding block exists only under `v3`, and only when the caller could produce it.** A `v2` prompt is
  // byte-for-byte what it was, so every figure §74 measured stays reproducible from the code that measured it.
  /**
   * **The second block, which is a window under `v3` and an index extract under `v4`.**
   *
   * `v4` prefers the index because it is the cheaper of the two by an order of magnitude - 600 characters against
   * 6 000 - and falls back to the window when the caller built none, so a run without an index still reaches the
   * evidence rule it was dispatched under.
   */
  const secondary: { title: string; body: string } | null =
    contract === FALSIFIER_CONTRACTS.v4 && (request.indexed?.shown.length ?? 0) > 0
      ? {
          title:
            "The file as an index: what it exports, the declaration each claim stands in, and the guards inside it - the file's own numbers:",
          body: request.indexed?.text ?? '',
        }
      : (contract === FALSIFIER_CONTRACTS.v3 || contract === FALSIFIER_CONTRACTS.v4) &&
          (request.surrounding?.length ?? 0) > 0
        ? {
            title:
              "The surrounding lines of the same file, which this change did not touch - the file's own numbers:",
            body: renderLines(request.surrounding ?? [], FALSIFIER_CONTEXT_BUDGET).body,
          }
        : null;
  const claims = renderClaims(request.findings, contract);
  const rules =
    contract === FALSIFIER_CONTRACTS.v3 || contract === FALSIFIER_CONTRACTS.v4
      ? [
          'Four rules, and they are the whole contract:',
          '',
          secondary === null
            ? '1. **Only the added lines above are evidence.** No second block was available for this file.'
            : '1. **Two blocks are evidence: the added lines, and the block below them.** Code in neither block is not',
          secondary === null ? '' : '   evidence, and neither is code you cannot see.',
          "2. **A claim's own range is not evidence for that claim.** The line a claim points at is what the claim is",
          '   about, not a reason to disbelieve it: quoting it says the code is the code. The quote has to be a line',
          '   **outside** the range printed under that claim.',
          "3. The quote must be one of the lines in either block, copied exactly, and its number is the file's own number.",
          '   A quote that is not on one of those lines, or that is only inside the claim it attacks, is not a',
          '   refutation, and the claim stays.',
          '4. You may not rewrite a claim, re-anchor it, or lower its severity. A claim is either refuted by a quoted',
          '   line or kept as it was written.',
        ]
      : contract === FALSIFIER_CONTRACTS.v2
        ? [
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
          ]
        : [
            'Three rules, and they are the whole contract:',
            '',
            '1. Only the added lines above are evidence. Code this change did not touch is not evidence, and neither is',
            '   code you cannot see.',
            '2. The quote must be one of the lines above, copied exactly. A quote that is not on an added line is not a',
            '   refutation, and the claim stays.',
            '3. You may not rewrite a claim, re-anchor it, or lower its severity. A claim is either refuted by a quoted',
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
    ...(secondary === null ? [] : [secondary.title, secondary.body.trimEnd(), '']),
    'The claims:',
    claims.body,
    '',
    contract === FALSIFIER_CONTRACTS.v3 || contract === FALSIFIER_CONTRACTS.v4
      ? "Question: which of these claims does a line in either block, outside the claim's own range, directly contradict?"
      : contract === FALSIFIER_CONTRACTS.v2
        ? "Question: which of these claims does one of the added lines outside the claim's own range directly contradict?"
        : 'Question: which of these claims does one of the added lines directly contradict?',
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
      droppedBecauseUntouched: 0,
      untouchedFrom: { wholeFile: 0, offTheChange: 0 },
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

    // **The diff's verdict, taken before the reader is paid to have one.** A finding whose every line lies outside the
    // set the change touched is refuted by the patch itself: there is no question to ask, and asking it is how a gate
    // spends money to be told about code the pull request did not write. **The test is existential** - one line inside
    // the set is enough, because a finding that spans the change is a finding about the change.
    const touched = request.touchedLines ?? null;
    const shapeDropped = new Map<number, FalsifierDrop>();
    let askedFindings: ReadonlyArray<LLMFinding> = request.findings;
    if (touched !== null) {
      // **Which way of being untouched this file is**, decided once rather than per finding: an empty set means the
      // file has no substantive hunk, and every finding in it is equally unmoored.
      const where = touched.size === 0 ? 'wholeFile' : 'offTheChange';
      const survivors: LLMFinding[] = [];
      request.findings.forEach((candidate, at) => {
        const from = Math.min(candidate.startLine, candidate.endLine);
        const to = Math.max(candidate.startLine, candidate.endLine);
        let stands = false;
        for (let line = from; line <= to; line += 1) {
          if (touched.has(line)) {
            stands = true;
            break;
          }
        }
        if (stands) {
          survivors.push(candidate);
          return;
        }
        shapeDropped.set(at, {
          finding: candidate,
          claimIndex: at + 1,
          quoteLine: candidate.startLine,
          quote: '',
          reason:
            where === 'wholeFile'
              ? 'The file this finding is about changed no line a compiler sees, so the patch refutes it unread.'
              : 'The finding stands on no line this change touched, so the patch refutes it unread.',
        });
      });
      askedFindings = survivors;
      report.droppedBecauseUntouched = shapeDropped.size;
      report.untouchedFrom[where] = shapeDropped.size;
    }

    // **Every claim was refuted by the diff.** No call, and the outcome says which device removed them.
    if (askedFindings.length === 0) {
      report.dropped = shapeDropped.size;
      return {
        kept: request.findings.filter((_finding, at) => !shapeDropped.has(at)),
        dropped: [...shapeDropped.values()],
        report,
      };
    }

    const asked = Math.min(askedFindings.length, FALSIFIER_MAX_CLAIMS);
    report.notAsked = askedFindings.length - asked;

    const prompt = buildFalsifierPrompt({
      ...request,
      findings: askedFindings,
      addedLines,
      contract,
    });
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
      report.dropped = shapeDropped.size;
      return {
        kept: [...askedFindings],
        dropped: [...shapeDropped.values()],
        report,
      };
    }
    report.calls = 1;

    const read = readFalsifierAnswer(raw);
    if (read.kind === 'unreadable') {
      report.unreadable = 1;
      report.dropped = shapeDropped.size;
      return {
        kept: [...askedFindings],
        dropped: [...shapeDropped.values()],
        report,
      };
    }

    // **The lines the reader was allowed to quote**, in comparison form and carrying the number they were shown, so a
    // quote is checked against what it saw rather than against the whole file's added lines beyond the budget - and so
    // that a removal can say *which* line it stood on.
    const quotable = [
      ...addedLines
        .slice(0, renderLines(addedLines).shown)
        .map((line) => ({ line: line.line, text: compareForm(line.text) })),
      // **The file's own lines, shown under `v3`, are quotable too** - and they are the only lines that can refute a
      // claim whose hunk carries no independent evidence, which is 148 of the 183 `v2` left behind on 146 pull requests.
      ...(contract === FALSIFIER_CONTRACTS.v4 && (request.indexed?.shown.length ?? 0) > 0
        ? (request.indexed?.shown ?? []).map((line) => ({
            line: line.line,
            text: compareForm(line.text),
          }))
        : contract === FALSIFIER_CONTRACTS.v3 || contract === FALSIFIER_CONTRACTS.v4
          ? (request.surrounding ?? [])
              .slice(0, renderLines(request.surrounding ?? [], FALSIFIER_CONTEXT_BUDGET).shown)
              .map((line) => ({ line: line.line, text: compareForm(line.text) }))
          : []),
    ];

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
      const claim = askedFindings[at]!;
      const usable =
        contract === FALSIFIER_CONTRACTS.v1
          ? matches
          : matches.filter((line) => line.line < claim.startLine || line.line > claim.endLine);
      if (usable.length === 0) {
        report.keptBecauseSelfReferential += 1;
        continue;
      }

      droppedAt.set(request.findings.indexOf(claim), {
        finding: claim,
        claimIndex: request.findings.indexOf(claim) + 1,
        quoteLine: usable[0]!.line,
        quote: refutation.quote,
        reason: refutation.reason,
      });
    }

    report.dropped = droppedAt.size + shapeDropped.size;
    const kept = request.findings.filter(
      (_finding, at) => !droppedAt.has(at) && !shapeDropped.has(at),
    );
    return { kept: [...kept], dropped: [...shapeDropped.values(), ...droppedAt.values()], report };
  }
}
