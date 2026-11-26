#!/usr/bin/env node
/**
 * **Whether a cut step is a device or a property of one corpus.**
 *
 * §162 priced the cut and found the deficit was not a threshold: at equal comments per pull request the competitor wins on
 * both axes, and above `k ≈ 5` the comparison stops being about selection at all. §162.6 then priced the cheapest ranking
 * device - a score floor - and refused it on the held-out half. **S48 asked the next question in the same direction:
 * change the ordering rather than the threshold.** This file answers it, and it answers a second question the first one
 * turned out to depend on, which is *which boards a device has to hold on before it may ship*.
 *
 * **Two devices are priced here and both are refused, and the refusals are different in kind**, which is why one
 * instrument reads both:
 *
 *   1. **A minimum-severity step.** On Martian's board, `low` severity carries **one credited golden in a hundred and
 *      eleven comments** (0.0090 against 0.2704 for `high`), so refusing to post them is free: coverage is unchanged and
 *      the emission shrinks, and because `F1 = 2·TP/(emitted + goldens)` charges for every comment posted, the figure
 *      rises. **On AACR's board the same tier carries 27 goldens in 95 comments**, so the same step removes twelve to
 *      sixteen credited goldens and F1 falls by up to 0.0305. The step is not a device; it is a fact about one corpus,
 *      and a policy built on it would be a policy fitted to an answer key.
 *   2. **A distinct-site step.** Two comments whose line ranges overlap are two comments about one place, and a budget
 *      spent twice on one place is a budget that bought one finding. On Martian this **loses** credited goldens at every
 *      budget above `k = 3`: `only-plain` `7` against `only-candidate` `2` at `k = 5`, and `12` against `1` at `k = 12`.
 *      A split-half read earlier in the campaign had accepted it (`+0.0274` on the held-out half at `k = 5`); the whole
 *      board refuses it, and **that is the methodological finding this file exists to keep**: a half is for choosing a
 *      parameter, not for accepting a device.
 *
 * **The acceptance rule is containment, not a delta, and it is stronger than the promotion rule's.** A cut step may
 * only ship when, at every budget this repository reports, on every board it publishes, **the set of credited goldens it
 * keeps is a superset of the incumbent's and its emission is smaller**. A step that satisfies that is better at every
 * denominator at once - no significance test is needed because nothing was traded - and a step that violates it has
 * traded a golden for silence, which no F1 gain on one board pays for. **A delta compared against a minimum detectable
 * effect asks *is this bigger than noise*; containment asks *what did it cost*, and only the second question survives
 * two boards that disagree.**
 *
 * Usage:
 *     node scripts/cut-candidates.mjs                      # every board, every candidate
 *     node scripts/cut-candidates.mjs --board aacr          # one board
 *     node scripts/cut-candidates.mjs --json benchmarks/cut-candidates.json
 *     node scripts/cut-candidates.mjs --check               # recompute and compare to the committed artifact
 *     node scripts/cut-candidates.mjs --root <dir>          # read a fixture tree instead of this repository
 *
 * Nothing here calls a model or reads a page: every figure is arithmetic over verdicts a run already paid for, so the
 * round it belongs to costs `¥0`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROFILES, profileMaps, restrictFindings } from './lib/corpus-profile.mjs';
import {
  applyCut,
  cutFromSteps,
  matchingByPullRequest,
  pullRequestOf,
  score,
  scoreOf,
} from './lib/operating-point.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = join(REPO, 'benchmarks', 'cut-candidates.json');

function parseArgs(argv) {
  const options = { boards: [], json: OUT, check: false, root: REPO };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--board') options.boards.push(argv[(i += 1)]);
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--check') options.check = true;
    else if (arg === '--no-json') options.json = null;
    // **A root, because a fixture tree is how the guards are tested.** The alternative was exporting every function for a
    // test to call, and an instrument tested by importing its parts is an instrument whose output has never been run.
    else if (arg === '--root') options.root = resolve(argv[(i += 1)]);
    else {
      process.stderr.write(`unknown argument ${JSON.stringify(arg)}\n`);
      process.exit(2);
    }
  }
  return options;
}

/**
 * **The boards a step has to hold on, named rather than discovered.**
 *
 * A board is an artifact plus the denominator it is scored against. **`profile` is part of the board and not a setting
 * of the run**: Martian publishes its bar on 158 of its 173 goldens, and a candidate priced on 173 answers a question
 * nobody ranks tools on. Both are here because a step that holds on one and fails on the other has told you which
 * denominator it was fitted to.
 */
