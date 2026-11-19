// @code-analyzer/scripts — what F1 a filter could reach, computed from the artifacts rather than argued
//
// **Four selection devices have been measured on this corpus and all four came back null** (§93, §95). Each was
// explained on its own terms, and the explanations were compatible with a much simpler one that nobody had written down:
// **the findings a filter chooses between may not contain enough true claims to reach the figure the corpus was chosen
// to measure.** This script computes that, exactly, from the two artifacts already paid for, and it answers two
// questions a fifth device would otherwise be built without:
//
//   1. **What is the best F1 any filter could reach on the findings we generate?** The answer is an upper bound and it
//      does not depend on any filter being clever: keep only the findings that matched something and precision is 1.
//   2. **What does reaching 0.4500 require of precision and of matched goldens together?** `F1 = 2pTP/(pG+TP)` is one
//      equation in two unknowns, so it draws a frontier rather than naming a target - and the frontier says which of the
//      two is binding at the level we are at.
//
// **The second reader's rows are here for the same reason.** `benchmarks/aacr/competitor-baseline.json` holds a
// competitor's per-pull-request findings and the goldens the same judge accepted for them, recorded from runs that were
// already paid for. **Applying the same two formulas to their rows separates the two halves of the gap**: a generator
// that finds more goldens, and a selection rule that keeps fewer false findings. **A comparison of F1 alone cannot tell
// those apart, and they call for opposite work.**
//
// Usage:
//     node scripts/filter-ceiling.mjs                 # print the tables
//     node scripts/filter-ceiling.mjs --json          # the artifact, for a diff
//     node scripts/filter-ceiling.mjs --check         # recompute and compare to the committed artifact
//
// Nothing here calls a model, fetches a page or writes a figure it did not compute from a file on disk.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OURS = join(REPO, 'benchmarks', 'aacr-bench.json');
const THEIRS = join(REPO, 'benchmarks', 'aacr', 'competitor-baseline.json');
const OUT = join(REPO, 'benchmarks', 'filter-ceiling.json');

/** The competitor figure this repository registered against, read from the artifact rather than typed here. */
function registeredTarget(bench) {
  const rule = bench?.scoring?.registeredRule;
  const match = typeof rule === 'string' ? /([0-9]\.[0-9]{4}) F1/u.exec(rule) : null;
  return match === null ? 0.45 : Number(match[1]);
}

/**
 * **One reviewer's rows reduced to the counts the two-halves comparison needs, on one basis for both reviewers.**
 *
 * **`tp` is a count of distinct goldens, not of findings**, because that is the only basis both artifacts support: the
 * competitor's rows carry the goldens each finding matched and no finding-level verdict, so a comparison that counted
 * findings would be a comparison of two different quantities. **The difference is not small** - our run publishes
 * `truePositives: 85` (findings that matched something) beside `missedGoldens.counts.hit: 123` (goldens matched), and
 * the two are 0.1881 and 0.2721 of the corpus. Both are reported below; the ceiling and the competitor row use the
 * golden basis, and the figures the run published are carried verbatim so a reader can see where they differ.
 */
function counts(rows) {
  const matched = new Set();
  for (const row of rows) for (const golden of row.goldens) matched.add(`${row.pr}\u0000${golden}`);
  const rescued = rows.filter((row) => row.goldens.length > 0);
  const rescuedMatched = new Set();
  for (const row of rescued)
    for (const golden of row.goldens) rescuedMatched.add(`${row.pr}\u0000${golden}`);
  return {
    kept: rows.length,
    tp: matched.size,
    rescuedKept: rescued.length,
    rescuedTp: rescuedMatched.size,
  };
}

const f1 = (precision, recall) =>
  precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

/**
 * **The counts our own run publishes, read from the fields the run wrote rather than recomputed.**
 *
 * `rankedFindings` carries every finding the engine produced and the goldens it matched; `actionable` is the gate's
 * verdict, and `coverage.byPullRequest` carries the golden count per pull request. **The golden total has to come from
 * `coverage` rather than from the rows**, because a golden no finding matched appears in no row at all and a denominator
 * counted from the rows would be the number of goldens we happened to find.
 */
function readOurs(bench) {
  const prGoldens = new Map(bench.coverage.byPullRequest.map((row) => [row.pr, row.goldens]));
  const goldens = [...prGoldens.values()].reduce((sum, value) => sum + value, 0);
  const rows = bench.rankedFindings.map((finding) => ({
    pr: finding.pr,
    goldens: finding.matchedGoldens ?? [],
    kept: finding.actionable === true,
  }));
  const keptRows = rows.filter((row) => row.kept);
  const all = counts(rows);
  const gated = counts(keptRows);
  /**
   * **What the run published, carried rather than recomputed**, because the two bases differ and the difference is the
   * point: `truePositives` there counts *findings* that matched something, so its 85 is not the 123 goldens the run
   * hit, and a ceiling computed from 85 would be a ceiling on a different question.
   */
  const published = {
    kept: (bench.truePositives ?? 0) + (bench.falsePositives ?? 0),
    truePositives: bench.truePositives ?? 0,
    precision: bench.precision ?? 0,
    recall: bench.recall ?? 0,
    f1: bench.f1 ?? 0,
    goldensHit: bench.missedGoldens?.counts?.hit ?? 0,
  };
  return { goldens, prGoldens, rows, all, gated, published };
}

