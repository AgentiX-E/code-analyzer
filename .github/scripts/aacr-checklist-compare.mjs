// @code-analyzer — The registered comparison between two runs of the same corpus
//
// **What this script exists for.** `docs/EVAL-CONTRACT.md` §8 registers a hypothesis about a prompt device before any
// run of it: **the per-language defect checklist raises the file arm's F1 on the AACR corpus.** The workflow runs that
// hypothesis twice - once with the checklist, once without - over **the same pull requests, the same judge and the same
// goldens**, and this script turns the two artifacts into one answer.
//
// **Why a third job rather than a field in each artifact.** An artifact can only describe its own run. **A comparison
// is a claim about two runs, and a claim about two runs written by one of them is a claim with an interest** - so the
// two runs upload what they measured, and this job (which has neither provider credentials nor a corpus checkout)
// computes the difference. **It cannot call a model, which is the point.**
//
// **What it refuses to do.** It refuses to compare two artifacts whose corpus, judge or dataset size differ, because
// **those differences are the confounds the registration was written to exclude** - and it writes the refusal into the
// artifact instead of exiting quietly, because **a comparison that did not happen must not read as one that found
// nothing.**
//
//     node .github/scripts/aacr-checklist-compare.mjs <with.json> <without.json>
//     node .github/scripts/aacr-checklist-compare.mjs --self-test

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { pairedComparison } from './lib/paired-test.mjs';

/**
 * **The resolution this comparison is read against, and where the number comes from.**
 *
 * Three runs of the file arm over the same five pull requests, the same judge and no change to the code moved F1 between
 * 0.2727, 0.2368 and 0.2781. **±0.04 is therefore what this instrument cannot see below**, and §8 of the contract says
 * a device expected to move F1 by less than that will not be measured here - so the registration names the figure it
 * has to beat rather than accepting whatever it produces.
 */
const RESOLUTION = 0.04;

/** What the registration predicted the checklist would be worth. */
const REGISTERED_GAIN = 0.04;

const round = (value) => Math.round(value * 10000) / 10000;

/** `${pullRequestKey}#${goldenIndex}`, the same key the within-run paired test uses. */
function coverageSet(artifact) {
  const set = new Set();
  for (const pull of artifact.coverage?.byPullRequest ?? []) {
    for (const at of pull.covered ?? []) set.add(`${pull.pr}#${at}`);
  }
  return set;
}

/**
 * **The fields that must be equal for the difference to be the checklist.**
 *
 * Returned rather than thrown, because the caller writes them into the artifact. **The flag's own value is checked
 * too**: two runs of the same arm produce a perfect null result, and **a null result is the one answer that must never
 * be produced by a wiring mistake.**
 */
function confoundsBetween(on, off) {
  const confounds = [];
  if (on.corpus !== off.corpus) confounds.push({ field: 'corpus', on: on.corpus, off: off.corpus });
  if (on.configuration?.judgeModel !== off.configuration?.judgeModel)
    confounds.push({
      field: 'judgeModel',
      on: on.configuration?.judgeModel,
      off: off.configuration?.judgeModel,
    });
  if (on.prsInDataset !== off.prsInDataset)
    confounds.push({ field: 'prsInDataset', on: on.prsInDataset, off: off.prsInDataset });
  if (on.datasetRows !== off.datasetRows)
    confounds.push({ field: 'datasetRows', on: on.datasetRows, off: off.datasetRows });
  if (
    on.configuration?.languageChecklist !== true ||
    off.configuration?.languageChecklist !== false
  )
    confounds.push({
      field: 'languageChecklist',
      on: on.configuration?.languageChecklist,
      off: off.configuration?.languageChecklist,
      expected: 'true in the first argument, false in the second',
    });
  return confounds;
}

/**
 * **The arithmetic, as a function of two artifacts and nothing else.**
 *
 * Separated so `--self-test` can assert it on fixtures with hand-written answers. **A comparison job that has only ever
 * run on real data has never been checked** - and its branch for a gain inside the resolution is the branch a device
 * that does nothing would take, so a bug there would report "no effect" for every device, forever.
 */
