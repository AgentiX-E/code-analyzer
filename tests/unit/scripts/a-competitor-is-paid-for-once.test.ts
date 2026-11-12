// The competitor arm is bought once per corpus, and the price of a mistake is asymmetric.
//
// **The bill this file was written against.** One run of the AACR benchmark on 2026-11-10 cost 8.53 USD, and 5.89 USD of
// it was the competitor: a second reviewer driven through its own CLI, from the same key, over the same fourteen pull
// requests whose goldens had not changed. **The figure it produces is a property of the corpus, not of this project's
// code** - which is why it is the target to beat and why buying it again produces a second invoice rather than a second
// measurement.
//
// **So the default replays, and every way of failing to replay is named.** These tests hold both halves: that the three
// fields the scoring consumes survive a round trip byte for byte, and that a missing baseline is reported rather than
// silently purchased.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompetitorDecision } from '../../../.github/scripts/lib/competitor-baseline.mjs';
import {
  BASELINE_VERSION,
  JUDGE_PROMPT_VERSION,
  corpusFingerprint,
  describeDecision,
  pullFingerprint,
  emptyBaseline,
  parseCompetitorMode,
  readBaseline,
  recordedPull,
  refreshProvenance,
  replayedPull,
  resolveCompetitor,
  startRecording,
  withRecord,
  writeBaseline,
} from '../../../.github/scripts/lib/competitor-baseline.mjs';

const CORPUS = [
  { githubPrUrl: 'https://github.com/a/b/pull/1', comments: [{ note: 'one' }, { note: 'two' }] },
  { githubPrUrl: 'https://github.com/a/b/pull/2', comments: [{ note: 'three' }] },
];

const JUDGE = 'deepseek-chat';

/** The reason a decision carries, or the empty string when it carries none. */
function reasonOf(decision: CompetitorDecision): string {
  return 'reason' in decision ? (decision.reason ?? '') : '';
}

/**
 * One corpus row as the resolver sees it.
 *
 * **The resolver is handed the row's own facts rather than the selection's**, which is the change these tests now hold:
 * a recorded row is a function of this pull request's goldens and of nothing else.
 */
function pullOf(row: { githubPrUrl: string; comments: unknown[] }, key = row.githubPrUrl) {
  return {
    key,
    fingerprint: pullFingerprint(row),
    goldens: Array.isArray(row.comments) ? row.comments.length : 0,
  };
}

function baselineFor(fingerprint: string) {
  return emptyBaseline({ fingerprint, judgeModel: JUDGE, tool: 'open-code-review' });
}

describe('the mode is read so that a typo cannot buy a run', () => {
  it('defaults to replay when nothing is set', () => {
    const { mode, reason } = parseCompetitorMode(undefined);
    expect(mode).toBe('replay');
    expect(reason).toContain('no mode was set');
  });

  it('accepts the three modes, in any case and with surrounding space', () => {
    expect(parseCompetitorMode('record').mode).toBe('record');
    expect(parseCompetitorMode(' Replay ').mode).toBe('replay');
    expect(parseCompetitorMode('OFF').mode).toBe('off');
  });

  it('replays rather than records when the value is not a mode, and says which value it read', () => {
    const { mode, reason } = parseCompetitorMode('recrod');
    expect(mode).toBe('replay');
    expect(reason).toContain('recrod');
    // The asymmetry: a stale figure is a wrong number, a stray purchase is a bill.
    expect(reason).toContain('rather than a run bought');
  });
});

describe('the corpus fingerprint identifies the corpus and nothing else', () => {
  it('does not depend on the order of the rows', () => {
    expect(corpusFingerprint([...CORPUS].reverse())).toBe(corpusFingerprint(CORPUS));
  });

  it('moves when a golden is added, because the same pull request asks a different question', () => {
    const edited = [
      { ...CORPUS[0]!, comments: [...CORPUS[0]!.comments, { note: 'four' }] },
      CORPUS[1]!,
    ];
    expect(corpusFingerprint(edited)).not.toBe(corpusFingerprint(CORPUS));
  });

  it('moves when a pull request is added or removed', () => {
    expect(corpusFingerprint([CORPUS[0]!])).not.toBe(corpusFingerprint(CORPUS));
  });

  it('is a prefixed digest rather than the corpus itself, so a file can carry it in a key', () => {
    const fingerprint = corpusFingerprint(CORPUS);
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(fingerprint).not.toContain('pull/1');
  });
});

