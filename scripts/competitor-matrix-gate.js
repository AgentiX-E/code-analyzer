#!/usr/bin/env node
/**
 * Competitor matrix gate.
 *
 * Every audit in this repository listed competitors and corpora, and each list was shorter than the field — one
 * competitor sat as a name inside a shared row for weeks while four separate pages read as complete. A list in prose
 * cannot be checked; a list in data can.
 *
 * This gate reads `benchmarks/competitor-matrix.json` and reports, by name, every cell for which this project has no
 * figure. It enforces five rules:
 *
 *   1. A metric declared in `ourMetrics` must resolve to a value in its artifact.
 *   2. A metric whose `invalidWhen` matches is MISSING, not measured — a number produced with the component it names
 *      switched off is not that number, and `docstring-search.json` says so in its own note.
 *   3. A metric declared in `pendingOurMetrics` is MISSING and must carry a `why`.
 *   4. The MISSING count is ratcheted: it may fall and it may not rise.
 *   5. An empty matrix, an unreadable matrix, or a matrix with no competitors is a failure — "the gate did not look"
 *      must never read as "the tree is clean".
 *
 * Usage:
 *   node scripts/competitor-matrix-gate.js
 *   node scripts/competitor-matrix-gate.js --json benchmarks/competitor-matrix-report.json
 *   node scripts/competitor-matrix-gate.js --update
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MATRIX = 'benchmarks/competitor-matrix.json';
const BASELINE = 'benchmarks/competitor-matrix-baseline.json';

function parseArgs(argv) {
  const args = { matrix: MATRIX, baseline: BASELINE, json: null, update: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--matrix') args.matrix = argv[++i];
    else if (argv[i] === '--baseline') args.baseline = argv[++i];
    else if (argv[i] === '--json') args.json = argv[++i];
    else if (argv[i] === '--update') args.update = true;
  }
  return args;
}

/** Walk a path of keys and indices. Returns `undefined` rather than throwing, so a shape change reads as MISSING. */
function readPath(root, keys) {
  let node = root;
  for (const key of keys) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  return node;
}