/** **The competitor's rows, in the same shape**: their `keep` array is aligned with their `matches` array. */
function readTheirs(baseline) {
  let goldens = 0;
  const rows = [];
  const prGoldens = new Map();
  for (const [pr, pull] of Object.entries(baseline.pulls)) {
    goldens += pull.goldens;
    prGoldens.set(pr, pull.goldens);
    pull.matches.forEach((matched, at) => {
      rows.push({ pr, goldens: matched, kept: pull.keep[at] === true });
    });
  }
  const all = counts(rows);
  const gated = counts(rows.filter((row) => row.kept));
  return { goldens, prGoldens, rows, all, gated };
}

/**
 * **The same reviewer restricted to a set of pull requests**, because the two artifacts were not run on the same slice:
 * ours read 50 pull requests and the competitor's rows cover 47, and **two rates computed over two corpora are two
 * measurements rather than a comparison.** Restricting both to the intersection is what makes the generator and
 * selection halves of the gap comparable at all - and the restriction is stated rather than implied, because a
 * subset's figures are free to be better than the whole's in either direction.
 */
function restrict(read, pullRequests) {
  const rows = read.rows.filter((row) => pullRequests.has(row.pr));
  let goldens = 0;
  for (const pr of pullRequests) goldens += read.prGoldens.get(pr) ?? 0;
  return { goldens, all: counts(rows), gated: counts(rows.filter((row) => row.kept)) };
}

/** **The four figures the protocol computes, plus the two a filter would reach.** */
function score({ goldens, all, gated }) {
  const precision = gated.kept === 0 ? 0 : gated.tp / gated.kept;
  const recall = gated.tp / goldens;
  return {
    goldens,
    kept: gated.kept,
    truePositives: gated.tp,
    precision,
    recall,
    f1: f1(precision, recall),
    generatorRecall: all.tp / goldens,
    generatorMatched: all.tp,
    /** Keep only the findings that matched something: precision is 1 by construction and recall is unchanged. */
    ceilingAtPerfectPrecision: f1(1, all.tp / goldens),
    /** The same set without the gift of perfect precision: the findings that matched, and the goldens they carried. */
    ceilingRescued: f1(all.rescuedTp / all.rescuedKept, all.rescuedTp / goldens),
    /** No filter can exceed this at the precision the run achieved, however many true claims it later generates. */
    asymptoteAtThisPrecision: (2 * precision) / (precision + 1),
  };
}

/**
 * **What reaching the target costs, as a frontier rather than a number.**
 *
 * `F1 = 2pTP/(pG+TP)` solved for `TP` gives `TP = F1·p·G/(2p − F1)`: **for every precision there is exactly one number
 * of matched goldens that reaches the target, and the number doubles as precision falls.** A row where the required
 * `TP` exceeds the corpus is not a hard target, it is an impossible one - **at precision below `F1/2` no recall reaches
 * the target at all**, which is the fact the fourth column states.
 */
function frontier(goldens, target) {
  // **`0.2` is on the grid because the floor is `target/2 = 0.225`**: a table that stops above the floor shows a
  // frontier that always has an answer, and the row that has none is the row that says precision is the binding term.
  const rows = [1, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2].map((precision) => {
    const exact = (target * precision * goldens) / (2 * precision - target);
    return {
      precision,
      requiredMatched: Number.isFinite(exact) && exact > 0 ? Math.ceil(exact) : null,
      reachable: Number.isFinite(exact) && exact > 0 && exact <= goldens,
    };
  });
  return { target, rows, floorPrecision: target / 2 };
}

const round = (value) => Number(value.toFixed(4));

/**
 * **The artifact, built from the two files rather than from the printed table.**
 *
 * Exported because a test has to read the same arithmetic the command prints: **a ceiling that only exists as the output
 * of a command is a ceiling asserted by pasting its output into a document**, which is the failure a `.d.mts` beside
 * `anchor-rate.mjs` was written to stop. The command below formats this value and nothing else.
 */
