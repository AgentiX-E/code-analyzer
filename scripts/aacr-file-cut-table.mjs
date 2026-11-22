#!/usr/bin/env node
// @code-analyzer — Price a cut of one run under the corpus's arithmetic, from the artifact that already paid for it
//
// **The corpus's arithmetic charges every comment; the pairwise one does not.** That difference is not a detail of a
// scorer - it is the difference between a gate being measurable and a gate being worthless. §85 falsified every
// pre-judge gate in this tree with an argument that holds only for the pairwise instrument: a finding that stands where
// no reference comment stands is never asked about, so removing it changes no counter. **Under `file-level-semantic-v1`
// every comment is charged**: §139's run emitted 307 and 216 of them covered nothing at all, and each one costs
// precision by construction.
//
// So the question "which comments should a reviewer file" is worth roughly its own price under one instrument and
// exactly zero under the other, and until this run the second instrument's per-comment verdicts were summed and thrown
// away. `rankedFindings[].fileLevelGoldens` is that field; this script is the arithmetic over it.
//
//     node scripts/aacr-file-cut-table.mjs benchmarks/aacr-bench.json
//     node scripts/aacr-file-cut-table.mjs run.json --cut drop:architecture
//
// **Why a script.** Every row below is recomputable from the artifact and this file, which is the property
// `docs/EVAL-CONTRACT.md` requires of a number it publishes. A table typed into a report is a table nobody can refute.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreFileCut } from './lib/file-cut.mjs';
import { applyCut, describeCut, parseCut, registeredCuts } from './lib/operating-point.mjs';

function argv(tokens) {
  const options = { bench: null, cut: null, json: false, gate: [], agreement: 0 };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--bench') options.bench = tokens[(at += 1)] ?? '';
    else if (token === '--cut') options.cut = tokens[(at += 1)] ?? null;
    else if (token === '--gate') options.gate.push(...String(tokens[(at += 1)] ?? '').split(','));
    else if (token === '--min-agreement') options.agreement = Number(tokens[(at += 1)] ?? 0);
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.bench = null;
    else if (options.bench === null && !token.startsWith('-')) options.bench = token;
    else throw new Error(`unknown argument "${token}"`);
  }
  return options;
}

/**
 * **The claim-shape predicates, as a diagnostic rather than as a policy.**
 *
 * §140 tested five of these as candidate precision devices and **all five cost F1** - and the flag exists so that
 * refutation can be repeated from the artifact rather than taken on a report's word. **It is deliberately not a step in
 * the emission policy**: `packages/intelligence/src/review/emission-policy.ts` is the shipped rule and it takes
 * categories, path classes and a budget, because *"a rule language with more expressive power than the campaign has
 * hypotheses is a rule language that can fit the corpus"*. A predicate that survives only in a document's negative
 * result must not reach the product, and it must still be runnable.
 *
 * `hedged` is inverted on purpose: the hypothesis is that a hedged claim is a guess, so `not-hedged` is the predicate
 * and a caller who wants "hedged" spells it as the absence of the others.
 */
const PREDICATES = {
  grounded: (features) => features?.grounded === true,
  'quotes-diff': (features) => features?.quotesDiff === true,
  'names-symbol': (features) => features?.namesSymbol === true,
  'proposes-change': (features) => features?.proposesChange === true,
  'not-hedged': (features) => features?.hedged !== true,
};

function keepByPredicates(finding, names, agreement) {
  for (const name of names) {
    const predicate = PREDICATES[name];
    if (predicate === undefined) throw new Error(`"${name}" is not a claim-shape predicate`);
    if (!predicate(finding?.features)) return false;
  }
  return Number(finding?.features?.agreement ?? 0) >= agreement;
}

/**
 * **The per-finding verdicts the corpus's arithmetic reads, and the refusal when the artifact predates the field.**
 *
 * `null` is not `[]`: a finding whose second-instrument verdict is absent keeps the pairwise one, which is §137.5's
 * fallback. An artifact that carries the field on no row at all is a run from before this instrument existed, and
 * scoring it anyway would report the pairwise verdicts under the file-shaped protocol's name.
 */
