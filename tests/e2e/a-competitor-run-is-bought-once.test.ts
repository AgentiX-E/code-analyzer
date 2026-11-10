// The competitor is bought once per corpus, and the number it produced does not change when it is replayed.
//
// **This is the user story the module exists for.** On 2026-11-10 one run cost 8.53 USD and 69 % of it was the competitor
// arm - a second reviewer over fourteen pull requests whose goldens had not changed. **The figure that arm produces is a
// property of the corpus**, so the second run should read it, not buy it.
//
// **What makes this an end-to-end test rather than a unit test of a decision.** It runs the whole loop a benchmark run
// runs - one decision per pull request, a record written to a real file, a second pass that replays from that file - and
// then computes the competitor's F1 from both passes with the real scoring functions, asserting that the two figures are
// the same number. **A replay that reconstructs `matches` but loses `keep` would pass a decision test and fail here.**

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// **The source, not the build.** A path into `dist/` resolves against the project root inside vitest and lands at
// `/packages/...`, which is the failure this file shipped for one push: `Cannot find module`. The scoring functions are
// the ones the benchmark uses, imported from the file that defines them.
import {
  maximumMatchingCount,
  point,
} from '../../packages/intelligence/src/review/actionability.js';

import {
  corpusFingerprint,
  parseCompetitorMode,
  pullFingerprint,
  readBaseline,
  recordedPull,
  replayedPull,
  resolveCompetitor,
  startRecording,
  withRecord,
  writeBaseline,
} from '../../.github/scripts/lib/competitor-baseline.mjs';

const JUDGE = 'deepseek-chat';

/** The corpus, as the benchmark reads it: a pull request, its goldens, and what both reviewers said about it. */
const CORPUS = [
  {
    key: 'https://github.com/x/y/pull/1',
    goldens: 3,
    // What the competitor emitted, already ranked: one finding matching goldens 0 and 1, one matching none.
    matches: [[0, 1], [], [2]],
    keep: [true, false, true],
  },
  {
    key: 'https://github.com/x/y/pull/2',
    goldens: 2,
    matches: [[0], []],
    keep: [true, false],
  },
  {
    key: 'https://github.com/x/y/pull/3',
    goldens: 4,
    matches: [[], [3], [1], [2]],
    keep: [false, true, true, true],
  },
];

const rowsOf = (corpus: typeof CORPUS) =>
  corpus.map((pull) => ({
    githubPrUrl: pull.key,
    comments: Array.from({ length: pull.goldens }, (_, at) => ({
      path: `f${String(at)}.ts`,
      line: at + 1,
    })),
  }));

/**
 * **One corpus row as the resolver sees it: its key, its goldens, and the fingerprint of those goldens.**
 *
 * **The resolver is handed this instead of the selection's fingerprint**, and the difference is the defect this file now
 * guards: a recorded row is a function of one pull request's goldens and not of how many pull requests the run selected,
 * so a corpus that grew from three pull requests to four *satisfies* the three it already holds.
 */
const factsOf = (pull: (typeof CORPUS)[number]) => ({
  key: pull.key,
  goldens: pull.goldens,
  fingerprint: pullFingerprint({
    githubPrUrl: pull.key,
    comments: Array.from({ length: pull.goldens }, (_, at) => ({
      path: `f${String(at)}.ts`,
      line: at + 1,
    })),
  }),
});

type Purchase = { key: string; at: number };

/**
 * **One pass over the corpus, in the shape the benchmark loop has.**
 *
 * `buy` is the only thing that spends money; it is a real function here and not a mock, and the test asserts on how many
 * times it ran rather than on whether it was called. **A pass that is asked to buy and cannot** - no credential, no
 * baseline - records the reason and moves on, which is what the script does.
 */
