// @code-analyzer — The registered comparison between the two arms of whichever hypothesis is under test
//
// **What this script exists for.** `docs/EVAL-CONTRACT.md` registers a hypothesis before any run of it, and the
// workflow runs that hypothesis twice - one arm with the device, one without - over **the same pull requests, the same
// judge and the same goldens**. This script turns the two artifacts into one answer, and **it is generic in the device on
// purpose**: §8's per-language checklist has been measured and falsified, §19's category floor replaced it, and a
// comparison job that could only compare the retired device would be a job that keeps measuring nothing.
//
// **So the varied field is read from the artifacts rather than assumed.** The two configurations must differ in exactly
// one key; that key is the variable, its two values are the arms, and the registration the verdict is read against is
// looked up by that key. **A job that hard-codes which flag it varies is a job that silently stops varying anything the
// day the hypothesis changes** - and the day that happens, this job would publish a comparison of two identical runs.
//
// **Why a third job rather than a field in each artifact.** An artifact can only describe its own run. **A comparison is
// a claim about two runs, and a claim about two runs written by one of them is a claim with an interest** - so the two
// runs upload what they measured, and this job (which has neither provider credentials nor a corpus checkout) computes
// the difference. **It cannot call a model, which is the point.**
//
// **What it refuses to do.** It refuses to compare two artifacts whose corpus, judge, dataset size or *corpus actually
// read* differ, and it refuses a pair that differs in no configuration key or in more than one - because **those are the
// confounds the registration was written to exclude** - and it writes the refusal into the artifact instead of exiting
// quietly, because **a comparison that did not happen must not read as one that found nothing.**
//
//     node .github/scripts/aacr-ablation-compare.mjs <with.json> <without.json>
//     node .github/scripts/aacr-ablation-compare.mjs --self-test

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { pairedComparison } from './lib/paired-test.mjs';

/**
 * **The registrations this job knows how to read a verdict against, keyed by the configuration field they vary.**
 *
 * Each one is a sentence that was written down before its run, in `docs/EVAL-CONTRACT.md`, and each one carries the
 * mechanism as well as the magnitude - because **a device that raised F1 without the mechanism it claimed would confirm
 * the number and contradict the explanation**, and a report that only checked the number would not notice.
 */
export const REGISTRATIONS = Object.freeze({
  languageChecklist: {
    section: '§8',
    claim: 'the per-language defect checklist raises the file arm F1 by at least 0.04',
    registeredGain: 0.04,
    mechanism: 'precision rises, recall does not fall',
    // **Empty, and that is the correct value rather than an omission.** A falsified device needs no confirmation: §8's
    // checklist was measured at −0.0292 with p = 0.0049 on its own confirmation run, so the registration is closed and
    // a slice list here would be a promise to spend money re-reading a verdict that has already been read.
    confirmation: [],
  },
  emissionProfile: {
    section: '§19 (R-17)',
    claim:
      'emitting only the categories whose measured acceptance reaches 0.22 raises the file arm F1 by at least 0.02',
    registeredGain: 0.02,
    mechanism: 'precision rises and recall falls by less than precision rises',
    // **The hundred pull requests the discovery did not see, in one dispatch - and the split into two fifties was written
    // here first and then withdrawn by measurement.** The split was argued from 3.29 minutes per pull request, a figure
    // that came from the fourteen-pull-request run of §15.6; the fifty-pull-request run of 2026-11-10 (workflow run
    // 42823966835) took 61.0 and 79.7 minutes for its two arms, which is 1.22 and 1.59. **At the slower of the two, a
    // hundred needs 159 minutes of a 340-minute ceiling** - inside the half-ceiling rule below - so the registration is
    // answered by the run it names rather than by two runs that add up to it.
    confirmation: [{ skip: 50, max: 100 }],
  },
});

/**
 * **The rate §15.6 failed to keep current: 79.7 minutes of whole job for 50 pull requests, from the slower arm of the
 * fifty-pull-request run of 2026-11-10.**
 *
 * **Why this replaced 46 / 14.** The fourteen-pull-request run cost 468 model calls per pull request; the fifty cost 301,
 * and its throughput rose from 142 to about 190 calls a minute, so the same job went from 3.29 minutes per pull request
 * to 1.59. **A rate per pull request is a statement about a configuration, not about the runner** - and every ceiling
 * figure derived from the old one was wrong in the same direction: it said a hundred pull requests need 329 of 340
 * minutes when they need 159.
 */
export const MEASURED_MINUTES_PER_PULL_REQUEST = 79.7 / 50;

