#!/usr/bin/env node
// @code-analyzer/code-analyzer — price the grounding gate on a paid run's own removals
//
// **What it answers, in one line.** *If `decideGrounding` had run in front of the shipped policy, what would the corpus
// have scored, which goldens would it have lost, and what share of the removals were true?*
//
// **Where the answers come from.** The artifact carries every finding's path, range and sentence plus its row of the
// verdict matrix; the files, at the commit the pull request's head named when the run read it, come from the API. So the
// run is **two fetches per pull request and one raw read per file**, no model call, and reproducible from the pinning it
// records. `--check` re-runs the arithmetic against a committed output and exits non-zero on any difference, so a stale
// figure is a red command rather than a paragraph nobody re-reads.
//
// **Usage.**
//   node scripts/gate-replay.mjs benchmarks/aacr-bench.json --fetch --out benchmarks/gate-replay.json
//   node scripts/gate-replay.mjs benchmarks/aacr-bench.json --check benchmarks/gate-replay.json
//
// The cache lives beside the sources it fetched (`--sources`, default `<tmpdir>/gate-replay-sources`) and is keyed by
// pull request, so a second run is offline and a changed revision is a visible refetch rather than a silent stale read.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { formatRow, parseCut, TABLE_HEADER } from './lib/operating-point.mjs';
import { anchorsOf, replayGroundingGate, requiredSources } from './lib/gate-replay.mjs';
import { renderGateReplayPage } from './lib/gate-replay-page.mjs';
import { isTransientStatus, withRetry } from './lib/transient-fetch.mjs';

const TOKEN = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';

function usage(message) {
  console.error(message);
  console.error(
    'usage: node scripts/gate-replay.mjs <aacr-bench.json> [--fetch] [--sources <dir>] [--out <file>] [--check <file>] [--cut <steps>]',
  );
  process.exit(2);
}

/** `owner/repo#number` from a pull request URL, which is the only identity the corpus guarantees. */
export function pullRequestOfUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
  return m === null ? null : { owner: m[1], repo: m[2], number: Number(m[3]) };
}

/**
 * **The unified diff split by the path each section is about.**
 *
 * The gate asks one question of a diff - *does this text occur* - so the sections are cut and never interpreted: no hunk
 * arithmetic, no line numbering, and **the whole section text is kept**, because a quotation may come from a removed line
 * and a section that kept only its added lines would answer "no" to a true statement.
 *
 * Both sides of a rename are keyed, since a section names `a/<old>` and `b/<new>` and a finding may quote either.
 */
