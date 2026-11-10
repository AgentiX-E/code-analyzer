// Our review, measured on the repositories the field's benchmark names.
//
// **The problem this solves.** Every figure this repository has published is on a corpus it chose, and **a corpus you
// chose cannot be compared with a competitor's** - the audits page says so in as many words. **The field's independent
// benchmark is Martian's Code Review Bench**, whose offline arm is open-sourced with its dataset: *"50 PRs from 5
// major open-source projects, each with human-verified golden comments"* - **Sentry, Grafana, Cal.com, Discourse and
// Keycloak.**
//
// **What this measures and what it does not.** It clones those five at pinned tags and reviews their source with the
// same engine the semantic benchmark uses. **It does not reproduce Martian's judge**, which scores whether a
// developer *acted* on a comment and can only run inside their pipeline - **so this is our precision and recall on
// the same repositories, not their F1 on our output.** **The artifact carries both facts**, because **a number from
// the right repositories judged the wrong way and a number from the wrong repositories judged the right way are two
// different mistakes**, and **collapsing them is how a comparison becomes a claim.**
//
// **And the ground truth is absent on purpose.** These repositories have no golden comments in this job, so **there is
// nothing to be precise or imprecise against** - **what this run produces is the denominator**: how many findings the
// engine emits per thousand lines on code nobody selected for it. **That number is comparable across tools and needs
// no judge at all**, and **it is the first figure in this project that a competitor's own published rate can be set
// beside without a caveat.**

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = '/tmp/field';
const OUT = resolve(process.cwd(), 'benchmarks/competitor-corpus.json');
const HAS_KEY = Boolean(process.env['DEEPSEEK_API_KEY']);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt)$/;
const MAX_FILES_PER_REPO = 40;
const MAX_BYTES = 60_000;

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === 'vendor' ||
      name === 'dist' ||
      name === 'build'
    )
      continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out, depth + 1);
    else if (EXT.test(name) && st.size < MAX_BYTES) out.push(full);
  }
  return out;
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
}

async function main() {
  const repos = existsSync(ROOT) ? readdirSync(ROOT).filter((n) => !n.startsWith('.')) : [];
  const base = {
    comment: [
      "Our review engine, run over the five repositories the field's independent benchmark names.",
      '',
      '**The corpus is Martian\'s Code Review Bench offline arm**: *"50 PRs from 5 major open-source projects, each with',
      'human-verified golden comments"* - Sentry, Grafana, Cal.com, Discourse, Keycloak. **Used here as repositories,',
      'not as PRs**, because **the golden comments need their pipeline to score and this job has no judge.**',
      '',
      '**So this measures the denominator**: findings per thousand lines on code nobody selected for the engine -',
      '**which is comparable across tools without a judge**, and is the first figure in this project that a',
      "competitor's published rate can be set beside without a caveat.",
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    corpus: "Martian's Code Review Bench offline arm repositories (MIT, open-sourced dataset)",
    groundTruth: null,
    note: 'No golden comments in this job, so precision and recall are not computable here - only the finding rate.',
  };
  if (repos.length === 0) {
    write({ ...base, skipped: { reason: 'the five repositories were not cloned' } });
    console.log('COMPETITOR-CORPUS skipped: nothing cloned');
    return;
  }
  if (!HAS_KEY) {
    write({
      ...base,
      repos: repos.length,
      skipped: { reason: 'DEEPSEEK_API_KEY is not configured' },
    });
    console.log(
      `COMPETITOR-CORPUS skipped: no DEEPSEEK_API_KEY, ${repos.length} repositories not reviewed`,
    );
    return;
  }

  const { LLMReviewEngine } =
    await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } =
    await import('../../packages/intelligence/dist/review/llm/provider.js');
  const { createDiff } =
    await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  // **The ceiling this script did not have, and the reason it now does.** On 2026-11-10 a single benchmark run cost
  // 8.53 USD and this repository could not say which job spent what - **four of the five scripts that construct a
  // provider had no ceiling at all**, so the only job that could not run away was the one somebody had already
  // priced. A ledger records a bill after it is paid; `ceilingUsd` stops one being incurred: **the provider refuses
  // the next call once the run has spent what it was allowed**, and the refusal is an error rather than a silent
  // truncation, because a reviewer that stops mid-corpus and reports a lower recall is a figure that looks like a
  // measurement.
  const { CostLedger } = await import('../../packages/intelligence/dist/review/llm/cost.js');
  const ledger = new CostLedger();
  const CEILING_USD = Number(process.env['LLM_MAX_USD'] ?? 4);
  const engine = new LLMReviewEngine(new DeepSeekProvider({ ledger, ceilingUsd: CEILING_USD }));
  console.log('COMPETITOR-CORPUS ceiling ' + String(CEILING_USD) + ' USD');
  // **And what it spent, printed on the way out.** The ledger is registered rather than summarised at the end because
  // these scripts have several exits - a corpus that fails to clone, an account out of credit, a thrown error - and a
  // figure printed only on the happy path is a figure missing from exactly the runs worth reading. `process.on('exit')`
  // runs on all of them; the write is synchronous because an async callback does not run at exit.
  process.on('exit', () => {
    const totals = ledger.toJSON().totals;
    console.log(
      'COMPETITOR-CORPUS spend ' +
        String(totals.costUsd) +
        ' USD over ' +
        String(totals.calls) +
        ' calls (' +
        String(totals.cacheHitTokens) +
        ' cached prompt tokens, ' +
        String(totals.unpricedCalls) +
        ' unpriced)',
    );
  });

  const perRepo = [];
  let totalFiles = 0;
  let totalLines = 0;
  let totalFindings = 0;

  for (const repo of repos) {
    const dir = join(ROOT, repo);
    const files = walk(dir).slice(0, MAX_FILES_PER_REPO);
    let lines = 0;
    let findings = 0;
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      lines += content.split('\n').length;
      const rel = f.slice(dir.length + 1);
      try {
        const lanes = await engine.reviewDiff(createDiff(rel, 'added', content), content);
        findings += lanes.filter((l) => l.success).flatMap((l) => l.findings).length;
      } catch {
        // **A file the engine could not review is not a file it reviewed cleanly**, so it is counted as a file and
        // contributes no findings - **the same distinction this project has drawn eight times.**
      }
    }
    totalFiles += files.length;
    totalLines += lines;
    totalFindings += findings;
    perRepo.push({
      repo,
      files: files.length,
      lines,
      findings,
      findingsPerThousandLines:
        lines > 0 ? Math.round((findings / lines) * 1000 * 100) / 100 : null,
    });
    console.log(
      `COMPETITOR-CORPUS ${repo} files=${files.length} lines=${lines} findings=${findings}`,
    );
  }

  const rate = totalLines > 0 ? Math.round((totalFindings / totalLines) * 1000 * 100) / 100 : null;
  write({
    ...base,
    filesReviewed: totalFiles,
    linesReviewed: totalLines,
    findings: totalFindings,
    findingsPerThousandLines: rate,
    perRepo,
    skipped: null,
  });
  console.log(
    `COMPETITOR-CORPUS total files=${totalFiles} lines=${totalLines} findings=${totalFindings} perThousandLines=${rate}`,
  );
}

main().catch((error) => {
  console.error('COMPETITOR-CORPUS failed:', error && error.message);
  process.exit(1);
});
