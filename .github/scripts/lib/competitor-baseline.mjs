// **A competitor result is an input, not a cost of every run.**
//
// The benchmark in `.github/scripts/aacr-bench.mjs` scores this project against a direct competitor on the competitor's
// own fifty pull requests. On 2026-11-10 one run of that job cost 8.53 USD, and **5.89 USD of it - 69 % - was the
// competitor arm**: a second reviewer, driven through its own CLI, spending from the same provider key, billed to this
// repository, on a corpus whose goldens had not changed since the previous run.
//
// **The figure that arm produces is a constant of the corpus.** It does not move when this project's prompt changes,
// when a lane is rewritten, or when the review engine gets better - which is precisely why it is the *target*. Buying it
// again on every run is buying the same number twice and calling the second purchase a measurement.
//
// **So the arm is recorded once and replayed thereafter.** `record` runs the competitor and writes what it said; `replay`
// reads that file and reconstructs exactly the three fields the scoring consumes - `matches`, `goldens`, `keep` - and
// the detail rows the artifact publishes. **Nothing in the arithmetic can tell the two apart**, which is the property
// this module exists to make checkable rather than hopeful.
//
// **And the default is `replay`, not `record`.** A module whose default spends money is a module that spends money on
// the day someone forgets to configure it. The failure mode of a missing baseline is therefore a **named `missing`
// decision** - reported in the artifact, counted, and excluded from the comparison - rather than a silent purchase.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The schema of the baseline file. A reader that cannot state its version cannot refuse the wrong one. */
export const BASELINE_VERSION = 1;

/** Where the recorded competitor result lives, relative to the repository root. */
export const DEFAULT_BASELINE_PATH = 'benchmarks/aacr/competitor-baseline.json';

/**
 * **The identity of the judge prompt, as a version rather than as a hash of the file.**
 *
 * A baseline is only reusable while the question it answers stays the same, and the question is the judge prompt. A
 * hand-kept version string is a promise; **it is the cheapest form of that promise that a reviewer can diff**, and the
 * alternative - hashing the prompt source at run time - would couple a data file to the file layout of a script.
 */
export const JUDGE_PROMPT_VERSION = 'aacr-judge-v1';

/** The three modes, in the order a reader should try them: cheapest and safe first. */
const MODES = ['replay', 'record', 'off'];

/**
 * Read a mode from an environment variable.
 *
 * **An unrecognised value replays rather than records**, and says so through the second element of the return value,
 * because **the two failure modes are not symmetric**: a typo that silently replays produces a figure that is merely
 * stale, while a typo that silently records produces a bill. A default that spends money is the defect this whole
 * module was written against.
 */
export function parseCompetitorMode(raw) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (text === '')
    return { mode: 'replay', reason: 'no mode was set, so the recorded result is replayed' };
  if (MODES.includes(text)) return { mode: text, reason: null };
  return {
    mode: 'replay',
    reason: `"${text}" is not one of ${MODES.join(', ')}, so the recorded result is replayed rather than a run bought`,
  };
}

/**
 * **A fingerprint of the corpus, so a stale baseline is refused rather than reused.**
 *
 * The competitor's figure is a function of the pull requests and their goldens. Add a pull request, remove one, or edit
 * a golden, and the recorded number stops being the number the same corpus would produce today - **and a comparison
 * against a figure from a different corpus is the most expensive kind of wrong, because it looks like a result.**
 *
 * **Sorted, so the order of the rows is not part of the identity**, and **hashed, so the file stays readable**: the
 * corpus is fourteen pull requests and their goldens, which does not belong in a JSON key.
 */
export function corpusFingerprint(rows) {
  const entries = rows.map((row) => {
    const key = String(row?.githubPrUrl ?? '');
    const goldens = Array.isArray(row?.comments) ? row.comments.length : 0;
    return `${key}#${goldens}`;
  });
  entries.sort();
  return `sha256:${createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex').slice(0, 32)}`;
}

/** A baseline that records nothing yet. Written by `record` and completed by `withRecord`. */
export function emptyBaseline({ fingerprint, judgeModel, tool }) {
  return {
    version: BASELINE_VERSION,
    recordedAt: null,
    corpus: { fingerprint, judge: { model: judgeModel, prompt: JUDGE_PROMPT_VERSION } },
    competitor: { tool },
    pulls: {},
  };
}

/**
 * Read a baseline file, or `null` when there is none.
 *
 * **A file that is absent is not an error**, because on the first run of a fresh clone there is nothing to replay and the
 * caller's job is to report that, not to fail. **A file that is present and unreadable is an error**, because the two
 * have different repairs: one is "record it", the other is "the file is corrupt", and a reader that folds them into one
 * `null` sends the next person to the wrong repair.
 */
export function readBaseline(path) {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed?.version !== BASELINE_VERSION) {
    throw new Error(
      `the competitor baseline at ${path} is version ${String(parsed?.version)}, and this reader is version ` +
        `${BASELINE_VERSION} - re-record it rather than reading it as if the shape had not changed`,
    );
  }
  return parsed;
}

