#!/usr/bin/env node
// Print the open code-scanning corpus - all of it - and the per-rule and per-path tables that a triage has to start
// from.
//
// **Written because a triage read one page and called it the corpus.** `docs/SECURITY.md` said nineteen
// `js/insecure-temporary-file` alerts were open on 2026-11-10; the repository had one hundred and thirty. The audit had
// asked for `per_page=100`, received an array of a hundred alerts, and counted the rule inside it. Nothing threw,
// nothing was empty, and the arithmetic was right - about eleven per cent of the population.
//
//     node scripts/code-scanning-corpus.mjs                       # every open alert, by rule
//     node scripts/code-scanning-corpus.mjs --rule js/redos      # and where those sit
//
// The token is read from the environment and is never written anywhere: `GITHUB_TOKEN`, falling back to `GH_TOKEN`.
// A missing token is an error rather than an anonymous request, because an unauthenticated request is rate-limited to
// sixty an hour and would silently truncate the walk at the first 403.

import { collectAllPages, countBy } from '../.github/scripts/lib/paginate.mjs';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;

function fail(message) {
  process.stderr.write(`code-scanning-corpus: ${message}\n`);
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) {
  fail(
    'no GITHUB_TOKEN or GH_TOKEN in the environment - an anonymous walk would be truncated by the rate limit',
  );
}

const args = process.argv.slice(2);
const ruleFlag = args.indexOf('--rule');
const onlyRule = ruleFlag === -1 ? null : args[ruleFlag + 1];
const repo =
  process.env.GITHUB_REPOSITORY ??
  (() => {
    const state = args.indexOf('--repo');
    return state === -1 ? 'AgentiX-E/code-analyzer' : args[state + 1];
  })();

async function api(path) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    fail(`HTTP ${String(response.status)} on ${path}`);
  }
  return response.json();
}

const alerts = await collectAllPages(
  async (page) =>
    api(
      `/repos/${repo}/code-scanning/alerts?state=open&per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
    ),
  { pageSize: PAGE_SIZE, what: 'open code-scanning alerts' },
);

const byRule = countBy(alerts, (alert) => alert.rule.id);
process.stdout.write(
  `${repo}: ${String(byRule.total)} open alerts across ${String(byRule.counts.length)} rules\n`,
);
for (const { key, count } of byRule.counts) {
  process.stdout.write(`${String(count).padStart(5)}  ${key}\n`);
}

if (onlyRule !== null) {
  const subset = alerts.filter((alert) => alert.rule.id === onlyRule);
  if (subset.length === 0) {
    fail(`no open alert has rule ${onlyRule}`);
  }
  const byPath = countBy(subset, (alert) => alert.most_recent_instance.location.path);
  process.stdout.write(
    `\n${onlyRule}: ${String(byPath.total)} alerts across ${String(byPath.counts.length)} files\n`,
  );
  for (const { key, count } of byPath.counts) {
    process.stdout.write(`${String(count).padStart(5)}  ${key}\n`);
  }
}
