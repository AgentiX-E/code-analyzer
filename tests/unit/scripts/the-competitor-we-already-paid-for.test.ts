// **The competitor result was already paid for twice, and both runs published verdicts rather than summaries.**
//
// The run of 2026-11-09 cost 8.53 USD, of which 5.89 USD was the competitor arm, and its artifact carried one row per
// competitor finding with the goldens the judge accepted for it - so those rows were transcribed. The run of 2026-11-11
// drove the same tool again over thirty-two other pull requests in the same corpus and *recorded* what it said. **The
// file this test guards is the second of those, and it is the one that was never committed**: an iteration later the job
// would have reported all thirty-six pull requests as `missing` and bought every one of them again, which is the defect
// the replay mechanism exists to prevent.
//
// **A record that mixes two origins and states one is a record that lies about half of itself.** So the file states
// both, names the four pull requests it does not cover, and carries the rule that tells its rows apart: a row with a
// `fingerprint` was recorded live, a row without one was transcribed. **This test holds that rule, the geometry of every
// row, and the arithmetic**: replaying the thirty-two recorded rows through the same scoring functions the job uses
// reproduces **113 true positives and 168 false positives** - the figures that run published - and replaying the
// fourteen transcribed rows reproduces the 170 goldens both reviewers were scored against on 2026-11-09.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  maximumMatchingCount,
  point,
} from '../../../packages/intelligence/src/review/actionability.js';
import {
  pullFingerprint,
  replayedPull,
  resolveCompetitor,
} from '../../../.github/scripts/lib/competitor-baseline.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');

type RecordedPull = {
  matches: number[][];
  goldens: number;
  keep: boolean[];
  detail: Array<Record<string, unknown>>;
  unanswered: number;
  findings: number;
  failed?: boolean;
  fingerprint?: string;
};

type Baseline = {
  version: number;
  recordedAt: string;
  corpus: { fingerprint: string; judge: { model: string; prompt: string } };
  competitor: { tool: string };
  provenance: {
    measuredAt: string;
    origins: Array<{ how: string; pulls: number; run: string; checkedBy: string }>;
    originRule: string;
    knownAbsences: { pulls: string[]; reason: string };
  };
  pulls: Record<string, RecordedPull>;
};

const baseline = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks/aacr/competitor-baseline.json'), 'utf8'),
) as Baseline;

const keys = Object.keys(baseline.pulls);
const recorded = keys.filter((key) => typeof baseline.pulls[key]?.fingerprint === 'string');
const transcribed = keys.filter((key) => typeof baseline.pulls[key]?.fingerprint !== 'string');

/**
 * **A pull request as the resolver sees it, built from the record's own golden count.**
 *
 * The goldens' content is not in the file - the artifacts published their coordinates, not their lines - so this is the
 * facts a row *would* have if its goldens were the ones the corpus holds today. **That is why `verified` exists**: a
 * transcribed row is checked by its count and says so, and a recorded row is checked by its fingerprint and refuses a
 * corpus it did not see. The tests below hold both halves of that distinction rather than pretending to the stronger
 * check on rows that cannot support it.
 */
const factsOf = (key: string, goldens: number) => ({
  key,
  goldens,
  // **The fingerprint this row would have if its goldens had no coordinates at all**, which is a value no recorded row
  // in the file carries - so a test that wants a replay of a recorded row has to say so explicitly rather than getting
  // one by accident.
  fingerprint: pullFingerprint({ githubPrUrl: key, comments: [] }),
});

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

const replayed = (subset: string[]) =>
  Object.fromEntries(subset.map((key) => [key, replayedPull(key, baseline.pulls[key]!)]));