/**
 * **The largest corpus a job ceiling can score at all**, which is not the same as the largest it can score safely.
 *
 * Exported because two things ask the same question: the workflow comment that states the number, and the unit test that
 * checks the number is arithmetic rather than memory - **the same line said 190 pull requests until iteration 119, and
 * 190 needs 1.8 minutes per pull request, which no run has measured.**
 */
export function slicesThatFit(minutes) {
  const budget = Number(minutes);
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  return Math.floor(budget / MEASURED_MINUTES_PER_PULL_REQUEST);
}

/**
 * **What a confirming run is allowed to spend of its ceiling: half of it.**
 *
 * A slice that fills the ceiling is a slice whose artifact does not exist the first time the runner is slow, and a job
 * that dies at minute 340 has spent the money and produced no verdict - **so the margin is not caution, it is the
 * difference between a confirmation and a dispatch whose outcome is a timeout.** The registered hundred meets it at 159
 * minutes of 340, and the whole 200-pull-request corpus does not: 319 minutes, which is 94 % of the ceiling and inside it
 * with no room to retry.
 */
export const CONFIRMATION_CEILING_FRACTION = 0.5;

/**
 * **What a two-armed comparison on this instrument cannot resolve, as a function of the corpus.**
 *
 * **The 0.04 came from three runs over the same five pull requests**, where the file arm read 0.2727, 0.2368 and 0.2781
 * with no change to the code - so ±0.04 is what the instrument could not see below at 50 goldens. **That figure is a
 * standard error, and a standard error falls as the square root of the sample**, so a corpus of 452 goldens resolves
 * `0.04 × sqrt(170 / 452) = 0.0245` and one of 900 resolves 0.0174. **Scaling it is a claim with a formula behind it;
 * keeping 0.04 at every corpus size would be a claim that the instrument never improves, which the paired tests have
 * already contradicted.**
 */
export function resolutionFor(goldens, { measuredAt = 170, measuredResolution = 0.04 } = {}) {
  const count = Number(goldens);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(
      `resolution needs a positive golden count, received ${JSON.stringify(goldens)}`,
    );
  }
  return Math.round(measuredResolution * Math.sqrt(measuredAt / count) * 10_000) / 10_000;
}

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
 * **Which single configuration field the two arms differ in, or the reason they do not differ in exactly one.**
 *
 * **Read from the artifacts rather than passed in**, because a variable this job is told about and a variable the runs
 * actually varied are two different facts, and only the second one is the experiment. `undefined` and `null` are the
 * same absence here: **a field that one run omits and the other writes as `null` is not a varied device**, it is a
 * serialisation difference, and treating it as the variable would compare nothing at all.
 */
export function variedField(on, off) {
  const keys = new Set([
    ...Object.keys(on.configuration ?? {}),
    ...Object.keys(off.configuration ?? {}),
  ]);
  const differ = [...keys].filter((key) => {
    const a = on.configuration?.[key] ?? null;
    const b = off.configuration?.[key] ?? null;
    return a !== b;
  });
  return {
    field: differ.length === 1 ? differ[0] : null,
    differ,
    withValue: differ.length === 1 ? (on.configuration?.[differ[0]] ?? null) : null,
    withoutValue: differ.length === 1 ? (off.configuration?.[differ[0]] ?? null) : null,
  };
}

/**
 * **The fields that must be equal for the difference to be the device.**
 *
 * Returned rather than thrown, because the caller writes them into the artifact. **The corpus the run asked for is not
 * the corpus it read**, and until iteration 119 this function only compared the first: the run of 2026-11-10 asked both
 * arms for fifty pull requests, the `with` arm read forty-six - its four missing diffs are named in
 * `prsWithoutDiffReasons`, and the reason on every one of them was a sixty-request hour that an unauthenticated fetch
 * exhausts - and this function compared them anyway. **That is the same defect as the page read as the corpus, one level
 * down**: the declared denominator was compared and the measured one was not.
 */
