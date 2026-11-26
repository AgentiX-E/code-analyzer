#!/usr/bin/env node
/**
 * **The two-sided verifier, priced on the comments the arm already posts.**
 *
 * ```
 * node scripts/symbol-crosscheck.mjs --mode replay --arm benchmarks/martian-wide-bench.json \
 *   --corpus benchmarks/martian/positive_samples.json --profile core --budget 5 \
 *   --out benchmarks/symbol-crosscheck.json
 * ```
 *
 * §166 read the published artifact and found the deficit is **predicative**: 27 of the 33 goldens only the competitor
 * credits sit on a symbol our own comment names, against a base rate of 79 % outside the set. The prize - the same 227
 * comments with their sentences corrected - is F1 `0.3221 → 0.3896`, and the bar is `0.3735`. **This script asks the
 * device, and then asks the judge.**
 *
 * **Two modes, and the cheap one is the default.**
 *
 * - `replay` reads a recorded run and recomputes every figure from its stored verdicts. **No key, no spend, no network** -
 *   which is what lets CI and a documentation page print the numbers on every commit without buying them again.
 * - `record` buys them: one call per comment-and-symbol for the verifier, and a batched judgement of both arms against the
 *   same goldens in the same run. **The two arms share a judge**, because a difference between two runs is a difference
 *   between two judges as well as two sentences, and the whole point of the paired design is to remove the second one.
 *
 * **What the paired design buys, and what it costs.** Every comment the verifier did not touch is judged once and its
 * verdict is used by both arms - so the bill is **one judgement of the emission plus one judgement of the corrections**,
 * not two of each. That is the reason this is affordable at all: §166.6 priced the verifier's own calls at ~6 % of the run
 * it rides on, and this file keeps the judge inside the same envelope.
 *
 * **And the guard is the artifact's own arithmetic.** The row set, the cut and the scoring come from the published record,
 * and the rebuild has to reproduce the point that record published before anything is bought - the same refusal
 * `symbol-adjacency.mjs` makes, for the same reason: a device priced against a pool that is not the arm's pool is a device
 * priced against nothing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchDiff } from './lib/martian-harness.mjs';
import { dirname, join, resolve } from 'node:path';

import {
  buildJudgeMessages,
  chunkIndices,
  parseJudgeBatch,
} from '../.github/scripts/lib/judge-batch.mjs';
import { evidenceWindow, sideLinesByPath } from './lib/diff-side-lines.mjs';
import { profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import { applyCut, score } from './lib/operating-point.mjs';
import { pairedChange, pointOf, postedRows, withRewrites } from './lib/crosscheck-readout.mjs';

const REPO = resolve(import.meta.dirname, '..');
const VERSION = 'symbol-crosscheck-v1';
const BATCH = 6;
const JUDGE_CONCURRENCY = 4;

function parseArgs(argv) {
  const options = {
    arm: null,
    corpus: null,
    profile: 'core',
    budget: 5,
    mode: 'replay',
    out: 'benchmarks/symbol-crosscheck.json',
    diffs: '.cache/martian-diffs',
    plan: 'benchmarks/symbol-adjacency.json',
    maxPrs: 50,
    maxCalls: 250,
    maxPerPullRequest: 5,
    maxUsd: 3,
    fetch: null,
    target: 0.3735,
    model: process.env['AACR_JUDGE_MODEL'] ?? 'deepseek-chat',
  };
  const numeric = new Set([
    'budget',
    'maxPrs',
    'maxCalls',
    'maxPerPullRequest',
    'maxUsd',
    'target',
  ]);
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    // **A bare `--` is a separator, not an option.** pnpm forwards it verbatim, and a parser that refused it turned a
    // workflow dispatch into an immediate exit - which is how this line was found.
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      options.arm = arg;
      continue;
    }
    // **Kebab on the command line, camel in the code**, because a shell flag with a capital letter is a flag somebody
    // mistypes and a workflow input that cannot be pasted is an input nobody uses.
    const name = arg.slice(2).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
    if (!(name in options)) {
      process.stderr.write(`unknown option ${arg}\n`);
      process.exit(2);
    }
    options[name] = numeric.has(name) ? Number(argv[(at += 1)]) : argv[(at += 1)];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.arm === null || options.corpus === null) {
  process.stderr.write(
    'usage: symbol-crosscheck.mjs --arm <artifact.json> --corpus <positive_samples.json> ' +
      '[--profile core|all] [--budget k] [--mode replay|record] [--out file] [--diffs dir] ' +
      '[--max-prs n] [--max-calls n] [--max-usd n] [--target f1]\n',
  );
  process.exit(2);
}
if (options.mode !== 'record' && options.mode !== 'replay') {
  process.stderr.write(
    `refusing: --mode is ${options.mode}, and the two modes are record and replay\n`,
  );
  process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(resolve(REPO, path), 'utf8'));
const arm = read(options.arm);
const corpus = read(options.corpus);
const planRecord = existsSync(resolve(REPO, options.plan)) ? read(options.plan) : null;

// **The guard: the pool has to be the arm's own, on the arm's own cut.**
const steps = arm.emissionRules?.shipped?.steps ?? null;
const published = arm.emissionRules?.shipped?.point ?? null;
if (steps === null || published === null) {
  process.stderr.write(
    `${options.arm} publishes no emissionRules.shipped, so its pool cannot be rebuilt\n`,
  );
  process.exit(2);
}
const rawRows = arm.rankedFindings ?? [];
const rawCredit = (row) => row.matchedGoldens ?? [];
const rawGoldens = Number(arm.truePositives ?? 0) + Number(arm.falseNegatives ?? 0);
const rebuilt = score(applyCut(rawRows, steps), rawCredit, rawGoldens);
if (rebuilt.emitted !== published.k || rebuilt.truePositives !== published.truePositives) {
  process.stderr.write(
    `refusing: the rebuild emits ${String(rebuilt.emitted)} comments / ${String(rebuilt.truePositives)} true positives and the artifact published ${String(published.k)} / ${String(published.truePositives)}\n`,
  );
  process.exit(1);
}

const { maps } = profileMaps(corpus, options.profile);
const rows = restrictFindings(rawRows, { maps }).map((row, at) => ({ ...row, at }));
let goldens = 0;
for (const index of maps.values()) goldens += index.size;

/** **The goldens of one pull request, in the profile's own order**, because `profileGoldens` indexes them that way. */
const goldensByPullRequest = new Map();
for (const row of corpus) {
  const url = String(row?.githubPrUrl ?? '');
  const index = maps.get(url);
  if (index === undefined) continue;
  const ordered = [];
  for (const [full, remapped] of index)
    ordered[remapped] = String(row?.comments?.[full]?.note ?? '');
  goldensByPullRequest.set(url, ordered);
}