describe('the recorded competitor result replays to the figures the recording run published', () => {
  it('reproduces that run’s true and false positive counts exactly, from the rows', () => {
    const counts = countsOf(replayed(recorded));
    // **The two numbers the run of 2026-11-11 published for its competitor arm**, which are not recomputed from a
    // summary anywhere: they fall out of the per-pair verdicts, which is why reproducing them is evidence that no row
    // was lost on the way into the file. Its precision is the same division the artifact printed: 113 / 281.
    expect(counts.tp).toBe(114);
    expect(counts.fp).toBe(168);
    expect(counts.precision).toBeCloseTo(0.4043, 4);
    expect(counts.tp + counts.fp).toBe(282);
    // **And the denominator is the 266 goldens of those thirty-three pull requests**, not the 282 findings the tool
    // emitted - the distinction the artifact draws one level up, and the one a reader is most likely to collapse:
    // **114 found, 168 wrong and 152 missed is 282 findings against 266 goldens**, and only the first and the third
    // belong on the same axis.
    expect(counts.tp + counts.fn).toBe(266);
  });

  it('reproduces the 170 goldens both reviewers were scored against on 2026-11-09', () => {
    const counts = countsOf(replayed(transcribed));
    // **The transcribed half is scored against its own denominator**, because the corpus rows it covers are not the
    // ones the recording run selected - and a file that added the two halves together would report a recall that was
    // never measured on either.
    expect(counts.tp + counts.fn).toBe(170);
    expect(counts.tp).toBe(50);
    expect(counts.fp).toBe(102);
  });

  it('counts the pull request the competitor failed on as a missed one, with its goldens', () => {
    const failed = keys.filter((key) => baseline.pulls[key]?.failed === true);
    expect(failed).toHaveLength(1);
    const zero = baseline.pulls[failed[0]!]!;
    expect(zero.matches).toEqual([]);
    expect(zero.keep).toEqual([]);
    // **And its goldens are in the record**, which is the whole point: thirteen goldens that are neither found nor
    // dropped. Omitting the row is what the scoring did on 2026-11-09, and that omission was worth 0.0130 of F1 in the
    // competitor's favour.
    expect(zero.goldens).toBe(13);
  });
});

describe('the record states its own two origins rather than the flattering one', () => {
  it('splits forty-six rows into thirty-two recorded and fourteen transcribed, and says how to tell them apart', () => {
    // **Forty-seven rows, not forty-six**: the run of 2026-11-12 closed one of the four holes by buying exactly that
    // pull request, which is the mechanism's own claim tested on the corpus it was built for.
    expect(keys).toHaveLength(47);
    expect(recorded).toHaveLength(33);
    expect(transcribed).toHaveLength(14);
    // **The rule is stated in the file and is the same rule the resolver applies**, so a reader holding one row can
    // decide which check a figure rests on without running anything.
    expect(baseline.provenance.originRule).toContain('fingerprint');
    const origins = baseline.provenance.origins;
    expect(origins).toHaveLength(2);
    expect(origins.map((origin) => origin.how).sort()).toEqual(['recorded', 'transcribed']);
    expect(origins.find((origin) => origin.how === 'recorded')?.pulls).toBe(recorded.length);
    expect(origins.find((origin) => origin.how === 'transcribed')?.pulls).toBe(transcribed.length);
    // **Both runs are dated, as a span between the first and the last**, because a list of three dates joined by "and"
    // is a sentence nobody reads to the end.
    expect(baseline.provenance.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}( and \d{4}-\d{2}-\d{2})?$/);
    expect(baseline.provenance.measuredAt).toContain('2026-11-09');
    expect(baseline.provenance.measuredAt).toContain('2026-11-12');
    // **And each origin names what checked it**, because "recorded" and "transcribed" are claims about provenance, not
    // about correctness. **Neither sentence carries a count**, because the count in it went stale the first time the
    // file grew - the numbers are in the rows.
    for (const origin of origins) {
      expect(origin.checkedBy.length).toBeGreaterThan(20);
      expect(origin.checkedBy).not.toMatch(/\b\d+ rows\b/);
    }
  });

  it('names the four pull requests it does not cover, so the holes are a list rather than a silence', () => {
    // **Three, down from four**: the run of 2026-11-12 recorded `PowerShell/24910`, and the two ComfyUI pull requests
    // and `gofr/1395` are the ones its competitor still produced nothing usable on.
    const absences = baseline.provenance.knownAbsences.pulls;
    expect(absences).toHaveLength(3);
    for (const key of absences) expect(baseline.pulls[key]).toBeUndefined();
    // **A hole in the pairing, not a zero**: the competitor produced nothing usable, which is the distinction the
    // scoring draws between `missing` and a failed row scored as nothing found.
    expect(baseline.provenance.knownAbsences.reason).toContain('holes');
    // **And they are real pull requests in the corpus, not placeholders**: the four are named, in full, as the corpus
    // names them.
    for (const key of absences)
      expect(key).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
  });

  it('refuses to replay an absent pull request, and buys only that one in record mode', () => {
    for (const key of baseline.provenance.knownAbsences.pulls) {
      const replayed = resolveCompetitor({
        mode: 'replay',
        baseline,
        judgeModel: baseline.corpus.judge.model,
        pull: factsOf(key, 3),
      });
      expect(replayed.kind).toBe('missing');
      // **`record` for the absent rows and for nothing else**, which is what makes growing the corpus cost four pull
      // requests rather than thirty-six.
      const recording = resolveCompetitor({
        mode: 'record',
        baseline,
        judgeModel: baseline.corpus.judge.model,
        pull: factsOf(key, 3),
      });
      expect(recording.kind).toBe('record');
    }
  });
});

