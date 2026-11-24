// @code-analyzer — the field's corpus and the field's file, read and written by two arms rather than by one

/**
 * **The Martian harness is now two arms, and the corpus and the merge were written for one.**
 *
 * `run-martian-harness.mjs` reads their golden comments, fetches each pull request's diff, reviews it, and **merges**
 * its reviews into `results/benchmark_data.json` - a file that ships with **every other tool's reviews for all fifty
 * pull requests**. The competitor arm (`run-martian-competitor.mjs`) writes to the same file, under a different tool
 * name, for the same reason: **the only comparison that is a comparison is two reviewers judged by one judge, and that
 * needs both reviewers in one file.**
 *
 * **So the shared half lives here.** A second copy of the merge would be a second definition of what "our row" means,
 * and **a write to a directory somebody else owns is a merge or it is a deletion** - the rule the first version of the
 * harness learned by deleting the field.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Their golden comments, keyed by pull request.**
 *
 * One file per repository under `offline/golden_comments/`, each an array of `{pr_title, url, comments}`. A missing
 * directory is an empty corpus rather than an error, because that is a fact the caller has to report rather than abort
 * on - the harness distinguishes "no goldens" from "no model" in its own artifact.
 */
export function readGolden(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const repo = name.replace('.json', '');
    const entries = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    for (const e of entries)
      out.push({ repo, prTitle: e.pr_title ?? '', url: e.url, comments: e.comments ?? [] });
  }
  return out;
}

/** The `owner/repo/pull/number` a URL names, or `null`. */
export function pullOf(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
  return m === null ? null : { owner: m[1], repo: m[2], number: m[3] };
}

function headers(accept, token) {
  return {
    accept,
    'user-agent': 'agentix-e-martian-harness',
    ...(token ? { authorization: `token ${token}` } : {}),
  };
}

/**
 * **The unified diff of a pull request, through the API, because that is what a reviewer reads.**
 *
 * `null` rather than a throw for every non-answer: a pull request whose diff cannot be read is a row the artifact
 * reports as missing, and a harness that aborted on the first one would publish nothing about the other forty-nine.
 */
export async function fetchDiff(url, token = '') {
  const pull = pullOf(url);
  if (pull === null) return null;
  const res = await fetch(
    `https://api.github.com/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`,
    { headers: headers('application/vnd.github.v3.diff', token) },
  );
  if (!res.ok) return null;
  return await res.text();
}

/**
 * **The two commits a range review needs**, and they are not the diff's business: `ocr review --from A --to B` reads a
 * checkout, so the arm has to know which commits the pull request spans.
 */
export async function pullCommits(url, token = '') {
  const pull = pullOf(url);
  if (pull === null) return null;
  const res = await fetch(
    `https://api.github.com/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`,
    { headers: headers('application/vnd.github+json', token) },
  );
  if (!res.ok) return null;
  const body = await res.json();
  const source = body?.base?.sha;
  const target = body?.head?.sha;
  if (typeof source !== 'string' || typeof target !== 'string') return null;
  return { source, target };
}

/**
 * **Our rows into their file, without touching anyone else's.**
 *
 * `existing` is their shipped `benchmark_data.json`: one entry per golden pull request, each holding **every tool's**
 * review. This replaces the reviews of `tool` only - so a rerun is idempotent, and a shipped tool is never dropped by a
 * run that only knows about one of them. **The golden comments come from the shipped entry when it has them**, because
 * they are the ground truth and an arm has no business rewriting it.
 *
 * The counters are returned rather than logged, because both callers report them in their own artifacts and a merge
 * that silently changed the tool count is the failure this function exists to make visible.
 */
export function mergeReviews(existing, rows, tool) {
  const toolsIn = (data) => {
    const set = new Set();
    for (const entry of Object.values(data)) {
      for (const review of entry?.reviews ?? []) if (review?.tool) set.add(review.tool);
    }
    return set;
  };
  const before = toolsIn(existing);
  let merged = 0;
  for (const [url, entry] of Object.entries(rows)) {
    const target = existing[url];
    if (!target) {
      existing[url] = entry;
      continue;
    }
    target.reviews = (target.reviews ?? []).filter((r) => r.tool !== tool);
    target.reviews.push(...(entry.reviews ?? []));
    if (!target.golden_comments && entry.golden_comments)
      target.golden_comments = entry.golden_comments;
    merged += 1;
  }
  return {
    merged,
    prs: Object.keys(existing).length,
    toolsBefore: before.size,
    toolsAfter: toolsIn(existing).size,
  };
}

/**
 * **Their second file, merged rather than replaced.**
 *
 * `step3` reads `results/{sanitized_model}/candidates.json`: `{ "<golden_url>": { "<tool>": [ {text, path, line,
 * source} ] } }`. Two arms produce two sets of candidates for the same pull requests, so **the write is per tool and
 * merges**, and a run of one arm cannot erase the other's answer key.
 */
export function mergeCandidates(path, perUrl, tool) {
  let existing = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // **A file that will not parse is reported rather than silently replaced**, because the difference between
      // "there was nothing here" and "there was something here and it was unreadable" is the difference between a
      // fresh start and a loss.
      existing = {};
    }
  }
  let rows = 0;
  for (const [url, list] of Object.entries(perUrl)) {
    existing[url] = { ...(existing[url] ?? {}), [tool]: list };
    rows += 1;
  }
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
  return {
    rows,
    tools: new Set(Object.values(existing).flatMap((byTool) => Object.keys(byTool))).size,
  };
}
