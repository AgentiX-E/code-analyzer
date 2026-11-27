// **A dispatch is a request against a name, and a name can be a tree nobody is maintaining.**
//
// `§176` records what that cost: the repair `§175` built was pushed to `master`, the next dispatch named `main`, and the
// run started on a tree in which the repair does not exist - answering `204` with no run identifier, so nothing in the
// response said which commit had been bought. **The checks below are the three places that can be caught**: the ref
// before the request is sent, the trunk's tip before the money is spent, and the run's own `head_sha` after the fact -
// with a stray run cancelled rather than read.
//
// Every case is a refusal or an identity. The dispatcher is exercised against a fake API, so no case here buys a run.

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  floorToSecond,
  pickDispatchRun,
  refusalForPath,
  refusalForRef,
} from '../../../scripts/lib/dispatch-head.mjs';
import { runDispatch } from '../../../scripts/dispatch-bench.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TIP = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const STARTED = '2026-11-27T09:16:50.400Z';

/** Every request the dispatcher made, in order, so a refusal can be shown to have stopped before the expensive one. */
interface Recorded {
  method: string;
  url: string;
  body: string | null;
}

/**
 * A fake API: a route table keyed by `METHOD path`, and a record of what was asked.
 *
 * **The longest matching path wins**, because `/repos/o/r` is a prefix of every other route here and a first-match table
 * would answer the branch question with the repository document - a fixture that passes for the wrong reason.
 */
