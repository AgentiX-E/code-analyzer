#!/usr/bin/env node
/**
 * **Re-read a benchmark artifact's rejected pairs, without paying for the review again.**
 *
 * The run of 2026-11-16 rejected 434 goldens in files it had commented on, 263 of them on the exact line. Those pairs are
 * in the artifact, the goldens are in the artifact, and the comments are in the artifact - **so the only thing a second
 * reading costs is judge calls**, about four hundred of them, against the 5 730 the review itself cost.
 *
 * **What this is for, and what it must not be used for.** It answers one question: *of the goldens the judge rejected, how
 * many were the same concern said differently?* The answer decides which device comes next - a matcher repair, §59's
 * second concern, or nothing - and it decides it with a **crossed control**: every real pair is read beside a pair the
 * same reader is given with the golden taken from another pull request. **A reader that accepts both is worth nothing,
 * and `beyondControl` says so**; that is the only number here that can license a re-scoring, and re-scoring is not a
 * device gain.
 *
 * Usage:
 *   node scripts/aacr-rejudge.mjs --bench /tmp/with --out /tmp/rejudge.json
 *   node scripts/aacr-rejudge.mjs --bench /tmp/with --limit 40 --self-test
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  claimsPrompt,
  crossPairControl,
  sameLineRejects,
  samePullRequestControl,
  summariseRejudge,
} from './lib/claims-match.mjs';

const MODEL = process.env['AACR_JUDGE_MODEL'] ?? process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const BASE =
  process.env['AACR_JUDGE_BASE'] ??
  process.env['MARTIAN_BASE_URL'] ??
  'https://api.deepseek.com/v1';
const KEY =
  process.env['AACR_JUDGE_KEY'] ??
  process.env['MARTIAN_API_KEY'] ??
  process.env['DEEPSEEK_API_KEY'] ??
  '';
const CONCURRENCY = Number(process.env['AACR_REJUDGE_CONCURRENCY'] ?? '6');

function parse(argv) {
  const options = { bench: null, out: null, limit: 0, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bench') options.bench = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: aacr-rejudge.mjs --bench <artifact dir or file> [--out file] [--limit n]\n',
      );
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** The artifact, whether the caller points at the directory a job downloaded or at the file itself. */
function readArtifact(bench) {
  if (bench === null) throw new Error('--bench is required');
  const path = resolve(bench);
  if (!existsSync(path)) throw new Error(`no artifact at ${path}`);
  const file = statSync(path).isDirectory() ? findArtifact(path) : path;
  if (file === null) throw new Error(`no aacr-bench.json under ${path}`);
  return { file, artifact: JSON.parse(readFileSync(file, 'utf8')) };
}

function findArtifact(directory) {
  const direct = join(directory, 'aacr-bench.json');
  if (existsSync(direct)) return direct;
  for (const entry of ['aacr', 'artifact', 'bench']) {
    const nested = join(directory, entry, 'aacr-bench.json');
    if (existsSync(nested)) return nested;
  }
  return null;
}

/**
 * **One reading, and a failure that is not a verdict.**
 *
 * The answer is `'same' | 'different' | 'wording'`, and **a call that did not answer returns `null`** - the same
 * distinction the bench's judge loop makes, one instrument further out: a rate limited re-read that counted its refusals
 * as rejections would report a matcher more conservative than the one it ran.
 */
async function read(pair, { model = MODEL, base = BASE, key = KEY, fetchImpl = fetch } = {}) {
  const body = {
    model,
    temperature: 0,
    // **A sentence and a verdict, not four tokens.** Six lines to say *why* is 120 tokens; an unbounded field would be
    // the half of the bill that arrives on the days the model explains itself at length.
    max_tokens: 160,
    messages: [
      {
        role: 'system',
        content:
          'You compare two code review statements about one place in a diff. Reply with JSON only.',
      },
      { role: 'user', content: claimsPrompt(pair) },
    ],
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`http ${String(response.status)}`);
      const json = await response.json();
      const text = String(json?.choices?.[0]?.message?.content ?? '')
        .replace(/```json|```/g, '')
        .trim();
      const parsed = JSON.parse(text);
      const verdict = String(parsed?.verdict ?? '').toLowerCase();
      if (verdict !== 'same' && verdict !== 'different' && verdict !== 'wording') return null;
      return { verdict, shared: String(parsed?.shared ?? '').slice(0, 240) };
    } catch {
      await new Promise((done) => setTimeout(done, 400 * 2 ** attempt));
    }
  }
  return null;
}

