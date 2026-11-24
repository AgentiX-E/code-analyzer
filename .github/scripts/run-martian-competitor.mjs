// The competitor's reviewer, with our model, on the field's own fifty pull requests - the row no leaderboard can show.
//
// **Why this file exists.** Both boards this repository publishes compare it with reviewers whose published figures were
// produced with **their own vendor's model**. `docs/EVAL-CONTRACT.md` §6 registers the objection and has never been able
// to answer it: *"the competitor used this repository's own model"* was true of exactly one run, on one board, over five
// pull requests (§62). **On Martian the comparison has been ours-against-their-published-figure, and a published figure
// carries its vendor's model, its vendor's prompt and its vendor's route.**
//
// **What removes the confound.** `open-code-review` - the reviewer behind the corpus AACR-Bench publishes - accepts an
// OpenAI/Anthropic-compatible endpoint through `OCR_LLM_URL`/`OCR_LLM_TOKEN`/`OCR_LLM_MODEL`. So **it can review the
// same fifty diffs on the same DeepSeek endpoint the judge uses**, and **both arms can be scored by one judge in one
// job**. **A difference between the two rows is then a difference between two review systems given one model** - which
// is the only comparison this repository has been unable to make on this board.
//
// **And the boundary is exact, because it is the same boundary on both arms.** Their `step0_fork_prs` installs a bot
// account and lets each tool review at the time of the pull request. **This job has no bot account**, so the competitor
// reviews a checkout of the pull request's two commits with its own `review --from --to` interface - **the same input
// our engine sees (a diff), by a different route**, and every row records the route.
//
// **And nothing here judges anything.** The comments are written into their schema under a tool name of their own, and
// their `step2_5` and `step3` score them beside ours, with one prompt and one model.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  mergeCandidates,
  mergeReviews,
  pullCommits,
  readGolden,
} from '../../scripts/lib/martian-harness.mjs';
import { parseProseReport, reviewRange } from '../../scripts/lib/ocr-arm.mjs';

const SELF_CHECK = process.argv.includes('--self-check');

/**
 * **Where the field's harness was cloned, and it has to be said rather than guessed.** A default of `/tmp/martian` is a
 * fixed name in a directory every process can write to, so a local run would write into a checkout it did not make.
 */
const MARTIAN = process.env['MARTIAN_DIR'];
const GOLDEN = MARTIAN ? join(MARTIAN, 'offline', 'golden_comments') : null;
const OFFLINE = MARTIAN ? join(MARTIAN, 'offline') : null;
/** **A tool name of its own**, so their shipped row for the same reviewer - produced with its vendor's model - survives
 * beside it and neither can be mistaken for the other in a table. */
const TOOL = process.env['MARTIAN_TOOL'] ?? 'open-code-review-deepseek';
const TOKEN = process.env['GITHUB_TOKEN'] ?? '';
const ENDPOINT = process.env['OCR_LLM_URL'] ?? 'https://api.deepseek.com/anthropic';
const KEY = process.env['OCR_LLM_TOKEN'] ?? process.env['DEEPSEEK_API_KEY'] ?? '';
const MODEL = process.env['OCR_LLM_MODEL'] ?? process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const VERSION = process.env['OCR_VERSION'] ?? 'unknown';
const MAX_PRS = Number(process.env['MAX_PRS'] ?? '12');
const JUDGE_MODEL = process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';

/**
 * **The arithmetic and the merge, proved before the money.**
 *
 * A competitor arm costs a reviewer pass over fifty diffs and a judging pass over its comments against every golden; the
 * one thing that must not be discovered afterwards is that the merge dropped the field's rows or that the report parser
 * recovered fewer findings than the tool declared. Both are checkable with no network and no model, so they are checked
 * with none - the same rule `aacr-bench.mjs --dry-run` follows.
 */
