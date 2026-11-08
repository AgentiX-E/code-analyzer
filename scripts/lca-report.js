#!/usr/bin/env node
// The report's Long Code Arena figures, rendered from the artifact rather than typed beside it.
//
// **The report quoted a run at three denominators and called two of them two runs**, and every one of those numbers was
// hand-written: the merge ran, the report was edited, and nothing compared the two. A section whose tables are typed by
// hand is a section that drifts on the next run, and the drift is invisible because the prose around it still reads
// true. So the tables that carry the corpus's figures are generated from `benchmarks/lca-bug-localization.json`,
// delimited by markers, and `--check` compares the file with what the artifact would write.
//
// **Why a script and not a test.** A test can assert that a number in the report equals a number in the artifact, one
// number at a time, and the check grows with the number of figures. Rendering the block and diffing it is one statement
// about all of them, and it fails with the exact line that changed.
//
// **What it deliberately does not own.** The section's prose - what the corpus asks, why it is the first figure that can
// be placed in a published table, what the admission rule costs. Prose is argued, not computed, and a generator that
// wrote it would be inventing the argument. The boundary is the marker.
//
// Usage:
//   node scripts/lca-report.js            print the block
//   node scripts/lca-report.js --write    write it into the report between the markers
//   node scripts/lca-report.js --check    fail when the report and the artifact disagree

const { readFileSync, writeFileSync } = require('node:fs');

const ARTIFACT = 'benchmarks/lca-bug-localization.json';
const REPORT = 'docs/BENCHMARK_REPORT.md';
const BEGIN = '<!-- lca:figures:begin';
const END = '<!-- lca:figures:end -->';

// **The formatter is told to leave these tables alone.** They are written by this file and compared with it by
// `--check`, so a formatter that realigned them would put two tools in charge of one table and make the comparison fail
// for a reason that has nothing to do with the figures. The marker is how the generator says which tool owns the layout.
const IGNORE = '<!-- prettier-ignore -->';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

/** Read a nested field, or `undefined`. **A missing figure prints as `—`, never as a zero.** */
function at(record, path) {
  let value = record;
  for (const key of path) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/** Four decimals, or an em dash. The corpus's own metric reports four, and so does every table here. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

/** A signed difference, because a delta's sign is the finding and `0.0363` hides it. */
function delta(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(4)}`;
}

function interval(lower, upper) {
  if (typeof lower !== 'number' || typeof upper !== 'number') return '—';
  return `[${lower.toFixed(4)}, ${upper.toFixed(4)}]`;
}

/**
 * **The three conventions of "a mean over this corpus", in one table.**
 *
 * They are not rival measurements and they are not interchangeable: 0.4746 is over the rows the analysis ran on, 0.4499
 * charges a refusal with the file-level fallback arm, and 0.3955 charges it with nothing. The audit that read the third
 * as another run's figure read it without its denominator, which is the mistake the table exists to make impossible.
 */
function denominatorsTable(artifact) {
  const measured = at(artifact, ['overall', 'map', 'value']);
  const rows = at(artifact, ['overall', 'map', 'rows']);
  const attempted = at(artifact, ['sample', 'attempted']);
  const fused = at(artifact, ['fusion', 'overall', 'value']);
  const worst = at(artifact, ['sample', 'worstCaseMap']);
  const retrieval = at(artifact, ['overall', 'retrieval']) ?? {};
  const cut = (k) => retrieval[`at${k}`] ?? {};
  return [
    IGNORE,
    '| how a refusal is scored | rows | MAP | recall@10 | precision@10 | F1@10 | field |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| not scored at all — the rows the analysis ran on | ${String(rows ?? '—')} of ${String(attempted ?? '—')} | **${num(measured)}** | ${num(at(cut(10), ['recall']))} | ${num(at(cut(10), ['precision']))} | ${num(at(cut(10), ['f1']))} | \`overall.map.value\` |`,
    `| the file-level fallback arm's figure | ${String(attempted ?? '—')} | ${num(fused)} | — | — | — | \`fusion.overall.value\` |`,
    `| zero | ${String(attempted ?? '—')} | ${num(worst)} | — | — | — | \`sample.worstCaseMap\` |`,
    '',
    IGNORE,
    '| cut | recall | precision | F1 | false positive rate |',
    '| --- | --- | --- | --- | --- |',
    ...[1, 3, 5, 10].map(
      (k) =>
        `| @${String(k)} | ${num(at(cut(k), ['recall']))} | ${num(at(cut(k), ['precision']))} | ${num(at(cut(k), ['f1']))} | ${num(at(cut(k), ['fpr']))} |`,
    ),
  ];
}

