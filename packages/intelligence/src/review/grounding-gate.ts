// **A check that could only read half the list is a check that may not delete from it.**
//
// `judgeGrounding` decides four things about a finding - its path was read, its range exists, its quotation is in the
// file, its backticked names are in the file - and **all four need the file**. So a caller that has read some of the
// files is not holding a weaker version of the same instrument: **it is holding an instrument whose answer depends on
// which files it happened to open.**
//
// **What that failure looks like, precisely, because it has already been paid for once.** `grounding-judge.ts` is quoted
// in §132.5 as being called from four test files and no product path, and the obvious repair - pass whatever contents
// the run has and emit `report.grounded` - **deletes every finding on every file the run did not read**, for the reason
// "the review never read it, so a finding on it cannot be checked". That is the defect §23.7 records from the other
// direction: a gate scoped to a reviewer it was not calibrated on took the reading arm from F1 0.2092 to 0.0523. **A
// gate wired blind does not report precision; it reports which files were fetched.**
//
// **So the rule here is coverage before deletion.** The drop is applied when *every* finding's path was read, and the
// decision is **recorded and not applied** otherwise - `withheld: 'no-readable-arm'`, in the same vocabulary
// `aacr-promote.mjs` already uses for an arm it refuses to score. The report travels with the refusal, so a run that
// withheld the gate can still say what the gate *would* have dropped, which is the difference between a device that was
// measured and a device that was silent.
//
// **Why "all or nothing" rather than "drop the ones I could check".** The two obvious partial rules are both wrong in a
// way that flatters the figure. Dropping only the decidable ones **keeps every finding on an unread file**, so the
// measured precision is a mixture of a checked list and an unchecked one and cannot be attributed to either. Dropping
// the undecidable ones **is the §23.7 regression**. The first is a number about nothing and the second is a number about
// the fetcher; **full coverage is the only state in which the drop is a statement about findings.**

import { judgeGrounding, type GroundableFinding, type GroundingReport } from './grounding-judge.js';

/**
 * **Re-exported rather than defined here**, so the shape the gate accepts and the shape the judge reads are one type
 * rather than two that agree today. `index.ts` publishes it from this module because the judge's own report name
 * collides with the question-answering one, and **an import that has to reach past the public surface to name its own
 * argument is an argument for a narrower surface**.
 */
export type { GroundableFinding } from './grounding-judge.js';

/** Why the gate could not be applied. One reason, and it is not a failure of the findings. */
export type GroundingWithheldReason = 'no-readable-arm';

/** What the gate was allowed to look at, reported whether or not it was allowed to act. */
export interface GroundingCoverage {
  /** Findings offered to the gate. */
  findings: number;
  /** Findings whose path the caller supplied contents for. */
  readable: number;
  /**
   * **Findings whose path the revision does not have**, which is an answer rather than a gap.
   *
   * §149.5 measured the cost of not having this bucket: one path absent at head out of 28 findings made the gate inert for
   * the pull request, so **27 judgeable findings went unjudged to punish one unpostable one**. The coverage rule is about
   * findings the caller could not answer for; a deleted file is a finding the caller answered for.
   */
  unpostable: number;
}

export interface GroundingDecision<T extends GroundableFinding = GroundableFinding> {
  /**
   * **What the caller should emit**, as `readonly T[]` in both states so the caller writes one branch rather than two
   * return types. The `filtered: false` marker travels inside the elements and is visible on `report.grounded`; **a
   * withheld decision returns the caller's own array**, so a caller can tell the two states apart by `applied`.
   */
  kept: readonly T[];
  applied: boolean;
  /** `null` when the gate ran, so a reader distinguishes "nothing was dropped" from "nothing could be checked". */
  withheld: GroundingWithheldReason | null;
  coverage: GroundingCoverage;
  /**
   * **Present even when withheld.** A run that could not apply the device is the only kind that can still say what the
   * device would have done, and that sentence is the reason to keep the report rather than to skip the work.
   */
  report: GroundingReport<T>;
}

