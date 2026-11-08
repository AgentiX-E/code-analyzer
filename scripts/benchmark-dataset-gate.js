#!/usr/bin/env node
/**
 * Benchmark dataset gate.
 *
 * `benchmarks/citations.json` declares `minimumGroundTruth: 100` and records every dataset against it. The runner has
 * no idea: it will happily produce a report from four toy cases, which is how the README came to publish
 * "Precision 79.4% / Recall 73.0%" beside SonarQube and CodeRabbit.
 *
 * **A corpus that is generated rather than stored still has to declare its size.** The permission arm's hundred
 * modules are written from a `CORPUS` array at run time, so there is no directory of samples to count, and this gate
 * counted zero for it and refused the citation - `counted: 0, publishable: false` - which is the right answer to "I
 * cannot verify this number". The fix was a `PERMISSION_CORPUS_STATS` declaration plus a test that recomputes it from
 * the array; the gate did not gain a way to believe a number nobody checks.
 *
 * **What this gate got wrong, and how it was found.** It counted `id:` strings, and `benchmark-data.ts` uses `id:`
 * once per CASE while the cases carry their ground truth in a `groundTruth: [...]` array. So the file contributed 15
 * where it holds 30, the citation recorded 49 - 15 plus 34 - and the check `groundTruthIssues === counted` passed
 * because both sides used the same wrong unit. **A case count and an issue count were added together, and the seam was
 * invisible because the arithmetic agreed with itself.** The suite is 64.
 *
 * **The numbers are read from a declaration in each dataset, and a test proves the declaration is true.** This gate is
 * JavaScript and cannot import TypeScript, so each dataset exports a `totalGroundTruthIssues` constant;
 * `packages/intelligence/src/benchmark/__tests__/dataset-consistency.test.ts` imports the real arrays, recomputes both totals, and
 * fails when they disagree. A gate that read the array directly would need a TypeScript loader in CI's first step; a
 * declaration checked by a test is the same guarantee one layer over, and it fails in the same commit.
 *
 * It does three things, each able to fail alone:
 *
 *   1. Reads `minimumGroundTruth` from the citations file rather than duplicating it, so the constant has one home.
 *   2. Compares every citation against what its datasets declare - **per dataset when the citation lists them**, so a
 *      count and an issue count cannot be summed again.
 *   3. Refuses publication when the dataset is below the declared minimum, printing what would have to change.
 *
 * Usage:
 *   node scripts/benchmark-dataset-gate.js [--citations benchmarks/citations.json] [--json] [--require-publishable]
 */

'use strict';

const fs = require('node:fs');

/**
 * Datasets a citation may name without listing them, kept for citations written before `datasets` existed.
 *
 * Both are TypeScript and both declare their totals, so this is a set of paths rather than a set of numbers.
 */
const DEFAULT_SOURCES = [
  'packages/intelligence/src/benchmark/benchmark-data.ts',
  'packages/intelligence/src/benchmark/benchmark-fixtures.ts',
];

/** The declaration every dataset carries, and the two spellings of "how many samples". */
const GROUND_TRUTH_DECLARATION = /totalGroundTruthIssues:\s*(\d+)/;
const SAMPLES_DECLARATION = /total(?:Fixtures|Cases):\s*(\d+)/;

function parseArgs(argv) {
  const args = { citations: 'benchmarks/citations.json', json: false, requirePublishable: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--citations') args.citations = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--require-publishable') args.requirePublishable = true;
  }
  return args;
}

/**
 * What a dataset holds, as the dataset itself declares it.
 *
 * A `.json` dataset is counted by its length; a `.ts` dataset is read from its `*_STATS` constant. A file that
 * declares nothing returns `null` and the caller reports it rather than guessing, because a guessed count is the
 * defect this gate was written after.
 */