function runPass({
  corpus,
  mode,
  baseline,
  judgeModel,
  credential = true,
}: {
  corpus: typeof CORPUS;
  mode: 'record' | 'replay' | 'off';
  baseline: ReturnType<typeof startRecording> | null;
  judgeModel: string;
  credential?: boolean;
}) {
  const purchases: Purchase[] = [];
  const missing: Array<{ key: string; reason: string }> = [];
  const perPr: Array<{ key: string; matches: number[][]; goldens: number; keep: boolean[] }> = [];
  const detail: Array<Record<string, unknown>> = [];
  let next = baseline;

  for (const pull of corpus) {
    const decision = resolveCompetitor({
      mode,
      baseline: next,
      judgeModel,
      pull: factsOf(pull),
    });
    if (decision.kind === 'replay') {
      perPr.push(replayedPull(pull.key, decision.pull));
      for (const row of decision.pull.detail ?? []) detail.push({ ...row, pr: pull.key });
      continue;
    }
    if (decision.kind === 'missing') {
      missing.push({ key: pull.key, reason: decision.reason ?? 'no reason recorded' });
      continue;
    }
    if (decision.kind === 'off') continue;
    if (!credential) {
      missing.push({ key: pull.key, reason: 'no competitor credential is configured' });
      continue;
    }
    // The purchase: the competitor's CLI ran, the judge answered, and the rows are what came back.
    purchases.push({ key: pull.key, at: purchases.length });
    const record = recordedPull({
      matches: pull.matches,
      goldens: pull.goldens,
      keep: pull.keep,
      detail: pull.matches.map((matched, at) => ({
        path: `f${String(at)}.ts`,
        matchedGoldens: matched,
      })),
      unanswered: 0,
      findings: pull.matches.length,
      fingerprint: factsOf(pull).fingerprint,
    });
    perPr.push(replayedPull(pull.key, record));
    for (const row of record.detail) detail.push({ ...row, pr: pull.key });
    if (next) next = withRecord(next, pull.key, record);
  }

  return { purchases, missing, perPr, detail, baseline: next };
}

/** The competitor's F1, computed with the functions the benchmark scores with. */
function f1Of(perPr: Array<{ matches: number[][]; goldens: number }>) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let emitted = 0;
  let goldens = 0;
  for (const pull of perPr) {
    truePositives += maximumMatchingCount(pull.matches, pull.goldens);
    emitted += pull.matches.length;
    goldens += pull.goldens;
  }
  falsePositives = emitted - truePositives;
  falseNegatives = goldens - truePositives;
  return point(emitted, truePositives, falsePositives, falseNegatives);
}

