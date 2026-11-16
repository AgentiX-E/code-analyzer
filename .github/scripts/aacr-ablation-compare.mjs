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

import { coverageSet } from '../../scripts/lib/arm-pair.mjs';
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
    // **Which arm the claim is about.** `file` is the artifact's own top-level figure; `pullRequest` is the
    // `pullRequestArm` block beside it. Before this field existed the job read the top-level figure for every
    // registration, which was right for §8 and §19 and **wrong for §20** - see the `codeContext` entry below.
    arm: 'file',
    registeredGain: 0.04,
    mechanism: 'precision rises, recall does not fall',
    mechanismRule: 'recall-holds',
    // **Empty, and that is the correct value rather than an omission.** A falsified device needs no confirmation: §8's
    // checklist was measured at −0.0292 with p = 0.0049 on its own confirmation run, so the registration is closed and
    // a slice list here would be a promise to spend money re-reading a verdict that has already been read.
    confirmation: [],
  },
  /**
   * **§20's registration, transcribed rather than restated.** The sentence below is the one written before the dispatch,
   * including the three things it required at once - twenty of the 160 coincident rejections, +0.02 on the pull-request
   * arm, and no loss on the file arm - because **a registration whose thresholds are edited after its run is a
   * description of the run and not a prediction about it.**
   *
   * **And the arm is transcribed too.** The first version of this entry carried `registeredGain: 0.02` without saying
   * which arm it was a claim about, so the job compared the file arm against a threshold the sentence attaches to the
   * pull-request arm. On the run this entry was written for, the file arm gained 0.024 - over the bar - while the
   * pull-request arm the sentence names **fell** by 0.0065. The artifact said `magnitudeMet: true` about the arm nobody
   * registered, which is the failure mode this whole file exists to refuse, and it is why `arm` and `guard` are fields.
   */
  codeContext: {
    section: '§20 (R-18)',
    claim:
      'showing each lane the block each hunk sits in recovers at least 20 of the 160 coincident rejections and raises the pull-request arm F1 by at least 0.02 without lowering the file arm',
    arm: 'pullRequest',
    registeredGain: 0.02,
    /**
     * **The second clause of the same sentence, as a gate rather than as a remark.** "Without lowering the file arm" is
     * a requirement, and a threshold that only lives in the claim text is a requirement nothing enforces.
     */
    guard: { arm: 'file', notLoweredBy: 0 },
    mechanism: 'recall rises and precision does not fall by more than one golden is worth',
    mechanismRule: 'recall-rises',
    // **The slice the registration names**: the thirty-six pull requests its baseline read, which is `skip 14`.
    confirmation: [{ skip: 14, max: 36 }],
  },
  /**
   * **§44's registration, written before the dispatch rather than after it.**
   *
   * The diagnosis is two rows of the published artifact: **302 false positives against 160 accepted, whose largest block
   * is comments that assert nothing about the code** ("Public API change: return type changed from int to ArrowType",
   * and a comment whose own body argues the declaration is legal), and **141 goldens missed by a comment standing on the
   * golden's own line**. **One needs a reader that asks "is this true"; the other needs one that asks "what is true
   * here".** `review/adjudication/` is that reader, and the device is one call per surviving finding.
   *
   * **Why `recall-holds` rather than `recall-rises`, although the device can repair.** A repair is the only move that
   * raises precision and recall at once, and it is also the move with the largest failure mode - an adjudicator that
   * rewrites a correct comment into an invention. **Registering the optimistic mechanism would make a device that trades
   * recall for precision look like a falsification of its own idea**, so the registered mechanism is the conservative
   * one: precision up, recall not down by more than a golden is worth. **If repairs do their job the recall gain shows
   * up as a gain, and the artifact will say so.**
   *
   * **What is registered as the slice is the discovery rows, and that is stated rather than hidden.** The fifty pull
   * requests are the ones the diagnosis was made on, so this dispatch is a discovery and not a confirmation - **the
   * confirmation this entry owes is a later run over rows the diagnosis did not read (`skip: 50`), and it is the next
   * registration rather than this one.**
   */
  adjudicate: {
    section: '§45 (R-20)',
    claim:
      'showing the second reader the numbered added lines and naming the line the comment is filed on raises the file arm F1 by at least 0.04 and does not lower recall by more than 0.01',
    arm: 'file',
    registeredGain: 0.04,
    mechanism: 'precision rises and recall does not fall by more than a golden is worth',
    mechanismRule: 'recall-holds',
    // **The discovery slice, and the confirmation debt is named rather than left implicit.** §44's run read
    // `skip 0 max 50` and falsified R-19 there; the device changed, so the same fifty rows are bought again as R-20's
    // discovery - **the same rows, a different reader** - and the hundred after them remain owed as the confirmation.
    confirmation: [{ skip: 50, max: 100 }],
  },
  emissionProfile: {
    section: '§19 (R-17)',
    claim:
      'emitting only the categories whose measured acceptance reaches 0.22 raises the file arm F1 by at least 0.02',
    arm: 'file',
    registeredGain: 0.02,
    mechanism: 'precision rises and recall falls by less than precision rises',
    mechanismRule: 'recall-trades-below-precision',
    // **The hundred pull requests the discovery did not see, in one dispatch - and the split into two fifties was written
    // here first and then withdrawn by measurement.** The split was argued from 3.29 minutes per pull request, a figure
    // that came from the fourteen-pull-request run of §15.6; the fifty-pull-request run of 2026-11-10 (workflow run
    // 42823966835) took 61.0 and 79.7 minutes for its two arms, which is 1.22 and 1.59. **At the slower of the two, a
    // hundred needs 159 minutes of a 340-minute ceiling** - inside the half-ceiling rule below - so the registration is
    // answered by the run it names rather than by two runs that add up to it.
    confirmation: [{ skip: 50, max: 100 }],
  },
  /**
   * **The device §47 registered: a deterministic lane for the remarks no prompt was going to produce.**
   *
   * Fifty sampled goldens the file arm missed were read one at a time and **82 % of them describe something the five
   * lanes never attempt** - a `const auto&` on a variable that is only read, a `2.0` that should be `2.0f`, a
   * commented-out `Fill(0.0)`, an `async` with nothing to await. Two prompt contracts and a stated line-number window
   * could not move that, because the two reviewers were answering different questions.
   *
   * **The mechanism is `recall-rises`, and it is the honest one rather than the flattering one.** The lane adds remarks
   * the corpus contains, so recall is what should move; **precision is allowed to fall by one golden's worth** and no
   * further, because a rule that fires on code a reviewer would not comment on costs exactly what a wrong finding costs.
   * Registering this as a precision device would let a lane that flooded every file pass on a technicality.
   */
  /**
   * **§48's registration, and the one this repository has been able to make since §23 and has not.**
   *
   * The reading agent - a plan, a tool loop over a checkout, a finding that survives only if the code it quotes is in
   * the file - has been dispatchable for four iterations and every number it produced was measured **across dispatches**
   * against a lane arm from a different day. This repository's own artifact says what that is worth: two dispatches of
   * the same configuration have reported 0.1691 and 0.2405, a spread larger than every effect `EVAL-CONTRACT.md` has
   * registered. **A device whose contribution can only be measured across runs cannot be measured by this instrument**,
   * and `agent: pair` is the edit that removes the excuse rather than a new device.
   *
   * **What is registered is the file arm**, because that is the figure this repository publishes and the one the
   * corpus's leader is quoted at (25.1 % SEM-F1, §46.7). The pull-request arm is the guard, because a device that raises
   * one view of the corpus by concentrating on a few pull requests is not the thing being claimed.
   */
  agent: {
    section: '§48 (R-22)',
    claim:
      'the reading agent raises the file arm F1 by at least 0.02 over the five lanes on the same hundred pull requests, without lowering the pull-request arm',
    arm: 'file',
    registeredGain: 0.02,
    guard: { arm: 'pullRequest', notLoweredBy: 0 },
    mechanism:
      'recall rises because the reader can open the file it is describing, and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    // **The same hundred rows every lane figure on this slice was measured on**, so the comparison is a pair rather than
    // a comparison of two corpora: `skip: 50` is the slice after the discovery set, and both arms read it.
    confirmation: [{ skip: 50, max: 100 }],
  },
  idioms: {
    section: '§47 (R-21)',
    claim:
      'the deterministic idiom lane raises the file arm F1 by at least 0.02 on rows the sample did not read, without lowering precision by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.02,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    // **The hundred rows after the fifty the rules were derived from.** Six rules were chosen by reading goldens from the
    // first fifty pull requests, so pricing them on those rows would be a measurement of the search rather than of the
    // lane - the same reason R-17's confirmation reads `skip: 50`.
    confirmation: [{ skip: 50, max: 100 }],
  },
  /**
   * **§53's registration, and the one entry in this table that was written after its dispatch.**
   *
   * The claim was fixed by the diagnosis, not by the result: `43669547968` was dispatched because a committed diagnostic
   * read fifty missed goldens and found **forty-one of them a remark no lane attempts** - "consider declaring these as
   * `const`", "align with the plugin's `Math.min` rule", "document why these are excluded" - so a lane that produced
   * those remarks had to recover a large share of forty-one to be worth its calls, and 0.02 was the house threshold
   * every device in this table is registered at. **What is written here after the fact is only the entry, and the entry
   * says which run already happened** so no reader can mistake this for a prediction.
   *
   * **Why it is closed rather than owed a confirmation.** The measured gain is +0.0022 with eight goldens recovered of
   * the ninety-one comments the pass added - a device that emits at 0.09 precision in a corpus whose population is 0.156
   * is not a weak signal, it is more of the same thing. A confirmation run over new rows would buy a second measurement
   * of an effect that is smaller than the instrument's resolution, so `confirmation` is empty for the same reason §8's
   * is.
   */
  remarks: {
    section: '§53 (R-25)',
    claim:
      'the remark pass recovers at least twenty of the forty-one remark-shaped goldens the diagnosis found and raises the file arm F1 by at least 0.02 without lowering recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.02,
    mechanism: 'precision rises and recall does not fall by more than a golden is worth',
    mechanismRule: 'recall-holds',
    /**
     * **The entry was written on 2026-11-16, after the run of 2026-11-15.** Recorded as a field rather than as a
     * sentence, because the artifact is where a reader checks what a verdict is about, and **a verdict read against a
     * registration written afterwards is a description and not a prediction** - which is exactly what this field makes
     * it possible to see without reading this file.
     */
    registeredAfterDispatch: true,
    confirmation: [],
  },
  /**
   * **§56's device, and the only one in this table whose two arms both had to be paid for before the claim was written.**
   *
   * The claim is arithmetic on artifacts that already exist: `43676036390` ran the five lanes and the reading agent over
   * the same hundred pull requests, the two arms covered **198 and 171 distinct goldens with 93 in common**, and the
   * union covers **276 of 724** against 198 for either alone. **So the second reviewer is not a second opinion about the
   * same code, and the reason it never paid for itself is that it spends 1 920 comments to say what one says in 1 109.**
   *
   * **The device is the merge, not the second reviewer**, and the threshold is the house 0.02 because the measured
   * headroom is bigger than that: the union cut to twelve per pull request scores 0.2243 against the lanes' 0.2121, and
   * a merge that removed the restatements and kept the 78 unique goldens would be 770 comments at 0.2422. **A device
   * priced between the naive union and its own ceiling is the one case where a 0.02 bar is conservative rather than
   * arbitrary.**
   *
   * **The guard is recall**, because a merge can raise precision by dropping findings and the arm's whole justification
   * is that it finds goldens no lane reaches: a merge that lost recall would be a filter wearing a merge's name.
   */
  ensemble: {
    section: '§56 (R-29)',
    /**
     * **The two lists are the device, so a run without both is not a test of this claim.**
     *
     * §57.2 found the first dispatch of this arm merging the reader with nothing and reporting a confirmation; the gate
     * that reads `merge.unionPulls` is what turns that into `not a test` on the next dispatch rather than into a second
     * confirmation of a device that has never been run.
     */
    inputsFormed: 'union',
    claim:
      'merging both reviewers into twelve comments per pull request raises the file arm F1 by at least 0.02 over the five lanes alone, without lowering recall',
    arm: 'file',
    registeredGain: 0.02,
    mechanism: 'precision rises and recall does not fall',
    mechanismRule: 'recall-holds',
    confirmation: [],
  },
  /**
   * **§58's registration (R-31): the one-sided merge, which is the arm R-29 measured without choosing to.**
   *
   * R-29's artifact is the evidence and it is unambiguous about the arithmetic: on 46 pull requests and 330 goldens, a
   * selection pass over the reading reviewer's own candidates - de-duplicate, then twelve per pull request - reached
   * **0.2504 F1 against 0.2148 for the same reader under score order at the same budget**, with 54 fewer comments. What
   * it is not evidence about is the claim it was filed under, because the lanes were empty: the device that ran had one
   * side, and every figure is a figure about that device.
   *
   * **So this is the same device, registered as itself, on rows it has never seen.** The comparator is the five lanes
   * alone - the arm every published figure of this campaign is measured against - and the slice is the discovery rows
   * (100 pull requests, 724 goldens) rather than the confirmation rows, because **0.02 cannot be resolved on 330 goldens
   * and can be resolved on 724** (§57.5's own reason, reused unchanged).
   *
   * **The falsifiers are stated with the claim.** F1 below **0.2272** (the lanes' 0.2072 plus the registered 0.02) is a
   * falsification, and so is a recall below **0.1875** (the lanes' 0.1975 less a golden's worth) - **because a selection
   * pass that buys precision by deleting recall is the one failure mode this device is most exposed to**, and a
   * registration that named only F1 would accept exactly that trade.
   *
   * **`inputsFormed` is deliberately null.** The union gate reads `merge.unionPulls` and fires when a merge was handed
   * one side; **this device is defined as one side**, so the gate would refuse the run it is meant to measure. The lane
   * count is still published in `merge.sides`, so a reader can tell the two apart without trusting this paragraph.
   */
  'ensemble:reader': {
    section: '§58 (R-31)',
    claim:
      "the reading reviewer's own list, de-duplicated and cut to twelve per pull request, raises the file arm F1 by at least 0.02 over the five lanes alone on the hundred discovery pull requests, without lowering recall",
    arm: 'file',
    registeredGain: 0.02,
    mechanism: 'precision rises and recall does not fall',
    mechanismRule: 'recall-holds',
    confirmation: [{ skip: 50, max: 100 }],
  },
});

