// @code-analyzer — the competitor's own report format and its own range runner, in one place for two boards

/**
 * **Two boards, one competitor, one copy of the code that reads it.**
 *
 * `open-code-review` is the reviewer behind the corpus AACR-Bench publishes, and it is one of the few reviewers in the
 * field that **accepts our endpoint** (`OCR_LLM_URL` / `OCR_LLM_TOKEN` / `OCR_LLM_MODEL`). That makes it the comparator
 * on both boards this repository publishes: **AACR**, where it is the incumbent, and **Martian**, where the same
 * question - *what does a competitor score when the model is ours?* - is the one neither board's leaderboard can answer,
 * because every published row was produced with the vendor's own model.
 *
 * **And the mechanism was written twice before this file existed.** The prose parser and the two-commit checkout lived
 * inside `.github/scripts/aacr-bench.mjs`; a Martian arm written beside it would have carried a second copy, and **a
 * harness with its own copy of a device measures the copy**. So both callers import this module and neither owns it.
 *
 * **What the tool does and does not offer, learned by running it rather than by reading its README**:
 *
 * - `scan --json` works; **`review --json` reports `unknown flag`**, so the range review - the one that answers "what
 *   changed in this pull request" - has **no machine-readable mode**, and its report is prose with a regular shape.
 * - `--from A --to B` needs **a merge base**. Two independent `--depth 1` fetches produce two root commits and no merge
 *   base, and the tool then reports `0 file(s) reviewed` with exit status 0 - **a success that read nothing**, which is
 *   why the checkout below is `--filter=blob:none` (every commit, no blobs) rather than shallow.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * **The three shapes the report is made of.** The separator uses U+2500 box-drawing characters, which is why it is
 * matched on the code point rather than on a dash - a hyphenated rule of the same length is a different string.
 *
 *      Review complete: 9 finding(s) across 35 selected item(s).
 *
 *      --- src/Mod/TechDraw/App/DrawViewPart.cpp:1299-1300 ---
 *      [bug . medium] `angle` is declared uninitialized and only assigned inside the two `if` branches. ...
 *      -     double angle;
 *      +     double angle = 0.0;
 */
export const REVIEW_SEPARATOR = /^\u2500{3}\s+(.+?):(\d+)-(\d+)\s+\u2500{3}$/;
export const REVIEW_TAG = /^\[([^\u00b7\]]+?)\s*\u00b7\s*([^\]]+?)\]\s*(.*)$/;
export const REVIEW_COUNT = /Review complete:\s*(\d+)\s+finding/i;

/**
 * **The report, read from a whole output rather than from a guess.**
 *
 * Four extraction strategies over a stream containing no JSON all failed before this parser existed, and the informative
 * failure was `Unexpected token 'R', "Review com"…` - the output is prose. Three shapes, one regular each: a header
 * carrying the tool's own count, a separator carrying the file and a line range, and a bracketed tag carrying a
 * category and a severity, followed by prose and sometimes a suggested diff.
 *
 * **The tool's own count is returned beside the parsed findings**, because **a parser that returns fewer findings than
 * the tool reported is indistinguishable from a tool that found fewer** - and the caller is the only place that
 * distinction can be recorded.
 */