const BOARDS = [
  {
    id: 'martian-wide-core',
    label: 'Martian · wide arm · core 158',
    artifact: 'benchmarks/martian-wide-bench.json',
    corpus: 'benchmarks/martian/positive_samples.json',
    profile: 'core',
    resolution: 0.0126,
  },
  {
    id: 'martian-wide-all',
    label: 'Martian · wide arm · all 173',
    artifact: 'benchmarks/martian-wide-bench.json',
    corpus: 'benchmarks/martian/positive_samples.json',
    profile: 'all',
    resolution: 0.0126,
  },
  {
    id: 'martian-narrow-core',
    label: 'Martian · shipped arm · core 158',
    artifact: 'benchmarks/martian-bench.json',
    corpus: 'benchmarks/martian/positive_samples.json',
    profile: 'core',
    resolution: 0.0126,
  },
  {
    id: 'martian-narrow-all',
    label: 'Martian · shipped arm · all 173',
    artifact: 'benchmarks/martian-bench.json',
    corpus: 'benchmarks/martian/positive_samples.json',
    profile: 'all',
    resolution: 0.0126,
  },
  {
    id: 'aacr',
    label: 'AACR-Bench · 452',
    artifact: 'benchmarks/aacr-bench.json',
    corpus: null,
    profile: 'all',
    /**
     * **The one board whose incumbent the artifact does not spell as steps.**
     *
     * AACR's artifact predates `emissionRules.shipped`; what it publishes is a *rule in prose* — `scoring.emissionRule`,
     * "the actionability gate: the range covers an added line AND (the suggestion names an action OR the finding quotes
     * added code)" — and the counts that rule produced: `387` comments, `85` credited goldens, `0.2026`. **The gate
     * rebuilds all three exactly**, so the incumbent is written here as the step that rule names, and the guard below
     * proves it is the published point rather than a reading of the sentence.
     */
    incumbent: [{ kind: 'gate' }],
    resolution: 0.0191,
  },
];

/**
 * **The candidate family, declared before it is measured, and small on purpose.**
 *
 * `emission-policy.ts` states the reason a step vocabulary is closed: *a rule language with more expressive power than
 * the campaign has hypotheses is a rule language that can fit the corpus*. **The same sentence governs the instrument
 * that prices a wider vocabulary** - a search over step shapes would find one that wins on some board, and the finding
 * would be about the search. Three shapes are registered here because each is a sentence a reviewer could say out loud:
 * *do not post what I called trivial*, *do not post the same thing twice*, *do not post what only one lane saw*.
 */
const CANDIDATES = [
  {
    id: 'severity:medium',
    label: 'drop severity below medium',
    steps: [{ kind: 'severity-min', tier: 'medium' }],
    note: 'a reviewer does not post what it called trivial',
  },
  {
    id: 'severity:high',
    label: 'drop severity below high',
    steps: [{ kind: 'severity-min', tier: 'high' }],
    note: 'the same sentence with the tier moved one step, as a control on where the line sits',
  },
  {
    id: 'distinct:overlap',
    label: 'one comment per overlapping range',
    steps: [{ kind: 'distinct' }],
    note: 'two comments on one line range are one comment said twice',
  },
  {
    id: 'agreement:2',
    label: 'drop findings only one lane saw',
    steps: [{ kind: 'agreement-min', n: 2 }],
    note: 'corroboration is the score term that says a defect was seen from two angles',
  },
  {
    id: 'severity:medium+distinct:overlap',
    label: 'both of the above',
    steps: [{ kind: 'severity-min', tier: 'medium' }, { kind: 'distinct' }],
    note: 'the pair §162.6 half-suggested, priced as one step rather than assumed to compose',
  },
];

/** The budgets every cell is read at, including both arms' own optima and the shipped 12. */
const BUDGETS = [4, 5, 12];

