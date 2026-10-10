// The semantic review's figure, measured where a key can exist and reported honestly where it cannot.
//
// **Why this is a workflow and not a local script.** The heuristic path's figure is committed and reproducible; the
// semantic path's is not, because **it calls a model and a model needs a credential that must not be in the
// repository.** **The answer to "I cannot run it" is not a note - it is a job that runs it when the credential is
// there**, and **this is that job.** `DEEPSEEK_API_KEY` is read from the environment, **nothing is written to disk,
// and nothing is logged that could carry it.**
//
// **And when the key is absent the job still produces an artifact**, because **"no key" and "F1 0.00" are different
// answers** - the distinction this codebase has now had to draw in six places, and **the one that makes an unrun
// measurement impossible to mistake for a bad one.**

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATASET = resolve(process.cwd(), 'benchmarks/real-ground-truth/issues.json');
const OUT = resolve(process.cwd(), 'benchmarks/semantic-review.json');
const HAS_KEY = Boolean(process.env['DEEPSEEK_API_KEY']);

function pct(n) {
  return Math.round(n * 10000) / 10000;
}

function prf(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fn === 0 ? 1 : tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: pct(precision), recall: pct(recall), f1: pct(f1) };
}

async function main() {
  const base = {
    comment: [
      'The semantic review against the real ground-truth dataset, measured where a credential exists.',
      '',
      '**The heuristic path has a committed figure and this one does not**, because this one calls a model. **A job',
      'reports it whenever `DEEPSEEK_API_KEY` is configured, and reports a skip with its reason whenever it is not** -',
      'because **an unrun measurement and a zero must not look alike.**',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    criterion: 'overlap (file + line over overlap), the same one the heuristic figure uses',
  };

  if (!existsSync(DATASET)) {
    write(base, { ...base, skipped: { reason: 'no dataset extracted yet' } });
    console.log('SEMANTIC-REVIEW skipped: no dataset');
    return;
  }
  const data = JSON.parse(readFileSync(DATASET, 'utf8'));
  if (!HAS_KEY) {
    // **The skip is the result**, and it names what is missing rather than reporting a zero.
    write(base, { ...base, issueCount: data.count, skipped: { reason: 'DEEPSEEK_API_KEY is not configured' } });
    console.log(`SEMANTIC-REVIEW skipped: no DEEPSEEK_API_KEY, ${data.count} issues not reviewed`);
    return;
  }

  // **The engine is reached through the built package**, so this measures what ships rather than what a test imports.
  const { LLMReviewEngine } = await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } = await import('../../packages/intelligence/dist/review/llm/provider.js');

  const provider = new DeepSeekProvider({ apiKey: process.env['DEEPSEEK_API_KEY'] });
  const engine = new LLMReviewEngine(provider);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let reviewed = 0;

  for (const issue of data.issues ?? []) {
    for (const file of issue.files ?? []) {
      const findings = await engine.review(file.beforeContent, file.filePath);
      reviewed += 1;
      const ranges = issue.groundTruth.filter((g) => g.filePath === file.filePath);
      // **The same matching rule the heuristic benchmark uses**: a finding counts when its line range overlaps a
      // ground-truth range in the same file. **A different rule here would make the two figures incomparable**, which
      // is the one thing a comparison cannot afford.
      const hit = findings.some((f) => ranges.some((g) => f.startLine <= g.endLine && g.startLine <= f.endLine));
      if (hit && ranges.length > 0) tp += 1;
      else if (ranges.length > 0) fn += 1;
      else fp += 1;
    }
  }

  const metrics = prf(tp, fp, fn);
  write(base, {
    ...base,
    issueCount: data.count,
    reviewedWindows: reviewed,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    ...metrics,
    skipped: null,
  });
  console.log(
    `SEMANTIC-REVIEW f1=${metrics.f1} (p ${metrics.precision} r ${metrics.recall}) over ${reviewed} windows`,
  );
}

function write(base, payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
}

main().catch((error) => {
  // **A failure is reported as a failure**, not as a skip and not as a zero.
  console.error('SEMANTIC-REVIEW failed:', error && error.message);
  process.exit(1);
});