/**
 * Decides whether the grounding check may delete anything from this list.
 *
 * **`contents` absent is not the same as `contents` empty**, and neither is an error: a review of a diff alone has no
 * files, and this repository's default arm is a review of a diff alone. **The gate's job is to be free when the files
 * are there and inert when they are not** - the second half is what stops a wiring change from moving every published
 * figure at once.
 *
 * **`absent` and `change` are the two facts that let the gate act on a change it could only partly read**: a path the
 * revision does not have is unpostable rather than unread, and the whole change is a place a name exists. Both are
 * optional, and **their absence is inert rather than dangerous** - a caller that passes neither gets exactly the behaviour
 * it got before §150.
 */
export function decideGrounding<T extends GroundableFinding>(
  findings: readonly T[],
  contents: ReadonlyMap<string, string> | undefined,
  diffs?: ReadonlyMap<string, string>,
  extra?: { change?: string; absent?: ReadonlySet<string> },
): GroundingDecision<T> {
  const map = contents ?? new Map<string, string>();
  const absent = extra?.absent;
  const readable = findings.filter((finding) => map.has(finding.path)).length;
  const unpostable = findings.filter(
    (finding) => !map.has(finding.path) && absent?.has(finding.path) === true,
  ).length;
  const coverage: GroundingCoverage = { findings: findings.length, readable, unpostable };

  // **Judged either way**, because the report is what lets a withheld run be read as a measurement rather than as an
  // absence. It costs a few string searches over text that is already in memory.
  const report = judgeGrounding(findings, {
    contents: map,
    ...(diffs === undefined ? {} : { diffs }),
    ...(extra?.change === undefined ? {} : { change: extra.change }),
    ...(absent === undefined ? {} : { absent }),
  });

  // **Zero findings is full coverage**: there is no unread path to keep, and refusing here would report a gate that was
  // never asked a question as a gate that was blocked.
  if (readable + unpostable < findings.length) {
    return {
      kept: findings,
      applied: false,
      withheld: 'no-readable-arm',
      coverage,
      report,
    };
  }

  return { kept: report.grounded, applied: true, withheld: null, coverage, report };
}

/** How a decision reads in a report, so a job log and an artifact cannot describe it differently. */
export function describeGrounding(decision: {
  applied: boolean;
  withheld: GroundingWithheldReason | null;
  coverage: { findings: number; readable: number; unpostable?: number };
  report: {
    keptRatio: number;
    ungrounded: ReadonlyArray<{ reason: string | null }>;
    unverifiableQuotes?: number;
    namesNowhere?: number;
  };
}): string {
  const { findings, readable } = decision.coverage;
  const unpostable = decision.coverage.unpostable ?? 0;
  if (!decision.applied) {
    return `grounding withheld (${decision.withheld ?? 'unknown'}): ${String(readable)} of ${String(findings)} findings were on a file this run read, so nothing was dropped`;
  }
  const dropped = decision.report.ungrounded.length;
  const byReason = new Map<string, number>();
  for (const verdict of decision.report.ungrounded) {
    const reason = verdict.reason ?? 'unnamed';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const detail = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${String(count)} ${reason}`)
    .join('; ');
  // **And the quotations it could not read**, because a drop rate computed over two thirds of the evidence is a rate
  // about two thirds of the evidence, and the sentence that reports it has to say so.
  const elided = decision.report.unverifiableQuotes ?? 0;
  const elisionNote =
    elided === 0 ? '' : `; ${String(elided)} paraphrased quotation(s) kept unchecked`;
  // **The names, as a note rather than a deletion**, so the number that used to justify a drop still reaches the reader
  // after §150 stopped the drop: a review that names nine symbols it never saw is a review to read twice.
  const unanchored = decision.report.namesNowhere ?? 0;
  const anchorNote =
    unanchored === 0 ? '' : `; ${String(unanchored)} named a symbol absent from the code, kept`;
  const unpostableNote =
    unpostable === 0
      ? ''
      : `; ${String(unpostable)} on a path this revision does not have, unpostable`;
  return `grounding applied: ${String(dropped)} of ${String(findings)} dropped, kept ${String(decision.report.keptRatio)}${detail.length === 0 ? '' : ` (${detail})`}${unpostableNote}${elisionNote}${anchorNote}`;
}