function selfCheck() {
  // **The separator is three U+2500 box-drawing characters and not three hyphens** - the first draft of this fixture
  // wrote `---`, the parser recovered nothing, and the self-check failed on the fixture rather than on the parser.
  // Which is the point of a self-check that writes its own sample: **a fixture that agrees with a guess would have
  // licensed a parser that cannot read the tool.**
  const rule = '\u2500\u2500\u2500';
  const report = [
    'Review complete: 2 finding(s) across 3 selected item(s).',
    '',
    `${rule} src/a.ts:10-12 ${rule}`,
    '[bug · high] `value` is read before the guard that defines it.',
    '- const value = cache[key];',
    '+ const value = cache[key] ?? next();',
    '',
    `${rule} src/b.ts:4-4 ${rule}`,
    '[security · medium] The token is logged in full.',
  ].join(String.fromCharCode(10));
  const prose = parseProseReport(report);
  const problems = [];
  if (prose.declaredCount !== 2)
    problems.push(`declared count ${String(prose.declaredCount)} is not 2`);
  if (prose.findings.length !== 2)
    problems.push(`${String(prose.findings.length)} findings parsed, not 2`);
  if (prose.findings[0]?.path !== 'src/a.ts' || prose.findings[0]?.startLine !== 10)
    problems.push('the first finding lost its path or its range');
  if (prose.findings[0]?.category !== 'bug' || prose.findings[0]?.severity !== 'high')
    problems.push('the first finding lost its tag');
  if (!String(prose.findings[0]?.body ?? '').includes('+ const value'))
    problems.push('the first finding lost the suggested diff that follows it');

  // **The merge, on a file shaped like theirs**: two shipped tools and one row of ours.
  const existing = {
    'https://github.com/o/r/pull/1': {
      pr_title: 'a',
      golden_comments: [{ comment: 'g' }],
      reviews: [
        { tool: 'greptile', review_comments: [] },
        { tool: 'cubic', review_comments: [] },
      ],
    },
  };
  const rows = {
    'https://github.com/o/r/pull/1': {
      reviews: [{ tool: TOOL, review_comments: [{ path: 'a.ts', line: 1, body: 'x' }] }],
    },
  };
  const first = mergeReviews(structuredClone(existing), rows, TOOL);
  const second = mergeReviews(structuredClone(existing), rows, TOOL);
  if (first.toolsAfter !== 3)
    problems.push(`the merge produced ${String(first.toolsAfter)} tools, not 3`);
  if (second.toolsAfter !== 3) problems.push('the merge is not idempotent: a rerun added a tool');
  const kept = structuredClone(existing);
  mergeReviews(kept, rows, TOOL);
  const tools = (kept['https://github.com/o/r/pull/1']?.reviews ?? []).map((r) => r.tool);
  for (const tool of ['greptile', 'cubic'])
    if (!tools.includes(tool)) problems.push(`the merge dropped the shipped tool ${tool}`);
  if (kept['https://github.com/o/r/pull/1']?.golden_comments === undefined)
    problems.push('the merge dropped the golden comments');

  const candidatesPath = join(
    process.cwd(),
    'benchmarks',
    `.self-check-candidates-${String(process.pid)}.json`,
  );
  try {
    mkdirSync(dirname(candidatesPath), { recursive: true });
    writeFileSync(
      candidatesPath,
      JSON.stringify({ 'https://github.com/o/r/pull/1': { cubic: [] } }),
    );
    mergeCandidates(candidatesPath, { 'https://github.com/o/r/pull/1': [{ text: 't' }] }, TOOL);
    mergeCandidates(candidatesPath, { 'https://github.com/o/r/pull/1': [{ text: 't' }] }, TOOL);
    const merged = JSON.parse(readFileSync(candidatesPath, 'utf8'));
    const tools2 = Object.keys(merged['https://github.com/o/r/pull/1'] ?? {});
    if (tools2.length !== 2) problems.push(`candidates hold ${String(tools2.length)} tools, not 2`);
    if (tools2.includes(TOOL) && merged['https://github.com/o/r/pull/1'][TOOL].length !== 1)
      problems.push('the candidate merge is not idempotent');
  } finally {
    if (existsSync(candidatesPath)) writeFileSync(candidatesPath, '');
    execFileSync('rm', ['-f', candidatesPath]);
  }

  if (problems.length > 0) {
    console.error(`MARTIAN-COMPETITOR self-check failed: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('MARTIAN-COMPETITOR self-check: parser, merge and candidate merge all hold');
}

/** **The tokens the tool says it used**, read from its own summary line, because this arm is not in our ledger. */
function tokensOf(text) {
  let total = 0;
  for (const line of String(text).split(String.fromCharCode(10))) {
    const match = /~(\d+)\s+token/i.exec(line);
    if (match) total += Number(match[1]);
  }
  return total;
}

async function main() {
  if (SELF_CHECK) return selfCheck();
  if (!MARTIAN) {
    console.error(
      'MARTIAN-COMPETITOR needs MARTIAN_DIR: it writes into the field harness’s own checkout',
    );
    process.exit(1);
  }
  const prs = readGolden(GOLDEN);
  const base = {
    comment: [
      'A competitor’s reviewer, run by this repository, with this repository’s model, on the field’s own corpus.',
      '',
      '**The confound this removes**: every published row on this board was produced with its vendor’s model. This row',
      'was produced with the same `deepseek-chat` endpoint the judge uses, so a difference between it and ours is a',
      'difference between two review systems given one model.',
      '',
      '**The route, stated rather than implied**: their `step0_fork_prs` installs a bot account; this job has none,',
      'so the competitor reviews a checkout of each pull request’s two commits through its own `review --from --to`.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    tool: TOOL,
    competitor: 'open-code-review',
    version: VERSION,
    model: MODEL,
    endpoint: ENDPOINT,
    route: 'competitor-cli-reads-a-two-commit-checkout (no bot account installed)',
    judge: JUDGE_MODEL,
    prsInGolden: prs.length,
    prsAttempted: 0,
    prsScored: 0,
    findings: 0,
    declaredCount: 0,
    declaredCountAgrees: null,
    tokensUsed: 0,
    failures: [],
    firstFailure: null,
  };

  if (prs.length === 0) {
    write({ ...base, skipped: { reason: 'the golden comments were not found' } });
    console.log('MARTIAN-COMPETITOR skipped: no golden comments');
    return;
  }
  if (KEY === '') {
    write({
      ...base,
      skipped: {
        reason: 'no competitor credential is configured (OCR_LLM_TOKEN or DEEPSEEK_API_KEY)',
      },
    });
    console.log('MARTIAN-COMPETITOR skipped: no credential');
    return;
  }

  const rows = {};
  const candidates = {};
  for (const pr of prs.slice(0, MAX_PRS)) {
    const commits = await pullCommits(pr.url, TOKEN);
    if (commits === null) {
      base.failures.push({
        url: pr.url,
        reason: 'the pull request’s two commits could not be read',
      });
      continue;
    }
    base.prsAttempted += 1;
    const outcome = reviewRange({
      url: pr.url,
      source: commits.source,
      target: commits.target,
      endpoint: ENDPOINT,
      key: KEY,
      model: MODEL,
      outputDir: resolve(process.cwd(), 'benchmarks', 'runnable-competitors-outputs'),
    });
    if (!outcome.ok) {
      // **A failure carries a sentence, and the first one is kept apart from the rest**, because a run that fails for
      // fifty different reasons and a run that fails for one reason are different facts and a count cannot tell them
      // apart.
      const failure = { url: pr.url, reason: String(outcome.reason ?? '').trim() };
      base.failures.push(failure);
      if (base.firstFailure === null) base.firstFailure = failure;
      console.log(`MARTIAN-COMPETITOR ${pr.url} failed: ${failure.reason.slice(0, 200)}`);
      continue;
    }
    const findings = outcome.findings ?? [];
    base.tokensUsed += tokensOf(outcome.stdout ?? '');
    base.declaredCount += Number(outcome.declaredCount ?? 0);
    base.findings += findings.length;
    rows[pr.url] = {
      pr_title: pr.prTitle,
      original_url: pr.url,
      source_repo: pr.repo,
      golden_comments: pr.comments,
      reviews: [
        {
          tool: TOOL,
          pr_url: pr.url,
          review_comments: findings.map((f) => ({
            path: f.path,
            line: f.startLine,
            body: f.body.slice(0, 2000),
            category: f.category,
            severity: f.severity,
            created_at: new Date().toISOString(),
          })),
          candidates: findings.map((f) =>
            String(f.body.split(String.fromCharCode(10))[0] ?? '').slice(0, 300),
          ),
        },
      ],
    };
    candidates[pr.url] = findings
      .map((f) => ({
        text: String(f.body.split(String.fromCharCode(10))[0] ?? '').slice(0, 300),
        path: f.path,
        line: f.startLine,
        source: 'extracted',
      }))
      .filter((c) => c.text !== '');
    base.prsScored += 1;
    console.log(
      `MARTIAN-COMPETITOR ${pr.repo} ${pr.url} findings=${String(findings.length)} declared=${String(outcome.declaredCount)}`,
    );
  }

  // **Their file, merged rather than replaced** - the same rule both arms follow, because a write to a directory
  // somebody else owns is a merge or it is a deletion.
  const shippedPath = join(OFFLINE, 'results', 'benchmark_data.json');
  let existing = {};
  if (existsSync(shippedPath)) {
    try {
      existing = JSON.parse(readFileSync(shippedPath, 'utf8'));
    } catch {
      console.log(
        'MARTIAN-COMPETITOR warning: the shipped benchmark_data.json did not parse; only our rows are written',
      );
    }
  }
  const merge = mergeReviews(existing, rows, TOOL);
  mkdirSync(dirname(shippedPath), { recursive: true });
  writeFileSync(shippedPath, `${JSON.stringify(existing, null, 2)}\n`);

  const sanitized = JUDGE_MODEL.trim().replace(/\//g, '_');
  const modelDir = join(OFFLINE, 'results', sanitized);
  mkdirSync(modelDir, { recursive: true });
  const candidateMerge = mergeCandidates(join(modelDir, 'candidates.json'), candidates, TOOL);

  write({
    ...base,
    declaredCountAgrees:
      base.prsScored === 0 ? null : base.findings === base.declaredCount ? true : false,
    merge,
    candidates: candidateMerge,
    skipped: null,
  });
  console.log(
    `MARTIAN-COMPETITOR scored ${String(base.prsScored)} of ${String(base.prsAttempted)} attempted PRs · ` +
      `${String(base.findings)} comments · declared ${String(base.declaredCount)} · ` +
      `tools ${String(merge.toolsBefore)} -> ${String(merge.toolsAfter)} · ~${String(base.tokensUsed)} tokens`,
  );
}

function write(payload) {
  const out = resolve(process.cwd(), 'benchmarks', 'martian-competitor.json');
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error('MARTIAN-COMPETITOR failed:', error && error.message);
  process.exit(1);
});
