// **The competitor result was already paid for, and the run that paid published the verdicts rather than a summary.**
//
// The run of 2026-11-09 cost 8.53 USD, of which 5.89 USD was the competitor arm. That arm's output is a property of the
// corpus - fourteen pull requests whose goldens have not changed - so the module that replays it was written, and the
// file it reads was left unwritten: **an iteration later the run would have reported every pull request as `missing`
// and bought all fourteen again**, which is the whole defect the module exists to prevent.
//
// **The repair is a transcription, and a transcription is only honest if it can be checked.** The artifact carries one
// row per competitor finding with the goldens the judge accepted for it, so the record is rebuilt from those rows and
// then **replayed through the same scoring functions the job uses**, asserting the two figures the artifact published:
// **50 true positives and 102 false positives**. A row lost in transcription, an index shifted by one, or a `keep` flag
// turned into a string would move one of those numbers.
//
// **And the one pull request the competitor failed on is recorded as a zero rather than omitted**, because that is what
// happened: it ran, it spent the money, and it produced nothing. Omitting it is what the scoring did on 2026-11-09, and
// that omission was worth 0.0130 of F1 in the competitor's favour - recall read as 0.3185 against a denominator of 157
// where both reviewers had been given 170.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  maximumMatchingCount,
  point,
} from '../../../packages/intelligence/src/review/actionability.js';
import {
  corpusFingerprint,
  pullFingerprint,
  replayedPull,
  resolveCompetitor,
} from '../../../.github/scripts/lib/competitor-baseline.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * **A pull request as the resolver sees it**, built from the record's own golden count.
 *
 * The goldens' content is not in the file - the run this was transcribed from published the count - so the fingerprint
 * below is the one a row *would* have if its goldens were the ones the current corpus holds for it. **That is deliberate
 * and it is why `verified` exists**: the replay of these fourteen rows is checked by count, `pullFingerprint` cannot
 * check them, and the artifact says so.
 */
const factsOf = (key: string, goldens: number) => ({
  key,
  goldens,
  fingerprint: pullFingerprint({ githubPrUrl: key, comments: [] }),
});
const baseline = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks/aacr/competitor-baseline.json'), 'utf8'),
) as {
  version: number;
  recordedAt: string;
  corpus: { fingerprint: string; judge: { model: string; prompt: string } };
  competitor: { tool: string };
  provenance: { measuredAt: string; failedPullRequests: string[]; transcribedFrom: string };
  pulls: Record<
    string,
    {
      matches: number[][];
      goldens: number;
      keep: boolean[];
      detail: Array<Record<string, unknown>>;
      unanswered: number;
      findings: number;
      failed?: boolean;
      fingerprint?: string;
    }
  >;
};
const artifact = JSON.parse(readFileSync(join(ROOT, 'benchmarks/aacr-bench.json'), 'utf8')) as {
  measuredAt: string;
  prsInDataset: number;
  coverage: { byPullRequest: Array<{ pr: string; goldens: number }> };
  // **How much of the corpus the competitor's arm could answer for**, which is the field that turns "we did not beat
  // them" into "the two numbers are not the same measurement".
  mcnemar: { verdict: string; coverage: { covered: number; requested: number } };
  secondReviewer: {
    truePositives: number;
    falsePositives: number;
    precision: number;
    recall: number;
    f1: number;
  };
};

/** The counts the job would compute from a set of replayed pulls, using the job's own arithmetic. */
function countsOf(pulls: Record<string, { matches: number[][]; goldens: number }>) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const pull of Object.values(pulls)) {
    const covered = maximumMatchingCount(pull.matches, pull.goldens);
    tp += covered;
    fp += pull.matches.length - covered;
    fn += pull.goldens - covered;
  }
  return { tp, fp, fn, ...point(tp + fp, tp, fp, fn) };
}

