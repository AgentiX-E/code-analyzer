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

/** Why a comment was dropped. */
export interface GroundingVerdict {
  comment: ReviewComment;
  grounded: boolean;
  /** The first check that failed, so a reader can disagree with the rule rather than the verdict. */
  reason: string | null;
}

export interface GroundingReport {
  grounded: ReviewComment[];
  /** Kept for reporting, and **not emitted** - the caller decides what to do with them. */
  ungrounded: GroundingVerdict[];
  /** **The ratio that matters**, and it is reported even when nothing is dropped. */
  keptRatio: number;
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
  contents: Map<string, string>;
}

/** A line range that the file actually has. */
function rangeIsReal(comment: ReviewComment, lines: string[]): boolean {
  const { startLine, endLine } = comment;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  if (startLine < 1 || endLine < 1) return false;
  // **An inverted range is a defect in the comment, not a judgement about it.**
  if (endLine < startLine) return false;
  return endLine <= lines.length;
}

/**
 * Whether `existingCode` appears where the comment says it does.
 *
 * **This is the strongest check available without a model**, and it is worth the strictness: the field quotes the
 * code it is about, **and if that text is not in the file then the comment is about something that is not there.**
 * A comment with no `existingCode` is not checked rather than dropped - **the quotation is evidence when present and
 * its absence is not evidence of absence.**
 */
function quoteIsPresent(comment: ReviewComment, lines: string[]): boolean {
  const quote = (comment.existingCode ?? '').trim();
  if (quote.length === 0) return true;
  const window = lines.slice(Math.max(0, comment.startLine - 1), comment.endLine).join('\n');
  // **Whitespace-normalised**, because a diff's indentation and the file's rarely match character for character and
  // **that difference is not what this check is about.**
  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
  return normalise(window).includes(normalise(quote));
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
 */
function namesOccurInRegion(comment: ReviewComment, lines: string[]): boolean {
  const body = `${comment.content ?? ''} ${comment.suggestionCode ?? ''}`;
  const named = [...body.matchAll(/`([A-Za-z_$][\w$]{2,})`/g)].map((m) => m[1]!);
  if (named.length === 0) return true;

  // **The region, plus the whole file as a fallback.** A comment may legitimately name a symbol declared elsewhere in
  // the same file, so the region is where it must be *shown* and the file is where it must *exist*.
  const region = lines.slice(Math.max(0, comment.startLine - 1), comment.endLine).join('\n');
  const file = lines.join('\n');
  return named.every((name) => region.includes(name) || file.includes(name));
}

/**
 * Splits findings into the ones about something that exists and the ones that are not.
 *
 * **The order of the checks is the order of their strength**: a path the review never read is unfixable by any
 * reading of the file, a range outside the file is provably wrong, and a quotation that is absent is evidence.
 */
export function judgeGrounding(comments: ReviewComment[], sources: GroundingSources): GroundingReport {
  const grounded: ReviewComment[] = [];
  const ungrounded: GroundingVerdict[] = [];

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

    if (!quoteIsPresent(comment, lines)) {
      ungrounded.push({
        comment,
        grounded: false,
        reason: `the quoted code does not appear at lines ${comment.startLine}-${comment.endLine}`,
      });
      continue;
    }

    if (!namesOccurInRegion(comment, lines)) {
      ungrounded.push({
        comment,
        grounded: false,
        reason: 'the finding names an identifier that occurs nowhere in the file it is about',
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
  };
}
