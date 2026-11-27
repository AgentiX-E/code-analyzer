#!/usr/bin/env node
/**
 * **What the deterministic lane reaches, on the corpus's own answer key.**
 *
 * ```
 * node scripts/idiom-reach.mjs --corpus /tmp/aacr-bench/dataset/v1/positive_samples.json \
 *   --artifact benchmarks/aacr-bench.json --patches /tmp/patches --json benchmarks/idiom-reach.json
 * ```
 *
 * `§173.2` established that the AACR deficit is detection rather than ranking: no cut and no score term moves F1 by more
 * than the run's own resolution, and with no cut at all we credit 127 goldens against the competitor's 164. `§173.3`
 * located the deficit: `maintainability` recalls 20 of 191, `code defect` 65 of 209.
 *
 * **The maintainability goldens are the shapes a rule can read.** Of the notes on this slice, the largest families are
 * commented-out code, a parameter passed by value, a range-for variable copied, and a `TODO` left in the diff - every one
 * of them a statement about the changed text that needs no model to see. The repository already ships a deterministic
 * lane for exactly this kind of remark (`packages/intelligence/src/review/idiom-rules.ts`), and **the wide arm ran with
 * it off** (`AACR_IDIOMS=off`), so its reach has never been priced on this corpus.
 *
 * **This instrument prices it, and it prices an upper bound rather than a credit.** A credit on this board is an LLM
 * verdict on a (finding, golden) pair (`judgeMatrix`), and no arithmetic gets one for free. What arithmetic does get is
 * **reach**: whether the lane files a finding on the line a golden is about, on the same path. **A rule that does not
 * reach cannot credit, so reach is the ceiling** - and a ceiling of zero is a decision, which is what this is for.
 *
 * **Three refusals, because a reach figure is easy to overstate.**
 *
 *   1. **A pull request the corpus asked about and no diff was read for is counted as a hole**, not skipped - the same
 *      rule `§147.3` applies to a reviewer's silence and `§173.1` applies to a competitor's row.
 *   2. **The window is printed with the figure.** A golden's span is the range its author selected; `0` means the
 *      finding's line is inside it and `±3` means it is within three lines, and the two answer different questions.
 *   3. **Every rule is printed, including the ones that reach nothing.** A rule with no row is a rule nobody measured,
 *      and the whole point of the table is to show which of them earns its place on this corpus.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectIdioms, IDIOM_RULES } from '../packages/intelligence/dist/review/idiom-rules.js';
import { sideLinesByPath } from './lib/diff-side-lines.mjs';

/** The windows this instrument reports, in the order it prints them. `0` is inside the span the author selected. */
const WINDOWS = [0, 3];