/** The severity order the product's weight table already implies. */
const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/**
 * **The candidate steps, applied to a pool the incumbent would emit from.**
 *
 * They are not `EmissionStep`s and are deliberately not added to the product's vocabulary: **a hypothesis is priced by
 * the instrument, and only an accepted one is spelled in the policy.** The order is the order the table lists them in,
 * and it matters for `distinct` alone, which is a walk down the ranked list rather than a predicate over it.
 */
function applyCandidate(findings, steps) {
  let kept = [...findings];
  for (const step of steps) {
    if (step.kind === 'severity-min') {
      const floor = SEVERITY_RANK[step.tier];
      kept = kept.filter(
        (finding) =>
          (SEVERITY_RANK[String(finding?.features?.severity ?? finding?.severity ?? '')] ?? 0) >=
          floor,
      );
    } else if (step.kind === 'agreement-min') {
      kept = kept.filter((finding) => Number(finding?.features?.agreement ?? 1) >= Number(step.n));
    } else if (step.kind === 'distinct') {
      // **Per pull request, in the rank order the budget will use**, so the comment a reader keeps is the one the
      // budget would have posted first. A range that overlaps one already kept is dropped, and the drop is a *loss of
      // emission* rather than a loss of coverage - which is the whole claim being tested.
      const byPullRequest = new Map();
      for (const [at, finding] of kept.entries()) {
        const key = pullRequestOf(finding);
        const bucket = byPullRequest.get(key);
        if (bucket === undefined) byPullRequest.set(key, [{ finding, at }]);
        else bucket.push({ finding, at });
      }
      const allowed = new Set();
      for (const bucket of byPullRequest.values()) {
        const ordered = bucket.sort(
          (left, right) => scoreOf(right.finding) - scoreOf(left.finding) || left.at - right.at,
        );
        const spans = [];
        for (const entry of ordered) {
          const from = Number(entry.finding?.startLine ?? 0);
          const to = Number(entry.finding?.endLine ?? from);
          const low = Math.min(from, to);
          const high = Math.max(from, to);
          if (spans.some(([start, end]) => !(high < start || low > end))) continue;
          spans.push([low, high]);
          allowed.add(entry.finding);
        }
      }
      kept = kept.filter((finding) => allowed.has(finding));
    } else {
      throw new Error(`unknown candidate step "${String(step.kind)}"`);
    }
  }
  return kept;
}

/** Which credited goldens a cut actually bought, keyed by pull request, as `(pr, golden)` pairs. */
function coverageOf(findings, creditOf) {
  const covered = new Set();
  for (const [pullRequest, matched] of matchingByPullRequest(findings, creditOf)) {
    for (const golden of matched.keys()) covered.add(`${pullRequest}\u0000${String(golden)}`);
  }
  return covered;
}

/**
 * **McNemar's exact test over the goldens the two cuts disagree about.**
 *
 * Printed beside a loss and never used to accept a device: the acceptance rule is containment, and a significance test
 * is what a *delta* needs. It is here because *how badly* a candidate loses is a fact worth recording, and a candidate
 * that loses twelve goldens and gains one is a different reading from one that loses two and gains two.
 */
function mcnemar(onlyIncumbent, onlyCandidate) {
  const discordant = onlyIncumbent + onlyCandidate;
  if (discordant === 0) return 1;
  const smaller = Math.min(onlyIncumbent, onlyCandidate);
  let tail = 0;
  let coefficient = 1;
  for (let index = 0; index <= smaller; index += 1) {
    if (index > 0) coefficient = (coefficient * (discordant - index + 1)) / index;
    tail += coefficient;
  }
  return Math.min(1, (2 * tail) / 2 ** discordant);
}

const options = parseArgs(process.argv.slice(2));
// **An id nobody recognises is refused even when the other ids matched**, because the alternative is a table that silently
// dropped a board a caller asked for - and a table is read as "these are the boards", not as "these are the boards whose
// names I got right".
const unknown = options.boards.filter((id) => !BOARDS.some((board) => board.id === id));
if (unknown.length > 0) {
  process.stderr.write(
    `no board matches ${unknown.join(', ')}; known boards are ${BOARDS.map((board) => board.id).join(', ')}\n`,
  );
  process.exit(2);
}
const boards = BOARDS.filter(
  (board) => options.boards.length === 0 || options.boards.includes(board.id),
);

