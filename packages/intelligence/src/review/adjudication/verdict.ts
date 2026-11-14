// @code-analyzer/intelligence — reading the second reader's answer
//
// **What this file is for.** The adjudicator is one model call per candidate finding, and its answer is the difference
// between a comment that reaches a pull request and one that does not. **A parser for that answer is therefore not
// plumbing**: a verdict read as `upheld` when it said `refuted` files a comment the reviewer itself rejected, and a
// verdict read as `refuted` when the response was malformed silently deletes a true positive.
//
// **So the three failure modes are kept apart rather than collapsed into "no finding".**
//
//   1. **`upheld`** - the claim holds. The comment is filed, anchored where the verdict says.
//   2. **`refuted`** - the claim does not hold, or is not a claim. The comment is dropped, and the reason travels with
//      it so a report can say *why* rather than only how many.
//   3. **`unreadable`** - the response could not be parsed. **This is not a refutation**, and the caller decides: a
//      provider that returns prose for every call would otherwise be indistinguishable from a reviewer that refuted
//      everything, and the two have opposite repairs.
//
// **`repaired` is the fourth and the one that can raise recall.** A comment can stand on exactly the line a golden
// sits on and describe a different problem - 141 of this corpus's 452 goldens were missed that way, at distance zero -
// and the only fix for that is to say the right thing at the right line, not to say nothing. **A repair is therefore
// held to a stricter contract than a new finding**: it must name the defect, not the fix, and it must be anchored
// inside the lines the original comment was about. A repair that wanders is an invention.

import type { LLMFinding } from '../llm/prompts.js';

/** The three verdicts, as a value, so a schema and a validator cannot drift apart. */
export const ADJUDICATION_VERDICTS = ['upheld', 'refuted', 'repaired'] as const;

export type AdjudicationVerdictName = (typeof ADJUDICATION_VERDICTS)[number];

/** One answer from the second reader, as parsed and not yet applied. */
export interface AdjudicationVerdict {
  verdict: AdjudicationVerdictName;
  /**
   * **The single line the comment is about, as the second reader read it**, or `null` when it did not say.
   *
   * A line rather than a range because the question asked is *"which line decides this?"* - and **a range returned to
   * a caller that asked for a line is a range somebody will compare against a hunk boundary it was never about.**
   */
  line: number | null;
  /** One sentence. For `refuted` and `repaired` it has to cite the code that decides it. */
  reason: string;
  /** Only meaningful for `repaired`: the defect actually present, named as a failure. */
  repair: {
    title: string;
    description: string;
    severity?: string;
    category?: string;
    suggestion?: string | null;
  } | null;
}

/** What a parse produced, with the unreadable case kept distinct from the refuted one. */
export type AdjudicationRead =
  { kind: 'verdict'; verdict: AdjudicationVerdict } | { kind: 'unreadable'; why: string };

/** Strip the code fence a model puts around JSON when it was told not to. */
function unfence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) return trimmed;
  const body = trimmed.slice(firstNewline + 1);
  return body.endsWith('```') ? body.slice(0, -3).trim() : body.trim();
}

/**
 * **A string field, or the empty string - and only from a value that is already a string or a finite number.**
 *
 * `String(record['verdict'])` on an object yields `"[object Object]"`, which then fails the vocabulary check and is
 * reported as `unreadable` for the right reason but by accident. **Reading only the two types a provider actually sends
 * makes the refusal deliberate** - and it is the difference between a parser that refuses a malformed answer and one
 * that refuses it for a reason nobody chose.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** A line number, or `null` - never zero, for the reason `golden-attribution.mjs` learned the hard way. */
function toLine(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

/**
 * **Read one answer.**
 *
 * The validation is strict on purpose and permissive in exactly one place: **`refuted` is accepted without a reason,
 * because refusing it would file the comment**, and a dropped comment is the failure this repository can afford while
 * a filed invention is the one it cannot. Everything else - a missing title on a repair, an unknown verdict - is
 * `unreadable` rather than a silent default, because a default here is a decision nobody made.
 */
export function readAdjudication(raw: string): AdjudicationRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(String(raw ?? '')));
  } catch {
    return { kind: 'unreadable', why: 'the response is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object')
    return { kind: 'unreadable', why: 'the response is not an object' };

  const record = parsed as Record<string, unknown>;
  const name = text(record['verdict']).toLowerCase();
  if (!(ADJUDICATION_VERDICTS as ReadonlyArray<string>).includes(name))
    return {
      kind: 'unreadable',
      why: `verdict "${text(record['verdict'])}" is not one of the three`,
    };

  const verdict = name as AdjudicationVerdictName;
  const reason = text(record['reason']).trim();
  const line = toLine(record['line']);

  if (verdict !== 'repaired')
    return { kind: 'verdict', verdict: { verdict, line, reason, repair: null } };

  const title = text(record['title']).trim();
  const description = text(record['description']).trim();
  // **A repair with no sentence is a refutation wearing a promotion.** It would replace a comment that at least said
  // something with one that says nothing, which is the one outcome strictly worse than dropping it.
  if (title === '' || description === '')
    return { kind: 'unreadable', why: 'a repair carries no title or no description' };

  return {
    kind: 'verdict',
    verdict: {
      verdict,
      line,
      reason,
      repair: {
        title,
        description,
        severity: typeof record['severity'] === 'string' ? record['severity'] : undefined,
        category: typeof record['category'] === 'string' ? record['category'] : undefined,
        suggestion: typeof record['suggestion'] === 'string' ? record['suggestion'] : null,
      },
    },
  };
}

