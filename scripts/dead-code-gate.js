#!/usr/bin/env node
/**
 * Dead-code gate — story 10's floor, and its ratchet.
 *
 * **A dead-code tool can always raise its recall by claiming more**, so this gate holds two things at once: a floor under
 * the recall measured against an independent reader, and a **ceiling over the number of claims**. The figures in
 * `benchmarks/dead-code.json` may improve and may not drift upward by adding noise.
 *
 * **Every row is checked, not the total.** A corpus that lost its call graph, or a run where the competitor failed to
 * install, would otherwise be averaged away by a healthy corpus beside it — the failure mode the call-graph gate was
 * written against after a checkout with 174 files produced zero edges and the summary still looked fine.
 *
 * **Every language is checked, too.** `vulture` covers Python's two questions; nothing covers TypeScript's, so the
 * TypeScript half is scored against `scripts/deadcode-oracle-ts.mjs`. A gate that only held the Python half would pass on
 * a product whose TypeScript report said a library has no API.
 *
 * Three rules are specific to this feature:
 *
 *   1. **Hand-verified findings must still be there.** `VERIFIED` lists symbols a human read the source for. The oracle
 *      is mechanical and cannot see a shadowed duplicate (`_make_timedelta` is defined twice in flask, and only the copy
 *      in `sansio/app.py` is called), so the ground truth for those is the source and the gate asserts it survives.
 *   2. **A pristine library must produce nothing.** `zod` re-exports every name it declares; a report that finds dead code
 *      in it is reporting its own resolution.
 *   3. **The assertion load must be smaller than the competitor's, by an order of magnitude.** That is the whole claim:
 *      same recall, a fraction of the noise.
 *
 * Usage:  node scripts/dead-code-gate.js [benchmarks/dead-code.json] [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ARTIFACT = 'benchmarks/dead-code.json';

/**
 * Floors per corpus. `findings` is a **ceiling**: the corpus may report fewer, never more.
 *
 * The numbers are the measured figures of the run that added the virtual-dispatch slots, the unresolved-mention edge and
 * the entry-aware published surface, so a change that makes the analysis noisier fails here rather than in a reader's
 * trust.
 */
const FLOORS = {
  'pallets/flask': { findings: 3, recall: 1, confirmed: 2 },
  'pallets/werkzeug': { findings: 4, recall: 1, confirmed: 2 },
  // **Nothing.** `zod` publishes every name it declares through `src/index.ts`, so a finding here is a finding about
  // this product's resolution rather than about zod.
  'colinhacks/zod': { findings: 0, recall: null, confirmed: 0 },
  'redis/ioredis': { findings: 2, recall: null, confirmed: 0 },
};

/**
 * Symbols a human read the source for, and which the gate requires the product to keep reporting.
 *
 * `_path_is_ancestor` is also what the oracle finds, so it is the intersection both readers agree on.
 * `_make_timedelta` is the one **no competitor reports and no oracle can see**: it is defined twice in flask, and the
 * corpus only calls the copy in `sansio/app.py`, so a reader that keys on the *name* — vulture does, and so does the
 * oracle — has to conclude that the name is used. It is the case for a report that resolves per declaration.
 */
const VERIFIED = {
  'pallets/flask': ['src/flask/cli.py::_path_is_ancestor', 'src/flask/app.py::_make_timedelta'],
  'pallets/werkzeug': [
    'src/werkzeug/routing/rules.py::_find',
    'src/werkzeug/routing/rules.py::_encode_query_vars',
  ],
  'colinhacks/zod': [],
  'redis/ioredis': [],
};

/** The competitor must have run at all: a crashed tool is not a tool that found nothing. */
const MINIMUM_COMPETITOR_FINDINGS = 10;

/** Our total claims, across every corpus, must be no more than this fraction of the competitors'. */
const MAXIMUM_ASSERTION_RATIO = 0.1;