/**
 * **Two controls, each with both of its denominators.**
 *
 * `controlMap` is over every attempted row; `pairedControl` is over the rows both arms scored, and only the second is
 * subtractable from ours. The two are printed in separate columns because the run that printed one of them beside the
 * other's row count produced a Java win that did not survive the same-rows comparison.
 */
function controlsTable(artifact) {
  const controls = Array.isArray(artifact.controlSummary) ? artifact.controlSummary : [];
  const rows = controls.map((control) => {
    const name = control.name === 'BM25' ? 'BM25' : `**${String(control.name)}**`;
    return (
      `| ${name} | ${String(control.controlRows ?? '—')} | ${num(control.controlMap)} | ` +
      `${String(control.pairedRows ?? '—')} | ${num(control.pairedControl)} | ${num(control.oursPaired)} | ` +
      `${delta(control.delta)} | ${interval(control.lower, control.upper)} | ` +
      `${String(control.wins ?? '—')} / ${String(control.losses ?? '—')} / ${String(control.ties ?? '—')} | ` +
      `${num(control.pValue)} |`
    );
  });
  return [
    IGNORE,
    '| control | rows (all) | its mean there | paired rows | its mean there | ours | Δ | 95 % interval | W / L / T | sign test |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ];
}

function languageTable(artifact) {
  const byLanguage = artifact.byLanguage ?? {};
  const rows = Object.entries(byLanguage).map(([config, block]) => {
    const cut = (k) => at(block, ['retrieval', `at${k}`]) ?? {};
    return (
      `| ${config} | ${String(block.measured ?? '—')} of ${String(block.rows ?? '—')} | ` +
      `${num(at(block, ['map', 'value']))} | ${num(at(cut(10), ['recall']))} | ${num(at(cut(10), ['f1']))} |`
    );
  });
  return [
    IGNORE,
    '| split | measured | MAP | recall@10 | F1@10 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ];
}

/**
 * **The bands, each column with its own denominator.**
 *
 * `ours` and `BM25` are over the rows the band measured; `fusion` is over every attempted row, because the fused column
 * is what a refused instance still produces. Subtracting a column from the one beside it is a defect this table has
 * already published once.
 */
function bandTable(artifact) {
  const bands = Array.isArray(artifact.stratified) ? artifact.stratified : [];
  const rows = bands.map((band) => {
    const vsBm25 = band.vsBm25 ?? {};
    return (
      `| ${String(band.label)} | ${String(band.attempted ?? '—')} | ${String(band.measured ?? '—')} | ` +
      `${num(band.ours)} | ${num(vsBm25.control)} | ${delta(vsBm25.delta)} | ` +
      `${num(band.fallback)} | ${num(band.fusion)} |`
    );
  });
  return [
    IGNORE,
    '| checkout size | attempted | measured | ours | BM25 | Δ | fallback arm | fused (all attempted) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ];
}

/** **What the run was allowed to read and what it was allowed to cost**, stated because both are defects of this run. */
function stateTable(artifact) {
  const scoped = at(artifact, ['analysisScope', 'rowsScoped']);
  const attempted = at(artifact, ['analysisScope', 'rowsAttempted']);
  const cap = at(artifact, ['fileCap', 'files']);
  const consistent = at(artifact, ['fileCap', 'consistent']);
  const guard = at(artifact, ['fileCap', 'memory', 'guard', 'declarations']);
  const density = at(artifact, ['fileCap', 'memory', 'declarationsPerFile']);
  const affordable =
    typeof guard === 'number' && typeof density === 'number' && density > 0
      ? Math.floor(guard / density)
      : null;
  return [
    IGNORE,
    '| property | this run |',
    '| --- | --- |',
    `| rows stating what the analysis was allowed to read | ${String(scoped ?? '—')} of ${String(attempted ?? '—')}${scoped === 0 ? ' — **the whole checkout on every row**' : ''} |`,
    `| file cap against the charge it publishes | ${String(cap ?? '—')} files against floor(${String(guard ?? '—')} / ${String(density ?? '—')}) = ${String(affordable ?? '—')}${consistent === false ? ' — **wider than its own charge**' : ''} |`,
  ];
}

function render(artifact) {
  return [
    BEGIN + ' — written by `node scripts/lca-report.js --write`, checked by `--check` in CI -->',
    '',
    '**Every figure in this block is rendered from `benchmarks/lca-bug-localization.json`.** The tables below it are the',
    'argument; these are the numbers, and a change to either without the other fails the check.',
    '',
    `Measured ${String(at(artifact, ['measuredAt']) ?? '—')} over ${String(at(artifact, ['sample', 'planned']) ?? '—')} planned instances, ` +
      `${String(at(artifact, ['sample', 'attempted']) ?? '—')} attempted, ${String(at(artifact, ['sample', 'measured']) ?? '—')} measured.`,
    '',
    '### Three denominators',
    '',
    ...denominatorsTable(artifact),
    '',
    '### The two controls, paired',
    '',
    ...controlsTable(artifact),
    '',
    '### By split',
    '',
    ...languageTable(artifact),
    '',
    '### By checkout size',
    '',
    ...bandTable(artifact),
    '',
    '### The run in two lines',
    '',
    ...stateTable(artifact),
    '',
    END,
  ].join('\n');
}

/** The block currently in the report, or `null` when the markers are absent or out of order. */
function existingBlock(text) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from < 0 || to < 0 || to < from) return null;
  return { from, to: to + END.length, block: text.slice(from, to + END.length) };
}

/**
 * The report with the block replaced, **and nothing else touched**.
 *
 * **The layout belongs to this file, not to the formatter, and the block says so** — every table is preceded by
 * `<!-- prettier-ignore -->`, because a generator whose output the formatter realigns puts two tools in charge of one
 * table and makes `--check` fail for a reason that has nothing to do with the figures. The first version of this block
 * emitted its own formatting, was rewritten by `prettier --write`, and then disagreed with itself; the marker is the
 * repair, and it is in the artifact's favour rather than the formatter's only because the formatter is not comparing
 * numbers.
 */
function expected(text, rendered) {
  const found = existingBlock(text);
  if (found === null) return null;
  return `${text.slice(0, found.from)}${rendered}${text.slice(found.to)}`;
}

function main() {
  const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  const rendered = render(artifact);

  if (has('--write')) {
    const text = readFileSync(REPORT, 'utf8');
    const next = expected(text, rendered);
    if (next === null) {
      console.error(`lca report: ${REPORT} has no \`${BEGIN}\` … \`${END}\` block to write into`);
      process.exit(1);
    }
    if (next === text) {
      console.log('lca report: the block is already what the artifact says');
      return;
    }
    writeFileSync(REPORT, next);
    console.log(`lca report: wrote ${String(rendered.split('\n').length)} lines into ${REPORT}`);
    return;
  }

  if (has('--check')) {
    const text = readFileSync(REPORT, 'utf8');
    const found = existingBlock(text);
    if (found === null) {
      console.error(
        `lca report: ${REPORT} has no \`${BEGIN}\` … \`${END}\` block — the figures are hand-written, and a hand-written ` +
          'table is a table that drifts on the next run',
      );
      process.exit(1);
    }
    const next = expected(text, rendered);
    if (next === text) {
      console.log('lca report: the rendered block matches the artifact');
      return;
    }
    // **The first line that differs, because a diff of two hundred lines is a diff nobody reads.** The message names
    // the command that fixes it, since a check whose repair is not stated is a check that gets disabled.
    const before = found.block.split('\n');
    const after = rendered.split('\n');
    const index = before.findIndex((line, position) => line !== after[position]);
    console.error(
      `lca report: ${REPORT} and ${ARTIFACT} disagree at line ${String(index + 1)} of the block\n` +
        `  report:   ${before[index] ?? '(missing)'}\n` +
        `  artifact: ${after[index] ?? '(missing)'}\n` +
        '  run `node scripts/lca-report.js --write` and commit the result',
    );
    process.exit(1);
  }

  console.log(rendered);
}

if (require.main === module) main();

module.exports = { render, denominatorsTable, controlsTable, languageTable, bandTable, stateTable };
