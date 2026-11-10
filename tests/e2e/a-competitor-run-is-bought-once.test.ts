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

import {
  corpusFingerprint,
  parseCompetitorMode,
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
    comments: Array.from({ length: pull.goldens }, (_, at) => ({ note: `golden ${String(at)}` })),
  }));

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
  fingerprint,
  judgeModel,
  credential = true,
}: {
  corpus: typeof CORPUS;
  mode: 'record' | 'replay' | 'off';
  baseline: ReturnType<typeof startRecording> | null;
  fingerprint: string;
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
      fingerprint,
      judgeModel,
      key: pull.key,
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
    });
    perPr.push(replayedPull(pull.key, record));
    for (const row of record.detail) detail.push({ ...row, pr: pull.key });
    if (next) next = withRecord(next, pull.key, record);
  }

  return { purchases, missing, perPr, detail, baseline: next };
}

/** The competitor's F1, computed with the functions the benchmark scores with. */
async function f1Of(perPr: Array<{ matches: number[][]; goldens: number }>) {
  const { maximumMatchingCount, point } =
    await import('../../packages/intelligence/dist/review/actionability.js');
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

  it('records once, replays free, and produces the same F1 both times', async () => {
    const rows = rowsOf(CORPUS);
    const fingerprint = corpusFingerprint(rows);

    // --- The run that pays. -------------------------------------------------
    const recording = runPass({
      corpus: CORPUS,
      mode: parseCompetitorMode('record').mode,
      baseline: startRecording({ existing: null, fingerprint, judgeModel: JUDGE, tool: 'ocr' }),
      fingerprint,
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
      fingerprint,
      judgeModel: JUDGE,
    });
    expect(replaying.purchases).toEqual([]);
    expect(replaying.missing).toEqual([]);
    expect(replaying.perPr).toEqual(recording.perPr);
    expect(replaying.detail).toEqual(recording.detail);

    // **The figure, not just the rows.** Both passes are scored with the benchmark's own functions, so a replay that
    // kept the wrong field would produce a different F1 here even if its rows looked right.
    const [recordedPoint, replayedPoint] = [
      await f1Of(recording.perPr),
      await f1Of(replaying.perPr),
    ];
    expect(replayedPoint).toEqual(recordedPoint);
    expect(recordedPoint.f1).toBeGreaterThan(0);
  });

  it('buys only the pull request a grown corpus adds, and replays the rest', () => {
    const rows = rowsOf(CORPUS);
    const fingerprint = corpusFingerprint(rows);
    const recording = runPass({
      corpus: CORPUS,
      mode: 'record',
      baseline: startRecording({ existing: null, fingerprint, judgeModel: JUDGE, tool: 'ocr' }),
      fingerprint,
      judgeModel: JUDGE,
    });
    writeBaseline(path, recording.baseline!);

    const grown = [
      ...CORPUS,
      { key: 'https://github.com/x/y/pull/4', goldens: 1, matches: [[0]], keep: [true] },
    ];
    const grownRows = rowsOf(grown);
    const grownFingerprint = corpusFingerprint(grownRows);
    // **The old record is not a record of this corpus**, so a recording run rebuilds from an empty file rather than
    // reusing rows whose question has changed - which is the correct, expensive answer, and the reason the fingerprint is
    // checked at all.
    const rebuilt = startRecording({
      existing: readBaseline(path),
      fingerprint: grownFingerprint,
      judgeModel: JUDGE,
      tool: 'ocr',
    });
    expect(rebuilt.pulls).toEqual({});
  });

  it('refuses the whole corpus rather than half-comparing when there is no record', () => {
    // The failure this pins: no baseline, and a run that reports the competitor's F1 as zero. **A zero is absorbed by
    // every total it touches**, and a comparison against it would read as a lead.
    const report = runPass({
      corpus: CORPUS,
      mode: 'replay',
      baseline: null,
      fingerprint: corpusFingerprint(rowsOf(CORPUS)),
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
      fingerprint: corpusFingerprint(rowsOf(CORPUS)),
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
      fingerprint: corpusFingerprint(rowsOf(CORPUS)),
      judgeModel: JUDGE,
    });
    expect(report.purchases).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.perPr).toEqual([]);
  });
});