export function parseProseReport(text) {
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
      // **A separator closes the previous finding**, so prose that spans lines is gathered rather than truncated to
      // its first line.
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
    // **A diff line is part of the finding**, and a blank line ends nothing - the next separator does.
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
 * **Split rather than matched.** A regular expression written for this ended its literal early on the `/` inside
 * `[^/]` (`SyntaxError: Unexpected token '^'`). A URL has a fixed shape and `split` states that shape without an
 * escape: `https://github.com/owner/repo/pull/123` is five `/`-separated pieces from the scheme onward.
 */
export function shortRepo(url) {
  const parts = String(url ?? '').split('/');
  const at = parts.indexOf('github.com');
  return at >= 0 && parts.length > at + 2 ? `${parts[at + 1]}/${parts[at + 2]}` : null;
}

/**
 * **A clone is per repository, and the corpus is why that is not a detail.**
 *
 * The Martian corpus is fifty pull requests over **seven** repositories: `calcom/cal.com` ten, `grafana/grafana` ten,
 * `keycloak/keycloak` nine, `getsentry/sentry` six, and three smaller trees. The first version of this runner cloned per
 * pull request, so a fifty-row arm paid fifty clones of trees that were already on disk - and a blobless clone of
 * `grafana/grafana` is not free: it is every commit and every tree in that history.
 *
 * **So the checkout is cached by `owner/repo`, and the count is published.** A warm directory still costs one `fetch` of
 * the two commits and one `checkout`, which are the steps that make the tree correct; what is saved is the history
 * download, which is the step that made a fifty-row arm look like it might not finish inside a job timeout.
 *
 * **`checkout -f` rather than `checkout`**: the directory outlives one review now, and a reviewer that leaves a tracked
 * file modified must not decide what the next review sees. Nothing here writes to the tree, so the flag is a guard
 * rather than a repair.
 */
const clones = new Map();
const uses = { clones: 0, reuses: 0 };

/** How many clones this process paid for, and how many reviews reused one. */
export function cloneStats() {
  return { ...uses, cached: clones.size };
}

/**
 * **Removes the cached checkouts.** A GitHub runner throws its disk away; a developer's machine does not, and a corpus
 * of seven histories left behind after a run is seven histories somebody has to find later.
 */
export function releaseClones() {
  for (const dir of clones.values()) rmSync(dir, { recursive: true, force: true });
  clones.clear();
}

/**
 * **The one place a working tree is produced**, so "which commit is checked out" has a single answer.
 *
 * A failure deletes the cached directory rather than leaving it: a directory that failed a checkout is a directory the
 * next review would trust, and re-cloning is cheaper than trusting it.
 */
function checkoutRange({ slug, source, target, cloneTimeoutMs, run }) {
  let dir = clones.get(slug);
  if (dir === undefined) {
    dir = mkdtempSync(join(tmpdir(), 'ocr-'));
    run(
      'git',
      ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${slug}.git`, dir],
      { stdio: 'pipe', timeout: cloneTimeoutMs },
    );
    clones.set(slug, dir);
    uses.clones += 1;
  } else {
    uses.reuses += 1;
  }
  try {
    run('git', ['-C', dir, 'fetch', '-q', 'origin', source, target], {
      stdio: 'pipe',
      timeout: cloneTimeoutMs / 3,
    });
    run('git', ['-C', dir, 'checkout', '-q', '-f', target], {
      stdio: 'pipe',
      timeout: cloneTimeoutMs / 3,
    });
  } catch (error) {
    clones.delete(slug);
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/**
 * **One pull request's range, reviewed by the competitor with our model, and the report kept whole.**
 *
 * The checkout is temporary and blobless: a corpus of fifty pull requests would otherwise pay for fifty full clones of
 * history nothing reads, and the two commits still share a merge base.
 *
 * **Every fallible step writes its reason into a field**, because `spawnSync ocr ENOENT` once arrived in a field named
 * `reason` and an empty string arrived in place of one - and an empty reason reads exactly like no reason.
 *
 * `outputDir`, when given, keeps the raw stdout on disk: the report has no machine-readable mode, so **the only way to
 * learn its shape on a later run is to have kept one whole.**
 */
export function reviewRange({
  url,
  repo,
  source,
  target,
  endpoint,
  key,
  model,
  outputDir = null,
  timeoutMs = 600_000,
  cloneTimeoutMs = 900_000,
  // **The commands are injectable, and that is what makes this file testable.** Two reviews of two pull requests in
  // one repository either share a clone or they do not, and the assertion is a count of `git clone` calls - the one
  // thing a test of this file could not observe while the runner was a module-level `execFileSync`.
  run = execFileSync,
}) {
  const slug = repo ?? shortRepo(url);
  if (!slug) return { ok: false, reason: 'the pull request URL did not name a repository' };
  if (!source || !target) return { ok: false, reason: 'the range needs two commits' };
  try {
    // **The directory is the working tree the review runs in**, so the cached one is what `cwd` must be: a reused clone
    // reviews at this pull request's target commit, not at the one the previous caller checked out.
    const dir = checkoutRange({ slug, source, target, cloneTimeoutMs, run });
    const env = { ...process.env, OCR_LLM_URL: endpoint ?? '', OCR_LLM_TOKEN: key ?? '' };
    if (model) env.OCR_LLM_MODEL = model;
    const stdout = run('ocr', ['review', '--from', source, '--to', target], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeoutMs,
      env,
    });
    let outputFile = null;
    if (outputDir) {
      mkdirSync(outputDir, { recursive: true });
      outputFile = join(outputDir, `open-code-review-review-${String(source).slice(0, 8)}.txt`);
      writeFileSync(outputFile, stdout);
    }
    const prose = parseProseReport(stdout);
    return {
      ok: true,
      stdout,
      outputFile,
      declaredCount: prose.declaredCount,
      findings: prose.findings,
    };
  } catch (error) {
    // **Both streams, because the reason can be in either.** A tool that explains itself on stderr and prints nothing
    // on stdout is the common case, and an earlier version read only the first of the two.
    const out = String(error.stdout ?? '').trim();
    const err = String(error.stderr ?? '').trim();
    const message = String(error.message ?? '').trim();
    return {
      ok: false,
      reason: (out || err || message || '').slice(0, 600),
      status: typeof error.status === 'number' ? error.status : null,
      signal: error.signal ?? null,
    };
  }
}