describe('the competitor arm is bought once and read afterwards', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aacr-competitor-'));
    path = join(dir, 'competitor-baseline.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records once, replays free, and produces the same F1 both times', () => {
    const rows = rowsOf(CORPUS);
    const fingerprint = corpusFingerprint(rows);

    // --- The run that pays. -------------------------------------------------
    const recording = runPass({
      corpus: CORPUS,
      mode: parseCompetitorMode('record').mode,
      baseline: startRecording({ existing: null, fingerprint, judgeModel: JUDGE, tool: 'ocr' }),
      judgeModel: JUDGE,
    });
    expect(recording.purchases).toHaveLength(CORPUS.length);
    expect(recording.missing).toEqual([]);
    writeBaseline(path, { ...recording.baseline!, recordedAt: '2026-11-10T00:00:00.000Z' });
    // A real file on a real disk, because the round trip through JSON is where a `Map` or a `Set` would have been lost.
    expect(statSync(path).size).toBeGreaterThan(0);

    // --- The run that reads. ------------------------------------------------
    const replaying = runPass({
      corpus: CORPUS,
      mode: parseCompetitorMode(undefined).mode,
      baseline: readBaseline(path),
      judgeModel: JUDGE,
    });
    expect(replaying.purchases).toEqual([]);
    expect(replaying.missing).toEqual([]);
    expect(replaying.perPr).toEqual(recording.perPr);
    expect(replaying.detail).toEqual(recording.detail);

    // **The figure, not just the rows.** Both passes are scored with the benchmark's own functions, so a replay that
    // kept the wrong field would produce a different F1 here even if its rows looked right.
    const [recordedPoint, replayedPoint] = [f1Of(recording.perPr), f1Of(replaying.perPr)];
    expect(replayedPoint).toEqual(recordedPoint);
    expect(recordedPoint.f1).toBeGreaterThan(0);
  });

  it('buys only the pull request a grown corpus adds, and replays the rest', () => {
    // **The title of this test was true of its intention and false of its assertions for one iteration.** It set out that
    // a grown corpus buys only what it adds, and then asserted that the record was emptied - because the guard it was
    // written against compared the *selection* fingerpprint. The run of 2026-11-10 measured the same guard from the other
    // side: fourteen recorded rows, fifty requested, **all fifty refused**, and the free arm replayed nothing.
    const rows = rowsOf(CORPUS);
    const fingerprint = corpusFingerprint(rows);
    const recording = runPass({
      corpus: CORPUS,
      mode: 'record',
      baseline: startRecording({ existing: null, fingerprint, judgeModel: JUDGE, tool: 'ocr' }),
      judgeModel: JUDGE,
    });
    writeBaseline(path, recording.baseline!);
    expect(recording.purchases).toHaveLength(CORPUS.length);

    const grown = [
      ...CORPUS,
      { key: 'https://github.com/x/y/pull/4', goldens: 1, matches: [[0]], keep: [true] },
    ];
    // **The old record is kept**, because the three pull requests it holds have not changed; only the selection did.
    const kept = startRecording({
      existing: readBaseline(path),
      fingerprint: corpusFingerprint(rowsOf(grown)),
      judgeModel: JUDGE,
      tool: 'ocr',
    });
    expect(Object.keys(kept.pulls)).toHaveLength(CORPUS.length);

    // **And the grown run pays for one pull request, not four.** The bill for growing a record is the size of the
    // growth, which is the whole point of the module.
    const second = runPass({
      corpus: grown,
      mode: 'record',
      baseline: kept,
      judgeModel: JUDGE,
    });
    expect(second.purchases).toHaveLength(1);
    expect(second.purchases[0]!.key).toBe('https://github.com/x/y/pull/4');
    expect(second.missing).toEqual([]);
  });

  it('refuses the whole corpus rather than half-comparing when there is no record', () => {
    // The failure this pins: no baseline, and a run that reports the competitor's F1 as zero. **A zero is absorbed by
    // every total it touches**, and a comparison against it would read as a lead.
    const report = runPass({
      corpus: CORPUS,
      mode: 'replay',
      baseline: null,
      judgeModel: JUDGE,
    });
    expect(report.purchases).toEqual([]);
    expect(report.perPr).toEqual([]);
    expect(report.missing).toHaveLength(CORPUS.length);
    expect(report.missing[0]!.reason).toContain('no competitor baseline');
  });

  it('reports a recording run with no credential as missing rows, not as a competitor that found nothing', () => {
    const report = runPass({
      corpus: CORPUS,
      mode: 'record',
      baseline: startRecording({
        existing: null,
        fingerprint: corpusFingerprint(rowsOf(CORPUS)),
        judgeModel: JUDGE,
        tool: 'ocr',
      }),
      judgeModel: JUDGE,
      credential: false,
    });
    expect(report.purchases).toEqual([]);
    expect(report.perPr).toEqual([]);
    expect(report.missing).toHaveLength(CORPUS.length);
    expect(report.missing[0]!.reason).toContain('no competitor credential');
  });

  it('keeps the arm out of the bill entirely when it is switched off', () => {
    const report = runPass({
      corpus: CORPUS,
      mode: 'off',
      baseline: null,
      judgeModel: JUDGE,
    });
    expect(report.purchases).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.perPr).toEqual([]);
  });
});
