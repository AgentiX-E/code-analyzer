/**
 * **What the per-pull-request budget buys, in goldens and in characters, and where the buying stops paying.**
 *
 * §95.4 chose twelve findings per pull request by replaying four budgets and keeping the best F1. **That answered which
 * budget scores highest and said nothing about what the higher ones cost** - and a repository whose §96 frontier says
 * precision has to reach 0.55 at 173 matched goldens cannot afford to leave the cost axis unmeasured, because the next
 * arm is going to be paid for twice: once in model calls and once in tokens per pull request.
 *
 * **The measurement is a re-rank of a run that already happened.** `benchmarks/aacr-bench.json` carries every finding
 * the run emitted with its score and the goldens the judge accepted for it, so restricting each pull request to its top
 * *k* by score is free and re-computes precision, recall and F1 exactly. **The cost axis is the part that is modelled
 * rather than measured**: the artifact records no token counts, so the finding text is counted in characters and divided
 * by four. **That constant is a proxy, and it is applied to both sides of every ratio below**, so the shape of the curve
 * is the finding and the absolute numbers are an estimate labelled as one.
 *
 * **The one row this file refuses to overclaim.** The run that produced the artifact used a budget of sixteen
 * (`configuration.pullRequestBudget`), so **no cap above sixteen can be read as "a bigger budget"** - it is a re-rank of
 * the same emitted set, and the artifact's own configuration says so. The curve is published up to the run's own cap and
 * the saturation row is labelled.
 *
 * Usage:
 *   node scripts/budget-frontier.mjs            # print the table, write benchmarks/budget-frontier.json
 *   node scripts/budget-frontier.mjs --check    # recompute and compare to the committed artifact
 *   node scripts/budget-frontier.mjs --json     # print the artifact
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OURS = join(process.cwd(), 'benchmarks/aacr-bench.json');
const OUT = join(process.cwd(), 'benchmarks/budget-frontier.json');

/** **Characters per token, stated once.** Four is the usual English estimate and this file does not pretend it is better. */
const CHARS_PER_TOKEN = 4;

/** The budgets to score. **The run's own cap is the last one it is entitled to**, which is sixteen. */
const BUDGETS = [2, 4, 6, 8, 10, 12, 14, 16];

const round = (value) => Number(value.toFixed(4));

/**
 * **The four counts F1 is a function of, at one budget, over the whole run.**
 *
 * `matched` counts **distinct goldens**, because the protocol matches each golden at most once: two findings that quote
 * the same complaint are one true positive and one false one, and a count of findings would report a precision the
 * protocol never computes (§96.1 makes the same distinction for the same reason).
 */