describe('the decision names the first thing that is wrong', () => {
  const fingerprint = corpusFingerprint(CORPUS);
  const key = CORPUS[0]!.githubPrUrl;
  const pull = pullOf(CORPUS[0]!);

  const recorded = withRecord(
    baselineFor(fingerprint),
    key,
    recordedPull({
      matches: [[0], []],
      goldens: 2,
      keep: [true, false],
      detail: [],
      unanswered: 0,
      fingerprint: pull.fingerprint,
    }),
  );

  it('switches off without reading anything', () => {
    const decision = resolveCompetitor({
      mode: 'off',
      baseline: null,
      judgeModel: JUDGE,
      pull,
    });
    expect(decision.kind).toBe('off');
  });

  it('records from any state, because recording is what produces the file', () => {
    const decision = resolveCompetitor({
      mode: 'record',
      baseline: null,
      judgeModel: JUDGE,
      pull,
    });
    expect(decision.kind).toBe('record');
  });

  it('replays the recorded pull request when its goldens and the judge are the same', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      judgeModel: JUDGE,
      pull,
    });
    if (decision.kind !== 'replay') throw new Error(`expected a replay, got ${decision.kind}`);
    expect(decision.pull).toEqual(recorded.pulls[key]);
    // **And how it was checked travels with it**, because a figure resting on fingerprint-checked rows and one resting
    // on count-checked rows are not the same figure even though both are called a replay.
    expect(decision.verified).toBe('fingerprint');
  });

  it('replays a row recorded before per-pull fingerprints existed, and says it was checked by count', () => {
    // **The fourteen rows of 2026-11-09 are this case**: transcribed from an artifact that carried the golden count and
    // not the goldens, so the strongest check available is the count. **Reporting the weaker check is the difference
    // between a verified replay and an assumed one** - and refusing these rows would have thrown away fourteen rows the
    // project paid 5.89 USD for.
    const legacy = withRecord(
      baselineFor(fingerprint),
      key,
      recordedPull({ matches: [[0]], goldens: 2, keep: [true], detail: [], unanswered: 0 }),
    );
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: legacy,
      judgeModel: JUDGE,
      pull,
    });
    if (decision.kind !== 'replay') throw new Error(`expected a replay, got ${decision.kind}`);
    expect(decision.verified).toBe('count');
  });

  it('replays a corpus that grew, because a smaller record is a prefix and not a different corpus', () => {
    // **The defect of 2026-11-10, as a test.** The baseline was recorded over fourteen pull requests; the run asked for
    // fifty; the whole-selection fingerprint moved and **every row was refused, including the fourteen whose own inputs
    // had not changed** - so the arm built to be free replayed nothing, and the artifact then published the resulting
    // absence of a competitor as an 83-to-0 win.
    const wider = [
      ...CORPUS,
      { githubPrUrl: 'https://github.com/a/b/pull/3', comments: [{ note: 'x' }] },
    ];
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      judgeModel: JUDGE,
      pull,
    });
    expect(decision.kind).toBe('replay');
    // And the selection fingerprint really did move, so this is not a test of an unchanged value.
    expect(corpusFingerprint(wider)).not.toBe(corpusFingerprint(CORPUS));
  });

  it('refuses a pull request whose goldens moved, and names both fingerprints', () => {
    const edited = {
      githubPrUrl: CORPUS[0]!.githubPrUrl,
      comments: [{ note: 'one' }, { path: 'a.ts', line: 9 }],
    };
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      judgeModel: JUDGE,
      pull: pullOf(edited),
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('goldens moved');
    expect(reasonOf(decision)).toContain(pull.fingerprint);
  });

  it('refuses a pull request whose golden count moved, even without a fingerprint to compare', () => {
    const legacy = withRecord(
      baselineFor(fingerprint),
      key,
      recordedPull({ matches: [[0]], goldens: 2, keep: [true], detail: [], unanswered: 0 }),
    );
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: legacy,
      judgeModel: JUDGE,
      pull: { ...pull, goldens: 1 },
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('1 goldens');
    expect(reasonOf(decision)).toContain('recorded 2');
  });

  it('reports a missing baseline instead of buying one', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: null,
      judgeModel: JUDGE,
      pull,
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('no competitor baseline');
  });

  it('refuses a baseline recorded against a different judge, because the judge moves the number', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      judgeModel: 'some-other-model',
      pull,
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('the judge changed');
    expect(reasonOf(decision)).toContain('some-other-model');
  });

  it('reports a pull request that the baseline does not cover', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      judgeModel: JUDGE,
      pull: pullOf(CORPUS[0]!, 'https://github.com/a/b/pull/99'),
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('pull/99');
  });

  it('buys only what a recording run does not already hold, because the row is an input in both live modes', () => {
    // **The second place the same mistake was made.** The first version of the resolver sent every pull request to the
    // purchase whenever the mode was `record`, so growing a record from fourteen rows to fifty cost fifty - the same
    // number bought twice, by the one mode whose entire purpose is to buy it once.
    const decision = resolveCompetitor({
      mode: 'record',
      baseline: recorded,
      judgeModel: JUDGE,
      pull,
    });
    expect(decision.kind).toBe('replay');
    const unheld = resolveCompetitor({
      mode: 'record',
      baseline: recorded,
      judgeModel: JUDGE,
      pull: pullOf(CORPUS[1]!),
    });
    expect(unheld.kind).toBe('record');
    // And the reason a purchase happened is carried, so a log line can say why this pull request cost money.
    expect(reasonOf(unheld)).toContain('absent from the recorded baseline');
  });

  it('describes every decision in one line, for the log a human reads', () => {
    const empty = recordedPull({ matches: [], goldens: 0, keep: [], detail: [] });
    expect(describeDecision({ kind: 'off', reason: 'switched off' }, 'pull/1')).toContain('off');
    expect(describeDecision({ kind: 'record' }, 'pull/1')).toContain('recording');
    expect(
      describeDecision({ kind: 'replay', pull: empty, verified: 'fingerprint' }, 'pull/1'),
    ).toContain('goldens matched');
    expect(
      describeDecision({ kind: 'replay', pull: empty, verified: 'count' }, 'pull/1'),
    ).toContain('golden count only');
    expect(describeDecision({ kind: 'missing', reason: 'no file' }, 'pull/1')).toContain('no file');
    // A decision with no reason is still a sentence rather than the string "undefined".
    expect(describeDecision({ kind: 'missing' }, 'pull/1')).toContain('no reason recorded');
  });
});