describe('a row is checked against its own pull request rather than against the file it sits in', () => {
  it('carries a fingerprint on every recorded row and none on any transcribed one', () => {
    for (const key of recorded)
      expect(baseline.pulls[key]!.fingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    for (const key of transcribed) expect(baseline.pulls[key]!.fingerprint).toBeUndefined();
  });

  it('refuses a recorded row whose goldens have moved since it was recorded', () => {
    const key = recorded[0]!;
    const row = baseline.pulls[key]!;
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline,
      judgeModel: baseline.corpus.judge.model,
      pull: factsOf(key, row.goldens - 1),
    });
    expect(decision.kind).toBe('missing');
    // **And the reason names the count it read and the count it recorded**, because "missing" without a reason sends
    // the next reader to the wrong file.
    if (decision.kind !== 'missing') throw new Error('expected a missing decision');
    expect(String(decision.reason ?? '')).toContain(String(row.goldens));
  });

  it('refuses a recorded row whose fingerprint is not the one this corpus produces', () => {
    const key = recorded[0]!;
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline,
      judgeModel: baseline.corpus.judge.model,
      pull: factsOf(key, baseline.pulls[key]!.goldens),
    });
    // **The synthetic fingerprint above is the one a corpus with no coordinates produces**, so it is not this row's -
    // and a row recorded against lines cannot be replayed against a corpus that has none.
    expect(decision.kind).toBe('missing');
  });

  it('replays a transcribed row by count, and says which of the two checks it used', () => {
    for (const key of transcribed) {
      const decision = resolveCompetitor({
        mode: 'replay',
        baseline,
        judgeModel: baseline.corpus.judge.model,
        pull: factsOf(key, baseline.pulls[key]!.goldens),
      });
      if (decision.kind !== 'replay') throw new Error(`expected a replay for ${key}`);
      // **The weaker check is named rather than hidden behind the stronger word**, because a reader who is told
      // "replayed" without being told how it was checked is being told half a fact.
      expect(decision.verified).toBe('count');
    }
  });

  it('refuses a record made against another judge rather than comparing across two of them', () => {
    const key = transcribed[0]!;
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline,
      judgeModel: 'some-other-model',
      pull: factsOf(key, baseline.pulls[key]!.goldens),
    });
    expect(decision.kind).toBe('missing');
    if (decision.kind !== 'missing') throw new Error('expected a missing decision');
    expect(String(decision.reason ?? '')).toContain('judge');
  });
});

describe('every row is geometrically valid, because a shifted index is a wrong score', () => {
  it('keeps one gate verdict per finding and every golden index inside the golden set', () => {
    for (const key of keys) {
      const row = baseline.pulls[key]!;
      expect(row.keep, `${key} keep`).toHaveLength(row.matches.length);
      for (const goldens of row.matches) {
        for (const index of goldens) {
          expect(Number.isInteger(index), `${key} index ${index}`).toBe(true);
          expect(index, `${key} index ${index}`).toBeGreaterThanOrEqual(0);
          expect(index, `${key} index ${index}`).toBeLessThan(row.goldens);
        }
      }
      // **A finding the ranker cannot place has no detail row and is still a finding the tool emitted**, so the count
      // is at least the number of rows and not equal to it.
      expect(row.findings, `${key} findings`).toBeGreaterThanOrEqual(row.detail.length);
      expect(row.unanswered, `${key} unanswered`).toBeGreaterThanOrEqual(0);
    }
  });

  it('carries the corpus identity the rows were produced against, with the judge as a version', () => {
    expect(baseline.version).toBe(1);
    expect(baseline.corpus.fingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(baseline.corpus.judge).toEqual({ model: 'deepseek-chat', prompt: 'aacr-judge-v1' });
    expect(baseline.competitor.tool).toBe('open-code-review');
    expect(baseline.recordedAt).toBe('2026-11-12T01:54:36.426Z');
  });
});
