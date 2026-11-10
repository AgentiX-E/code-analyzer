// The corpus a direct competitor published, judged by us and by them.
//
// **Why this one, ahead of the others on the audit's list.** `Alibaba-Aone/aacr-bench` is **the one public corpus that
// measures what our distinctive claim claims**: **200 real pull requests across 10 languages, 1,505 expert-confirmed
// issues, three context levels - and the third is `Repo Level`, which is cross-file by construction.** **Their
// dataset card also ships `negative_samples.json`, 640 invalid comments, which means it can compute a noise rate** -
// **and the noise rate is the axis our own competitor-corpus job could only measure as a denominator.**
//
// **And the correction that belongs in this file rather than in a footnote.** **Alibaba built both the tool and the
// benchmark it wins on**, which an independent party stated plainly: *"an instrument that agrees with itself is not
// evidence."* **Their own reported absolute precision is 33.9%** - so **even their winner is wrong two times in
// three**, and **their 33.90% against 7.23% gap and their 9x token claim are their measurements on their corpus.**
// **This job therefore reports our numbers on that corpus and states that the comparison is against a
// self-published figure rather than against a run we performed**, which is **the same distinction the whole stretch
// has been about.**
//
// **And what it cannot do, said before it is run.** **Their README's claim is OCR against Claude Code on the same
// base model** - **two review systems, one model.** **Our engine is a third review system**, so **a row for us is a
// third column and not a re-run of theirs**, and **the artifact says which columns were produced here.**

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  GOLDEN_BUCKETS,
  REJECTION_SHAPES,
  attributeGoldens,
  dominantRejectionShape,
  largestBucket,
  mergeAttributions,
} from './lib/golden-attribution.mjs';
import { requestedPullRequests, spendCeilingUsd } from './lib/run-config.mjs';
import { DEFAULT_ATTEMPTS, backoffMs, retryAfterMs } from './lib/retry-after.mjs';
import { exactMcNemar } from './lib/paired-test.mjs';
import {
  DEFAULT_BASELINE_PATH,
  corpusFingerprint,
  parseCompetitorMode,
  readBaseline,
  recordedPull,
  replayedPull,
  resolveCompetitor,
  startRecording,
  withRecord,
  writeBaseline,
} from './lib/competitor-baseline.mjs';

const BENCH = process.env['AACR_DIR'] ?? '/tmp/aacr-bench';
const TOOL = process.env['MARTIAN_TOOL'] ?? 'agentix-e';
const MODEL = process.env['AACR_JUDGE_MODEL'] ?? process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const BASE =
  process.env['AACR_JUDGE_BASE'] ??
  process.env['MARTIAN_BASE_URL'] ??
  'https://api.deepseek.com/v1';
const KEY =
  process.env['AACR_JUDGE_KEY'] ??
  process.env['MARTIAN_API_KEY'] ??
  process.env['DEEPSEEK_API_KEY'];
/**
 * **How many pull requests the run reviews, and why the default rose from five to fourteen.**
 *
 * Five was the number that fitted a first reading of the corpus. **It is not the number at which a prompt device can be
 * measured**: three runs over the same five pull requests and the same fifty goldens moved the file arm's F1 between
 * 0.2368 and 0.2781, so **±0.04 is this instrument's resolution at that size**, and §8 of `docs/EVAL-CONTRACT.md`
 * says plainly that a rule expected to move F1 by less than that will not be measured here - it will be a rule that
 * cannot fail. **Fourteen pull requests is about a hundred and forty goldens**, which is where a 0.04 move stops being
 * a coin toss, and it is the number the registration was written against rather than a number chosen after the run.
 */
const MAX_PRS = requestedPullRequests(process.env['MAX_PRS']);

/**
 * **The competitor arm, parsed once.**
 *
 * The spend ceiling depends on it - a recording run buys the competitor's own result and a replaying one does not - and
 * **two independent reads of the same variable are two chances to disagree about what was bought.** Parsed here, used
 * by the ceiling and by the arm itself, and reported by the artifact.
 */
const COMPETITOR_CHOICE = parseCompetitorMode(process.env['AACR_COMPETITOR']);

/**
 * **The one switch the paired experiment turns.** `AACR_CHECKLIST=on` puts the per-language defect checklist into every
 * lane prompt; anything else leaves it out. **A string rather than a boolean**, because the value arrives from a
 * workflow's `env:` block where everything is a string, and **a flag that reads `"false"` as true is the kind of bug a
 * comparison would report as a null result.**
 *
 * **The unset default is `off`, and it moved to match the product.** The engine shipped the checklist on until two
 * paired runs put it 12 and then 13 goldens behind the prompt without it (`docs/EVAL-CONTRACT.md` §15.3), and **a
 * harness whose default disagrees with the engine's measures a configuration nobody ships** - the `with` arm of the
 * matrix names `on` explicitly, so aligning the default costs the experiment nothing and stops a bare local run from
 * measuring the retired arrangement.
 */
const CHECKLIST = String(process.env['AACR_CHECKLIST'] ?? 'off').toLowerCase() === 'on';

/**
 * **The second switch a run turns, and the one the bill is about: where the target-and-diff block sits.**
 *
 * `boilerplate-first` is what ships - the lane's role, checklist, output contract and examples lead, and the file's own
 * path and diff close the prompt - so **the reusable prefix is the same for every file the lane reads.**
 * `lane-first` is the arrangement before the device and `diff-first` is the one §9 of `EVAL-CONTRACT.md` registered
 * before it was measured. **All three are product values rather than harness values**, because a run that measured
 * something the product does not do would be a run about a different product.
 */
const PROMPT_ORDER = String(process.env['AACR_PROMPT_ORDER'] ?? 'boilerplate-first');

/**
 * **The pull-request arm's budget, and the arithmetic that chose it before the run.**
 *
 * The file arm fills three slots **per file per lane**; over 199 files it emitted **183 findings carrying 21 goldens**
 * - precision 0.2019, recall 0.42, F1 0.2727. The same contract applied to a whole pull request fills three slots **per
 * pull request per lane**; over five pull requests it emitted **15 findings carrying 6** - precision **0.40**, recall
 * 0.12, F1 0.1846.
 *
 * **Those two figures measure the same budget against two scopes, and they are the whole argument.** At fifteen
 * findings, the file arm's precision on the curve already recorded is **0.20** and the pull-request arm's is **0.40** -
 * so **the scope is worth a factor of two in precision at equal emission**, and the small arm's problem was never
 * precision, it was that three slots for a whole pull request buys a tenth of the recall.
 *
 * **Sixteen is where the arithmetic crosses the figure to beat.** With 50 goldens and 80 emitted findings, F1 > 0.45
 * needs **30 true positives**, which is precision **0.375** - *below* the 0.40 this arm has already demonstrated. The
 * rule this run registers is therefore: **a modest decay from 0.40 is survivable, and a collapse is not.** If precision
 * lands under 0.375 the registration is falsified and the report says so.
 */
const PR_BUDGET = Number(process.env['PR_BUDGET'] ?? '16');

function findSamples(name) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === name) hits.push(full);
    }
  };
  walk(BENCH, 0);
  return hits[0] ?? null;
}

/**
 * **One judge call's usage, added to the run's judge total.**
 *
 * **`prompt_cache_hit_tokens` is read here as well as on the reviewer**, because the judge's system prompt is the same
 * for every pair - so the judge is a prefix-cache client too, and **a judge that reported a hundred per cent misses
 * would be a second device left on the table.**
 */
function recordJudgeUsage(usage) {
  if (!usage || typeof usage !== 'object') return;
  judgeSpend.calls += 1;
  judgeSpend.promptTokens += Number(usage.prompt_tokens ?? 0);
  judgeSpend.completionTokens += Number(usage.completion_tokens ?? 0);
  judgeSpend.cacheHitTokens += Number(usage.prompt_cache_hit_tokens ?? 0);
  judgeSpend.cacheMissTokens += Number(usage.prompt_cache_miss_tokens ?? 0);
}

/**
 * **What the judge spent, in the same units as the reviewer.**
 *
 * **Why this exists and why it took until now.** The reviewer's calls go through a client this repository owns, so the
 * ledger sees them; **the judge is a bare `fetch` in this file, so it was invisible** - and the audit that priced a job
 * at 62.82 CNY had to *infer* that the reviewer was about a fifth of it rather than read it. **A bill with one
 * unmetered line is a bill whose largest line might be the unmetered one.**
 *
 * **The figures are kept beside the ledger's rather than inside it**, because the ledger prices calls made through
 * `DeepSeekProvider` and this is not one of them; **merging two sources into one total without saying which is which
 * is how a total stops being checkable.**
 */
const judgeSpend = {
  calls: 0,
  failures: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  // **How many refusals were rate limits**, because a judge that gave up on a 429 and a judge that gave up on a bad
  // answer are different failures with different fixes, and `failures` alone cannot tell them apart.
  rateLimited: 0,
};

/** Their judge prompt, reconstructed from their paper's description: same defect, different words is a match. */
async function judgeImpl(comment, golden) {
  const prompt = [
    'You are comparing a code review comment against an expert-confirmed issue from the same pull request.',
    'Answer with one JSON object: {"match": true|false}.',
    'They match when they describe the same underlying defect, even in different words.',
    '',
    `Expert-confirmed issue:\n${golden}`,
    '',
    `Review comment:\n${comment}`,
  ].join('\n');
  for (let attempt = 0; attempt < DEFAULT_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          // **A verdict is four tokens wide.** The prompt says "reply with JSON only" and the model complies, but an
          // unbounded field is an instruction rather than a bound, and **the difference between a bound and an
          // instruction is the half of the bill that arrives on the days the model explains itself.**
          max_tokens: 16,
          messages: [
            {
              role: 'system',
              content: 'You compare code review statements. Reply with JSON only.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        // **The wait the endpoint asked for, carried on the error so the catch block can honour it.** A `Retry-After`
        // read here and dropped there is the same thing as not reading it.
        const refusal = new Error(`http ${res.status}`);
        refusal.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after'));
        if (res.status === 429) judgeSpend.rateLimited += 1;
        throw refusal;
      }
      const body = await res.json();
      recordJudgeUsage(body.usage);
      const text = String(body.choices?.[0]?.message?.content ?? '')
        .replace(/```json|```/g, '')
        .trim();
      return Boolean(JSON.parse(text).match);
    } catch (error) {
      // **A header wins over the schedule, and the schedule is long enough to cross a window.** Three attempts inside
      // six seconds was three attempts inside one rate-limit window: the same request refused three times, and the third
      // refusal was recorded as the judge having nothing to say. **That is how 183 pairs of one arm and none of the
      // other became a recall figure**, and it is why this loop now waits what it is told and then waits longer.
      const wait = Number.isFinite(error?.retryAfterMs)
        ? Number(error.retryAfterMs)
        : backoffMs(attempt, { jitter: Math.random() });
      await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
    }
  }
  // **A judge that did not answer is not a non-match**, the same distinction as everywhere else in this repository.
  judgeSpend.failures += 1;
  return null;
}

/**
 * **The judge this run uses, and the seam that lets the arithmetic be tested without the model.**
 *
 * **Why a seam is not a mock of the thing under test.** The arithmetic below - ranking, matching, the curve, the paired
 * test - is what a run is *for*, and **it can only be checked against a corpus whose answers are known in advance.**
 * `--dry-run` substitutes a table here, asserts the figures against numbers written by hand, and exits without writing
 * an artifact; **every other call in this file is the one that runs in the job.**
 */
let judgeFn = judgeImpl;

/**
 * **One judge pass per pair, and every verdict kept.**
 *
 * **Why the whole matrix and not the first match.** The previous version stopped judging a finding once it had matched
 * one golden, which makes the score depend on the order findings were judged in - and **a score that depends on an
 * order cannot be compared between two reviewers judged in different orders.** Judging every pair costs
 * `findings × goldens` calls per pull request - about a thousand for the corpus at this size - and buys the two things
 * the next iteration needs: **a maximum matching rather than a greedy walk**, and **a curve that can be redrawn at any
 * budget without spending the model's budget again**.
 *
 * **And it is bounded work rather than unbounded work**, because the pairs are known before the first call, so the
 * concurrency below is a limit on calls in flight and not a race between them.
 */
const JUDGE_CONCURRENCY = Number(process.env['AACR_JUDGE_CONCURRENCY'] ?? '6');

/**
 * Run `task` over `items` with at most `limit` in flight.
 *
 * **A worker pool rather than `Promise.all(items.map(...))`**, because the matrix is a thousand calls and **a thousand
 * concurrent requests to one endpoint is how a run gets rate-limited into a partial result that reads as a worse
 * reviewer.** The index is taken from a single counter, which JavaScript's single-threaded execution makes safe.
 */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      results[at] = await task(items[at], at);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Judge every finding against every golden in one pull request.
 *
 * **Returns, per finding, which goldens it matched** - a list rather than a boolean, because **a finding that matches
 * two goldens is evidence about both**, and a boolean would have forced the choice at the moment of judging, which is
 * the moment the answer key is least known.
 *
 * **The order the pairs are judged in is a cost decision, and it changes no verdict.**
 *
 * The judge's prompt is `instructions + expert-confirmed issue + review comment`, and the first two blocks are the same
 * for every finding scored against the same golden. **A prefix cache is written by the first request that carries it and
 * read by the requests that follow**, so a matrix submitted in `finding-major` order has one request per golden carrying
 * a prefix nobody has written yet, and the concurrent ones miss - which is why the run of 2026-11-10 reported **7.9 %**
 * cache reuse on 6 859 calls while the reviewer, which orders its lanes, reported 61 %.
 *
 * **So each golden's first pair is judged alone before the rest of its pairs are submitted together.** The verdicts are
 * identical - every pair is still judged once, against the same inputs, at the same temperature - and the only thing
 * that changes is which request pays the full price for the prefix. **This is the same device as `planLaneWaves`, applied
 * to the judge**, and it is here rather than in the provider because the judge is a bare `fetch` in this file.
 */