function datasetStats(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const parsed = JSON.parse(text);
    const length = Array.isArray(parsed) ? parsed.length : (parsed.issues?.length ?? 0);
    return { samples: length, groundTruthIssues: length };
  }
  const issues = GROUND_TRUTH_DECLARATION.exec(text);
  if (!issues) return null;
  const samples = SAMPLES_DECLARATION.exec(text);
  return {
    samples: samples ? Number(samples[1]) : null,
    groundTruthIssues: Number(issues[1]),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const citations = JSON.parse(fs.readFileSync(args.citations, 'utf8'));
  const minimum = citations.minimumGroundTruth ?? 0;
  const failures = [];
  const belowMinimum = [];

  let counted = 0;
  const perSource = new Set();
  const perCitation = {};

  for (const [name, entry] of Object.entries(citations.citations ?? {})) {
    // **A citation may list its datasets.** When it does, each one is checked on its own, because a sum of two
    // datasets in different units is exactly what produced the 49.
    // **Only a citation that names a countable dataset is counted, and it has to name one to be verified.** Three
    // shapes are allowed: `datasets[]` for a corpus split across modules, `countFrom` for a single file that
    // enumerates the ground truth, and neither - which is a corpus somebody else published, where the count is
    // recorded rather than computed and `groundTruthSource` has to say where it came from.
    const datasets =
      Array.isArray(entry.datasets) && entry.datasets.length > 0
        ? entry.datasets.map((dataset) => ({
            file: dataset.source,
            declared: { samples: dataset.samples, groundTruthIssues: dataset.groundTruthIssues },
          }))
        : typeof entry.countFrom === 'string'
          ? [{ file: entry.countFrom, declared: null }]
          : [];

    let issues = 0;
    let samples = 0;
    const detail = [];
    let complete = datasets.length > 0;

    // A corpus this project did not author: the number is a record, and what makes it checkable is the sentence
    // naming where it came from. A bare number with no source is the thing this gate exists to refuse.
    if (datasets.length === 0) {
      if (typeof entry.groundTruthSource !== 'string' || entry.groundTruthSource.trim() === '') {
        failures.push(
          `citation \`${name}\` names no countable dataset and no \`groundTruthSource\` - a number nobody can ` +
            `trace to a corpus is a number nobody can check`,
        );
        complete = false;
      }
      issues = entry.groundTruthIssues ?? 0;
      samples = entry.samples ?? 0;
      detail.push(`declared=${String(issues)}`);
    }

    for (const dataset of datasets) {
      if (!fs.existsSync(dataset.file)) {
        failures.push(`dataset source missing: ${dataset.file} (named by citation \`${name}\`)`);
        complete = false;
        continue;
      }
      const stats = datasetStats(dataset.file);
      if (stats === null) {
        failures.push(
          `dataset \`${dataset.file}\` declares no \`totalGroundTruthIssues\` - a dataset that cannot say how many ` +
            `issues it holds cannot be checked against a floor`,
        );
        complete = false;
        continue;
      }
      issues += stats.groundTruthIssues;
      samples += stats.samples ?? 0;
      const short = dataset.file.split('/').pop() ?? dataset.file;
      detail.push(`${short}=${String(stats.groundTruthIssues)}`);
      perSource.add(`${short}=${String(stats.groundTruthIssues)}`);

      // **Per dataset, when the citation names a number for it.** This is the check that would have caught 15 beside
      // 34: the two are compared in their own units before anything is added.
      if (
        dataset.declared !== null &&
        dataset.declared.groundTruthIssues !== stats.groundTruthIssues
      ) {
        failures.push(
          `citation \`${name}\` says \`${dataset.file}\` holds ` +
            `${String(dataset.declared.groundTruthIssues)} ground-truth issues; it declares ` +
            `${String(stats.groundTruthIssues)} (${detail.at(-1)})`,
        );
      }
    }

    perCitation[name] = { counted: issues, samples, sources: detail };
    if (complete) counted = Math.max(counted, issues);

    if (entry.groundTruthIssues !== undefined && entry.groundTruthIssues !== issues) {
      failures.push(
        `citation \`${name}\` claims ${String(entry.groundTruthIssues)} ground-truth issues, ` +
          `its sources hold ${String(issues)} (${detail.join(', ') || 'none'})`,
      );
    }
    if (entry.samples !== undefined && samples > 0 && entry.samples !== samples) {
      failures.push(
        `citation \`${name}\` claims ${String(entry.samples)} samples, its sources hold ${String(samples)}`,
      );
    }

    // Below the minimum is a STATE, not a failure. The numbers gate already refuses to let a figure from a dataset
    // under the minimum be published, so failing CI here would leave the build permanently red until the dataset
    // grows - and a permanently red job teaches people to ignore red. A citation that misstates its own dataset is a
    // different matter: that is a lie about evidence, and it fails.
    if ((entry.groundTruthIssues ?? 0) < minimum) {
      belowMinimum.push(
        `citation \`${name}\` records ${String(entry.groundTruthIssues)} issues, below the declared minimum of ` +
          `${String(minimum)}; figures from it must not be published`,
      );
    }
  }

  // **Publishable means a citation whose OWN dataset reaches the minimum**, not that the largest one does.
  const publishableFrom = Object.entries(perCitation)
    .filter(([, value]) => value.counted >= minimum)
    .map(([name]) => name);
  const result = {
    minimum,
    counted,
    perSource: [...perSource],
    perCitation,
    publishableFrom,
    publishable: publishableFrom.length > 0 && failures.length === 0,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(failures.length === 0 ? 0 : 1);
  }

  console.log(
    `dataset: ${String(counted)} ground-truth issues (${result.perSource.join(', ')}); ` +
      `minimum to publish: ${String(minimum)}; publishable: ${String(result.publishable)}`,
  );
  for (const note of belowMinimum) console.log(`  note: ${note}`);

  if (failures.length > 0) {
    console.error(
      `\n❌ Benchmark dataset gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  if (args.requirePublishable && !result.publishable) {
    console.error('\n❌ The dataset is not publishable and this step requires it to be.\n');
    process.exit(1);
  }
  console.log('✅ The dataset is what the citation says it is.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { datasetStats, DEFAULT_SOURCES };
