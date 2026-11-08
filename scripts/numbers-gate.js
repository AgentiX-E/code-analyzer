#!/usr/bin/env node
/**
 * Numbers gate — the declaration layer.
 *
 * **The incident this replaces.** `README.md` withdrew a table of precision, recall and F1 because the internal suite
 * behind it holds fewer ground-truth issues than the project's own publication floor. The withdrawal was correct and
 * it was written in the file the number was in. Four hundred lines below, `docs/BENCHMARK_REPORT.md` went on
 * publishing `79.4 % / 73.0 % / F1 0.761` beside SonarQube and CodeRabbit, and `docs/FINAL_BENCHMARK_REPORT_v1.0.0.md`
 * repeated them. The gate that existed to prevent this read one path, found no table there because the section had
 * been rewritten into prose, printed `nothing published, nothing to verify` and **exited 0**. It had been green and
 * empty since the day the table was removed.
 *
 * **Three rules, each with a failure the other two cannot see.**
 *
 *   1. **A withdrawn value may not appear on a metric line, anywhere.** The values are read from
 *      `benchmarks/citations.json` rather than written here, because a hardcoded list of forbidden numbers is a
 *      document about a citation and would go stale the same way. A citation is withdrawn when its dataset is below
 *      the declared floor; that is the project's stated publication rule, and the gate applies the stated rule rather
 *      than a stricter one invented here.
 *   2. **A document that states figures must name their source.** `<!-- figures: citations:key1,key2 -->` at the top
 *      of the file, every key resolving to a citation whose artifact exists. This is coarse on purpose: it says "this
 *      document's numbers come from these measurements", which is checkable, and it does not attempt to prove that a
 *      particular number came from a particular citation — that is the line-level ratchet, not this rule.
 *   3. **The gate must find something.** A check whose subject has stopped existing reports green forever, so the
 *      number of claim lines it scanned has a floor and a run below it fails. This is the rule that would have caught
 *      the incident on the day it happened.
 *
 * What the rules cannot say is written down in `docs/EVAL-CONTRACT.md` beside them, because a gate described as
 * stronger than it is becomes the next thing that lies.
 *
 * Usage:
 *   node scripts/numbers-gate.js [--citations benchmarks/citations.json] [--min-claims 20] [--json]
 */

'use strict';

const fs = require('node:fs');
const { join, relative, sep } = require('node:path');

/** Directories that are not this repository's prose, and the archive, which is history rather than a claim. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.git', 'archive']);

/** Documents whose whole purpose is to publish a result, so rule 2 applies to them by name. */
const PUBLICATION = ['README.md', 'docs/BENCHMARK_REPORT.md'];

/** A statement about how well this project performed. The word is the trigger; the number is checked. */
const METRIC = /\b(precision|recall|\bf1\b|\btpr\b|\bfpr\b|\bmap\b|mrr|accuracy|youden|score)\b/i;

/**
 * Any number that could be a figure, with whether it is written as a percentage.
 *
 * **The percentage flag is not decoration.** A proportion and a percentage are the same claim written twice, so both
 * forms of a withdrawn value are forbidden - but `73` and `73 %` are only the same claim when one of them carries the
 * sign. Without this flag the gate failed on `trace 73/73`, which is a count of call paths, against a withdrawn recall
 * of `73 %`. A gate that cannot tell a count from a rate gets switched off, so it tells them apart.
 */
const NUMBER = /(\d+(?:\.\d+)?)(\s*%)?/g;

/** `<!-- figures: citations:a,b -->`, with optional whitespace. */
const DECLARATION = /<!--\s*figures:\s*citations:([^>]+?)\s*-->/;

const args = { citations: 'benchmarks/citations.json', minClaims: 20, json: false };
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i];
  if (flag === '--citations') args.citations = process.argv[++i];
  else if (flag === '--min-claims') args.minClaims = Number(process.argv[++i]);
  else if (flag === '--json') args.json = true;
}

/** Every Markdown file in the tree, minus the directories that hold no claims. */
function markdownFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) out.push(path);
    }
  };
  walk(root);
  // **`docs/guide/*.md` are symlinks into `docs/`**, so a walk sees each of those documents twice. Reading one twice
  // would report every failure twice and inflate the scanned count that rule 3 turns into a floor, which is a gate
  // lying to itself about how much it looked at. Deduplicated by real path.
  const seen = new Set();
  const unique = [];
  for (const file of out.sort()) {
    const real = fs.realpathSync(file);
    if (seen.has(real)) continue;
    seen.add(real);
    unique.push(file);
  }
  return unique;
}

/**
 * The values a citation has withdrawn, as the strings a document would print them as.
 *
 * A proportion can appear as `0.794` or as `79.4 %`, so both forms are registered. The comparison downstream is
 * numeric, which is why the forms are numbers here rather than strings.
 */