function fakeApi(
  routes: Record<
    string,
    (body: string | null) => { status: number; json?: unknown; text?: string }
  >,
) {
  const asked: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : null;
    asked.push({ method, url: String(url), body });
    const target = new URL(String(url));
    const key = Object.keys(routes)
      .filter(
        (route) =>
          route.startsWith(`${method} `) && target.pathname.startsWith(route.split(' ')[1]!),
      )
      .sort((left, right) => right.length - left.length)[0];
    if (key === undefined) return new Response('no route', { status: 404 });
    const { status, json, text } = routes[key]!(body);
    // **`204` is bodiless and the constructor says so** - which is the same fact the real API's dispatch answer carries,
    // and the reason a dispatch has no run identifier in its response.
    if (status === 204) return new Response(null, { status });
    return json === undefined
      ? new Response(text ?? '', { status })
      : new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

const base = {
  apiBase: 'https://api.test',
  token: 'x',
  repo: 'o/r',
  workflow: 'bench.yml',
  expect: ['scripts/lib/pinned-diff.mjs'],
  inputs: { dataset: 'aacr', lane_set: 'wide' },
  dryRun: false,
  wait: 1,
  interval: 0,
  ref: null as string | null,
};

describe('the two refusals before the request is sent', () => {
  it('refuses a ref that is not the default branch, and names both', () => {
    const refused = refusalForRef({ ref: 'main', defaultBranch: 'master' });
    expect(refused.ok).toBe(false);
    expect(String((refused as { reason: string }).reason)).toContain(
      '"main" is not the default branch ("master")',
    );
    expect(refusalForRef({ ref: 'master', defaultBranch: 'master' })).toEqual({
      ok: true,
      ref: 'master',
    });
  });

  it('refuses an unknown trunk rather than guessing one', () => {
    expect(refusalForRef({ ref: 'master', defaultBranch: '' }).ok).toBe(false);
    expect(refusalForRef({ ref: null, defaultBranch: null }).ok).toBe(false);
    // **A ref that was not substituted is not the default branch by accident.**
    expect(refusalForRef({ ref: '  ', defaultBranch: 'master' }).ok).toBe(false);
  });

  it('refuses a trunk whose tip does not hold the instrument, and says which status it read', () => {
    expect(
      refusalForPath({ path: 'scripts/lib/pinned-diff.mjs', commit: TIP, status: 200 }),
    ).toMatchObject({
      ok: true,
    });
    const missing = refusalForPath({
      path: 'scripts/lib/pinned-diff.mjs',
      commit: TIP,
      status: 404,
    });
    expect(missing.ok).toBe(false);
    expect(String((missing as { reason: string }).reason)).toContain(
      '"scripts/lib/pinned-diff.mjs" is not in aaaaaaaa',
    );
    // **A tree that could not be read is not a passing one** - `§175.5`'s fourth state, one level up.
    const unread = refusalForPath({
      path: 'scripts/lib/pinned-diff.mjs',
      commit: TIP,
      status: 503,
    });
    expect(unread.ok).toBe(false);
    expect(String((unread as { reason: string }).reason)).toContain(
      'an unchecked tree is not a passing one',
    );
  });
});

describe('which of the runs the workflow reports is the one this dispatch bought', () => {
  it('does not attribute an older run on the same head to a newer dispatch', () => {
    const picked = pickDispatchRun({
      runs: [{ id: 1, head_sha: TIP, created_at: '2026-11-27T08:35:09Z' }],
      tip: TIP,
      startedAt: STARTED,
    });
    expect(picked.ok).toBe(false);
    expect(String((picked as { reason: string }).reason)).toContain('has appeared since');
  });

  it('names a run on another head as a stray rather than as the run', () => {
    const picked = pickDispatchRun({
      runs: [
        { id: 7, head_sha: OTHER, created_at: '2026-11-27T09:16:50Z' },
        { id: 8, head_sha: TIP.slice(0, 7), created_at: '2026-11-27T09:16:51Z' },
      ],
      tip: TIP,
      startedAt: STARTED,
    });
    expect(picked.ok).toBe(false);
    const strays = (picked as { strays: { id: number }[] }).strays;
    expect(strays.map((run) => run.id)).toEqual([7, 8]);
  });

  it('takes the earliest of two runs on the right head, because a dispatch buys one', () => {
    const picked = pickDispatchRun({
      runs: [
        { id: 12, head_sha: TIP, created_at: '2026-11-27T09:20:00Z' },
        { id: 11, head_sha: TIP, created_at: '2026-11-27T09:16:51Z' },
      ],
      tip: TIP,
      startedAt: STARTED,
    });
    expect(picked.ok).toBe(true);
    expect((picked as { run: { id: number } }).run.id).toBe(11);
    expect((picked as { others: unknown[] }).others).toHaveLength(1);
    // **GitHub reports `created_at` to the second**, so a start time with milliseconds is floored: a run created in the
    // same second as the request is this request's run and not the previous one.
    expect(floorToSecond(STARTED)).toBe(Date.parse('2026-11-27T09:16:50Z'));
  });
});

describe('the dispatcher, against a fake API', () => {
  const repo = { default_branch: 'master' };

  it('refuses a ref that is not the trunk, and never posts a dispatch', async () => {
    const { asked, fetchImpl } = fakeApi({
      'GET /repos/o/r': () => ({ status: 200, json: repo }),
      'GET /repos/o/r/branches/main': () => ({ status: 200, json: { commit: { sha: TIP } } }),
      'GET /repos/o/r/contents/': () => ({ status: 200, json: {} }),
      'POST /repos/o/r/actions/workflows/bench.yml/dispatches': () => ({ status: 204 }),
    });
    const result = await runDispatch({ options: { ...base, ref: 'main' }, fetchImpl });
    expect(result).toMatchObject({ ok: false, stage: 'ref' });
    expect(asked.some((call) => call.method === 'POST')).toBe(false);
  });

  it('refuses a trunk that does not hold the instrument, and still never posts a dispatch', async () => {
    const { asked, fetchImpl } = fakeApi({
      'GET /repos/o/r': () => ({ status: 200, json: repo }),
      'GET /repos/o/r/branches/master': () => ({ status: 200, json: { commit: { sha: TIP } } }),
      'GET /repos/o/r/contents/': () => ({ status: 404, text: 'Not Found' }),
    });
    const result = await runDispatch({ options: { ...base }, fetchImpl });
    expect(result).toMatchObject({ ok: false, stage: 'path', ref: 'master', tip: TIP });
    expect(String((result as { reason: string }).reason)).toContain('is not in aaaaaaaa');
    expect(asked.some((call) => call.method === 'POST')).toBe(false);
  });

  it('posts the inputs verbatim and reads the run back on the head it dispatched', async () => {
    const { asked, fetchImpl } = fakeApi({
      'GET /repos/o/r': () => ({ status: 200, json: repo }),
      'GET /repos/o/r/branches/master': () => ({ status: 200, json: { commit: { sha: TIP } } }),
      'GET /repos/o/r/contents/': () => ({ status: 200, json: { name: 'pinned-diff.mjs' } }),
      'POST /repos/o/r/actions/workflows/bench.yml/dispatches': () => ({ status: 204 }),
      'GET /repos/o/r/actions/workflows/bench.yml/runs': () => ({
        status: 200,
        json: {
          workflow_runs: [
            { id: 42, head_sha: TIP, created_at: '2026-11-27T09:16:52Z', html_url: 'https://x/42' },
          ],
        },
      }),
    });
    const result = await runDispatch({
      options: { ...base, inputs: { dataset: 'aacr', pair: 'off', max_pull_requests: '50' } },
      fetchImpl,
      now: () => new Date(STARTED),
    });
    expect(result).toMatchObject({ ok: true, ref: 'master', tip: TIP });
    expect((result as { run: { id: number } }).run.id).toBe(42);
    // **`off` stays the string `off`.** YAML reads an unquoted one as a boolean, and a dispatch that coerced it would buy
    // a different arm from the one that was selected.
    const posted = JSON.parse(asked.find((call) => call.method === 'POST')!.body!);
    expect(posted).toEqual({
      ref: 'master',
      inputs: { dataset: 'aacr', pair: 'off', max_pull_requests: '50' },
    });
  });

  it('cancels a run that appeared on another head instead of reading its figure', async () => {
    const { asked, fetchImpl } = fakeApi({
      'GET /repos/o/r': () => ({ status: 200, json: repo }),
      'GET /repos/o/r/branches/master': () => ({ status: 200, json: { commit: { sha: TIP } } }),
      'GET /repos/o/r/contents/': () => ({ status: 200, json: {} }),
      'POST /repos/o/r/actions/workflows/bench.yml/dispatches': () => ({ status: 204 }),
      'GET /repos/o/r/actions/workflows/bench.yml/runs': () => ({
        status: 200,
        json: { workflow_runs: [{ id: 9, head_sha: OTHER, created_at: '2026-11-27T09:16:51Z' }] },
      }),
      'POST /repos/o/r/actions/runs/9/cancel': () => ({ status: 202 }),
    });
    const result = await runDispatch({
      options: { ...base },
      fetchImpl,
      now: () => new Date(STARTED),
    });
    expect(result).toMatchObject({ ok: false, stage: 'stray' });
    expect((result as { cancelled: { id: number }[] }).cancelled).toEqual([
      { id: 9, head: 'bbbbbbbb', status: 202 },
    ]);
    expect(asked.some((call) => call.url.endsWith('/actions/runs/9/cancel'))).toBe(true);
  });

  it('refuses a dry run that would have posted, and reports the tree it checked', async () => {
    const { asked, fetchImpl } = fakeApi({
      'GET /repos/o/r': () => ({ status: 200, json: repo }),
      'GET /repos/o/r/branches/master': () => ({ status: 200, json: { commit: { sha: TIP } } }),
      'GET /repos/o/r/contents/': () => ({ status: 200, json: {} }),
    });
    const result = await runDispatch({ options: { ...base, dryRun: true }, fetchImpl });
    expect(result).toMatchObject({ ok: true, dryRun: true, ref: 'master', tip: TIP, inputs: 2 });
    expect(asked.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('the command line', () => {
  it('exits non-zero with the reason, so a shell chain cannot continue past a refused dispatch', async () => {
    const server = createServer((request, response) => {
      const path = String(request.url ?? '');
      const answer =
        path === '/repos/o/r'
          ? [200, { default_branch: 'master' }]
          : path.startsWith('/repos/o/r/branches/')
            ? [200, { commit: { sha: TIP } }]
            : path.startsWith('/repos/o/r/contents/')
              ? [404, {}]
              : [204, null];
      response.writeHead(answer[0] as number, { 'content-type': 'application/json' });
      response.end(answer[1] === null ? '' : JSON.stringify(answer[1]));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    try {
      const failed = await new Promise<{ code: number; stderr: string }>((done) => {
        execFile(
          process.execPath,
          [
            join(ROOT, 'scripts', 'dispatch-bench.mjs'),
            '--repo',
            'o/r',
            '--workflow',
            'bench.yml',
            '--expect',
            'scripts/lib/pinned-diff.mjs',
            '--input',
            'dataset=aacr',
            '--api-base',
            `http://127.0.0.1:${String(port)}`,
          ],
          { cwd: ROOT, encoding: 'utf8' },
          (error, _stdout, stderr) => {
            done({
              code: typeof error?.code === 'number' ? error.code : 0,
              stderr: String(stderr),
            });
          },
        );
      });
      expect(failed.code).toBe(2);
      expect(failed.stderr).toContain('dispatch refused at path');
    } finally {
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    }
  });
});
