#!/usr/bin/env node
/**
 * **A benchmark dispatch names the trunk it means, and is refused - or cancelled - when the run is not on it.**
 *
 * `§176` records the incident this exists for. The instrument `§175` built was committed and pushed to `master`; the
 * next dispatch named `main`, a branch that had stopped moving at the same content level under a rebuilt lineage of
 * commit identifiers, **and the run started on a tree in which `scripts/lib/pinned-diff.mjs` does not exist**. The
 * workflow answered `204 No Content` and no run identifier, so nothing in the response said which commit had been
 * bought - and the artifact would have carried a figure measured without the repair it was dispatched to measure.
 *
 * **Three checks, in the order the money is spent.** The ref is checked against the repository's own default branch
 * before a request is sent. The trunk's tip is checked for the one file whose presence makes the run meaningful. And
 * **the run is read back and its `head_sha` compared with the tip that was dispatched** - a run on another head is
 * cancelled rather than read, because a figure from it is a figure about a document nobody named.
 *
 * Usage:
 *     node scripts/dispatch-bench.mjs --repo AgentiX-E/code-analyzer --workflow aacr-bench.yml \
 *         --expect scripts/lib/pinned-diff.mjs --input dataset=aacr --input max_pull_requests=50 \
 *         [--ref master] [--dry-run] [--json out.json] [--wait 900]
 *
 * **`--ref` is optional and defaults to the repository's default branch**, which is the only branch a figure should ever
 * be bought on. Passing it explicitly is allowed because a dispatch against a release branch is a legitimate thing to
 * want - it is refused unless it *is* the default, and the refusal names both so a caller can see which is which.
 *
 * **Every input is a string.** The workflow's `pull_request_budget`, `max_findings_per_file` and `same_site_concerns` are
 * `type: string` and one of its choices is literally `off`, which YAML 1.1 reads as a boolean - a dispatcher that
 * coerced `off` to `false` would be refused with `422`, which is at least loud, and a dispatcher that dropped it would
 * buy a different arm quietly. So `--input key=value` is posted verbatim and nothing is inferred.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { pickDispatchRun, refusalForPath, refusalForRef } from './lib/dispatch-head.mjs';

const DEFAULT_API = 'https://api.github.com';
const AGENT = 'agentix-e-dispatch-guard';

function parseArgs(argv) {
  const options = {
    repo: null,
    workflow: null,
    ref: null,
    expect: [],
    inputs: {},
    apiBase: process.env['GH_API_BASE'] ?? DEFAULT_API,
    token: process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? '',
    dryRun: false,
    json: null,
    wait: 900,
    interval: 15,
  };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === '--repo') options.repo = argv[(at += 1)];
    else if (arg === '--workflow') options.workflow = argv[(at += 1)];
    else if (arg === '--ref') options.ref = argv[(at += 1)];
    else if (arg === '--expect') options.expect.push(argv[(at += 1)]);
    else if (arg === '--api-base') options.apiBase = argv[(at += 1)];
    else if (arg === '--json') options.json = argv[(at += 1)];
    else if (arg === '--wait') options.wait = Number(argv[(at += 1)]);
    else if (arg === '--interval') options.interval = Number(argv[(at += 1)]);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--input')) {
      const pair = String(argv[(at += 1)] ?? '');
      const split = pair.indexOf('=');
      if (split <= 0) throw new Error(`--input wants key=value, got "${pair}"`);
      options.inputs[pair.slice(0, split)] = pair.slice(split + 1);
    } else throw new Error(`unknown argument "${arg}"`);
  }
  if (options.repo === null || options.workflow === null) {
    throw new Error('--repo owner/name and --workflow file.yml are both required');
  }
  return options;
}

/** One request against the API, with the three headers every call here needs and no retry of its own. */
async function call({ apiBase, token, fetchImpl, method = 'GET', path, body }) {
  const res = await fetchImpl(`${apiBase}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': AGENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res;
}

const sleepFor = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * **The whole dispatch, as a value rather than as a side effect**, so the three refusals can be tested without a
 * network and without a paid run. `now` is injected because the one comparison that decides which run was bought is a
 * comparison of timestamps.
 */
export async function runDispatch({
  options,
  fetchImpl = fetch,
  sleep = sleepFor,
  now = () => new Date(),
}) {
  const api = { apiBase: options.apiBase, token: options.token, fetchImpl };

  const repoRes = await call({ ...api, path: `/repos/${options.repo}` });
  if (!repoRes.ok) {
    return {
      ok: false,
      stage: 'repo',
      reason: `GET /repos/${options.repo} answered ${String(repoRes.status)}`,
    };
  }
  const repo = await repoRes.json();
  const refCheck = refusalForRef({
    ref: options.ref ?? repo.default_branch,
    defaultBranch: repo.default_branch,
  });
  if (!refCheck.ok) return { ok: false, stage: 'ref', reason: refCheck.reason };
  const ref = refCheck.ref;

  const branchRes = await call({ ...api, path: `/repos/${options.repo}/branches/${ref}` });
  if (!branchRes.ok) {
    return {
      ok: false,
      stage: 'tip',
      reason: `GET /repos/${options.repo}/branches/${ref} answered ${String(branchRes.status)}`,
    };
  }
  const branch = await branchRes.json();
  const tip = String(branch?.commit?.sha ?? '');
  if (tip === '') return { ok: false, stage: 'tip', reason: `branch "${ref}" reported no commit` };

  for (const path of options.expect) {
    const contentsRes = await call({
      ...api,
      path: `/repos/${options.repo}/contents/${path}?ref=${tip}`,
    });
    const check = refusalForPath({ path, commit: tip, status: contentsRes.status });
    if (!check.ok) return { ok: false, stage: 'path', reason: check.reason, ref, tip };
  }

  if (options.dryRun) {
    return { ok: true, dryRun: true, ref, tip, inputs: Object.keys(options.inputs).length };
  }

  const startedAt = now();
  const dispatched = await call({
    ...api,
    method: 'POST',
    path: `/repos/${options.repo}/actions/workflows/${options.workflow}/dispatches`,
    body: { ref, inputs: options.inputs },
  });
  if (dispatched.status !== 204 && dispatched.status !== 201 && dispatched.status !== 200) {
    const text = await dispatched.text().catch(() => '');
    return {
      ok: false,
      stage: 'dispatch',
      reason: `the dispatch answered ${String(dispatched.status)} ${text.slice(0, 300)}`.trim(),
      ref,
      tip,
    };
  }

  const deadline = Date.parse(startedAt.toISOString()) + options.wait * 1000;
  const cancelled = [];
  for (;;) {
    const runsRes = await call({
      ...api,
      path: `/repos/${options.repo}/actions/workflows/${options.workflow}/runs?event=workflow_dispatch&per_page=20`,
    });
    if (!runsRes.ok) {
      return {
        ok: false,
        stage: 'read-back',
        reason: `the run list answered ${String(runsRes.status)}`,
        ref,
        tip,
      };
    }
    const listed = await runsRes.json();
    const picked = pickDispatchRun({ runs: listed.workflow_runs ?? [], tip, startedAt });
    if (picked.ok) {
      return {
        ok: true,
        dryRun: false,
        ref,
        tip,
        run: {
          id: picked.run.id,
          url: picked.run.html_url ?? null,
          createdAt: picked.run.created_at,
        },
        others: picked.others.length,
        cancelled,
      };
    }
    // **A run on another head is cancelled where it stands**, because it is paying for a figure about a tree nobody
    // dispatched - and cancelling is the only way to stop that bill.
    for (const stray of picked.strays ?? []) {
      const stop = await call({
        ...api,
        method: 'POST',
        path: `/repos/${options.repo}/actions/runs/${stray.id}/cancel`,
      });
      cancelled.push({
        id: stray.id,
        head: String(stray.head_sha ?? '').slice(0, 8),
        status: stop.status,
      });
    }
    if (cancelled.length > 0) {
      return {
        ok: false,
        stage: 'stray',
        reason: `${String(cancelled.length)} run(s) appeared on a head other than ${tip.slice(0, 8)} and were cancelled`,
        ref,
        tip,
        cancelled,
      };
    }
    if (Date.parse(now().toISOString()) >= deadline) {
      return { ok: false, stage: 'read-back', reason: picked.reason, ref, tip };
    }
    await sleep(options.interval * 1000);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runDispatch({ options });
  if (options.json !== null) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (result.ok) {
    process.stdout.write(
      result.dryRun
        ? `dispatch ok (dry run) · ${result.ref} at ${result.tip.slice(0, 8)} · ${String(result.inputs)} inputs\n`
        : `dispatch ok · ${result.ref} at ${result.tip.slice(0, 8)} · run ${String(result.run.id)} ${result.run.url ?? ''}\n`,
    );
    return;
  }
  process.stderr.write(
    `dispatch refused at ${result.stage}: ${result.reason}\n` +
      (result.ref === undefined
        ? ''
        : `  ref ${result.ref} · tip ${String(result.tip).slice(0, 8)}\n`),
  );
  process.exitCode = 2;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
