// Dropping findings that cannot be grounded, before anyone reads them.
//
// **The capability the field's leader has and this product did not.** CodeRabbit's pipeline runs *"a separate judge
// model that drops findings it cannot ground"*, and the competitive analysis records it as the reason their precision
// holds up. **Ours does not hold up: the review protocol scores precision 0.00** - one comment emitted and it was
// wrong.
//
// > *"A symbol that changed and is only used inside the diff is usually fine; a symbol that changed and is used at
// > four sites the author never opened is where the defects live."*
//
// **That sentence is about findings being real.** A comment on a line that does not exist, about code that is not
// there, is worse than no comment: **it costs the reader the time to check and teaches them to skip the tool.**
//
// **`ReviewComment` already has a `filtered: boolean` field and nothing wrote it** - the same shape as the empty
// `docstring`, the unproduced `CALLS` edge and the unread `changedFiles`. **This is the thing that field was for.**
//
// **The literature this follows, found by searching rather than by guessing.** *Refute-or-Promote* (arXiv 2604.19049)
// reports **~79% of candidates killed** before disclosure and **one case where ten reviewers unanimously endorsed a
// bug that did not exist**, killed only by an empirical test - **the argument for a gate that requires evidence
// rather than agreement.** QASecClaw (arXiv 2605.01885) takes a scanner from **F1 78.39% to 90.93%** by cutting false
// positives **88.6%** while losing **3.1%** of recall, which is the shape a filter should have. And *Sifting the
// Noise* (arXiv 2601.22952) is the warning: aggressive filtering **suppressed 22% of true vulnerabilities**, so
// **every check below is written to drop only what is decidable.**
//
// **And "grounded" is defined narrowly here, on purpose.** Four checks, each of which can be decided from the file
// and the ranges, and **none of which claims to judge whether the finding is correct** - that needs the judge model
// the analysis describes and this does not have. **What it can do is drop the ones that are provably about nothing.**

import type { ReviewComment } from '@code-analyzer/shared';

/**
 * **The five things a finding has to carry for any of this to be decidable.**
 *
 * **Structural rather than nominal, and that is the point of writing it down.** The checks below need a path, a range and
 * (when the finding offers one) a quotation; they need **nothing else about the finding**, so a reviewer that emits
 * `ReviewComment`s and a command that emits `PrReviewFinding`s can be held to one rule instead of two. **Two copies of
 * this rule is how a harness and a product come to disagree about which findings exist**, which is the defect §130 was
 * written about - a score computed from a filter the product did not apply.
 */
export interface GroundableFinding {
  /** Repository-relative path, spelled the way the review reads it. */
  path: string;
  startLine: number;
  endLine: number;
  /** The code the finding quotes, when it quotes any. Absent is not evidence of absence. */
  existingCode?: string;
  /** The sentence the reader sees. Used only for the backticked-name check. */
  content?: string;
  suggestionCode?: string;
  /** Set to `false` on everything that survives, so a downstream reader can tell checked from unchecked. */
  filtered?: boolean;
}

/** Why a comment was dropped. */
export interface GroundingVerdict<T extends GroundableFinding = ReviewComment> {
  comment: T;
  grounded: boolean;
  /** The first check that failed, so a reader can disagree with the rule rather than the verdict. */
  reason: string | null;
}