function check(artifact) {
  const messages = [];
  const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
  if (rows.length === 0) {
    messages.push(
      'the artifact holds no rows: a run that measured nothing is not a run that passed',
    );
    return messages;
  }
  const languages = new Set(rows.map((row) => String(row.language)));
  for (const language of ['python', 'typescript']) {
    if (!languages.has(language)) {
      messages.push(`no corpus was measured for ${language}: half the feature is unmeasured`);
    }
  }

  let ours = 0;
  let theirs = 0;

  for (const row of rows) {
    const name = String(row.repo ?? '(unnamed)');
    const floor = FLOORS[name];
    if (floor === undefined) {
      messages.push(`${name}: no floor is declared for this corpus, so nothing holds it`);
      continue;
    }
    if (!Number.isFinite(row.callEdges) || row.callEdges <= 0) {
      messages.push(
        `${name}: ${String(row.callEdges)} call edges — every finding below it is an artefact of the graph`,
      );
    }
    if (!Number.isFinite(row.considered) || row.considered <= 0) {
      messages.push(`${name}: nothing was considered`);
    }
    if (
      !Number.isFinite(row.competitorTotal) ||
      row.competitorTotal < MINIMUM_COMPETITOR_FINDINGS
    ) {
      messages.push(
        `${name}: the competitor reported ${String(row.competitorTotal)} findings — it did not run, and a comparison against a run that did not happen is not a comparison`,
      );
    }

    const findings = Number(row.oursDead);
    ours += Number.isFinite(findings) ? findings : 0;
    theirs += Number(row.competitorTotal ?? 0);
    if (!Number.isFinite(findings)) {
      messages.push(`${name}: the finding count is not a number`);
    } else if (findings > floor.findings) {
      messages.push(
        `${name}: ${String(findings)} findings, ceiling ${floor.findings} — the figure may fall and may not rise, because a tool that reports more is not a tool that found more`,
      );
    }

    // **Recall is measured against the oracle over the oracle's decidable universe**, and only where that universe holds
    // a positive. A corpus with nothing dead in it cannot demonstrate recall, and reporting `null` as zero would make
    // silence look like a miss.
    const decidable = row.decidable ?? {};
    const oracleDead = Number(decidable.oracleDead ?? 0);
    const recall = typeof decidable.ours?.recall === 'number' ? decidable.ours.recall : null;
    if (floor.recall !== null && oracleDead > 0) {
      if (recall === null || recall < floor.recall) {
        messages.push(
          `${name}: recall ${String(recall)} against ${String(oracleDead)} oracle-dead symbols, floor ${String(floor.recall)}`,
        );
      }
    } else if (oracleDead === 0 && findings > 0) {
      // **A finding where the oracle has no positive is a claim nobody else can confirm.** Allowed — the oracle is a
      // lower bound — but it has to be a small number, or it means the universe and the product disagree about the world.
      if (findings > 2) {
        messages.push(
          `${name}: ${String(findings)} findings against an oracle universe with no dead symbols`,
        );
      }
    }

    // **The hand-verified findings**, which is where a mechanical reader runs out.
    const reported = new Set(
      ['agree', 'oursOnly'].flatMap((bucket) =>
        (row.rows?.[bucket] ?? []).map(
          (finding) => `${String(finding.file)}::${String(finding.name)}`,
        ),
      ),
    );
    for (const expected of VERIFIED[name] ?? []) {
      if (!reported.has(expected)) {
        messages.push(`${name}: ${expected} was verified by hand and is no longer reported`);
      }
    }
    const confirmed = verifiedPresent(row, VERIFIED[name] ?? []);
    if (confirmed < floor.confirmed) {
      messages.push(
        `${name}: ${String(confirmed)} verified findings present, floor ${String(floor.confirmed)}`,
      );
    }

    // **And the claim the whole feature rests on**: the competitor's non-agreeing findings must be ones this product can
    // account for. A row where the competitor reported something neither tool places is evidence the oracle or the
    // universe changed, not that the product improved.
    const theirsOnly = Number(row.comparison?.competitorOnly);
    const placed = (row.rows?.competitorOnly ?? []).filter(
      (finding) =>
        typeof finding.ourVerdict === 'string' &&
        finding.ourVerdict !== 'not considered live by either surface',
    ).length;
    if (Number.isFinite(theirsOnly) && theirsOnly > 0 && placed / theirsOnly < 0.5) {
      messages.push(
        `${name}: only ${String(placed)} of ${String(theirsOnly)} competitor findings carry a rule that explains them — the comparison is not showing what it claims`,
      );
    }

    console.log(
      `${name} (${String(row.language)}): ${String(findings)} findings (ceiling ${floor.findings}), ` +
        `oracle-dead ${String(oracleDead)}, recall ${String(recall)}; ` +
        `${String(row.competitor)} ${String(row.competitorTotal)} findings, ${String(placed)}/${String(theirsOnly)} explained`,
    );
  }

  // **The order-of-magnitude claim, stated as a ratio rather than as prose.** If this ever fails, the product has become
  // as noisy as the tools it replaces, whatever its recall says.
  if (theirs > 0) {
    const ratio = ours / theirs;
    if (ratio > MAXIMUM_ASSERTION_RATIO) {
      messages.push(
        `${String(ours)} claims against ${String(theirs)} — ${(ratio * 100).toFixed(1)} % of the competitors', over the ${String(MAXIMUM_ASSERTION_RATIO * 100)} % the claim allows`,
      );
    }
    console.log(
      `assertion load: ${String(ours)} claims against ${String(theirs)} (${(ratio * 100).toFixed(1)} %)`,
    );
  }

  return messages;
}

function verifiedPresent(row, expected) {
  const reported = new Set(
    ['agree', 'oursOnly'].flatMap((bucket) =>
      (row.rows?.[bucket] ?? []).map(
        (finding) => `${String(finding.file)}::${String(finding.name)}`,
      ),
    ),
  );
  return expected.filter((item) => reported.has(item)).length;
}

function main() {
  const target = path.resolve(process.argv[2] ?? DEFAULT_ARTIFACT);
  const artifact = JSON.parse(fs.readFileSync(target, 'utf8'));
  const messages = check(artifact);
  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ passed: messages.length === 0, messages }, null, 2)}\n`,
    );
  }
  if (messages.length > 0) {
    for (const message of messages) console.error(`dead-code-gate: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`dead-code-gate: ${String(artifact.rows.length)} corpora held to their floors`);
}

if (require.main === module) main();

module.exports = { check, FLOORS, VERIFIED };