const records = [];
const guards = [];

for (const board of boards) {
  const artifactPath = join(options.root, board.artifact);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const findings = artifact.rankedFindings ?? [];
  const shipped = artifact.emissionRules?.shipped ?? {};
  const steps = board.incumbent ?? shipped.steps ?? [];
  if (findings.length === 0) {
    process.stderr.write(`${board.artifact}: no rankedFindings, so there is no pool to cut\n`);
    process.exit(2);
  }
  if (cutFromSteps(steps) === null) {
    process.stderr.write(
      `${board.artifact}: the shipped cut carries a step this instrument cannot spell\n`,
    );
    process.exit(2);
  }

  // **Guard 1, the incumbent rebuilds.** Every cell below is a difference from the incumbent, so an incumbent that is
  // not the artifact's own published point would make the whole table a comparison with a cut nobody shipped.
  const fixed = steps.filter((step) => step?.kind !== 'budget');
  const shippedBudget = steps.find((step) => step?.kind === 'budget')?.k ?? null;
  const pool = applyCut(findings, fixed);
  const goldensOfArtifact =
    Number(artifact.truePositives ?? 0) + Number(artifact.falseNegatives ?? 0);
  if (shipped.point !== undefined && shippedBudget !== null) {
    const point = score(
      applyCut(pool, [{ kind: 'budget', k: shippedBudget }]),
      (finding) => (Array.isArray(finding.matchedGoldens) ? finding.matchedGoldens : []),
      goldensOfArtifact,
    );
    if (point.emitted !== shipped.point.k || point.truePositives !== shipped.point.truePositives) {
      process.stderr.write(
        `${board.artifact}: the incumbent rebuilds ${String(point.emitted)} comments / ${String(point.truePositives)} true positives and the artifact published ${String(shipped.point.k)} / ${String(shipped.point.truePositives)}\n`,
      );
      process.exit(1);
    }
    guards.push({
      board: board.id,
      guard: 'incumbent-rebuilds',
      expected: { emitted: shipped.point.k, truePositives: shipped.point.truePositives },
      rebuilt: { emitted: point.emitted, truePositives: point.truePositives },
    });
  } else {
    // **A board whose artifact recorded no budget publishes its counts for one cut, and that cut is the guard.** The
    // counts have to rebuild together - comments, credited goldens and the precision they imply - because a pool that
    // matched the comment count while crediting different goldens would still be a different reading of the record.
    const publishedEmitted =
      Number(artifact.truePositives ?? 0) + Number(artifact.falsePositives ?? 0);
    const publishedTruePositives = Number(artifact.truePositives ?? 0);
    const point = score(
      pool,
      (finding) => (Array.isArray(finding.matchedGoldens) ? finding.matchedGoldens : []),
      goldensOfArtifact,
    );
    if (point.emitted !== publishedEmitted || point.truePositives !== publishedTruePositives) {
      process.stderr.write(
        `${board.artifact}: the incumbent rebuilds ${String(point.emitted)} comments / ${String(point.truePositives)} true positives and the artifact published ${String(publishedEmitted)} / ${String(publishedTruePositives)}\n`,
      );
      process.exit(1);
    }
    guards.push({
      board: board.id,
      guard: 'incumbent-rebuilds',
      expected: { emitted: publishedEmitted, truePositives: publishedTruePositives },
      rebuilt: { emitted: point.emitted, truePositives: point.truePositives },
    });
  }

  // **Guard 2, the denominator is recomputed rather than trusted.** A profile is a rule over golden categories kept in
  // the corpus; the `all` profile still divides by the run's own pull requests rather than by every row the corpus holds.
  let scored = pool;
  let creditOf = (finding) => (Array.isArray(finding.matchedGoldens) ? finding.matchedGoldens : []);
  let denominator = goldensOfArtifact;
  if (board.profile !== 'all') {
    if (!(board.profile in PROFILES)) {
      process.stderr.write(
        `board ${board.id} names profile ${board.profile}, which is not registered\n`,
      );
      process.exit(2);
    }
    if (board.corpus === null) {
      process.stderr.write(`board ${board.id} asks for a profile but reads no corpus\n`);
      process.exit(2);
    }
    const corpus = JSON.parse(readFileSync(join(options.root, board.corpus), 'utf8'));
    const { maps } = profileMaps(corpus, board.profile);
    const pullRequests = new Set(scored.map(pullRequestOf));
    let counted = 0;
    for (const pullRequest of pullRequests) counted += maps.get(pullRequest)?.size ?? 0;
    scored = restrictFindings(scored, { maps });
    creditOf = (finding) => finding.profileGoldens ?? [];
    denominator = counted;
  }
  guards.push({ board: board.id, guard: 'denominator', value: denominator });

  const incumbentAt = (budget) => applyCut(scored, [{ kind: 'budget', k: budget }]);
  const cells = [];
  for (const budget of BUDGETS) {
    const incumbent = incumbentAt(budget);
    const incumbentPoint = score(incumbent, creditOf, denominator);
    const incumbentCoverage = coverageOf(incumbent, creditOf);
    if (incumbentCoverage.size !== incumbentPoint.truePositives) {
      process.stderr.write(
        `${board.id} k=${String(budget)}: the incumbent's coverage set holds ${String(incumbentCoverage.size)} goldens and its matching credited ${String(incumbentPoint.truePositives)}\n`,
      );
      process.exit(1);
    }
    for (const candidate of CANDIDATES) {
      const rows = applyCut(applyCandidate(scored, candidate.steps), [
        { kind: 'budget', k: budget },
      ]);
      const point = score(rows, creditOf, denominator);
      const coverage = coverageOf(rows, creditOf);
      // **Guard 3, the containment arithmetic and the matching are one computation.** A coverage set that disagrees with
      // the matching `score` used would make every "lost" figure below an artefact of the wrong arithmetic.
      if (coverage.size !== point.truePositives) {
        process.stderr.write(
          `${board.id} k=${String(budget)} ${candidate.id}: coverage holds ${String(coverage.size)} goldens and the matching credited ${String(point.truePositives)}\n`,
        );
        process.exit(1);
      }
      let lost = 0;
      for (const golden of incumbentCoverage) if (!coverage.has(golden)) lost += 1;
      let gained = 0;
      for (const golden of coverage) if (!incumbentCoverage.has(golden)) gained += 1;
      const verdict =
        lost > 0 ? 'loses' : point.emitted < incumbentPoint.emitted ? 'dominates' : 'neutral';
      cells.push({
        budget,
        candidate: candidate.id,
        incumbent: {
          emitted: incumbentPoint.emitted,
          truePositives: incumbentPoint.truePositives,
          f1: incumbentPoint.f1,
        },
        candidatePoint: {
          emitted: point.emitted,
          truePositives: point.truePositives,
          f1: point.f1,
        },
        coverage: { kept: coverage.size, lost, gained },
        deltaF1: point.f1 - incumbentPoint.f1,
        mcnemar: lost + gained === 0 ? null : mcnemar(lost, gained),
        verdict,
      });
    }
  }
  records.push({
    id: board.id,
    label: board.label,
    artifact: board.artifact,
    corpus: board.corpus,
    profile: board.profile,
    denominators: { goldens: denominator, pool: scored.length },
    resolution: board.resolution,
    shippedBudget,
    cells,
  });
}

