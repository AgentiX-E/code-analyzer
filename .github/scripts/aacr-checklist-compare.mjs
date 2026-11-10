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
import { pathToFileURL } from 'node:url';

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
  // **The corpus the run asked for is not the corpus it read**, and until now this function only compared the first.
  //
  // The run of 2026-11-10 asked both arms for fifty pull requests, the `with` arm read forty-six - its four missing
  // diffs are named in `prsWithoutDiffReasons`, and the reason on every one of them was a sixty-request hour that an
  // unauthenticated fetch exhausts - and this function compared them anyway: `prsInDataset` was 50 on both sides, so
  // the table said the two arms were the same experiment, and the paired test had to be rebuilt by hand afterwards.
  //
  // **That is the same defect as the page read as the corpus, one level down**: the declared denominator was compared
  // and the measured one was not. An artifact that records `corpusRead.whole` and a comparison that does not read it
  // is an instrument that measures the thing and throws the measurement away.
  if (on.prsReviewed !== off.prsReviewed)
    confounds.push({ field: 'prsReviewed', on: on.prsReviewed, off: off.prsReviewed });
  // **And the field the reader has to be able to trust even when the counts happen to agree.** Two arms can read the
  // same number of pull requests and still not have read the same ones - one loses A and gains B - so equality of the
  // count is a witness and not the fact. `whole` is the fact: it is `true` only when the arm lost nothing.
  //
  // **Read only when it is there**, because the artifacts written before this field existed are not thereby wrong: the
  // check below establishes the same thing from the rows themselves, and **a guard that refuses on a missing field
  // throws away the comparisons that were sound** - the opposite failure to the one this guard exists for, and the one
  // that would get the guard deleted.
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
  // row per pull request the arm reviewed, so the two key sets are the two corpora - and a difference is reported as
  // the keys that differ rather than as a count, because **"3 pull requests short" is a number and
  // "github.com/.../7952 is missing" is a repair.**
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
      findings: on.fullEmission?.k ?? on.fullEmission?.emitted ?? null,
    },
    withoutChecklist: {
      precision: off.precision,
      recall: off.recall,
      f1: off.f1,
      truePositives: off.truePositives,
      falsePositives: off.falsePositives,
      falseNegatives: off.falseNegatives,
      findings: off.fullEmission?.k ?? off.fullEmission?.emitted ?? null,
    },
    delta: {
      precision: round(precisionGain),
      recall: round(recallGain),
      f1: round(gain),
      truePositives: on.truePositives - off.truePositives,
      falsePositives: on.falsePositives - off.falsePositives,
      findings:
        (on.fullEmission?.k ?? on.fullEmission?.emitted ?? 0) -
        (off.fullEmission?.k ?? off.fullEmission?.emitted ?? 0),
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
    // **What the arm actually read, which is not the same number as what it asked for** - and the fixture has to
    // carry both, or the confound added below could never be tested by falling into it.
    prsReviewed: overrides.reviewed ?? 2,
    corpusRead: { requested: 2, unread: 0, whole: true, ...(overrides.corpusRead ?? {}) },
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

  // **Two arms that asked for the same corpus and read different amounts of it.**
  //
  // This is the shape the run of 2026-11-10 had: `prsInDataset` 50 on both sides, 50 read against 46, and a comparison
  // that published a paired test over the union. The assertion is that the difference is now a refusal rather than a
  // footnote, **and that the refused artifact names which side fell short** - the repair for one arm is a token and for
  // the other is a corpus, and a confound that names neither is a shrug.
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

  // **Two arms that read the same number of pull requests and not the same ones.**
  //
  // This is the case a count cannot see, and the reason the guard reads `coverage.byPullRequest` rather than
  // `prsReviewed` alone: one arm loses a pull request the other read, and swaps in another, and every total agrees while
  // the two experiments do not. **A guard that compares totals is a guard that reports this as sound.**
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

  // **And two arms that each read the whole corpus are not refused for it**, or the guard would turn the healthy case
  // into the broken one.
  const healthy = confoundsBetween(qualifies, baseline);
  assert(
    !healthy.some((c) => c.field === 'corpusRead.whole' || c.field === 'prsReviewed'),
    'two complete arms raise no corpus confound',
  );

  console.log(
    `AACR-CHECKLIST self-test ok · gain ${good.delta.f1} · null ${nothing.delta.f1} · trade ${traded.delta.f1} · refusals ${confounded.length + sameFlag.length + shortArm.length + silent.length}`,
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
    `AACR-CHECKLIST compared · with ${on.f1} vs without ${off.f1} · delta ${artifact.delta.f1} · paired +${artifact.pairedTest.withOnly}/-${artifact.pairedTest.withoutOnly} p=${artifact.pairedTest.pValue} · ${artifact.verdict.outcome}`,
  );
}

// **The guard is exported and the run is conditional**, because **the confound between two arms of an ablation is a
// function of two artifacts**, and a function that can only be exercised by running the whole job is a function whose
// edges are tested by reading them. `--self-test` covers the arithmetic; a unit test imports `confoundsBetween` and
// asserts the cases a fixture cannot produce as easily as a literal.
export { confoundsBetween, summarise };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