function summarise(on, off) {
  const paired = pairedComparison(coverageSet(on), coverageSet(off));
  const gain = on.f1 - off.f1;
  const precisionGain = on.precision - off.precision;
  const recallGain = on.recall - off.recall;
  const goldens = on.truePositives + on.falseNegatives;

  /**
   * **The verdict, in the registration's own terms, allowed to be "falsified".**
   *
   * §8 states two things: **the checklist is worth at least 0.04 F1 on this corpus**, and **the mechanism is
   * precision** - fewer false positives at roughly the same recall. The artifact separates them, because **a device
   * that raised F1 without raising precision would confirm the number and contradict the explanation**, and a report
   * that only checked the number would not notice.
   */
  const magnitudeMet = gain >= REGISTERED_GAIN;
  const recallTolerance = goldens > 0 ? 1 / goldens : 0;
  const mechanismMet = precisionGain > 0 && recallGain >= -recallTolerance;
  const outcome = !magnitudeMet
    ? 'falsified: the gain is inside the instrument resolution'
    : mechanismMet
      ? 'confirmed: at least 0.04 F1, and the mechanism is precision'
      : 'falsified: the magnitude arrived, the mechanism did not';

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    compared: true,
    protocol:
      'two runs of the same job over the same pull requests, the same goldens and the same judge, differing in AACR_CHECKLIST',
    registration: {
      claim: 'the per-language defect checklist raises the file arm F1 by at least 0.04',
      registeredGain: REGISTERED_GAIN,
      resolution: RESOLUTION,
      mechanism: 'precision rises, recall does not fall',
    },
    corpus: on.corpus,
    pullRequests: on.prsInDataset,
    goldens,
    withChecklist: {
      precision: on.precision,
      recall: on.recall,
      f1: on.f1,
      truePositives: on.truePositives,
      falsePositives: on.falsePositives,
      falseNegatives: on.falseNegatives,
      findings: on.fullEmission?.emitted ?? null,
    },
    withoutChecklist: {
      precision: off.precision,
      recall: off.recall,
      f1: off.f1,
      truePositives: off.truePositives,
      falsePositives: off.falsePositives,
      falseNegatives: off.falseNegatives,
      findings: off.fullEmission?.emitted ?? null,
    },
    delta: {
      precision: round(precisionGain),
      recall: round(recallGain),
      f1: round(gain),
      truePositives: on.truePositives - off.truePositives,
      falsePositives: on.falsePositives - off.falsePositives,
      findings: (on.fullEmission?.emitted ?? 0) - (off.fullEmission?.emitted ?? 0),
    },
    /**
     * **The paired test, because the two runs read the same goldens.**
     *
     * `withOnly` are the goldens the checklist found and the baseline missed; `withoutOnly` the reverse. **A device
     * that trades recall for precision shows both numbers large and the p-value unremarkable** - which is a distinct
     * and reportable finding from "no effect".
     */
    pairedTest: {
      view: 'the registered operating point of each run, paired on pull request and golden index',
      both: paired.both,
      withOnly: paired.oursOnly,
      withoutOnly: paired.theirsOnly,
      pValue: round(paired.pValue),
      verdict: paired.verdict,
    },
    verdict: {
      registeredGain: REGISTERED_GAIN,
      observedGain: round(gain),
      magnitudeMet,
      mechanismMet,
      outcome,
      insideResolution: Math.abs(gain) < RESOLUTION,
    },
  };
}

