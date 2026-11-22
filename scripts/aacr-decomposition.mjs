/**
 * The two boards, decomposed the same way, from artifacts already on disk.
 *
 * **Why this file exists.** The numbers that decide what to build next were spread over three places: Martian's
 * five-source split in `martian-decomposition.mjs` (§132), AACR's golden-basis ceiling in §96.1, and that ceiling's
 * correction to a matching basis in §116.4. **No file printed them side by side**, so a plan written from any one of
 * them could be - and was - a plan above the ceiling.
 *
 * **The correction that decides this file is §116.4's.** The scoring protocol credits a finding with at most one
 * golden, and the maximum matching over this pool is 103 pairs, not the 123 goldens the pool names. A perfect precision
 * therefore scores **0.3712**, not 0.4278. Any target above 0.3712 on this corpus is unreachable **by construction** -
 * not by ranking, not by a filter, not by a better prompt.
 *
 * **The two files are deliberately not one abstraction.** The Martian version carries fitted weights and a
 * leave-one-pull-request-out validation, because its question was whether re-ordering could pay. This corpus has no
 * weight grid to fit and its ordering question was answered by `emission-frontier.json`: every cut lands between 0.210
 * and 0.224. An abstraction over both would hide exactly that difference, which is the only thing here worth knowing.
 *
 * **One cardinality rule, stated once.** A pull request's findings are matched to its goldens by maximum bipartite
 * matching, so a finding can claim at most one golden - that is the basis the artifact headlines (`truePositives: 85`).
 * Section 3 uses the **golden base** instead, because it is the basis the buckets are cut on and the competitor's rows
 * support. The two differ by 19 goldens here. **A figure on one base may not be subtracted from a figure on the other**,
 * and §134 says so where it quotes these rows.
 *
 * Run with `--check` and it asserts the numbers `docs/EVAL-CONTRACT.md` §134 quotes.
 */
import { readFileSync } from 'node:fs';

const AACR = 'benchmarks/aacr-bench.json';
const MARTIAN = 'benchmarks/martian-bench.json';
const aacr = JSON.parse(readFileSync(AACR, 'utf8'));
const martian = JSON.parse(readFileSync(MARTIAN, 'utf8'));

const findings = aacr.rankedFindings;
const GOLDENS = aacr.truePositives + aacr.falseNegatives; // 452, the recall denominator
const PAIRS = 103; // §116.4: the maximum matching over this pool, which is the most the protocol can credit
const MARTIAN_PAIRS = 98; // the unique goldens the Martian pool reached; its artifact headlines 83 findings
const LEADER = { f1: 0.251, precision: 0.339, recall: 0.2 };

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const f1 = (p, r) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));

/** Distinct goldens any finding in `rows` touched, keyed by pull request so two repositories cannot collide. */
function distinctGoldens(rows) {
  const seen = new Set();
  for (const row of rows)
    for (const index of row.matchedGoldens) seen.add(`${row.pr}\u0000${index}`);
  return seen.size;
}

/** The emission a policy produces, ordered by the score the artifact recorded. */
function emit(rows, { drop = [], budget = null } = {}) {
  const perPull = new Map();
  const kept = [];
  for (const row of [...rows].sort((a, b) => b.score - a.score)) {
    if (drop.includes(row.category)) continue;
    if (budget !== null) {
      const used = perPull.get(row.pr) ?? 0;
      if (used >= budget) continue;
      perPull.set(row.pr, used + 1);
    }
    kept.push(row);
  }
  return kept;
}

const scored = (rows) => {
  const tp = distinctGoldens(rows);
  const precision = rows.length === 0 ? 0 : tp / rows.length;
  const recall = tp / GOLDENS;
  return { k: rows.length, tp, precision, recall, f1: f1(precision, recall) };
};

const table = (rows) =>
  `${String(rows.k).padStart(4)}  ${String(rows.tp).padStart(4)}  ${pct(rows.precision).padStart(8)}  ${pct(rows.recall).padStart(8)}  ${pct(rows.f1).padStart(8)}`;

const lines = [];
const log = (line = '') => lines.push(line);