function loadArtifact(path) {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`no artifact at ${full}`);
  const artifact = JSON.parse(readFileSync(full, 'utf8'));
  const findings = artifact?.rankedFindings;
  if (!Array.isArray(findings) || findings.length === 0)
    throw new Error(`${path} carries no rankedFindings, so no cut of it can be scored`);
  const carried = findings.filter((entry) => Array.isArray(entry?.fileLevelGoldens)).length;
  if (carried === 0)
    throw new Error(
      `${path} carries no fileLevelGoldens on any finding, so it cannot be scored under the corpus's ` +
        'arithmetic: dispatch the bench with file_semantic_judge=on, which now files those verdicts',
    );
  const published = artifact?.['fullEmission'] ?? artifact;
  const goldens =
    Number(published?.['truePositives'] ?? 0) + Number(published?.['falseNegatives'] ?? 0);
  if (!Number.isFinite(goldens) || goldens <= 0)
    throw new Error(`${path} does not say how many goldens it was scored against`);
  return { artifact, findings, goldens, carried };
}

/**
 * **One cut, scored the way the corpus scores it.**
 *
 * The findings are cut globally and then **grouped by pull request before the walk**, because golden indices are per
 * pull request: two pull requests both numbering their goldens from zero would otherwise share coverage the corpus holds
 * apart.
 *
 * **The goldens handed to the scorer carry no path, and that is correct for this data rather than a shortcut.** The
 * file-level protocol shows one file's reference comments at a time, so a verdict it returns cannot be about another
 * file's golden - the cross-file refusal inside `scoreFileSemantic` has nothing to refuse, and an empty path is the
 * honest description of "this scorer was not given a coordinate it does not need". The count of unlocated goldens in the
 * result is therefore the corpus's size and not a defect; it is replaced below so a reader cannot mistake it for one.
 */
function scoreCut(findings, steps, goldens) {
  return scoreFileCut({
    findings: applyCut(findings, steps),
    goldens,
    matchesOf: (finding) => finding.fileLevelGoldens ?? finding.matchedGoldens ?? [],
  });
}

const HEADER = `${'cut'.padEnd(38)}    n  new   cov       P       R      F1    dF1`;

function formatRow(label, point, baseline, width = 38) {
  const delta = baseline === null ? '' : ((point.f1 - baseline) * 100).toFixed(2);
  return [
    label.padEnd(width),
    String(point.emitted).padStart(5),
    String(point.hitNewGt).padStart(4),
    String(point.coveredGoldens).padStart(5),
    point.precision.toFixed(4).padStart(7),
    point.recall.toFixed(4).padStart(7),
    point.f1.toFixed(4).padStart(7),
    delta.padStart(7),
  ].join(' ');
}

function main() {
  const options = argv(process.argv.slice(2));
  if (options.bench === null) {
    console.log(
      'usage: node scripts/aacr-file-cut-table.mjs <artifact.json> [--cut <cut>] [--gate <predicate,...>] ' +
        '[--min-agreement <n>] [--json]',
    );
    console.log(
      '  the artifact must carry rankedFindings[].fileLevelGoldens, which needs file_semantic_judge=on',
    );
    console.log('  predicates: grounded, quotes-diff, names-symbol, proposes-change, not-hedged');
    return;
  }
  const { findings: all, goldens, carried } = loadArtifact(options.bench);
  const findings = all.filter((finding) =>
    keepByPredicates(finding, options.gate, options.agreement),
  );
  const gated = all.length - findings.length;
  const cuts =
    options.cut === null
      ? [
          { steps: parseCut('drop:test+drop-path:test+budget:12'), label: 'as shipped' },
          ...registeredCuts(),
        ]
      : [{ steps: parseCut(options.cut), label: options.cut }];
  const rows = cuts.map((cut) => ({
    cut: cut.label ?? describeCut(cut.steps),
    steps: cut.steps,
    ...scoreCut(findings, cut.steps, goldens),
  }));
  const baseline = rows[0].f1;
  if (options.json) {
    console.log(
      JSON.stringify({ benchmark: options.bench, goldens, filed: carried, rows }, null, 2),
    );
    return;
  }
  console.log(
    `${options.bench}  (${findings.length} findings, ${goldens} goldens, verdicts filed on ${carried}` +
      `${gated === 0 ? '' : `, ${gated} removed by the claim-shape diagnostic`})`,
  );
  console.log(HEADER);
  for (const row of rows) console.log(formatRow(row.cut, row, baseline));
  console.log(
    'dF1 is in points against the first row; the corpus resolves about 2.40 points on this slice, so a ' +
      'row inside +-2.40 is the same point as the first one',
  );
}

main();
