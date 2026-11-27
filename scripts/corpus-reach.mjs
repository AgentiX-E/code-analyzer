#!/usr/bin/env node
/**
 * **How much of the answer key a diff-reading reviewer can address at all.**
 *
 * `§173.1` found a denominator three times too large and repaired it: the slice a run asked about, not the corpus the file
 * happens to hold. **This is the same question one level down, and it was never asked.** A golden names a path and a span,
 * and the reviewer is handed a diff. If that path is not in the diff, or its span is outside every hunk, then **no
 * diff-reading reviewer can say anything that lands there** - and the figure that divides by it charges every arm for a
 * golden nobody could reach.
 *
 * **The reading this exists to make possible.** `452` goldens on the fifty pull requests `§173.2` scored, of which the
 * partitioning below finds some on paths the diff does not contain and some outside every hunk. **Both arms lose the same
 * goldens**, so the ranking between them does not move - but the *bar* moves, because `0.3770` is a rate over a
 * denominator that includes lines the competitor's own tool could not have commented on either. A rate over a denominator
 * that is partly unreachable is a rate that understates both readers, and the one thing this repository may not do is
 * quote an understated figure as if it were the whole story.
 *
 * **Why the diff and not the corpus's own metadata.** The corpus states a path and a line for every golden and states
 * nothing about whether the pull request's diff still contains it. `git` is the only authority on what changed, and the
 * diffs fetched here are the same bytes the arm was shown - `accept: application/vnd.github.v3.diff`, the harness's own
 * request.
 *
 * Usage:
 *     node scripts/corpus-reach.mjs --corpus /tmp/aacr-bench/dataset/v1/positive_samples.json \
 *         --artifact benchmarks/aacr-bench.json \
 *         [--baseline benchmarks/aacr/competitor-baseline.json] \
 *         [--patches /tmp/corpus-reach-patches] [--json out.json] [--label 'dispatch 123 · aacr'] [--pinned]
 *
 * **A bucket table that does not add back up to the slice is a table about some other slice**, so the partition is checked
 * before anything is printed or written, and an unread pull request is a bucket rather than a silent exclusion - a
 * denominator that shrinks when a fetch fails is the defect `§173.1` was.
 *
 * **`--pinned` reads the diff at the commits the corpus names** (`scripts/lib/pinned-diff.mjs`) instead of at the pull
 * request's current state, and caches it under a second name so one directory holds both readings. **The two runs of this
 * script are the experiment**: the live reading says what a re-run today would face, the pinned one says what the answer
 * key was written on, and the difference between them is drift rather than capability.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { sideLinesByPath } from './lib/diff-side-lines.mjs';
import { commitsOf, fetchPinnedDiff } from './lib/pinned-diff.mjs';

const VERSION = 'corpus-reach-v1';

/** The three ways a golden can stand relative to a diff, plus the one where the diff could not be read. */
const BUCKETS = ['inHunk', 'outsideHunks', 'absentPath', 'unread'];

function parseArgs(argv) {
  const options = {
    corpus: null,
    artifact: null,
    baseline: null,
    patches: '/tmp/corpus-reach-patches',
    json: null,
    html: null,
    label: null,
    pinned: false,
    verbose: false,
  };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === '--corpus') options.corpus = argv[(at += 1)];
    else if (arg === '--artifact') options.artifact = argv[(at += 1)];
    else if (arg === '--baseline') options.baseline = argv[(at += 1)];
    else if (arg === '--patches') options.patches = argv[(at += 1)];
    else if (arg === '--json') options.json = argv[(at += 1)];
    else if (arg === '--html') options.html = argv[(at += 1)];
    else if (arg === '--label') options.label = argv[(at += 1)];
    else if (arg === '--pinned') options.pinned = true;
    else if (arg === '--verbose') options.verbose = true;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (options.corpus === null) throw new Error('--corpus is required');
  if (options.artifact === null) throw new Error('--artifact is required');
  return options;
}

/** `owner/repo#number` for a pull request URL, which is the name a cached patch is filed under. */
function patchName(url) {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
  return match === null ? null : `${match[1]}__${match[2]}__${match[3]}.diff`;
}

/**
 * **The diff, from the cache or from the API, either at the pull request's head or at the commits the corpus names.**
 *
 * The fetch is the harness's own (`accept: application/vnd.github.v3.diff`), so the text this instrument reads is the
 * text the run read. **A cached patch is never re-fetched and a failed fetch is never written**, because a cache that
 * stores an error turns one bad minute into a permanent figure. **The two readings cache under two names** - a pinned
 * patch and a live one are different text and a directory that held one under the other's name would report the second
 * run's answer as the first run's.
 */
