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
const RESCORE = process.argv.indexOf('--rescore');
const FILTER = (process.argv.find((a) => a.startsWith('--filter=')) ?? '--filter=none').slice('--filter='.length);
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

/**
 * The candidate filters, each one a sentence about what a reader would accept.
 *
 * **They are named rather than parameterised**, because **a filter is a decision and a decision needs an argument** -
 * and **`none` is a filter too**, so **the unfiltered number is always available to compare against.**
 */
const FILTERS = {
  none: { describe: 'every finding the lanes produced', keep: () => true },
  bug: {
    describe: 'only findings the model called a bug',
    keep: (f) => String(f.category ?? '').toLowerCase() === 'bug',
  },
  ranged: {
    // **A finding with no usable range cannot overlap anything**, so keeping it can only add a false positive.
    describe: 'only findings with a range of at least one line',
    keep: (f) => Number.isFinite(f.startLine) && Number.isFinite(f.endLine) && f.endLine >= f.startLine,
  },
  high: {
    describe: 'only findings the model marked high or critical',
    keep: (f) => ['high', 'critical'].includes(String(f.severity ?? '').toLowerCase()),
  },
};

/** Scores a set of findings against the ground truth, by the same overlap rule the run used. */
function score(findings, totals) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const [filePath, ranges] of totals) {
    const here = findings.filter((f) => f.filePath === filePath);
    const hits = here.filter((f) => ranges.some((g) => f.startLine <= g.endLine && g.startLine <= f.endLine)).length;
    tp += Math.min(hits, ranges.length);
    fn += Math.max(0, ranges.length - hits);
    fp += Math.max(0, here.length - hits);
  }
  return { tp, fp, fn, ...prf(tp, fp, fn) };
}

/** Re-scores a stored artifact under every filter, without calling a model. */
function rescore(file) {
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  const findings = artifact.findings ?? [];
  if (findings.length === 0) {
    console.error('SEMANTIC-RESCORE: the artifact carries no findings, so there is nothing to re-score');
    process.exit(1);
  }
  // **The ground truth is re-read rather than stored**, because **it is a property of the dataset and not of the run**,
  // and **a stored copy could drift from the dataset it was scored against.**
  const dataset = JSON.parse(readFileSync(DATASET, 'utf8'));
  const totals = new Map();
  for (const issue of dataset.issues ?? []) {
    for (const g of issue.groundTruth ?? []) {
      const acc = totals.get(g.filePath) ?? [];
      acc.push(g);
      totals.set(g.filePath, acc);
    }
  }
  const rows = [];
  for (const [name, filter] of Object.entries(FILTERS)) {
    const kept = findings.filter(filter.keep);
    rows.push({ filter: name, describe: filter.describe, kept: kept.length, ...score(kept, totals) });
  }
  // **Sorted by F1, so the table reads as a ranking** and **the best filter is the first line**.
  rows.sort((a, b) => b.f1 - a.f1);
  for (const row of rows) {
    console.log(
      `SEMANTIC-RESCORE ${row.filter.padEnd(7)} kept=${String(row.kept).padStart(5)} f1=${String(row.f1).padEnd(7)} p=${String(row.precision).padEnd(7)} r=${String(row.recall).padEnd(7)} — ${row.describe}`,
    );
  }
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), 'benchmarks/semantic-rescore.json'),
    JSON.stringify(
      {
        comment: [
          'Every candidate filter, re-scored against the same stored findings and the same ground truth.',
          '',
          '**No model was called to produce this table.** Calling it is the expensive half, so the findings are kept',
          'and a filter becomes a re-score - which is what makes a direction cheap enough to test before committing',
          'to it, and what the measured-gap page argues for.',
        ],
        measuredAt: new Date().toISOString().slice(0, 10),
        where: 'github-actions',
        sourceFinding: findings.length,
        rows,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`SEMANTIC-RESCORE best=${rows[0].filter} f1=${rows[0].f1} over ${findings.length} stored findings`);
}