/**
 * **The mechanism each registration states, as a predicate rather than as a sentence.**
 *
 * This table exists because the comparison script used to check every registration against one hardcoded rule - "precision
 * rose and recall did not fall by more than a golden" - while R-17's registration states a different one: "precision rises
 * and recall falls by less than precision rises". On the hundred-pull-request confirmation those two rules disagree:
 * precision rose 0.0937, recall fell 0.0414, so **the registered mechanism held and the hardcoded one did not**, and the
 * artifact said `mechanismMet: false` about a registration whose own words described what happened.
 *
 * **A verdict field that tests a different rule from the one it is filed under is worse than no field**, because it is
 * the field a reader trusts. So a registration names its rule, the rule lives here, and the self-test proves both
 * branches on fixtures rather than on a run.
 */
export const MECHANISMS = Object.freeze({
  /**
   * Precision rises and recall does not fall by more than one golden is worth - the claim a device makes when it is
   * meant to remove findings without removing the ones that matter.
   */
  'recall-holds': (precisionGain, recallGain, recallTolerance) =>
    precisionGain > 0 && recallGain >= -recallTolerance,
  /**
   * Precision rises and recall falls by less than precision rises - the trade a prior makes, and the only trade that
   * can raise F1 while dropping true positives.
   */
  'recall-trades-below-precision': (precisionGain, recallGain) =>
    precisionGain > 0 && recallGain > -precisionGain,
  /**
   * Recall rises and precision does not fall by more than a golden is worth - the mirror of `recall-holds`, and the
   * claim a device makes when it is meant to widen what the reviewer can see rather than narrow what it says.
   */
  'recall-rises': (precisionGain, recallGain, precisionTolerance) =>
    recallGain > 0 && precisionGain >= -precisionTolerance,
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
// **The coverage set comes from `scripts/lib/arm-pair.mjs`**, which is the same reader the operating-point CLI pairs
// with: **two readers of one set is how a table and a test come to be about two configurations**, which is what §51
// documents happening to this repository on 2026-11-15. The library refuses an artifact with no `coverage` block rather
// than pairing an empty set, and that refusal is the one this job wants - a withheld verdict, not `p = 1`.

/**
 * **One arm's figures out of one artifact, in the shape the verdict reads.**
 *
 * The two arms are not two `summarise` calls: they are two blocks of every artifact the bench writes - the top level is
 * the file arm, `pullRequestArm` is the pull-request arm - and **`null` when the block is absent**, so a registration
 * that names a missing arm is refused instead of being answered with a neighbouring number.
 */
/** How an arm is named in a sentence, because `pullRequest` is a key and "the pull-request arm" is a phrase. */
function armProse(arm) {
  return arm === 'pullRequest' ? 'pull-request arm' : `${String(arm)} arm`;
}

function armOf(artifact, arm) {
  if (arm === 'file')
    return {
      precision: artifact.precision,
      recall: artifact.recall,
      f1: artifact.f1,
      truePositives: artifact.truePositives,
      falsePositives: artifact.falsePositives,
      falseNegatives: artifact.falseNegatives,
      // **The file arm's finding count is the emission, not the capped arm**: every finding is scored and the curve is
      // over the full emission, which is why this number is read from `fullEmission` and not from the arm block.
      findings: artifact.fullEmission?.k ?? artifact.fullEmission?.emitted ?? null,
    };
  if (arm !== 'pullRequest') return null;
  const block = artifact.pullRequestArm;
  if (!block || typeof block.f1 !== 'number') return null;
  return {
    precision: block.precision,
    recall: block.recall,
    f1: block.f1,
    truePositives: block.truePositives,
    falsePositives: block.falsePositives,
    falseNegatives: block.falseNegatives,
    findings: block.findings ?? null,
  };
}

/**
 * **One string per value, and the same string for two values that are the same value.**
 *
 * `JSON.stringify` alone is not that: two objects carrying the same entries in a different insertion order are the same
 * configuration and two different strings, so **sorting the keys is the part that makes the comparison about the value
 * rather than about the route the value took to get there.**
 */
function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

/**
 * **Are these two configuration values the same value?**
 *
 * This was `a !== b` until iteration 120, and `!==` is identity, not equality. `agentOptions` is an object, both arms of
 * §44 wrote the same one, and the paired job refused the run with *the two artifacts are not the same experiment* and
 * `differ: ["adjudicate", "agentOptions"]` - **while the two objects serialised to the same string**. The guard that
 * exists to catch an unregistered second variable instead caught a second reference, and the price of that mistake is a
 * whole paid corpus run discarded on a false refusal. A guard that refuses sound comparisons is not a safe guard; it is
 * a guard that will be deleted by whoever it blocks next.
 */
function sameConfigurationValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * **Which single configuration field the two arms differ in, or the reason they do not differ in exactly one.**
 *
 * **Read from the artifacts rather than passed in**, because a variable this job is told about and a variable the runs
 * actually varied are two different facts, and only the second one is the experiment. `undefined` and `null` are the
 * same absence here: **a field that one run omits and the other writes as `null` is not a varied device**, it is a
 * serialisation difference, and treating it as the variable would compare nothing at all. **And two objects that hold
 * the same entries are the same device**, for the same reason one level up - see `sameConfigurationValue`.
 */
const ENTAILED_BY = {
  /**
   * **A reader cannot be switched on without being shown the code it reads.**
   *
   * `agent: on` sets `codeContext: true` inside the arm, so its artifact differs from the lane arm in two keys and the
   * pair was refused as confounded - which is true of the *artifact* and false of the *experiment*: **the device is one
   * switch and the second key is what the switch means**. Listing the entailment here rather than teaching the arm to
   * lie about its own configuration keeps the artifact honest and puts the claim where a reader can check it.
   *
   * **The entailment is directional and checked in both directions**: it holds only when the varied arm carries the
   * entailed key *on* and the baseline carries it *off*. An arm that turned the window on and left the reader off would
   * then differ in two keys that are not an entailment, and it is refused - because that is a different experiment.
   */
  agent: [{ key: 'codeContext', whenOn: true, whenOff: false }],
  /**
   * **A merge of two reviewers cannot be switched on without the second reviewer being switched on.**
   *
   * `ensemble: on` requires `agent: on`, and `agent: on` carries `codeContext: true` - so the pair that measures the
   * merge against the lanes differs in three configuration keys and the guard refuses it as confounded. **It is not: the
   * device is the merge, and the other two keys are what a merge needs in order to have two lists to merge.**
   *
   * **Both are entailed, not one**, because `agent` carries its own entailment and the resolution here reads the table
   * rather than the arm: listing `agent` alone would leave `codeContext` unexplained on exactly the pair §56 needs.
   */
  ensemble: [
    { key: 'agent', whenOn: true, whenOff: false },
    { key: 'codeContext', whenOn: true, whenOff: false },
  ],
};

export function variedField(on, off) {
  const keys = new Set([
    ...Object.keys(on.configuration ?? {}),
    ...Object.keys(off.configuration ?? {}),
  ]);
  const differ = [...keys].filter((key) => {
    const a = on.configuration?.[key] ?? null;
    const b = off.configuration?.[key] ?? null;
    return !sameConfigurationValue(a, b);
  });
  if (differ.length > 1) {
    for (const candidate of differ) {
      const entailments = ENTAILED_BY[candidate] ?? [];
      if (entailments.length === 0) continue;
      const rest = differ.filter((key) => key !== candidate);
      const explained = rest.every((key) => {
        const rule = entailments.find((entry) => entry.key === key);
        if (rule === undefined) return false;
        return on.configuration?.[key] === rule.whenOn && off.configuration?.[key] === rule.whenOff;
      });
      if (!explained) continue;
      return {
        field: candidate,
        differ,
        entailed: rest,
        withValue: on.configuration?.[candidate] ?? null,
        withoutValue: off.configuration?.[candidate] ?? null,
      };
    }
  }
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
  // **`field`, not `differ.length`.** The entailment branch resolves the switch out of two differing keys and returns it
  // as `field` while still reporting both keys in `differ` - so a guard that counted the keys refused the very pair the
  // branch had just explained, and did it silently: R-22's pair was rejected as confounded with
  // `differ: ["codeContext","agent"]` **after** the rule that makes those two keys one device had been written for it.
  // The assertion that catches it is on `confoundsBetween`, not on `variedField`; see the self-test below.
  if (varied.field === null)
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
  /**
   * **A field can carry two devices, so the value is part of the key.**
   *
   * `ensemble` is one input and two arms: `on` merges two lists, `reader` selects from one. A lookup keyed on the field
   * alone would answer the second one with the first one's claim - **the same defect as `registeredGain` with no `arm`
   * field, one level up**: a registration attached to the wrong device reads as a verdict about an experiment nobody
   * registered. The value-specific key is tried first and the field is the fallback, so every existing entry keeps
   * working and a new value has to name its own claim or inherit a field-wide one deliberately.
   */
  const registration =
    REGISTRATIONS[`${varied.field ?? ''}:${String(varied.withValue)}`] ??
    REGISTRATIONS[varied.field ?? ''] ??
    null;
  const paired = pairedComparison(coverageSet(on), coverageSet(off));
  /**
   * **The arm the registration is a claim about, read from the registration and not chosen by this file.**
   *
   * `file` is the artifact's own top-level figure - one call per file per lane, at most three findings per file. That is
   * the arm every published figure of §8 and §19 was measured on, and it is the arm a *narrowing* device is judged on.
   * `pullRequest` is the block beside it - one call per lane for the whole pull request, one budget of sixteen - and it
   * is the arm §20 names, because **a window that shows a model more code is a device that has more to say per call, and
   * the arm with the budget per pull request is the one that can say it.**
   *
   * **The failure this prevents is not arithmetic.** With no `arm` field, `registeredGain: 0.02` was compared against
   * the file arm on R-18's run: the file arm gained 0.024 and cleared the bar, the pull-request arm the sentence names
   * lost 0.0065, and the artifact reported `magnitudeMet: true`. **A threshold attached to the wrong arm is a verdict
   * about an experiment nobody registered**, so a registration that names an arm the artifacts do not carry is refused
   * rather than measured on the nearest one.
   */
  const registeredArm = registration?.arm ?? 'file';
  const onArm = armOf(on, registeredArm);
  const offArm = armOf(off, registeredArm);
  if (registration && (!onArm || !offArm))
    throw new Error(
      `registration "${String(registration.section)}" is a claim about the ${armProse(registeredArm)}, which the ${onArm ? 'without' : 'with'} artifact does not carry`,
    );
  const gain = round(onArm.f1 - offArm.f1);
  const precisionGain = round(onArm.precision - offArm.precision);
  const recallGain = round(onArm.recall - offArm.recall);
  const goldens = onArm.truePositives + onArm.falseNegatives;
  const resolution = resolutionFor(goldens);

  const registeredGain = registration?.registeredGain ?? null;
  const magnitudeMet = registeredGain === null ? null : gain >= registeredGain;
  const recallTolerance = goldens > 0 ? 1 / goldens : 0;
  // **The mechanism, in the terms each registration states it.** A device that trades recall for precision and moves F1
  // not at all is a different finding from a device that does nothing, and this is the field that tells them apart.
  // **The rule the registration names, and not a rule this file prefers.** A registration that names a mechanism no
  // entry in `MECHANISMS` implements is a registration whose verdict cannot be computed, so it is refused rather than
  // measured against a neighbour.
  const mechanismRule = registration?.mechanismRule;
  const mechanism = mechanismRule ? MECHANISMS[mechanismRule] : undefined;
  if (registration && !mechanism)
    throw new Error(
      `registration "${String(registration.section)}" names mechanism "${String(mechanismRule)}", which is not one of ${Object.keys(MECHANISMS).join(', ')}`,
    );
  const mechanismMet = mechanism ? mechanism(precisionGain, recallGain, recallTolerance) : null;

  /**
   * **Which rows the registration is a claim about, checked before the claim is judged.**
   *
   * A registration names the corpus its confirmation runs on - R-17's is `skip 50, max 100` - so **a run over any other
   * rows is a different experiment**, and a verdict computed from it is a verdict about a corpus nobody registered. The
   * smoke run of 2026-11-11 is the case: ten pull requests from the start of the corpus, no overlap with the registered
   * hundred, produced `confirmed: at least 0.02 F1` about a claim whose own text says the hundred starting at fifty. The
   * observed gain there was 0.0374 against a resolution of 0.0482, so the same run also reached the second gate below.
   *
   * `null` means the registration declares no slice, which is what a closed registration looks like - §8's checklist is
   * falsified and has nothing left to confirm, so anything that varies it is reported without a slice gate.
   */
  /**
   * **Whether the device had the inputs its registration names, before its gain is read.**
   *
   * R-29 is the case: registered as *a list merged from the five lanes and the reading reviewer*, dispatched with the
   * lanes emptied by a cost rule three hundred lines upstream, and reported at **+0.0356, `confirmed`** - **a plausible
   * figure for a device that never ran.** No field in that artifact could contradict it, which is why the merge now
   * publishes `unionPulls` and why this gate reads it. **A threshold met by the wrong device is not a threshold met**,
   * so the check sits above the magnitude rather than beside it.
   */
  const unionRequired = registration?.inputsFormed === 'union';
  const unionPulls = Number(on?.merge?.unionPulls ?? 0);
  const inputsFormed = unionRequired ? unionPulls > 0 : null;

  const declared = registration?.confirmation ?? [];
  const slice = on.corpusSlice ?? null;
  const sliceMatches =
    declared.length === 0
      ? null
      : slice !== null && declared.some((s) => s.skip === slice.skip && s.max === slice.requested);
  /**
   * **The second clause of a registration that has one, computed whether or not the first one passed.**
   *
   * "Without lowering the file arm" is a requirement with a threshold - zero - and **a requirement that is only in the
   * sentence is a requirement an artifact cannot fail.** The guard reads a *different* arm from the one the gain is read
   * on, which is why it is a field and not a second threshold: R-18 asks the pull-request arm to rise **and** the file
   * arm not to fall, and those are two measurements of one run.
   */
  const guardArm = registration?.guard?.arm ?? null;
  const guardOn = guardArm ? armOf(on, guardArm) : null;
  const guardOff = guardArm ? armOf(off, guardArm) : null;
  if (guardArm && (!guardOn || !guardOff))
    throw new Error(
      `registration "${String(registration.section)}" guards the ${armProse(guardArm)}, which the ${guardOn ? 'without' : 'with'} artifact does not carry`,
    );
  const guardGain = guardArm ? round(guardOn.f1 - guardOff.f1) : null;
  const guardMet = guardArm === null ? null : guardGain >= -(registration.guard.notLoweredBy ?? 0);
  /** A gain narrower than the instrument's own error bar confirms nothing, whatever it is compared against. */
  const insideResolution = Math.abs(gain) < resolution;
  /** How the arm is named in a sentence, because "the file arm" and "the pull-request arm" are not interchangeable. */
  const armName = `the ${armProse(registeredArm)}`;

  const outcome =
    magnitudeMet === null
      ? 'unregistered: no expectation was written before this run'
      : sliceMatches === false
        ? `not a confirmation: the registration names ${declared.map((s) => `skip ${String(s.skip)} max ${String(s.max)}`).join(' or ')}, and this run read ${slice === null ? 'a corpus the artifact does not describe' : `skip ${String(slice.skip)} max ${String(slice.requested)}`}`
        : inputsFormed === false
          ? `not a test: the device was registered to merge two reviewers and ran with ${String(on?.merge?.sides?.lanes ?? 0)} lane candidates and ${String(on?.merge?.sides?.reader ?? 0)} reader candidates over ${String(on?.prsReviewed ?? 0)} pull requests, so the union never formed`
          : !magnitudeMet
            ? `falsified: the registered gain was not reached on ${armName}${guardMet === false ? `, and the ${armProse(String(guardArm))} fell by ${String(-guardGain)}` : ''}`
            : mechanismMet === false
              ? 'falsified: the magnitude arrived, the mechanism did not'
              : guardMet === false
                ? `falsified: ${armName} gained ${String(gain)} and the ${armProse(String(guardArm))} it must not lower fell by ${String(-guardGain)}`
                : insideResolution
                  ? `inconclusive: a gain of ${String(gain)} inside the ${String(round(resolution))} this instrument resolves at ${String(goldens)} goldens`
                  : `confirmed: at least ${String(registeredGain)} F1 on ${armName}, and the mechanism is precision`;

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    compared: true,
    protocol: `two runs of the same job over the same pull requests, the same goldens and the same judge, differing in ${String(varied.field)}`,
    variedField: varied.field,
    arms: { with: varied.withValue, without: varied.withoutValue },
    registration,
    /**
     * **Which arm the figures below are**, so that a reader who quotes `withDevice.f1` is quoting the arm the
     * registration is about rather than whichever arm the script happened to read.
     */
    registeredArm,
    corpus: on.corpus,
    pullRequests: on.prsInDataset,
    corpusSlice: on.corpusSlice ?? null,
    goldens,
    resolution,
    /**
     * **Both arms of the same two runs, side by side.** The registered arm is the headline below; this is the other one,
     * present because **the arm a claim does not name still moved, and a reader has to be able to see by how much** -
     * on R-18 the file arm gained 0.024 while the registered pull-request arm lost 0.0065, and one number without the
     * other is a half-truth in whichever direction suits the author.
     */
    byArm: Object.fromEntries(
      ['file', 'pullRequest'].map((arm) => {
        const withArm = armOf(on, arm);
        const withoutArm = armOf(off, arm);
        return [
          arm,
          withArm && withoutArm
            ? {
                with: withArm,
                without: withoutArm,
                delta: {
                  precision: round(withArm.precision - withoutArm.precision),
                  recall: round(withArm.recall - withoutArm.recall),
                  f1: round(withArm.f1 - withoutArm.f1),
                },
              }
            : null,
        ];
      }),
    ),
    withDevice: {
      precision: onArm.precision,
      recall: onArm.recall,
      f1: onArm.f1,
      truePositives: onArm.truePositives,
      falsePositives: onArm.falsePositives,
      falseNegatives: onArm.falseNegatives,
      findings: onArm.findings,
    },
    withoutDevice: {
      precision: offArm.precision,
      recall: offArm.recall,
      f1: offArm.f1,
      truePositives: offArm.truePositives,
      falsePositives: offArm.falsePositives,
      falseNegatives: offArm.falseNegatives,
      findings: offArm.findings,
    },
    delta: {
      precision: precisionGain,
      recall: recallGain,
      f1: gain,
      truePositives: onArm.truePositives - offArm.truePositives,
      falsePositives: onArm.falsePositives - offArm.falsePositives,
      findings: (onArm.findings ?? 0) - (offArm.findings ?? 0),
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
      /** The arm the threshold above is attached to, as a field rather than as a convention. */
      registeredArm,
      observedGain: gain,
      magnitudeMet,
      mechanismMet,
      /** Whether this run read the rows the registration names, or `null` when it names none. */
      sliceMatches,
      /**
       * **Whether the device had the inputs it was registered with**, or `null` when the registration names none.
       * `unionFormed: false` means the merge ran with one side empty, and every figure below is about a different device.
       */
      deviceInputs: unionRequired
        ? {
            unionFormed: inputsFormed,
            unionPulls,
            lanesCandidates: Number(on?.merge?.sides?.lanes ?? 0),
            readerCandidates: Number(on?.merge?.sides?.reader ?? 0),
          }
        : null,
      /**
       * **The registration's other clause, when it has one.** `null` for a registration that names no guard, and
       * otherwise whether the guarded arm stayed at or above `notLoweredBy`. R-18's sentence requires both at once, so a
       * verdict that checked only the rising arm would confirm a device that raised one arm by sinking the other.
       */
      guard: guardArm === null ? null : { arm: guardArm, gain: guardGain, met: guardMet },
      /** **The only field a reader needs**, and the one that cannot be true when a gate above it failed. */
      confirms: outcome.startsWith('confirmed'),
      outcome,
      // **Below the resolution and below the registration are two different failures**, and the artifact says which: a
      // 0.03 gain against a 0.02 claim on a corpus that resolves 0.024 is a result, and the same gain on one that
      // resolves 0.04 is not.
      insideResolution,
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
    // **The slice is a parameter because it is now a gate**: a fixture that reads different rows from the ones the
    // registration names cannot confirm it, and the default here is deliberately *not* the registered slice so that the
    // gate has to be satisfied on purpose.
    corpusSlice: overrides.slice ?? { skip: 0, requested: 2 },
    datasetRows: 2,
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: overrides.profile,
      codeContext: overrides.codeContext ?? false,
    },
    truePositives: overrides.tp,
    falsePositives: overrides.fp,
    falseNegatives: overrides.fn,
    precision: overrides.tp / (overrides.tp + overrides.fp),
    recall: overrides.tp / (overrides.tp + overrides.fn),
    f1: (2 * overrides.tp) / (2 * overrides.tp + overrides.fp + overrides.fn),
    fullEmission: { emitted: overrides.tp + overrides.fp },
    // **The second arm is present only when a fixture asks for it**, because a registration that names an arm the
    // artifact does not carry has to be refused, and a fixture that always carried one could never test that refusal.
    ...(typeof overrides.prTp === 'number'
      ? {
          pullRequestArm: {
            findings: overrides.prTp + overrides.prFp,
            truePositives: overrides.prTp,
            falsePositives: overrides.prFp,
            falseNegatives: overrides.prFn,
            precision: overrides.prTp / (overrides.prTp + overrides.prFp),
            recall: overrides.prTp / (overrides.prTp + overrides.prFn),
            f1: (2 * overrides.prTp) / (2 * overrides.prTp + overrides.prFp + overrides.prFn),
          },
        }
      : {}),
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

  // **The two mechanism rules disagree, and the fixture makes them disagree on purpose.** These are the numbers the
  // hundred-pull-request confirmation actually produced: precision up 0.0937, recall down 0.0414. Under R-17's own
  // wording the mechanism held - recall fell by less than precision rose - and under §8's stricter wording it did not.
  // **Before `MECHANISMS` existed, every registration was checked against the stricter rule**, so the artifact filed a
  // `false` under the section whose sentence described what happened.
  const R17 = { precision: 0.0937, recall: -0.0414, tolerance: 0.0014 };
  assert(
    MECHANISMS['recall-trades-below-precision'](R17.precision, R17.recall, R17.tolerance) === true,
    "R-17's own mechanism holds at the measured numbers: recall fell less than precision rose",
  );
  assert(
    MECHANISMS['recall-holds'](R17.precision, R17.recall, R17.tolerance) === false,
    'and §8 rule does not, which is why the rule has to be chosen by the registration',
  );
  // A device that removed recall entirely is a filter that found nothing: neither rule calls precision alone a mechanism.
  assert(
    MECHANISMS['recall-trades-below-precision'](0.2, -0.5, 0.001) === false,
    'a trade that costs more recall than it buys precision is not the trade R-17 registered',
  );
  assert(
    MECHANISMS['recall-holds'](0, 0, 0.001) === false,
    'and a device that moved nothing at all is not a mechanism either',
  );

  const confounded = confoundsBetween({ ...qualifies, corpus: 'other' }, baseline);
  assert(
    confounded.length === 1 && confounded[0].field === 'corpus',
    'a different corpus is refused',
  );

  // **The slice gate, on the numbers the smoke run of 2026-11-11 produced**: ten pull requests from the start of the
  // corpus, a gain of 0.0374 against a resolution of 0.0482, reported as `confirmed` about a claim whose text says the
  // hundred starting at fifty. A confirmation is defined by which rows it read.
  assert(
    good.verdict.sliceMatches === false,
    'a run that read skip 0 max 2 is not R-17 confirmation of skip 50 max 100',
  );
  assert(
    good.verdict.confirms === false,
    'and it confirms nothing, whatever its gain and its mechanism',
  );
  assert(
    good.verdict.outcome.startsWith('not a confirmation'),
    'the outcome says so rather than filing the number under the registration',
  );

  // The same two arms read on the registered slice: now the gain decides.
  const onSlice = (a) => ({ ...a, corpusSlice: { skip: 50, requested: 100 } });
  const confirmed = summarise(onSlice(qualifies), onSlice(baseline));
  assert(confirmed.verdict.sliceMatches === true, 'the registered slice is recognised');
  assert(
    confirmed.verdict.confirms === true,
    'and a gain of 0.2 outside the resolution confirms the registration',
  );

  // **A gain inside the error bar is not a confirmation**, even on the right rows: this pair moves F1 by 0.0667 against
  // a resolution of 0.1649 at ten goldens, which is the branch a device that does almost nothing takes.
  const small = artifact({
    profile: 'defect',
    tp: 4,
    fp: 16,
    fn: 6,
    covered: [[0, 1, 2, 3], [5]],
    goldensPerPr: [5, 5],
    slice: { skip: 50, requested: 100 },
  });
  const inside = summarise(small, onSlice(baseline));
  assert(inside.verdict.magnitudeMet === true, 'the registered magnitude is met');
  assert(
    inside.verdict.insideResolution === true,
    'and the gain is inside what ten goldens resolve',
  );
  assert(
    inside.verdict.outcome.startsWith('inconclusive'),
    'so the outcome is inconclusive rather than confirmed',
  );
  assert(inside.verdict.confirms === false, 'and it confirms nothing');

  // **The arm the registration names, on the pair of numbers that made this field necessary.** These two fixtures are
  // the R-18 run in miniature: the file arm gains 0.2 and the pull-request arm loses 0.0667. Before `arm` existed the
  // threshold was compared against the top-level figure, so this pair - the failing one - reported `magnitudeMet: true`.
  const wideOff = artifact({
    profile: undefined,
    codeContext: false,
    tp: 3,
    fp: 17,
    fn: 7,
    prTp: 3,
    prFp: 17,
    prFn: 7,
    covered: [[0, 1, 2], [3]],
    goldensPerPr: [5, 5],
    // **The slice §20 names**, because a run over other rows cannot confirm it whatever its gain - and the arm test
    // would otherwise be answered by the slice gate instead of by the arm.
    slice: { skip: 14, requested: 36 },
  });
  const fileOnly = artifact({
    profile: undefined,
    codeContext: true,
    tp: 6,
    fp: 14,
    fn: 4,
    prTp: 2,
    prFp: 18,
    prFn: 8,
    covered: [
      [0, 1, 2],
      [3, 4, 5],
    ],
    goldensPerPr: [5, 5],
    slice: { skip: 14, requested: 36 },
  });
  const wrongArm = summarise(fileOnly, wideOff);
  assert(wrongArm.variedField === 'codeContext', 'the varied field is the device under test');
  assert(
    wrongArm.verdict.registeredArm === 'pullRequest',
    'and the threshold is attached to the arm §20 names, not to the arm this file used to read',
  );
  assert(
    wrongArm.byArm.file.delta.f1 > 0.02,
    'the file arm gained more than the registered threshold, which is the trap',
  );
  assert(wrongArm.delta.f1 < 0, 'and the registered arm fell');
  assert(
    wrongArm.verdict.magnitudeMet === false,
    'so the magnitude is not met, on the arm the sentence is about',
  );
  assert(
    wrongArm.verdict.outcome.startsWith('falsified'),
    'and the outcome is falsified rather than confirmed by the neighbouring arm',
  );
  assert(
    wrongArm.byArm.pullRequest !== null && wrongArm.byArm.file !== null,
    'both arms are published, because the arm a claim does not name still moved',
  );

  // **The guard clause, separately**: the registered arm rises far enough and the arm the sentence forbids lowering
  // falls. A verdict that checked only the rising arm would confirm this device.
  const guardBroken = artifact({
    profile: undefined,
    codeContext: true,
    tp: 2,
    fp: 18,
    fn: 8,
    prTp: 5,
    prFp: 15,
    prFn: 5,
    covered: [[0, 1, 2, 3, 4], [3]],
    goldensPerPr: [5, 5],
    slice: { skip: 14, requested: 36 },
  });
  const guarded = summarise(guardBroken, wideOff);
  assert(guarded.verdict.magnitudeMet === true, 'the registered arm clears the threshold');
  assert(guarded.verdict.mechanismMet === true, 'and the mechanism holds on that arm');
  assert(guarded.verdict.guard?.met === false, 'and the arm it must not lower fell');
  assert(guarded.verdict.confirms === false, 'so the registration is not confirmed');
  assert(
    guarded.verdict.outcome.includes('must not lower'),
    'and the outcome names the clause that failed rather than the one that passed',
  );

  // **And a field with two devices answers each with its own claim.**
  //
  // `ensemble: on` merges two lists and `ensemble: reader` selects from one. A lookup keyed on the field alone answers
  // the second with the first's claim - **and then the union gate fires on a device that is defined as one-sided**, so
  // the run that was meant to measure it is refused as `not a test` instead of being measured. Both halves are asserted
  // here because either one alone would leave a plausible way to get the wrong verdict.
  const readerOnly = {
    ...artifact({
      tp: 6,
      fp: 14,
      fn: 4,
      covered: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      goldensPerPr: [5, 5],
    }),
  };
  readerOnly.configuration = { ...readerOnly.configuration, agent: true, ensemble: 'reader' };
  readerOnly.merge = { enabled: true, unionPulls: 0, sides: { lanes: 0, reader: 380 }, pulls: 46 };
  const lanesOnlyArm = {
    ...artifact({
      tp: 3,
      fp: 17,
      fn: 7,
      covered: [[0, 1], [3]],
      goldensPerPr: [5, 5],
    }),
  };
  lanesOnlyArm.configuration = { ...lanesOnlyArm.configuration, agent: false, ensemble: false };
  const readerVerdict = summarise(readerOnly, lanesOnlyArm);
  assert(
    String(readerVerdict.registration?.section ?? '').includes('§58'),
    'a one-sided merge is answered by the registration written for it, not by the union\u2019s',
  );
  assert(
    readerVerdict.verdict.deviceInputs === null,
    'and the union gate does not apply to a device that is defined as one side',
  );
  assert(
    !readerVerdict.verdict.outcome.startsWith('not a test'),
    'so the run is measured rather than refused',
  );

  // **And a registration whose device did not have its inputs is not a test, whatever the gain was.**
  //
  // R-29 is the case this exists for: it was registered as a merge of the five lanes and the reading reviewer, it ran
  // with the lanes emptied upstream, and it reported `confirmed` at +0.0356 - **a plausible figure for a device that was
  // never run.** The gate reads `merge.unionPulls`, which the merge publishes from the candidates it was handed, and it
  // fires before the magnitude is read, because a threshold met by the wrong device is not a threshold met.
  const oneSided = {
    ...artifact({
      tp: 6,
      fp: 14,
      fn: 4,
      covered: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      goldensPerPr: [5, 5],
    }),
  };
  oneSided.configuration = { ...oneSided.configuration, agent: true, ensemble: true };
  oneSided.merge = { enabled: true, unionPulls: 0, sides: { lanes: 0, reader: 394 }, pulls: 46 };
  const oneSidedWithout = {
    ...artifact({
      tp: 3,
      fp: 17,
      fn: 7,
      covered: [[0, 1], [3]],
      goldensPerPr: [5, 5],
    }),
  };
  oneSidedWithout.configuration = {
    ...oneSidedWithout.configuration,
    agent: false,
    ensemble: false,
  };
  const notATest = summarise(oneSided, oneSidedWithout);
  assert(
    notATest.verdict.deviceInputs?.unionFormed === false,
    'a merge that received no lane candidates did not form the union it was registered to merge',
  );
  assert(
    notATest.verdict.confirms === false,
    'and a run whose device had no inputs confirms nothing',
  );
  assert(
    notATest.verdict.outcome.startsWith('not a test'),
    'and the outcome says so rather than reporting the gain',
  );

  // **A registration about an arm the artifact does not carry is refused**, rather than answered by the nearest number.
  let missing = null;
  try {
    summarise(
      artifact({
        profile: undefined,
        codeContext: true,
        tp: 6,
        fp: 14,
        fn: 4,
        covered: [[0, 1, 2]],
        goldensPerPr: [5, 5],
      }),
      wideOff,
    );
  } catch (error) {
    missing = error;
  }
  assert(
    missing !== null && /pull-request arm/.test(missing.message),
    'an artifact with no pull-request arm cannot answer a registration that names one',
  );

  // A registration that names a rule the table does not implement must be refused rather than approximated.
  assert(
    Object.keys(MECHANISMS).every((name) =>
      Object.values(REGISTRATIONS).some((r) => r.mechanismRule === name),
    ),
    'every mechanism rule is named by a registration, so none of them is dead',
  );
  for (const registration of Object.values(REGISTRATIONS))
    assert(
      MECHANISMS[registration.mechanismRule],
      `registration ${registration.section} names a rule the table implements`,
    );

  const sameFlag = confoundsBetween(qualifies, {
    ...baseline,
    configuration: { ...baseline.configuration, emissionProfile: 'defect' },
  });
  assert(
    sameFlag.some((c) => c.field === 'configuration'),
    'two runs of the same arm are refused, because their null result would look like a finding',
  );

  // **Two arms that wrote the same object twice are one variable, not two.**
  //
  // The refusal below was the real one of 2026-11-19, quoted from the artefact rather than invented: `differ` was
  // `["adjudicate", "agentOptions"]` and the two `agentOptions` serialised identically. The keys are written in opposite
  // order here on purpose, because **the insertion order is the thing `JSON.stringify` was comparing and the value is the
  // thing that was meant**.
  const objectArms = variedField(
    {
      ...qualifies,
      configuration: {
        ...qualifies.configuration,
        adjudicate: 'on',
        agentOptions: { lanes: ['defect', 'security'], perFile: 3 },
      },
    },
    {
      ...qualifies,
      configuration: {
        ...qualifies.configuration,
        adjudicate: 'off',
        agentOptions: { perFile: 3, lanes: ['defect', 'security'] },
      },
    },
  );
  assert(
    objectArms.field === 'adjudicate',
    'two arms whose shared options serialise identically differ in one field, not in two',
  );
  assert(
    objectArms.differ.length === 1,
    'and the second reference is not reported as a second variable',
  );
  // **And a genuinely different object is still refused**, because the repair must not become a way to hide a confound.
  const reallyDifferent = variedField(
    {
      ...qualifies,
      configuration: {
        ...qualifies.configuration,
        agentOptions: { lanes: ['defect', 'security'], perFile: 3 },
      },
    },
    {
      ...qualifies,
      configuration: {
        ...qualifies.configuration,
        agentOptions: { lanes: ['defect'], perFile: 3 },
      },
    },
  );
  assert(
    reallyDifferent.differ.includes('agentOptions'),
    'an object whose entries actually differ is still a varied field',
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

  /**
   * **An entailment is not a confound, and R-22's pair is what said so.**
   *
   * `agent: on` sets `codeContext: true` inside the arm, because a reader cannot be switched on without being shown the
   * code it reads - so that pair differs in two configuration keys and the guard refused it with
   * `differ: ["codeContext", "agent"]` **on a run that had already been paid for**. The device is one switch; the second
   * key is what the switch means. **The rule is directional**: the entailed key must be `true` on the varied arm and
   * `false` on the baseline, or the pair differs in two independent devices and is still refused.
   */
  const agentOff = {
    ...baseline,
    configuration: {
      ...baseline.configuration,
      emissionProfile: undefined,
      agent: false,
      codeContext: false,
    },
  };
  const agentOn = {
    ...qualifies,
    configuration: {
      ...qualifies.configuration,
      emissionProfile: undefined,
      agent: true,
      codeContext: true,
    },
  };
  const entailed = variedField(agentOn, agentOff);
  assert(entailed.field === 'agent', 'the switch is the variable and the window is what it means');
  assert(
    entailed.differ.length === 2 &&
      entailed.entailed.length === 1 &&
      entailed.entailed[0] === 'codeContext',
    'and the entailed key is named rather than dropped silently',
  );
  // **And the guard accepts the pair, which is the assertion that was missing.** The first version of this test read
  // `variedField` alone and passed while `confoundsBetween` still refused the pair on `differ.length`, so the paid run
  // stayed rejected and the test that was supposed to prevent that reported success.
  assert(
    confoundsBetween(agentOn, agentOff).length === 0,
    'the confound guard accepts a switch and the key it entails, which is what R-22 needed',
  );
  // **An entailment that runs the other way is two devices.** A baseline that *had* the window and a varied arm that
  // drops it while switching the reader on differs in two keys in opposite directions, and a guard that accepted that
  // would accept a pair whose second variable was removed rather than implied.
  const inverted = variedField(
    { ...agentOn, configuration: { ...agentOn.configuration, codeContext: false } },
    { ...agentOff, configuration: { ...agentOff.configuration, codeContext: true } },
  );
  assert(
    inverted.field === null && inverted.differ.length === 2,
    'a window switched off while the reader is switched on is a confound, not an entailment',
  );
  assert(
    confoundsBetween(
      { ...agentOn, configuration: { ...agentOn.configuration, codeContext: false } },
      { ...agentOff, configuration: { ...agentOff.configuration, codeContext: true } },
    ).some((confound) => confound.field === 'configuration'),
    'and the guard refuses it, so the direction of the entailment is enforced rather than described',
  );

  /**
   * **And the merge's pair, which differs in three keys and is still one device.**
   *
   * `ensemble: on` needs `agent: on`, which carries `codeContext: true` - so the arm that measures §56 differs from the
   * lane arm in `agent`, `codeContext` **and** `ensemble`. The first version of this table listed one entailment per
   * switch and the guard resolved `agent` out of a pair that still had `ensemble` unexplained, which is the same
   * false refusal that cost R-22 four hours, one level up.
   */
  const lanesArm = {
    ...baseline,
    configuration: {
      ...baseline.configuration,
      emissionProfile: undefined,
      agent: false,
      codeContext: false,
      ensemble: false,
    },
  };
  const ensembleArm = {
    ...qualifies,
    configuration: {
      ...qualifies.configuration,
      emissionProfile: undefined,
      agent: true,
      codeContext: true,
      ensemble: true,
    },
  };
  const merged3 = variedField(ensembleArm, lanesArm);
  assert(merged3.field === 'ensemble', 'the merge is the device and the reviewer is what it needs');
  assert(
    merged3.entailed.length === 2 &&
      merged3.entailed.includes('agent') &&
      merged3.entailed.includes('codeContext'),
    'and both keys the merge entails are named rather than absorbed silently',
  );
  assert(
    confoundsBetween(ensembleArm, lanesArm).length === 0,
    'the guard accepts a merge against the lanes, which is the pair §56 registers',
  );
  /**
   * **And a merge with no second reviewer is refused by the harness rather than by this guard**, which is worth an
   * assertion because it is the one malformed dispatch the table cannot see: with `agent: false` the configuration
   * differs in `ensemble` alone, so `variedField` reports a clean one-key pair - **and the arm that ran was the lanes
   * with a flag that did nothing.** `aacr-bench.mjs` refuses that combination at startup and a test holds it there.
   */
  const impossible = {
    ...ensembleArm,
    configuration: { ...ensembleArm.configuration, agent: false, codeContext: false },
  };
  assert(
    variedField(impossible, lanesArm).field === 'ensemble',
    'a merge switched on without the reader looks like a single-variable pair, which is why the harness refuses it',
  );

  console.log(
    `AACR-ABLATION self-test ok · ${String(good.variedField)} · gain ${String(good.delta.f1)} · null ${String(nothing.delta.f1)} · trade ${String(traded.delta.f1)} · resolution ${String(good.resolution)} · refusals ${String(confounded.length + sameFlag.length + swapped.length + shortArm.length)}`,
  );
}

/**
 * **A configuration value as a reader can see it.**
 *
 * `remarks` is an object (`{ enabled, families, ceilingPerFile, why }`), so `String(value)` printed
 * `[object Object] vs [object Object]` on the one line a person reads to find out which way round the arms were - and a
 * log line that cannot say which value belonged to which arm leaves the artifact as the only record of the comparison.
 */
function describeValue(value) {
  if (typeof value !== 'object' || value === null) return String(value);
  const text = JSON.stringify(value);
  // **And bounded**, because the alternative is a line that names the two arms in six hundred characters of prose the
  // arm itself carries as `why`. The artifact keeps the whole value; the line keeps the part that distinguishes them.
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
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
    `AACR-ABLATION compared · ${String(artifact.variedField)} ${describeValue(artifact.arms.with)} vs ${describeValue(artifact.arms.without)} · delta ${String(artifact.delta.f1)} · paired +${String(artifact.pairedTest.withOnly)}/-${String(artifact.pairedTest.withoutOnly)} p=${String(artifact.pairedTest.pValue)} · ${String(artifact.verdict.outcome)}`,
  );
}

// **The run is conditional**, because the module is imported by a unit test and by nothing else at import time - and a
// script that calls `main()` on import cannot be asked a question about its own arithmetic.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