/**
 * **The roll-up, which is the only part of this file that ships a judgement.**
 *
 * A candidate is `refused` the moment one cell has `lost > 0`, and `promotable` only when no cell loses and at least one
 * cell dominates. **`neutral` everywhere is neither**: a step that changes nothing is a step whose only cost is the code
 * that implements it.
 */
const missingResolution = records.filter((record) => typeof record.resolution !== 'number');
if (missingResolution.length > 0) {
  // **A board with no resolution cannot refuse anything**, so a missing one is a defect in this file rather than a
  // verdict about a candidate - the same class as a denominator nobody recomputed.
  process.stderr.write(
    `boards without a resolution: ${missingResolution.map((record) => record.id).join(', ')}\n`,
  );
  process.exit(2);
}

const verdicts = CANDIDATES.map((candidate) => {
  const cells = records.flatMap((record) =>
    record.cells
      .filter((cell) => cell.candidate === candidate.id)
      .map((cell) => ({ ...cell, board: record.id, resolution: record.resolution })),
  );
  const losing = cells.filter((cell) => cell.verdict === 'loses');
  const dominating = cells.filter((cell) => cell.verdict === 'dominates');
  const worst = losing.reduce(
    (lowest, cell) => (lowest === null || cell.deltaF1 < lowest.deltaF1 ? cell : lowest),
    null,
  );
  /** Every cell has to clear its own board's resolution, which is the board's and not the smallest of them. */
  const below = cells.filter((cell) => cell.deltaF1 < cell.resolution);
  const verdict =
    losing.length === 0
      ? dominating.length > 0
        ? 'promotable'
        : 'neutral'
      : below.length === 0
        ? 'trades'
        : 'refused';
  const reason =
    verdict === 'promotable'
      ? `no cell loses a golden and ${String(dominating.length)} of ${String(cells.length)} cells emit strictly less`
      : verdict === 'neutral'
        ? 'no cell changes the coverage or the emission'
        : verdict === 'trades'
          ? `every cell clears its board's resolution (${[...new Set(cells.map((cell) => String(cell.resolution)))].join(', ')}), so the goldens it loses are bought back`
          : `${String(losing.length)} of ${String(cells.length)} cells lose credited goldens` +
            (worst === null
              ? ''
              : `, worst ${worst.board} k=${String(worst.budget)} (${worst.deltaF1 >= 0 ? '+' : ''}${String(worst.deltaF1.toFixed(4))}, ` +
                `${String(worst.coverage.lost)} lost against ${String(worst.coverage.gained)} gained)`) +
            `, and ${String(below.length)} cells sit below their board's resolution`;
  return {
    candidate: candidate.id,
    label: candidate.label,
    note: candidate.note,
    verdict,
    reason,
    cells: {
      total: cells.length,
      losing: losing.length,
      dominating: dominating.length,
      belowResolution: below.length,
    },
  };
});