async function diffOf(url, directory, pinned = false, row = null) {
  const base = patchName(url);
  if (base === null)
    return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
  const name = pinned ? base.replace(/\.diff$/, '.pinned.diff') : base;
  const cached = join(directory, name);
  if (existsSync(cached))
    return { ok: true, diff: readFileSync(cached, 'utf8'), cached: true, pinned };
  if (pinned) {
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
    const result = await fetchPinnedDiff({ url, commits: commitsOf(row), token });
    if (!result.ok) return { ok: false, reason: result.reason };
    writeFileSync(cached, result.diff);
    return { ok: true, diff: result.diff, cached: false, pinned: true };
  }
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (match === null) return { ok: false, reason: 'the URL names no pull request' };
  const [, owner, repo, number] = match;
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
        headers: {
          accept: 'application/vnd.github.v3.diff',
          'user-agent': 'agentix-e-corpus-reach',
          ...(token ? { authorization: `token ${token}` } : {}),
        },
      });
      if (res.ok) {
        const diff = await res.text();
        writeFileSync(cached, diff);
        return { ok: true, diff, cached: false };
      }
      if (res.status === 404) return { ok: false, reason: 'the diff request returned 404' };
      if (res.status !== 429 && res.status < 500) {
        return { ok: false, reason: `the diff request returned ${String(res.status)}` };
      }
    } catch (error) {
      if (attempt === 3)
        return { ok: false, reason: `the diff request threw: ${String(error?.message)}` };
    }
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  return { ok: false, reason: 'the diff request did not succeed in four attempts' };
}

