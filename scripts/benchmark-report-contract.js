#!/usr/bin/env node
/**
 * Benchmark report contract.
 *
 * A figure is only checkable if the report says what it measured. This gate reads a report's metadata and requires
 * four fields — **source, date, arm, dataset revision** — because each one answers a question a reader will ask and
 * cannot answer from the number alone:
 *
 *   - source: what was measured, and where someone else would find it
 *   - date: when, which is how a figure is tied to the code that produced it
 *   - arm: which configuration, since two arms of the same benchmark can disagree by design
 *   - datasetRevision: which version of the data, so a comparison is like for like
 *
 * The repository's own history is the reason. The README published precision and recall from a dataset nobody
 * could identify, in an arm nobody named, against a revision that did not exist.
 *
 * Usage:
 *   node scripts/benchmark-report-contract.js <report.json> [more.json ...]
 */

'use strict';

const fs = require('node:fs');

const REQUIRED = [
  ['source', 'where the dataset came from'],
  ['timestamp', 'when the run happened'],
  ['arm', 'which configuration was measured'],
  ['datasetRevision', 'which revision of the data'],
];

function check(file) {
  const failures = [];
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return [`${file}: not readable as JSON — ${err instanceof Error ? err.message : String(err)}`];
  }

  const metadata = report.metadata ?? report;
  for (const [field, why] of REQUIRED) {
    const value = metadata[field];
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(`${file}: metadata.${field} is missing — a report must say ${why}`);
    } else if (value === 'unspecified') {
      failures.push(
        `${file}: metadata.${field} is \`unspecified\` — the field exists but states nothing`,
      );
    }
  }
  return failures;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('no report supplied — nothing to check. Pass one or more report paths.');
    return;
  }

  const failures = files.flatMap(check);
  console.log(`checked ${files.length} report(s) against the four-field contract`);

  if (failures.length > 0) {
    console.error(`\n❌ Report contract failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log('✅ Every report names its source, date, arm and dataset revision.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { check, REQUIRED };
