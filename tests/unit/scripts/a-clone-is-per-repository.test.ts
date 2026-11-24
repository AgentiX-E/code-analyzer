// **The clone is per repository, and the corpus is why that is a measurement rather than an optimisation.**
//
// The Martian corpus is fifty pull requests over seven repositories - `calcom/cal.com` ten, `grafana/grafana` ten,
// `keycloak/keycloak` nine, `getsentry/sentry` six and three smaller trees. The runner cloned per pull request, so a
// fifty-row arm paid fifty blobless clones of histories that were already on disk, and a job that runs one of those
// clones per row is a job that can run out of minutes before it reports a figure.
//
// **A count of `git clone` calls is the assertion**, and it is the one thing this file could not observe while the
// runner was a module-level `execFileSync`: the command is injectable for that reason and for no other.

import { existsSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import type { CommandRunner } from '../../../scripts/lib/ocr-arm.mjs';
import { cloneStats, releaseClones, reviewRange } from '../../../scripts/lib/ocr-arm.mjs';

const REPORT = [
  'Review complete: 1 finding(s) across 1 selected file(s).',
  '',
  '\u2500\u2500\u2500 src/a.ts:10-12 \u2500\u2500\u2500',
  '[bug \u00b7 high] the guard is missing',
].join(String.fromCharCode(10));

interface CorpusRow {
  githubPrUrl: string;
  source_commit?: string;
  target_commit?: string;
}

interface Call {
  file: string;
  args: readonly string[];
}

/** Which git subcommand a call is, accounting for the `-C <dir>` prefix every call after the clone uses. */
const subcommand = (call: Call): string | undefined =>
  call.file !== 'git' ? call.file : call.args[0] === '-C' ? call.args[2] : call.args[0];

/** How the counters moved across one block of work - they are a cost account for the process, not a cache size. */
function delta(before: { clones: number; reuses: number }) {
  const now = cloneStats();
  return { clones: now.clones - before.clones, reuses: now.reuses - before.reuses };
}

/** A runner that answers both commands, records them, and never touches the network. */
function recording(outcomes: { clone?: () => never } = {}): { calls: Call[]; run: CommandRunner } {
  const calls: Call[] = [];
  const run: CommandRunner = (file, args) => {
    calls.push({ file, args: [...args] });
    if (file === 'ocr') return REPORT;
    if (args[0] === 'clone' && outcomes.clone) outcomes.clone();
    return '';
  };
  return { calls, run };
}

const newRange = (url: string, source: string, target: string, run: CommandRunner) =>
  reviewRange({ url, source, target, endpoint: 'https://example.invalid', key: 'k', run });

afterEach(() => {
  releaseClones();
});

describe('two pull requests in one repository share one clone', () => {
  it('clones once and reuses it, and says so in the counters', () => {
    const { calls, run } = recording();
    const before = cloneStats();
    newRange('https://github.com/grafana/grafana/pull/1', 'a'.repeat(40), 'b'.repeat(40), run);
    newRange('https://github.com/grafana/grafana/pull/2', 'c'.repeat(40), 'd'.repeat(40), run);

    const clones = calls.filter((call) => subcommand(call) === 'clone');
    const fetches = calls.filter((call) => subcommand(call) === 'fetch');
    expect(clones).toHaveLength(1);
    // **Both reviews fetched and checked out their own commits**, which is the part that makes the tree correct: what
    // is shared is the history download, not the working state.
    expect(fetches).toHaveLength(2);
    expect(delta(before)).toEqual({ clones: 1, reuses: 1 });
  });

  it('clones once for each of two different repositories', () => {
    const { calls, run } = recording();
    const before = cloneStats();
    newRange('https://github.com/grafana/grafana/pull/1', 'a'.repeat(40), 'b'.repeat(40), run);
    newRange('https://github.com/keycloak/keycloak/pull/2', 'c'.repeat(40), 'd'.repeat(40), run);

    const clones = calls.filter((call) => subcommand(call) === 'clone');
    expect(clones).toHaveLength(2);
    expect(clones[0]?.args.join(' ')).toContain('grafana/grafana');
    expect(clones[1]?.args.join(' ')).toContain('keycloak/keycloak');
    expect(delta(before)).toEqual({ clones: 2, reuses: 0 });
  });

  it('asks for a blobless, checkout-free clone and a forced checkout afterwards', () => {
    // **The three flags are the whole safety argument**, so they are pinned rather than assumed: `--filter=blob:none`
    // keeps the shared history cheap, `--no-checkout` keeps the clone from materialising a tree nobody asked for, and
    // `-f` is what stops a reviewer's leftovers from deciding what the next review sees in a directory that now
    // outlives one review.
    const { calls, run } = recording();
    newRange('https://github.com/grafana/grafana/pull/1', 'a'.repeat(40), 'b'.repeat(40), run);
    const clone = calls.find((call) => subcommand(call) === 'clone');
    const checkout = calls.find((call) => subcommand(call) === 'checkout');
    expect(clone?.args).toContain('--filter=blob:none');
    expect(clone?.args).toContain('--no-checkout');
    expect(checkout?.args).toContain('-f');
  });
});

describe('a cached directory that fails is thrown away rather than trusted', () => {
  it('re-clones after a checkout failure, and the failed directory is gone', () => {
    let fail = true;
    const calls: Call[] = [];
    const run: CommandRunner = (file, args) => {
      calls.push({ file, args: [...args] });
      if (file === 'ocr') return REPORT;
      if (args[2] === 'checkout' && fail) {
        fail = false;
        throw Object.assign(new Error('checkout failed'), { stderr: 'fatal: bad object' });
      }
      return '';
    };

    const before = cloneStats();
    const first = newRange(
      'https://github.com/grafana/grafana/pull/1',
      'a'.repeat(40),
      'b'.repeat(40),
      run,
    );
    expect(first.ok).toBe(false);
    expect(first.reason).toBe('fatal: bad object');

    const cloned = calls.find((call) => subcommand(call) === 'clone');
    const dir = cloned?.args[4] ?? '';
    expect(dir.length).toBeGreaterThan(0);
    // **Removed, not merely forgotten**: a directory left on disk is a directory the next run would have to reason about.
    expect(existsSync(dir)).toBe(false);
    expect(cloneStats()).toMatchObject({ cached: 0 });

    const second = newRange(
      'https://github.com/grafana/grafana/pull/1',
      'a'.repeat(40),
      'b'.repeat(40),
      run,
    );
    expect(second.ok).toBe(true);
    // **Paid for twice and reused never**, which is the sentence the assertion is about: a thrown-away directory is a
    // directory the next review has to clone again.
    expect(delta(before)).toEqual({ clones: 2, reuses: 0 });
  });
});

describe('the counters are per process, and release empties the cache', () => {
  it('starts again from one clone after a release', () => {
    const { calls, run } = recording();
    newRange('https://github.com/grafana/grafana/pull/1', 'a'.repeat(40), 'b'.repeat(40), run);
    releaseClones();
    expect(cloneStats().cached).toBe(0);

    const before = cloneStats();
    newRange('https://github.com/grafana/grafana/pull/1', 'a'.repeat(40), 'b'.repeat(40), run);
    const clones = calls.filter((call) => subcommand(call) === 'clone');
    // **The counters accumulate across a release** - they are a cost account, not a cache size - while `cached` drops
    // to zero, because a released clone is a clone that has to be paid for again.
    expect(clones).toHaveLength(2);
    expect(delta(before)).toEqual({ clones: 1, reuses: 0 });
    expect(cloneStats().cached).toBe(1);
  });
});

describe('the corpus this arm exists for', () => {
  it('turns fifty Martian pull requests into seven clones', () => {
    // **The claim this file's cache is built on, stated as the corpus rather than as an example.** The Martian board's
    // fifty rows are spread over seven repositories, so a per-pull-request clone is 43 downloads of history the run
    // already has - and 43 blobless clones of `grafana/grafana` is the shape of a job that runs out of minutes.
    const corpus = JSON.parse(
      readFileSync(
        new URL('../../../benchmarks/martian/positive_samples.json', import.meta.url),
        'utf8',
      ),
    ) as { samples?: CorpusRow[] } | CorpusRow[];
    // **Two shapes, because the corpus is a list and a reader may have wrapped it**: the file ships as a
    // top-level array and the harness reads either.
    const rows = Array.isArray(corpus) ? corpus : (corpus.samples ?? []);
    expect(rows).toHaveLength(50);

    const { calls, run } = recording();
    const before = cloneStats();
    for (const row of rows) {
      reviewRange({
        url: row.githubPrUrl,
        source: row.source_commit ?? 'a'.repeat(40),
        target: row.target_commit ?? 'b'.repeat(40),
        endpoint: 'https://example.invalid',
        key: 'k',
        run,
      });
    }
    const clones = calls.filter((call) => subcommand(call) === 'clone');
    const repositories = new Set(
      rows.map((row) => row.githubPrUrl.split('/').slice(3, 5).join('/')),
    );
    expect(clones).toHaveLength(repositories.size);
    expect(delta(before)).toEqual({ clones: 7, reuses: 43 });
  });
});