export function buildFrontier(bench) {
  const corpusGoldens = bench.coverage.byPullRequest.reduce((sum, row) => sum + row.goldens, 0);
  const byPullRequest = new Map();
  for (const finding of bench.rankedFindings) {
    if (finding.actionable !== true) continue;
    const bucket = byPullRequest.get(finding.pr);
    if (bucket === undefined) byPullRequest.set(finding.pr, [finding]);
    else bucket.push(finding);
  }

  const rows = BUDGETS.map((budget) => {
    let kept = 0;
    let characters = 0;
    const matched = new Set();
    for (const [pr, findings] of byPullRequest) {
      const top = [...findings].sort((left, right) => right.score - left.score).slice(0, budget);
      for (const finding of top) {
        kept += 1;
        characters += finding.text.length;
        for (const golden of finding.matchedGoldens) matched.add(`${pr}#${golden}`);
      }
    }
    const precision = kept === 0 ? 0 : matched.size / kept;
    const recall = matched.size / corpusGoldens;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const tokens = characters / CHARS_PER_TOKEN;
    return {
      budget,
      kept,
      matched: matched.size,
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
      characters,
      /** **The modelled cost**, in tokens of finding text: the artifact records no usage. */
      tokens: round(tokens),
      goldensPerThousandTokens: tokens === 0 ? 0 : round((matched.size / tokens) * 1000),
      f1PerThousandTokens: tokens === 0 ? 0 : round((f1 / tokens) * 1000),
    };
  });

  /**
   * **What each extra budget buys, per thousand tokens it costs.** This is the column the decision is made on: F1 alone
   * rises, flattens and falls while the bill rises monotonically, so the budget to ship is the last one whose marginal
   * yield is still above a golden per thousand tokens.
   */
  for (let at = 1; at < rows.length; at += 1) {
    const row = rows[at];
    const before = rows[at - 1];
    const tokens = row.tokens - before.tokens;
    const goldens = row.matched - before.matched;
    row.marginal = {
      goldens,
      tokens: round(tokens),
      goldensPerThousandTokens: tokens <= 0 ? 0 : round((goldens / tokens) * 1000),
    };
  }
  rows[0].marginal = {
    goldens: rows[0].matched,
    tokens: rows[0].tokens,
    goldensPerThousandTokens: 0,
  };

  const bestF1 = rows.reduce((best, row) => (row.f1 > best.f1 ? row : best), rows[0]);
  const shipped = bench.configuration?.pullRequestBudget ?? null;
  /**
   * **The first budget that costs tokens and buys no golden at all.** It is the sharpest fact on this curve: past the
   * best-F1 budget the ranking's tail is almost pure noise, and a row that spends two thousand tokens for nothing is a
   * row a reader can check rather than an argument about diminishing returns.
   */
  const wasted = rows.find((row) => row.marginal.goldens === 0 && row.marginal.tokens > 0) ?? null;
  const last = rows[rows.length - 1];

  return {
    comment: [
      'What the per-pull-request budget buys in matched goldens, and what each extra finding costs in finding text.',
      'The tokens are characters/4 over the finding text, because the artifact records no usage: a proxy, applied to',
      'both sides of every ratio. Caps above the run config are not scored, because they would be a re-rank of the same',
      'emitted set rather than a larger budget.',
    ],
    measuredAt: String(bench.measuredAt ?? '').slice(0, 10) || 'unknown',
    source: 'benchmarks/aacr-bench.json',
    corpusGoldens,
    /** **The budget the artifact was produced with**, read rather than assumed: it bounds which rows are a measurement. */
    runBudget: shipped,
    rows,
    verdict: {
      bestF1Budget: bestF1.budget,
      bestF1: bestF1.f1,
      shippedBudget: shipped,
      /**
       * **Whether the run that produced the artifact used the budget this curve scores highest.** False is a finding
       * rather than a defect: the artifact was produced at sixteen, this curve's best is twelve, and §95.4 had already
       * moved the engine's constant - **so the row says which run the number is about.**
       */
      runBudgetSitsAtBestF1: shipped === bestF1.budget,
      firstBudgetThatBoughtNothing: wasted === null ? null : wasted.budget,
      /**
       * **Everything above the best budget, in one row**: how many more findings were kept, how many more goldens were
       * matched, and what the finding text for the difference cost. A tail that adds findings and no goldens is the
       * measured form of "the budget was already long enough".
       */
      aboveBest: {
        toBudget: last.budget,
        findingsAdded: last.kept - bestF1.kept,
        goldensAdded: last.matched - bestF1.matched,
        tokensAdded: round(last.tokens - bestF1.tokens),
        f1Change: round(last.f1 - bestF1.f1),
      },
    },
  };
}

function main(argv) {
  const bench = JSON.parse(readFileSync(OURS, 'utf8'));
  const artifact = buildFrontier(bench);

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    return 0;
  }

  if (argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify(committed) !== JSON.stringify(artifact)) {
      process.stderr.write(
        `${OUT} no longer equals what its source says. Re-run without --check.\n`,
      );
      return 1;
    }
    process.stdout.write('budget-frontier.json agrees with aacr-bench.json.\n');
    return 0;
  }

  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  const header = [
    'budget',
    'kept',
    'matched',
    'precision',
    'recall',
    'F1',
    'tokens',
    'goldens/1k',
    'marginal',
  ];
  process.stdout.write(`${header.map((cell) => cell.padStart(12)).join('')}\n`);
  for (const row of artifact.rows) {
    const cells = [
      row.budget,
      row.kept,
      row.matched,
      row.precision.toFixed(4),
      row.recall.toFixed(4),
      row.f1.toFixed(4),
      Math.round(row.tokens),
      row.goldensPerThousandTokens.toFixed(2),
      row.marginal.goldensPerThousandTokens.toFixed(2),
    ];
    process.stdout.write(`${cells.map((cell) => String(cell).padStart(12)).join('')}\n`);
  }
  const above = artifact.verdict.aboveBest;
  process.stdout.write(
    `\nbest F1 at ${artifact.verdict.bestF1Budget} (${artifact.verdict.bestF1.toFixed(4)}); budget ${String(artifact.verdict.firstBudgetThatBoughtNothing)} bought no golden; ` +
      `above the best, ${above.findingsAdded} more findings bought ${above.goldensAdded} goldens for ${Math.round(above.tokensAdded)} tokens\n`,
  );
  return 0;
}

// **Runs only when invoked**, so the test can import `buildFrontier` without printing a table.
if (process.argv[1] !== undefined && process.argv[1].endsWith('budget-frontier.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
