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
  emptyBaseline,
  parseCompetitorMode,
  readBaseline,
  recordedPull,
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

  const recorded = withRecord(
    baselineFor(fingerprint),
    key,
    recordedPull({
      matches: [[0], []],
      goldens: 2,
      keep: [true, false],
      detail: [],
      unanswered: 0,
    }),
  );

  it('switches off without reading anything', () => {
    const decision = resolveCompetitor({
      mode: 'off',
      baseline: null,
      fingerprint,
      judgeModel: JUDGE,
      key,
    });
    expect(decision.kind).toBe('off');
  });

  it('records from any state, because recording is what produces the file', () => {
    const decision = resolveCompetitor({
      mode: 'record',
      baseline: null,
      fingerprint,
      judgeModel: JUDGE,
      key,
    });
    expect(decision.kind).toBe('record');
  });

  it('replays the recorded pull request when the corpus and the judge are the same', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      fingerprint,
      judgeModel: JUDGE,
      key,
    });
    if (decision.kind !== 'replay') throw new Error(`expected a replay, got ${decision.kind}`);
    expect(decision.pull).toEqual(recorded.pulls[key]);
  });

  it('reports a missing baseline instead of buying one', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: null,
      fingerprint,
      judgeModel: JUDGE,
      key,
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('no competitor baseline');
  });

  it('refuses a baseline recorded on a different corpus, and names both fingerprints', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      fingerprint: corpusFingerprint([CORPUS[0]!]),
      judgeModel: JUDGE,
      key,
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('the corpus changed');
    expect(reasonOf(decision)).toContain(fingerprint);
  });

  it('refuses a baseline recorded against a different judge, because the judge moves the number', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      fingerprint,
      judgeModel: 'some-other-model',
      key,
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('the judge changed');
    expect(reasonOf(decision)).toContain('some-other-model');
  });

  it('reports a pull request that the baseline does not cover', () => {
    const decision = resolveCompetitor({
      mode: 'replay',
      baseline: recorded,
      fingerprint,
      judgeModel: JUDGE,
      key: 'https://github.com/a/b/pull/99',
    });
    expect(decision.kind).toBe('missing');
    expect(reasonOf(decision)).toContain('pull/99');
  });

  it('describes every decision in one line, for the log a human reads', () => {
    const empty = recordedPull({ matches: [], goldens: 0, keep: [], detail: [] });
    expect(describeDecision({ kind: 'off', reason: 'switched off' }, 'pull/1')).toContain('off');
    expect(describeDecision({ kind: 'record' }, 'pull/1')).toContain('recording');
    expect(describeDecision({ kind: 'replay', pull: empty }, 'pull/1')).toContain('replayed');
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

  it('replaces the rows of another corpus, because they are not a prefix of this one', () => {
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
    expect(Object.keys(started.pulls)).toEqual([]);
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