const record = {
  version: 'cut-candidates-v1',
  command: 'node scripts/cut-candidates.mjs',
  budgets: BUDGETS,
  boards: records,
  verdicts,
  guards,
};

process.stdout.write(
  `\ncut candidates · ${String(records.length)} boards · budgets ${BUDGETS.join(', ')}\n\n`,
);
for (const board of records) {
  process.stdout.write(
    `${board.label}  (goldens ${String(board.denominators.goldens)}, pool ${String(board.denominators.pool)})\n`,
  );
  process.stdout.write(
    `  ${'candidate'.padEnd(34)}${BUDGETS.map((budget) => `k=${String(budget)}: ΔF1 / lost`.padStart(22)).join('')}\n`,
  );
  for (const candidate of CANDIDATES) {
    const cells = board.cells.filter((cell) => cell.candidate === candidate.id);
    const text = cells
      .map((cell) => {
        // **The verdict is a mark and the delta carries its own sign**, because a first version prefixed a negative delta
        // with the same `-` the losing verdict used and printed `--0.0205`, which reads as a typo rather than as a loss.
        const mark = cell.verdict === 'loses' ? '-' : cell.verdict === 'dominates' ? '+' : '=';
        const delta = `${cell.deltaF1 >= 0 ? '+' : ''}${cell.deltaF1.toFixed(4)}`;
        return `${mark} ${delta}/${String(cell.coverage.lost)}`.padStart(22);
      })
      .join('');
    process.stdout.write(`  ${candidate.id.padEnd(34)}${text}\n`);
  }
  process.stdout.write('\n');
}
for (const verdict of verdicts) {
  process.stdout.write(
    `${verdict.verdict.toUpperCase().padEnd(12)}${verdict.candidate.padEnd(34)}${verdict.reason}\n`,
  );
}

if (options.json !== null) {
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (options.check) {
    const committed = readFileSync(options.json, 'utf8');
    if (committed !== text) {
      process.stderr.write(
        `${options.json} is not what this instrument reads now, so the committed figures are stale\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`\n${options.json} matches\n`);
  } else {
    writeFileSync(options.json, text);
    process.stdout.write(`\nwrote ${options.json}\n`);
  }
}