export interface GroundingReport<T extends GroundableFinding = ReviewComment> {
  /**
   * **`T & { filtered: boolean }`, not `T`**, because the field is written here and a report that claimed to return the
   * input type would make the one fact this function adds invisible to its own callers.
   */
  grounded: Array<T & { filtered: boolean }>;
  /** Kept for reporting, and **not emitted** - the caller decides what to do with them. */
  ungrounded: Array<GroundingVerdict<T>>;
  /**
   * **Findings the revision cannot carry at all**, kept apart from `ungrounded` because they are a different fact.
   *
   * A comment on a file the pull request *deleted* is not a comment about something that does not exist - the code existed,
   * the change removed it, and the finding is about the removal. **It cannot be posted**, because there is no line in the
   * new revision to attach it to, and that is a limit of the medium rather than a verdict about the sentence.
   *
   * **Why the distinction is load-bearing.** §149.5 measured the old rule swallowing a whole pull request: one path absent
   * at head out of 28 findings made the gate inert for all 28, so 27 judgeable findings went unjudged. **A deleted file is
   * not a file the run failed to read**, and a rule that cannot tell them apart charges the gate with a failure it did not
   * have.
   */
  unpostable: Array<GroundingVerdict<T>>;
  /** **The ratio that matters**, and it is reported even when nothing is dropped. */
  keptRatio: number;
  /**
   * **How many findings offered a quotation this check cannot read verbatim**, and were therefore kept unchecked.
   *
   * **An ellipsis is a citation with an omission**, not a lie: this repository's own lens writes `export function
   * lookup(...)` as the evidence for a missing-docstring finding, and **a literal search for that string fails in every
   * file that contains it**. Dropping on that basis deleted a true positive in the end-to-end fixture - the *Sifting the
   * Noise* failure, where a filter suppressed 22% of real findings.
   *
   * **Counted rather than ignored**, because an escape hatch that cannot be seen is an escape hatch that gets used: a
   * run whose quotations are a third elided is a run whose precision was checked on two thirds of its evidence.
   */
  unverifiableQuotes: number;
  /**
   * **How many findings named an identifier that occurs nowhere in the evidence**, and were **kept** anyway.
   *
   * **Counted rather than dropped, and the reason is a measurement rather than a change of heart.** §150 priced the name
   * check on the published artifact at every widening the repository can support: with the change read whole and literals
   * excluded it still convicted **6** findings, of which **2 carried a golden** - a pool of one in three against a base
   * rate of one in three among the comments that were posted. **A filter that selects wrong comments at the rate the list
   * already contains them is a filter that selects nothing**, and a filter in front of a fixed budget cannot even buy
   * precision by deleting wrong comments, because the budget refills the slot with the next one.
   *
   * So the verdict survives as a **number**: a review that names symbols it never saw is a review worth reading twice, and
   * *"9 of 305 comments name nothing in the code they are about"* is a sentence a maintainer can act on.
   */
  namesNowhere: number;
}

/**
 * Reads the files a review covers, once.
 *
 * **The comments carry paths and line ranges and the file contents do not come with them**, so the caller supplies the
 * contents it already read for the review rather than this reaching for the filesystem. **A judge that does IO cannot
 * be tested against a corpus it does not have**, and the corpus here is the review's own input.
 */
export interface GroundingSources {
  /** File contents by repository-relative path, as the review saw them. */
  contents: ReadonlyMap<string, string>;
  /**
   * **The change each file's findings are about, when the caller has it.**
   *
   * **This is not a concession to a broken snippet; it is where the evidence actually is.** A finding's quotation is
   * often a line the pull request *removed*, and a removed line exists in the change and nowhere in the file - so a
   * check against the file alone does not ask *"does this code exist"*, it asks *"did you quote the new revision"*,
   * which is a question about the quoter rather than about the finding. The reading reviewer's own filing check has
   * always accepted a span in the file **or in the diff**, for exactly this reason.
   *
   * **Measured, not assumed.** Wiring the file-only version into `review pr` dropped the credential finding on this
   * repository's own end-to-end fixture with the reason *"the quoted code does not appear at lines 1-1"* - a true
   * positive deleted before anyone read it. That is the shape *Sifting the Noise* (arXiv 2601.22952) warns about, where
   * aggressive filtering suppressed 22% of true vulnerabilities.
   */
  diffs?: ReadonlyMap<string, string>;
  /**
   * **The whole change as one text**, when the caller has it: every hunk of every file the pull request touched.
   *
   * A name a comment mentions may be declared in a file the finding is not on - `lv_event_free_user_data_cb` is imported
   * from a header, and `tucker_weight_from_conv` lives in a sibling module the same pull request moves. **None of those
   * have to be read as files to be evidence that the name exists**, because the change already quotes them.
   */
  change?: string;
  /**
   * **Paths the revision does not have**, as the caller learned them: a deletion, a rename's old side, a file the head
   * commit removed. Findings on them are `unpostable` rather than unread.
   *
   * **Absence is information**, which is why it is passed rather than inferred: from the file contents alone, *"this path
   * is not in the map"* cannot distinguish a file that was read and is gone from a file nobody read.
   */
  absent?: ReadonlySet<string>;
}

/** A line range that the file actually has. */
function rangeIsReal(comment: GroundableFinding, lines: string[]): boolean {
  const { startLine, endLine } = comment;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  if (startLine < 1 || endLine < 1) return false;
  // **An inverted range is a defect in the comment, not a judgement about it.**
  if (endLine < startLine) return false;
  return endLine <= lines.length;
}