/** The span a golden names, as two line numbers in order. **The corpus has at least one reversed pair** (`1153 → 1144`). */
function spanOf(comment) {
  const from = Number(comment.from_line ?? comment.to_line ?? 0);
  const to = Number(comment.to_line ?? comment.from_line ?? 0);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * **Where one golden stands, and whether a finding on it could cover an added line.**
 *
 * `inHunk` is the only bucket in which a diff-reading reviewer has a coordinate at all. **`addedInSpan` is the stricter
 * question the emission rule asks** - a comment must cover a line the change wrote - and it is reported beside the bucket
 * rather than as a fourth bucket, because the two are answers to different questions: *can anything be said here* and
 * *may our gate post it*.
 */
function place(golden, files) {
  const file = files.get(golden.path);
  if (file === undefined) return { bucket: 'absentPath', addedInSpan: false, hunkLines: 0 };
  const span = spanOf(golden);
  const inside = file.lines.filter((line) => line.line >= span.from && line.line <= span.to);
  if (inside.length === 0) return { bucket: 'outsideHunks', addedInSpan: false, hunkLines: 0 };
  return {
    bucket: 'inHunk',
    addedInSpan: inside.some((line) => line.added),
    hunkLines: inside.length,
  };
}

function emptyBucket(name) {
  return { bucket: name, goldens: 0, addedInSpan: 0, ours: 0, theirs: 0 };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.patches, { recursive: true });

  const corpusText = readFileSync(options.corpus, 'utf8');
  const corpus = JSON.parse(corpusText);
  const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
  const baseline =
    options.baseline === null ? null : JSON.parse(readFileSync(options.baseline, 'utf8'));

  /**
   * **The slice is the artifact's own list of pull requests.** With one, that list; without one, the corpus's order -
   * the same rule `idiom-reach` holds, and for the same reason: a slice inferred from the goldens would drop a pull
   * request whose row emitted nothing, which is an observation and not an absence.
   */
  const rows = Array.isArray(artifact?.coverage?.byPullRequest)
    ? artifact.coverage.byPullRequest
    : [];
  if (rows.length === 0) {
    throw new Error(`${options.artifact} carries no coverage.byPullRequest, so it names no slice`);
  }
  const byUrl = new Map(corpus.map((entry) => [entry.githubPrUrl, entry]));

  /** Credit by any finding, before any cut: the question here is reach, not the operating point. */
  const oursCredited = new Map();
  for (const finding of Array.isArray(artifact.rankedFindings) ? artifact.rankedFindings : []) {
    const url = String(finding?.pr ?? '');
    if (!oursCredited.has(url)) oursCredited.set(url, new Set());
    for (const index of finding?.matchedGoldens ?? []) oursCredited.get(url).add(Number(index));
  }
  const theirCredited = new Map();
  for (const [url, pull] of Object.entries(baseline?.pulls ?? {})) {
    const set = new Set();
    for (const goldens of pull?.matches ?? [])
      for (const index of goldens ?? []) set.add(Number(index));
    theirCredited.set(url, set);
  }

  const buckets = new Map(BUCKETS.map((name) => [name, emptyBucket(name)]));
  const perPull = [];
  const unreadPulls = [];
  let goldens = 0;
  let creditedOurs = 0;
  let creditedTheirs = 0;

  for (const row of rows) {
    const url = String(row?.pr ?? '');
    const entry = byUrl.get(url);
    if (entry === undefined) {
      // **A slice row the corpus does not hold is a refusal rather than a zero**: the two files disagree about what this
      // run read, and a table that quietly folds it into a bucket would be a partition of two different corpora.
      throw new Error(`${url} is in the slice and not in the corpus`);
    }
    const comments = Array.isArray(entry.comments) ? entry.comments : [];
    const fetched = await diffOf(url, options.patches, options.pinned, entry);
    const files = fetched.ok ? sideLinesByPath(fetched.diff) : new Map();
    const ours = oursCredited.get(url) ?? new Set();
    const theirs = theirCredited.get(url) ?? new Set();
    if (!fetched.ok) unreadPulls.push({ pr: url, reason: fetched.reason });

    const counts = Object.fromEntries(BUCKETS.map((name) => [name, 0]));
    for (const [index, comment] of comments.entries()) {
      const golden = { path: String(comment?.path ?? ''), ...comment };
      const placed = fetched.ok ? place(golden, files) : { bucket: 'unread', addedInSpan: false };
      const bucket = buckets.get(placed.bucket);
      bucket.goldens += 1;
      if (placed.addedInSpan) bucket.addedInSpan += 1;
      if (ours.has(index)) {
        bucket.ours += 1;
        creditedOurs += 1;
      }
      if (theirs.has(index)) {
        bucket.theirs += 1;
        creditedTheirs += 1;
      }
      counts[placed.bucket] += 1;
      goldens += 1;
    }
    perPull.push({
      pr: url,
      goldens: comments.length,
      ...counts,
      cached: fetched.cached === true,
      pinned: fetched.pinned === true,
    });
  }

  const summed = [...buckets.values()].reduce((count, bucket) => count + bucket.goldens, 0);
  const summedOurs = [...buckets.values()].reduce((count, bucket) => count + bucket.ours, 0);
  if (summed !== goldens || summedOurs !== creditedOurs) {
    throw new Error(
      `the buckets hold ${String(summed)} goldens against ${String(goldens)} in the slice, and ` +
        `${String(summedOurs)} credits against ${String(creditedOurs)} - this is not a partition`,
    );
  }

  const addressable = goldens - (buckets.get('absentPath')?.goldens ?? 0);
  const record = {
    version: VERSION,
    source: options.label ?? `${options.artifact} · ${new Date().toISOString().slice(0, 10)}`,
    /**
     * **Which text the reach was measured against, in the record rather than in the command that made it.** A live
     * reading and a pinned one differ by drift, and **two files that are the same instrument's output and not the same
     * reading must not be comparable by accident.**
     */
    reading: options.pinned ? 'pinned' : 'live',
    basis: 'credited by any finding, before any cut - reach is a property of the pool',
    /**
     * **The corpus, in the one state this repository has a vocabulary for.** `remote` says two things at once: the file
     * was fetched at run time and is not held here - `Alibaba-Aone/aacr-bench` is read from a checkout the workflow makes
     * - and the bytes that were read are identified by digest, so `corpus-provenance-gate` can refuse a record whose
     * corpus moved instead of shrugging at a `/tmp` path it cannot walk.
     */
    corpus: {
      path: options.corpus,
      snapshot: 'remote',
      source: 'Alibaba-Aone/aacr-bench · dataset/v1/positive_samples.json (Apache-2.0)',
      digest: `sha256-${createHash('sha256').update(corpusText).digest('hex').slice(0, 16)}`,
      pullRequests: rows.length,
      goldens,
    },
    buckets: [...buckets.values()],
    addressable: {
      goldens: addressable,
      share: addressable / goldens,
      note: 'goldens on a path the diff contains - the ones a diff-reading reviewer can address at all',
    },
    credited: { ours: creditedOurs, theirs: baseline === null ? null : creditedTheirs },
    rate: {
      oursOnSlice: creditedOurs / goldens,
      oursOnAddressable: creditedOurs / addressable,
      theirsOnSlice: baseline === null ? null : creditedTheirs / goldens,
      theirsOnAddressable: baseline === null ? null : creditedTheirs / addressable,
    },
    unread: { pullRequests: unreadPulls.length, reasons: unreadPulls },
    pulls: perPull,
  };

  if (options.json !== null) writeFileSync(options.json, `${JSON.stringify(record, null, 2)}\n`);
  if (options.html !== null) {
    const { renderCorpusReach } = await import('./corpus-reach-page.mjs');
    writeFileSync(options.html, renderCorpusReach(record));
  }

  const line = (bucket) =>
    `${bucket.bucket.padEnd(13)} ${String(bucket.goldens).padStart(5)} ` +
    `${String(bucket.addedInSpan).padStart(7)} ${String(bucket.ours).padStart(6)} ${String(bucket.theirs).padStart(6)}`;
  process.stdout.write(
    `corpus reach · ${String(rows.length)} pull requests · ${String(goldens)} goldens\n` +
      'bucket        goldens  +added   ours theirs\n' +
      `${BUCKETS.map((name) => line(buckets.get(name))).join('\n')}\n` +
      `addressable   ${String(addressable).padStart(5)} ` +
      `(${(record.addressable.share * 100).toFixed(1)} %) · ours ` +
      `${(record.rate.oursOnAddressable * 100).toFixed(2)} % · theirs ` +
      `${record.rate.theirsOnAddressable === null ? 'n/a' : `${(record.rate.theirsOnAddressable * 100).toFixed(2)} %`}\n` +
      (unreadPulls.length === 0
        ? ''
        : `and ${String(unreadPulls.length)} pull requests could not be read: ${unreadPulls.map((pull) => pull.reason).join('; ')}\n`),
  );
}

await main();