describe('recording a pull request does not edit the baseline being read', () => {
  it('returns a new object and leaves the original untouched', () => {
    const fingerprint = corpusFingerprint(CORPUS);
    const before = baselineFor(fingerprint);
    const after = withRecord(
      before,
      'pull/1',
      recordedPull({ matches: [], goldens: 0, keep: [], detail: [], unanswered: 0 }),
    );
    expect(Object.keys(before.pulls)).toEqual([]);
    expect(Object.keys(after.pulls)).toEqual(['pull/1']);
  });

  it('keeps the earlier records when a second one is added', () => {
    const first = withRecord(
      baselineFor('sha256:0'.padEnd(39, '0')),
      'pull/1',
      recordedPull({ matches: [[0]], goldens: 1, keep: [true], detail: [], unanswered: 0 }),
    );
    const second = withRecord(
      first,
      'pull/2',
      recordedPull({ matches: [], goldens: 1, keep: [false], detail: [], unanswered: 1 }),
    );
    expect(Object.keys(second.pulls).sort()).toEqual(['pull/1', 'pull/2']);
    expect(second.pulls['pull/1']!.matches).toEqual([[0]]);
  });
});

describe('a recording run grows the file it already has, and replaces one of another corpus', () => {
  it('keeps the rows of the same corpus, so a partial run does not throw away what it paid for', () => {
    const fingerprint = corpusFingerprint(CORPUS);
    const existing = withRecord(
      baselineFor(fingerprint),
      'pull/1',
      recordedPull({ matches: [[0]], goldens: 2, keep: [true], detail: [], unanswered: 0 }),
    );
    const started = startRecording({ existing, fingerprint, judgeModel: JUDGE, tool: 'ocr' });
    expect(Object.keys(started.pulls)).toEqual(['pull/1']);
  });

  it('keeps the rows of a smaller record, because a prefix is not a different corpus', () => {
    const existing = withRecord(
      baselineFor(corpusFingerprint([CORPUS[0]!])),
      'pull/1',
      recordedPull({ matches: [[0]], goldens: 2, keep: [true], detail: [], unanswered: 0 }),
    );
    const started = startRecording({
      existing,
      fingerprint: corpusFingerprint(CORPUS),
      judgeModel: JUDGE,
      tool: 'ocr',
    });
    // **Rows are kept and the selection is re-stated**, because a recording run that grew its corpus satisfies the rows
    // it already holds: dropping them would have re-bought fourteen pull requests on top of the refusal that stopped
    // them replaying - two defects with one cause, which is a guard aimed at the selection instead of at the row.
    expect(Object.keys(started.pulls)).toEqual(['pull/1']);
    expect(started.corpus.fingerprint).toBe(corpusFingerprint(CORPUS));
  });

  it("replaces the rows of another judge, because a verdict is that judge's answer", () => {
    const fingerprint = corpusFingerprint(CORPUS);
    const existing = withRecord(
      baselineFor(fingerprint),
      'pull/1',
      recordedPull({ matches: [[0]], goldens: 2, keep: [true], detail: [], unanswered: 0 }),
    );
    const started = startRecording({
      existing,
      fingerprint,
      judgeModel: 'another-model',
      tool: 'ocr',
    });
    expect(Object.keys(started.pulls)).toEqual([]);
    expect(started.corpus.judge.model).toBe('another-model');
  });
});