async function judgeMatrix(texts, goldens) {
  const pairs = [];
  // **Golden-major**, so a golden's prefix is written once and read `texts.length - 1` times.
  for (let golden = 0; golden < goldens.length; golden += 1) {
    for (let finding = 0; finding < texts.length; finding += 1) pairs.push([finding, golden]);
  }
  const verdicts = new Array(pairs.length);
  const judged = new Set();
  // The warm pass: one call per golden, in sequence, so each prefix exists before anything tries to read it.
  for (let at = 0; at < pairs.length; at += 1) {
    const [finding, golden] = pairs[at];
    if (judged.has(golden)) continue;
    judged.add(golden);
    verdicts[at] = await judgeFn(texts[finding], goldens[golden]);
  }
  const rest = pairs.map((_, at) => at).filter((at) => !judged.has(at));
  const tail = await mapLimit(rest, JUDGE_CONCURRENCY, (at) => {
    const [finding, golden] = pairs[at];
    return judgeFn(texts[finding], goldens[golden]);
  });
  rest.forEach((at, index) => {
    verdicts[at] = tail[index];
  });
  const matches = texts.map(() => []);
  let unanswered = 0;
  pairs.forEach(([finding, golden], at) => {
    const verdict = verdicts[at];
    if (verdict === null) unanswered += 1;
    else if (verdict) matches[finding].push(golden);
  });
  return { matches, unanswered };
}

/**
 * **The measurement, on a corpus whose answers are written by hand.**
 *
 * **Why this exists at all.** A benchmark job that runs once per push and costs a thousand model calls is not a test:
 * **its arithmetic is unverified until the day it produces a number someone quotes.** This mode runs every step of the
 * job except the two that need the network - the review and the judge - over a four-golden, six-finding fixture whose
 * expected precision, recall, F1 and curve are written below **before** the code that computes them runs.
 *
 * **And the fixture is chosen to be able to fail.** Two findings match a golden the gate drops, so the gate's F1 is
 * *lower* than the whole list's here (0.5714 against 0.6) - **a self-test that can only pass is a self-test that says
 * nothing**, and a rule that is allowed to lose is a rule whose gain on the real corpus means something.
 */
async function dryRun() {
  const assert = (await import('node:assert/strict')).default;
  const {
    collectDiffFacts,
    matchedGoldenIndices,
    maximumMatchingCount,
    point,
    rankFindings,
    topKCurve,
  } = await import('../../packages/intelligence/dist/review/actionability.js');

  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    '+const a = source.item;',
    '+return a.value;',
    '+log(a);',
  ].join('\n');
  const goldens = [
    'null deref in the guard',
    'the loop reads past the end',
    'unvalidated input',
    'missing error handling',
  ];

  // **The judge's answers, keyed by the finding's title**, because the title is the part of the prompt the two arms
  // share and the part the fixture controls.
  const answers = new Map([
    ['F1 null deref in the guard', [0]],
    ['F2 null deref reported again', [0]],
    ['F3 the loop reads past the end', [1]],
    ['F4 missing error handling', [3]],
    ['F5 rename the temporary', []],
    ['F6 style remark', []],
  ]);
  const judgeCalls = [];
  judgeFn = async (comment, golden) => {
    const title = comment.slice(0, comment.indexOf(' :: '));
    const goldenAt = goldens.indexOf(golden);
    judgeCalls.push({ title, goldenAt });
    return (answers.get(title) ?? []).some((at) => at === goldenAt);
  };

  const findings = [
    {
      title: 'F1 null deref in the guard',
      startLine: 1,
      endLine: 1,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the guard is missing before the deref',
      suggestion: 'Add a check before the deref',
    },
    {
      title: 'F2 null deref reported again',
      startLine: 2,
      endLine: 2,
      severity: 'medium',
      category: 'bug',
      lane: 'maintainability',
      description: 'the same deref seen from another angle',
      suggestion: null,
    },
    {
      title: 'F3 the loop reads past the end',
      startLine: 99,
      endLine: 99,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the loop bound is one too far',
      suggestion: 'Remove the call',
    },
    {
      title: 'F4 missing error handling',
      startLine: 3,
      endLine: 3,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the call can throw and nothing catches',
      suggestion: 'Throw on the error',
    },
    {
      title: 'F5 rename the temporary',
      startLine: 1,
      endLine: 1,
      severity: 'low',
      category: 'style',
      lane: 'maintainability',
      description: 'the temporary is unnamed in meaning',
      suggestion: 'Rename the temporary',
    },
    {
      title: 'F6 style remark',
      startLine: 50,
      endLine: 50,
      severity: 'info',
      category: 'style',
      lane: 'maintainability',
      description: 'spacing near the block',
      suggestion: null,
    },
  ];

  const facts = collectDiffFacts(diff);
  const ranked = rankFindings(
    findings.map((finding) => ({ finding, path: 'a.ts' })),
    facts,
  );
  assert.equal(
    ranked[0].finding.title,
    'F1 null deref in the guard',
    'the grounded finding with a fix and a security lane must rank first',
  );
  assert.deepEqual(
    ranked.map((entry) => entry.score.actionable),
    [true, true, true, false, false, false],
    'the gate keeps the three grounded findings that say what to change',
  );

  const matrix = await judgeMatrix(
    ranked.map((entry) => `${entry.finding.title} :: ${entry.finding.description}`),
    goldens,
  );
  assert.deepEqual(matrix.matches[0], [0], 'the first finding matches the first golden');
  assert.equal(matrix.unanswered, 0, 'a scripted judge never fails to answer');

  // **The order the judge was asked, which is the only part of the cost this file owns.**
  //
  // The prompt is `instructions + golden + comment`, and the first two blocks repeat across every finding scored
  // against the same golden - so **the first request carrying a prefix writes it and the rest read it**, and a
  // `finding-major` submission has one full-price request per golden and a concurrent tail that all miss. The warm pass
  // is asserted here rather than the cache ratio, because **the cache belongs to the vendor and the order belongs to
  // this file**: a run that reports a low hit ratio and a run that submitted in the wrong order are the same run, and
  // only one of them can be fixed here.
  assert.deepEqual(
    judgeCalls.slice(0, goldens.length).map((call) => call.goldenAt),
    goldens.map((_, at) => at),
    'the warm pass touches every golden once, in order, before the rest of the matrix is submitted',
  );
  // **And it is a reordering, not a filter.** Every pair is still judged exactly once: a device that raised the cache
  // ratio by judging fewer pairs would raise it by measuring less.
  assert.equal(
    judgeCalls.length,
    matrix.matches.length * goldens.length,
    'the reordering judges every pair exactly once, so the call count is unchanged',
  );

  // **Hand-computed, in the comment, before the assertion.** Gate keeps F1 (golden 0), F4 (golden 3) and F5 (nothing):
  // 2 true positives, 1 false positive, 2 goldens missed, so precision 2/3, recall 2/4 and F1 0.5714. The whole list is
  // 6 findings over 3 distinct goldens: precision 3/6, recall 3/4, F1 0.6 - **higher than the gate's, which is the
  // fixture doing its job.**
  // **And the attribution is exercised here too**, on a fixture whose goldens are placed so that every bucket is
  // reachable: a golden on a file that was reviewed and matched, one on a file that was reviewed in silence, and one
  // on a file the engine was never handed. **A wiring that published an empty table would pass every assertion above**
  // - the figures do not read the buckets - so the partition is checked where it is produced.
  // **And a fourth golden, on a file the lanes did comment on, at the line they commented on** - which is the bucket
  // that carries more than half the corpus and whose *shape* decides what the next iteration fixes. **A shape table
  // that is only ever exercised on an empty input is a shape table that is never exercised**, so this fixture makes
  // `findingOnPathRejected` reachable and places it on a finding's own line.
  const placed = ranked.find((entry) => Number(entry?.finding?.startLine) > 0) ?? ranked[0];
  const rejectedPath = placed?.path ?? 'src/kept.ts';
  const rejectedLine = Number(placed?.finding?.startLine) > 0 ? placed.finding.startLine : 1;
  const attributed = attributeGoldens({
    goldens: [
      { path: 'src/kept.ts', note: goldens[0] },
      { path: 'src/quiet.ts', note: 'an issue on a file the lanes were silent about' },
      { path: 'src/never.ts', note: 'an issue on a file the engine was never handed' },
      {
        path: rejectedPath,
        note: 'an issue the judge did not accept, on the line we did comment on',
        startLine: rejectedLine,
      },
    ],
    reviewedPaths: ['src/kept.ts', 'src/quiet.ts', rejectedPath],
    findings: ranked,
    // **A matrix of this fixture's own, written out rather than borrowed from the run above.** `matrix.matches` is
    // indexed against the four-golden fixture, so reusing it here marked golden 1 as hit because `F3` answers golden 1
    // in that list - **an index is only meaningful against the list it was produced with**, and the failure looked like
    // a broken bucket rather than a borrowed table.
    matches: [[0], [], [], [], [], []],
  });
  assert.equal(attributed.total, 4, 'every golden is attributed exactly once');
  assert.equal(
    attributed.counts.fileNotReviewed,
    1,
    'the golden on a file the engine was never handed is attributed to the filter, not to the lanes',
  );
  assert.equal(
    attributed.counts.noFindingOnPath,
    1,
    'the golden on a file that was read and produced nothing is attributed to the reading',
  );
  assert.equal(
    attributed.counts.hit >= 1,
    true,
    'at least one golden is attributed to a finding the judge accepted',
  );
  assert.equal(
    attributed.counts.findingOnPathRejected,
    1,
    'a golden on a line we commented on, which the judge did not accept, is a targeting-or-wording defect',
  );
  const rejectionShapes = mergeAttributions([{ pr: 'fixture', ...attributed }]).rejectionShape;
  assert.equal(
    rejectionShapes.sameLine,
    1,
    "and its shape is same-line, because the finding stands on the golden's own line",
  );
  assert.equal(
    REJECTION_SHAPES.reduce((sum, shape) => sum + rejectionShapes[shape], 0),
    1,
    'the shape table re-reads the rejected goldens and adds up to them',
  );

  const full = point(
    matrix.matches.length,
    maximumMatchingCount(matrix.matches, goldens.length),
    matrix.matches.length - maximumMatchingCount(matrix.matches, goldens.length),
    goldens.length - maximumMatchingCount(matrix.matches, goldens.length),
  );
  assert.deepEqual(full, {
    k: 6,
    truePositives: 3,
    falsePositives: 3,
    falseNegatives: 1,
    precision: 0.5,
    recall: 0.75,
    f1: 0.6,
  });

  // **The gate's own arithmetic, scored the way the job scores it.**
  const keptIndices = ranked
    .map((entry, at) => ({ entry, at }))
    .filter(({ entry }) => entry.score.actionable)
    .map(({ at }) => at);
  const keptMatches = keptIndices.map((at) => matrix.matches[at]);
  const kept = point(
    keptMatches.length,
    maximumMatchingCount(keptMatches, goldens.length),
    keptMatches.length - maximumMatchingCount(keptMatches, goldens.length),
    goldens.length - maximumMatchingCount(keptMatches, goldens.length),
  );
  assert.deepEqual(kept, {
    k: 3,
    truePositives: 2,
    falsePositives: 1,
    falseNegatives: 2,
    precision: 0.6667,
    recall: 0.5,
    f1: 0.5714,
  });

  const curve = topKCurve(matrix.matches, goldens.length);
  assert.deepEqual(
    curve.map((entryAt) => entryAt.truePositives),
    [1, 2, 2, 2, 3, 3],
    'the curve rises as the tail is read, and never falls',
  );

  assert.equal(exactMcNemar(6, 0) < 0.05, true, 'six discordant pairs one way is significant');
  assert.equal(exactMcNemar(0, 0), 1, 'no discordant pairs is no evidence');

  // **The pull-request arm's budget cut, on the same fixture.**
  //
  // The arm emits an ordered list per pull request and the budget keeps its head, so **the arithmetic that decides what
  // a reader sees is `topKCurve` at the budget** - and it is asserted here rather than trusted, because **a budget
  // applied to a different order than the one reported is a figure two readers cannot reproduce.**
  const armCurve = topKCurve(matrix.matches, goldens.length);
  const atBudget = (budget) => armCurve[Math.min(budget, armCurve.length) - 1];
  assert.deepEqual(
    [1, 2, 3].map((budget) => atBudget(budget)?.truePositives),
    [1, 2, 2],
    'a budget of one keeps the first finding, of two the first two, and the third adds no golden',
  );
  assert.deepEqual(
    [1, 2, 3].map((budget) => atBudget(budget)?.falsePositives),
    [0, 0, 1],
    'the third finding is the first false positive the budget buys',
  );

  // **And the paired test between the arms, which is the only comparison two arms on one corpus support.**
  //
  // The fixture's gate keeps three findings covering goldens 0 and 3; the full list covers 0, 2 and 3. So the arms agree
  // on 0 and 3, the file arm alone holds 2, and the pull-request arm alone holds nothing: one discordant pair each way
  // would be p = 1, and here it is one way only.
  const armPairing = (ours, theirs) => {
    const a = new Set(matchedGoldenIndices(ours, goldens.length));
    const b = new Set(matchedGoldenIndices(theirs, goldens.length));
    let onlyA = 0;
    let onlyB = 0;
    for (const at of a) if (!b.has(at)) onlyA += 1;
    for (const at of b) if (!a.has(at)) onlyB += 1;
    return { both: a.size - onlyA, onlyA, onlyB, pValue: exactMcNemar(onlyA, onlyB) };
  };
  assert.deepEqual(
    (({ both, onlyA, onlyB }) => ({ both, onlyA, onlyB }))(armPairing(keptMatches, matrix.matches)),
    { both: 2, onlyA: 0, onlyB: 1 },
    'the gated arm keeps two of the three goldens the full list covers and adds none of its own',
  );
  assert.equal(
    armPairing(keptMatches, matrix.matches).pValue > 0.05,
    true,
    'one discordant pair is not evidence, and the job must be able to report that',
  );

  // **The switch the registered experiment turns, proved to turn before it costs anything.**
  //
  // The comparison in §8 is between two runs of this job that differ in one environment variable. **If that variable did
  // not reach the prompt, the two runs would be the same run twice** - and the report would say the checklist made no
  // difference, which is exactly what a broken flag looks like. So the dry run asserts the three properties the two
  // runs depend on: the checklist is there when it is on, absent when it is off, and absent for a language it does not
  // carry.
  const { defectChecklist } =
    await import('../../packages/intelligence/dist/review/llm/language-rules.js');
  // **Asked for explicitly, because the shipped default is now off.** The dry run is where a change in the shipped
  // arrangement is supposed to fail first, and it did: the same call without this line returned the empty string.
  const checklistOn = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    languageChecklist: true,
  });
  const checklistOff = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    languageChecklist: false,
  });
  const checklistForeign = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/rust/lib.rs',
    changeType: 'modified',
  });
  assert.ok(
    checklistOn.includes('Do not report when'),
    'the checklist reaches the prompt when it is on',
  );
  assert.equal(checklistOff, '', 'the switch removes the checklist entirely');
  assert.equal(
    defectChecklist({
      diffContent: diff,
      filePath: 'src/main/java/com/example/Ledger.java',
      changeType: 'modified',
    }),
    '',
    'and an unspecified switch renders nothing, which is what ships',
  );
  assert.equal(
    checklistForeign,
    '',
    'a language it does not carry gets no checklist rather than a generic one',
  );

  console.log(
    `AACR-BENCH dry run ok · full F1 ${full.f1} · gate F1 ${kept.f1} · curve ${curve.map((p) => p.truePositives).join(',')} · checklist ${checklistOn.length} chars on / ${checklistOff.length} off`,
  );
}