/** Bounded concurrency, because the pairs are known before the first call and a burst is a rate limit. */
async function mapBounded(items, limit, apply) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await apply(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function rejudge(pairs, artifact, options) {
  /**
   * **Three controls, because the easiest one is not evidence.**
   *
   * A crossed pair - our comment against a golden from another pull request - can be rejected from the file extension
   * alone, so its zero says nothing about the reader. The two same-pull-request controls are the hard ones: `sameFile`
   * shares the vocabulary, the module and the change and differs only in the defect, and `samePull` tests whether the
   * reader is keying on the feature rather than on the defect.
   */
  const build = {
    crossed: crossPairControl(pairs),
    sameFile: samePullRequestControl(artifact, pairs, { samePath: true }),
    samePull: samePullRequestControl(artifact, pairs, { samePath: false }),
  };
  const index = Object.fromEntries(
    Object.entries(build).map(([name, controls]) => [
      name,
      new Map(controls.map((c) => [c.id, c])),
    ]),
  );
  const rows = await mapBounded(pairs, CONCURRENCY, async (pair) => {
    const real = await read(pair, options);
    const control = async (name) => {
      const pairing = index[name].get(pair.id);
      return pairing ? ((await read(pairing, options))?.verdict ?? null) : null;
    };
    return {
      id: pair.id,
      pr: pair.pr,
      path: pair.path,
      startLine: pair.startLine,
      real: real?.verdict ?? null,
      shared: real?.shared ?? null,
      crossed: await control('crossed'),
      sameFile: await control('sameFile'),
      samePull: await control('samePull'),
    };
  });
  return {
    rows,
    controls: Object.fromEntries(Object.entries(build).map(([k, v]) => [k, v.length])),
  };
}

/**
 * **The arithmetic, on written-out answers**, because this reader runs against a paid artifact and a bug in it would be
 * discovered after the calls. The fixture is the two failures this file exists for: a reader that agrees with everything
 * (lift zero) and a reader that agrees with the real pairs and not the crossed ones (lift is the recovery).
 */
function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`);
  };

  // **The failure the controls exist for**: a reader that accepts the hard pairings as readily as the real ones has no
  // discrimination, whatever it says about the pairs we care about.
  const generous = summariseRejudge(
    Array.from({ length: 8 }, () => ({
      real: 'same',
      crossed: 'different',
      sameFile: 'same',
      samePull: 'same',
    })),
  );
  assert(generous.lift === 0, 'a reader that accepts the same-file control too earns nothing');
  assert(generous.beyondControl === 0, 'and its evidence count is zero');
  assert(
    generous.floorFrom === 'sameFile' || generous.floorFrom === 'samePull',
    'the floor is named',
  );

  const discriminating = summariseRejudge([
    ...Array.from({ length: 6 }, () => ({
      real: 'same',
      crossed: 'different',
      sameFile: 'different',
      samePull: 'different',
    })),
    ...Array.from({ length: 4 }, () => ({
      real: 'different',
      crossed: 'different',
      sameFile: 'different',
      samePull: 'different',
    })),
  ]);
  assert(discriminating.realShare === 0.6, 'six of ten real pairs accepted');
  assert(
    discriminating.beyondControl === 6,
    'and all six are evidence, because the controls earned none',
  );

  // **And a control that could not be built is not a zero.** The artifact of a run whose pull requests carry one golden
  // each has no same-file pair to cross, and the summary must say the floor came from the control it did measure.
  const onlyCrossed = summariseRejudge([
    { real: 'same', crossed: 'different', sameFile: null, samePull: null },
  ]);
  assert(onlyCrossed.floorFrom === 'crossed', 'the floor names the control that answered');
  assert(onlyCrossed.sameFile.answered === 0, 'and the one that did not is reported as unanswered');

  const silent = summariseRejudge([{ real: null, control: null }]);
  assert(silent.answered === 0, 'a call that did not answer is not a rejection');
  assert(silent.unanswered === 1, 'and it is counted as unanswered');

  const crossed = crossPairControl(
    sameLineRejects({
      missedGoldens: {
        records: Array.from({ length: 5 }, (_, i) => ({
          pr: `https://github.com/o/r/pull/${String(i)}`,
          goldenIndex: i,
          bucket: 'findingOnPathRejected',
          path: 'a.ts',
          note: `claim ${String(i)}`,
          proximity: 0,
          nearestFinding: { startLine: i, endLine: i, text: `comment ${String(i)}` },
        })),
      },
    }),
  );
  assert(
    crossed.length === 5,
    'every pair gets a crossed partner when the corpus has more than one pull request',
  );
  assert(
    crossed.every((control) => control.donorId !== control.id),
    'and no pair is crossed with itself',
  );

  process.stdout.write(
    `AACR-REJUDGE self-test ok · generous lift ${String(generous.lift)} · discriminating lift ${String(discriminating.lift)} · control pairs ${String(crossed.length)}\n`,
  );
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  // **The artifact before the key**, because the two failures want different repairs and a reader that named the key
  // first would send somebody looking for a secret when the path was wrong.
  const { file, artifact } = readArtifact(options.bench);
  const all = sameLineRejects(artifact);
  const pairs = options.limit > 0 ? all.slice(0, options.limit) : all;
  if (pairs.length === 0) throw new Error(`${file} holds no rejected same-line pairs to re-read`);
  if (KEY === '')
    throw new Error('no judge key: set AACR_JUDGE_KEY, MARTIAN_API_KEY or DEEPSEEK_API_KEY');

  process.stdout.write(
    `AACR-REJUDGE ${String(pairs.length)} of ${String(all.length)} rejected same-line pairs · judge ${MODEL} · ${String(CONCURRENCY)} in flight\n`,
  );
  const { rows, controls } = await rejudge(pairs, artifact, {});
  const summary = summariseRejudge(rows);

  const report = {
    readAt: new Date().toISOString(),
    artifact: file,
    judge: { model: MODEL, endpoint: BASE },
    protocol:
      'every rejected same-line pair read once, beside a crossed pair whose golden comes from another pull request; a reader that accepts both earns nothing',
    summary: { ...summary, controlPairs: controls },
    rows,
  };
  if (options.out) {
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`);
  }

  const pct = (value) => `${(Number(value) * 100).toFixed(1)} %`;
  const line = (label, reading) =>
    `| ${label} | ${String(reading.answered)} | ${String(reading.same)} | ${pct(reading.share)} |`;
  process.stdout.write(
    [
      '',
      '| reading | pairs | accepted | share |',
      '| ------- | ----: | -------: | ----: |',
      line('the pairs the run rejected', {
        answered: summary.answered,
        same: summary.same,
        share: summary.realShare,
      }),
      line('crossed: golden from another pull request', summary.crossed),
      line('same file, same pull request, other line', summary.sameFile),
      line('same pull request, another file', summary.samePull),
      '',
      `verdicts: same ${String(summary.same)} · different ${String(summary.different)} · wording ${String(summary.wording)} · unanswered ${String(summary.unanswered)}`,
      `floor: the ${summary.floorFrom} control at ${pct(summary.floorShare)}`,
      `recovery beyond the floor: ${String(summary.beyondControl)} pairs (lift ${pct(summary.lift)})`,
      '',
    ].join('\n'),
  );
  if (options.out) process.stdout.write(`written to ${resolve(options.out)}\n`);
}

main().catch((error) => {
  process.stderr.write(`aacr-rejudge: ${String(error?.message ?? error)}\n`);
  process.exit(1);
});
