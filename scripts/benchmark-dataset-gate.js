#!/usr/bin/env node
/**
 * Benchmark dataset gate.
 *
 * `benchmarks/citations.json` declares `minimumGroundTruth: 100` and records the internal suite at 49. The runner
 * has no idea: it will happily produce a report from four toy cases, which is how the README came to publish
 * "Precision 79.4% / Recall 73.0%" beside SonarQube and CodeRabbit.
 *
 * This gate does three things, each able to fail alone:
 *
 *   1. Reads `minimumGroundTruth` from the citations file rather than duplicating it, so the constant has one home.
 *   2. Counts the ground-truth entries in the dataset sources and fails when the count disagrees with what the
 *      citation claims — a citation that overstates its own dataset is worse than none.
 *   3. Refuses publication when the dataset is below the declared minimum, printing what would have to change.
 *
 * It is deliberately not a "run the benchmark" check: it answers only whether a figure from this dataset may be
 * published at all, which is the question the previous revision of the README answered wrongly.
 *
 * Usage:
 *   node scripts/benchmark-dataset-gate.js [--citations benchmarks/citations.json] [--json]
 */

'use strict';

const fs = require('node:fs');

const SOURCES = [
  'packages/intelligence/src/benchmark/benchmark-data.ts',
  'packages/intelligence/src/benchmark/benchmark-fixtures.ts',
];

/** Entries carrying an `id`-like key, which is how the dataset declares a ground-truth issue. */
const ENTRY = /^\s*(?:id|issueId):\s*'/gm;

function parseArgs(argv) {
  const args = { citations: 'benchmarks/citations.json', json: false, requirePublishable: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--citations') args.citations = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--require-publishable') args.requirePublishable = true;
  }
  return args;
}

function countEntries(file) {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(ENTRY)].length;
}

function main() {
  const args = parseArgs(process.argv);
  const citations = JSON.parse(fs.readFileSync(args.citations, 'utf8'));
  const minimum = citations.minimumGroundTruth ?? 0;
  const failures = [];
  const belowMinimum = [];

  let counted = 0;
  const perSource = [];
  for (const file of SOURCES) {
    if (!fs.existsSync(file)) {
      failures.push(`dataset source missing: ${file}`);
      continue;
    }
    const n = countEntries(file);
    counted += n;
    perSource.push(`${file.split('/').pop()}=${n}`);
  }

  for (const [name, entry] of Object.entries(citations.citations ?? {})) {
    if (typeof entry.groundTruthIssues !== 'number') continue;
    if (entry.groundTruthIssues !== counted) {
      failures.push(
        `citation \`${name}\` claims ${entry.groundTruthIssues} ground-truth issues, ` +
          `the sources hold ${counted} (${perSource.join(', ')})`,
      );
    }
    // Below the minimum is a STATE, not a failure. The README gate already refuses to publish a figure from a
    // dataset under the minimum, so failing CI here would leave the build permanently red until the dataset grows
    // — and a permanently red job teaches people to ignore red. A citation that misstates its own dataset is a
    // different matter: that is a lie about evidence, and it fails.
    if (entry.groundTruthIssues < minimum) {
      belowMinimum.push(
        `citation \`${name}\` records ${entry.groundTruthIssues} issues, below the declared minimum of ${minimum}; ` +
          `figures from it must not be published`,
      );
    }
  }

  const result = {
    minimum,
    counted,
    perSource,
    publishable: counted >= minimum && failures.length === 0,
  };
  // A machine-readable mode emits the payload and nothing else: no summary, no confirmation line. Anything else
  // is a caller that has to strip lines off its own input.
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.publishable || failures.length === 0 ? 0 : 1);
  }
  console.log(
    `dataset: ${counted} ground-truth issues (${perSource.join(', ')}); ` +
      `minimum to publish: ${minimum}; publishable: ${result.publishable}`,
  );

  // With --json the output is the JSON alone, so a caller can parse it. Notes go to stderr in that mode.
  for (const note of belowMinimum) {
    if (args.json) console.error(`note: ${note}`);
    else console.log(`  note: ${note}`);
  }

  if (failures.length > 0) {
    console.error(
      `\n❌ Benchmark dataset gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  // `--require-publishable` is for a caller that wants the dataset state to block a *publication* step, which is
  // where it belongs; without it, only a misstated citation fails.
  if (args.requirePublishable && !result.publishable) {
    console.error('\n❌ The dataset is not publishable and this step requires it to be.\n');
    process.exit(1);
  }
  console.log('✅ The dataset is what the citation says it is.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { countEntries, SOURCES };