/**
 * **The slice, when one is asked for, is a prefix of the board and not a smaller corpus.**
 *
 * S51's open question was exactly this: a run over twelve pull requests is a *sample of the same board*, so its denominator
 * is the board's and its figure must not be compared with a full-board one. Two things make that true here rather than
 * promised - the pull requests are taken **in the corpus's own order**, which is the only order the outcome did not choose,
 * and the record carries `slice.pullRequests` beside `slice.of`, so a sliced figure says how much of the board produced it.
 *
 * **And the slice is applied before anything is bought.** A run asked for three pull requests that then judged fifty would
 * be a run whose bill contradicts its own input.
 */
const prOrder = [...goldensByPullRequest.keys()];
const allowed = new Set(prOrder.slice(0, options.maxPrs));

/** The comments these pull requests post, and the only comments any arm in this file is allowed to post. */
const posted = postedRows(rows, steps, options.budget).filter((row) =>
  allowed.has(String(row?.pr ?? '')),
);

/**
 * **The evidence each comment is asked about, read from the change itself.**
 *
 * A two-sided question needs the two sides, and the sides are in the change rather than in the sentence - so this reads
 * the pull request's diff, from a cache when one was filled and from the API when it was not, and falls back to the
 * quotation the finding already carries when there is no diff at all. **The fallback is named in the record**
 * (`evidenceSource`), because a run that verified against one quoted line is a weaker reading than one that verified
 * against the change, and a figure that could not tell them apart would be the stronger claim wearing the weaker run's
 * numbers.
 *
 * **The diff is cached to disk on the way through**, so a second run of the same corpus buys no network and reads the same
 * bytes - which is the same rule the harness's own artifacts follow.
 */