export function confoundsBetween(on, off) {
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
  // **And where in the corpus each arm started**, because two runs of 100 pull requests from different offsets are two
  // corpora and the count cannot see the difference - the same reason the row keys below are compared.
  const onSlice = on.corpusSlice?.skip ?? 0;
  const offSlice = off.corpusSlice?.skip ?? 0;
  if (onSlice !== offSlice)
    confounds.push({ field: 'corpusSlice.skip', on: onSlice, off: offSlice });
  if (on.prsReviewed !== off.prsReviewed)
    confounds.push({ field: 'prsReviewed', on: on.prsReviewed, off: off.prsReviewed });
  // **`whole` is read only when it is there**, because the artifacts written before this field existed are not thereby
  // wrong: the row check below establishes the same thing, and **a guard that refuses on a missing field throws away the
  // comparisons that were sound** - the opposite failure to the one this guard exists for.
  for (const [side, artifact] of [
    ['with', on],
    ['without', off],
  ]) {
    if (artifact.corpusRead && artifact.corpusRead.whole !== true)
      confounds.push({
        field: 'corpusRead.whole',
        on: on.corpusRead?.whole ?? 'not stated',
        off: off.corpusRead?.whole ?? 'not stated',
        side,
        unread: artifact.corpusRead.unread ?? null,
      });
  }
  // **The same corpus, checked against the rows rather than against the request.** `coverage.byPullRequest` carries one
  // row per pull request the arm reviewed, so the two key sets are the two corpora - and a difference is reported as the
  // keys that differ rather than as a count, because **"3 pull requests short" is a number and "github.com/.../7952 is
  // missing" is a repair.**
  const corpusKeys = (artifact) =>
    (artifact.coverage?.byPullRequest ?? []).map((pull) => String(pull.pr)).filter(Boolean);
  const onKeys = new Set(corpusKeys(on));
  const offKeys = new Set(corpusKeys(off));
  if (onKeys.size > 0 && offKeys.size > 0) {
    const onlyOn = [...onKeys].filter((key) => !offKeys.has(key));
    const onlyOff = [...offKeys].filter((key) => !onKeys.has(key));
    if (onlyOn.length > 0 || onlyOff.length > 0)
      confounds.push({
        field: 'corpusRows',
        onlyWith: onlyOn.slice(0, 10),
        onlyWithout: onlyOff.slice(0, 10),
        onlyWithCount: onlyOn.length,
        onlyWithoutCount: onlyOff.length,
      });
  }
  const varied = variedField(on, off);
  if (varied.differ.length !== 1)
    confounds.push({
      field: 'configuration',
      expected: 'exactly one configuration key differs between the arms',
      differ: varied.differ,
    });
  else if (!(varied.field in REGISTRATIONS))
    confounds.push({
      field: 'registration',
      expected: `a registration naming "${String(varied.field)}"`,
      known: Object.keys(REGISTRATIONS),
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
export function summarise(on, off) {
  const varied = variedField(on, off);
  const registration = REGISTRATIONS[varied.field ?? ''] ?? null;
  const paired = pairedComparison(coverageSet(on), coverageSet(off));
  const gain = round(on.f1 - off.f1);
  const precisionGain = round(on.precision - off.precision);
  const recallGain = round(on.recall - off.recall);
  const goldens = on.truePositives + on.falseNegatives;
  const resolution = resolutionFor(goldens);

  const registeredGain = registration?.registeredGain ?? null;
  const magnitudeMet = registeredGain === null ? null : gain >= registeredGain;
  const recallTolerance = goldens > 0 ? 1 / goldens : 0;
  // **The mechanism, in the terms each registration states it.** A device that trades recall for precision and moves F1
  // not at all is a different finding from a device that does nothing, and this is the field that tells them apart.
  const mechanismMet = precisionGain > 0 && recallGain >= -recallTolerance;
  const outcome =
    magnitudeMet === null
      ? 'unregistered: no expectation was written before this run'
      : !magnitudeMet
        ? 'falsified: the registered gain was not reached'
        : mechanismMet
          ? `confirmed: at least ${String(registeredGain)} F1, and the mechanism is precision`
          : 'falsified: the magnitude arrived, the mechanism did not';

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    compared: true,
    protocol: `two runs of the same job over the same pull requests, the same goldens and the same judge, differing in ${String(varied.field)}`,
    variedField: varied.field,
    arms: { with: varied.withValue, without: varied.withoutValue },
    registration,
    corpus: on.corpus,
    pullRequests: on.prsInDataset,
    corpusSlice: on.corpusSlice ?? null,
    goldens,
    resolution,
    withDevice: {
      precision: on.precision,
      recall: on.recall,
      f1: on.f1,
      truePositives: on.truePositives,
      falsePositives: on.falsePositives,
      falseNegatives: on.falseNegatives,
      findings: on.fullEmission?.k ?? on.fullEmission?.emitted ?? null,
    },
    withoutDevice: {
      precision: off.precision,
      recall: off.recall,
      f1: off.f1,
      truePositives: off.truePositives,
      falsePositives: off.falsePositives,
      falseNegatives: off.falseNegatives,
      findings: off.fullEmission?.k ?? off.fullEmission?.emitted ?? null,
    },
    delta: {
      precision: precisionGain,
      recall: recallGain,
      f1: gain,
      truePositives: on.truePositives - off.truePositives,
      falsePositives: on.falsePositives - off.falsePositives,
      findings:
        (on.fullEmission?.k ?? on.fullEmission?.emitted ?? 0) -
        (off.fullEmission?.k ?? off.fullEmission?.emitted ?? 0),
    },
    /**
     * **The paired test, because the two runs read the same goldens.**
     *
     * `withOnly` are the goldens the device found and the baseline missed; `withoutOnly` the reverse. **A device that
     * trades recall for precision shows both numbers large and the p-value unremarkable** - which is a distinct and
     * reportable finding from "no effect".
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
      registeredGain,
      observedGain: gain,
      magnitudeMet,
      mechanismMet,
      outcome,
      // **Below the resolution and below the registration are two different failures**, and the artifact says which: a
      // 0.03 gain against a 0.02 claim on a corpus that resolves 0.024 is a result, and the same gain on one that
      // resolves 0.04 is not.
      insideResolution: Math.abs(gain) < resolution,
    },
  };
}

function writeArtifact(artifact) {
  const out = resolve(process.cwd(), 'benchmarks', 'aacr-ablation-paired.json');
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
  console.log(`AACR-ABLATION not compared: ${reason}`);
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
 * Three fixtures: a device worth 0.2 F1 by precision, a device that does nothing, and a device that trades recall for
 * precision without moving F1. Each has a hand-written expected outcome, and **the second is the important one** - a
 * comparison whose "no effect" branch is wrong reports null results that look like science.
 */
function selfTest() {
  const artifact = (overrides) => ({
    corpus: 'fixture',
    prsInDataset: 2,
    // **What the arm actually read, which is not the same number as what it asked for** - and the fixture has to carry
    // both, or the confound added in iteration 119 could never be tested by falling into it.
    prsReviewed: overrides.reviewed ?? 2,
    corpusRead: { requested: 2, unread: 0, whole: true, ...(overrides.corpusRead ?? {}) },
    corpusSlice: { skip: 0, requested: 2 },
    datasetRows: 2,
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: overrides.profile,
    },
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
    profile: 'defect',
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
    profile: 'advisory',
    tp: 3,
    fp: 17,
    fn: 7,
    covered: [[0, 1], [3]],
    goldensPerPr: [5, 5],
  });

  const good = summarise(qualifies, baseline);
  assert(good.variedField === 'emissionProfile', 'the varied field is read from the artifacts');
  assert(
    good.registration?.section === '§19 (R-17)',
    'and the registration is looked up by that field',
  );
  assert(good.verdict.magnitudeMet === true, 'the magnitude branch, against the 0.02 R-17 claim');
  assert(good.verdict.mechanismMet === true, 'precision rose and recall rose');
  assert(good.pairedTest.withOnly === 3, 'three goldens the device found and the baseline did not');
  assert(good.pairedTest.withoutOnly === 0, 'and none the other way');
  // **And the honest part, asserted rather than described**: three discordant pairs one way is p = 0.25, so a device
  // worth 0.2 F1 on ten goldens is **not** significant. A comparison that called this significant would be a comparison
  // that would call anything significant.
  assert(good.pairedTest.pValue === 0.25, 'three discordant pairs one way is p = 0.25');
  assert(good.pairedTest.verdict === 'not significant at 0.05', 'and the paired test says so');
  // **The resolved step at ten goldens is wider than at 170**, because the formula scales the measured 0.04 up as the
  // corpus shrinks - and 0.2 is far outside it either way.
  assert(
    good.resolution > 0.04,
    'ten goldens resolve less finely than the 170 the 0.04 was measured at',
  );

  const nothing = summarise(baseline, baseline);
  assert(nothing.variedField === null, 'two runs of the same arm vary nothing');
  assert(
    nothing.verdict.magnitudeMet === null,
    'and are reported as unregistered rather than as a null result',
  );
  assert(
    nothing.verdict.outcome.startsWith('unregistered'),
    'a comparison with no varied field is not a finding of no effect',
  );
  assert(nothing.pairedTest.pValue === 1, 'with no discordant pairs the p-value is 1');

  // A device that trades: same F1, more goldens found, more false positives.
  const trade = artifact({
    profile: 'defect',
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
    configuration: { ...baseline.configuration, emissionProfile: 'defect' },
  });
  assert(
    sameFlag.some((c) => c.field === 'configuration'),
    'two runs of the same arm are refused, because their null result would look like a finding',
  );

  // **Two arms that read the same number of pull requests and not the same ones.**
  //
  // This is the case a count cannot see, and the reason the guard reads `coverage.byPullRequest` rather than
  // `prsReviewed` alone: one arm loses a pull request the other read, and swaps in another, and every total agrees while
  // the two experiments do not.
  const swapped = confoundsBetween(
    {
      ...qualifies,
      coverage: {
        byPullRequest: [
          { pr: 'pr-0', goldens: 5, covered: [0, 1, 2] },
          { pr: 'pr-9', goldens: 5, covered: [3] },
        ],
      },
    },
    baseline,
  );
  assert(
    swapped.some((c) => c.field === 'corpusRows' && c.onlyWith[0] === 'pr-9'),
    'the pull request one arm read and the other did not is named, not counted',
  );

  // **Two arms that asked for the same corpus and read different amounts of it.**
  const shortArm = confoundsBetween(qualifies, {
    ...baseline,
    prsReviewed: 1,
    corpusRead: { requested: 2, unread: 1, whole: false },
  });
  assert(
    shortArm.some((c) => c.field === 'prsReviewed' && c.on === 2 && c.off === 1),
    'an arm that read one pull request fewer is a confound, not a smaller denominator',
  );
  assert(
    shortArm.some((c) => c.field === 'corpusRead.whole' && c.side === 'without'),
    'and the refusal names the arm that fell short',
  );

  // **And an artifact that predates the coverage field is not refused for that reason alone**, because **the rows above
  // carry the same fact**: a guard that treats a missing field as a failed one would discard the comparisons that were
  // sound, which is how a guard earns its own deletion.
  const silent = confoundsBetween(
    { ...qualifies, corpusRead: undefined },
    { ...baseline, corpusRead: undefined },
  );
  assert(
    !silent.some((c) => c.field === 'corpusRead.whole'),
    'an artifact written before the field existed is judged on its rows',
  );

  // **And two complete arms are not refused**, or the guard would turn the healthy case into the broken one.
  const healthy = confoundsBetween(qualifies, baseline);
  assert(healthy.length === 0, 'two complete arms raise no confound');

  console.log(
    `AACR-ABLATION self-test ok · ${String(good.variedField)} · gain ${String(good.delta.f1)} · null ${String(nothing.delta.f1)} · trade ${String(traded.delta.f1)} · resolution ${String(good.resolution)} · refusals ${String(confounded.length + sameFlag.length + swapped.length + shortArm.length)}`,
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
    return;
  }

  const on = JSON.parse(readFileSync(onPath, 'utf8'));
  const off = JSON.parse(readFileSync(offPath, 'utf8'));

  for (const [label, artifact] of [
    ['with', on],
    ['without', off],
  ]) {
    if (artifact.skipped) {
      refuse(`the run ${label} the device was skipped`, { run: label, skipped: artifact.skipped });
      return;
    }
  }

  const confounds = confoundsBetween(on, off);
  if (confounds.length > 0) {
    // **A refusal that says what each arm lost, not only that the numbers differ.** The four pull requests the `with`
    // arm could not read in the last run were four lines in the other artifact's `prsWithoutDiffReasons`, and the
    // comparison that ignored them could not have said which repair to make - a token, a URL, or a corpus.
    refuse('the two artifacts are not the same experiment', {
      confounds,
      corpus: {
        with: {
          requested: on.prsInDataset ?? null,
          reviewed: on.prsReviewed ?? null,
          whole: on.corpusRead?.whole ?? null,
          missing: on.prsWithoutDiffReasons ?? null,
        },
        without: {
          requested: off.prsInDataset ?? null,
          reviewed: off.prsReviewed ?? null,
          whole: off.corpusRead?.whole ?? null,
          missing: off.prsWithoutDiffReasons ?? null,
        },
      },
    });
    return;
  }

  const artifact = summarise(on, off);
  writeArtifact(artifact);
  console.log(
    `AACR-ABLATION compared · ${String(artifact.variedField)} ${String(artifact.arms.with)} vs ${String(artifact.arms.without)} · delta ${String(artifact.delta.f1)} · paired +${String(artifact.pairedTest.withOnly)}/-${String(artifact.pairedTest.withoutOnly)} p=${String(artifact.pairedTest.pValue)} · ${String(artifact.verdict.outcome)}`,
  );
}

// **The run is conditional**, because the module is imported by a unit test and by nothing else at import time - and a
// script that calls `main()` on import cannot be asked a question about its own arithmetic.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
