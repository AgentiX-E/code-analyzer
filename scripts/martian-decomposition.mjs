/**
 * Why the score is 27.57 and the leader's is 65.8, decomposed from the artifact on disk.
 *
 * **The question this answers is not "what is our F1" - `benchmarks/martian-bench.json` says that, and the number has
 * not moved for three iterations.** The question is *which of the five places the score could come from is the one it
 * comes from*, because the answer decides what to pay for next:
 *
 *   the pool        - the findings the engine produced, and whether the goldens are among them
 *   the ordering    - whether the pool's goldens can be floated to the top
 *   the budget      - how many of the ordered list are emitted
 *   the gate        - which categories are emitted at all
 *   the join        - whether a golden can be matched to a finding at all
 *
 * Every one of those is measurable from `rankedFindings` and `missedGoldens`, which the artifact already carries, and
 * **none of them requires a model call.** That is the point of writing this down: four iterations of paid dispatches
 * tuned the budget, and the budget turns out to be the smallest of the five terms.
 *
 * **This file does not re-open the ordering or the budget, and that is a decision with a citation.** §113 fitted an
 * ordering over the same eight features under leave-one-pull-request-out and got **0.2207 against the shipped
 * weights' 0.2234** - the fit is worse - and it read the budget as a curve that is monotone to 48 on that corpus.
 * Both directions are closed on evidence stronger than what is here. **What §132 needed was not a sixth cut but the
 * arithmetic of how much precision a cut cannot supply**, and that is what sections 6 to 8 print.
 *
 * Run with `--check` and it asserts the numbers `docs/EVAL-CONTRACT.md` §132 quotes, so a section that drifts from
 * the data fails a build rather than describing a corpus that no longer exists.
 */
import { readFileSync } from 'node:fs';

const ARTIFACT = 'benchmarks/martian-bench.json';
const data = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const findings = data.rankedFindings;
const GOLDENS = 173;

const SEVERITY_WEIGHT = { low: 0, medium: 0.33, high: 0.67, critical: 1, info: 0 };
const LANE_WEIGHT = {
  security: 1,
  performance: 0.9,
  architecture: 0.5,
  testing: 0.25,
  maintainability: 0.2,
};

/** The weights the engine ships, reproduced rather than imported so this file can price a counterfactual. */
const SHIPPED = {
  form: 0.3,
  form2: 0.2,
  form3: 0.14,
  form4: 0.08,
  agreement: 0.1,
  severity: 0.12,
  lane: 0.06,
  hedge: 0.1,
};
/**
 * The proportions fitted on this pool, kept only to price an **optimistic upper bound**.
 *
 * **This is not a candidate and must not be shipped as one.** The weights were chosen by a grid search over this very
 * corpus and then scored by holding out fold by fold, so the selection saw every pull request it is validated on -
 * which is the leak §113 caught in its own first attempt (+0.0239 that turned out to be the selection and not the
 * signal). What the numbers on this row are for is the opposite of a recommendation: **even the leaky fit reaches
 * 0.3613, and 0.3613 is not 0.658.**
 */
const REFIT = {
  form: 0.0833,
  form2: 0.0556,
  form3: 0.0389,
  form4: 0.0222,
  agreement: 0.2857,
  severity: 0.3429,
  lane: 0.1714,
  hedge: 0.05,
};

const byPull = new Map();
for (const finding of findings) {
  if (!byPull.has(finding.pr)) byPull.set(finding.pr, []);
  byPull.get(finding.pr).push(finding);
}
const pulls = [...byPull.keys()].sort();
const folds = Array.from({ length: 5 }, () => []);
pulls.forEach((pull, index) => folds[index % 5].push(pull));

function scorer(weights, saturation) {
  return (finding) => {
    const f = finding.features ?? {};
    let score = 0;
    if (f.grounded) score += weights.form;
    if (f.proposesChange) score += weights.form2;
    if (f.quotesDiff) score += weights.form3;
    if (f.namesSymbol) score += weights.form4;
    const lanes = Math.min(Math.log2(1 + (f.agreement ?? 1)), Math.log2(1 + saturation));
    score += weights.agreement * (lanes / Math.log2(1 + saturation));
    score += weights.severity * (SEVERITY_WEIGHT[finding.severity] ?? 0);
    score += weights.lane * (LANE_WEIGHT[finding.lane] ?? 0.5);
    if (f.hedged) score -= weights.hedge;
    return score;
  };
}

const shipped = scorer(SHIPPED, 3);
const refit = scorer(REFIT, 7);