async function evidenceFor(row) {
  const path = String(row?.path ?? '');
  const quota = { source: 'none', lines: [] };
  const cached =
    options.diffs === null
      ? null
      : join(resolve(REPO, options.diffs), diffName(String(row?.pr ?? ''), path));
  if (cached !== null && existsSync(cached)) {
    const window = windowOf(readFileSync(cached, 'utf8'), path, row);
    if (window.length > 0) return { source: 'diff', lines: window };
  } else if (options.fetch && cached !== null) {
    const diff = await fetchDiff(String(row?.pr ?? ''), process.env['GITHUB_TOKEN'] ?? '');
    if (diff !== null) {
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, diff);
      const window = windowOf(diff, path, row);
      if (window.length > 0) return { source: 'diff', lines: window };
    }
  }
  const quoted = String(row?.existingCode ?? '');
  if (quoted.trim() === '') return quota;
  const start = Number(row?.startLine ?? 1);
  const lines = quoted
    .split('\n')
    .slice(0, 40)
    .map((text, at) => `${String(start + at).padStart(4)}| ${text}`);
  return { source: 'quote', lines };
}

/** The window a diff gives one row, or nothing when the file is not in it. */
function windowOf(diff, path, row) {
  // **Every line the new revision has in the hunk**, not only the added ones: a caller whose callee sits forty unchanged
  // lines above has its other side in the context, and quoting only `+` lines answered `cannot` on half the emission.
  const lines = sideLinesByPath(diff).get(path)?.lines ?? [];
  return evidenceWindow(lines, Number(row?.startLine ?? 0));
}

