#!/usr/bin/env node
/**
 * README status gate.
 *
 * The Features table carried twenty rows, every one of them reading `Verified — unit tested` or similar. None of
 * them pointed at anything, and two contradicted the project's own audit: it lists "No Taint Analysis" as a
 * critical gap, and the README says the benchmark framework is verified while the section above it says no
 * benchmark figures are published.
 *
 * This gate parses the table and applies three rules:
 *
 *   1. Every feature row has a record in `benchmarks/status-register.json`.
 *   2. The status in the README is a word from the register's vocabulary.
 *   3. The status is not stronger than the register allows. `verified` requires evidence and is the only word that
 *      claims correctness; a register entry that records a contradiction may not carry it.
 *
 * Usage:
 *   node scripts/readme-status-gate.js [--readme README.md] [--register benchmarks/status-register.json]
 */

'use strict';

const fs = require('node:fs');

const STRENGTH = { planned: 0, partial: 1, tested: 2, verified: 3 };

function parseArgs(argv) {
  const args = { readme: 'README.md', register: 'benchmarks/status-register.json' };
  for (let i = 2; i < argv.length; i += 2) {
    if (argv[i] === '--readme') args.readme = argv[i + 1];
    else if (argv[i] === '--register') args.register = argv[i + 1];
  }
  return args;
}

/** Rows of the Features table: `| Feature | status |`. */
function readFeatureTable(markdown) {
  const heading = markdown.indexOf('## Features');
  if (heading === -1) return null;
  const rows = [];
  for (const line of markdown.slice(heading).split('\n')) {
    if (line.startsWith('## ') && !line.startsWith('## Features')) break;
    if (/^\|/.test(line)) rows.push(line);
  }
  return rows.length > 0 ? rows : null;
}

/**
 * The status word a cell begins with, if it begins with one.
 *
 * Anchored at the start on purpose. A substring search accepted `Battle-tested` as `tested`, which is precisely
 * the kind of claim this gate exists to reject — the vocabulary is meant to be narrow, so a cell has to *be* one
 * of its words rather than merely contain one.
 */
function statusWord(cell, vocabulary) {
  const lower = cell.toLowerCase().trim();
  for (const word of vocabulary) if (lower.startsWith(word)) return word;
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  const markdown = fs.readFileSync(args.readme, 'utf8');
  const register = JSON.parse(fs.readFileSync(args.register, 'utf8'));
  const vocabulary = register.vocabulary || [];
  const failures = [];

  const rows = readFeatureTable(markdown);
  if (!rows) {
    console.log('no `## Features` table found — nothing claimed, nothing to verify');
    return;
  }

  for (const row of rows.slice(1)) {
    if (/^\|\s*[-:]/.test(row)) continue;
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const featureCell = cells[0];
    const cell = cells[1];

    const word = statusWord(cell, vocabulary);
    const record = Object.entries(register.features).find(([name]) => featureCell.includes(name));

    if (!record) {
      failures.push(`\`${featureCell}\` claims \`${cell}\` with no record in the register`);
      continue;
    }
    const [name, entry] = record;
    if (!word) {
      failures.push(
        `\`${name}\` carries \`${cell}\`, which names no status from the vocabulary (${vocabulary.join(', ')})`,
      );
      continue;
    }
    if (entry.status === 'partial' && word === 'verified') {
      failures.push(
        `\`${name}\` claims \`verified\` while the register records a qualification` +
          `${entry.note ? `: ${entry.note.slice(0, 120)}…` : ''}`,
      );
      continue;
    }
    if ((STRENGTH[word] ?? -1) > (STRENGTH[entry.status] ?? -1)) {
      failures.push(
        `\`${name}\` claims \`${word}\` but the register only supports \`${entry.status}\``,
      );
    }
    if (word === 'verified' && !entry.evidence && !entry.artifact) {
      failures.push(`\`${name}\` claims \`verified\` with no artifact recorded`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ README status gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ Every status claim is in the vocabulary and no stronger than its record.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { readFeatureTable, statusWord };
