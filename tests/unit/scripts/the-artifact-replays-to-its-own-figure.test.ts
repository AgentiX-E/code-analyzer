// **The artifact replays to its own figure, or the rows beside the figure do not say what it says.**
//
// The project's published numbers come from two files that were already paid for: the bench artifact, one row per
// finding with the goldens the judge matched it to, and the competitor's baseline. **Both are committed.** So the
// figure is not a memory of a run - it is arithmetic over rows that ship with it, and this file performs that arithmetic
// with a second implementation of the matching and asserts the published precision, recall and F1 come back.
//
// **Why a second implementation rather than the harness's.** The harness scores with `maximumMatchingCount` from
// `@code-analyzer/intelligence`. A verifier that called that function would agree with the harness about any defect
// they share, which is the definition of a check that cannot fail. `scripts/lib/paired-replay.mjs` walks its own
// augmenting paths, and **two implementations agreeing on 452 goldens to four decimal places is evidence about the
// corpus rather than about the code.**

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareReplayToArtifact,
  maximumMatchingIndices,
  replayHeadToHead,
} from '../../../scripts/lib/paired-replay.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const ARTIFACT = resolve(REPO, 'benchmarks/aacr-bench.json');
const BASELINE = resolve(REPO, 'benchmarks/aacr/competitor-baseline.json');

const bench = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

/** One finding, in the shape `rankedFindings` carries: the goldens the judge matched it to, and the gate's verdict. */
function finding(pr: string, matchedGoldens: number[], actionable = true, category = 'bug') {
  return { pr, matchedGoldens, actionable, category };
}

/** One scored pull request, in the shape `coverage.byPullRequest` carries. */
function scored(pr: string, goldens: number) {
  return { pr, goldens, covered: [] as number[], emitted: 0 };
}

describe('the committed artifact reproduces the figures it publishes', () => {
  const replay = replayHeadToHead({ bench, baseline, dropCategories: [] });

  it('is the arm the artifact was run under', () => {
    // The 2026-11-10 artifact carries no `emissionProfile`, which is the advisory arm - so the figure to reproduce is the
    // actionability gate's and not a profile's.
    expect(compareReplayToArtifact(replay, bench).arm).toBe('gate');
  });

  it('reproduces precision, recall and F1 to the four places they are published at', () => {
    const verdict = compareReplayToArtifact(replay, bench);

    expect(verdict.mismatches).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(replay.whole.gate.precision).toBe(bench.precision);
    expect(replay.whole.gate.recall).toBe(bench.recall);
    expect(replay.whole.gate.f1).toBe(bench.f1);
  });

  it('reproduces the four counts, which is the stronger claim', () => {
    // A tolerance on three ratios could hide a compensating error in the counts; three integers cannot.
    expect(replay.whole.gate.truePositives).toBe(bench.truePositives);
    expect(replay.whole.gate.falsePositives).toBe(bench.falsePositives);
    expect(replay.whole.gate.falseNegatives).toBe(bench.falseNegatives);
  });

  it('counts the pull request that emitted nothing, because its goldens are still misses', () => {
    // **The subtlety that made the first replay of this artifact disagree by six goldens.** `rankedFindings` carries
    // 49 pull requests and `coverage.byPullRequest` carries 50; the difference is a pull request with no finding, and a
    // replay over the findings would have dropped it from the denominator.
    const inFindings = new Set(
      (bench.rankedFindings as Array<{ pr: string | null }>).map((row) => row.pr),
    );
    expect(inFindings.size).toBeLessThan(bench.coverage.byPullRequest.length);
    expect(replay.pullRequestsScored).toBe(bench.coverage.byPullRequest.length);
  });

  it('reports the head-to-head over the pull requests both arms scored, not over all of ours', () => {
    expect(replay.paired.pullRequests).toBeLessThan(replay.pullRequestsScored);
    expect(replay.paired.excluded.length).toBe(
      replay.pullRequestsScored - replay.paired.pullRequests,
    );
    // **Its goldens and ours are the same number on the paired subset**, which is what makes the two F1 comparable.
    expect(replay.paired.goldens).toBe(
      bench.coverage.byPullRequest
        .filter((row: { pr: string }) => baseline.pulls[row.pr] !== undefined)
        .reduce((total: number, row: { goldens: number }) => total + row.goldens, 0),
    );
  });
});

