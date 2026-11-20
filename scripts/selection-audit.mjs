// @code-analyzer — `node scripts/selection-audit.mjs <artifact.json>` reads one paid run twice: in sample and out.
//
// **A cut that was chosen by looking at a table needs a second table it was not chosen on.** The artifact carries every
// (finding, golden) verdict the run paid for, so the second table can be built from the first by leaving one pull
// request out at a time - which is what `lib/selection-audit.mjs` does, and this is the command that prints it.
//
// The output is deliberately two columns of the same three numbers. **The left column is what the campaign published;
// the right is what it would have published had it been forced to choose the knob without the row it was deciding
// about.** When the right column is lower, the difference is the size of the fitting, and no dispatch can remove it.

import { readFileSync } from 'node:fs';

import { applyCut, describeCut, score } from './lib/operating-point.mjs';
import { auditBudgets, auditCategories, verdictOf } from './lib/selection-audit.mjs';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: node scripts/selection-audit.mjs <aacr-bench.json> [--json]');
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(path, 'utf8'));
const findings = artifact['rankedFindings'];
const goldens = artifact['missedGoldens']['total'];
const creditOf = (finding) =>
  (finding['matchedGoldens'] ?? []).map((golden) => golden['index'] ?? golden);
const shippedSteps = artifact['emissionRules']['shipped']['steps'];
const shipped = score(applyCut(findings, shippedSteps), creditOf, goldens);

/** The shipped cut with its budget removed, so the budget audit prices only the cap. */
const withoutBudget = shippedSteps.filter((step) => step.kind !== 'budget');
/**
 * **The category audit starts from the shipped cut**, so its question is the one a campaign actually faces: *does
 * removing one more category, chosen on the corpus, survive out of sample?* A device that would have to undo a shipped
 * step to pay is not a candidate, because undoing `drop test` is a decision this document already priced and kept.
 */
/** The caps the artifact's own curve reports, plus a large one that a full emission is equivalent to. */
const budgets = [6, 8, 10, 12, 14, 16, 20, 24, 32];

const categories = auditCategories(findings, creditOf, goldens, shippedSteps);
const budgetAudit = auditBudgets(findings, creditOf, goldens, withoutBudget, budgets);
const verdict = verdictOf({ shipped, audited: categories, budgetAudited: budgetAudit });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ shipped, categories, budgetAudit, verdict }, null, 2));
  process.exit(0);
}

const row = (label, point, width = 34) =>
  `${label.padEnd(width)} ${String(point.emitted).padStart(4)} ${String(point.truePositives).padStart(3)} ` +
  `${point.precision.toFixed(3)} ${point.recall.toFixed(3)} ${point.f1.toFixed(4)}`;
const header = `${'cut'.padEnd(34)}    n  tp     P     R      F1`;

console.log(`artifact          ${path}`);
console.log(`shipped cut       ${describeCut(shippedSteps)}`);
console.log(header);
console.log(row('shipped (published)', shipped));

console.log('\ncategory removal, chosen in sample (the fitting that a table invites):');
for (const entry of [...categories.inSample].sort(
  (left, right) => right.point.f1 - left.point.f1,
)) {
  console.log(row(entry.category === '' ? 'drop nothing' : `drop ${entry.category}`, entry.point));
}

console.log('\ncategory removal, chosen with one pull request held out:');
console.log(row('held-out procedure', categories.heldOut));
console.log(
  `choices             ${[...categories.choices].map(([choice, n]) => `${choice === '' ? 'nothing' : choice}:${n}`).join(' ')}`,
);

console.log('\nbudget cap, chosen in sample:');
for (const entry of budgetAudit.inSample) console.log(row(`budget ${entry.k}`, entry.point));

console.log('\nbudget cap, chosen with one pull request held out:');
console.log(row('held-out procedure', budgetAudit.heldOut));
console.log(
  `choices             ${[...budgetAudit.choices].map(([k, n]) => `${k}:${n}`).join(' ')}`,
);

console.log('\nverdict');
console.log(
  `  category removal  held out ${verdict.categoriesHeldOutF1.toFixed(4)} against published ${verdict.shippedF1.toFixed(4)}: ` +
    `delta ${verdict.categoriesDelta >= 0 ? '+' : ''}${verdict.categoriesDelta.toFixed(4)}, ` +
    `noise band ${verdict.noiseBand.toFixed(4)} - ${verdict.categoriesEarned ? 'earned' : 'NOT earned'}`,
);
console.log(
  `  budget cap        held out ${verdict.budgetsHeldOutF1.toFixed(4)}: delta ${verdict.budgetsDelta >= 0 ? '+' : ''}${verdict.budgetsDelta.toFixed(4)}`,
);