/**
 * Decide what this pull request costs, and say why.
 *
 * **Four answers, and the reason is carried on every one of them.** `off` is a run that has removed the arm; `record` is
 * a run that pays for it; `replay` is a run that reads the figure it already paid for; and `missing` is a run that
 * wanted the figure and could not have it - **which is reported rather than repaired by buying it**, because a module
 * that silently upgrades a missing record into a purchase is a module that spends money when its input is wrong.
 *
 * The checks are ordered from the cheapest to the most specific, so the reason names the *first* thing that is wrong:
 * no file, a different corpus, a different judge, this pull request not in the record.
 */
export function resolveCompetitor({ mode, baseline, fingerprint, judgeModel, key }) {
  if (mode === 'off')
    return { kind: 'off', reason: 'the competitor arm was switched off for this run' };
  if (mode === 'record') return { kind: 'record' };
  if (!baseline) {
    return {
      kind: 'missing',
      reason: 'no competitor baseline has been recorded for this repository',
    };
  }
  const recorded = baseline.corpus ?? {};
  if (recorded.fingerprint !== fingerprint) {
    return {
      kind: 'missing',
      reason:
        `the corpus changed since the baseline was recorded (${String(recorded.fingerprint)} -> ${fingerprint}), ` +
        'so the recorded figure is not the figure this corpus would produce today',
    };
  }
  if (recorded.judge?.model !== judgeModel) {
    return {
      kind: 'missing',
      reason: `the judge changed since the baseline was recorded (${String(recorded.judge?.model)} -> ${judgeModel})`,
    };
  }
  const pull = baseline.pulls?.[key];
  if (!pull) {
    return { kind: 'missing', reason: `${key} is absent from the recorded baseline` };
  }
  return { kind: 'replay', pull };
}

/**
 * **Add one pull request's result, without mutating the baseline that was read.**
 *
 * A recording run accumulates one pull request at a time, and **the object handed to this function is also the object
 * being read by the code that decides what to do** - so mutating it would make the decision and the record the same
 * object, which is the shape of an aliasing bug this repository has already paid for once.
 */
export function withRecord(baseline, key, pull) {
  return { ...baseline, pulls: { ...baseline.pulls, [key]: pull } };
}

/**
 * **The baseline a recording run starts from.**
 *
 * Reusing an existing record is how the file grows one pull request at a time - a run that covers fourteen of fifteen, or
 * a corpus whose fifteenth pull request was rate-limited, does not throw away the thirteen it paid for. **But a record
 * of a different corpus is not a prefix of this one**, and **a record produced by a different judge is not a prefix
 * either**: the verdicts are the judge's answers, so reusing them under another model's name would publish a figure
 * attributed to a judge that never said it. Both are replaced rather than merged.
 */
export function startRecording({ existing, fingerprint, judgeModel, tool }) {
  if (
    existing &&
    existing.corpus?.fingerprint === fingerprint &&
    existing.corpus?.judge?.model === judgeModel
  ) {
    return existing;
  }
  return emptyBaseline({ fingerprint, judgeModel, tool });
}

/** Write a baseline, creating the directory it lives in. */
export function writeBaseline(path, baseline) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

/**
 * **The published shape of one recorded pull request.**
 *
 * `matches` and `goldens` are what the maximum matching and the curve read; `keep` is the gate's verdict per finding;
 * `detail` is what the artifact publishes. **All four are stored**, because **a replay that could reproduce the score
 * but not the evidence would be a number whose provenance the artifact had lost** - and the artifact is the only place a
 * reader can check that the recorded figure was produced by the same judge over the same goldens.
 *
 * `unanswered` is carried rather than folded into `matches`, because a judge that did not answer is not a non-match.
 *
 * **`findings` is the number the tool said it produced**, which is not the number of rows in `detail`: a finding the
 * ranker cannot place has no row and is still a finding the tool emitted. **Storing the count beside the rows keeps the
 * distinction the artifact already draws** - a tool that spoke and was not understood is a different fact from a tool
 * that found less.
 */
export function recordedPull({ matches, goldens, keep, detail, unanswered, findings }) {
  return {
    matches: matches.map((row) => [...row]),
    goldens: Number(goldens),
    keep: keep.map((value) => Boolean(value)),
    detail: detail.map((row) => ({ ...row })),
    unanswered: Number(unanswered ?? 0),
    findings: Number(findings ?? detail.length),
  };
}

/**
 * **What a replayed pull request contributes to the run, in the shape the scoring already consumes.**
 *
 * The returned object is deliberately the same shape `competitorPerPr` entries have when they are produced by a live
 * run - `key`, `matches`, `goldens`, `keep` - **so the choice between a purchased and a replayed figure cannot reach the
 * arithmetic**, and the two are comparable by construction rather than by inspection.
 */
export function replayedPull(key, pull) {
  return {
    key,
    matches: pull.matches.map((row) => [...row]),
    goldens: pull.goldens,
    keep: pull.keep.map((value) => Boolean(value)),
  };
}

/**
 * A short, printable account of a decision, for the log line a human reads at 4 a.m.
 *
 * **Separate from the decision**, because the decision is asserted in tests and the sentence is read in a log, and a
 * sentence that is part of the data is a sentence that can be wrong in a file instead of wrong in a terminal.
 */
export function describeDecision(decision, key) {
  switch (decision.kind) {
    case 'off':
      return `${key}: competitor arm off`;
    case 'record':
      return `${key}: competitor arm recording`;
    case 'replay':
      return `${key}: competitor arm replayed from the baseline`;
    default:
      return `${key}: competitor arm missing - ${String(decision.reason ?? 'no reason recorded')}`;
  }
}