/** Where a comment may be filed, given what the diff added. */
export interface Anchor {
  startLine: number;
  endLine: number;
}

/**
 * **Decide the range a comment is filed on, or refuse to file it.**
 *
 * Three cases, in the order a reviewer would read them:
 *
 *   1. **The verdict named a line the diff added.** That line is the anchor, because *the second reader read the code
 *      and chose it*. A one-line range rather than a guess at the surrounding construct.
 *   2. **It named a line outside the added lines, but the original range does overlap them.** The overlap is kept: a
 *      comment about a construct that starts on context lines and continues into added ones is about the added ones.
 *   3. **Neither.** The comment cannot be filed. **This is a real outcome and is counted**, because a reviewer whose
 *      second reader keeps proposing lines the diff never touched is a reviewer with a prompt defect, and a count is
 *      how that becomes visible instead of being absorbed into "precision".
 *
 * `addedLines` is the union of the new-side ranges of every hunk, or **`null` when the caller could not derive them** -
 * a code window is not a patch, and **an empty set would then mean "the diff added nothing" and refuse every comment in
 * the review.** `null` therefore means *no constraint*, and the third case below is reached only when a set was
 * supplied and the comment falls outside it.
 *
 * **It is a set rather than a predicate** so that a caller cannot accidentally ask "is this line added" with a
 * different definition than the one the count used.
 */
export function resolveAnchor(
  verdictLine: number | null,
  original: { startLine: number; endLine: number },
  addedLines: ReadonlySet<number> | null,
): Anchor | null {
  // **No constraint derivable: the comment is filed where the reader put it.** Falling back to the original range
  // rather than to the verdict's line, because a range the reviewer produced against the file is the one coordinate
  // pair in the whole exchange that was never in doubt.
  if (addedLines === null) {
    if (verdictLine !== null) return { startLine: verdictLine, endLine: verdictLine };
    if (original.startLine > 0 && original.endLine > 0)
      return { startLine: original.startLine, endLine: original.endLine };
    return null;
  }

  if (addedLines.size === 0) return null;

  if (verdictLine !== null && addedLines.has(verdictLine))
    return { startLine: verdictLine, endLine: verdictLine };

  const low = Math.min(original.startLine, original.endLine);
  const high = Math.max(original.startLine, original.endLine);
  const overlapping: number[] = [];
  for (let line = low; line <= high; line += 1) if (addedLines.has(line)) overlapping.push(line);
  if (overlapping.length === 0) return null;
  return { startLine: overlapping[0]!, endLine: overlapping[overlapping.length - 1]! };
}

/** What applying a verdict did, so a caller can rebuild a result list without re-deriving the decision. */
export type AppliedVerdict =
  | { kind: 'kept'; finding: LLMFinding; anchored: boolean }
  | { kind: 'dropped'; why: 'refuted' | 'unanchored'; reason: string };

/**
 * **Turn a verdict and a candidate into the finding that is filed, or into the reason it is not.**
 *
 * **The original finding survives an `upheld` unchanged except for its range**, and that is a decision rather than an
 * omission: the second reader was asked whether the claim holds, not to rewrite it, so a rewrite on `upheld` would be
 * a second opinion nobody asked for and would make the two verdicts do the same thing.
 *
 * **A `repaired` finding keeps the lane it came from.** The lane is how a report attributes a figure to a reviewer, and
 * a repair is the same reviewer's finding with a better sentence - attributing it to the second reader would double
 * count the same defect across two lanes and break the per-lane tables.
 */
export function applyVerdict(
  candidate: LLMFinding,
  verdict: AdjudicationVerdict | null,
  addedLines: ReadonlySet<number> | null,
): AppliedVerdict {
  // **A missing verdict is a refutation, and it says so.** The caller only omits the verdict when the provider failed,
  // and the honest reading of "no answer" is "no claim was established" - the alternative files an unchecked comment.
  if (verdict === null)
    return { kind: 'dropped', why: 'refuted', reason: 'the second reader returned no verdict' };
  if (verdict.verdict === 'refuted')
    return {
      kind: 'dropped',
      why: 'refuted',
      reason: verdict.reason || 'refuted without a reason',
    };

  const anchor = resolveAnchor(
    verdict.line,
    { startLine: candidate.startLine, endLine: candidate.endLine },
    addedLines,
  );
  if (anchor === null)
    return {
      kind: 'dropped',
      why: 'unanchored',
      reason: 'no line of this comment is a line the diff added',
    };

  if (verdict.verdict === 'upheld') {
    const anchored =
      anchor.startLine !== candidate.startLine || anchor.endLine !== candidate.endLine;
    return {
      kind: 'kept',
      anchored,
      finding: { ...candidate, startLine: anchor.startLine, endLine: anchor.endLine },
    };
  }

  const repair = verdict.repair!;
  return {
    kind: 'kept',
    anchored: true,
    finding: {
      ...candidate,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      title: repair.title,
      description: repair.description,
      // **A repair that does not say what it is is a repair that did not happen.** The fields are optional in the
      // answer because the second reader is not always sure, and the original's value stands when it does not answer.
      severity: (repair.severity ?? candidate.severity) as LLMFinding['severity'],
      category: (repair.category ?? candidate.category) as LLMFinding['category'],
      suggestion: repair.suggestion ?? candidate.suggestion,
      // **The lane, kept for the reason above** - and the fact that this finding was repaired is carried instead, so
      // the provenance is not lost.
      repaired: true,
    },
  };
}
