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
function isVerbatimQuote(quote: string | undefined): boolean {
  const text = (quote ?? '').trim();
  return !text.includes('...') && !text.includes('…');
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
 * Whether a name the comment mentions actually occurs in the quoted region.
 *
 * **The empirical gate the literature describes.** *Refute-or-Promote* (arXiv 2604.19049) reports that **ten dedicated
 * reviewers unanimously endorsed a non-existent Bleichenbacher oracle in OpenSSL's CMS module**, and that it was
 * **killed only by a single empirical test** - which is why their pipeline ends with a gate that requires concrete
 * evidence rather than agreement. **The same paper's summary is the thesis of this file**: *"no defect was discovered
 * autonomously; the contribution is external structure that filters LLM agents' persistent false positives."*
 *
 * **Here the empirical test is a symbol lookup.** When a comment names an identifier in backticks, **that identifier
 * has to appear in the code the comment is about.** A name that occurs nowhere in the region is a claim about
 * something that is not there - **and unlike a matter of judgement, it is decidable.**
 *
 * **Only backticked identifiers are checked**, so prose is not mistaken for code. **A comment that names nothing is
 * kept**, for the same reason a comment that quotes nothing is: **the evidence is required when it is offered.**
 *
 * **And the change counts as somewhere the name can be.** §149 priced the file-only version on the published artifact and
 * found it deleting true positives at **28.6 % of its pool** - seven times the §75.3 bar - because **every one of the
 * removals that cost a golden named something the head file legitimately cannot contain**: `dispatchCount`, a symbol the
 * change *removed* and the comment is about; `lv_event_free_user_data_cb`, a helper declared in another file and imported;
 * `NeedSubElement`, a name the comment proposes; `false` and `null`, literals in backticks. **A comment about a deletion
 * must name something that no longer exists** - that is the shape of the finding, not a defect in it, and a check that
 * cannot see the removed lines convicts it by construction.
 */
function namesOccurInRegion(comment: GroundableFinding, lines: string[], diff?: string): boolean {
  const body = `${comment.content ?? ''} ${comment.suggestionCode ?? ''}`;
  const named = [...body.matchAll(/`([A-Za-z_$][\w$]{2,})`/g)].map((m) => m[1]!);
  if (named.length === 0) return true;

  // **The region, plus the whole file as a fallback.** A comment may legitimately name a symbol declared elsewhere in
  // the same file, so the region is where it must be *shown* and the file is where it must *exist*.
  const region = lines.slice(Math.max(0, comment.startLine - 1), comment.endLine).join('\n');
  const file = lines.join('\n');
  // **And the change**, because a removed line is a place a name exists: `?? false` alone would make a comment about a
  // deletion unverifiable by construction, which is the failure §149 measured at 28.6 % true removals.
  const change = diff ?? '';
  return named.every(
    (name) => region.includes(name) || file.includes(name) || change.includes(name),
  );
}

/**
 * Splits findings into the ones about something that exists and the ones that are not.
 *
 * **The order of the checks is the order of their strength**: a path the review never read is unfixable by any
 * reading of the file, a range outside the file is provably wrong, and a quotation that is absent is evidence.
 */
export function judgeGrounding<T extends GroundableFinding>(
  comments: readonly T[],
  sources: GroundingSources,
): GroundingReport<T> {
  const grounded: Array<T & { filtered: boolean }> = [];
  const ungrounded: Array<GroundingVerdict<T>> = [];
  let unverifiableQuotes = 0;

  for (const comment of comments) {
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

    if (!isVerbatimQuote(comment.existingCode) && (comment.existingCode ?? '').trim().length > 0) {
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

    if (!namesOccurInRegion(comment, lines, sources.diffs?.get(comment.path))) {
      ungrounded.push({
        comment,
        grounded: false,
        reason:
          'the finding names an identifier that occurs nowhere in the file it is about, nor in the change it is about',
      });
      continue;
    }

    grounded.push({ ...comment, filtered: false });
  }

  const total = comments.length;
  return {
    grounded,
    ungrounded,
    // **`1` when there was nothing to judge**, which is the honest reading: nothing was dropped.
    keptRatio: total === 0 ? 1 : Math.round((grounded.length / total) * 10000) / 10000,
    unverifiableQuotes,
  };
}