describe('the recorded competitor result replays to the figures that were published', () => {
  it('reproduces the artifact true and false positive counts exactly', () => {
    const replayed = Object.fromEntries(
      Object.entries(baseline.pulls).map(([key, pull]) => [key, replayedPull(key, pull)]),
    );
    const counts = countsOf(replayed);
    // **The two numbers the artifact published for that run.** They are not recomputed from a summary anywhere: they
    // fall out of the per-pair verdicts, which is why reproducing them is evidence that no row was lost.
    expect(counts.tp).toBe(artifact.secondReviewer.truePositives);
    expect(counts.fp).toBe(artifact.secondReviewer.falsePositives);
    expect(counts.tp).toBe(50);
    expect(counts.fp).toBe(102);
  });

  it('counts the pull request the competitor failed on as missed, which the run of 2026-11-09 did not', () => {
    const failed = baseline.provenance.failedPullRequests;
    expect(failed).toHaveLength(1);
    const zero = baseline.pulls[failed[0]!]!;
    expect(zero.failed).toBe(true);
    expect(zero.matches).toEqual([]);
    expect(zero.keep).toEqual([]);
    // **And its goldens are in the record**, which is the whole point: 13 goldens that are neither found nor dropped.
    expect(zero.goldens).toBeGreaterThan(0);

    const counts = countsOf(
      Object.fromEntries(
        Object.entries(baseline.pulls).map(([key, pull]) => [key, replayedPull(key, pull)]),
      ),
    );
    // The denominator is the corpus's 170 goldens, not 157 - the same denominator our own arm is scored against.
    expect(counts.tp + counts.fn).toBe(170);
    // And the honest recall and F1 of that run, which are lower than the 2026-11-09 artifact's because that reading
    // excluded the crash rather than counting it. **Both are true of the same run; only one of them is comparable to
    // ours** - and since iteration 119 the artifact carries the comparable one, which is what this asserts.
    expect(counts.recall).toBeCloseTo(0.2941, 4);
    expect(counts.f1).toBeCloseTo(0.3106, 4);
    expect(artifact.secondReviewer.f1).toBeCloseTo(counts.f1, 4);
  });

  it('carries the fingerprint of the corpus it covers, computed from the artifact rows for those pull requests', () => {
    // **The artifact grew to fifty pull requests and the record still covers fourteen**, so the fingerprint has to be
    // taken over the rows the record actually holds. **Comparing it against the whole corpus is the assertion that was
    // here before this iteration, and it would now pass only if the record had grown with the corpus** - which would be
    // the record claiming coverage it does not have.
    const covered = artifact.coverage.byPullRequest.filter((row) => row.pr in baseline.pulls);
    expect(covered).toHaveLength(Object.keys(baseline.pulls).length);
    const expected = corpusFingerprint(
      covered.map((row) => ({
        githubPrUrl: row.pr,
        comments: Array.from({ length: row.goldens }, () => ({ note: 'x' })),
      })),
    );
    expect(baseline.corpus.fingerprint).toBe(expected);
  });

  it('names the run it was transcribed from, so a reader can check it rather than believe it', () => {
    expect(baseline.provenance.transcribedFrom).toBe('benchmarks/aacr-bench.json');
    // **The date is the record's own, not the artifact's any more**: the artifact was re-measured at fifty pull requests
    // and the competitor's arm was not re-bought, so the two files describe different runs on purpose - and **the
    // artifact has to say so rather than leaving a reader to notice**.
    expect(baseline.provenance.measuredAt).toBe('2026-11-09');
    expect(artifact.measuredAt).not.toBe(baseline.provenance.measuredAt);
    expect(artifact.mcnemar.verdict).toBe('withheld');
    expect(artifact.mcnemar.coverage).toMatchObject({
      covered: Object.keys(baseline.pulls).length,
      requested: artifact.prsInDataset,
    });
    expect(baseline.corpus.judge.prompt).toBe('aacr-judge-v1');
    expect(Object.keys(baseline.pulls)).toHaveLength(14);
  });

  it('answers `replay` for every pull request in the corpus, which is the mode that spends nothing', () => {
    for (const key of Object.keys(baseline.pulls)) {
      const goldens = baseline.pulls[key]!.goldens;
      const decision = resolveCompetitor({
        mode: 'replay',
        baseline,
        judgeModel: baseline.corpus.judge.model,
        pull: factsOf(key, goldens),
      });
      expect(decision.kind).toBe('replay');
      // **And by count rather than by fingerprint**, because the run these rows were transcribed from published the
      // number of goldens and not their lines. **A reader who is told "replayed" without being told how it was checked
      // is being told half a fact**, so the weaker check is named rather than hidden behind the stronger word.
      if (decision.kind !== 'replay') throw new Error('expected a replay');
      expect(decision.verified).toBe('count');
    }
  });

  it('refuses a record made against another judge rather than comparing across two of them', () => {
    const first = Object.keys(baseline.pulls)[0]!;
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline,
      judgeModel: 'some-other-model',
      pull: factsOf(first, baseline.pulls[first]!.goldens),
    });
    expect(decision.kind).toBe('missing');
    // **And the reason names the judge**, because "missing" without a reason sends the next reader to the wrong file.
    if (decision.kind !== 'missing') throw new Error('expected a missing decision');
    expect(String(decision.reason ?? '')).toContain('judge');
  });
});
