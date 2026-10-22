// Our reviews, written into the field's schema so the field's judge can score them.
//
// **What this is for.** The audits page once said Martian's judge "can only run inside their pipeline". **That was
// false**: the benchmark is MIT, it open-sources *the PRs, the golden comments, the judge prompts and the evaluation
// pipeline*, and its README ends its "Adding a new tool" section with *"the harness is public and you're welcome to
// run it and publish your own results."* **This script is the half of that job that belongs to us**: it produces our
// reviews in the `benchmark_data.json` shape the pipeline documents, and **the pipeline scores them.**
//
// **And the boundary is exact.** Their `step0_fork_prs` installs a bot account on GitHub and installs the tool on 50
// forked PRs - **which is how the other tools were run, and this job has no bot account to install.** **So our
// reviews come from the engine reading each PR's diff**, which is **the same input every other tool saw** (a reviewer
// sees a diff), and **the artifact says which route ours came by.** **A figure with its route attached can be
// questioned; a figure without one cannot.**
//
// **And nothing here judges anything.** The judge is theirs and runs in their code, in the next workflow step, with
// their prompts and their models. **This file only fills in the input**, which is **the one part of their pipeline
// that is about us rather than about them.**

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARTIAN = process.env['MARTIAN_DIR'] ?? '/tmp/martian';
const GOLDEN = join(MARTIAN, 'offline', 'golden_comments');
const OFFLINE = join(MARTIAN, 'offline');
const TOOL = process.env['MARTIAN_TOOL'] ?? 'agentix-e';
const HAS_KEY = Boolean(process.env['DEEPSEEK_API_KEY']);
const TOKEN = process.env['GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? '';
const MAX_PRS = Number(process.env['MAX_PRS'] ?? '6');

function readGolden() {
  if (!existsSync(GOLDEN)) return [];
  const out = [];
  for (const name of readdirSync(GOLDEN)) {
    if (!name.endsWith('.json')) continue;
    const repo = name.replace('.json', '');
    const entries = JSON.parse(readFileSync(join(GOLDEN, name), 'utf8'));
    for (const e of entries)
      out.push({ repo, prTitle: e.pr_title ?? '', url: e.url, comments: e.comments ?? [] });
  }
  return out;
}

/** The unified diff of a PR, through the API, because that is what a reviewer reads. */
async function fetchDiff(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  const [, owner, repo, num] = m;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
    headers: {
      accept: 'application/vnd.github.v3.diff',
      'user-agent': 'agentix-e-martian-harness',
      ...(TOKEN ? { authorization: `token ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) return null;
  return await res.text();
}

async function main() {
  const prs = readGolden();
  const base = {
    comment: [
      "Our review engine's output, in the schema Martian's pipeline documents, for their judge to score.",
      '',
      '**The route matters and is recorded**: their `step0_fork_prs` installs a bot account and a tool on 50 forked',
      "PRs. **This job has no bot account**, so **our reviews come from the engine reading each PR's diff** - the same",
      'input every other tool saw. **The profile and judge model are theirs and are recorded by their pipeline**, not',
      'by this file.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    tool: TOOL,
    martianDir: MARTIAN,
    route: 'engine-reads-diff (no bot account installed)',
    prsInGolden: prs.length,
    prsScored: 0,
  };

  if (prs.length === 0) {
    write({ ...base, skipped: { reason: 'the golden comments were not found' } });
    console.log('MARTIAN-HARNESS skipped: no golden comments');
    return;
  }
  if (!HAS_KEY) {
    write({ ...base, skipped: { reason: 'DEEPSEEK_API_KEY is not configured' } });
    console.log(`MARTIAN-HARNESS skipped: no DEEPSEEK_API_KEY, ${prs.length} PRs not reviewed`);
    return;
  }

  const { LLMReviewEngine } =
    await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } =
    await import('../../packages/intelligence/dist/review/llm/provider.js');
  const { createDiff } =
    await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  const engine = new LLMReviewEngine(new DeepSeekProvider());

  // **Their schema, filled in.** One entry per golden PR, with one review by this tool.
  const benchmark = {};
  let scored = 0;
  let noDiff = 0;

  for (const pr of prs.slice(0, MAX_PRS)) {
    const diff = await fetchDiff(pr.url);
    if (diff === null) {
      noDiff += 1;
      continue;
    }
    // **A candidate is an issue description**, which is what their step2 would have extracted from comments -
    // **and ours is the finding's own title**, because that is what our engine says about a diff.
    const lanes = await engine.reviewDiff(createDiff('PR.diff', 'added', diff), diff);
    const findings = lanes.filter((l) => l.success).flatMap((l) => l.findings);
    benchmark[pr.url] = {
      pr_title: pr.prTitle,
      original_url: pr.url,
      source_repo: pr.repo,
      golden_comments: pr.comments.map((c) => ({
        comment: c.comment,
        severity: c.severity,
        category: c.category,
      })),
      reviews: [
        {
          tool: TOOL,
          pr_url: pr.url,
          review_comments: findings.map((f) => ({
            path: 'unknown',
            line: f.startLine ?? 1,
            body: `${f.title ?? ''} :: ${f.description ?? ''}`.slice(0, 2000),
            created_at: new Date().toISOString(),
          })),
          candidates: findings.map((f) => String(f.title ?? '').slice(0, 300)).filter(Boolean),
        },
      ],
    };
    scored += 1;
    console.log(`MARTIAN-HARNESS ${pr.repo} ${pr.url} findings=${findings.length}`);
  }

  // **Their pipeline reads this path, and it already has content.**
  //
  // **The first version of this file wrote it whole, and that destroyed the field.** `results/benchmark_data.json`
  // ships with **every other tool's reviews for all 50 PRs**, and **replacing it with a file holding only ours** meant
  // the comparison job downstream saw **one tool** and reported a table with one row - **a job that looked like it ran
  // and measured nothing.** **A write to a directory somebody else owns is a merge or it is a deletion.**
  const resultsDir = join(OFFLINE, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const shippedPath = join(resultsDir, 'benchmark_data.json');
  let existing = {};
  if (existsSync(shippedPath)) {
    try {
      existing = JSON.parse(readFileSync(shippedPath, 'utf8'));
    } catch {
      // **A file that will not parse is reported rather than silently replaced**, because **the difference between
      // "there was nothing here" and "there was something here and it was unreadable" is the difference between a
      // fresh start and a loss.**
      console.log(
        'MARTIAN-HARNESS warning: the shipped benchmark_data.json did not parse, so only our reviews will be written',
      );
      existing = {};
    }
  }
  const shippedTools = new Set();
  for (const entry of Object.values(existing)) {
    for (const review of entry?.reviews ?? []) if (review?.tool) shippedTools.add(review.tool);
  }
  let merged = 0;
  for (const [url, entry] of Object.entries(benchmark)) {
    const target = existing[url];
    if (!target) {
      existing[url] = entry;
      continue;
    }
    // **Our review replaces any earlier one for the same tool, and nothing else is touched** - so **a rerun is
    // idempotent and a shipped tool is never dropped by a run that only knows about ours.**
    target.reviews = (target.reviews ?? []).filter((r) => r.tool !== TOOL);
    target.reviews.push(...(entry.reviews ?? []));
    // **The golden comments come from the shipped entry when it has them**, because **they are the ground truth and
    // a run of ours has no business rewriting it.**
    if (!target.golden_comments && entry.golden_comments)
      target.golden_comments = entry.golden_comments;
    merged += 1;
  }
  writeFileSync(shippedPath, JSON.stringify(existing, null, 2) + '\n');
  const nowTools = new Set();
  for (const entry of Object.values(existing)) {
    for (const review of entry?.reviews ?? []) if (review?.tool) nowTools.add(review.tool);
  }
  console.log(
    `MARTIAN-HARNESS merged our reviews into ${Object.keys(existing).length} PRs · tools before ${shippedTools.size} · after ${nowTools.size} · merged rows ${merged}`,
  );

  // **And `step3` reads a second file that `step2` would have written**, which is why running our own review instead
  // of theirs needs this too. **`step2_extract_comments` calls a model to turn a comment body into issue
  // statements** - and **our script already produced exactly that**, because a candidate is a finding's title.
  //
  // **So this is their schema filled in without a second model call**, and **the shape is theirs**:
  // `{ "<golden_url>": { "<tool>": [ { text, path, line, source } ] } }` at
  // `results/{sanitized_model}/candidates.json`, where **the model component is `MARTIAN_MODEL` with its slash
  // replaced**, which their `sanitize_model_name` does and this mirrors rather than guesses.
  const sanitized = (process.env['MARTIAN_MODEL'] ?? 'openai/gpt-4o-mini')
    .trim()
    .replace(/\//g, '_');
  const modelDir = join(OFFLINE, 'results', sanitized);
  mkdirSync(modelDir, { recursive: true });
  const candidates = {};
  for (const [url, entry] of Object.entries(benchmark)) {
    const findings = entry.reviews?.[0]?.candidates ?? [];
    candidates[url] = {
      [TOOL]: findings.map((text) => ({ text, path: null, line: null, source: 'extracted' })),
    };
  }
  writeFileSync(join(modelDir, 'candidates.json'), JSON.stringify(candidates, null, 2) + '\n');
  console.log(
    `MARTIAN-HARNESS wrote ${Object.keys(candidates).length} candidate sets to ${modelDir}/candidates.json`,
  );

  write({
    ...base,
    prsScored: scored,
    prsWithoutDiff: noDiff,
    totalFindings: Object.values(benchmark).reduce(
      (n, p) => n + (p.reviews?.[0]?.candidates?.length ?? 0),
      0,
    ),
    skipped: null,
  });
  console.log(
    `MARTIAN-HARNESS scored ${scored} PRs, ${noDiff} without a diff, written to their results/`,
  );
}

function write(payload) {
  const out = resolve(process.cwd(), 'benchmarks', 'martian-harness.json');
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
}

main().catch((error) => {
  console.error('MARTIAN-HARNESS failed:', error && error.message);
  process.exit(1);
});