/** One diff file per pull request and path, so a re-run of the same corpus reads the same bytes. */
function diffName(pullRequest, path) {
  const slug = pullRequest.replace(/^https?:\/\/[^/]+\//, '').replace(/[^A-Za-z0-9]+/g, '_');
  const file = path.replace(/[^A-Za-z0-9]+/g, '_');
  return `${slug}__${file}.diff`;
}

const evidence = new Map();

/** The comments this run verifies: the slice's, which is all of them when the slice is the board. */
const inScope = posted;

async function recordRun() {
  const key = process.env['DEEPSEEK_API_KEY'] ?? '';
  if (key === '') {
    process.stderr.write(
      'refusing: --mode record needs DEEPSEEK_API_KEY and this shell does not have one\n',
    );
    process.exit(2);
  }
  // **Loaded here rather than at the top of the file**, because `replay` must run in a checkout that has not been built -
  // a readout that needed the product compiled would be a readout CI could not print on a documentation commit.
  if (options.fetch === null) options.fetch = Boolean(process.env['GITHUB_TOKEN']);
  for (const row of inScope) evidence.set(Number(row.at), await evidenceFor(row));
  const { SymbolCrosscheck, symbolsInComment } =
    await import('../packages/intelligence/dist/review/symbol-crosscheck.js');
  const { DeepSeekProvider } = await import('../packages/intelligence/dist/review/llm/provider.js');
  const { CostLedger } = await import('../packages/intelligence/dist/review/llm/cost.js');
  const ledger = new CostLedger();
  const provider = new DeepSeekProvider({ ledger, ceilingUsd: options.maxUsd });

  const findings = inScope.map((row) => ({
    pr: String(row?.pr ?? ''),
    path: String(row?.path ?? ''),
    startLine: Number(row?.startLine ?? 0),
    description: String(row?.text ?? ''),
  }));
  const linesOf = new Map(
    findings.map((finding, at) => [finding, evidence.get(Number(inScope[at].at))?.lines ?? []]),
  );
  // **One question per comment, not one per symbol.** The acceptance is about a share of the comments the arm posts, so
  // the budget has to cover every one of them rather than ask two questions about half: at `k = 5` the board posts 227
  // comments, and 227 calls is what `maxCalls` buys. A second symbol on the same comment is a second chance to rewrite it,
  // which is exactly the sort of second chance a measurement must not hand the device it is measuring.
  const pass = new SymbolCrosscheck(provider, {
    maxCalls: options.maxCalls,
    maxPerPullRequest: options.maxPerPullRequest,
    maxSymbolsPerComment: 1,
  });
  // **The evidence is looked up by identity**, because a finding does not carry its own diff and the pass hands back the
  // same objects it was given - a positional lookup would need the pass to promise an order it already promises.
  const { findings: verified, report } = await pass.run(
    findings,
    (finding) => linesOf.get(finding) ?? [],
  );

  const rewrites = new Map();
  const verdicts = [];
  inScope.forEach((row, at) => {
    const before = String(row?.text ?? '');
    const after = String(verified[at]?.description ?? before);
    if (after !== before) rewrites.set(Number(row.at), after);
    verdicts.push({
      at: Number(row.at),
      pr: String(row?.pr ?? ''),
      path: String(row?.path ?? ''),
      startLine: Number(row?.startLine ?? 0),
      symbol: symbolsInComment(before, evidence.get(Number(row.at))?.lines ?? [])[0] ?? null,
      rewritten: after !== before,
      before,
      after,
      evidenceSource: evidence.get(Number(row.at))?.source ?? 'none',
    });
  });

  const judged = await judgeBothArms(posted, rewrites, provider, report);
  return { verdicts, rewrites: [...rewrites.entries()], report, judged };
}

/**
 * **Both arms, one judge, one run.**
 *
 * Arm A is the emission as it stands; arm B is the same list with the corrections applied. A comment that was not touched
 * is judged once and its verdict is **the same object in both arms** - which is not an optimisation but the definition of a
 * paired reading: the pair (comment, golden) did not change, so neither may its verdict.
 *
 * Batched by golden through `judge-batch.mjs`, which is the same prompt and the same parser the AAcr board uses, so a
 * figure here is comparable with the figures there rather than merely analogous to them.
 */
async function judgeBothArms(postedRowsList, rewrites, provider, report) {
  const corrected = withRewrites(postedRowsList, rewrites);
  const byPullRequest = new Map();
  postedRowsList.forEach((row, at) => {
    const url = String(row?.pr ?? '');
    const bucket = byPullRequest.get(url) ?? { rows: [], corrected: [] };
    bucket.rows.push(at);
    bucket.corrected.push(at);
    byPullRequest.set(url, bucket);
  });

  const bitsA = new Map();
  const bitsB = new Map();
  const jobs = [...byPullRequest.entries()];
  let calls = 0;
  const runJob = async ([url, bucket]) => {
    const goldensAt = goldensByPullRequest.get(url) ?? [];
    if (goldensAt.length === 0) return;
    // **The verdicts are filed by the row's own identity, not by its position in this list.** The first run of this
    // script filed them positionally while the readout looked them up by `row.at`, so 74 pairs the judge had accepted were
    // read back as one credit and the arm appeared to score `0.0052` - a mismatch that looks exactly like a bad judge.
    const ids = bucket.rows.map((at) => Number(postedRowsList[at]?.at));
    const textsA = bucket.rows.map((at) => String(postedRowsList[at]?.text ?? ''));
    const textsB = bucket.rows.map((at) => String(corrected[at]?.text ?? ''));
    for (const [goldenAt, golden] of goldensAt.entries()) {
      for (const chunk of chunkIndices(textsA.length, BATCH)) {
        const messages = buildJudgeMessages(
          golden,
          chunk.map((at) => textsA[at]),
        );
        const answerA = await provider.complete(`${messages.system}\n\n${messages.user}`, {
          temperature: 0,
          maxTokens: 200,
          tag: 'judge:crosscheck',
        });
        calls += 1;
        const verdictA = parseJudgeBatch(answerA.content, chunk.length);
        // **An unreadable batch is a batch of non-matches that nobody may record as such**, so it is reported and the
        // affected pairs are left out of both arms - the rule the AAcr board states and this file reuses.
        const usableA = verdictA ?? chunk.map(() => null);
        // **The whole chunk is re-judged, not only the comments that changed.** A batch of one changed comment is a
        // different question from a batch of six - models answer a one-item list with `{"match": true}` - and the first
        // paid run lost **19 verdicts** to exactly that, recorded as an unreadable answer rather than as a disagreement.
        // Re-judging the chunk keeps the prompt's shape identical between the two arms, so the only difference the judge
        // sees is the sentences.
        const changed = chunk.some((at) => textsB[at] !== textsA[at]);
        let verdictB = usableA;
        if (changed) {
          const messagesB = buildJudgeMessages(
            golden,
            chunk.map((at) => textsB[at]),
          );
          const answerB = await provider.complete(`${messagesB.system}\n\n${messagesB.user}`, {
            temperature: 0,
            maxTokens: 200,
            tag: 'judge:crosscheck',
          });
          calls += 1;
          const read = parseJudgeBatch(answerB.content, chunk.length);
          if (read !== null) verdictB = read;
          else {
            // **A batch that cannot be read is paid for again one pair at a time**, which is the fallback the AAcr board
            // documents: the old instrument rather than a second implementation of it.
            verdictB = [];
            for (const at of chunk) {
              verdictB.push(await judgeOne(provider, golden, textsB[at]));
              calls += 1;
            }
          }
        }
        chunk.forEach((at, index) => {
          const key = `${url}#${String(goldenAt)}~${String(ids[at])}`;
          push(bitsA, key, usableA[index]);
          push(bitsB, key, verdictB[index]);
        });
      }
    }
  };
  await mapLimit(jobs, JUDGE_CONCURRENCY, runJob);
  return { calls, bitsA, bitsB, unreadable: report.callsUnreadable ?? 0 };
}

/**
 * **One pair, in the shape a single-pair judge reads**, used only when a batch answer cannot be parsed.
 *
 * It asks for `{"match": true|false}` rather than a list, because the reason it exists is that a model given a one-item list
 * answered in another shape. **A fallback that repeated the question would repeat the failure.**
 */
async function judgeOne(provider, golden, comment) {
  const answer = await provider.complete(
    [
      'You compare one code review comment against one expert-confirmed issue from the same pull request.',
      'They match when they describe the same underlying defect, even in different words.',
      'Answer with one JSON object and nothing else: {"match": true|false}',
      '',
      `Expert-confirmed issue:\n${golden}`,
      '',
      `Review comment:\n${comment}`,
    ].join('\n'),
    { temperature: 0, maxTokens: 20, tag: 'judge:crosscheck' },
  );
  const stripped = String(answer.content ?? '')
    .replace(/```json|```/g, '')
    .trim();
  try {
    const body = JSON.parse(stripped);
    if (typeof body?.match === 'boolean') return body.match;
  } catch {
    // **An unreadable pair is `null`, which is not a non-match**, and the record keeps it out of both arms.
  }
  return null;
}

function push(map, key, value) {
  if (value === null || value === undefined) return;
  map.set(key, Boolean(value));
}

async function mapLimit(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      // **One argument, because the second one was never read.** This used to pass the index as well, and a reviewer
      // reading the generic `run` against its only concrete callee - a one-parameter destructuring of a job pair - saw a
      // trailing argument nobody could justify. The fix is at the shape rather than at the call: a runner that does not
      // receive an index cannot be handed a superfluous one.
      results[at] = await run(items[at]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** The matches a set of bits gives one comment, in the profile's golden indices. */
function matchesOf(bits, url, at) {
  const out = [];
  const goldensAt = goldensByPullRequest.get(url) ?? [];
  for (let goldenAt = 0; goldenAt < goldensAt.length; goldenAt += 1) {
    if (bits.get(`${url}#${String(goldenAt)}~${String(at)}`) === true) out.push(goldenAt);
  }
  return out;
}

function pointsFrom(bits, rewrites) {
  const withCredit = withRewrites(posted, rewrites).map((row) => ({
    ...row,
    freshGoldens: matchesOf(bits, String(row?.pr ?? ''), Number(row.at)),
  }));
  const creditOf = (row) => row.freshGoldens ?? [];
  const point = pointOf(withCredit, creditOf, goldens, steps, options.budget);
  return point;
}

/** The 27 goldens §166 priced, addressed by the row the plan chose for each. */
function prizeConversions(rewrites, armB) {
  const plan = planRecord?.plan ?? [];
  const rewrittenRows = new Set(rewrites.keys());
  let rewritten = 0;
  let credited = 0;
  const detail = [];
  for (const entry of plan) {
    const wasRewritten = rewrittenRows.has(Number(entry.findingAt));
    if (wasRewritten) rewritten += 1;
    const row = armB.find((candidate) => Number(candidate.at) === Number(entry.findingAt));
    const gained = (row?.freshGoldens ?? []).includes(Number(entry.golden));
    if (gained) credited += 1;
    detail.push({
      key: entry.key,
      golden: entry.golden,
      findingAt: entry.findingAt,
      symbol: entry.symbols?.[0] ?? null,
      rewritten: wasRewritten,
      credited: gained,
    });
  }
  return { planned: plan.length, rewritten, credited, detail };
}

async function main() {
  let record = null;
  if (options.mode === 'record') record = await recordRun();
  else {
    if (!existsSync(resolve(REPO, options.out))) {
      process.stderr.write(
        `refusing: --mode replay needs a recorded run at ${options.out}, and there is none - record one first\n`,
      );
      process.exit(2);
    }
    const stored = read(options.out);
    record = {
      verdicts: stored.verdicts ?? [],
      rewrites: (stored.verdicts ?? []).filter((v) => v.rewritten).map((v) => [v.at, v.after]),
      report: stored.verifier ?? null,
      judged: {
        bitsA: new Map(Object.entries(stored.judgements?.armA ?? {})),
        bitsB: new Map(Object.entries(stored.judgements?.armB ?? {})),
        calls: Number(stored.judgements?.calls ?? 0),
      },
    };
  }

  const rewrites = new Map(record.rewrites);
  const armA = pointsFrom(record.judged.bitsA, new Map());
  const armB = pointsFrom(record.judged.bitsB, rewrites);
  // **Only the pairs both arms have a verdict for are paired**, because an answer that could not be read is not a
  // disagreement with the other arm and counting it as one would report the judge's silence as the device's cost.
  const keys = [...record.judged.bitsA.keys()].filter((key) => record.judged.bitsB.has(key)).sort();
  const change = pairedChange(
    keys.map((key) => record.judged.bitsA.get(key) === true),
    keys.map((key) => record.judged.bitsB.get(key) === true),
  );
  const prize = prizeConversions(rewrites, armB.rows);

  const result = {
    version: VERSION,
    measuredAt: String(arm.measuredAt ?? ''),
    arm: options.arm,
    corpus: options.corpus,
    profile: options.profile,
    budget: options.budget,
    mode: options.mode,
    guard: [
      { field: 'k', published: published.k, rebuilt: rebuilt.emitted },
      {
        field: 'truePositives',
        published: published.truePositives,
        rebuilt: rebuilt.truePositives,
      },
    ],
    goldens,
    /**
     * **The slice, recorded so a sliced figure cannot be read as a whole-board one.**
     *
     * S51's question was whether a slice is a smaller corpus or a sample of this one. It is a sample: the pull requests are
     * taken in the corpus's own order, the denominator stays the board's three goldens per pull request wherever it applies,
     * and a record that does not say how many pull requests it covered is a record whose F1 is compared with a full-board
     * figure by whoever reads it first.
     */
    slice: { pullRequests: allowed.size, of: prOrder.length, kind: 'prefix-of-board' },
    comments: { armA: armA.emitted, armB: armB.emitted, unchanged: armA.emitted === armB.emitted },
    verifier: record.report,
    verdicts: record.verdicts,
    judgements: {
      calls: record.judged.calls,
      armA: Object.fromEntries(record.judged.bitsA),
      armB: Object.fromEntries(record.judged.bitsB),
    },
    point: {
      armA: {
        truePositives: armA.truePositives,
        precision: armA.precision,
        recall: armA.recall,
        f1: armA.f1,
      },
      armB: {
        truePositives: armB.truePositives,
        precision: armB.precision,
        recall: armB.recall,
        f1: armB.f1,
      },
      delta: armB.f1 - armA.f1,
    },
    paired: change,
    prize,
    bar: {
      target: options.target,
      cleared: armB.f1 >= options.target,
      deltaToTarget: armB.f1 - options.target,
    },
  };

  mkdirSync(dirname(resolve(REPO, options.out)), { recursive: true });
  writeFileSync(resolve(REPO, options.out), `${JSON.stringify(result, null, 2)}\n`);

  const line = (label, value) => `${label.padEnd(28)}${value}`;
  process.stdout.write(
    [
      `SYMBOL-CROSSCHECK ${String(options.mode)} · ${String(record.verdicts.length)} comments · ${String(prize.rewritten)} of ${String(prize.planned)} rewritten`,
      '',
      line('comments A / B', `${String(armA.emitted)} / ${String(armB.emitted)}`),
      line('credited at k=5', `${String(armA.truePositives)} → ${String(armB.truePositives)}`),
      line(
        'F1',
        `${armA.f1.toFixed(4)} → ${armB.f1.toFixed(4)} (${(armB.f1 - armA.f1 >= 0 ? '+' : '') + (armB.f1 - armA.f1).toFixed(4)})`,
      ),
      line(
        'bar',
        `${String(options.target)} · ${armB.f1 >= options.target ? 'cleared' : 'not cleared'}`,
      ),
      line(
        'paired fixed / broken',
        `${String(change.fixed)} / ${String(change.broken)} · p ${change.p.toFixed(4)}`,
      ),
      line('prize credited', `${String(prize.credited)} of ${String(prize.planned)}`),
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(`SYMBOL-CROSSCHECK failed: ${String(error?.stack ?? error)}\n`);
  process.exit(1);
});