async function main() {
  // **The arithmetic without the model**, for a runner that has no credential and a reviewer who wants the maths checked.
  if (process.argv.includes('--dry-run')) {
    await dryRun();
    return;
  }
  const base = {
    comment: [
      'Our review engine on AACR-Bench, the corpus a direct competitor published.',
      '',
      '**Why this corpus**: 200 real PRs, 10 languages, 1,505 expert-confirmed issues and **three context levels, the',
      'third of which is Repo Level** - so **it measures cross-file behaviour, which is our distinctive claim**.',
      '',
      '**And the caveat that belongs in the artifact**: **Alibaba built both the tool and the benchmark it wins on**,',
      'and an independent party said so - *"an instrument that agrees with itself is not evidence."* **Their reported',
      'absolute precision is 33.9%**, so **their 33.90-versus-7.23 gap and their 9x token claim are their measurements',
      'on their corpus, not runs reproduced here.**',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    corpus: 'Alibaba-Aone/aacr-bench (Apache-2.0, public on Hugging Face)',
    judge: { model: MODEL, endpoint: BASE },
    route: 'our engine reading each PR diff; no bot account installed',
    comparisonBasis: 'their published figures, not a run we performed',
  };

  const positive = findSamples('positive_samples.json');
  const negative = findSamples('negative_samples.json');
  if (!positive) {
    write({
      ...base,
      skipped: { reason: 'positive_samples.json was not found; clone alibaba/aacr-bench' },
    });
    console.log('AACR-BENCH skipped: dataset not found');
    return;
  }
  if (!KEY) {
    write({ ...base, skipped: { reason: 'no judge credential configured' } });
    console.log('AACR-BENCH skipped: no judge credential');
    return;
  }

  // **Their real schema, read from `claude-code-demo/utils/model.py` rather than guessed.** `PRDataItem` carries
  // `githubPrUrl`, `source_commit`, `target_commit` and `comments[]`; a `Comment` carries `note` (the text), `path`,
  // `from_line`/`to_line`, `category` and `context`. **And the dataset holds no diff** - so this job fetches each PR
  // from GitHub, which **is what their own demo does** and **why the input is a URL rather than a patch.**
  const positives = JSON.parse(readFileSync(positive, 'utf8'));
  const negatives =
    negative && existsSync(negative) ? JSON.parse(readFileSync(negative, 'utf8')) : [];
  const allRows = Array.isArray(positives) ? positives : Object.values(positives);
  const rows = allRows.slice(0, MAX_PRS);

  // **And a second reviewer, on the same ground truth, with the same judge.**
  //
  // **Why this is the step that turns a volume figure into a correctness one.** Everything measured so far in this
  // comparison has been a **count** - findings per file, comments per commit - and **a count cannot rank a reviewer**,
  // because **a tool that says everything and a tool that says only true things produce the same kind of number.**
  // **AACR-Bench supplies ground truth**, so **running a competitor on it produces an F1 that can be placed beside this
  // repository's 0.0377 on the same 1,505 annotated issues.**
  //
  // **And the mechanics are its own documented ones**: the dataset names `githubPrUrl`, `source_commit` and
  // `target_commit`, so **a checkout at those two commits is what its `review --from --to` needs** - **the same
  // three fields this repository already reads to fetch the diff.**
  /**
   * **Where the competitor's own output goes when a field cannot hold it.**
   *
   * **This constant was missing when the spill was first written, and the field reported it in one line**:
   * `firstFailure: "OUTPUTS_DIR is not defined"` - **because the spill was copied from `runnable-competitors.mjs`,
   * where the constant exists, and this file never had one.** **A name that resolves in one file and not another is
   * exactly what a copy does not tell you**, and **the reason the failure was legible is that every fallible step here
   * writes its reason into a field.**
   */
  const OUTPUTS_DIR = resolve(process.cwd(), 'benchmarks', 'runnable-competitors-outputs');

  const YOU_FILES = { enabled: false };
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  /**
   * **The prose parser, written from a report that was read rather than guessed.**
   *
   * **`ocr review` has no machine-readable mode.** **`scan --json` works and `review --json` reports `unknown flag`**
   * - so **four extraction strategies over a stream containing no document all failed**, and **the only way forward
   * was to keep one whole output and read it.**
   *
   * **And the format is regular**, which is what the whole output showed:
   *
   *     Review complete: 9 finding(s) across 35 selected item(s).
   *
   *     --- src/Mod/TechDraw/App/DrawViewPart.cpp:1299-1300 ---
   *     [bug . medium] `angle` is declared uninitialized and only assigned inside the two `if` branches. ...
   *     -     double angle;
   *     +     double angle = 0.0;
   *
   * **Three shapes, one regular each**: **a header carrying the tool's own count**, **a separator carrying the file and
   * a line range**, and **a bracketed tag carrying a category and a severity**, followed by prose and **sometimes a
   * suggested diff**. **The separator uses U+2500 box-drawing characters**, which is why it is matched on the code
   * point rather than on a dash.
   *
   * **And the tool's own count is kept**, because **a parser that returns fewer findings than the tool reported is
   * indistinguishable from a tool that found fewer** - which is **the same distinction `prsFailed` draws one level
   * up, applied to a parser instead of a run.**
   */
  const REVIEW_SEPARATOR = /^\u2500{3}\s+(.+?):(\d+)-(\d+)\s+\u2500{3}$/;
  const REVIEW_TAG = /^\[([^\u00b7\]]+?)\s*\u00b7\s*([^\]]+?)\]\s*(.*)$/;
  const REVIEW_COUNT = /Review complete:\s*(\d+)\s+finding/i;

  function parseProseReport(text) {
    const lines = String(text).split(String.fromCharCode(10));
    const findings = [];
    let declaredCount = null;
    let current = null;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const countMatch = REVIEW_COUNT.exec(line);
      if (countMatch) {
        declaredCount = Number(countMatch[1]);
        continue;
      }
      const sep = REVIEW_SEPARATOR.exec(line);
      if (sep) {
        if (current) findings.push(current);
        // **A separator closes the previous finding**, so **prose that spans lines is gathered rather than truncated
        // to its first line.**
        current = {
          path: sep[1],
          startLine: Number(sep[2]),
          endLine: Number(sep[3]),
          category: null,
          severity: null,
          body: [],
        };
        continue;
      }
      if (!current) continue;
      const tag = REVIEW_TAG.exec(line);
      if (tag && current.category === null) {
        current.category = tag[1].trim();
        current.severity = tag[2].trim();
        current.body.push(tag[3]);
        continue;
      }
      // **A diff line is part of the finding**, and **a blank line ends nothing** - the next separator does.
      current.body.push(line);
    }
    if (current) findings.push(current);
    return {
      declaredCount,
      findings: findings.map((f) => ({ ...f, body: f.body.join(String.fromCharCode(10)).trim() })),
    };
  }

  /**
   * `owner/repo` from a pull request URL.
   *
   * **Split rather than matched.** The first version used a regular expression, and **the `/` inside `[^/]` ended the
   * literal early** - `SyntaxError: Unexpected token '^'` - which is **the twelfth time in this stretch that a quoted
   * pattern met text it was not written for.** **A URL has a fixed shape and `split` states that shape without an
   * escape**: `https://github.com/owner/repo/pull/123` is **five `/`-separated pieces from the scheme onward**.
   */
  /**
   * **The competitor's finding, in the shape the ranker reads.**
   *
   * **Why a translation rather than a second ranker.** The ranker is applied to both reviewers with the same rules and
   * the same weights, so **a difference between the two arms is a difference between the reviewers** - and **the only
   * thing this function may do is lose information, never add it.** Its severity tag becomes a severity, its category
   * tag becomes a category, and the suggested diff it prints inline becomes the suggestion, because that is where the
   * tool puts it.
   *
   * **A finding with no text is dropped rather than scored**, because a comment that says nothing cannot be ranked
   * above or below anything and counting it as a false positive would be counting the parser's own limitation.
   */
  const CATEGORY_NAMES = [
    'bug',
    'security',
    'performance',
    'maintainability',
    'test',
    'style',
    'documentation',
    'architecture',
    'api',
  ];

  function competitorRowOf(entry) {
    const body = String(
      typeof entry === 'string' ? entry : (entry.content ?? entry.body ?? ''),
    ).trim();
    if (body === '') return null;

    const severityTag = String(entry.severity ?? '').toLowerCase();
    const severity = severityTag.includes('critical')
      ? 'critical'
      : severityTag.includes('high') || severityTag.includes('major')
        ? 'high'
        : severityTag.includes('low') || severityTag.includes('minor')
          ? 'low'
          : 'medium';
    const categoryTag = String(entry.category ?? '').toLowerCase();
    const category = CATEGORY_NAMES.find((name) => categoryTag.includes(name)) ?? 'other';

    const lines = body.split(String.fromCharCode(10));
    const suggested = lines.filter(
      (line) => /^[+-]/.test(line.trimStart()) && !/^[+-]{3}/.test(line),
    );
    const startLine = Number(entry.startLine ?? entry.line ?? Number.NaN);
    const endLine = Number(entry.endLine ?? entry.line ?? Number.NaN);

    return {
      path: String(entry.path ?? ''),
      finding: {
        startLine: Number.isFinite(startLine) ? startLine : 0,
        endLine: Number.isFinite(endLine) ? endLine : 0,
        severity,
        category,
        title: lines[0].slice(0, 160),
        description: body,
        suggestion: suggested.length > 0 ? suggested.join(String.fromCharCode(10)) : null,
      },
    };
  }

  const shortRepo = (url) => {
    const parts = String(url ?? '').split('/');
    const at = parts.indexOf('github.com');
    return at >= 0 && parts.length > at + 2 ? `${parts[at + 1]}/${parts[at + 2]}` : null;
  };

  const { createDiff } =
    await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  /**
   * Run a competitor over one labelled pull request, and return its findings as text.
   *
   * **This function was deleted by the edit that replaced `shortRepo`**, because **it sat between that edit's two
   * markers** - **the thirteenth time in this stretch that a bulk edit matched text it was not written for, and the
   * first time it removed a definition rather than changing one.** **The job said so in one line** -
   * `AACR-BENCH failed: reviewWithOcr is not defined` - **which is what a missing binding reports.**
   *
   * **A checkout of two commits and `review --from --to`**, because **that is the interface its own documentation names
   * for a local review of a range** - and **the checkout is shallow and temporary**, because **the corpus is 200 pull
   * requests** and **a full clone per pull request is a cost this job would pay 200 times for history it never reads.**
   */
  const reviewWithOcr = (endpoint, key, url, source, target) => {
    const repo = shortRepo(url);
    if (!repo) return { ok: false, reason: 'the pull request URL did not name a repository' };
    const dir = mkdtempSync(`${tmpdir()}/ocr-`);
    try {
      // **The two commits have to share a history, and the first version made sure they did not.**
      //
      // **What the tool said, once `firstFailure` was carrying a sentence rather than nothing**:
      //
      //     [ocr] Summary: 0 file(s) reviewed, 0 comment(s), ~0 token(s) used, 0s elapsed
      //     Review failed (input): 0 finding(s); 0 of 0 selected item(s) failed.
      //
      // **`0 file(s) reviewed` and `0 of 0 selected item(s)` is a range it could not resolve** - because **two
      // independent `--depth 1` fetches produce a repository with two root commits and no merge base**, so
      // **`--from A --to B` had nothing between them.**
      //
      // **So the history is fetched without its blobs**, which is **the one shape that gives a merge base cheaply**:
      // **`--filter=blob:none` downloads every commit and no file contents**, and **the checkout then fetches only the
      // blobs that commit needs.** **A shallow fetch was cheaper and wrong; this is cheap and right.**
      execFileSync(
        'git',
        [
          'clone',
          '-q',
          '--filter=blob:none',
          '--no-checkout',
          `https://github.com/${repo}.git`,
          dir,
        ],
        {
          stdio: 'pipe',
          timeout: 600_000,
        },
      );
      execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin', source, target], {
        stdio: 'pipe',
        timeout: 300_000,
      });
      execFileSync('git', ['-C', dir, 'checkout', '-q', target], {
        stdio: 'pipe',
        timeout: 300_000,
      });
      // **`--json` is for `scan` and not for `review`, and the field said so.**
      //
      // **`firstFailure` reported `Error: unknown flag: --json` on the first run after it was fixed** - **which is what
      // a repaired reason field buys**: **the next iteration gets a sentence instead of a guess.** **`scan --json`
      // works, because that is where this project already succeeded**; **`review` does not take it.**
      //
      // **And the default output is kept rather than parsed blind**, because **the shape of `review`'s output has not
      // been seen yet** - **so the raw text travels in the artifact, and the next iteration reads the shape instead of
      // assuming one**, which is **the fifth time in this stretch that a shape was learned rather than guessed.**
      const stdout = execFileSync('ocr', ['review', '--from', source, '--to', target], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
        env: { ...process.env, OCR_LLM_URL: endpoint, OCR_LLM_TOKEN: key },
      });
      // **And the output is spilled to a file, because its format has never been seen.**
      //
      // **Four extraction strategies were tried and all four failed**, and **the last one's error was the informative
      // one**: `Unexpected token 'R', "Review com"…` - **the output is prose, and there is no JSON anywhere in it.**
      // **`--json` is accepted by `scan` and rejected by `review`**, so **this subcommand has no machine-readable
      // mode**, and **the only way to learn its format is to keep one whole** - **which is what
      // `firstOutputHead`'s six hundred characters could not do.**
      mkdirSync(OUTPUTS_DIR, { recursive: true });
      const spilled = join(
        OUTPUTS_DIR,
        `open-code-review-review-${String(source).slice(0, 8)}.txt`,
      );
      writeFileSync(spilled, stdout);
      return { ok: true, stdout, outputFile: spilled };
    } catch (error) {
      // **Both streams, because the reason can be in either.** **A tool that fails silently on stdout and explains
      // itself on stderr is the common case**, and **the first version read only the first of the two.**
      const out = String(error.stdout ?? '').trim();
      const err = String(error.stderr ?? '').trim();
      const message = String(error.message ?? '').trim();
      const reason = out || err || message || '';
      return {
        ok: false,
        reason: reason.slice(0, 600),
        status: typeof error.status === 'number' ? error.status : null,
        signal: error.signal ?? null,
      };
    }
  };

  const { LLMReviewEngine } =
    await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const {
    ACTIONABILITY_WEIGHTS,
    collectDiffFacts,
    matchedGoldenIndices,
    maximumMatchingCount,
    point,
    rankFindings,
    scoreSubset,
    topKCurve,
  } = await import('../../packages/intelligence/dist/review/actionability.js');
  const { DeepSeekProvider } =
    await import('../../packages/intelligence/dist/review/llm/provider.js');
  // **The ledger, and the ceiling that stops a runaway job.** The balance reading below says what the *account* spent
  // between two moments; **this says which lane spent it, and refuses the next call once the job has spent what it was
  // allowed.** The default is a bound the observed job fits inside: a 14-pull-request run with both arms moved the
  // balance by 62.82 CNY on 2026-11-09, which is about 8.9 USD at 7.1 - so 12 USD admits a legitimate run and stops a
  // retry storm at roughly one and a third of it. **A ceiling set below the cost of a valid run would be a ceiling that
  // measures the ceiling.**
  const { CostLedger, costUsdOf } =
    await import('../../packages/intelligence/dist/review/llm/cost.js');
  const ledger = new CostLedger();
  // **The ceiling is a rate over the corpus this run was asked to read, not a constant**, because the constant was
  // written for fourteen pull requests and a larger dispatch would have been admitted by a bound that was never about
  // it. The arithmetic and its margins live in `lib/run-config.mjs`, where a test can reach them; **an override still
  // wins, and the artifact records the number the run was bounded by** so that a deliberate one-off is visible in the
  // data rather than in a memory of the dispatch.
  const MAX_USD = spendCeilingUsd({
    pullRequests: MAX_PRS,
    mode: COMPETITOR_CHOICE.mode,
    override: process.env['AACR_MAX_USD'],
  });
  // **The dedup threshold is a parameter now, and this run takes the next point on its curve.**
  //
  // **At 0.6 the merge removed 360 of 488 findings, raised precision 2.3 times and lowered recall from 0.56 to 0.36** -
  // **ten true positives were merged with neighbours that shared most of their vocabulary.** **So 0.6 over-merges, and
  // the cheapest next measurement is the same run at a higher threshold**: **0.8 requires four fifths of the content
  // words to agree, so a genuinely different defect in the adjacent line survives.**
  const DEDUP_THRESHOLD = Number(process.env['AACR_DEDUP_THRESHOLD'] ?? 0.8);
  const engine = new LLMReviewEngine(new DeepSeekProvider({ ledger, ceilingUsd: MAX_USD }), {
    dedupThreshold: DEDUP_THRESHOLD,
    languageChecklist: CHECKLIST,
    promptOrder: PROMPT_ORDER,
  });
  console.log(`AACR-BENCH dedup threshold ${DEDUP_THRESHOLD} · prompt order ${PROMPT_ORDER}`);

  /**
   * **The second parameter of every draw this job takes.**
   *
   * **Why a credit reading belongs in the artifact.** **Five runs of this script on one corpus produced F1 values of
   * 0.0377, 0, 0.1724, 0.037 and 0**, and **the run that got furthest reported `402 Payment Required` with
   * `Insufficient Balance`** - so **the engine, the judge and the competitor all spend from one key**, and **a balance
   * that runs out mid-run lowers recall in a way indistinguishable from a worse reviewer.**
   *
   * **`GET /user/balance` is the provider's own reading of that**, so **it is taken before the loop and after it**,
   * and **both are stored** - because **a figure that moved while the account moved is a figure with a second
   * parameter, and the parameter belongs in the same file as the figure.**
   */
  const creditPosition = async () => {
    const key = process.env['DEEPSEEK_API_KEY'] ?? process.env['MARTIAN_API_KEY'] ?? '';
    if (!key) return { probed: false, reason: 'no key in the environment' };
    try {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // **A balance endpoint that refuses is itself the reading** - `402` here means the same thing it means on a
        // completion call, and **it arrives before any work is done**.
        return { probed: true, ok: false, status: response.status, body: body.slice(0, 240) };
      }
      const payload = await response.json();
      const info = Array.isArray(payload?.balance_infos) ? payload.balance_infos[0] : null;
      return {
        probed: true,
        ok: true,
        isAvailable: payload?.is_available ?? null,
        currency: info?.currency ?? null,
        totalBalance: info?.total_balance ?? null,
        grantedBalance: info?.granted_balance ?? null,
        toppedUpBalance: info?.topped_up_balance ?? null,
      };
    } catch (error) {
      return { probed: true, ok: false, reason: String(error.message ?? '').slice(0, 240) };
    }
  };

  const creditBefore = await creditPosition();
  console.log(`AACR-BENCH credit before: ${JSON.stringify(creditBefore).slice(0, 200)}`);

  // **The engine's counters belong to the engine.** **The first version wrote them onto `competitor`, which is the
  // other reviewer's record, so the artifact reported 199 files under the competitor's name** - **a unit-of-attribution
  // defect in the file that exists to attribute.**
  const engineCounters = {
    filesReviewed: 0,
    emptyDiffs: 0,
    fileFailures: 0,
    firstFileFailure: null,
    laneStats: null,
  };
  const ocrKey = process.env['OCR_LLM_TOKEN'] ?? process.env['DEEPSEEK_API_KEY'] ?? '';
  /**
   * **The competitor arm is a recorded input, and its default is the cheap side of the choice.**
   *
   * **The arithmetic that made this the next fix**: the run of 2026-11-10 cost 8.53 USD, of which **5.89 USD - 69 % -
   * was this arm**, driven through the competitor's CLI from the same key, over fourteen pull requests whose goldens had
   * not changed. **Its figure is a property of the corpus, not of this project's code** - it does not move when a prompt
   * does - so buying it on every run is buying the same number twice.
   *
   * **`replay` is the default and `record` is a decision someone makes**, because the two mistakes are not symmetric:
   * a stale replay is a wrong figure, a stray record is a bill. **A missing record is reported and excluded**, never
   * repaired by buying one - `competitor.missing` carries the reason into the artifact.
   */
  const COMPETITOR_BASELINE_PATH = resolve(
    process.env['AACR_COMPETITOR_BASELINE'] ?? DEFAULT_BASELINE_PATH,
  );
  const competitorChoice = COMPETITOR_CHOICE;
  const corpusFingerprintOfRun = corpusFingerprint(rows);
  // **A file of another version throws here rather than being read as if the shape had not changed**, which is the
  // one failure this run should not paper over: every row below it is only meaningful under the shape it was written in.
  const existingBaseline = readBaseline(COMPETITOR_BASELINE_PATH);
  let competitorBaseline =
    competitorChoice.mode === 'record'
      ? startRecording({
          existing: existingBaseline,
          fingerprint: corpusFingerprintOfRun,
          judgeModel: MODEL,
          tool: 'open-code-review',
        })
      : existingBaseline;
  /** The rows this run paid for, written once at the end - so a run that dies mid-loop leaves the old file intact. */
  let recordedAny = 0;
  const competitor = {
    tool: 'open-code-review',
    // **What this run did with the arm, and why** - the three figures a reader needs to price the run without reading
    // the code: which mode was asked for, how many pull requests were replayed, and how many the record could not answer.
    mode: competitorChoice.mode,
    modeReason: competitorChoice.reason,
    replayed: 0,
    recorded: 0,
    missing: [],
    baselinePath: competitorChoice.mode === 'record' ? COMPETITOR_BASELINE_PATH : null,
    prsAttempted: 0,
    prsFailed: 0,
    // **The pull requests it failed on, named**, because **a count of failures in a head-to-head is a number a reader
    // cannot check** - and because the one failure of 2026-11-09 was scored as a non-event for a whole iteration
    // precisely because nothing in this object said which pull request it was.
    failedPullRequests: [],
    firstFailure: null,
    findings: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    judgeUnanswered: 0,
    // **The shape and size of its output, and the head of it when it will not parse** - because **a reviewer that
    // spoke and was not understood is a fact worth keeping**, the same distinction as `prsFailed`.
    outputKeys: null,
    outputChars: null,
    firstOutputHead: null,
    // **Where the whole output of the first run that spoke is kept**, because **its format is the thing being learned.**
    firstOutputFile: null,
    // **The parser's own account**: which strategy worked, how many the tool claimed, how many were parsed, and
    // whether the two agree.
    extraction: null,
    declaredCount: null,
    parsedCount: null,
    countsAgree: null,
    firstFinding: null,
    // **A provider that refused for want of credit is a fact about the account, not about the reviewer** - and **it is
    // the one failure class that also explains a variance in this repository's own numbers.**
    creditExhausted: false,
  };
  let unanswered = 0;
  /**
   * **The per-pull-request judged matrices, which are the raw material of every figure below.**
   *
   * **Why they are kept rather than summed.** A curve, a gate and a maximum matching are three questions about one
   * matrix, and **re-judging the corpus to ask a second question would spend the model's budget on pairs it had already
   * answered** - and, worse, would answer them again at a different temperature-free draw and call the difference a
   * finding. **So the verdicts are collected once and every figure is derived from them.**
   */
  const perPr = [];
  const rankedDetail = [];
  // **One entry per pull request: which bucket each of its goldens fell in**, merged and published below.
  const attributed = [];
  const competitorPerPr = [];
  const competitorDetail = [];
  // **The second arm's accumulators, kept separate so neither can consume the other's matches.**
  let tpWhole = 0;
  let fpWhole = 0;
  let fnWhole = 0;
  let unansweredWhole = 0;
  let wholePrFindingsTotal = 0;
  let wholePrLanesTotal = 0;
  /** **Per pull request, for the pull-request arm** - a paired test needs the two arms on the same goldens. */
  const prArmPerPr = [];
  const prArmDetail = [];
  let reviewed = 0;
  let unfetched = 0;
  const categories = {};
  const contextLevels = {};

  /** The pull request's unified diff, through the API, because **the corpus stores a URL and not a patch.** */
  async function fetchPrDiff(url) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return null;
    const [, owner, repo, num] = m;
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? '';
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
        headers: {
          accept: 'application/vnd.github.v3.diff',
          'user-agent': 'agentix-e-aacr-bench',
          ...(token ? { authorization: `token ${token}` } : {}),
        },
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  for (const pr of rows) {
    // **Their field names, and the diff fetched rather than read from the corpus.** **A PR whose diff cannot be
    // fetched is counted separately and not skipped quietly**, because **"the corpus had no data for it" and "we could
    // not read it" are different facts** - the distinction this repository keeps drawing.
    const comments = pr.comments ?? [];
    // **The note and its coordinates, kept or dropped together.**
    //
    // This was `comments.map((c) => String(c.note ?? '')).filter(Boolean)`: the texts survived and **the `path` and
    // `from_line` that travelled beside each one were discarded**, which is why this job could report a recall and not a
    // reason for it. The filter is the same, applied to the comment rather than to the text, so `issueTexts` is
    // byte-identical to what it was and `goldens` is the same list with its coordinates attached.
    const goldenComments = comments.filter((c) => String(c.note ?? '') !== '');
    const issueTexts = goldenComments.map((c) => String(c.note ?? ''));
    const goldens = goldenComments.map((c) => ({
      path: String(c.path ?? ''),
      note: String(c.note ?? ''),
      startLine: Number(c.from_line ?? c.to_line ?? 0) || null,
      endLine: Number(c.to_line ?? c.from_line ?? 0) || null,
    }));
    const diff = await fetchPrDiff(pr.githubPrUrl);
    if (diff === null) {
      unfetched += 1;
      continue;
    }
    // **The competitor, on this pull request, judged by the same judge against the same goldens.**
    //
    // **And its findings are extracted the way its own output shapes them** - a `comments` array carrying `content` and
    // `path` - because **the key was learned from a previous run rather than assumed**, and **an extractor that guesses
    // returns an empty list that reads as a silent reviewer.**
    // **The diff, read once per pull request and shared by both reviewers**, because **the ranking in
    // `review/actionability.ts` grounds a finding against the lines the diff added** - and **two reviewers scored
    // against two different readings of the same diff would differ by the reading rather than by the review.**
    const prFacts = collectDiffFacts(diff);
    // **Three answers, and the two that are not a purchase come first.**
    //
    // A replayed pull request contributes exactly the fields a live one contributes, so the scoring below cannot tell
    // which it received; a missing one is named with its reason and left out of the comparison rather than silently
    // counted as a zero, because **a competitor with no row is a hole in the pairing, not a competitor that found
    // nothing.**
    const competitorKey = pr.githubPrUrl ?? `pr-${competitorPerPr.length}`;
    const competitorDecision = resolveCompetitor({
      mode: competitorChoice.mode,
      baseline: competitorBaseline,
      fingerprint: corpusFingerprintOfRun,
      judgeModel: MODEL,
      key: competitorKey,
    });
    if (competitorDecision.kind === 'replay') {
      competitorPerPr.push(replayedPull(competitorKey, competitorDecision.pull));
      for (const row of competitorDecision.pull.detail ?? []) {
        competitorDetail.push({ ...row, pr: competitorKey, which: 'competitor' });
      }
      competitor.findings += Number(competitorDecision.pull.findings ?? 0);
      competitor.judgeUnanswered += Number(competitorDecision.pull.unanswered ?? 0);
      competitor.replayed += 1;
    } else if (competitorDecision.kind === 'missing') {
      competitor.missing.push({ key: competitorKey, reason: competitorDecision.reason });
    } else if (competitorDecision.kind === 'record' && !ocrKey) {
      // **A recording run without a credential is a missing row, not a failure of the tool**: the run asked for a
      // purchase it could not pay for, which is a fact about the environment rather than about the competitor.
      competitor.missing.push({
        key: competitorKey,
        reason: 'the run was asked to record and no competitor credential is configured',
      });
    } else if (ocrKey) {
      const outcome = reviewWithOcr(
        process.env['OCR_LLM_URL'] ?? '',
        ocrKey,
        pr.githubPrUrl,
        pr.source_commit,
        pr.target_commit,
      );
      competitor.prsAttempted += 1;
      if (!outcome.ok) {
        competitor.prsFailed += 1;
        // **A failure with an empty reason is a failure this file has already seen.**
        //
        // **The first version recorded the reason only when it was the first failure AND the field was `null`**, and
        // **the run that installed the tool reported `firstFailure: ""`** - **an empty string, not a null** - so
        // **the reason was lost at the one moment it mattered.** **An empty reason reads exactly like no reason**, and
        // **the difference between "it did not run" and "it did not run and here is why" is the whole value of the
        // field.**
        //
        // **So the guard is on the content rather than on the sentinel**, and **the raw stderr is the fallback**,
        // because **`spawnSync ocr ENOENT` arrived in a field named `reason` and a lower-case message arrived in
        // neither.**
        const raw = typeof outcome.reason === 'string' ? outcome.reason.trim() : '';
        // **And one class of failure is not about the tool at all.**
        //
        // **What the run that got furthest reported**:
        //
        //     [ocr] 35 file(s) changed, reviewing 35
        //     [ocr] LLM grouping failed (POST "https://api.deepseek.com/anthropic/v1/messages":
        //           402 Payment Required {"error":{"message":"Insufficient Balance"}})
        //
        // **The range resolved, the endpoint was accepted, and the provider refused the call for want of credit.**
        // **That is a fact about the account rather than about the reviewer**, and **it is also the likeliest
        // explanation for this repository's own AACR figure moving between 0 and 0.1724 across four runs on one corpus
        // and one script** - because **our engine and the judge spend from the same key.**
        //
        // **So it is named rather than folded into a generic sentence**, because **a run that had credit and a run
        // that did not produce the same zero and mean different things** - **the same distinction `prsFailed` draws one
        // level up.**
        const creditFailure = /402|Insufficient Balance|Payment Required/i.test(raw);
        const reason = creditFailure
          ? `the provider refused the call for want of credit: ${raw.slice(0, 300)}`
          : raw !== ''
            ? raw
            : '(the tool reported a failure with no message)';
        if (creditFailure) competitor.creditExhausted = true;
        if (
          !competitor.firstFailure ||
          competitor.firstFailure === '(the tool reported a failure with no message)'
        ) {
          competitor.firstFailure = reason;
        }
      } else {
        try {
          // **The output is looked at before it is parsed**, because **its shape has not been seen** - **the same
          // lesson `scan` taught when the array turned out to be `comments` rather than `findings`.**
          const text = String(outcome.stdout).trim();
          // **Its logging and its JSON share one stream, and the first character of a log line is `[`.**
          //
          // **What the previous run printed**: `its output did not parse: Unexpected token 'o', "[ocr] 35 fi"` -
          // **the locator found the `[` of `[ocr]` and started parsing a log line.** **`35 file(s) changed, reviewing
          // 35` is in the same string**, which is **how the range was known to have resolved** - **so the evidence and
          // the bug were one line apart.**
          //
          // **So the log lines are removed before the JSON is located**, and **only lines that do not start with the
          // tool's own prefix are considered** - **a filter on the writer rather than a search for a bracket.**
          // **A ladder of strategies, and the one that worked is recorded.**
          //
          // **Four attempts at one extraction, and each failure named the next**:
          //
          //   1. `JSON.parse(whole)`            -> `Unexpected token 'o', "[ocr] 35 fi"`
          //   2. strip `[ocr]` lines            -> `Unexpected token 'b', "[bug · high"`
          //   3. strip every bracketed heading  -> `Expected property name or '}' … (line 2 column 15)`
          //
          // **The third is the informative one.** **Stripping heading lines *removed bytes from the middle of a
          // document*** - because **the tool writes progress headings into the same stream as its output, and a line
          // removed from between two lines of JSON joins them.** **A filter that removes lines cannot repair a
          // document it is editing.**
          //
          // **So the strategies are tried in order of how little they alter the input**, and **the one that produced
          // the parse is stored in `extraction`** - because **which strategy worked is a fact about the tool's output,
          // and the next iteration should read it rather than rediscover it.**
          const candidates = [
            // **The least alteration first**: the document is the longest suffix that parses.
            { name: 'whole', value: text },
            // **From the first object rather than the first bracket**, because **a `[` at position zero is as likely
            // to be a heading as an array**, and **the tool's document is an object** - so **`{` is the character that
            // carries information here.**
            {
              name: 'from-first-object',
              value: (() => {
                const i = text.indexOf('{');
                return i >= 0 ? text.slice(i) : text;
              })(),
            },
            {
              name: 'from-last-line-starting-with-brace',
              value: (() => {
                const lines = text.split(String.fromCharCode(10));
                for (let i = lines.length - 1; i >= 0; i -= 1)
                  if (lines[i].trimStart().startsWith('{'))
                    return lines.slice(i).join(String.fromCharCode(10));
                return text;
              })(),
            },
            // **And the heading-stripping last**, because it is the one that edits the document.
            {
              name: 'headings-removed',
              value: text
                .split(String.fromCharCode(10))
                .filter((line) => {
                  const match = /^\s*\[([^\]]{0,80})\]/.exec(line);
                  return !(match !== null && !match[1].includes('{'));
                })
                .join(String.fromCharCode(10))
                .trim(),
            },
          ];
          let parsed = null;
          let strategy = null;
          let lastError = null;
          for (const candidate of candidates) {
            if (candidate.value === '') continue;
            try {
              parsed = JSON.parse(candidate.value);
              strategy = candidate.name;
              break;
            } catch (error) {
              lastError = `${candidate.name}: ${error.message}`;
            }
          }
          // **And when no candidate is a document, the output is a report and the parser reads it.**
          //
          // **The ladder is not deleted**, because **`scan` writes JSON and this repository has read 207,811
          // characters of it** - so **a future `review` that grows a machine-readable mode is already handled.** **But
          // `review` has none today**, and **four candidates over a stream with no document is four failures** - so
          // **the fallback speaks the format this tool actually writes.**
          let list;
          if (parsed === null) {
            const prose = parseProseReport(text);
            list = prose.findings;
            competitor.extraction = 'prose';
            competitor.declaredCount = prose.declaredCount;
            // **The tool's own count against what was parsed**, because **a parser that quietly drops findings is
            // indistinguishable from a tool that found fewer** - **the distinction `prsFailed` draws one level up,
            // applied to a parser instead of a run.**
            competitor.parsedCount = list.length;
            competitor.countsAgree =
              prose.declaredCount === null ? null : prose.declaredCount === list.length;
            if (!list.length) {
              throw new Error(
                `the report parsed to no findings (${prose.findings.length} prose, no JSON candidate parsed)`,
              );
            }
          } else {
            competitor.extraction = strategy;
            list = Array.isArray(parsed)
              ? parsed
              : (parsed.comments ?? parsed.findings ?? parsed.issues ?? parsed.results ?? []);
          }
          competitor.firstFinding = list[0] ? JSON.stringify(list[0]).slice(0, 240) : null;
          competitor.outputKeys =
            parsed === null
              ? null
              : Array.isArray(parsed)
                ? ['(array)']
                : Object.keys(parsed).slice(0, 12);
          competitor.outputChars = text.length;
          // **And how many lines the tool wrote outside its JSON**, because **a stream that mixes two formats is a fact
          // about the tool** and **a parse that succeeds does not say how close it came to failing.**
          // **`body` was the filtered variable the ladder replaced, and this line still referred to it.**
          //
          // **The run reported `its output did not parse: body is not defined`** - **one line, one name, and it was
          // the fourth time in this stretch that a replacement left a reference to what it removed.** **The heading
          // count is what this line wanted**, so **it counts headings rather than subtracting a variable that no
          // longer exists.**
          const allLines = text.split(String.fromCharCode(10));
          competitor.logLines = allLines.filter((line) => {
            const match = /^\s*\[([^\]]{0,80})\]/.exec(line);
            return match !== null && !match[1].includes('{');
          }).length;
          competitor.findings += list.length;
          // **The same treatment ours gets, on the same judge, over the same goldens.**
          //
          // **Two reviewers, one ranker.** The ranking below is applied to the competitor's findings as well as to this
          // repository's, because **the claim under test is that ordering by actionability raises a reviewer's F1, not
          // that this reviewer's sentences are better** - and **if the competitor gains as much as we do, the gain
          // belongs to the ranker; if it does not, the sentences are the difference.** **One control, two arms, no
          // extra calls**: every verdict is already in the matrix.
          const competitorRows = list
            .map((entry) => competitorRowOf(entry))
            .filter((row) => row !== null);
          const competitorRanked = rankFindings(
            competitorRows.map((row) => ({ finding: row.finding, path: row.path })),
            prFacts,
          );
          const competitorMatrix = await judgeMatrix(
            competitorRanked.map(
              (ranked) => `${ranked.finding.title} :: ${ranked.finding.description}`,
            ),
            issueTexts,
          );
          competitor.judgeUnanswered += competitorMatrix.unanswered;
          const keepFlags = competitorRanked.map((ranked) => ranked.score.actionable);
          competitorPerPr.push({
            key: competitorKey,
            matches: competitorMatrix.matches,
            goldens: issueTexts.length,
            keep: keepFlags,
          });
          // **The same rows the artifact publishes, kept once and used twice** - published here, and written to the
          // baseline so that the next run pays for them zero times. **`pr` and `which` are added at publication rather
          // than stored**, because they are the same two constants for every row in the file and a record that repeats
          // them is a record whose size is mostly its own labels.
          const detailRows = competitorRanked.map((ranked, at) => ({
            path: ranked.path,
            startLine: ranked.finding.startLine,
            endLine: ranked.finding.endLine,
            severity: ranked.finding.severity,
            category: ranked.finding.category,
            score: ranked.score.score,
            features: ranked.score.features,
            actionable: ranked.score.actionable,
            matchedGoldens: competitorMatrix.matches[at],
          }));
          for (const row of detailRows) {
            competitorDetail.push({ ...row, pr: competitorKey, which: 'competitor' });
          }
          if (competitorChoice.mode === 'record') {
            competitorBaseline = withRecord(
              competitorBaseline,
              competitorKey,
              recordedPull({
                matches: competitorMatrix.matches,
                goldens: issueTexts.length,
                keep: keepFlags,
                detail: detailRows,
                unanswered: competitorMatrix.unanswered,
                findings: list.length,
              }),
            );
            competitor.recorded += 1;
            recordedAny += 1;
          }
        } catch (error) {
          competitor.prsFailed += 1;
          // **The head of the output is kept when it cannot be parsed**, because **the shape is what the next
          // iteration needs and the message alone does not carry it.**
          competitor.firstOutputHead = String(outcome.stdout ?? '').slice(0, 600);
          // **And where the whole of it is**, because **a six-hundred-character head is a sample and a format is not a
          // sample** - the same distinction the `scan` output taught when a 207,811-character answer was cut to 3,200.
          competitor.firstOutputFile = outcome.outputFile ?? null;
          const reason = `its output did not parse: ${error.message}`;
          if (!competitor.firstFailure) competitor.firstFailure = reason;
          // **And the pull request it failed on counts against it.**
          //
          // **This row was missing, and its absence was worth 0.0130 of F1 in the competitor's favour.** The run of
          // 2026-11-09 attempted fourteen pull requests, failed one, and the scoring never heard about it: a throw here
          // skipped the push below, so that pull request contributed no goldens to the denominator while its thirteen
          // goldens contributed nothing to the numerator either - **which is recall 0.3185 read against a denominator
          // of 157 instead of the 170 both reviewers were given.** The honest reading of that run is
          // **P 0.3289 / R 0.2941 / F1 0.3106**, and the difference is not a rounding: **a reviewer whose output did not
          // parse is a reviewer that found nothing on that pull request**, and scoring a crash as a non-event is the
          // one asymmetry a head-to-head cannot carry, because it flatters whichever arm has more moving parts.
          //
          // **And it is deliberately not the same as `missing`.** A missing baseline row is a **hole in the pairing** -
          // the competitor was never run on that pull request in this run, so there is no observation to score and the
          // comparison is marked incomparable. A crash is an **observation**: it ran, it spent the money, and it produced
          // nothing. **One is excluded and one is a zero**, and the two were the same code path until now.
          competitorPerPr.push({
            key: competitorKey,
            matches: [],
            goldens: issueTexts.length,
            keep: [],
          });
          competitor.failedPullRequests.push({
            key: competitorKey,
            goldens: issueTexts.length,
            reason: String(error.message ?? '').slice(0, 200),
          });
        }
      }
    }

    // **The diff is split by file, and no golden path is read.**
    //
    // **What the head-to-head found and this explains**: **the engine emitted 2 findings across five pull requests
    // while a competitor emitted 24**, and **the cause was in the two lines that used to stand here.**
    //
    //     const firstPath = String(comments[0]?.path ?? 'unknown');   // the first GOLDEN comment's path
    //     engine.reviewDiff(createDiff(firstPath, 'added', diff), diff);
    //
    // **Two defects in two lines.** **The path came from the answer key** - **so the engine was told where the first
    // labelled issue lives** - and **a multi-file pull request diff was handed over as the content of one file**, so
    // **the engine read one file's story and emitted one file's findings.**
    //
    // **And the first defect made the second invisible**: **an engine given the right path by accident looks like an
    // engine that found it**, and **the recall it produced was low enough to look like a ranking problem** - which is
    // where every tuning attempt in this repository's history had been aimed.

    /** The per-file sections of a unified diff, `a/` and `b/` prefixes stripped. */
    const splitDiffByFile = (unified) => {
      const sections = [];
      let current = null;
      for (const line of String(unified).split(String.fromCharCode(10))) {
        const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        if (header) {
          if (current) sections.push(current);
          current = { path: header[2], lines: [line] };
          continue;
        }
        if (current) current.lines.push(line);
      }
      if (current) sections.push(current);
      return sections.filter((section) => section.lines.length > 1);
    };

    const sections = splitDiffByFile(diff);
    if (!sections.length) {
      // **A pull request with no per-file sections is a fact about the input**, so **it is recorded rather than
      // counted as a review that found nothing.**
      engineCounters.emptyDiffs += 1;
    }
    engineCounters.filesReviewed += sections.length;
    const lanes = [];
    for (const section of sections) {
      const sectionDiff = section.lines.join(String.fromCharCode(10));
      try {
        // **One file per call, and the file's own path** - **so neither the count nor the location depends on the
        // answer key.**
        const produced = await engine.reviewDiff(
          createDiff(section.path, 'added', sectionDiff),
          sectionDiff,
        );
        lanes.push(...produced);
        // **And what the engine's own parse and filter did with this file's findings.**
        //
        // **The chain is `complete` -> `parseLLMResponse` -> `filterFindings`**, and **the third ran a check with the
        // wrong coordinate system**: **it compared the model's file line numbers against the DIFF's line count**, so a
        // correct finding at line 900 of a 1,500-line file died on a 40-line diff. **The engine now counts its drops
        // per rule, and those counts are what this job needs** - because **a filter that eats the answer and a reviewer
        // with nothing to say produce the same zero.**
        // **And what the deduplication removed**, because **five lanes review one diff and a defect they all see is one
        // defect** - and **a count that fell because duplicates were merged is not a count that fell because the engine
        // went quiet.**
        const dd = engine.lastDeduplication;
        if (dd) {
          const acc = engineCounters.dedup;
          if (acc) {
            acc.before += dd.before;
            acc.after += dd.after;
            acc.dropped += dd.dropped;
          } else {
            engineCounters.dedup = { before: dd.before, after: dd.after, dropped: dd.dropped };
          }
        }
        const counts = engine.lastCounts;
        if (counts) {
          const d2 = engineCounters.filterDrops;
          if (d2) {
            d2.parsed += counts.parsed;
            d2.kept += counts.kept;
            d2.invalidLine += counts.dropped.invalidLine;
            d2.beyondDiffLength += counts.dropped.beyondDiffLength;
            d2.lanes += 1;
          } else {
            engineCounters.filterDrops = {
              parsed: counts.parsed,
              kept: counts.kept,
              invalidLine: counts.dropped.invalidLine,
              beyondDiffLength: counts.dropped.beyondDiffLength,
              lanes: 1,
            };
          }
        }
        // **And the lanes are counted, because a lane that failed produced a zero and said nothing.**
        //
        // **What the run after the split showed**: **199 files reviewed and one finding emitted.** **The input was
        // fixed** - one file's story became 199 files - **and the emission did not move.** **So the count in this
        // artifact said the engine was reading everything and producing nothing, without saying which step dropped
        // it** - and **`lanes.filter((l) => l.success)` is exactly the kind of line that turns a failure into an
        // absence.**
        const laneStats = engineCounters.laneStats ?? {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          findings: 0,
          firstError: null,
        };
        laneStats.attempted += produced.length;
        for (const lane of produced) {
          if (lane.success) {
            laneStats.succeeded += 1;
            laneStats.findings += (lane.findings ?? []).length;
          } else {
            laneStats.failed += 1;
            if (!laneStats.firstError) {
              laneStats.firstError = String(
                lane.error ?? lane.reason ?? '(no error recorded on the lane)',
              ).slice(0, 240);
            }
          }
        }
        engineCounters.laneStats = laneStats;
      } catch (error) {
        // **A file the engine could not read contributes no findings and is counted**, which is **the distinction
        // this repository draws wherever a per-item loop exists.**
        engineCounters.fileFailures += 1;
        if (!engineCounters.firstFileFailure)
          engineCounters.firstFileFailure = String(error.message ?? '').slice(0, 200);
      }
    }

    // **ARM TWO: the whole pull request, in one call per lane, with one budget for the pull request.**
    //
    // **Why an arm rather than a replacement.** **The structural finding was that 995 lanes each see one file**, and
    // **the ground truth carries Repo Level issues that a single file cannot contain** - so **the hypothesis is that
    // the view is the constraint.** **The competitor reviews the whole diff in one call**, and **reproducing that with
    // this repository's own prompt is the control**: **if F1 rises, the view was the constraint; if it does not, the
    // capability is**, and **either answer is one this project has never had.**
    //
    // **And it runs in the same job as the per-file arm**, over the same pull requests, judged by the same judge
    // against the same goldens - so **the two numbers differ by the arm and by nothing else.**
    //
    // **What changed since the last run, said plainly.** The previous version of this arm called `reviewDiff` with the
    // whole diff as one file's content, so **every finding came back about a file named `pull-request.diff` and no
    // finding could be grounded against any real path** - the arm measured a view and forgot to measure a location.
    // `reviewPullRequest` requires a path per finding and judges each range against **its own file's** hunks, so the
    // arm now differs from the file arm in the thing it was meant to test and in nothing else.
    const prSections = sections.map((section) => ({
      path: section.path,
      diffText: section.lines.join(String.fromCharCode(10)),
    }));
    let wholePrFindings = [];
    try {
      const prLanes = await engine.reviewPullRequest(prSections, {
        maxFindingsPerPullRequest: PR_BUDGET,
      });
      wholePrFindings = prLanes.filter((l) => l.success).flatMap((l) => l.findings);
    } catch (error) {
      engineCounters.wholePrFailure = String(error.message ?? '').slice(0, 200);
    }
    wholePrLanesTotal += prSections.length;
    wholePrFindingsTotal += wholePrFindings.length;
    // **What the arm's own filter did with this pull request**, because **an arm that emits nothing and an arm whose
    // path check ate the answer produce the same zero.**
    if (engine.lastCounts) {
      const acc = engineCounters.pullRequestArm;
      const own = engine.lastCounts.dropped;
      if (acc) {
        acc.parsed += engine.lastCounts.parsed;
        acc.kept += engine.lastCounts.kept;
        acc.missingPath += own.missingPath;
        acc.unknownPath += own.unknownPath;
        acc.beyondDiffLength += own.beyondDiffLength;
        acc.invalidLine += own.invalidLine;
        acc.capped += own.capped;
      } else {
        engineCounters.pullRequestArm = {
          parsed: engine.lastCounts.parsed,
          kept: engine.lastCounts.kept,
          missingPath: own.missingPath,
          unknownPath: own.unknownPath,
          beyondDiffLength: own.beyondDiffLength,
          invalidLine: own.invalidLine,
          capped: own.capped,
        };
      }
      // **And the findings the rules removed, by path and by rule**, because the first run of this arm dropped 31 of
      // 120 as `unknownPath` and **the artifact could not say which paths they named**.
      const samples = engine.lastCounts.dropped.samples ?? [];
      for (const sample of samples) {
        if (!engineCounters.pullRequestArm.droppedSamples) {
          engineCounters.pullRequestArm.droppedSamples = [];
        }
        if (engineCounters.pullRequestArm.droppedSamples.length < 20) {
          engineCounters.pullRequestArm.droppedSamples.push(sample);
        }
      }
    }

    reviewed += 1;
    // **Their two context dimensions are recorded per PR**, because **a `Repo Level` issue needs the repository and a
    // `Diff Level` one does not** - and **that is the axis this corpus was chosen for.**
    for (const c of comments) {
      const ctx = String(c.context ?? 'unknown');
      contextLevels[ctx] = (contextLevels[ctx] ?? 0) + 1;
      const cat = String(c.category ?? 'unknown');
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    // **The per-file findings, each with the path its line numbers belong to.**
    //
    // **`l.findings` alone loses the one thing the ranking needs.** A lane reviews one file and its findings carry line
    // numbers in that file; **the path lived on the result rather than on the finding**, so a flattened list of findings
    // could not be grounded against any diff - which is the same shape of loss as the golden path that was handed to
    // the engine three runs ago.
    const located = lanes
      .filter((l) => l.success)
      .flatMap((l) => (l.findings ?? []).map((finding) => ({ finding, path: l.filePath })));

    // **ARM THREE: the same findings, ordered by the probability a developer would act on them.**
    //
    // **Why an order and not a filter.** *Sifting the Noise* (arXiv 2601.22952) measured aggressive filtering
    // suppressing 22% of true vulnerabilities, so **nothing here is dropped before it is judged** - every finding is
    // scored, every pair is judged, and **the emission rule is scored as a subset of a matrix that already contains
    // everything**, which means the figures for the rule and the figures for the raw list come from one pass.
    const ranked = rankFindings(located, prFacts);
    const ourMatrix = await judgeMatrix(
      ranked.map((entry) => `${entry.finding.title} :: ${entry.finding.description}`),
      issueTexts,
    );
    unanswered += ourMatrix.unanswered;
    // **And why each golden that was not hit was not hit**, in the same pass and at no additional cost: the verdicts are
    // already paid for, the diff sections are already in hand, and **the only thing this needs is the coordinates the
    // corpus already carries.** The five buckets are disjoint and their sum is asserted inside `attributeGoldens`, so a
    // refactor that loses a row fails here rather than producing a table that reads plausibly and adds up wrong.
    const attribution = attributeGoldens({
      goldens,
      reviewedPaths: sections.map((section) => section.path),
      findings: ranked,
      matches: ourMatrix.matches,
    });
    attributed.push({ pr: competitorKey, ...attribution });
    ranked.forEach((entry, at) => {
      rankedDetail.push({
        pr: pr.githubPrUrl ?? null,
        path: entry.path,
        startLine: entry.finding.startLine,
        endLine: entry.finding.endLine,
        severity: entry.finding.severity,
        category: entry.finding.category,
        lane: entry.finding.lane ?? null,
        score: entry.score.score,
        actionable: entry.score.actionable,
        features: entry.score.features,
        why: entry.score.why,
        which: 'agentix-e',
        // **The sentence itself, because a rejection is a claim about wording and this artifact could not show one.**
        //
        // `findingOnPathRejected` was 98 of 170 goldens on 2026-11-10 and **73 of those 98 sit within ten lines of a
        // finding we emitted** - so the loss is not that the lane looked elsewhere, it is that what the lane said was
        // not accepted as the same defect. **An artifact that records the coordinates and not the sentence can report
        // that fact and cannot let anyone check it**, which is the same omission as the discarded `path` one iteration
        // earlier, one level up. The text is charged to nothing: it was already in memory and already paid for.
        text: `${entry.finding.title} :: ${entry.finding.description}`.slice(0, 320),
        matchedGoldens: ourMatrix.matches[at],
      });
    });
    perPr.push({
      key: pr.githubPrUrl ?? `pr-${perPr.length}`,
      matches: ourMatrix.matches,
      goldens: issueTexts.length,
      // **Which goldens this run covered, so two runs can be paired.** The key is the pull request plus the index
      // within that pull request's goldens, which is stable while the corpus and its order are - and **a paired test
      // between two runs is only honest if the pairing key is the same one the within-run test uses.**
      // **The emission rule, fixed before the run and applied per finding** - so the operating point is a statement
      // about a comment rather than a budget chosen from the curve below it.
      keep: ranked.map((entry) => entry.score.actionable),
    });

    // **And the same judging, for the whole-pull-request arm.**
    //
    // **A separate matrix over the same goldens**, because **the whole-PR arm's findings are a different set and must be
    // scored independently** - **sharing one matrix would let the two arms consume each other's goldens and report a sum
    // as if it were a maximum.**
    const wholeMatrix = await judgeMatrix(
      wholePrFindings.map((f) => `${String(f.title ?? '')} :: ${String(f.description ?? '')}`),
      issueTexts,
    );
    unansweredWhole += wholeMatrix.unanswered;
    const wholeCovered = maximumMatchingCount(wholeMatrix.matches, issueTexts.length);
    tpWhole += wholeCovered;
    fpWhole += wholePrFindings.length - wholeCovered;
    fnWhole += issueTexts.length - wholeCovered;

    // **And the pull-request arm's own order**, so its curve and the paired test are arithmetic over verdicts that
    // were already judged rather than a second run with a second set of samples.
    const prRanked = rankFindings(
      wholePrFindings.map((finding) => ({ finding, path: String(finding.path ?? '') })),
      prFacts,
    );
    const detailOf = new Map(wholePrFindings.map((finding, at) => [finding, at]));
    prRanked.forEach((entry) => {
      const at = detailOf.get(entry.finding);
      prArmDetail.push({
        pr: pr.githubPrUrl ?? null,
        path: entry.path,
        startLine: entry.finding.startLine,
        endLine: entry.finding.endLine,
        severity: entry.finding.severity,
        category: entry.finding.category,
        lane: entry.finding.lane ?? null,
        score: entry.score.score,
        features: entry.score.features,
        which: 'agentix-e-pull-request',
        matchedGoldens: at === undefined ? [] : wholeMatrix.matches[at],
      });
    });
    prArmPerPr.push({
      key: pr.githubPrUrl ?? `pr-${prArmPerPr.length}`,
      // **Re-ordered the same way as the detail**, because a curve cut from a different order than the one reported is
      // a budget two readers cannot reproduce.
      matches: prRanked.map((entry) => {
        const at = detailOf.get(entry.finding);
        return at === undefined ? [] : wholeMatrix.matches[at];
      }),
      goldens: issueTexts.length,
    });
  }

  // **The record is written once, after the loop**, so a run that dies at the eleventh pull request leaves the previous
  // file intact and the eleven rows it paid for are the only thing lost. **And the write says whether the record covers
  // the corpus** - a file with a hole in it replays as a corpus with a hole in it, and the next reader should meet that
  // fact here rather than in a figure that is quietly computed over thirteen of fourteen pull requests.
  if (competitorChoice.mode === 'record' && recordedAny > 0) {
    competitorBaseline = { ...competitorBaseline, recordedAt: new Date().toISOString() };
    writeBaseline(COMPETITOR_BASELINE_PATH, competitorBaseline);
    competitor.baselineRecordedAt = competitorBaseline.recordedAt;
    competitor.baselineCovers = {
      pullRequests: Object.keys(competitorBaseline.pulls).length,
      ofCorpus: rows.length,
      complete: Object.keys(competitorBaseline.pulls).length >= rows.length,
    };
    console.log(
      `AACR-BENCH competitor baseline written to ${COMPETITOR_BASELINE_PATH} ` +
        `(${String(Object.keys(competitorBaseline.pulls).length)}/${String(rows.length)} pull requests)`,
    );
  }

  // ---------------------------------------------------------------------------
  // From the judged matrices to the figures
  // ---------------------------------------------------------------------------
  //
  // **Every number below is arithmetic over verdicts that were already paid for.** The judging pass produced, per pull
  // request, which goldens each finding matched; a maximum matching turns that into what that set of findings covers,
  // and the same matrix answers the curve, the emission rule and the paired test. **Nothing below calls the judge.**
  const round = (x) => Math.round(x * 10000) / 10000;
  const zero = { tp: 0, fp: 0, fn: 0 };
  const addCounts = (a, b) => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });

  /** Every finding the reviewer emitted, which is the operating point the earlier runs measured. */
  const everythingEmitted = (pull) => ({
    indices: matchedGoldenIndices(pull.matches, pull.goldens),
    emitted: pull.matches.length,
  });

  /** The pre-registered rule: only the findings whose range covers an added line and that say what to change. */
  const gatedEmission = (pull) => {
    const kept = pull.matches.filter((_, at) => pull.keep[at]);
    return { indices: matchedGoldenIndices(kept, pull.goldens), emitted: kept.length };
  };

  const countsOver = (perPull, rule) =>
    perPull.reduce((total, pull) => {
      const covered = rule(pull);
      return addCounts(total, {
        tp: covered.indices.length,
        fp: covered.emitted - covered.indices.length,
        fn: pull.goldens - covered.indices.length,
      });
    }, zero);

  const asPoint = (counts) => point(counts.tp + counts.fp, counts.tp, counts.fp, counts.fn);

  // **Our operating point, the one that was fixed before the run.**
  const gatedCounts = perPr.reduce((total, pull) => {
    const scored = scoreSubset(pull.matches, pull.keep, pull.goldens);
    return addCounts(total, {
      tp: scored.truePositives,
      fp: scored.falsePositives,
      fn: scored.falseNegatives,
    });
  }, zero);
  const gated = asPoint(gatedCounts);
  const allCounts = countsOver(perPr, everythingEmitted);
  const allEmitted = asPoint(allCounts);

  /**
   * **The measurement's own error, as an interval rather than as a footnote.**
   *
   * A pair the judge did not answer is neither a match nor a miss, and this job counts it as a miss - which is the only
   * thing it *can* do to produce a single number, and **which is wrong in a direction nobody can see from the figure
   * alone.** The run of 2026-11-09 left **183 pairs unanswered out of roughly 3 800**, and the competitor's arm left
   * none; **so the two arms of that run did not carry the same error, and the comparison was published as if they did.**
   *
   * **The bound is deliberately loose and is labelled as a bound.** Treating every unanswered pair as a match would give
   * one finding credit for several goldens, so the upper end overstates what a perfect judge could do; **the point is not
   * to estimate the true figure but to state how far it could be from the reported one.** When the interval is narrow the
   * reported figure is a measurement; when it is wide, the run needs a judge that answers.
   */
  const judgedInterval = (counts, unansweredPairs) => {
    const goldens = counts.tp + counts.fn;
    const highest = Math.min(counts.tp + Number(unansweredPairs ?? 0), goldens);
    // `k` is what the reviewer emitted, and it does not move: the judge decides which of those are true, not how many
    // there were.
    const upper = point(
      counts.tp + counts.fp,
      highest,
      counts.tp + counts.fp - highest,
      goldens - highest,
    );
    return {
      unansweredPairs: Number(unansweredPairs ?? 0),
      f1IfEveryUnansweredPairIsAMiss: asPoint(counts).f1,
      f1IfEveryUnansweredPairIsAMatch: upper.f1,
    };
  };

  /**
   * **The curve, at budgets a reviewer could actually hold to.**
   *
   * **Per pull request rather than over the concatenation**, because **a budget is a number of comments on one pull
   * request** - sorting all 105 findings into one list and cutting at forty would mean the corpus-wide cut, which is not
   * a rule any reviewer follows. `k` here is therefore "the top k of each pull request", and `0` is everything.
   */
  const BUDGETS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 0];
  const byBudget = BUDGETS.map((budget) => {
    let total = zero;
    for (const pull of perPr) {
      const curve = topKCurve(pull.matches, pull.goldens);
      const at = budget === 0 ? curve.length : Math.min(budget, curve.length);
      const chosen = curve[at - 1];
      if (chosen) {
        total = addCounts(total, {
          tp: chosen.truePositives,
          fp: chosen.falsePositives,
          fn: chosen.falseNegatives,
        });
      }
    }
    return { budgetPerPullRequest: budget === 0 ? null : budget, ...asPoint(total) };
  });

  /**
   * **The paired test, because the two reviewers were scored on the same goldens.**
   *
   * **A difference between two proportions is not a difference between two proportions drawn on paired data.** The
   * goldens both reviewers found, and the goldens neither found, say nothing about which is better; only the goldens one
   * found and the other did not carry that information, and **the exact binomial tail over those discordant pairs is
   * what McNemar's test is.** With fifty goldens the exact form is the right one - the asymptotic chi-square is an
   * approximation that the corpus is too small to earn.
   */
  const coveredKeys = (perPull, rule) => {
    const keys = new Set();
    for (const pull of perPull) {
      for (const golden of rule(pull).indices) keys.add(`${pull.key}#${golden}`);
    }
    return keys;
  };
  const ourKeys = coveredKeys(perPr, gatedEmission);
  const theirKeys = coveredKeys(competitorPerPr, everythingEmitted);
  let oursOnly = 0;
  let theirsOnly = 0;
  for (const key of ourKeys) if (!theirKeys.has(key)) oursOnly += 1;
  for (const key of theirKeys) if (!ourKeys.has(key)) theirsOnly += 1;

  const competitorCounts = countsOver(competitorPerPr, everythingEmitted);
  const competitorPoint = asPoint(competitorCounts);
  const competitorGated = asPoint(countsOver(competitorPerPr, gatedEmission));

  // **The judge's bill, priced with the reviewer's table and the clock of this run.** `costUsdOf` returns `null` for a
  // model the table does not know, and **`null` is carried rather than turned into a zero** for the reason the ledger
  // carries it: a zero is absorbed by every total it touches.
  const judgeCostUsd = costUsdOf(
    {
      promptTokens: judgeSpend.promptTokens,
      completionTokens: judgeSpend.completionTokens,
      totalTokens: judgeSpend.promptTokens + judgeSpend.completionTokens,
      cacheHitTokens: judgeSpend.cacheHitTokens,
      cacheMissTokens: judgeSpend.cacheMissTokens,
    },
    MODEL,
    new Date(),
  );

  /** The attribution table, computed once and read by both the artifact and the log. */
  const merged = mergeAttributions(attributed);
  const missedGoldens = {
    ...merged,
    largest: largestBucket(merged.counts),
    // **The largest bucket's shape, because "98 rejected" and "73 of them within ten lines of something we said" are
    // different sentences about different work.** The bucket names where the loss is; the shape names whether the fix
    // is the lane's search or the lane's sentence.
    dominantRejectionShape: dominantRejectionShape(merged.rejectionShape),
    pullRequests: attributed.length,
  };
  /** **The interval the reported F1 lives in**, because 183 unanswered pairs are an error bar and not a footnote. */
  const ourInterval = judgedInterval(gatedCounts, unanswered);

  write({
    ...base,
    // **The threshold every row below was drawn under**, because **a curve whose points are not labelled is a set of
    // numbers rather than a measurement** - and **this label was missing from the artifact for one run**, which is
    // **how a point loses its coordinate.**
    dedupThreshold: DEDUP_THRESHOLD,
    // **What the top-level figures mean, said in the file rather than in a report about the file.** They are the
    // emission rule's, not the whole list's - and **the whole list's are kept beside them**, because **a rule that is
    // reported without the list it was applied to cannot be checked.**
    scoring: {
      protocol:
        'one judge verdict per (finding, golden) pair, then a maximum bipartite matching per pull request; the same protocol for both reviewers in the same job',
      emissionRule:
        'actionability gate: the range covers an added line AND (the suggestion names an action OR the finding quotes added code)',
      emissionRuleRegisteredBeforeRun: true,
      judgeConcurrency: JUDGE_CONCURRENCY,
      /**
       * **Two arms of this engine, one judge, one set of goldens, one job.**
       *
       * The question this run was registered to answer is **where the budget should sit**, and a single figure cannot
       * answer it: the file arm and the pull-request arm are the same five lanes, the same prompts and the same model,
       * differing in the unit of review and the budget's denominator. **The paired test between them is in
       * `armsPairedTest`**, because the two arms read the same pull requests against the same goldens.
       */
      arms: {
        file: 'one call per file per lane, at most 3 findings per file per lane',
        pullRequest: `one call per lane for the whole pull request, at most ${PR_BUDGET} findings for the pull request`,
      },
      registeredRule:
        'the pull-request arm at 16 findings per pull request exceeds the competitor figure of 0.4500 F1 on the same corpus, same judge, same goldens; the file arm stays in the same job as the control',
      pairsJudged:
        perPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0) +
        competitorPerPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0) +
        prArmPerPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0),
      weights: ACTIONABILITY_WEIGHTS,
      changedFrom:
        'the previous protocol consumed each golden with the first finding that matched it, in judging order',
    },
    /**
     * **What this run was configured to be, because a figure without its configuration is a figure two runs can
     * disagree about.**
     *
     * The registered comparison of §8 turns exactly one switch, and **this field is how the artifact proves which side
     * of it the number came from** - a report that says "with the checklist" and an artifact that does not say which
     * run was which is a report about an unspecified experiment.
     */
    configuration: {
      languageChecklist: CHECKLIST,
      maxPullRequests: MAX_PRS,
      judgeModel: MODEL,
      judgeEndpoint: BASE,
      dedupThreshold: DEDUP_THRESHOLD,
      pullRequestBudget: PR_BUDGET,
      // **Which arrangement of the prompt produced this figure**, because §9 and §10 of `EVAL-CONTRACT.md` are two
      // claims about one file and an artifact that does not say which side it came from is a figure without a
      // coordinate.
      promptOrder: PROMPT_ORDER,
    },
    // **How many pull requests the dataset held, not how many this run read.** `prsInDataset` is the run's choice and
    // **a choice cannot be told apart from a limit unless both are recorded.**
    datasetRows: allRows.length,
    prsInDataset: rows.length,
    prsReviewed: reviewed,
    /**
     * **Which goldens the registered operating point covered, keyed the way the paired test keys them.**
     *
     * This is what makes a comparison **between two runs** possible at all: run A and run B review the same corpus with
     * the same judge and differ in one configuration flag, and the only thing that carries information about which
     * configuration is better is **the goldens one covered and the other did not**. Without this field the comparison
     * would be two F1 values and a story about them, which is the mistake §6 of `EVAL-CONTRACT.md` was written to
     * stop.
     */
    coverage: {
      protocol: 'per pull request, the golden indices the registered rule covered',
      byPullRequest: perPr.map((pull) => ({
        pr: pull.key,
        goldens: pull.goldens,
        covered: matchedGoldenIndices(
          pull.matches.filter((_, at) => pull.keep[at]),
          pull.goldens,
        ),
        emitted: pull.matches.length,
      })),
      coveredTotal: gated.truePositives,
    },
    prsWithoutDiff: unfetched,
    positiveSamples: positives.length ?? rows.length,
    negativeSamples: Array.isArray(negatives) ? negatives.length : null,
    truePositives: gated.truePositives,
    falsePositives: gated.falsePositives,
    falseNegatives: gated.falseNegatives,
    judgeUnanswered: unanswered,
    // **And how far the figure above could be from the truth, because 183 pairs went unanswered in the run this
    // section was written for and the competitor's arm carried none.**
    judgedInterval: ourInterval,
    // **Why each missed golden was missed, as five disjoint buckets.**
    //
    // **`recall 0.2059` is a number and not a diagnosis**, and the run of 2026-11-09 could not say whether its 155
    // missed goldens were in files it never read, in files it read in silence, or in files where it spoke about the
    // wrong thing - **three defects whose fixes are a filter, a lane, and a target.** The sum of the buckets is asserted
    // to equal the golden count inside `attributeGoldens`, so this table cannot quietly lose a row.
    missedGoldens,
    precision: gated.precision,
    recall: gated.recall,
    f1: gated.f1,
    // **The list before the rule, because the rule is only interesting beside it.**
    fullEmission: allEmitted,
    // **The curve, at every budget the rule could have been.**
    byBudgetPerPullRequest: byBudget,
    // **The paired test against the competitor at its own operating point.**
    mcnemar: {
      oursOnly,
      theirsOnly,
      pValue: round(exactMcNemar(oursOnly, theirsOnly)),
      verdict:
        exactMcNemar(oursOnly, theirsOnly) <= 0.05
          ? 'significant at 0.05'
          : 'not significant at 0.05',
    },
    // **The control arm, reported beside the first rather than instead of it.**
    /**
     * **The second arm: one call per lane over the whole pull request, with one budget for the pull request.**
     *
     * **Two arms of one engine, one judge, one set of goldens, one job** - so the two figures differ by the scope and
     * by nothing else. The artifact carries both because **the question this run answers is not "how good is the
     * reviewer" but "where should the budget sit"**, and a single figure cannot answer it.
     */
    pullRequestArm: {
      view: 'one call per lane over the whole pull request, one budget for the pull request',
      budgetPerPullRequest: PR_BUDGET,
      filesPerArm: wholePrLanesTotal,
      findings: wholePrFindingsTotal,
      truePositives: tpWhole,
      falsePositives: fpWhole,
      falseNegatives: fnWhole,
      judgeUnanswered: unansweredWhole,
      precision: round(tpWhole + fpWhole > 0 ? tpWhole / (tpWhole + fpWhole) : 0),
      recall: round(tpWhole + fnWhole > 0 ? tpWhole / (tpWhole + fnWhole) : 0),
      f1: round(
        tpWhole + fpWhole + fnWhole > 0 ? (2 * tpWhole) / (2 * tpWhole + fpWhole + fnWhole) : 0,
      ),
      // **What its own budget did, per pull request**, so a curve over this arm is a cut of the order it reported.
      byBudgetPerPullRequest: BUDGETS.map((budget) => {
        let total = zero;
        for (const pull of prArmPerPr) {
          const curve = topKCurve(pull.matches, pull.goldens);
          const at = budget === 0 ? curve.length : Math.min(budget, curve.length);
          const chosen = curve[at - 1];
          if (chosen) {
            total = {
              tp: total.tp + chosen.truePositives,
              fp: total.fp + chosen.falsePositives,
              fn: total.fn + chosen.falseNegatives,
            };
          }
        }
        const scored = asPoint(total);
        return { budgetPerPullRequest: budget, ...scored };
      }),
      // **And the arm's per-pull-request verdicts**, which is what a paired test against the file arm needs.
      perPullRequest: prArmPerPr.map((pull) => ({
        pr: pull.key,
        findings: pull.matches.length,
        goldens: pull.goldens,
        covered: maximumMatchingCount(pull.matches, pull.goldens),
      })),
      rankedFindings: prArmDetail,
    },
    /**
     * **The paired test between the two arms**, because **they read the same pull requests against the same goldens**
     * and that is exactly the design McNemar's test is for: only the goldens one arm found and the other did not carry
     * information about which arm is better.
     */
    armsPairedTest: (() => {
      const ours = new Set();
      for (const pull of prArmPerPr) {
        for (const at of matchedGoldenIndices(pull.matches, pull.goldens))
          ours.add(`${pull.key}#${at}`);
      }
      const theirs = new Set();
      for (const pull of perPr) {
        for (const at of matchedGoldenIndices(pull.matches, pull.goldens))
          theirs.add(`${pull.key}#${at}`);
      }
      let both = 0;
      let pullRequestOnly = 0;
      let fileOnly = 0;
      for (const key of ours) {
        if (theirs.has(key)) both += 1;
        else pullRequestOnly += 1;
      }
      for (const key of theirs) if (!ours.has(key)) fileOnly += 1;
      return {
        view: 'pull-request arm vs file arm, same pull requests, same goldens, same judge',
        both,
        pullRequestOnly,
        fileOnly,
        pValue: round(exactMcNemar(pullRequestOnly, fileOnly)),
        verdict:
          exactMcNemar(pullRequestOnly, fileOnly) <= 0.05
            ? 'significant at 0.05'
            : 'not significant at 0.05',
      };
    })(),
    reviewCategories: categories,
    // **The context split, which is the reason this corpus was chosen**: `Repo Level` is cross-file by construction.
    groundTruthContextLevels: contextLevels,
    // **The competitor's F1, computed with the same formula over the same goldens** - so **the two numbers are
    // comparable because they were produced by one measurement, not because they were printed side by side.**
    secondReviewer: {
      ...competitor,
      ...competitorPoint,
      /**
       * **Whether the two figures are the same measurement this time.**
       *
       * With the arm replayed, the comparison holds; with rows missing - no baseline, a corpus that moved, a judge that
       * changed - the competitor's side is computed over fewer pull requests than ours, and **a precision stated over a
       * different denominator reads exactly like a worse reviewer**. So the run says which of the two it is, in the same
       * object that carries the figure, rather than leaving the reader to infer it from a count they would have to know
       * to check first.
       */
      comparable:
        competitor.missing.length === 0 &&
        competitorPerPr.length > 0 &&
        competitorPerPr.length === rows.length - unfetched,
      notComparableReason:
        competitor.missing.length === 0
          ? competitorPerPr.length === 0
            ? 'the competitor arm produced no row at all, so there is nothing to compare against'
            : null
          : `${String(competitor.missing.length)} of ${String(rows.length - unfetched)} pull requests have no ` +
            'competitor row; the first reason is in `missing[0].reason`',
      // **And the same ranker applied to its output**, which separates the two explanations: **if its F1 rises as far
      // as ours did, the gain is the ranker's; if it does not, the sentences were the difference.**
      withTheSameRanker: competitorGated,
      // **Its own interval, on its own unanswered pairs**, so the two arms are read with their own error beside them.
      judgedInterval: judgedInterval(competitorCounts, competitor.judgeUnanswered),
      findingsAtItsOwnOperatingPoint: competitorDetail,
    },
    // **Every finding either reviewer emitted, with its features and the goldens the judge matched it to.**
    //
    // **Why this belongs in the artifact rather than in a log.** The next iteration's first question is *which*
    // findings were wrong and what made them different from the right ones, and **a figure without the rows it was
    // computed from cannot answer it** - so the rows travel, and the curve above can be recomputed from them without
    // another run.
    rankedFindings: rankedDetail,
    // **And the reading after the loop**, so **what the run spent is derivable** and **a draw taken on an empty
    // account is labelled rather than reported as a reviewer's result.**
    credit: { before: creditBefore, after: await creditPosition() },
    // **And what the reviewer itself spent, decomposed by lane**, which is the figure the credit pair cannot produce:
    // a balance delta attributes nothing, and **a bill whose largest line nobody can name is a bill nobody can reduce.**
    // `unpricedCalls` travels with the total because a total containing one is a lower bound.
    spend: {
      ceilingUsd: MAX_USD,
      ...ledger.toJSON().totals,
      byTag: ledger.toJSON().byTag,
      // **The line the ledger could not see.** The judge is a bare `fetch` in this file, so its tokens are counted here
      // and priced with the same table the reviewer is priced with - **one table, two clients**, because two tables is
      // how the reviewer's share of a job became an inference instead of a figure.
      judge: {
        ...judgeSpend,
        costUsd: judgeCostUsd,
        cacheHitRatio:
          judgeSpend.promptTokens === 0
            ? null
            : judgeSpend.cacheHitTokens / judgeSpend.promptTokens,
      },
      // **What the job cost as far as this file can see**, so that the balance delta taken below can be compared with
      // it: **a total that is smaller than the balance by a wide margin says there is a third client.**
      totalUsd: judgeCostUsd === null ? null : ledger.toJSON().totals.costUsd + judgeCostUsd,
    },
    // **The engine's own account of what it did**, because **a figure that says "one finding" without saying "199
    // files and 199 lanes" is a figure whose cause is not in the file.**
    engineCounters,
    skipped: null,
  });
  console.log(
    `AACR-BENCH reviewed ${reviewed} PRs · gate tp ${gated.truePositives} fp ${gated.falsePositives} fn ${gated.falseNegatives} · P ${gated.precision} R ${gated.recall} F1 ${gated.f1}`,
  );
  // **The bill, printed beside the figure it bought.** `calls` is the number the reviewer made, `cache` is the share of
  // prompt tokens the provider served from its prefix cache - **the number a prompt reordering has to move, and the one
  // nothing in this repository could report before the ledger existed.**
  console.log(
    `AACR-BENCH spend · calls ${ledger.totals().calls} · failures ${ledger.totals().failures} · unpriced ${ledger.totals().unpricedCalls} · prompt ${ledger.totals().promptTokens} · cache ${ledger.totals().cacheHitTokens} · usd ${ledger.totals().costUsd.toFixed(4)} · ceiling ${MAX_USD}`,
  );
  console.log(
    `AACR-BENCH judge · calls ${judgeSpend.calls} · unanswered ${judgeSpend.failures} (${judgeSpend.rateLimited} rate limited) · prompt ${judgeSpend.promptTokens} · cache ${judgeSpend.cacheHitTokens} · usd ${judgeCostUsd === null ? 'unpriced' : judgeCostUsd.toFixed(4)} · order ${PROMPT_ORDER}`,
  );
  // **Why the goldens were missed, on one line, because it is the line that decides what the next iteration works on.**
  console.log(
    `AACR-BENCH missed · ${GOLDEN_BUCKETS.map((bucket) => `${bucket} ${missedGoldens.counts[bucket]}`).join(' · ')} · f1 in [${ourInterval.f1IfEveryUnansweredPairIsAMiss}, ${ourInterval.f1IfEveryUnansweredPairIsAMatch}]`,
  );
  // **And the largest bucket's shape, which is the line that says whether the next iteration fixes a search or a
  // sentence.** A bucket reported without its shape is a bucket whose two causes are still one number.
  console.log(
    `AACR-BENCH rejected · ${REJECTION_SHAPES.map((shape) => `${shape} ${missedGoldens.rejectionShape[shape]}`).join(' · ')} · dominant ${missedGoldens.dominantRejectionShape === null ? 'none' : `${missedGoldens.dominantRejectionShape.shape} ${missedGoldens.dominantRejectionShape.count}`}`,
  );
  console.log(
    `AACR-BENCH full list tp ${allEmitted.truePositives} fp ${allEmitted.falsePositives} · P ${allEmitted.precision} R ${allEmitted.recall} F1 ${allEmitted.f1}`,
  );
  console.log(
    `AACR-BENCH competitor ${competitor.tool} · ${competitor.mode} · replayed ${String(competitor.replayed)} · recorded ${String(competitor.recorded)} · missing ${String(competitor.missing.length)} · findings ${competitor.findings} · P ${competitorPoint.precision} R ${competitorPoint.recall} F1 ${competitorPoint.f1} · same ranker F1 ${competitorGated.f1}`,
  );
  console.log(`AACR-BENCH McNemar ours-only ${oursOnly} theirs-only ${theirsOnly}`);
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), 'benchmarks', 'aacr-bench.json'),
    JSON.stringify(payload, null, 2) + '\n',
  );
}

main().catch((error) => {
  console.error('AACR-BENCH failed:', error && error.message);
  process.exit(1);
});