describe('a recorded pull request survives the file it is written to', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'competitor-baseline-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips the three fields the scoring reads, byte for byte', () => {
    const path = join(dir, 'nested', 'baseline.json');
    const fingerprint = corpusFingerprint(CORPUS);
    const pull = recordedPull({
      matches: [[0, 1], [], [2]],
      goldens: 3,
      keep: [true, false, true],
      detail: [
        { path: 'a.ts', startLine: 4, endLine: 4, actionable: true, matchedGoldens: [0, 1] },
      ],
      unanswered: 1,
    });
    writeBaseline(path, withRecord(baselineFor(fingerprint), 'pull/1', pull));

    const read = readBaseline(path);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(BASELINE_VERSION);
    expect(read!.corpus.judge.prompt).toBe(JUDGE_PROMPT_VERSION);
    expect(read!.pulls['pull/1']).toEqual(pull);
    expect(replayedPull('pull/1', read!.pulls['pull/1']!)).toEqual({
      key: 'pull/1',
      matches: [[0, 1], [], [2]],
      goldens: 3,
      keep: [true, false, true],
    });
  });

  it('writes a file that ends in a newline, so a diff of two records is a diff of their values', () => {
    const path = join(dir, 'baseline.json');
    writeBaseline(path, baselineFor(corpusFingerprint(CORPUS)));
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
  });

  it('returns null for a file that does not exist, because the first run of a clone has nothing to replay', () => {
    expect(readBaseline(join(dir, 'absent.json'))).toBeNull();
  });

  it('refuses a file of another version rather than reading it as if the shape had not changed', () => {
    const path = join(dir, 'old.json');
    writeFileSync(path, JSON.stringify({ version: BASELINE_VERSION - 1, pulls: {} }));
    expect(() => readBaseline(path)).toThrow(/version 0/);
  });
});

