// @code-analyzer/intelligence — Evidence anchored to the lines a finding is about
//
// **A review comment is worth reading when it points at the code it is about, and the engine knew the lines all along
// without ever carrying their text.** `weighFinding` composes `finding.snippet ?? ''` (`actionability.ts`), while the
// pipeline resolved a snippet only for the posting side (`llm-review-pipeline.ts`) and never wrote it back onto the
// finding - so the scorer saw an empty field and the quotation term could fire only when the model happened to paste a
// line into prose. **Measured on the published AACR artifact: 48 of 591 findings quoted the change they were about.**
//
// **The obvious fix would have made the score circular.** Copying the diff's lines into `snippet` makes "did this review
// quote the change" true by construction, which converts a measurement of the reviewer into a measurement of this file.
// So the text is marked `snippetSource: 'diff'` and `weighFinding` reads model-authored text only - which is also why
// every published score is reproduced to the digit rather than approximately (see the note on `SnippetSource`).
//
// **What the anchor buys that the score does not.** A reader gets the code inline instead of a line number; an auditor
// gets file, range, commit and the name of the resolver; and a release gets a rate - *how many comments can quote the
// line they are about* - which is a product number the ranking never showed.

import type { DiffFacts } from './actionability.js';
import type { FindingEvidence, LLMFinding, SnippetSource } from './llm/prompts.js';

/** The one resolver name written into every anchor, so an audit can name the rule that produced the text. */
export const EVIDENCE_EXTRACTOR = 'review/evidence.addedTextAt';

/**
 * **A line number the engine is willing to point at, or `null`.**
 *
 * Three shapes are refused and each has a reason rather than a preference. **A fraction** cannot be a line.
 * **A missing or non-finite number** is a finding that named no place, and inventing line 1 for it would file the
 * comment against code nobody was talking about. **A zero or negative line** is the model counting from the wrong end,
 * which the ingest path already counts as `invalidLine` - and a resolver that quietly repairs it would make two
 * components disagree about how many findings were broken.
 */
function usableLine(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/**
 * **The text the pull request added inside a range, or `null` when it added nothing there.**
 *
 * **Only added lines count, and that is the whole point of the function.** A finding about a context line is a finding
 * about code the change did not touch; quoting it as evidence would let a review claim it is about the change while
 * pointing at something that was already there. **The empty answer is the honest one**, and the caller counts it.
 *
 * **The range is normalised rather than rejected.** `weighFinding` already normalises an inverted range before asking
 * whether it is grounded, and an evidence resolver that answered a different question than the grounding check would
 * make the two disagree on exactly the findings that are malformed.
 */
export function addedTextAt(
  facts: DiffFacts,
  path: string,
  startLine: number,
  endLine: number,
): string | null {
  if (!usableLine(startLine) || !usableLine(endLine)) return null;

  const added = facts.added.get(path);
  if (added === undefined || added.size === 0) return null;

  const from = Math.min(startLine, endLine);
  const to = Math.max(startLine, endLine);

  // **Sorted because a `Map` remembers insertion order and the diff is what decides it** - and a reader comparing two
  // runs of the same pull request must not see the lines of one comment in a different order in the other.
  const lines: string[] = [];
  for (const line of [...added.keys()].sort((a, b) => a - b)) {
    if (line < from || line > to) continue;
    lines.push(added.get(line) as string);
  }
  return lines.length === 0 ? null : lines.join('\n');
}

/** One finding and the path its line numbers belong to, which is the same pair the scorer is given. */
export interface LocatedFindingLike {
  readonly finding: LLMFinding;
  readonly path: string;
}

/** Where the anchor's provenance comes from: the caller that owns the diff knows the revision, this file does not. */
export interface EvidenceOrigin {
  /** The revision the diff was read at, as the diff names it. */
  readonly commit: string;
  /** The module that produced the finding, so a repair and a first reading are distinguishable later. */
  readonly extractor: string;
}

/**
 * **Resolve a finding's lines to text without touching the finding.**
 *
 * Pure on purpose: the caller decides whether to attach, which keeps the decision - *do we anchor findings at all* -
 * visible at the call site rather than buried in a resolver.
 *
 * **A model-authored snippet is not evidence of the change.** If the model wrote a quotation the finding keeps it, and
 * the anchor is still resolved from the diff, because the question "which lines is this about" has the same answer no
 * matter who wrote the quotation. `text` therefore describes the change, never the model's choice of words.
 */
export function evidenceFor(
  located: LocatedFindingLike,
  facts: DiffFacts,
  origin: EvidenceOrigin,
): FindingEvidence | null {
  const { finding, path } = located;
  const text = addedTextAt(facts, path, finding.startLine, finding.endLine);
  if (text === null) return null;

  const startLine = Math.min(finding.startLine, finding.endLine);
  const endLine = Math.max(finding.startLine, finding.endLine);
  return {
    file: path,
    startLine,
    endLine,
    text,
    commit: origin.commit,
    extractor: origin.extractor,
  };
}

/**
 * **Attach the anchor, in place, and report whether the finding now carries the lines it is about.**
 *
 * **Why this mutates when almost everything around it does not.** Finding identity is load-bearing in three places at
 * the call site: the pull-request budget filters `result.findings` by object identity, the rank order is a
 * `Map<LLMFinding, number>`, and the capped count is computed from the same objects. **A pure version that returned new
 * objects would silently detach every one of them** - the budget would keep a set of findings nothing points at, and the
 * review would ship empty. The alternative was rewriting three call sites to thread identity, which is a larger change
 * than the defect being fixed.
 *
 * A snippet the model wrote is kept and marked `'model'`: **overwriting it would destroy the only quotation the scorer
 * is allowed to read**, and the score would then measure this module instead of the reviewer.
 */
export function attachEvidence(
  located: LocatedFindingLike,
  facts: DiffFacts,
  origin: EvidenceOrigin,
): boolean {
  const { finding } = located;
  const evidence = evidenceFor(located, facts, origin);

  if (finding.snippet === undefined && evidence !== null) {
    finding.snippet = evidence.text;
    finding.snippetSource = 'diff';
  } else if (finding.snippet !== undefined && finding.snippetSource === undefined) {
    // **A snippet that predates the distinction came from the model**, because nothing else could have written it.
    finding.snippetSource = 'model' satisfies SnippetSource;
  }

  if (evidence === null) return false;
  finding.evidence = evidence;
  return true;
}