describe('the matching is a maximum, and says which goldens it took', () => {
  it('takes one golden per finding even when two findings claim it', () => {
    expect(maximumMatchingIndices([[0], [0]], 1)).toEqual([0]);
  });

  it('finds the assignment a first-come walk would miss', () => {
    // The first finding can take either golden and takes 0; the second can only take 0. A walk that never moves an
    // owner returns 1 here. The augmenting walk re-houses the first finding on golden 1 and returns 2 - which is the
    // difference between a matching and a maximum matching, and the reason this is not a greedy loop.
    expect(maximumMatchingIndices([[0, 1], [0]], 2)).toEqual([0, 1]);
  });

  it('ignores a golden index the pull request does not have', () => {
    expect(maximumMatchingIndices([[0], [99], [-1]], 2)).toEqual([0]);
  });

  it('answers nothing for a pull request with no goldens', () => {
    expect(maximumMatchingIndices([[0], [1]], 0)).toEqual([]);
  });
});

describe('the replay computes the two arms it is given, and only those', () => {
  const tiny = {
    measuredAt: '1970-01-01',
    coverage: { byPullRequest: [scored('a', 2), scored('b', 2)] },
    rankedFindings: [
      finding('a', [0], true, 'bug'),
      finding('a', [1], true, 'test'),
      finding('b', [0], false, 'bug'),
    ],
  };
  const theirs = { pulls: { a: { matches: [[0]], keep: [true] }, b: { matches: [], keep: [] } } };

  it('separates everything, the gate, and the gate with a profile on top', () => {
    const replay = replayHeadToHead({ bench: tiny, baseline: theirs, dropCategories: ['test'] });

    expect(replay.whole.everything.findings).toBe(3);
    expect(replay.whole.gate.findings).toBe(2);
    // `test` dropped by the profile, so only the `bug` finding in `a` reaches a reader.
    expect(replay.whole.profile.findings).toBe(1);
  });

  it('counts a pull request the competitor has no row for as excluded, on its own side', () => {
    const replay = replayHeadToHead({
      bench: { ...tiny, coverage: { byPullRequest: [scored('a', 2), scored('c', 2)] } },
      baseline: theirs,
    });

    expect(replay.paired.pullRequests).toBe(1);
    expect(replay.paired.excluded).toEqual([
      { key: 'c', reason: 'the competitor has no row for this pull request' },
    ]);
  });

  it('reads their arm with and without their own gate, because the two give different figures', () => {
    const replay = replayHeadToHead({
      bench: { ...tiny, coverage: { byPullRequest: [scored('a', 2)] } },
      baseline: theirs,
    });

    expect(replay.paired.theirs.f1).toBe(0.6667);
    expect(replay.paired.theirsEverything.f1).toBe(0.6667);
  });
});

describe('the check refuses an artifact whose rows do not support its figure', () => {
  it('names the field, the published value and the replayed one', () => {
    const replay = replayHeadToHead({ bench, baseline, dropCategories: [] });
    const tampered = { ...bench, f1: 0.9 };
    const verdict = compareReplayToArtifact(replay, tampered);

    expect(verdict.ok).toBe(false);
    expect(verdict.mismatches).toEqual([
      { field: 'f1', published: 0.9, replayed: bench.f1, arm: 'gate' },
    ]);
  });

  it('compares the profile arm when the artifact says it ran one', () => {
    const replay = replayHeadToHead({ bench, baseline, dropCategories: [] });
    const asDefect = {
      ...bench,
      configuration: { ...bench.configuration, emissionProfile: 'defect' },
    };

    expect(compareReplayToArtifact(replay, asDefect).arm).toBe('profile');
  });
});