// ---------------------------------------------------------------- 1. the two ceilings
const actionable = findings.filter((row) => row.actionable);
const poolGoldens = distinctGoldens(findings);
const goldenCeiling = poolGoldens / GOLDENS;
const matchingCeiling = PAIRS / GOLDENS;

log('=== 1. the pool, and the two ceilings a policy cannot cross ===');
log(`  findings the lanes wrote                     ${String(findings.length)}`);
log(`  of those the actionability gate kept          ${String(actionable.length)}`);
log(
  `  distinct goldens in the pool                  ${String(poolGoldens)} of ${String(GOLDENS)}  (golden basis)`,
);
log(
  `  ceiling at perfect precision, golden basis    ${pct(goldenCeiling)}  -> F1 ${pct(f1(1, goldenCeiling))}`,
);
log(
  `  ceiling at perfect precision, matching basis  ${pct(matchingCeiling)}  -> F1 ${pct(f1(1, matchingCeiling))}   <- the bound`,
);
log(
  '  published now                                k 387  TP 85  P 21.96%  R 18.81%  F1 20.26%  [matching basis]',
);
log('');
log(
  '  **Every target above 37.12% is unreachable by construction.** The protocol credits a finding with at most one',
);
log(
  '  golden, so 123 matched goldens yield at most 103 credited pairs - §116.4 measured that and corrected §96.1',
);
log(
  '  from 0.4278 to 0.3712. **A plan that read 0.4278 named 38-45%, and 38 is already over 37.12.** Neither',
);
log(
  '  section was wrong; the defect was that neither printed the other board beside it, so the subtraction was left',
);
log('  to whoever wrote the plan.');

// -------------------------------------------------------- 2. where the goldens went
const buckets = aacr.missedGoldens.counts;
const joinFixed = (buckets.hit + buckets.findingOnPathRejected) / GOLDENS;
const plusCoverage =
  (buckets.hit + buckets.findingOnPathRejected + buckets.fileNotReviewed) / GOLDENS;

log('');
log('=== 2. the four buckets, and what each is worth if it were closed ===');
log(
  `  hit                      ${String(buckets.hit).padStart(4)}  ${pct(buckets.hit / GOLDENS).padStart(8)}  a finding covered it`,
);
log(
  `  findingOnPathRejected    ${String(buckets.findingOnPathRejected).padStart(4)}  ${pct(buckets.findingOnPathRejected / GOLDENS).padStart(8)}  right path, not accepted as the same defect`,
);
log(
  `  fileNotReviewed          ${String(buckets.fileNotReviewed).padStart(4)}  ${pct(buckets.fileNotReviewed / GOLDENS).padStart(8)}  the run never read the file`,
);
log(
  `  noFindingOnPath          ${String(buckets.noFindingOnPath).padStart(4)}  ${pct(buckets.noFindingOnPath / GOLDENS).padStart(8)}  read, and nothing was written about it`,
);
log('');
log(
  `  if the join accepted them   R ${pct(joinFixed)}  (golden basis; the matching basis is lower by the same ratio)`,
);
log(`  and coverage read the rest  R ${pct(plusCoverage)}`);
log('');
log(
  '  **56% of this key is a join problem, not a generation problem.** 254 of 452 goldens had a finding standing on',
);
log(
  '  the right path and the harness did not accept it as the same defect. Martian is the mirror image: 75 of 173',
);
log(
  '  goldens were **never produced at all**, because the key carries no coordinates and the pool never reached them.',
);
log(
  '  **A matching device raises AACR; a recall device raises Martian.** One device for both is a plan about one board.',
);

// ------------------------------------------------------- 3. the emission is a plateau
log('');
log('=== 3. the emission, cut every way this pool allows (golden basis) ===');
log('     k    tp   precision    recall       F1');
log(table(scored(findings)));
log(table(scored(actionable)));
for (const budget of [4, 6, 8, 12, 16]) {
  log(table(scored(emit(actionable, { drop: ['test'], budget }))));
}
log('');
log(
  '  **Every row sits inside 0.21-0.28, and the ordering of rows is not the ordering of the field.**',
);
log(
  '  `emission-frontier.json` measured the same plateau at 0.210-0.224 on a later pool of 593 findings: two runs,',
);
log(
  '  two pools, same plateau. **Selection on this corpus is finished**, and this table is why no budget knob is on',
);
log('  the list of things to try.');