function parseArgs(argv) {
  const options = {
    corpus: null,
    artifact: null,
    patches: null,
    json: null,
    label: null,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--artifact') options.artifact = argv[(i += 1)];
    else if (arg === '--patches') options.patches = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--label') options.label = argv[(i += 1)];
    else if (arg === '--limit') options.limit = Number(argv[(i += 1)]);
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (options.corpus === null) throw new Error('--corpus is required');
  return options;
}

/** `owner/repo#number` for a pull request URL, which is the name a cached patch is filed under. */
function patchName(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
  return m === null ? null : `${m[1]}__${m[2]}__${m[3]}.diff`;
}

/**
 * **The diff, from the cache or from the API.**
 *
 * The fetch is the harness's own (`accept: application/vnd.github.v3.diff`), so the text this instrument reads is the
 * text the run read. **A cached patch is never re-fetched and a failed fetch is never written**, because a cache that
 * stores an error turns one bad minute into a permanent figure.
 */
async function diffOf(url, directory) {
  const name = patchName(url);
  if (name === null)
    return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
  const cached = join(directory, name);
  if (existsSync(cached)) return { ok: true, diff: readFileSync(cached, 'utf8'), cached: true };
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  const [, owner, repo, number] = m;
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
        headers: {
          accept: 'application/vnd.github.v3.diff',
          'user-agent': 'agentix-e-idiom-reach',
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
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
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
 * **The goldens one lane's findings reach, per pull request, greedily and one apiece.**
 *
 * Greedy rather than maximum, and the difference matters: the board's protocol is a maximum bipartite matching over
 * judged pairs, and **this is a set of candidate pairs rather than a matching of them**. A finding that lands on two
 * goldens is credited to the first one this walk sees - which is why the figure is a ceiling and not a score, and why
 * the instrument prints the count of findings that touched more than one.
 */
function reachOf(findings, comments, window) {
  const touched = new Set();
  const perRule = new Map();
  /** **What each rule filed, whether or not it reached anything** - the other half of "a rule nobody measured". */
  const emitted = new Map();
  for (const finding of findings) {
    const key = String(finding.id ?? 'unknown');
    emitted.set(key, (emitted.get(key) ?? 0) + 1);
  }
  const shared = [];
  for (const finding of [...findings].sort((left, right) => left.startLine - right.startLine)) {
    const hits = [];
    comments.forEach((comment, index) => {
      if (comment.path !== finding.path) return;
      const span = spanOf(comment);
      if (finding.startLine < span.from - window || finding.startLine > span.to + window) return;
      hits.push(index);
    });
    if (hits.length === 0) continue;
    if (hits.length > 1)
      shared.push({ path: finding.path, line: finding.startLine, goldens: hits.length });
    const fresh = hits.filter((index) => !touched.has(index));
    const credit = fresh[0] ?? hits[0];
    if (!fresh.includes(credit)) continue;
    touched.add(credit);
    const key = String(finding.id ?? 'unknown');
    perRule.set(key, (perRule.get(key) ?? 0) + 1);
  }
  return { touched, perRule, emitted, shared };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
  const directory = options.patches ?? '/tmp/idiom-reach-patches';
  mkdirSync(directory, { recursive: true });

  const artifact =
    options.artifact === null ? null : JSON.parse(readFileSync(options.artifact, 'utf8'));
  /**
   * **The pull requests this pricing is about.** With an artifact, the slice that artifact scored; without one, the
   * corpus's own order, which is the only other honest answer. **A slice is never inferred from the goldens**, because a
   * pull request with no goldens is still a pull request the arm was asked about.
   */
  const slice =
    artifact === null
      ? corpus.map((row) => row.githubPrUrl)
      : (artifact.coverage?.byPullRequest ?? []).map((row) => row.pr);
  const asked = options.limit === null ? slice : slice.slice(0, options.limit);

  const rows = [];
  const holes = [];
  let findingsTotal = 0;
  let findingsOnSlice = 0;
  for (const [index, url] of asked.entries()) {
    const row = corpus.find((entry) => entry.githubPrUrl === url);
    if (row === undefined) {
      holes.push({ pr: url, reason: 'the corpus has no row for this pull request' });
      continue;
    }
    const diff = await diffOf(url, directory);
    if (!diff.ok) {
      holes.push({ pr: url, reason: diff.reason });
      continue;
    }
    const byPath = sideLinesByPath(diff.diff);
    const findings = [];
    for (const [path, file] of byPath) {
      if (file.added.length === 0) continue;
      const patch = file.lines
        .map((line) => (line.added ? `+${line.text}` : ` ${line.text}`))
        .join('\n');
      const produced = detectIdioms({
        path,
        addedLines: new Map(file.added.map((line) => [line.line, line.text])),
        patch,
      });
      for (const finding of produced) findings.push({ ...finding, path });
    }
    findingsTotal += findings.length;
    findingsOnSlice += 1;
    rows.push({ pr: url, comments: row.comments ?? [], findings, order: index });
    if (process.stderr.isTTY)
      process.stderr.write(
        `\r${String(index + 1)}/${String(asked.length)} ${url}${' '.repeat(20)}`,
      );
  }
  if (process.stderr.isTTY) process.stderr.write('\n');

  if (findingsOnSlice === 0) throw new Error('no diff could be read, so there is nothing to price');
  if (findingsTotal === 0)
    throw new Error('the lane filed nothing on this slice, so there is nothing to price');

  /** The goldens on the slice, by category, and the counts each window reaches. */
  const totals = new Map();
  const reached = new Map(WINDOWS.map((window) => [window, new Map()]));
  const ruleRows = new Map();
  const sharedByWindow = new Map(WINDOWS.map((window) => [window, 0]));
  for (const row of rows) {
    row.comments.forEach((comment) => {
      const category = String(comment.category ?? 'unknown');
      totals.set(category, (totals.get(category) ?? 0) + 1);
    });
    for (const window of WINDOWS) {
      const { touched, perRule, emitted, shared } = reachOf(row.findings, row.comments, window);
      sharedByWindow.set(window, sharedByWindow.get(window) + shared.length);
      row.comments.forEach((comment, index) => {
        if (!touched.has(index)) return;
        const category = String(comment.category ?? 'unknown');
        const bucket = reached.get(window);
        bucket.set(category, (bucket.get(category) ?? 0) + 1);
      });
      /**
       * **Two walks, because "what a rule filed" and "what it reached" are different sets.**
       *
       * The first version accumulated both from the reached rows, so **a rule that fired and reached nothing was absent
       * from the table entirely** - `todo-in-code` filed nothing on this slice and `parameter-by-value` filed one
       * finding that reached nothing, and both vanished. A table whose rows are the rules that succeeded is a table that
       * cannot say which rule is failing, which is the one thing it is for.
       */
      for (const [rule, count] of emitted) {
        const current = ruleRows.get(rule) ?? { rule, findings: 0, touched: new Map() };
        // **Added once, on the first window**, because a rule's emissions do not depend on the matching window and adding
        // them per window would multiply them by the number of windows this file reports.
        if (window === WINDOWS[0]) current.findings += count;
        ruleRows.set(rule, current);
      }
      for (const [rule, count] of perRule) {
        const current = ruleRows.get(rule) ?? { rule, findings: 0, touched: new Map() };
        current.touched.set(window, (current.touched.get(window) ?? 0) + count);
        ruleRows.set(rule, current);
      }
    }
  }

  const categories = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const goldenTotal = categories.reduce((count, [, value]) => count + value, 0);
  const summed = categories.reduce(
    (count, [category]) => count + (reached.get(0).get(category) ?? 0),
    0,
  );
  const unionRowCount = (() => {
    let count = 0;
    for (const row of rows) count += reachOf(row.findings, row.comments, 0).touched.size;
    return count;
  })();
  /**
   * **The decomposition has to add back up**, which is `§124`'s rule applied to a ceiling: a per-category table whose
   * rows sum to something other than the figure it decomposes is a table about a different set of rows.
   */
  if (summed !== unionRowCount) {
    throw new Error(
      `the categories sum to ${String(summed)} but the walk credited ${String(unionRowCount)} - ` +
        'these are not the same rows, and a table over them would be a table about a different run',
    );
  }

  const percent = (value, of) => (of === 0 ? '0.0000' : (value / of).toFixed(4));
  const lines = [
    `deterministic lane · ${String(asked.length)} pull requests asked · ${String(rows.length)} diffs read · ` +
      `${String(IDIOM_RULES.length)} rules${options.label === null ? '' : ` · ${options.label}`}`,
    `  findings ${String(findingsTotal)} · goldens ${String(goldenTotal)} on the slice`,
    `  reached ${String(unionRowCount)} of ${String(goldenTotal)} (${percent(unionRowCount, goldenTotal)}) ` +
      `of which ${String(reached.get(3).size === 0 ? 0 : [...reached.get(3).values()].reduce((a, b) => a + b, 0) - unionRowCount)} ` +
      'more within three lines',
    // **An upper bound, said once and in the figure's own line**, because the number is easy to read as a score.
    '  a credit on this board is an LLM verdict on a pair; this is the set of pairs a verdict could reach',
    '',
    'category                             goldens  reached   rate   reached(±3)   rate(±3)',
  ];
  for (const [category, goldens] of categories) {
    const exact = reached.get(0).get(category) ?? 0;
    const wide = reached.get(3).get(category) ?? 0;
    lines.push(
      `  ${category.padEnd(34)}${String(goldens).padStart(7)}${String(exact).padStart(9)}` +
        `${percent(exact, goldens).padStart(8)}${String(wide).padStart(13)}${percent(wide, goldens).padStart(11)}`,
    );
  }
  lines.push('');
  lines.push('rule                                findings  reached   rate');
  for (const rule of IDIOM_RULES) {
    const row = ruleRows.get(rule.id) ?? { rule: rule.id, findings: 0, touched: new Map() };
    const touched = row.touched.get(0) ?? 0;
    lines.push(
      `  ${rule.id.padEnd(34)}${String(row.findings).padStart(8)}${String(touched).padStart(9)}` +
        `${percent(touched, unionRowCount).padStart(8)}`,
    );
  }
  lines.push('');
  lines.push(
    `  ${String(sharedByWindow.get(0))} findings landed inside more than one golden's span, so the walk is a set of ` +
      'candidates rather than a matching',
  );
  if (holes.length > 0) {
    lines.push(
      `  and ${String(holes.length)} pull requests have no diff and are counted as holes, not skipped:`,
    );
    for (const hole of holes.slice(0, 5)) lines.push(`    ${hole.pr} - ${hole.reason}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);

  if (options.json !== null) {
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          version: 'idiom-reach-v1',
          source: options.label ?? options.artifact ?? options.corpus,
          asked: asked.length,
          read: rows.length,
          holes,
          rules: IDIOM_RULES.map((rule) => ({
            id: rule.id,
            languages: rule.languages,
            corpus: rule.corpus,
            findings: (ruleRows.get(rule.id) ?? { findings: 0 }).findings,
            reached: (ruleRows.get(rule.id) ?? { touched: new Map() }).touched.get(0) ?? 0,
          })),
          goldens: goldenTotal,
          reached: Object.fromEntries(
            WINDOWS.map((window) => [
              String(window),
              unionRowCount === 0
                ? 0
                : [...reached.get(window).values()].reduce((a, b) => a + b, 0),
            ]),
          ),
          byCategory: categories.map(([category, goldens]) => ({
            category,
            goldens,
            reached: reached.get(0).get(category) ?? 0,
            reachedWithin3: reached.get(3).get(category) ?? 0,
          })),
          sharedSpans: sharedByWindow.get(0),
        },
        null,
        2,
      )}\n`,
    );
  }
}

await main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 2;
});
