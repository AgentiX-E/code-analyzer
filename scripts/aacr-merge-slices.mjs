#!/usr/bin/env node
// **The two halves of one corpus, merged into the two artifacts the comparison job reads.**
//
//     node scripts/aacr-merge-slices.mjs --with A-with.json B-with.json --without A-without.json B-without.json --out DIR
//
// `mergeSlices` holds the rules; this is the command that applies them to a directory of dispatches so that the corpus bar
// can be computed on two hundred rows instead of a hundred. **It writes into `DIR` rather than over its inputs**, because
// a tool that overwrites the artifacts it merged destroys the record of where the merged rows came from.
//
// The exit code is the outcome: zero when both sides merged, non-zero when a refusal fired, and the refusal is printed
// with the same words the library uses - a merge that silently dropped a row would be a corpus nobody could check.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeSlices } from './lib/slice-merge.mjs';

function parseArguments(argv) {
  const options = { with: [], without: [], out: null };
  let current = null;
  for (const argument of argv) {
    if (argument.startsWith('--')) {
      const name = argument.slice(2);
      if (name !== 'with' && name !== 'without' && name !== 'out') {
        throw new Error(`unknown option ${argument}`);
      }
      current = name;
      continue;
    }
    if (current === null) throw new Error(`unexpected argument ${argument}`);
    // **A list until the next option**, because one arm is one artifact per slice and `--with a b` has to mean two files.
    if (current === 'out') {
      options.out = argument;
      current = null;
    } else {
      options[current].push(argument);
    }
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.with.length === 0 || options.without.length === 0) {
    console.error('a merge needs --with <artifact...> and --without <artifact...>');
    process.exitCode = 2;
    return;
  }
  if (options.out === null) {
    console.error('a merge needs --out <directory>; it does not write over the artifacts it read');
    process.exitCode = 2;
    return;
  }
  if (options.with.length !== options.without.length) {
    console.error(
      `both arms need one artifact per slice, received ${String(options.with.length)} with and ${String(options.without.length)} without`,
    );
    process.exitCode = 2;
    return;
  }

  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const directory = resolve(options.out);
  mkdirSync(directory, { recursive: true });

  let merged;
  try {
    merged = {
      with: mergeSlices(options.with.map(read)),
      without: mergeSlices(options.without.map(read)),
    };
  } catch (error) {
    // **The library's refusals are the message**, not a stack trace: each names the row, the configuration or the missing
    // slice, and each wants a different repair.
    console.error(`AACR-MERGE refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  for (const arm of ['with', 'without']) {
    const artifact = merged[arm];
    writeFileSync(resolve(directory, `${arm}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    const slices = artifact.corpusSlice.slices.map(
      (slice) => `skip ${String(slice.skip)} max ${String(slice.max)}`,
    );
    console.log(
      `AACR-MERGE ${arm.padEnd(7)} · ${String(artifact.prsReviewed)} pull requests · ${slices.join(' + ')} · F1 ${artifact.f1.toFixed(4)} · TP ${String(artifact.truePositives)} FP ${String(artifact.falsePositives)} FN ${String(artifact.falseNegatives)}`,
    );
  }
  console.log(
    `AACR-MERGE wrote ${resolve(directory, 'with.json')} and ${resolve(directory, 'without.json')} · feed both to aacr-ablation-compare.mjs`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