// ---------------------------------------------- 4. what a verifier would have to be
log('');
log('=== 4. the precision a verifier needs, by the recall it starts from (matching basis) ===');
const precisionNeeded = (target, recall) => {
  const denominator = 2 * recall - target;
  if (denominator <= 0) return null;
  const needed = (target * recall) / denominator;
  return needed > 1 ? null : needed;
};
for (const target of [LEADER.f1, 0.32, 0.37]) {
  log(`  target F1 ${pct(target)}${target === LEADER.f1 ? '  (the vendor-run leader)' : ''}`);
  for (const [label, recall] of [
    ['published', 0.1881],
    ['pool ceiling', matchingCeiling],
  ]) {
    const need = precisionNeeded(target, recall);
    log(
      `    at R=${pct(recall).padStart(6)} (${label})  required P = ${need === null ? 'unreachable' : pct(need)}`,
    );
  }
}
log('');
log(
  '  **Tying the leader needs 0.377 precision at the published recall and 0.279 at the pool ceiling.** Reaching 32%',
);
log(
  '  needs 0.507 at the ceiling; 37% needs 0.999, which is the ceiling itself. **So the AACR programme has two levers',
);
log(
  '  and no third**: raise the ceiling by making the join accept what already stands on the right path, or raise',
);
log(
  '  precision toward 0.38 to tie a vendor number. The first is worth more, and it is the one no other board needs.',
);

// ------------------------------------------------------ 5. the two boards, side by side
const shape = (artifact, goldens, pairs, name) => {
  const rows = artifact.rankedFindings;
  const pool = distinctGoldens(rows);
  return {
    name,
    findings: rows.length,
    poolCeiling: pool / goldens,
    perfectly: f1(1, pool / goldens),
    bound: f1(1, pairs / goldens),
    headline: artifact.f1,
  };
};
const boards = [
  shape(aacr, GOLDENS, PAIRS, 'AACR-Bench'),
  shape(martian, 173, MARTIAN_PAIRS, 'Martian offline'),
];

log('');
log('=== 5. the two boards, measured the same way ===');
log('  board              findings  pool ceiling  perfect-order F1  protocol bound  headline F1');
for (const board of boards) {
  log(
    `  ${board.name.padEnd(18)}${String(board.findings).padStart(6)}  ${pct(board.poolCeiling).padStart(12)}  ${pct(board.perfectly).padStart(16)}  ${pct(board.bound).padStart(14)}  ${pct(board.headline).padStart(11)}`,
  );
}
log('');
log(
  '  **The ceilings are six points apart and the bottlenecks are opposites.** Martian caps at 72.32% because its',
);
log(
  '  pool already holds 56.6% of the key and 43% of the goldens were never produced; AACR caps at 37.12% because',
);
log(
  '  its pool holds 27.2% and 56% of the key is a join the harness refuses. **A recall device buys Martian; a',
);
log('  matching device buys AACR.** Neither buys both, and the cost of finding that out was zero.');

// ---------------------------------------------------------------- the assertions
if (process.argv.includes('--check')) {
  const checks = [
    ['goldens', GOLDENS, 452],
    ['pool goldens', poolGoldens, 123],
    ['actionable', actionable.length, 387],
    ['golden-basis ceiling', Math.round(f1(1, goldenCeiling) * 10000) / 10000, 0.4278],
    ['matching-basis ceiling', Math.round(f1(1, matchingCeiling) * 10000) / 10000, 0.3712],
    ['findingOnPathRejected', buckets.findingOnPathRejected, 254],
    ['martian pool ceiling', Math.round(boards[1].poolCeiling * 10000) / 10000, 0.5665],
    ['martian perfect order', Math.round(boards[1].perfectly * 10000) / 10000, 0.7232],
  ];
  let failed = false;
  for (const [name, actual, expected] of checks) {
    if (String(actual) !== String(expected)) {
      console.error(`\n${name}: script says ${String(actual)}, §134 says ${String(expected)}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log('§134 and the artifacts agree on every number this file prints.');
} else {
  console.log(lines.join('\n'));
}