const GATES = {
  none: () => true,
  'drop-test': (f) => f.category !== 'test',
  'bug-security': (f) => ['bug', 'security'].includes(f.category),
  'bug-sec-perf': (f) => ['bug', 'security', 'performance'].includes(f.category),
  'no-test-no-maint': (f) =>
    !['test', 'maintainability', 'style', 'documentation'].includes(f.category),
};

/**
 * Emit the top `budget` findings of every pull request in `subset` and score them.
 *
 * **True positives are unique goldens, and that is not a detail.** A finding carries the goldens it matched; four
 * findings can match one golden, and counting each of them reports a precision the artifact does not have - 0.215
 * where the committed figure is 0.174. The artifact's own `maximumMatchingCount` is the authority, and this
 * reproduces it by de-duplicating the golden index per pull request.
 */
function emit(scoreOf, gate, budget, subset) {
  let emitted = 0;
  let covered = 0;
  for (const pull of subset) {
    const ordered = byPull
      .get(pull)
      .filter(gate)
      .sort((a, b) => scoreOf(b) - scoreOf(a));
    const seen = new Set();
    for (const finding of ordered.slice(0, budget)) {
      emitted += 1;
      for (const golden of finding.matchedGoldens ?? []) seen.add(golden);
    }
    covered += seen.size;
  }
  const precision = emitted === 0 ? 0 : covered / emitted;
  const recall = covered / GOLDENS;
  return {
    emitted,
    covered,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

/** The same measurement with whole pull requests held out, which is what makes a chosen number a general one. */
function crossValidated(scoreOf, gate, budget) {
  let emitted = 0;
  let covered = 0;
  for (const fold of folds) {
    const part = emit(scoreOf, gate, budget, fold);
    emitted += part.emitted;
    covered += part.covered;
  }
  const precision = emitted === 0 ? 0 : covered / emitted;
  const recall = covered / GOLDENS;
  return {
    emitted,
    covered,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

const row = (label, s) =>
  `${label.padEnd(42)} k=${String(s.emitted).padStart(4)} TP=${String(s.covered).padStart(3)} ` +
  `P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)} F1=${s.f1.toFixed(4)}`;

// ---------------------------------------------------------------------------
// 1. The pool: what the engine produced, and how much of the answer key it holds
// ---------------------------------------------------------------------------

const uniqueGoldens = new Set();
for (const finding of findings)
  for (const g of finding.matchedGoldens ?? []) uniqueGoldens.add(`${finding.pr}#${g}`);

const poolCeiling = uniqueGoldens.size / GOLDENS;
const buckets = data.missedGoldens.counts;

// ---------------------------------------------------------------------------
// 2. Every point the ordering, the gate and the budget can reach
// ---------------------------------------------------------------------------

const reachable = [];
for (const [gateName, gate] of Object.entries(GATES)) {
  for (const [scoreName, scoreOf] of [
    ['shipped', shipped],
    ['refit', refit],
  ]) {
    for (let budget = 1; budget <= 16; budget += 1) {
      reachable.push({ gateName, scoreName, budget, ...crossValidated(scoreOf, gate, budget) });
    }
  }
}
reachable.sort((a, b) => b.f1 - a.f1);

// ---------------------------------------------------------------------------
// 3. What a verifier would have to do, holding true positives fixed
// ---------------------------------------------------------------------------

/** The shipped point, and the best point cutting can reach. */
const shippedPoint = crossValidated(shipped, GATES['drop-test'], 12);
const bestPoint = reachable[0];

/**
 * The precision a verifier must add, at a given recall, for F1 to reach a target.
 *
 * Solving `2PR/(P+R) = target` for P: `P = target·R / (2R - target)`. **Unreachable when the recall alone is below
 * half the target**, which is the arithmetic form of "no amount of precision saves a corpus you cannot cover".
 */
const precisionNeeded = (target, recall) => {
  const denominator = 2 * recall - target;
  if (denominator <= 0) return Infinity;
  return (target * recall) / denominator;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('=== 1. the pool, which no ordering can exceed ===');
console.log(`  findings ranked            ${String(findings.length).padStart(4)}`);
console.log(`  unique goldens covered     ${String(uniqueGoldens.size).padStart(4)} of ${GOLDENS}`);
console.log(
  `  pool recall ceiling        ${poolCeiling.toFixed(3)}  -> a perfect ordering scores ${((2 * poolCeiling) / (1 + poolCeiling)).toFixed(4)}`,
);
console.log(
  `  goldens we never produced  ${String(buckets['noPath'] ?? 0).padStart(4)}  (the dataset carries no path for them)`,
);

console.log('\n=== 2. the shipped point, reproduced ===');
console.log(row('shipped score / drop-test / b12', shippedPoint));
console.log(
  row('  artifact says', {
    emitted: 429,
    covered: 83,
    precision: 0.1935,
    recall: 0.4798,
    f1: 0.2757,
  }),
);

console.log(
  '\n=== 3. every reachable point, best first (the refit rows are optimistic: see REFIT) ===',
);
for (const point of reachable.slice(0, 10)) {
  console.log(row(`${point.scoreName} / ${point.gateName} / b${point.budget}`, point));
}

console.log('\n=== 4. the three factors, measured one at a time ===');
for (const [gateName, gate] of Object.entries(GATES)) {
  const pick = (scoreOf) => {
    let best = null;
    for (let budget = 1; budget <= 16; budget += 1) {
      const s = crossValidated(scoreOf, gate, budget);
      if (!best || s.f1 > best.s.f1) best = { budget, s };
    }
    return best;
  };
  const a = pick(shipped);
  const z = pick(refit);
  console.log(
    `  ${gateName.padEnd(17)} shipped b${String(a.budget).padStart(2)} F1=${a.s.f1.toFixed(4)}   ` +
      `refit b${String(z.budget).padStart(2)} F1=${z.s.f1.toFixed(4)}   weight effect ${z.s.f1 - a.s.f1 >= 0 ? '+' : ''}${(z.s.f1 - a.s.f1).toFixed(4)}`,
  );
}

console.log('\n=== 5. the budget alone, shipped score, drop-test gate ===');
for (const budget of [1, 2, 3, 4, 6, 8, 10, 12, 16]) {
  console.log(row(`  b${budget}`, crossValidated(shipped, GATES['drop-test'], budget)));
}

console.log('\n=== 6. the precision a verifier must add, by the recall it starts from ===');
console.log('  target F1 0.658 (Qodo Extended, Martian offline board)');
for (const recall of [0.324, 0.457, 0.566, 0.65, 0.7, 0.8, 0.9, 1.0]) {
  const needed = precisionNeeded(0.658, recall);
  console.log(
    `    at R=${recall.toFixed(3)}  required P = ${needed === Infinity ? 'unreachable' : needed.toFixed(3)}${needed > 1 ? '  (above 1.0, unreachable)' : ''}`,
  );
}

console.log('\n=== 7. what a verifier buys, when it is not held to a per-pull-request budget ===');
console.log(
  '  A verifier decides each candidate on its own, so the budget stops binding: recall returns to the pool',
);
console.log('  ceiling and the only free variable is how often the verifier is right.');
for (const precision of [0.5, 0.6, 0.7, 0.75, 0.786, 0.8, 0.85, 0.9]) {
  const f1 = (2 * precision * poolCeiling) / (precision + poolCeiling);
  const kept = uniqueGoldens.size / precision;
  console.log(
    `    verifier P=${precision.toFixed(3)}  emit ${kept.toFixed(0)}  R=${poolCeiling.toFixed(3)}  F1=${f1.toFixed(4)}${f1 >= 0.658 ? '  <-- beats the board leader' : ''}`,
  );
}

console.log('\n=== 8. verdict ===');
console.log(
  `  cutting moves the shipped ${shippedPoint.f1.toFixed(4)} to ${bestPoint.f1.toFixed(4)}: +${(bestPoint.f1 - shippedPoint.f1).toFixed(4)}`,
);
console.log(
  `  the pool caps F1 at ${((2 * poolCeiling) / (1 + poolCeiling)).toFixed(4)} with a perfect ordering, so ordering is not the binding constraint either.`,
);
console.log(
  `  at the pool's own ceiling of R=${poolCeiling.toFixed(3)}, F1 0.658 needs P=${precisionNeeded(0.658, poolCeiling).toFixed(3)}.`,
);
console.log(
  '  nothing in the ranked list reaches that: the next dollar goes to a verifier, not to a cut.',
);

if (process.argv.includes('--check')) {
  const expected = {
    'shipped point F1': [shippedPoint.f1, 0.2791],
    'best point F1': [bestPoint.f1, 0.3613],
    'best point gate': [bestPoint.gateName, 'bug-sec-perf'],
    'pool recall ceiling': [Number(poolCeiling.toFixed(3)), 0.566],
    'unproduced goldens': [buckets['noPath'], 75],
  };
  let failed = 0;
  for (const [label, [actual, want]] of Object.entries(expected)) {
    const ok = typeof want === 'number' ? Math.abs(actual - want) < 0.0006 : actual === want;
    if (!ok) {
      console.error(`MISMATCH ${label}: ${String(actual)} != ${String(want)}`);
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
  console.log('\n--check: every figure §132 quotes is what the artifact says.');
}