export function buildCeiling(bench, baseline) {
  const target = registeredTarget(bench);

  const read = readOurs(bench);
  const readTheir = readTheirs(baseline);
  const ours = score(read);
  const theirs = score(readTheir);
  /** **The intersection**, because a rate over 50 pull requests and a rate over 47 are two measurements, not a pair. */
  const shared = new Set([...read.prGoldens.keys()].filter((pr) => readTheir.prGoldens.has(pr)));
  const sharedOurs = score(restrict(read, shared));
  const sharedTheirs = score(restrict(readTheir, shared));
  const flat = (object) =>
    Object.fromEntries(
      Object.entries(object).map(([key, value]) => [
        key,
        typeof value === 'number' ? round(value) : value,
      ]),
    );

  return {
    comment: [
      'What a filter could reach on the findings two reviewers already produced, and what the target costs.',
      'The ceilings are upper bounds: they assume a filter that keeps exactly the findings that matched a golden, which',
      'no rule can do without the judge. A device that cannot reach the target inside its own ceiling is refuted before',
      'it is built, which is the reading four null devices needed and did not have.',
    ],
    measuredAt: String(bench.measuredAt ?? '').slice(0, 10) || 'unknown',
    sources: {
      ours: 'benchmarks/aacr-bench.json',
      theirs: 'benchmarks/aacr/competitor-baseline.json',
    },
    target,
    /** **The basis both reviewers can be compared on**: distinct goldens, so precision is goldens per kept finding. */
    ours: flat(ours),
    theirs: flat(theirs),
    /** **The basis our own run published**, where a true positive is a finding that matched something. */
    oursPublished: read.published,
    /** **Both reviewers on the pull requests they have in common**, and how many there are. */
    shared: {
      pullRequests: shared.size,
      ours: flat(sharedOurs),
      theirs: flat(sharedTheirs),
      /**
       * **The two swaps, because they are the sentence this section exists to support**: their precision on our recall,
       * and ours on theirs. **If either alone crosses the target then one half of the gap is enough**, and the whole
       * plan below would be one arm instead of two.
       */
      crossed: {
        theirPrecisionOnOurRecall: round(f1(sharedTheirs.precision, sharedOurs.generatorRecall)),
        ourPrecisionOnTheirRecall: round(f1(sharedOurs.precision, sharedTheirs.generatorRecall)),
      },
    },
    frontier: frontier(ours.goldens, target),
    /** **The one line a reader needs**: whether the target is inside this run's own ceiling. */
    verdict: {
      targetInsideOurCeiling: ours.ceilingAtPerfectPrecision >= target,
      targetInsideTheirCeiling: theirs.ceilingAtPerfectPrecision >= target,
      ourCeiling: round(ours.ceilingAtPerfectPrecision),
      theirCeiling: round(theirs.ceilingAtPerfectPrecision),
      ourGeneratorRecall: round(ours.generatorRecall),
      theirGeneratorRecall: round(theirs.generatorRecall),
      whatTheirPrecisionWouldBuyOnOurFindings: round(
        f1(theirs.precision, ours.generatorMatched / ours.goldens),
      ),
    },
  };
}

/** **The table as text**, so the printed run and the committed artifact cannot disagree about a digit. */
export function formatCeiling(artifact) {
  const { ours, theirs, target } = artifact;
  const table = [
    ['', 'ours', 'the competitor'],
    ['goldens', ours.goldens, theirs.goldens],
    ['kept', ours.kept, theirs.kept],
    ['true positives', ours.truePositives, theirs.truePositives],
    ['precision', ours.precision.toFixed(4), theirs.precision.toFixed(4)],
    ['recall', ours.recall.toFixed(4), theirs.recall.toFixed(4)],
    ['F1', ours.f1.toFixed(4), theirs.f1.toFixed(4)],
    ['generator recall', ours.generatorRecall.toFixed(4), theirs.generatorRecall.toFixed(4)],
    [
      'ceiling at perfect precision',
      ours.ceilingAtPerfectPrecision.toFixed(4),
      theirs.ceilingAtPerfectPrecision.toFixed(4),
    ],
    [
      'asymptote at this precision',
      ours.asymptoteAtThisPrecision.toFixed(4),
      theirs.asymptoteAtThisPrecision.toFixed(4),
    ],
  ];
  const lines = table.map((row) => row.map((cell) => String(cell).padStart(28)).join(''));
  lines.push('');
  lines.push(
    `target ${target.toFixed(4)} sits inside our ceiling: ${String(artifact.verdict.targetInsideOurCeiling)}`,
  );
  lines.push(
    `target ${target.toFixed(4)} sits inside their ceiling: ${String(artifact.verdict.targetInsideTheirCeiling)}`,
  );
  lines.push('');
  lines.push('matched goldens needed, by precision:');
  for (const row of artifact.frontier.rows) {
    lines.push(
      `  p=${row.precision.toFixed(2)}  ${row.requiredMatched === null ? 'unreachable' : `>${String(row.requiredMatched)}`}`,
    );
  }
  return lines.join('\n');
}

function main(argv) {
  const bench = JSON.parse(readFileSync(OURS, 'utf8'));
  const baseline = JSON.parse(readFileSync(THEIRS, 'utf8'));
  const artifact = buildCeiling(bench, baseline);

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    return 0;
  }

  if (argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify(committed) !== JSON.stringify(artifact)) {
      console.error(`${OUT} no longer equals what its sources say. Re-run without --check.`);
      return 1;
    }
    process.stdout.write('filter-ceiling.json agrees with both benchmark artifacts.\n');
    return 0;
  }

  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${formatCeiling(artifact)}\n\nwrote ${OUT}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exitCode = main(process.argv.slice(2));
}