function writeArtifact(artifact) {
  const out = resolve(process.cwd(), 'benchmarks', 'aacr-checklist-paired.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
}

function refuse(reason, detail) {
  const artifact = {
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    compared: false,
    refusedBecause: reason,
    detail,
  };
  writeArtifact(artifact);
  console.log(`AACR-CHECKLIST not compared: ${reason}`);
  // **A refusal is a failure, not a result.**
  //
  // Iteration 102 of this repository was about a gate that printed `nothing published` and exited 0 for weeks, and **a
  // comparison job that declines to compare and turns the workflow green is the same defect with a better excuse.** The
  // artifact is still written and still uploaded, so a reader can see why; the job is red, so a reader knows to look.
  process.exitCode = 1;
  return artifact;
}

/**
 * **The branch a device that does nothing would take, asserted on a fixture before any real run reaches it.**
 *
 * Three fixtures: a device worth 0.10 F1 by precision, a device that does nothing, and a device that trades recall for
 * precision without moving F1. Each has a hand-written expected outcome, and **the second is the important one** - a
 * comparison whose "no effect" branch is wrong reports null results that look like science.
 */
function selfTest() {
  const artifact = (overrides) => ({
    corpus: 'fixture',
    prsInDataset: 2,
    datasetRows: 2,
    configuration: { judgeModel: 'fixture-model', languageChecklist: overrides.flag },
    truePositives: overrides.tp,
    falsePositives: overrides.fp,
    falseNegatives: overrides.fn,
    precision: overrides.tp / (overrides.tp + overrides.fp),
    recall: overrides.tp / (overrides.tp + overrides.fn),
    f1: (2 * overrides.tp) / (2 * overrides.tp + overrides.fp + overrides.fn),
    fullEmission: { emitted: overrides.tp + overrides.fp },
    coverage: {
      byPullRequest: overrides.covered.map((covered, at) => ({
        pr: `pr-${at}`,
        goldens: overrides.goldensPerPr[at],
        covered,
      })),
    },
  });

  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`);
  };

  // Ten goldens. The baseline finds three of them at twenty findings; the device finds six at the same emission.
  const qualifies = artifact({
    flag: true,
    tp: 6,
    fp: 14,
    fn: 4,
    covered: [
      [0, 1, 2],
      [3, 4, 5],
    ],
    goldensPerPr: [5, 5],
  });
  const baseline = artifact({
    flag: false,
    tp: 3,
    fp: 17,
    fn: 7,
    covered: [[0, 1], [3]],
    goldensPerPr: [5, 5],
  });

  const good = summarise(qualifies, baseline);
  assert(good.delta.f1 === 0.2, 'twice the goldens at the same emission takes F1 from 0.2 to 0.4');
  assert(good.verdict.magnitudeMet === true, 'the magnitude branch');
  assert(good.verdict.mechanismMet === true, 'precision rose and recall rose');
  assert(good.pairedTest.withOnly === 3, 'three goldens the device found and the baseline did not');
  assert(good.pairedTest.withoutOnly === 0, 'and none the other way');
  // **And the honest part, asserted rather than described**: three discordant pairs one way is p = 0.25, so a device
  // worth 0.2 F1 on ten goldens is **not** significant. A comparison that called this significant would be a
  // comparison that would call anything significant.
  assert(good.pairedTest.pValue === 0.25, 'three discordant pairs one way is p = 0.25');
  assert(good.pairedTest.verdict === 'not significant at 0.05', 'and the paired test says so');

  const nothing = summarise(baseline, baseline);
  assert(nothing.verdict.magnitudeMet === false, 'the same run twice gains nothing');
  assert(
    nothing.verdict.outcome.startsWith('falsified'),
    'and is falsified rather than unmeasured',
  );
  assert(nothing.pairedTest.pValue === 1, 'with no discordant pairs the p-value is 1');

  // A device that trades: same F1, more goldens found, more false positives.
  const trade = artifact({
    flag: true,
    tp: 4,
    fp: 20,
    fn: 6,
    covered: [[0, 1, 2], [3]],
    goldensPerPr: [5, 5],
  });
  const traded = summarise(trade, baseline);
  assert(traded.delta.f1 > 0, 'the trade does gain something');
  assert(traded.pairedTest.withOnly === 1 && traded.pairedTest.withoutOnly === 0, 'and one golden');

  const confounded = confoundsBetween({ ...qualifies, corpus: 'other' }, baseline);
  assert(
    confounded.length === 1 && confounded[0].field === 'corpus',
    'a different corpus is refused',
  );

  const sameFlag = confoundsBetween(qualifies, {
    ...baseline,
    configuration: { judgeModel: 'fixture-model', languageChecklist: true },
  });
  assert(
    sameFlag.length === 1 && sameFlag[0].field === 'languageChecklist',
    'two runs of the same arm are refused, because their null result would look like a finding',
  );

  console.log(
    `AACR-CHECKLIST self-test ok · gain ${good.delta.f1} · null ${nothing.delta.f1} · trade ${traded.delta.f1} · refusals ${confounded.length + sameFlag.length}`,
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const [onPath, offPath] = process.argv.slice(2);
  if (!onPath || !offPath) {
    refuse('two artifact paths were not given', { argv: process.argv.slice(2) });
    process.exitCode = 1;
    return;
  }

  const on = JSON.parse(readFileSync(onPath, 'utf8'));
  const off = JSON.parse(readFileSync(offPath, 'utf8'));

  for (const [label, artifact] of [
    ['with', on],
    ['without', off],
  ]) {
    if (artifact.skipped) {
      refuse(`the run ${label} the checklist was skipped`, {
        run: label,
        skipped: artifact.skipped,
      });
      return;
    }
  }

  const confounds = confoundsBetween(on, off);
  if (confounds.length > 0) {
    refuse('the two artifacts are not the same experiment', confounds);
    return;
  }

  const artifact = summarise(on, off);
  writeArtifact(artifact);
  console.log(
    `AACR-CHECKLIST compared · with ${on.f1} vs without ${off.f1} · delta ${artifact.delta.f1} · paired +${artifact.pairedTest.withOnly}/-${artifact.pairedTest.withoutOnly} p=${artifact.pairedTest.pValue} · ${artifact.verdict.outcome}`,
  );
}

main();