function withdrawnValues(citations, minimum) {
  const values = [];
  for (const [name, entry] of Object.entries(citations.citations ?? {})) {
    const issues = entry.groundTruthIssues ?? 0;
    if (issues >= minimum) continue;
    for (const [metric, value] of Object.entries(entry.metrics ?? {})) {
      if (typeof value !== 'number') continue;
      values.push({ citation: name, metric, value, percent: false });
      // A proportion is also published as a percentage; anything at or below one is.
      if (value > 0 && value <= 1) {
        values.push({ citation: name, metric, value: value * 100, percent: true });
      }
    }
  }
  return values;
}

/** Whether a line states a figure, and which numbers it states, each with its written form. */
function claimOf(line) {
  if (!METRIC.test(line)) return null;
  const numbers = [];
  for (const match of line.matchAll(NUMBER)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) numbers.push({ value, percent: Boolean(match[2]) });
  }
  return numbers.length > 0 ? numbers : null;
}

/** The citation keys a document declares, or `null` when it declares none. */
function declaredCitations(text) {
  const match = DECLARATION.exec(text);
  if (!match) return null;
  return (match[1] ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function main() {
  const citations = JSON.parse(fs.readFileSync(args.citations, 'utf8'));
  const minimum = citations.minimumGroundTruth ?? 0;
  const withdrawn = withdrawnValues(citations, minimum);
  const failures = [];

  const files = markdownFiles('.');
  let scanned = 0;
  const perFile = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const relativePath = relative('.', file).split(sep).join('/');
    const lines = text.split('\n');
    let claimsInFile = 0;

    for (const [index, line] of lines.entries()) {
      const numbers = claimOf(line);
      if (numbers === null) continue;
      claimsInFile += 1;
      scanned += 1;
      // Two ways to say the same thing: the figure is not published, or it is published with the floor stated
      // beside it. Either is a reader being told; what is forbidden is the unqualified figure.
      if (/\bwithheld\b|below the publication floor/i.test(line)) continue;

      // Rule 1 — a value the project has withdrawn may not be restated as a result. Compared numerically, because
      // `79.4 %` and `0.794` are the same claim written twice.
      for (const number of numbers) {
        const hit = withdrawn.find(
          (entry) =>
            entry.percent === number.percent &&
            Math.abs(Math.round(number.value * 10_000) / 10_000 - entry.value) < 0.0005,
        );
        if (hit) {
          failures.push(
            `${relativePath}:${String(index + 1)} restates \`${String(number.value)}${number.percent ? ' %' : ''}\` from \`${hit.citation}\`, ` +
              `whose dataset is below the publication floor of ${String(minimum)} — ` +
              `a withdrawn figure has no place in a document, whatever the section is called`,
          );
        }
      }
    }

    if (claimsInFile > 0) perFile.push({ file: relativePath, claims: claimsInFile });

    // Rule 2 — a document that states figures names the measurements they come from.
    const isPublication =
      PUBLICATION.includes(relativePath) || relativePath.startsWith('benchmarks/');
    if (!isPublication) continue;
    const declared = declaredCitations(text);
    if (declared === null || declared.length === 0) {
      failures.push(
        `${relativePath} states ${String(claimsInFile)} figure${claimsInFile === 1 ? '' : 's'} and declares no ` +
          `source — add \`<!-- figures: citations:<key> -->\` naming the measurement behind them`,
      );
      continue;
    }
    for (const key of declared) {
      const citation = citations.citations?.[key];
      if (!citation) {
        failures.push(
          `${relativePath} declares \`citations:${key}\`, which is not in ${args.citations}`,
        );
        continue;
      }
      if (citation.artifact && !fs.existsSync(citation.artifact)) {
        failures.push(
          `${relativePath} declares \`citations:${key}\`, whose artifact \`${citation.artifact}\` does not exist`,
        );
      }
      if (citation.artifact === undefined || citation.artifact === null) {
        failures.push(
          `${relativePath} declares \`citations:${key}\`, which names no artifact — a figure nobody can open is a ` +
            `figure nobody can check`,
        );
      }
    }
  }

  // Rule 3 — the subject must exist. This is the rule the previous gate was missing, and its absence is why the
  // previous gate spent its whole life reporting success about nothing.
  if (scanned < args.minClaims) {
    failures.push(
      `the gate scanned ${String(scanned)} figure lines across ${String(files.length)} documents, below the floor of ` +
        `${String(args.minClaims)} — a check that finds nothing is not a check that passed`,
    );
  }

  const report = {
    scanned,
    documents: files.length,
    withClaims: perFile,
    withdrawn: withdrawn.length,
    failures,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (failures.length > 0) {
    console.error(`\n❌ numbers gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`);
  } else {
    console.log(
      `✅ ${String(scanned)} figure lines across ${String(perFile.length)} documents: none restates a withdrawn ` +
        `value, and every publishing document names its source.`,
    );
  }
  if (failures.length > 0) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { claimOf, declaredCitations, withdrawnValues, markdownFiles };