/**
 * Whether the quotation is a verbatim excerpt at all.
 *
 * **`...`, `…` and a lone `…` are omissions**, and an omission is not a claim that a string occurs: `export function
 * lookup(...)` is true of the file and present in none of it. A check that cannot decide keeps, and the count in the
 * report is what stops "cannot decide" from becoming a silent exemption.
 */
function isVerbatimQuote(quote: string): boolean {
  // **A `string`, not a `string | undefined`**: the caller trims the field once, so a `??` here would be a second default
  // for a value that already has one - and a branch nothing can reach.
  return !quote.includes('...') && !quote.includes('…');
}

/**
 * Whether `existingCode` appears where the comment says it does.
 *
 * **This is the strongest check available without a model**, and it is worth the strictness: the field quotes the
 * code it is about, **and if that text is not in the file then the comment is about something that is not there.**
 * A comment with no `existingCode` is not checked rather than dropped - **the quotation is evidence when present and
 * its absence is not evidence of absence.**
 */
function quoteIsPresent(comment: GroundableFinding, lines: string[], diff?: string): boolean {
  const quote = (comment.existingCode ?? '').trim();
  if (quote.length === 0) return true;
  // **The whole file, and the reason is a measurement rather than a preference.**
  //
  // `toReviewComment` quotes **six lines starting before the finding's own line**, while `startLine`/`endLine` name
  // **the finding's line alone** - so a window around the range **misses the quotation's leading lines.** A probe over
  // the true-positive corpus printed it exactly: **four of six findings dropped, every reason "the quoted code does
  // not appear at lines N-N"**, and the two that survived were the ones whose quotation happened to fall inside.
  //
  // **Checking the whole file is still an empirical check, which is the point.** *Refute-or-Promote* (arXiv
  // 2604.19049) requires **evidence rather than agreement**, and "the code this comment quotes exists in the file it
  // is about" **is evidence** - a fabricated quotation fails it. **What the range-only version added was not
  // evidence; it was a disagreement about where "here" begins.** The range check above still holds the finding to
  // lines that exist, and **the quotation check now asks the question it was written to ask.**
  const window = lines.join('\n');
  // **Whitespace-normalised**, because a diff's indentation and the file's rarely match character for character and
  // **that difference is not what this check is about.**
  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
  const wanted = normalise(quote);
  return normalise(window).includes(wanted) || normalise(diff ?? '').includes(wanted);
}

/**
 * **Words that are syntax rather than names**, so a comment quoting `false` in backticks is not making a claim about a
 * symbol.
 *
 * **§149 counted the literals among the false convictions**: `?? false` was one of the six, and *"a literal in backticks"*
 * was one of the four shapes. A keyword in backticks is a mention of the language, and **the check was written to ask about
 * identifiers** - which is a fact about the vocabulary, not a judgement about the finding.
 *
 * The list is the literals and the structural keywords of the eleven languages this repository reads first (JS/TS, Java,
 * Python, Groovy, Kotlin, Swift, ArkTS, plus the C family, XML/YAML/JSON scalars). **A function named `new` would be
 * skipped by this list and that is the correct trade**: a missed check costs one finding its note, and a false conviction
 * costs the reader the finding.
 */
const NOT_A_NAME = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'nil',
  'None',
  'True',
  'False',
  'NaN',
  'Infinity',
  'void',
  'this',
  'self',
  'super',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'async',
  'await',
  'yield',
  'return',
  'break',
  'continue',
  'throw',
  'catch',
  'else',
  'finally',
  'var',
  'let',
  'const',
  'def',
  'fn',
  'func',
  'yes',
  'no',
  'on',
  'off',
]);

/**
 * **Whether the names a comment mentions occur anywhere in the evidence**, which is now a **note rather than a verdict**.
 *
 * §149.3 repaired the file-only premise by reading the change as well, and the repair was priced: **5 goldens spent became
 * 3**, and the question that came out of the table was not *"how much narrower"* but *"what is left"*. §150 answered it on
 * the published artifact: with the change read as a whole and literals excluded, **6 findings still name something absent,
 * and 2 of the 6 carry a golden** - **one in three, against a base rate of one in three**. Nothing is left to select.
 *
 * > **The check is not wrong about the facts; it is uninformative about them.** A name that is missing from the region, the
 * > file and the change is *usually* a name the reviewer invented, and *sometimes* a name the reviewer is proposing - and
 * > the corpus does not let the two be told apart at a rate better than chance.
 *
 * **Three widenings, each with a reason the artifact gives.** The change whole, because a sibling module is a place a name
 * exists (`tucker_weight_from_conv`); literals excluded, because `false` is syntax; and **the comment's own proposal
 * excluded**, because `NeedSubElement` is what the finding asks for and **a proposal is by construction absent**.
 *
 * **A comment that names nothing is not counted**, for the same reason a comment that quotes nothing is kept: the evidence
 * is required when it is offered.
 */
