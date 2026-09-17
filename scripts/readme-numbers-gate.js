#!/usr/bin/env node
/**
 * README number gate.
 *
 * The Benchmarks section published precision, recall and F1 beside competitor columns, with the basis disclosed
 * only in a footnote. A table like that is read as a head-to-head result whatever the footnote says, and the
 * figures behind it came from 49 internal issues — below the declared minimum for publication.
 *
 * This gate enforces three rules:
 *
 *   1. Every numeric cell in the Benchmarks table resolves to a citation in `benchmarks/citations.json`.
 *   2. A citation must name an artifact, and its `groundTruthIssues` must reach `minimumGroundTruth`.
 *   3. A citation marked `independentValidation: false` may not back a published number.
 *
 * A competitor column is not exempt: a figure this project did not measure has no place in a table of its own
 * results, and the gate says so rather than trusting a footnote to carry the correction.
 *
 * Usage:
 *   node scripts/readme-numbers-gate.js [--readme README.md] [--citations benchmarks/citations.json]
 */

'use strict';

const fs = require('node:fs');

function parseArgs(argv) {
  const args = { readme: 'README.md', citations: 'benchmarks/citations.json' };
  for (let i = 2; i < argv.length; i += 2) {
    if (argv[i] === '--readme') args.readme = argv[i + 1];
    else if (argv[i] === '--citations') args.citations = argv[i + 1];
  }
  return args;
}

/** Rows of the first table under a `## Benchmarks` heading. */
function readBenchmarkTable(markdown) {
  const heading = markdown.indexOf('## Benchmarks');
  if (heading === -1) return null;
  const rows = [];
  for (const line of markdown.slice(heading).split('\n')) {
    if (line.startsWith('## ') && !line.startsWith('## Benchmarks')) break;
    if (/^\|/.test(line)) rows.push(line);
  }
  return rows.length > 0 ? rows : null;
}

/** Cells that look like a measurement: a percentage, an F1-style decimal, a ratio, or a currency figure. */
const NUMBER = /(?:\d+(?:\.\d+)?%|\b0\.\d{2,}\b|\b\d+(?:\.\d+)?x\b|\$[0-9]+)/i;

function main() {
  const args = parseArgs(process.argv);
  const markdown = fs.readFileSync(args.readme, 'utf8');
  const citations = JSON.parse(fs.readFileSync(args.citations, 'utf8'));
  const failures = [];

  const rows = readBenchmarkTable(markdown);
  if (!rows) {
    console.log('no `## Benchmarks` table found — nothing published, nothing to verify');
    return;
  }

  const header = rows[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
  const columns = header.slice(1);

  for (const row of rows.slice(1)) {
    if (/^\|\s*[-:]/.test(row)) continue;
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length === 0) continue;
    for (let i = 1; i < cells.length; i += 1) {
      const cell = cells[i];
      if (!NUMBER.test(cell)) continue;
      const column = columns[i - 1] ?? `column ${i}`;
      const citation = citations.citations[column];
      if (!citation) {
        failures.push(
          `\`${cells[0]}\` in column \`${column}\` publishes \`${cell}\` with no citation`,
        );
        continue;
      }
      if (citation.artifact && !fs.existsSync(citation.artifact)) {
        failures.push(
          `\`${cells[0]}\` cites \`${column}\`, whose artifact \`${citation.artifact}\` does not exist — ` +
            `a citation to a missing artifact is worse than none`,
        );
      }
      if (citation.artifact === null || citation.artifact === undefined) {
        failures.push(
          `\`${cells[0]}\` cites \`${column}\`, which names no artifact — ` +
            `a figure this project did not measure has no place in a table of its own results`,
        );
      }
      const issues = citation.groundTruthIssues ?? 0;
      if (issues < (citations.minimumGroundTruth ?? 0)) {
        failures.push(
          `\`${cells[0]}\` cites \`${column}\` with ${issues} ground-truth issues, ` +
            `below the declared minimum of ${citations.minimumGroundTruth}`,
        );
      }
      if (citation.independentValidation === false) {
        failures.push(
          `\`${cells[0]}\` cites \`${column}\`, which is marked \`independentValidation: false\` — ` +
            `it is a record of what was measured, not a figure to publish`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ README number gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ Every published number resolves to a citation that meets the declared minimum.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { readBenchmarkTable };