function fail(message) {
  console.error(`  ❌ ${message}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.matrix)) fail(`the matrix is not there: ${args.matrix}`);
  let matrix;
  try {
    matrix = JSON.parse(fs.readFileSync(args.matrix, 'utf8'));
  } catch (error) {
    fail(`the matrix did not parse: ${error.message}`);
  }

  const competitors = Array.isArray(matrix.competitors) ? matrix.competitors : [];
  const measuredSpec =
    matrix.ourMetrics && typeof matrix.ourMetrics === 'object' ? matrix.ourMetrics : {};
  const pendingSpec =
    matrix.pendingOurMetrics && typeof matrix.pendingOurMetrics === 'object'
      ? matrix.pendingOurMetrics
      : {};

  // **Rule 5.** A gate that passes on empty input reports success exactly when it stopped looking.
  if (competitors.length === 0)
    fail('the matrix declares no competitors — an empty list is not a clean list');
  if (Object.keys(measuredSpec).length === 0 && Object.keys(pendingSpec).length === 0) {
    fail('the matrix declares no metrics — nothing was checked');
  }

  const measured = [];
  const missing = [];
  const invalid = [];

  for (const [name, spec] of Object.entries(measuredSpec)) {
    const artifactPath = spec.artifact;
    let artifact = null;
    let reason = null;
    if (!artifactPath || !fs.existsSync(artifactPath)) {
      reason = `artifact absent: ${artifactPath ?? '(none declared)'}`;
    } else {
      try {
        artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      } catch (error) {
        reason = `artifact did not parse: ${error.message}`;
      }
    }

    if (!reason && spec.invalidWhen) {
      const actual = readPath(artifact, spec.invalidWhen.path);
      if (actual === spec.invalidWhen.equals) {
        // **Rule 2, and this is the one that matters**: the artifact names a disabled component, so the number it
        // carries is about a different configuration. It is reported as MISSING with the component named.
        invalid.push({
          name,
          category: spec.category,
          axis: spec.axis,
          artifact: artifactPath,
          because: `${spec.invalidWhen.path.join('.')} is "${actual}"${spec.note ? ` — ${spec.note}` : ''}`,
        });
        continue;
      }
    }

    const value = reason ? undefined : readPath(artifact, spec.read ?? []);
    if (reason || value === undefined || value === null) {
      missing.push({
        name,
        category: spec.category,
        axis: spec.axis,
        artifact: artifactPath ?? '(none declared)',
        why: reason ?? `no value at ${(spec.read ?? []).join('.')} in ${artifactPath}`,
      });
      continue;
    }
    measured.push({
      name,
      category: spec.category,
      axis: spec.axis,
      artifact: artifactPath,
      value,
    });
  }

  // **Rule 3, and the first version of this loop got it wrong in a way a test caught.** It defaulted a missing `why`
  // to a sentence, so **the check for a missing reason could never fire** - a guard whose failure path fills itself in.
  // **A pending cell with no reason is a violation**, because the number being absent is a fact and **the reason is
  // what makes it a task.**
  const unreasoned = [];
  for (const [name, spec] of Object.entries(pendingSpec)) {
    const why = typeof spec.why === 'string' ? spec.why.trim() : '';
    if (why === '') {
      unreasoned.push(name);
      continue;
    }
    missing.push({
      name,
      category: spec.category,
      axis: spec.axis ?? name,
      artifact: spec.artifact ?? '(none declared)',
      why,
    });
  }

  const total = measured.length + missing.length + invalid.length + unreasoned.length;

  // **The cross-product is reported as a second count, because it answers a question the cell list cannot: how much
  // of the comparison has every dimension under our control.** **A cell is controllable only when the tool's outputs
  // are produced by a run of ours *and* the embedder is ours** - so **a shipped review scored by our judge counts as
  // measured and not as controllable**, which is exactly the distinction the three requirements turn on.
  const cross =
    matrix.crossProduct && Array.isArray(matrix.crossProduct.cells)
      ? matrix.crossProduct.cells
      : [];
  const controllable = cross.filter((c) => c.controllable === true);
  const byCorpus = {};
  for (const cell of cross) {
    const key = cell.corpus ?? 'unknown';
    byCorpus[key] = byCorpus[key] ?? { cells: 0, controllable: 0 };
    byCorpus[key].cells += 1;
    if (cell.controllable === true) byCorpus[key].controllable += 1;
  }
  const missingCount = missing.length + invalid.length;

  console.log('COMPETITOR-MATRIX');
  console.log(
    `  competitors: ${competitors.length} (A ${competitors.filter((c) => c.category === 'A').length} · B ${competitors.filter((c) => c.category === 'B').length} · C ${competitors.filter((c) => c.category === 'C').length})`,
  );
  console.log(`  cells: ${total} · measured ${measured.length} · missing ${missingCount}`);

  if (cross.length > 0) {
    console.log(
      `  cross-product: ${cross.length} cell(s) that can exist · **${controllable.length} controllable** ` +
        '(our outputs and our embedder) · ' +
        `${cross.length - controllable.length} frozen`,
    );
    for (const [corpus, t] of Object.entries(byCorpus)) {
      console.log(`    ${corpus.padEnd(26)} ${t.cells} cell(s) · controllable ${t.controllable}`);
    }
    const runnable = Object.keys(matrix.toolRunnability?.runnable ?? {});
    if (runnable.length > 0) console.log(`    runnable tools: ${runnable.join(', ')}`);
  }
  if (measured.length > 0) {
    console.log('  measured:');
    for (const m of measured)
      console.log(`    ${m.name.padEnd(42)} [${m.category}] ${String(m.value).slice(0, 40)}`);
  }
  if (invalid.length > 0) {
    console.log('  invalid — the artifact names a disabled component:');
    for (const m of invalid) console.log(`    ${m.name.padEnd(42)} [${m.category}] ${m.because}`);
  }
  if (missing.length > 0) {
    console.log('  missing:');
    for (const m of missing) console.log(`    ${m.name.padEnd(42)} [${m.category}] ${m.why}`);
  }

  // **Rule 4.** The ratchet.
  const baseline = fs.existsSync(args.baseline)
    ? JSON.parse(fs.readFileSync(args.baseline, 'utf8'))
    : null;
  const report = {
    comment: [
      'The competitor matrix as the gate sees it: every cell, its state, and the MISSING count.',
      '',
      '**MISSING may fall and may not rise.** A cell is measured only when its artifact carries a value produced with the',
      'component the cell names switched on.',
    ],
    generatedAt: new Date().toISOString().slice(0, 10),
    competitors: competitors.length,
    byCategory: {
      A: competitors.filter((c) => c.category === 'A').length,
      B: competitors.filter((c) => c.category === 'B').length,
      C: competitors.filter((c) => c.category === 'C').length,
    },
    cells: total,
    crossProduct: {
      cells: cross.length,
      controllable: controllable.length,
      frozen: cross.length - controllable.length,
      byCorpus,
      runnableTools: Object.keys(matrix.toolRunnability?.runnable ?? {}),
    },
    measured,
    invalid,
    missing,
    missingCount,
  };
  if (args.json) {
    fs.mkdirSync(path.dirname(args.json), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');
    console.log(`  report: ${args.json}`);
  }

  if (args.update) {
    fs.writeFileSync(
      args.baseline,
      JSON.stringify(
        {
          comment: [
            'The ratchet floor for the competitor matrix: MISSING may fall and may not rise.',
          ],
          missing: missingCount,
          cells: total,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`  ✅ baseline updated: missing ${missingCount} (cells ${total})`);
    return;
  }

  if (unreasoned.length > 0) {
    console.error(
      `  ❌ ${unreasoned.length} pending cell(s) carry no reason: ${unreasoned.join(', ')}`,
    );
    console.error(
      '  A pending cell must say why — the absence of a number is a fact, and the reason makes it a task.',
    );
    process.exit(1);
  }

  if (!baseline) {
    fail(`no baseline at ${args.baseline} — run with --update to record one`);
  }
  console.log(`  ratchet: missing ${missingCount} (baseline ${baseline.missing})`);
  if (missingCount > baseline.missing) {
    console.error(`  ❌ the MISSING count rose: ${baseline.missing} → ${missingCount}`);
    console.error(
      '  A cell that was measured and is not any more is a regression, and so is a new pending cell.',
    );
    process.exit(1);
  }
  console.log('  ✅ every measured cell resolved, and the MISSING count did not rise.');
}

main();
