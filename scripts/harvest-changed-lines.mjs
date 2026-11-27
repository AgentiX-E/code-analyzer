#!/usr/bin/env node
/**
 * **What each pull request's own added lines write, harvested once so that a measurement is not a network call.**
 *
 * §168.8 found that §166's adjacency was measured against the identifiers of the golden's *sentence*, and that twenty-one
 * of the twenty-seven plan entries therefore named a word the sentence happens to contain rather than a name the change
 * writes. The repair is a second set, and this command builds it: for every pull request in the corpus, **the identifiers
 * on the added side of its own diff**, minus keywords and minus anything inside a comment
 * (`scripts/lib/code-names.mjs`).
 *
 * **It is harvested rather than fetched by the instrument**, because a measurement that calls GitHub cannot be gated: the
 * diff of a public pull request is stable, but a run of `bench:symbol-adjacency` that depended on fifty API calls would
 * fail on a rate limit and could not be compared against a committed record. The file this writes is committed, and the
 * instrument reads it.
 *
 * **What the record has to be able to prove about itself:**
 *
 * - **coverage** - every pull request in the corpus is either in `pulls` or in `failures` with a reason, so "the set is
 *   empty" and "the request failed" cannot be mistaken for each other;
 * - **the corpus it was taken over** - by digest, not by path, because the path is stable and the file is not;
 * - **the rule**, in the same words the instrument prints, because a symbol set is a claim about what a name is.
 *
 * ```
 * node scripts/harvest-changed-lines.mjs --corpus benchmarks/martian/positive_samples.json \
 *   --out benchmarks/martian/changed-lines.json
 * ```
 *
 * It needs a token with `public_repo` reach (`GITHUB_TOKEN`, else the git credential helper) and network access to
 * api.github.com. **Nothing here costs a model call.**
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { codeNamesOf } from './lib/code-names.mjs';

const REPO = resolve(import.meta.dirname, '..');
const API = 'https://api.github.com';

function parseArgs(argv) {
  const options = {
    corpus: 'benchmarks/martian/positive_samples.json',
    out: 'benchmarks/martian/changed-lines.json',
    concurrency: 4,
    date: new Date().toISOString().slice(0, 10),
  };
  const numeric = new Set(['concurrency']);
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (!(name in options)) {
      process.stderr.write(`unknown option ${arg}\n`);
      process.exit(2);
    }
    const value = argv[(at += 1)];
    options[name] = numeric.has(name) ? Number(value) : value;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function token() {
  if (process.env['GITHUB_TOKEN']) return process.env['GITHUB_TOKEN'];
  const fromRemote = /x-access-token:([^@]+)@/.exec(
    (() => {
      try {
        return execFileSync('git', ['remote', 'get-url', 'origin'], {
          cwd: REPO,
          encoding: 'utf8',
        });
      } catch {
        return '';
      }
    })(),
  );
  if (fromRemote !== null) return fromRemote[1];
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    const match = /^password=(.+)$/m.exec(out);
    return match === null ? '' : match[1];
  } catch {
    return '';
  }
}

const TOKEN = token();

/**
 * **One diff, as text**, with the redirect GitHub answers for a renamed repository.
 *
 * The first version of this call did not follow redirects and read `Moved Permanently` as a diff - which parsed to no
 * files at all, and a pull request with an empty name set would have been counted as "the change names nothing" rather
 * than as "the request was not answered". `-L` is the whole fix; the status is checked anyway, because a 404 body also
 * parses to no files.
 */
function diffOf(pullRequest) {
  const parsed = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(pullRequest));
  if (parsed === null) throw new Error(`not a pull request url: ${pullRequest}`);
  const [, owner, repo, number] = parsed;
  const url = `${API}/repos/${owner}/${repo}/pulls/${number}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const out = execFileSync(
      'curl',
      [
        '-sS',
        '-L',
        '--http1.1',
        '--max-time',
        '90',
        '-H',
        `Authorization: Bearer ${TOKEN}`,
        '-H',
        'Accept: application/vnd.github.v3.diff',
        '-H',
        'User-Agent: code-analyzer',
        '-w',
        '\n%{http_code}',
        url,
      ],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
    );
    const cut = out.lastIndexOf('\n');
    const status = Number(out.slice(cut + 1));
    const body = out.slice(0, cut);
    if (status === 200 && body.startsWith('diff ')) return body;
    if (status === 403 || status === 429) {
      process.stderr.write(`  ${pullRequest}: ${String(status)}, backing off\n`);
      execFileSync('sleep', [String(15 * (attempt + 1))]);
      continue;
    }
    throw new Error(`${pullRequest}: http ${String(status)} ${body.slice(0, 80)}`);
  }
  throw new Error(`${pullRequest}: gave up after three attempts`);
}

/** The files a diff touches and the lines the new revision adds, which is what the record states about a pull request. */
function shapeOf(diff) {
  let files = 0;
  let added = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) files += 1;
    else if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
  }
  return { files, added };
}

async function mapLimit(items, limit, run) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      // **One argument, because the worker takes one.** Passing the index here would be a parameter the anonymous
      // function does not declare, which CodeQL reports as a superfluous trailing argument - the same shape as §167.8's
      // alert in the runner, and the fix is at the call rather than in the signature.
      out[at] = await run(items[at]);
    }
  });
  await Promise.all(workers);
  return out;
}

const corpusPath = resolve(REPO, options.corpus);
const corpusBytes = readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes.toString('utf8'));
const pullRequests = [...new Set(corpus.map((row) => String(row?.githubPrUrl ?? '')))].filter(
  (url) => url !== '',
);

const pulls = {};
const failures = [];
await mapLimit(pullRequests, options.concurrency, async (pullRequest) => {
  try {
    const diff = diffOf(pullRequest);
    const names = codeNamesOf(diff);
    const { files, added } = shapeOf(diff);
    if (names.length === 0) {
      failures.push({ pullRequest, reason: 'the diff names nothing after keywords and comments' });
      return;
    }
    pulls[pullRequest] = { files, added, names };
    process.stderr.write(
      `  ${pullRequest}: ${String(files)} files, ${String(names.length)} names\n`,
    );
  } catch (error) {
    failures.push({ pullRequest, reason: String(error instanceof Error ? error.message : error) });
    process.stderr.write(`  ${pullRequest}: ${failures[failures.length - 1].reason}\n`);
  }
});

const names = Object.values(pulls).reduce((total, pull) => total + pull.names.length, 0);
const record = {
  version: 'changed-lines-v1',
  corpus: options.corpus,
  corpusDigest: `sha256-${createHash('sha256').update(corpusBytes).digest('hex')}`,
  measuredAt: options.date,
  rule: {
    lines: 'the added (+) side of each pull request’s own diff',
    comments: 'stripped before identifiers are read, because a comment is not code',
    keywords: 'excluded, because a keyword is not a name',
    names: 'identifier-shaped, four characters or more',
  },
  summary: {
    pullRequests: pullRequests.length,
    harvested: Object.keys(pulls).length,
    failed: failures.length,
    names,
  },
  pulls,
  failures,
};

writeFileSync(resolve(REPO, options.out), `${JSON.stringify(record, null, 2)}\n`);

process.stdout.write(
  [
    `CHANGED-LINES ${String(record.summary.harvested)} of ${String(record.summary.pullRequests)} pull requests`,
    `names ${String(record.summary.names)} · failures ${String(record.summary.failed)}`,
    ...failures.map((failure) => `  ${failure.pullRequest}: ${failure.reason}`),
    '',
  ].join('\n'),
);

if (failures.length > 0) process.exit(1);