function namesOccurInEvidence(
  comment: GroundableFinding,
  lines: string[],
  sources: GroundingSources,
): boolean {
  const proposal = comment.suggestionCode ?? '';
  const body = `${comment.content ?? ''} ${proposal}`;
  const named = [...body.matchAll(/`([A-Za-z_$][\w$]{2,})`/g)]
    .map((match) => match[1]!)
    .filter((name) => !NOT_A_NAME.has(name));
  if (named.length === 0) return true;

  const region = lines.slice(Math.max(0, comment.startLine - 1), comment.endLine).join('\n');
  const evidence = [
    region,
    lines.join('\n'),
    sources.diffs?.get(comment.path) ?? '',
    sources.change ?? '',
  ];
  return named.every(
    (name) => proposal.includes(name) || evidence.some((text) => text.includes(name)),
  );
}

/**
 * Splits findings into the ones about something that exists and the ones that are not.
 *
 * **The order of the checks is the order of their strength**: a path the revision does not have cannot carry a comment at
 * all, a path the review never read is unfixable by any reading, a range outside the file is provably wrong, and a
 * quotation that is absent is evidence.
 */
export function judgeGrounding<T extends GroundableFinding>(
  comments: readonly T[],
  sources: GroundingSources,
): GroundingReport<T> {
  const grounded: Array<T & { filtered: boolean }> = [];
  const ungrounded: Array<GroundingVerdict<T>> = [];
  const unpostable: Array<GroundingVerdict<T>> = [];
  let unverifiableQuotes = 0;
  let namesNowhere = 0;

  for (const comment of comments) {
    // **Before the file is even looked for**, because a revision that does not have the path cannot be read at it: a
    // finding on a deleted file is a comment with nowhere to go, not a comment about nothing.
    if (sources.absent?.has(comment.path) === true) {
      unpostable.push({
        comment,
        grounded: false,
        reason: `the revision this review read has no "${comment.path}", so a comment on it has no line to attach to`,
      });
      continue;
    }

    const content = sources.contents.get(comment.path);

    if (content === undefined) {
      ungrounded.push({
        comment,
        grounded: false,
        reason: `the review never read "${comment.path}", so a finding on it cannot be checked`,
      });
      continue;
    }

    const lines = content.split('\n');
    if (!rangeIsReal(comment, lines)) {
      ungrounded.push({
        comment,
        grounded: false,
        reason: `lines ${comment.startLine}-${comment.endLine} are not a range in a file of ${lines.length} lines`,
      });
      continue;
    }

    // **Read once, because the second half of the test was a branch nothing could reach**: `isVerbatimQuote` is true for
    // an absent quotation, so `!isVerbatimQuote(x) && x.trim().length > 0` short-circuited before the `?? ''` whenever the
    // field was missing - a defensive arm that looked like coverage and could never run. Reading the string first makes
    // both halves reachable, which is what a coverage number is supposed to mean.
    const quote = (comment.existingCode ?? '').trim();
    if (!isVerbatimQuote(quote) && quote.length > 0) {
      // **Kept and counted**, so the reader can weigh a precision that rests on a paraphrased quotation.
      unverifiableQuotes += 1;
    } else if (!quoteIsPresent(comment, lines, sources.diffs?.get(comment.path))) {
      ungrounded.push({
        comment,
        grounded: false,
        reason: `the quoted code does not appear in the file or in the change at lines ${comment.startLine}-${comment.endLine}`,
      });
      continue;
    }

    // **Counted and kept**: §150 measured this check selecting wrong comments at the rate the list already contains them,
    // so it is a sentence in the report rather than a deletion from it.
    if (!namesOccurInEvidence(comment, lines, sources)) namesNowhere += 1;

    grounded.push({ ...comment, filtered: false });
  }

  const total = comments.length;
  return {
    grounded,
    ungrounded,
    unpostable,
    // **`1` when there was nothing to judge**, which is the honest reading: nothing was dropped.
    keptRatio: total === 0 ? 1 : Math.round((grounded.length / total) * 10000) / 10000,
    unverifiableQuotes,
    namesNowhere,
  };
}