export function splitUnifiedDiff(text) {
  const sections = new Map();
  const body = String(text ?? '');
  if (body.length === 0) return sections;
  let current = null;
  let lines = [];
  const flush = () => {
    if (current === null) return;
    const joined = lines.join('\n');
    for (const path of current) {
      const existing = sections.get(path);
      sections.set(path, existing === undefined ? joined : `${existing}\n${joined}`);
    }
  };
  for (const line of body.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const m = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
      current = m === null ? [] : [...new Set([m[1], m[2]])];
      lines = [line];
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/**
 * **One attempt at a URL, with the body as text and the status classification the retry policy needs.**
 *
 * **The timeout is not decoration.** `fetch` waits forever on a socket the peer never answers, and the first run of this
 * tool stopped on pull request eight of fifty with no error, no progress and no exit - **a hang is the one failure a
 * retry policy written for statuses cannot see**, because there is no status. Fifteen seconds is longer than every file
 * this corpus serves and shorter than a person's patience for a fetch that is not coming.
 */
async function getText(url, accept) {
  return withRetry(
    async () => {
      try {
        const res = await fetch(url, {
          headers: {
            accept,
            'user-agent': 'agentix-e-gate-replay',
            ...(TOKEN ? { authorization: `token ${TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return { ok: true, text: await res.text() };
        const remaining = res.headers.get('x-ratelimit-remaining');
        return {
          ok: false,
          status: res.status,
          retryable: isTransientStatus(res.status),
          reason:
            `${url} returned ${String(res.status)}` +
            (remaining === null ? '' : ` with ${remaining} requests left in the hour`),
        };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          reason: `${url} threw: ${String(error?.message ?? error)}`,
        };
      }
    },
    { attempts: 4 },
  );
}

/** The cache file one pull request owns, so a refetch is per pull request and a rerun is offline. */
function cachePath(sourcesDir, key) {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 12);
  return join(sourcesDir, `${digest}.json`);
}

/**
 * **Whether a cached record is a reading or a failure of the reading.**
 *
 * A file recorded as `{ error }` was a request that failed, and **a cache that keeps it turns one bad minute into a
 * permanent hole**: the first run of this tool recorded four such files across two pull requests, and a replay that
 * trusted the cache would have reported those two as pull requests the gate could not read - a statement about the
 * network wearing the shape of a statement about the product. A `null` is the opposite case and is kept: it is a 404,
 * which is a fact about the head revision.
 */
function hasFailedRead(record) {
  if (record?.error !== undefined) return true;
  return Object.values(record?.files ?? {}).some(
    (text) => typeof text === 'object' && text !== null,
  );
}

/** The head commit, the diff, and every file the run's findings sit in, read once and cached. */
async function readPullRequest(key, paths, sourcesDir) {
  const file = cachePath(sourcesDir, key);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (cached?.['pr'] === key && !hasFailedRead(cached)) return cached;
  }

  const parsed = pullRequestOfUrl(key);
  if (parsed === null) return { pr: key, error: `"${key}" is not a pull request URL` };
  const { owner, repo, number } = parsed;
  const api = `https://api.github.com/repos/${owner}/${repo}/pulls/${String(number)}`;

  const meta = await getText(api, 'application/vnd.github+json');
  if (!meta.ok) return { pr: key, error: meta.reason };
  const sha = JSON.parse(meta.text)?.['head']?.['sha'];
  if (typeof sha !== 'string') return { pr: key, error: `${api} named no head commit` };

  const diff = await getText(api, 'application/vnd.github.v3.diff');
  if (!diff.ok) return { pr: key, sha, error: diff.reason };
  const diffByPath = Object.fromEntries(splitUnifiedDiff(diff.text));

  const files = {};
  // **Four at a time**, because the reads are independent and the corpus has 329 of them: sequentially the first attempt
  // spent six minutes in seven pull requests, and the delay was one socket rather than the work.
  const ordered = [...paths].sort();
  for (let at = 0; at < ordered.length; at += 4) {
    const batch = ordered.slice(at, at + 4);
    await Promise.all(
      batch.map(async (path) => {
        const encoded = path.split('/').map(encodeURIComponent).join('/');
        const raw = await getText(
          `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${encoded}`,
          'text/plain',
        );
        // **A 404 is a file the head revision does not have**, which is a fact about the pull request rather than a
        // failure: the gate withholds on it and the report counts it. Anything else is recorded as an error, because a
        // 500 filed as "the file is absent" is a false statement about the code.
        files[path] = raw.ok ? raw.text : raw.status === 404 ? null : { error: raw.reason };
      }),
    );
  }

  const record = {
    pr: key,
    owner,
    repo,
    number,
    sha,
    diffByPath,
    files,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

/**
 * **Whether a cached file entry is a failed request rather than an absent path.**
 *
 * The cache holds three shapes under one key: the file's text, `null` for a 404, and `{ error }` for a request that did
 * not complete. §150 split the last two into different buckets, and the test for the first of them was written as
 * `text === null` - which CodeQL cannot type, because a record read back through `JSON.parse` has values it describes as
 * `date | object | regular expression`, none of which it will compare with `null`.
 *
 * **`Object.prototype.toString` rather than `instanceof`**, because the value crossed a JSON boundary and has no
 * prototype of its own to be an instance of. **And the three-way answer is kept three-way**: this says only which of
 * the two non-text shapes it is, and the caller files the other.
 */
export function isFailedRead(value) {
  return typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * The gate's view of one pull request, or `undefined` when the replay could not read it at all.
 *
 * **Three facts, and the third is what §150 added**: the files, the diff per path, **the change as one text and the paths
 * the head revision does not have**. A `null` in `files` is a 404 - a fact about the revision - and it is the input the
 * unpostable bucket is built from; an `{ error }` is a failed request, and the cache treats the two differently.
 */
function sourcesOf(record) {
  if (record === undefined || record.error !== undefined) return undefined;
  const contents = new Map();
  const absent = new Set();
  for (const [path, text] of Object.entries(record.files ?? {})) {
    if (typeof text === 'string') contents.set(path, text);
    else if (text === null) absent.add(path);
  }
  const diffs = new Map(Object.entries(record.diffByPath ?? {}));
  return { contents, diffs, change: [...diffs.values()].join('\n'), absent };
}

export async function main(argv, log = console.log) {
  // **Imported here rather than at the top**, so this module's pure helpers can be read by a test without a build: the
  // gate is compiled TypeScript and the splitter is not, and a file that needed `pnpm build` to import its own string
  // functions would be untestable in the order the checks actually run.
  const { decideGrounding } =
    await import('../packages/intelligence/dist/review/grounding-gate.js');

  const artifactPath = argv.find((argument) => !argument.startsWith('--'));
  if (artifactPath === undefined) usage('no artifact given');
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const has = (name) => argv.includes(`--${name}`);

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const findings = artifact['rankedFindings'];
  if (!Array.isArray(findings) || findings.length === 0) usage(`${artifactPath} carries no rows`);

  // **The goldens are the artifact's own denominators**, because a cut does not change how many the corpus holds and a
  // recall recomputed from the cut's own misses would rise every time the cut shrank.
  const goldens = Number(artifact['truePositives'] ?? 0) + Number(artifact['falseNegatives'] ?? 0);
  const shipped = artifact['emissionRules']?.['shipped'];
  const steps = shipped?.steps ?? parseCut('drop:test+drop-path:test+budget:12');
  const published = shipped?.point;

  const sourcesDir = flag('sources') ?? join(tmpdir(), 'gate-replay-sources');
  mkdirSync(sourcesDir, { recursive: true });

  const required = requiredSources(findings);
  const records = new Map();
  if (has('fetch')) {
    let done = 0;
    for (const [key, paths] of required) {
      const record = await readPullRequest(key, paths, sourcesDir);
      records.set(key, record);
      done += 1;
      log(
        `fetched ${String(done)}/${String(required.size)} ${key}${record.error === undefined ? '' : ` (${record.error})`}`,
      );
    }
  } else {
    for (const key of required.keys()) {
      const file = cachePath(sourcesDir, key);
      if (existsSync(file)) records.set(key, JSON.parse(readFileSync(file, 'utf8')));
    }
  }

  const sourcesOfRecord = (key) => sourcesOf(records.get(key));
  const replay = replayGroundingGate({
    findings,
    goldens,
    steps,
    sourcesFor: sourcesOfRecord,
    decide: decideGrounding,
    published,
  });

  const unread = [...records.values()].filter((record) => record.error !== undefined);
  // **A 404 and a failed request are two facts and this tool reported them as one.**
  //
  // §149.5 read `withoutHeadFile` as *"a path the head revision does not have"* and told a story about a deleted file
  // disarming a pull request. The record behind it was `{ error: 'fetch failed' }` - **a request that did not complete**,
  // and the path exists at head: the refetch read 311 bytes of it. **The bucket is now split**, because a number that
  // mixes "git says no" with "the network said nothing" is a number that cannot be acted on: the first is unpostable, the
  // second is a gap in the evidence.
  const absentAtHead = [];
  const failedReads = [];
  for (const record of records.values()) {
    for (const [path, text] of Object.entries(record.files ?? {})) {
      if (typeof text === 'string') continue;
      // **The discriminator is a function because `text === null` stopped being typeable.** A record read back from the
      // cache is `JSON.parse`'s output, so CodeQL types its values as `date | object | regular expression` and flags a
      // comparison against `null` as incompatible - **`js/comparison-between-incompatible-types`, alert 1706, on the
      // line above the shape it had been reading correctly since §149.** The three shapes are unchanged and a unit
      // test pins them: a string is a file that was read, an object is a request that failed, and anything else - the
      // `null` this writes for a 404 - is a path the head revision does not have.
      if (isFailedRead(text)) failedReads.push({ pr: record.pr, path });
      else absentAtHead.push({ pr: record.pr, path });
    }
  }

  const output = {
    version: 1,
    instrument: 'scripts/gate-replay.mjs',
    builtFrom: artifactPath,
    artifactDigest: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
    corpus: artifact['corpus'],
    measuredAt: String(artifact['measuredAt'] ?? ''),
    pullRequests: {
      inArtifact: required.size,
      read: required.size - unread.length,
      unread: unread.map((record) => ({ pr: record.pr, why: record.error })),
      absentAtHead,
      failedReads,
    },
    // **The revisions the files were read at**, because the numbers above are reproducible only against the same text:
    // a replay that recorded the figures and not the commits would be a claim nobody could re-derive six months later,
    // when `main` has moved and the pull requests still have their history.
    pinned: [...records.values()]
      .filter((record) => typeof record.sha === 'string')
      .map((record) => ({ pr: record.pr, sha: record.sha }))
      .sort((left, right) => left.pr.localeCompare(right.pr)),
    ...replay,
    // **The distribution the name check was reading**, reported whether or not anybody acts on it: a comment naming nothing
    // and a comment naming something in the lines it points at are the two ends, and the count between them is how much of
    // the corpus the check could ever have decided.
    anchors: anchorsOf(findings, sourcesOfRecord),
    goldensDenominator: goldens,
  };

  log('');
  log(
    `grounding gate · ${String(findings.length)} findings · ${String(goldens)} goldens · ${output.cut.label}`,
  );
  log(TABLE_HEADER);
  log(formatRow('as published', replay.baseline));
  log(formatRow('+ grounding gate', replay.gated));
  log(
    `delta F1 ${replay.delta.f1.toFixed(4)} · emitted ${String(replay.delta.emitted)} · ` +
      `TP ${String(replay.delta.truePositives)} · reproduced ${String(replay.reproduced)}`,
  );
  log(
    `removed ${String(replay.removals.posted)} of the posted, ${String(replay.removals.truePositives)} of them true ` +
      `(${replay.removals.share === null ? 'no pool' : `${(replay.removals.share * 100).toFixed(1)}%`}) · ` +
      `admitted ${String(replay.admitted.posted)}`,
  );
  log(
    `dropped ${String(replay.gate.dropped)} of ${String(replay.gate.findings)} · coverage ` +
      `${String(replay.gate.coverage.readable)} readable + ${String(replay.gate.coverage.unpostable)} unpostable of ` +
      `${String(replay.gate.coverage.offered)} · withheld ${String(replay.gate.withheldPullRequests)} pull requests · ` +
      `unverifiable quotes ${String(replay.gate.unverifiableQuotes)} · names absent from the code ${String(replay.gate.namesNowhere)} (kept)`,
  );
  log(
    `anchors · ${String(output.anchors.noName)} name nothing · ${String(output.anchors.inRange)} in the lines they cite · ` +
      `${String(output.anchors.inFile)} elsewhere in the file · ${String(output.anchors.inChange)} only in the change · ` +
      `${String(output.anchors.nowhere)} nowhere`,
  );
  for (const bucket of replay.gate.byReason)
    log(`  ${String(bucket.count).padStart(4)}  ${bucket.reason}`);
  if (replay.goldens.lost.length > 0) log(`  lost goldens: ${replay.goldens.lost.join(', ')}`);

  const out = flag('out');
  if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
    log(`wrote ${out}`);
  }

  const html = flag('html');
  if (html !== undefined) {
    writeFileSync(html, renderGateReplayPage(output));
    log(`wrote ${html}`);
  }

  const check = flag('check');
  if (check !== undefined) {
    const recorded = JSON.parse(readFileSync(check, 'utf8'));
    const strip = (value) => {
      const { pullRequests: _pulls, ...rest } = value;
      return JSON.stringify(rest, Object.keys(rest).sort());
    };
    if (strip(recorded) !== strip(output)) {
      log(`check failed: ${check} differs from this replay`);
      return 1;
    }
    log(`check ok: ${check} is this replay`);
  }

  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(String(process.argv[1])).href
) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