async function main() {
  if (RESCORE !== -1) {
    rescore(process.argv[RESCORE + 1]);
    return;
  }
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

  // **The engine and the diff builder are reached through the built packages**, so this measures what ships rather
  // than what a test imports - and **`createDiff` is the same function the heuristic harness uses**, which is what
  // makes the two figures comparable: *"how a window becomes a diff" has one implementation.*
  const { LLMReviewEngine } = await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } = await import('../../packages/intelligence/dist/review/llm/provider.js');
  const { createDiff } = await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  // **The gate the heuristic path already uses**, and the second lever the re-score's table named: **887 false
  // positives is five per window, and a finding whose quotation is not in the file it names cannot be checked.**
  const { judgeGrounding } = await import('../../packages/intelligence/dist/review/grounding-judge.js');

  // **The provider reads the key from the environment itself**, which is why it takes no argument here - and why
  // **no part of the key passes through this file.**
  const engine = new LLMReviewEngine(new DeepSeekProvider());

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let reviewed = 0;
  let failed = 0;
  let gatedOut = 0;
  let gateChecked = 0;
  // **Every finding, with the file it was about and the ground truth for that file**, so a re-score needs nothing
  // but this array.
  const allFindings = [];
  const truthsByFile = new Map();

  for (const issue of data.issues ?? []) {
    for (const file of issue.files ?? []) {
      // **The window IS the changed region**, the same construction the heuristic harness uses, so the diff is
      // `added` and the context is the file's own content.
      const diff = createDiff(file.filePath, 'added', file.beforeContent);
      const lanes = await engine.reviewDiff(diff, file.beforeContent);
      reviewed += 1;
      const ok = lanes.filter((l) => l.success);
      if (ok.length === 0) {
        // **A lane that failed is counted as a failure**, not as a clean review - the distinction that this whole
        // script exists to keep.
        failed += 1;
        continue;
      }
      const ranges = issue.groundTruth.filter((g) => g.filePath === file.filePath);
      const raw = ok.flatMap((l) => l.findings.map((f) => ({ filePath: l.filePath || file.filePath, ...f })));

      // **The gate, applied to the semantic path for the first time.** The window IS the file, so the quotation a
      // finding should carry is the text of the lines it points at - **and a finding whose range is wrong, or which
      // describes code that is not there, is dropped rather than counted.** **It can only remove**, which is the
      // point: **it is the one filter that is a fact rather than a preference.**
      const fileLines = file.beforeContent.split('\n');
      const asComments = raw.map((f, i) => ({
        id: `sem-${i}`,
        path: f.filePath,
        content: String(f.title ?? ''),
        existingCode: fileLines.slice(Math.max(0, (f.startLine ?? 1) - 1), f.endLine ?? f.startLine ?? 1).join('\n'),
        startLine: f.startLine ?? 1,
        endLine: f.endLine ?? f.startLine ?? 1,
        category: String(f.category ?? 'other'),
        severity: String(f.severity ?? 'info'),
        filtered: false,
        createdAt: new Date().toISOString(),
      }));
      // **And the gate as it was written removed nothing, which is the finding this round produced.** It checks that
      // a comment's quotation appears in the file it names - **and the quotation was taken from that file at the
      // range the comment itself gave**, so **a range that is merely wrong still passes.** **The check that would
      // catch it is whether the range lands on a line that could be the thing described**: an empty line, or a line
      // with no identifier characters in it, is not where a defect is.
      const nonEmpty = new Set();
      fileLines.forEach((l, i) => {
        if (/[A-Za-z0-9_]/.test(l)) nonEmpty.add(i + 1);
      });
      const plausible = raw.filter((_, i) => {
        const c = asComments[i];
        // **Every line of the range must at least look like code**, because **a finding whose range is blank is a
        // finding about nothing** - and **that is a fact about the file rather than a preference about the finding.**
        for (let ln = c.startLine; ln <= c.endLine; ln += 1) if (!nonEmpty.has(ln)) return false;
        return true;
      });
      const plausibleIds = new Set(plausible.map((_, i) => `sem-${i}`));
      const gate = judgeGrounding(asComments, { contents: new Map([[file.filePath, file.beforeContent]]) });
      const keptIds = new Set(gate.grounded.map((c) => c.id));
      const findings = raw.filter((_, i) => keptIds.has(`sem-${i}`) && plausibleIds.has(`sem-${i}`));
      gatedOut += raw.length - findings.length;
      gateChecked += raw.length;
      if (!truthsByFile.has(file.filePath)) truthsByFile.set(file.filePath, ranges);
      allFindings.push(
        ...findings.map((f) => ({
          filePath: f.filePath,
          startLine: f.startLine,
          endLine: f.endLine,
          category: f.category,
          severity: f.severity,
          title: String(f.title ?? '').slice(0, 120),
        })),
      );
      // **The same matching rule the heuristic benchmark uses**: a finding counts when its line range overlaps a
      // ground-truth range in the same file. **A different rule here would make the two figures incomparable**, which
      // is the one thing a comparison cannot afford.
      const hits = findings.filter((f) => ranges.some((g) => f.startLine <= g.endLine && g.startLine <= f.endLine)).length;
      tp += Math.min(hits, ranges.length);
      fn += Math.max(0, ranges.length - hits);
      fp += Math.max(0, findings.length - hits);
    }
  }

  const metrics = prf(tp, fp, fn);
  write(base, {
    ...base,
    issueCount: data.count,
    reviewedWindows: reviewed,
    failedLanes: failed,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    ...metrics,
    skipped: null,
    // **How many findings the gate removed, and out of how many**, because **a gate that removes everything and a
    // gate that removes nothing look the same in a score** and are different facts about the prompt.
    grounding: { checked: gateChecked, removed: gatedOut },
    // **The findings are kept, and that is the change this whole page argues for.** **Calling the model is the
    // expensive half and it cannot be repeated per candidate filter**, so **the output is stored** and **a filter
    // becomes a re-score**: `node measure-semantic-review.mjs --rescore benchmarks/semantic-review.json
    // --filter=category` runs in seconds and needs no credential at all.
    findings: allFindings,
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