describe('the two paths hand the scoring the same thing', () => {
  it('copies rather than aliases, so a consumer that sorts in place cannot edit the record', () => {
    const pull = recordedPull({
      matches: [[2, 0]],
      goldens: 3,
      keep: [true],
      detail: [{ path: 'a.ts' }],
      unanswered: 0,
    });
    const replayed = replayedPull('pull/1', pull);
    replayed.matches[0]!.sort((left, right) => left - right);
    expect(pull.matches[0]).toEqual([2, 0]);
    expect(replayed.matches[0]).toEqual([0, 2]);
  });

  it('turns a recorded truthy into a boolean, because the gate is read as a boolean', () => {
    const pull = recordedPull({ matches: [], goldens: 0, keep: [1], detail: [], unanswered: 0 });
    expect(pull.keep).toEqual([true]);
    expect(replayedPull('pull/1', pull).keep).toEqual([true]);
  });

  it('keeps the count the tool claimed apart from the rows the ranker could place', () => {
    // A finding with no place in the diff has no row and is still a finding the tool emitted, so the count is stored
    // rather than inferred from the rows.
    expect(recordedPull({ matches: [], goldens: 0, keep: [], detail: [{}, {}] }).findings).toBe(2);
    expect(
      recordedPull({ matches: [], goldens: 0, keep: [], detail: [{}], findings: 9 }).findings,
    ).toBe(9);
  });
});

describe('a record that grows describes itself from its own rows', () => {
  const row = (fingerprint?: string) => ({
    matches: [],
    goldens: 3,
    keep: [],
    detail: [],
    unanswered: 0,
    findings: 0,
    ...(fingerprint === undefined ? {} : { fingerprint }),
  });

  const grown = () => ({
    version: BASELINE_VERSION,
    recordedAt: '2026-11-12T00:00:00.000Z',
    corpus: { fingerprint: 'sha256:x', judge: { model: JUDGE, prompt: JUDGE_PROMPT_VERSION } },
    competitor: { tool: 'open-code-review' },
    provenance: {
      measuredAt: '2026-11-09',
      origins: [
        // **The sentence with a count in it**, which is the one that went stale in the file this function was written
        // for: it said "32 rows" while the file held 33.
        { how: 'recorded', pulls: 32, run: '2026-11-09', checkedBy: 'the replay of these 32 rows' },
        { how: 'transcribed', pulls: 14, run: '2026-11-09', checkedBy: 'the golden count' },
      ],
      knownAbsences: { pulls: ['https://github.com/a/b/pull/1'], reason: 'holes' },
    },
    pulls: {
      'https://github.com/a/b/pull/1': row('sha256:one'),
      'https://github.com/a/b/pull/2': row('sha256:two'),
      'https://github.com/a/b/pull/3': row(),
    },
  });

  it('counts recorded and transcribed from the fingerprint, which is the rule the resolver applies', () => {
    const refreshed = refreshProvenance(grown(), {
      selection: ['https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/2'],
      run: '2026-11-12',
    });
    const origins = refreshed.provenance?.origins ?? [];
    expect(origins.find((origin) => origin.how === 'recorded')?.pulls).toBe(2);
    expect(origins.find((origin) => origin.how === 'transcribed')?.pulls).toBe(1);
    // **And the run that did the recording is the date the origin states**, which is what a reader checks the rows
    // against.
    expect(origins.find((origin) => origin.how === 'recorded')?.run).toBe('2026-11-12');
  });

  it('drops the count from the sentence, because the count is in the rows', () => {
    const refreshed = refreshProvenance(grown(), { selection: [], run: '2026-11-12' });
    const recordedOrigin = refreshed.provenance?.origins?.find(
      (origin) => origin.how === 'recorded',
    );
    expect(recordedOrigin?.checkedBy ?? '').not.toContain('32');
    expect(recordedOrigin?.checkedBy ?? '').toContain('fingerprint');
  });

  it('closes a hole the run filled, and keeps the ones it did not', () => {
    // The selection is the corpus this run scored: a pull request in it with a row is no longer absent, and one the
    // file still has no row for stays listed.
    const refreshed = refreshProvenance(grown(), {
      selection: ['https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/9'],
      run: '2026-11-12',
    });
    expect(refreshed.provenance?.knownAbsences?.pulls).toEqual(['https://github.com/a/b/pull/9']);
  });

  it('states a span rather than a list of dates, and covers the run that just wrote the file', () => {
    const refreshed = refreshProvenance(grown(), { selection: [], run: '2026-11-12' });
    expect(refreshed.provenance?.measuredAt).toBe('2026-11-09 and 2026-11-12');
    // **And says so plainly when there is nothing absent**, rather than leaving an empty list to be read as silence.
    const complete = refreshProvenance(grown(), { selection: [], run: '2026-11-12' });
    expect(complete.provenance?.knownAbsences?.pulls).toEqual([]);
  });
});
