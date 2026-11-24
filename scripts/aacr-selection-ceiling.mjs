#!/usr/bin/env node
// @code-analyzer — How much of the answer key a better selector could reach, printed beside every run
//
// **The head-to-head says where this repository stands; this says how much room the reviewer has left.** Iteration 146
// asked the emission five questions - is the waste redundant, is it lexical duplication, does the pull request say
// anything, does the claim name the change, is another ordering better - and the answer was no to all five, with the
// shipped score still the best ranker among everything the artifact can see. So the next device cannot be a selector,
// and the useful figure is the one that says why: **how many reference comments name a code object no sentence of ours
// names.**
//
//     node scripts/aacr-selection-ceiling.mjs benchmarks/aacr-bench.json /tmp/aacr-bench/dataset/v1/positive_samples.json
//     node scripts/aacr-selection-ceiling.mjs run.json benchmarks/martian/positive_samples.json --json
//
// **The corpus file is an argument rather than a convention**, because the two boards this repository is measured on
// store their answer keys in the same shape and not in the same place, and a script that guessed would publish a ceiling
// over whichever file it happened to find.
//
// **What it cannot say, printed with the figure.** The measure is lexical: a sentence that describes a defect in words
// disjoint from the reference comment's words is counted unreachable, and that is a limit of the measure rather than of
// the reviewer. It is reported as a ceiling - an upper bound on what selection can do - and never as a verdict on the
// sentences themselves.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ceilingLine, selectionCeiling } from './lib/selection-ceiling.mjs';

function argv(tokens) {
  const options = { bench: null, corpus: null, json: false };
  for (const token of tokens) {
    if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.bench = null;
    else if (options.bench === null && !token.startsWith('-')) options.bench = token;
    else if (options.corpus === null && !token.startsWith('-')) options.corpus = token;
    else throw new Error(`unknown argument "${token}"`);
  }
  return options;
}

function load(path, what) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`no ${what} at ${full}`);
  return JSON.parse(readFileSync(full, 'utf8'));
}

/** Both boards store the answer key as a list of pull requests each carrying `comments[].note`. */
function corpusRows(document) {
  const rows = Array.isArray(document)
    ? document
    : (document?.data ?? Object.values(document ?? {})[0]);
  if (!Array.isArray(rows)) throw new Error('the corpus file carries no list of pull requests');
  return rows.map((row) => ({
    pullRequest: String(row?.githubPrUrl ?? row?.pullRequest ?? ''),
    comments: (row?.comments ?? []).map((comment) => String(comment?.note ?? '')),
  }));
}

/** The row set is the artifact's own coverage table, which is the only place it records a pull request's answer key. */
function ceilingRows(artifact, path) {
  const rows = artifact?.coverage?.byPullRequest;
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error(`${path} carries no coverage.byPullRequest, so its row set is unknown`);
  return rows.map((row) => ({
    pr: String(row?.pr ?? ''),
    goldens: Number(row?.goldens ?? 0),
    covered: row?.covered ?? [],
  }));
}

function main() {
  const options = argv(process.argv.slice(2));
  if (options.bench === null || options.corpus === null) {
    console.log(
      'usage: node scripts/aacr-selection-ceiling.mjs <artifact.json> <positive-samples.json> [--json]',
    );
    console.log(
      '  the corpus is required: the ceiling is a statement about reference comment text, and the artifact does not ' +
        'carry the answer key it was scored against',
    );
    return;
  }
  const artifact = load(options.bench, 'artifact');
  const findings = artifact?.rankedFindings;
  if (!Array.isArray(findings) || findings.length === 0)
    throw new Error(
      `${options.bench} carries no rankedFindings, so nothing was emitted to select from`,
    );

  const ceiling = selectionCeiling({
    findings,
    rows: ceilingRows(artifact, options.bench),
    corpus: corpusRows(load(options.corpus, 'corpus')),
  });

  if (options.json) {
    console.log(
      JSON.stringify({ benchmark: options.bench, corpus: options.corpus, ...ceiling }, null, 2),
    );
    return;
  }

  console.log(ceilingLine(ceiling));
  console.log(
    `  ${String(ceiling.referenceComments)} reference comments on this row set; a selector can reach ` +
      `${(ceiling.ceiling * 100).toFixed(1)}% of them and no selector can reach the other ` +
      `${(ceiling.unreachableShare * 100).toFixed(1)}%`,
  );
  if (ceiling.examples.length > 0) {
    console.log('  reference comments no cut of this emission could buy:');
    for (const example of ceiling.examples) {
      console.log(`    ${example.pullRequest.split('/').slice(-3).join('/')}  ${example.note}`);
    }
  }
  console.log(
    '  the measure is lexical, so a sentence describing a defect in words disjoint from the answer key counts as ' +
      'unreachable; the figure is an upper bound on selection and not a verdict on the sentences',
  );
}

main();
