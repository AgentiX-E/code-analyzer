#!/usr/bin/env node
// @code-analyzer — Read an AACR artifact's new detail layers and refuse one that does not add up
//
// **What this adds to `aacr-paired-replay.mjs --check`.** That script recomputes the *score* from the judged pairs. This
// one recomputes the *decomposition*: the full attribution list, the per-category split of the true positives, and the
// count of goldens neither reviewer found. All three were added in iteration 124 because three stage pages in a row had
// listed the analysis they enable as the next step, and the artifact could not support it.
//
// **The failure it is written to catch is the quiet one.** A table that reports 39 true positives and a per-category
// column that adds to 73 is not a wrong number in isolation - it is two readings of one run, one of which is an estimate
// wearing the other's name. The check compares them.
//
//     node scripts/aacr-bench-audit.mjs --bench benchmarks/aacr-bench.json --check
//
// **`--check` is the mode the workflow runs**, before the artifact is uploaded: a run whose own detail layers do not add
// up must fail where it produced them, not two arms later in a comparison built on them.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditArtifact,
  formatAudit,
  formatBothMissed,
  summariseBothMissed,
} from './lib/artifact-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function argv(tokens) {
  const options = { bench: null, check: false, json: false, ceiling: false };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--check') options.check = true;
    else if (token === '--ceiling') options.ceiling = true;
    else if (token === '--json') options.json = true;
    else if (token === '--bench') options.bench = tokens[(at += 1)] ?? null;
  }
  return options;
}

function main() {
  const options = argv(process.argv.slice(2));
  const path = resolve(REPO, options.bench ?? 'benchmarks/aacr-bench.json');
  if (!existsSync(path)) {
    // **A missing artifact is a failure rather than a skip**, because the caller that matters is a workflow step whose
    // whole purpose is to read the file the previous step wrote.
    console.error(`no artifact at ${path}`);
    process.exit(2);
  }
  const artifact = JSON.parse(readFileSync(path, 'utf8'));

  // **`--ceiling` is the reading, not the check.** It prints the goldens neither reviewer found, grouped three ways,
  // because the next device should be designed from that table rather than from a guess about which bucket is largest.
  if (options.ceiling) {
    const summary = summariseBothMissed(artifact);
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(formatBothMissed(summary));
    if (summary.total === 0) {
      // **An empty ceiling is a fact worth failing on when it was asked for by name**: either the run found every golden
      // nobody else found, or the list was not written - and the second is far more likely.
      console.error('\nthe artifact carries no bothMissed rows');
      process.exit(2);
    }
    return;
  }

  const audit = auditArtifact(artifact);

  if (options.json) console.log(JSON.stringify(audit, null, 2));
  else console.log(formatAudit(audit));

  if (options.check && !audit.ok) {
    const failed = audit.findings.filter((finding) => !finding.ok).map((finding) => finding.name);
    console.error(`\nthe artifact's detail layers do not add up: ${failed.join('; ')}`);
    process.exit(1);
  }
  console.log(
    `\n${audit.findings.length} checks · ${audit.ok ? 'all consistent' : 'inconsistent'}`,
  );
}

main();
