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
import { clusterBootstrapDelta } from '../../scripts/lib/corpus-resolution.mjs';
import { pairedComparison } from './lib/paired-test.mjs';

/**
 * **The two arms' coverage rows, one pull request at a time**, which is the unit the corpus is sampled in.
 *
 * Matched on `pr` rather than on position, because two artifacts written by two dispatches do not have to list their
 * rows in the same order and a positional join would pair one pull request's goldens with another's. Rows present on
 * one side only are dropped and counted, so a verdict never claims to have resampled a corpus it only half read.
 */
function pairedCoverageRows(onArtifact, offArtifact) {
  const onRows = Array.isArray(onArtifact?.coverage?.byPullRequest)
    ? onArtifact.coverage.byPullRequest
    : [];
  const offRows = Array.isArray(offArtifact?.coverage?.byPullRequest)
    ? offArtifact.coverage.byPullRequest
    : [];
  const offByKey = new Map();
  for (const [at, row] of offRows.entries()) offByKey.set(String(row?.pr ?? at), row);
  const withRows = [];
  const withoutRows = [];
  for (const [at, row] of onRows.entries()) {
    const other = offByKey.get(String(row?.pr ?? at));
    if (other === undefined) continue;
    withRows.push(row);
    withoutRows.push(other);
  }
  return { withRows, withoutRows, onRows: onRows.length, offRows: offRows.length };
}

/**
 * **The standard normal distribution function**, Abramowitz and Stegun 7.1.26, |error| < 1.5e-7.
 *
 * Written out rather than imported because the alternative is a dependency for eighty characters of arithmetic, and a
 * p-value that a reader cannot recompute from the artifact is a p-value that has to be believed.
 */
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const tail =
    density *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}

/** Two-sided p for a z statistic, which is the number the outcome sentence quotes. */
function twoSidedP(z) {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

/**
 * **Which rows an artifact read**, as a set of slices.
 *
 * A single dispatch carries `corpusSlice`, one slice. A merge carries `corpusSlice.slices`, several - and the difference
 * is what decides which of two sentences about one switch an artifact can answer.
 */
function readSlicesOf(artifact) {
  const slice = artifact?.corpusSlice ?? null;
  if (slice === null || typeof slice !== 'object') return null;
  if (Array.isArray(slice.slices) && slice.slices.length > 0) {
    return slice.slices.map((entry) => ({ skip: Number(entry.skip), max: Number(entry.max) }));
  }
  return [{ skip: Number(slice.skip), max: Number(slice.requested) }];
}

/**
 * **The registration an artifact's rows can answer, most specific first.**
 *
 * `REGISTRATIONS` is keyed by the configuration field a device varies, which was enough while one dispatch was one slice.
 * A field can now carry more than one sentence - the bar a single dispatch was registered against, and a bar for the
 * corpus two dispatches make - and **the lookup has to choose by rows rather than by key**, or a merged artifact would be
 * judged against a bar written for a hundred rows and a single dispatch would inherit the wider one.
 *
 * A candidate matches when every slice it names is among the rows the artifact read; ties go to the candidate naming
 * more slices. **The field's own entry is the fallback**, so a field with one sentence and an artifact whose rows it does
 * not name still gets an answer rather than a silence.
 *
 * **A field can also carry two devices that vary it in opposite directions, and the arm's name is what tells them
 * apart.** `laneSet` is that field: §69.5's `behaviour` swaps a lane and §113.4's `lean` removes one, so a lookup that
 * answered both with the same sentence wrote R-35's claim, R-35's bar and R-35's slice into the artifact of a run that
 * registered none of them - and `verdict.outcome` then read *"not a confirmation: the registration names skip 50 max
 * 146, and this run read skip 0 max 50"* about a pair those numbers have nothing to do with. **An entry that names its
 * arms is answered only for those arms**, and a pair no entry names resolves to `null`, which the report writes as a
 * refusal rather than as a verdict about somebody else's device.
 */
export function registrationFor(field, readSlices, armName = null) {
  const keys = Object.keys(REGISTRATIONS).filter(
    (key) => key === field || REGISTRATIONS[key].field === field,
  );
  if (keys.length === 0) return null;
  /** **An entry with no `arms` answers any arm on its field** - every registration written before this one. */
  const namesArm = (entry) =>
    entry.arms === undefined || (armName !== null && entry.arms.includes(armName));
  const matches = keys
    .map((key) => ({ key, entry: REGISTRATIONS[key] }))
    .filter(({ entry }) => {
      if (!namesArm(entry)) return false;
      const declared = entry.confirmation ?? [];
      return (
        declared.length > 0 &&
        readSlices !== null &&
        declared.every((want) =>
          readSlices.some((got) => got.skip === want.skip && got.max === want.max),
        )
      );
    })
    .sort(
      (left, right) =>
        (right.entry.confirmation?.length ?? 0) - (left.entry.confirmation?.length ?? 0),
    );
  if (matches.length > 0) return matches[0].entry;
  const fallback = REGISTRATIONS[field] ?? null;
  return fallback !== null && namesArm(fallback) ? fallback : null;
}

/**
 * **The registrations this job cannot read, and the reason each one is a reading instead of a verdict.**
 *
 * R-52 is a **cost band**: at most 85 % of the shipped arm's total USD with F1 inside ±0.005 of it. This job computes
 * one gain, compares it to one bar and asks whether the corpus can resolve it - and a claim whose second clause is *"do
 * not lose more than a golden is worth"* and whose first clause is a **bill** has no shape here: a bar at 0.005 would be
 * under the corpus resolution and refused by `registrationResolvable`, and a bar at the point estimate would be a bar
 * chosen after the run. **So the pair resolves to no verdict and the artifact says where the reading is**, which is what
 * keeps `registration: null` from being read as "nobody registered this".
 */
export const UNREAD_REGISTRATIONS = Object.freeze({
  'laneSet:lean':
    "§113.4 (R-52) is a cost band - at most 85 % of the shipped arm's total USD with F1 within 0.005 of it - and this job compares one gain against one bar, so the pair is read in docs/EVAL-CONTRACT.md §113.6 rather than written as a verdict here",
});

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
    // hundred needs 159 minutes of a 340-minute ceiling** - inside the confirmation guard below with 183 minutes even on
    // a 15 % slow day - so the registration is answered by the run it names rather than by two runs that add up to it.
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
  /**
   * **§59's registration (R-32): a second concern at a site is a comment, not a duplicate.**
   *
   * The run of 2026-11-16 removed **2 273 of its 2 295 merged findings under the range rule alone** - overlapping ranges,
   * no textual agreement, and therefore no evidence that the two sentences are about one defect - and **276 of its 455
   * rejected goldens sat on a line it had commented on**. `electron#47361` is the case in the corpus: a use-after-free and
   * an O(n^2) erase on one line, and a reviewer that says one true thing per site loses the second every time.
   *
   * **The claim is arithmetic before it is a hope.** With `TP` credited goldens, `C` comments and `G` goldens,
   * `F1 = 2TP/(C+G)`, so **an added comment raises F1 exactly when its own precision exceeds `F1/2`** - 0.1036 on the
   * lanes' 0.2072, and not the 0.30 that §58.4 published. The device adds at most one comment per site on the 602
   * cross-category sites the round recorded, and the category base rates it draws from run from 0.17 to 0.32, **so the
   * registered bar is the house 0.01 rather than the 0.02 the device could reach if those rates transfer** - the rates
   * were measured on survivors, and a survivor is not a discarded restatement.
   *
   * **The mechanism is `recall-rises`, and it is the mirror of every other entry here.** This device adds comments; it
   * cannot raise precision, and a registration that asked it to would be asking a filter to behave like a merge. What it
   * must not do is buy recall with precision beyond a golden's worth, and that is the tolerance the rule reads.
   */
  secondConcern: {
    section: '§59 (R-32)',
    claim:
      'keeping one finding of a different category at a range the reviewer already reported raises the file arm F1 by at least 0.01 and recall, without lowering precision by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.01,
    // **Registered before the corpus bar was measured, and below it.** §60's 0.0017 said a 0.01 bar was answerable;
    // `CORPUS_SAMPLING` says a second corpus of 98 rows moves the difference by 0.0191, so 0.01 is inside the corpus'
    // own noise. The run is paid for and the flag is not a licence to read it as confirmed - `registrationResolvable`
    // returns `false` for this entry, and its outcome may only be recorded as a point estimate. **Rewriting the bar
    // after the fact would be the one thing worse than registering it too low.**
    registeredBelowResolution: true,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    confirmation: [{ skip: 50, max: 100 }],
  },
  /**
   * **§124's registration (R-64): a site may keep three remarks, not one.**
   *
   * R-55 entered deduplication with **1 646 findings and left it with 530**. Of the 1 116 removed, **1 112 went under
   * `rangeOnly`** - overlapping ranges with no textual agreement behind the merge - and **`keptAsSecondConcern` was 0**,
   * because §59's switch keeps one extra finding at a site and only when the *category* differs. **The goldens do not
   * distribute themselves by category**: `ClusterChangedEvent.java:351-369` carries four goldens and three are `bug`,
   * `InstrumentationServiceImpl.java:67-135` carries four more. So the cap becomes a number.
   *
   * **The claim is written on the quantity the run measures directly**, which is the pool's true positives, because
   * §124.2 measured the ceiling they impose: **91 of 330 goldens at `k = 530`, and 75 at the shipped `k = 296`**. No
   * emission rule can raise 91 - raising the per-pull-request budget from 12 to 32 moves recall 0.2280 to 0.2766 and F1
   * *down* from 0.2149 to 0.2139 - **so the only lever left on recall is what enters the pool**, and a merge that keeps
   * one remark per range is the largest thing removing candidates before the ranking sees them.
   *
   * **F1 is the guard rail and not the claim.** A kept second finding is worth its own precision, and §59's arithmetic
   * applies unchanged: `F1 = 2TP/(C+G)`, so an added comment raises F1 exactly when its precision exceeds `F1/2`
   * (0.107 here). The 76 strong-overlap pairs found offline are an upper bound on what the cap can recover and **not a
   * prediction of their precision**, which is why the registration asks for recall and tolerates a golden's worth of
   * precision instead of promising a gain.
   *
   * **0.01 with `registeredBelowResolution`**, because 46 rows sign 0.0281 and anything smaller cannot be confirmed by
   * them - the same honest shape as R-32's entry, and rewriting the bar after the number arrives is the one defect
   * worse than registering it too low.
   */
  sameSiteConcerns: {
    section: '§124 (R-64)',
    claim:
      'keeping up to three findings at a range the reviewer already reported raises the pool recall ceiling from 91 to at least 110 true positives of the 330 goldens on rows 150-195, and raises recall, without lowering precision by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.01,
    registeredBelowResolution: true,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    confirmation: [{ skip: 150, max: 46 }],
  },
  /**
   * **§125's registration (R-65): a second reviewer from a different model family.**
   *
   * *A Single LLM Is an Incomplete Code Reviewer* (Zenodo 20519584, 2026) measured fifteen model versions across eight
   * providers on 33 artifacts and 294 confirmed issues: **no model above about 61 % recall, 56.8 % of confirmed defects
   * found by exactly one model, median cross-family Jaccard 0.29, and a second reviewer taking per-artifact coverage
   * from 47 % to 72 %.** That is a larger effect than every device this campaign has priced in twenty iterations, and
   * it is the mechanism `ensemble` already exists for.
   *
   * **110 rather than a transplanted +25 points.** 110 is §124.5's bar for the merge cap, and reusing it makes the two
   * devices indistinguishable in the record - which is why the claim says *pool true positives*, the quantity both act
   * on, and why it is 6.1 resolution units of recall rather than a citation.
   *
   * **Registered before the wiring exists**, because the device this campaign needs most is the one whose bar has to be
   * written while it is still inconvenient. `ZHIPU_API_KEY` is already an organization secret used by the embedding
   * channel, and the provider takes a base URL and a model name, so the second family is a second provider instance.
   */
  secondFamily: {
    section: '§125 (R-65)',
    claim:
      'a second reviewer drawn from a different model family raises the pool true positives from 91 to at least 110 of 330 on rows 150-195 with the five shipped lanes, without lowering precision by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.01,
    registeredBelowResolution: true,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    confirmation: [{ skip: 150, max: 46 }],
  },
  /**
   * **§68's registration: the same device over both halves of one corpus.**
   *
   * §67 turns two dispatches into one corpus of two hundred pull requests, which halves the standard deviation a bar has
   * to clear - 0.0106 against 0.0150 - and **the bar for that corpus had to be written before the second slice was
   * read**, or it would be a description of the number it is meant to test. **0.021 is 1.96 x 0.0106 rounded up**, taken
   * from the arithmetic in §67 and not from R-32's 0.0296.
   *
   * `field` is what makes two sentences about one switch possible: `REGISTRATIONS` is keyed by the configuration field a
   * device varies, and the lookup now asks which sentence the artifact's **rows** can answer, most specific first. A
   * single dispatch is still judged against §59's 0.01, so a published verdict stays reproducible.
   */
  secondConcern200: {
    section: '§68 (R-34)',
    field: 'secondConcern',
    claim:
      'keeping one finding of a different category at a range the reviewer already reported raises the file arm F1 by at least 0.021 over the two hundred pull requests this registration names, and raises recall, without lowering precision by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.021,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    confirmation: [
      { skip: 50, max: 100 },
      { skip: 150, max: 100 },
    ],
  },
  /**
   * **§69.5's registration (R-35): the same diff, a different question asked of it.**
   *
   * Four devices have been closed by their own artifacts - the code window (negative at 22 of 23 cuts), the claim check
   * (§45), the reader (unstable across slices, §63) and the second concern (+0.0089 on 146 rows against a bar it could
   * not reach, §69.1) - and **every one of them changed the cut, the matcher or the second pass. Not one of them changed
   * what a lane is asked to say.**
   *
   * **The sentence was written before the device existed, and the device was built to fit it rather than the reverse.**
   * `behaviour` swaps the `testing` lane - which reaches this corpus's question 8.6 % of the time at precision 0.111 and
   * whose own removal gains 0.0069 F1 - for a lane asked *which value, state or sequence that can reach this line makes
   * it produce something wrong*, at the same five calls per file. **A substitution and not an addition**, so a difference
   * between the arms is the question and not the budget.
   *
   * **0.026 rather than 0.021**, because 146 rows is what the merged corpus has and 0.0255 is the smallest gain it can
   * sign (§69.2). **A bar under its own resolution is a sentence that cannot be true**, which is the defect §68 had and
   * this entry corrects.
   *
   * **`recall-rises`**, because §69.4 says the losses are defects never claimed rather than claims that were refused: a
   * device registered under `recall-holds` would be answered by a rule that cannot see its own mechanism.
   *
   * **And the falsifier is not in this object, because it is not a figure this job computes.** §69.5 states it: a
   * companion reading of the same run's rejected pairs must show the 16 %-floor moving. If the seven recoverable pairs
   * stay at seven, the device did not find new defects - **it found new sentences about old ones**, and no F1 movement
   * turns that into a confirmation.
   *
   * **The slice is `skip 50, max 146`, which is the same 146 rows R-32 and R-33 read, bought in one dispatch rather
   * than two merged ones** - and the choice is stated here because it was made before the run landed. `skip 50, max
   * 100` is R-32's rows (50-149) and `skip 150` is R-33's (150-195); one dispatch over 50-195 reads the union in one
   * artifact, and §20.4's measurement is why that is better than the merge: **two dispatches of *one* configuration
   * have reported 0.1691 and 0.2405**, so a corpus assembled from two runs carries their difference as well as the
   * device's. **The bar is unchanged at 0.026**, because the row count is unchanged at 146 and it is rows that decide
   * what can be signed.
   */
  // **§75 (R-37) has no entry here, and the absence is the finding.**
  //
  // The union of the two lane sets is built and wired: `LANE_SETS.wide` is the five lanes plus `behaviour`, the matrix
  // buys it as `lane_set: pair-wide`, and the download step and its guard test are in place. **What it does not have is a
  // registration, because this corpus cannot sign one.**
  //
  // The arithmetic was done before the run rather than after: if `behaviour`'s 24 goldens are disjoint from `testing`'s
  // 59, the union reads TP 232 against FP 820 on 1 054 goldens - **F1 0.2203, +0.0155** - and **146 rows resolve
  // 0.0191**. A bar at the point estimate is under the instrument's own error bar, which the self-test refuses with the
  // sentence §69.5 wrote: *a bar under its own resolution is a sentence that cannot be true.* A bar at 0.02 instead would
  // be a bar chosen above its own estimate so that a failure could be reported as a result, which is worse.
  //
  // **So R-37 is a component, not an experiment.** It is one arm of the combined dispatch §75 describes - width plus a
  // precision device - whose expected gain is 0.035 and therefore signable. Building it now is what makes that dispatch
  // possible in one run rather than two.
  //
  // This is also the general finding: **at 200 pull requests and 1 054 goldens, the instrument cannot resolve anything
  // smaller than 0.019**, and every device this repository registered before §69 that claimed 0.02 was claiming a number
  // the corpus could not distinguish from zero. The corpus is the ceiling on the *rate* of learning, not the devices.

  laneSet: {
    section: '§69.5 (R-35)',
    claim:
      'a lane asked for the value that breaks a changed line, in place of the testing lane, raises the file arm F1 by at least 0.026 on the 146 pull requests R-32 and R-33 read, and raises recall',
    /**
     * **The arm this sentence is about, because this field now carries two devices.** `behaviour` substitutes a lane;
     * §113.4's `lean` removes one and claims a bill rather than a gain. Without this line a `pair-lean` run was answered
     * with R-35's claim, bar and slice and produced a verdict about an experiment nobody registered - see
     * `registrationFor` and `UNREAD_REGISTRATIONS`.
     */
    arms: ['behaviour'],
    arm: 'file',
    registeredGain: 0.026,
    mechanism: 'recall rises and precision does not fall by more than a golden is worth',
    mechanismRule: 'recall-rises',
    confirmation: [{ skip: 50, max: 146 }],
  },
  /**
   * **§73's registration (R-36): the gate that keeps by default, priced against the pool it filters.**
   *
   * This is the device the field's own paper names as *independent reflection* - a falsification-first filter whose
   * reflector **sees only the diff and not the reviewer's exploration**, which the authors say removes hallucinated
   * comments *"without the self-reinforcing bias of intrinsic self-critique"* - and it is the one class this repository
   * had only ever tested in its most destructive form. §44-§45's adjudicator asks the same question once per finding and
   * trusts the answer: precision 45.5 %, recall 6.6 %, F1 19.5 % → 11.6 %. **A gate that drops nine of every ten
   * sentences is not a filter, it is a quieter reviewer.**
   *
   * **What is different is the contract, and it is arithmetic before it is taste.** `F1 = 2TP/(C+G)`, so **a removed
   * comment raises F1 exactly when it was a false positive**. The merged pool on these rows is 1 643 ranked rows of
   * which 343 are acceptable, so **1 300 of them are worth removing and 343 are not** - which is why a gate judged on
   * precision alone will always look like it is working. So this one is asked **once per file**, keeps by default, and
   * applies a removal only when the reader quotes a line **this diff added**, the quote is at least ten characters, and
   * the quote is found in those lines. **A refutation whose quote cannot be found is not applied and is counted**
   * (`keptBecauseQuoteMissing`), and that counter is the difference between a strict gate and a reader that invents
   * refutations.
   *
   * **The bar is 0.026 against a resolution of 0.0157 at these 1 054 goldens** - cleared by a factor of 1.7 rather than
   * by a rounding step - and the mechanism is `recall-holds`, because the entire distance between this device and §45's
   * is the claim that precision can be bought without paying recall.
   *
   * **The falsifiers are stated with the claim.** F1 below **0.2336** (the lanes' 0.2076 plus the registered 0.026) is a
   * falsification, and so is a recall below the lanes' less one golden - **because a gate that buys precision by
   * deleting true positives is the failure this device is most exposed to**, and a registration that named only F1 would
   * accept exactly that trade and call it a confirmation.
   *
   * **The key is `falsifier` rather than `adjudicate:falsifier`, and that is a fact about the artifact.** The gate is
   * dispatched as a third value of the existing input, but the artifact records it as its own configuration key beside
   * `adjudicate: false` - so the field that varies between the two arms is `falsifier`, and a registration filed under
   * the input's name would be a sentence no artifact can reach. **The name of the switch a dispatch flips and the name
   * of the field that proves it was flipped are two different facts**, and the comparison reads the second.
   *
   * **The slice is `skip 50, max 146` - the rows R-32, R-33 and R-35 read - and the confirmation debt is named rather
   * than hidden.** The anatomy the device was designed from (§72.3) was read on these rows, so this dispatch is a
   * discovery; the corpus holds 200 pull requests and 196-199 are the only rows no run has read, which is four rows and
   * cannot carry a 0.026 bar. **A confirmation therefore needs a corpus that grows or a slice that is bought twice**,
   * and writing that here is the difference between a registration with a debt and one pretending not to have any.
   */
  falsifier: {
    section: '§73 (R-36)',
    claim:
      'a gate asked once per file that removes a claim only when a line the diff added is quoted against it raises the file arm F1 by at least 0.026 on the 146 pull requests R-32, R-33 and R-35 read, and does not lower recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.026,
    mechanism: 'precision rises and recall does not fall by more than a golden is worth',
    mechanismRule: 'recall-holds',
    /**
     * **This device can only remove claims, so the most it could ever have moved F1 is computable before the run.**
     *
     * §76's third verdict reads `deletionCounter` and answers *was the bar inside this device's reach at all* before it
     * answers *did the device reach it*. **Both flags are declared rather than inferred from `mechanism`**: a mechanism
     * is a sentence about precision and recall, and two devices that move them the same way can have different reach -
     * the gate removes, a substitution replaces.
     */
    deletionOnly: true,
    deletionCounter: 'falsifier.dropped',
    /**
     * **Empty, and the reading is §74's.** This device was measured on its registered slice: F1 **0.2048 → 0.1585**
     * (delta −0.0463, paired +41/−110, p ≈ 0), so the claim was falsified and a slice list here would be a promise to
     * spend money re-reading a verdict that has already been read - the same reason §8's entry is closed.
     *
     * **What that run also established is the reason the next entry exists.** Of the 557 claims the gate removed, only
     * 277 could have reached a reviewer - the rest were beyond `maxFindingsPerFile` and were never going to be filed -
     * and **69 of those 277 were true positives, 24.9 % against a pool rate of 21.3 %.** The gate was not imprecise; it
     * was very slightly anti-selective, which is a different and more useful finding: **the contract admitted a
     * tautology**, because the quotable set contained the very line each claim was anchored to.
     */
    confirmation: [],
  },
  /**
   * **§74's registration (R-36b): the same gate with the claim's own range removed from its evidence.**
   *
   * The first contract's defect was not its reader. Under `quoted-falsifier-v1` a claim at line 12 saying *the y
   * component is doubled* could be refuted by quoting line 12 - `keptBecauseQuoteMissing` was 27 of 584 refutations
   * (4.6 %), which is the same fact from the other side: **a reader that may quote the claim's own line can always
   * quote something.** All twelve removals sampled from that run quote a line inside the range they attack, and the
   * arithmetic agrees: 24.9 % of the removals that could have been filed were true, against 21.3 % in the pool.
   *
   * **So the second contract subtracts the claim's range from the quotable set**, in the prompt (each claim is printed
   * with the range that is not evidence for it) and in the checker (`keptBecauseSelfReferential`). What remains is the
   * only thing that could ever have refuted a sentence: **the rest of the change** - a guard three lines up, a
   * `reserved` tag below, the check the claim said was missing. **A gate with nothing else to point at keeps every
   * claim**, which is the direction this device has always been allowed to fail in.
   *
   * **The bar is 0.02, and it is deliberately below §73's 0.026.** The device's opportunity is smaller: it may only
   * remove claims whose refutation lives elsewhere in the same hunk, and the first contract could remove anything. **A
   * bar copied from the contract that had more freedom would be a bar chosen to be missed.** 0.02 is 1.27× the
   * resolution at these goldens (0.0157), which is thin - so the reading is stated with it: **a gain of 0.02 with a
   * removal count under 40 is not a confirmation of this device, it is a demonstration that this corpus's claims have
   * no independent evidence to find**, and the direction closes rather than being tuned again.
   *
   * **The mechanism is `recall-holds` for the same reason as §73's, and it is the failure branch.** A gate whose
   * removals are 24.9 % true positives raises precision by paying recall; the second contract's whole claim is that the
   * true-positive share of its removals falls. **If F1 rises while recall falls by more than a golden, the device has
   * learned nothing from §74** and the registration refuses it.
   *
   * **The confirmation debt is the same debt, named again.** These 146 rows have now read four devices, and rows 196-199
   * are the only four the corpus has left; **a 0.02 bar on four rows is not a confirmation**, so this dispatch is a
   * discovery and the next corpus expansion is the only thing that can close it.
   */
  'falsifier:independent-evidence-v2': {
    section: '§74 (R-36b)',
    claim:
      'a gate that removes the claim’s own range from its evidence, and so can only be refuted by the rest of the change, raises the file arm F1 by at least 0.02 on the 146 pull requests R-32, R-33, R-35 and R-36 read, without lowering recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.02,
    mechanism:
      'precision rises and recall does not fall by more than a golden is worth, because the removals carry fewer true positives than the pool does',
    mechanismRule: 'recall-holds',
    /**
     * **The floor below which a difference is not about this contract.**
     *
     * §74.4 states it in prose and this field is where it is enforced: the second contract may only remove a claim whose
     * refutation lives elsewhere in the same hunk, so **a run that removes a handful of claims and moves F1 by a
     * thousandth of a point has said something about this corpus's claims, not about the device.** Forty is roughly a
     * seventh of the first contract's removals that could have been filed (277 over the same 146 rows), which is the
     * smallest count at which "which ones" is a question the artifact can answer.
     */
    activity: { counter: 'falsifier.dropped', atLeast: 40 },
    /** The reach arithmetic of §76, declared for the same reason the first contract declares it. */
    deletionOnly: true,
    deletionCounter: 'falsifier.dropped',
    confirmation: [{ skip: 50, max: 146 }],
  },
  /**
   * **R-38: the same gate with somewhere else to look.**
   *
   * §78 reads `v2`'s run as a contract that worked and ran out of material. It removed **169 claims carrying 8 true
   * positives - 4.73 %**, against the 24.9 % of §73's gate and the 4 % §75.3 asks for, so the pool is clean; and 169
   * removals move F1 by **0.0176 at most**, under the 0.02 registered, so §76's own arithmetic called the run
   * `unreachable` rather than falsified.
   *
   * **The 183 claims it left behind are the material, and they are one shortage.** 148 were kept because the only line
   * the reader could quote lay inside the claim's own range, 35 because the quote matched no line it had been shown - and
   * both are the same fact: a hunk of three added lines carries no independent evidence about those three lines. `v3`
   * adds the file's untouched lines around each claim to the evidence, so the guard forty lines above the change can
   * refute a sentence about the change.
   *
   * **The bar is the same 0.02 and the floor is a reach floor, but the reach floor moves with the baseline.** §76.2
   * computed 181 against §73's counts (208 true positives, 769 false positives); R-36b's own control read **198 and
   * 784**, and against that pair the count at which a perfect deletion pool reaches +0.0200 is **190**. So the floor is
   * 190 here rather than 40 or 181 - and **a floor copied from another section's arithmetic is a floor for another
   * corpus**, which is the reason this one is derived rather than quoted.
   */
  'falsifier:independent-evidence-v3': {
    section: '§78 (R-38)',
    claim:
      'a gate that may quote the file’s untouched lines around a claim, and still may not quote the claim’s own range, raises the file arm F1 by at least 0.02 on the 146 pull requests R-36b read, without lowering recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.02,
    mechanism:
      'precision rises and recall does not fall by more than a golden is worth, because the removals carry fewer true positives than the pool does',
    mechanismRule: 'recall-holds',
    activity: { counter: 'falsifier.dropped', atLeast: 190 },
    deletionOnly: true,
    deletionCounter: 'falsifier.dropped',
    /**
     * **No confirmation slice, and the reason is arithmetic rather than caution.** The registration is written against
     * the 146 rows R-36b read, so a confirmation would have to be the hundred that follow - and the corpus is 196 rows
     * past the discovery set, which is fewer than the 340 removals this contract needs to price a 0.02 bar. **A
     * confirmation slice that cannot reach the bar is the §76 defect one level up**, so the first reading is a
     * discovery on the same rows and the confirmation is written when a corpus exists that can price it.
     */
    confirmation: [],
  },
  /**
   * **R-39: the diff decides what a finding may stand on, before a reader is paid to look.**
   *
   * §79 read `difftastic`'s cost model and `aoci-code`'s index and found one thing both do that this repository does not:
   * **they narrow, and we widen.** Two answers to "the reviewer looked in the right place and said the wrong thing" had
   * already been widenings - `code-context.ts`'s block window, then §78's 6 000 characters of surrounding lines - and the
   * second one returned −0.0022. This device is the first that removes instead of adds: a hunk whose every changed line is
   * accounted for by whitespace, comment text or relocation **is not a place a finding about this pull request can stand**,
   * and the patch says so without a call.
   *
   * **The bar is 0.015 rather than 0.02, and the arithmetic that forces it is written here so it cannot be revised later.**
   * On R-36b's control arm the file arm read TP 198 / FP 784 over 1 054 goldens, so `F1(x) = 396 / (2 036 − x)` for a
   * deletion pool of `x` false positives: **+0.0200 needs 190 removals**, and the classifier's own prediction - one
   * finding in five sitting on a non-substantive hunk, of the 922 adjudicated - is 184. **A device whose perfect outcome
   * is 0.0193 cannot be registered against a 0.02 bar**; that is §76's lesson applied before the run rather than after it.
   * 0.015 is 78 % of the reachable ceiling, and it is the number a narrowing device can be held to.
   *
   * **The floor is 110, and it is the floor below which the prediction itself is wrong.** 110 is 60 % of 184: a run that
   * drops fewer findings than that has said the corpus's hunks are substantive, not that the device failed, and the
   * reading is `unreachable` rather than falsified - the third verdict §76 added for exactly this.
   *
   * **The mechanism is `recall-holds`, and the guard that matters is not in this file.** §79.5 registers the rule the
   * artifact cannot check: **if more than four of the dropped findings are true positives, this is a recall device and has
   * to be re-registered as one.** The artifact carries `falsifier.droppedBecauseUntouched` and the shape counters, so the
   * share is readable; the four is a judgement this table does not pretend to make.
   */
  /**
   * **R-40: the third contract's rule, against an index instead of a window.**
   *
   * §78 answered "the reader saw too little" with 6 000 characters of surrounding lines and measured −0.0022: **the
   * reader was not short of lines, it was short of knowing what the lines belong to.** `v4` keeps the evidence rule
   * exactly - a quote must lie outside the claim's own range or it is the claim agreeing with itself - and replaces the
   * block with the file's export surface, the declaration each claim stands in, and the guards inside it.
   *
   * **Two claims, and only one of them can be read from a paired F1.** The first is that the rule still works when the
   * second block is 600 characters rather than 6 000, and that is what `registeredGain` states at the same 0.02 bar
   * `v3` was given: **a contract that needs a tenth of the prompt and reaches the same pool is the same device at a
   * tenth of the price**, and anything less would make the cheaper block a different experiment. The second claim - that
   * the prompt falls by an order of magnitude - is carried by the artifact's own character counts and is not a threshold
   * this table can express.
   *
   * **The floor is 190 for the reason `v3`'s is**: it is the count at which a perfect deletion pool reaches +0.0200
   * against R-36b's control arm (198 true positives, 784 false positives over 1 054 goldens), and it is derived from
   * those numbers rather than copied from §76's - **a floor borrowed from another section's arithmetic is a floor for
   * another corpus.**
   */
  'falsifier:independent-evidence-v4': {
    section: '§80 (R-40)',
    claim:
      'a gate whose second block is the file’s export surface, the declaration each claim stands in and the guards inside it, rather than 6 000 characters of surrounding lines, reaches the file arm F1 of at least +0.02 on the pull requests R-36b read without lowering recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.02,
    mechanism:
      'precision rises and recall does not fall by more than a golden is worth, because the reader is shown the contract the claim has to keep rather than the lines around it',
    mechanismRule: 'recall-holds',
    activity: { counter: 'falsifier.dropped', atLeast: 190 },
    deletionOnly: true,
    deletionCounter: 'falsifier.dropped',
    /** The same debt as `v3`'s, for the same reason: the rows past R-36b's discovery set cannot price a second reading. */
    confirmation: [],
  },
  changeShape: {
    section: '§79 (R-39)',
    claim:
      'a gate told which new-side lines the change actually wrote, and allowed to refute a finding standing on none of them, raises the file arm F1 by at least 0.015 on the pull requests R-36b read without lowering recall by more than a golden is worth',
    arm: 'file',
    registeredGain: 0.015,
    /**
     * **Registered below the corpus bar, and the reason is the arithmetic above rather than caution.**
     *
     * The bar this device can reach is 0.0193 and the corpus resolution is 0.0191, so the interval in which a met
     * magnitude would also be outside noise is `(0.0191, 0.0193]` - a gap two ten-thousandths wide, which is not a bar
     * but a coincidence. **A device whose entire headroom is smaller than the instrument cannot be adjudicated by the
     * instrument**, and stating that is the only reading of this entry that survives its own numbers.
     *
     * What is adjudicated instead is the thing §79.5 registers: **how many findings the shape removed and how many of
     * them were true positives.** `falsifier.droppedBecauseUntouched` is carried by the artifact and the shape counters
     * say whether the classifier fired at all, so a run answers the question this device was built for even where F1
     * cannot. **The flag is not a licence to read a met outcome as confirmed** - `registrationResolvable` refuses it -
     * and the next device that can carry this one's gain is the one that will price it.
     */
    registeredBelowResolution: true,
    mechanism:
      'precision rises and recall does not fall by more than a golden is worth, because a finding on a line the change did not write is rarely a finding about the change',
    mechanismRule: 'recall-holds',
    activity: { counter: 'falsifier.droppedBecauseUntouched', atLeast: 110 },
    deletionOnly: true,
    deletionCounter: 'falsifier.droppedBecauseUntouched',
    /**
     * **No confirmation slice, for the reason the third contract has none.** The registration is written against the
     * rows R-36b read, and the corpus holds no rows past them that could price a second reading - so this is a discovery
     * and the confirmation is written when a corpus exists that can carry one.
     */
    confirmation: [],
  },
  /**
   * **R-39's first reading, and why it is not a verdict on R-39.**
   *
   * Run `44249092363`, `pair: change-shape`, 30 pull requests. The device side read precision 0.2965 / recall 0.1932 /
   * F1 0.2339 against 0.2857 / 0.2045 / 0.2384 - **F1 −0.0045, with three true positives among the 48 removals.**
   *
   * The number that matters is the ratio: break-even for a removal pool at these counts is **7.4 false positives per
   * true positive**, and the device removed 14 for every 3 - a lift of 0.4 against a requirement of 1.0. **A removal
   * device that removes at a better than average rate but not five times better loses F1 while improving precision**,
   * and that is exactly what the two arms show.
   *
   * **And the pool was contaminated by a defect in this repository, not in the device.** `novelLines` was the set of
   * *added* lines, so a hunk that only deleted contributed none of them: `DrawProjGroupItem.h 35-45`, `Public enum
   * ProjItemType removed from header`, was refuted by a patch that had in fact removed it. Three of the 48 removals are
   * that shape, and they are true positives by construction. **The reading is therefore about a standing set built from
   * the wrong side of the diff**, and the corrected set - the hunk's span plus its deletion points - is what the next
   * dispatch prices.
   *
   * **The registration is unchanged**, because the claim was never about added lines: it is about lines the change
   * touched, and a deletion touches the line its replacement occupies. A registration edited to match a defect would be
   * the one thing this table exists to prevent.
   *
   * **Second reading (`44262493734`), corrected standing set, and the device is inert.** 10 removals instead of 48 - 2 in
   * files with no substantive hunk and 8 off the change, against 430 candidates - with one true positive among them, and
   * F1 −0.0070 against a paired 20/21 at p = 1. **Eighty per cent of the first reading's volume was the classifier
   * refuting deletions it had written off as additions that were not new.** §83 records it.
   *
   * **So this entry is kept as a falsification rather than deleted**, and `AACR_CHANGE_SHAPE` stays `off` on every arm but
   * this one. What survives is the classifier, not the filter: **a finding rarely stands off the change**, and the filter
   * that acts on the rare case removes ten findings and costs a pair.
   */
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
 * **How much slower than the measured arm a day is allowed to be before a confirmation stops being a confirmation.**
 *
 * A slice that fills the ceiling is a slice whose artifact does not exist the first time the runner is slow, and a job
 * that dies at minute 340 has spent the money and produced no verdict - **so the margin is not caution, it is the
 * difference between a confirmation and a dispatch whose outcome is a timeout.** The width of an ordinary slow day is
 * therefore measured rather than assumed: run `43902714209` dispatched the same 46 pull requests twice and its arms took
 * 56.8 and 64.5 minutes, **1.135×**, and `MEASURED_MINUTES_PER_PULL_REQUEST` is already the slower arm (79.7 of the 61.0
 * and 79.7 the fifty-pull-request run reported). A confirmation that survives 1.15× the constant therefore survives a
 * runner as much slower than its own run's slower arm as one arm was than the other.
 *
 * **This replaced `CONFIRMATION_CEILING_FRACTION = 0.5`, and the replacement is what lets R-35 be registered at all.**
 * Half of 340 minutes is 106 rows, a fraction chosen when the rate was believed to be 3.29 minutes per pull request and
 * a hundred rows really did cost 329 of 340. At 1.594 the same fraction refuses every slice that carries a bar only 146
 * rows can sign - R-35's 0.026 is one - while still admitting the hundred it was written around, **so it was measuring
 * the era rather than the property**. The property is asked directly now: does the job finish on a 15 % slow day? The
 * largest confirmation that does is 185 rows, which is inside the 196-row corpus - **so the guard still refuses the
 * whole corpus in one dispatch, which is the one thing it has to refuse.**
 */
export const CONFIRMATION_OVERRUN_TOLERANCE = 1.15;

/**
 * **The largest confirmation a job ceiling can finish on a 15 % slow day**, which is the number a registration is
 * checked against rather than a share of the ceiling.
 *
 * 185 rows of 340 minutes: the edge is called out because the two registrations that need a large slice sit just inside
 * it - `laneSet`'s 146 spends 232.7 minutes, 267.6 with the tolerance - and a reader is entitled to know how much room
 * that leaves rather than being told the slice "fits".
 */
export function slicesAConfirmationCanFit(minutes) {
  const budget = Number(minutes);
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  return Math.floor(budget / (MEASURED_MINUTES_PER_PULL_REQUEST * CONFIRMATION_OVERRUN_TOLERANCE));
}

/**
 * **Two runs of one configuration, as the measurement the instrument's error bar never had.**
 *
 * The run of 2026-11-16 dispatched the same job twice with every switch off - lanes only, the same slice, the same judge,
 * the same corpus - and read **the same 98 pull requests** (two `.diff` requests returned `500` in the first one and
 * §60.4 is the repair) **with the same goldens per pull request, 0 of 98 differing**. It returned:
 *
 * | | first | second |
 * | --- | ---: | ---: |
 * | true positives | 143 | 139 |
 * | comments | 656 | 638 |
 * | F1 | 0.2072 | 0.2055 |
 *
 * **So the reviewer's own sampling moves F1 by 0.0017 at 715 goldens, and `resolutionFor` said 0.0195 there.** The old
 * anchor was `0.04 at 170 goldens`, taken from three runs over *five* pull requests - five pull requests where one true
 * positive is four percent of the figure, and where the record does not say the code was the same in all three. **That
 * measures a runner's bad minute; this measures the reviewer.**
 *
 * **What the over-estimate cost is a verdict nobody could reach.** A registration is confirmed only when its gain exceeds
 * the resolution, so at this corpus **every bar under 0.0195 was unfalsifiable by construction** - and R-32's 0.01 was
 * dispatched against exactly that. A bar below the error bar is not a strict bar; it is a bar that cannot be cleared.
 */
export const REPRODUCTION = Object.freeze({
  /** The corpus both runs read. */
  goldens: 715,
  pullRequests: 98,
  truePositives: Object.freeze([143, 139]),
  comments: Object.freeze([656, 638]),
  /** **The difference, not a standard error**: two runs estimate a spread and do not measure one. */
  f1Delta: 0.0017,
  /** How many pull requests' goldens differed between the runs - **zero**, so the corpus is what held still. */
  pullRequestsWithDifferentGoldens: 0,
  /** And how many moved by between one and three covered goldens, which is the reviewer and nothing else. */
  pullRequestsWithDifferentCoverage: 47,
  measuredOn: '2026-11-16',
});

/**
 * **The corpus' own error bar, which is what a registration is about.**
 *
 * `REPRODUCTION` holds the reviewer still and measures the reviewer: two dispatches, one configuration, one corpus,
 * 0.0017. **A registration is not a claim about the reviewer; it is a claim about a corpus** - "this device raises F1 on
 * review data" - and nothing in a two-run repeat prices the corpus, because the corpus was the thing held fixed.
 *
 * The corpus can be priced from one artifact, since every artifact carries its figure per pull request. Resampling the
 * 98 rows of R-31 with replacement 4000 times and recomputing F1 from the resampled counts gives a spread of **0.0191**
 * for one arm and a paired difference of `[-0.052, +0.022]` with `P(delta > 0) = 0.19` - eleven times the repeat, and
 * the same verdict McNemar's 63:82 / p = 0.135 reaches from the golden-level pairs. `scripts/lib/corpus-resolution.mjs`
 * computes it; the constant below is the reading on R-31's 98 rows so that a registration can be checked without an
 * artifact in hand.
 *
 * **What this corrects, and it is a correction of this document's own last correction.** §60 replaced a `0.04 at 170
 * goldens` anchor - extrapolated from three runs over five pull requests - with the 0.0017 repeat, on the grounds that
 * the repeat was measured where the old anchor was guessed. The repeat is measured, and it answers a narrower question
 * than the one that was asked. The old anchor's **number** was almost right (it resolves 0.0195 at 715 goldens, within
 * three percent of the 0.0191 computed here) and its **derivation** was wrong; the replacement's derivation was right
 * and its number was ten times too small. A number that is right for the wrong reason and a number that is wrong for
 * the right reason are both wrong, and the cost of preferring the second was a bar under which every registration is
 * confirmable.
 */
export const CORPUS_SAMPLING = Object.freeze({
  pullRequests: 98,
  goldens: 715,
  /** Standard deviation of the paired F1 difference over 4000 resamples of the 98 rows, seed 20260816. */
  deltaSd: 0.0191,
  /** The same bootstrap on one arm alone, which is not what a registration is tested against. */
  armSd: 0.0162,
  resamples: 4000,
  seed: 20_260_816,
  /** §60's measurement, kept beside it: the reviewer twice on one corpus. Different question, eleven times smaller. */
  samplingBar: 0.0017,
  measuredOn: '2026-11-16',
  from: 'run 43839753881, the 98 pull requests both arms read',
});

/**
 * **The smallest bar a registration may set, at the corpus registrations are confirmed on.**
 *
 * A bar under the instrument's resolution is a registration that says "confirm me if the number moves by less than a
 * second corpus of this size would move it", and the comparison job answers `inconclusive` however well the device
 * does. **It is the corpus bar, not the repeat bar**, because 0.0017 would make every registration on file confirmable
 * - and a resolution that is too coarse withholds a verdict while one that is too fine publishes noise as a device.
 */
export const MINIMUM_REGISTERED_GAIN = 0.0191;

/**
 * **What a two-armed comparison on this instrument cannot resolve, as a function of the corpus.**
 *
 * **The anchor is `CORPUS_SAMPLING`**, and the law is unchanged: a standard error falls as the square root of the
 * sample, so 715 goldens resolve 0.0191, 179 resolve 0.0381 and 2 860 resolve 0.0095. **Scaling it is a claim with a
 * formula behind it; keeping one number at every corpus size would be a claim that the instrument never improves.**
 *
 * **`REPRODUCTION` is still reachable and still labelled**, because a reader comparing against the repeat should be
 * able to reproduce it - `resolutionFor(715, { measuredAt: 715, measuredResolution: 0.0017 })` is 0.0017, and that is
 * the reviewer with the corpus held still, not a bar.
 */
/**
 * **Whether a registration can be answered at the corpus it will be judged on.**
 *
 * Returned rather than thrown, and checked before the magnitude rather than after it: a bar of 0.005 at 715 goldens is
 * not a device that failed, it is a sentence that asked for less than the instrument can see - and the two want
 * different repairs. **A failed device is dropped; an unfalsifiable registration is rewritten**, and a comparison job
 * that answered both with `inconclusive` left the second one in the table forever.
 */
export function registrationResolvable(registration, goldens) {
  const resolution = resolutionFor(goldens);
  const bar = registration?.registeredGain;
  if (typeof bar !== 'number' || !Number.isFinite(bar))
    return { resolvable: true, resolution, bar: null };
  if (bar < resolution)
    return {
      resolvable: false,
      resolution,
      bar,
      reason: `unfalsifiable: the registered gain ${String(bar)} sits under the ${String(resolution)} a second corpus of ${String(goldens)} goldens moves the figure by, so the registration asks for less than the instrument resolves`,
    };
  return { resolvable: true, resolution, bar };
}

/**
 * **The share of a device's removals that were true positives, which is a criterion rather than a description.**
 *
 * §75.3's number: the route to the field's leader needs **a removal pool at or under 4 % true positives**, and §74's
 * gate read 24.9 % - which is why its 557 removals bought −0.046 F1 while the same 557 removals, had they all been false
 * positives, would have bought +0.077. **Measured on the removals rather than on the run**, it does not move when the
 * reviewer's generation changes, so a gate that improves while the lanes improve keeps its own number.
 *
 * Three fields and not one, because the share alone cannot tell a device that removed nothing from a device that removed
 * the right things - `0 / 0` is not a perfect pool, it is no pool, and `share` is `null` for it. A negative
 * `truePositivesRemoved` means the device found goldens the baseline missed, which a removal device cannot do; it is
 * clamped, and the clamp is reported as zero removed rather than as a negative pool.
 */
export const REMOVAL_TP_SHARE_TARGET = 0.04;

export function removalPool(without, withArm) {
  const withoutFindings = Number(without?.findings);
  const withFindings = Number(withArm?.findings);
  const withoutTp = Number(without?.truePositives);
  const withTp = Number(withArm?.truePositives);
  const countable = [withoutFindings, withFindings, withoutTp, withTp].every((value) =>
    Number.isFinite(value),
  );
  // **A pool nobody measured is not a pool of zero**, so a missing count returns `null` rather than a perfect record.
  if (!countable) return null;
  const removed = Math.max(0, withoutFindings - withFindings);
  const truePositivesRemoved = Math.min(removed, Math.max(0, withoutTp - withTp));
  const share = removed === 0 ? null : round(truePositivesRemoved / removed);
  return {
    removed,
    truePositivesRemoved,
    share,
    target: REMOVAL_TP_SHARE_TARGET,
    withinTarget: share === null ? null : share <= REMOVAL_TP_SHARE_TARGET,
  };
}

/**
 * **The most a removal-only device could have gained, computed from the arm it was compared against.**
 *
 * A device that can only delete findings has an upper bound on its effect: **the figure it would have reached had every
 * claim it removed been a false positive**, keeping every true positive it had, at the emission the baseline actually
 * produced. Two charities at once - no true positive lost, and every removal reaching the reviewer rather than stopping
 * at `maxFindingsPerFile` - so the number is a ceiling and not a prediction.
 *
 * **Why a ceiling and not a target.** §73's gate removed 557 claims on this corpus and bought −0.046 F1; the ceiling at
 * 557 is +0.077, so that run could have cleared its 0.026 bar and did not, which is a falsification. **The same gate
 * removing eighty claims has a ceiling of +0.008, under the bar, and no reading of that run can say the device failed** -
 * the pool was too small to price the question. The two runs print the same `falsified:` sentence today, and one of them
 * is a statement about the corpus wearing the device's name.
 *
 * `removed` is the device's own count and not the difference between the arms' emissions, because the difference has
 * already had the truncation and the true-positive losses applied - **the ceiling is about what the device did, and the
 * gap between that and the difference is a fact about the corpus.** Returns `null` when the arm cannot support the
 * arithmetic, so a missing measurement never reads as a bound.
 */
export function deletionCeiling(without, removed, goldens) {
  const tp = Number(without?.truePositives);
  const fp = Number(without?.falsePositives);
  const count = Number(goldens);
  if (!Number.isFinite(tp) || !Number.isFinite(fp)) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  if (typeof removed !== 'number' || !Number.isFinite(removed) || removed < 0) return null;
  const f1Of = (truePositives, falsePositives) =>
    (2 * truePositives) / (2 * truePositives + falsePositives + (count - truePositives));
  return round(f1Of(tp, Math.max(0, fp - removed)) - f1Of(tp, fp));
}

export function resolutionFor(
  goldens,
  { measuredAt = CORPUS_SAMPLING.goldens, measuredResolution = CORPUS_SAMPLING.deltaSd } = {},
) {
  const count = Number(goldens);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(
      `resolution needs a positive golden count, received ${JSON.stringify(goldens)}`,
    );
  }
  return Math.round(measuredResolution * Math.sqrt(measuredAt / count) * 10_000) / 10_000;
}

/**
 * **The resolution in the unit the corpus is actually sampled in**: pull requests, not goldens.
 *
 * Goldens inside one pull request are not independent, so a corpus grows by adding pull requests and its error bar
 * falls with the square root of *their* count. This is the function to ask "what would a 0.01 bar cost" -
 * `resolutionForPullRequests(358) = 0.0100`, so 358 rows, and §59's R-32 was registered at 0.01 against the 98 rows
 * this project buys.
 */
export function resolutionForPullRequests(
  pullRequests,
  { measuredResolution = CORPUS_SAMPLING.deltaSd } = {},
) {
  const count = Number(pullRequests);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(
      `resolution needs a positive pull-request count, received ${JSON.stringify(pullRequests)}`,
    );
  }
  return (
    Math.round(measuredResolution * Math.sqrt(CORPUS_SAMPLING.pullRequests / count) * 10_000) /
    10_000
  );
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
  // **A field whose registration exists but names other arms is not a confound, and writing it as one would be the
  // §115 defect in the other direction**: `confounds.length > 0` refuses the pair and publishes no artifact, so a
  // `pair-lean` run would stop being measurable rather than stop being mislabelled. The refusal goes in the artifact's
  // own `registration` field and in `verdict.outcome`; see `UNREAD_REGISTRATIONS` and `summarise`.
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
  const readSlices = readSlicesOf(on);
  /**
   * **The value's own name, when the field is an object.**
   *
   * `laneSet` is `{ name, lanes }` rather than a string, because a lane set is a reviewer and a reviewer is its list -
   * so `String(withValue)` is `[object Object]` and the composite key could never be written. **Two lane sets now exist
   * on this field** (§69.5's substitution, which lost, and §75's union), and a lookup that fell back to the field-wide
   * sentence would answer R-37's run with R-35's bar - **the defect §44's artifact recorded, one field over.**
   */
  const withValueName =
    varied.withValue !== null && typeof varied.withValue === 'object' && 'name' in varied.withValue
      ? String(varied.withValue.name)
      : String(varied.withValue);
  const registration =
    REGISTRATIONS[`${varied.field ?? ''}:${withValueName}`] ??
    registrationFor(varied.field ?? '', readSlices, withValueName) ??
    null;
  /**
   * **A pair this job has a sentence for but cannot read a verdict against**, which is not the same as an unregistered
   * pair and must not be published as one. §113.4's R-52 is a bill and a band; this job computes one gain against one
   * bar. **The artifact carries the pointer so that `registration: null` reads as "read §113.6" rather than as "nobody
   * wrote an expectation"** - the second sentence would be false, and it is the one `outcome` printed until now.
   */
  const readIn =
    registration === null
      ? (UNREAD_REGISTRATIONS[`${varied.field ?? ''}:${withValueName}`] ?? null)
      : null;
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

  // **Whether the bar can be cleared at all**, which is a property of the registration and the corpus rather than of the
  // device - and the one thing a comparison job cannot discover after the fact.
  const resolvable = registrationResolvable(registration, goldens).resolvable;
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
  /**
   * **Which rows the artifact read, as a set.**
   *
   * A single dispatch carries one slice; a merge of two dispatches carries both, in `corpusSlice.slices`, and is the
   * only artifact in this project that can turn two hundred-pull-request halves into one corpus with half the standard
   * deviation. **The gate asks whether every slice the registration names was read**, not whether the artifact read
   * nothing else: more data bearing on the same sentence is not a confound, and the run that reads both halves has read
   * the half the sentence was about.
   */
  const sliceMatches =
    declared.length === 0
      ? null
      : readSlices === null
        ? false
        : declared.every((want) =>
            readSlices.some((got) => got.skip === want.skip && got.max === want.max),
          );
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
  /**
   * **A gain narrower than the instrument's own error bar confirms nothing, whatever it is compared against.**
   *
   * **This used to be an outcome of its own** - `inconclusive: a gain of X inside the Y this instrument resolves` - and
   * it is a field now because the guard that refuses a registration *below* that error bar reaches the same case first
   * and says the more useful thing. The two are the same statement: a magnitude is only ever met when
   * `gain >= registeredGain`, and every registration on file has `registeredGain >= resolution`, so **a met magnitude
   * is outside the error bar by construction** and the sentence could only fire for a bar under it. **A branch that can
   * only be reached by a registration the file refuses is a branch nobody can test**, and the self-test below asserts
   * the entailment instead of a fixture that reached it.
   */
  const insideResolution = Math.abs(gain) < resolution;
  /** How the arm is named in a sentence, because "the file arm" and "the pull-request arm" are not interchangeable. */
  const armName = `the ${armProse(registeredArm)}`;

  /**
   * **The second question, which this job computed and never asked.**
   *
   * The bar asks whether the gain is at least what was registered; **the corpus asks whether the gain could have
   * arrived by resampling the pull requests**, and until §65 no branch read the answer. A run could reach
   * `magnitudeMet` with `p = 0.4` and be filed as confirmed, which is a table of noise with a threshold attached.
   *
   * The rows are resampled **one pull request at a time**, keeping each row's goldens, coverage and posted comments
   * together, because goldens inside a row are not independent - a reviewer that understood a file covers several of
   * them. A golden-level test treats 724 draws as 724 observations and is too optimistic by however much the rows
   * cluster; McNemar's `p` is reported beside this one for exactly that reason, and **when the two disagree the
   * clustered one is the one a bar has to clear.**
   */
  const pairedRows = pairedCoverageRows(on, off);
  const significance =
    pairedRows.withRows.length >= 2
      ? (() => {
          const interval = clusterBootstrapDelta(pairedRows.withRows, pairedRows.withoutRows, {
            resamples: CORPUS_SAMPLING.resamples,
            seed: CORPUS_SAMPLING.seed,
          });
          const sd = interval.sd;
          const z = sd > 0 ? round(gain / sd) : null;
          /**
           * **Whether the rows can reproduce the figure the artifact published.**
           *
           * The resampled mean has to land on the delta within one standard deviation, or the rows and the totals are
           * about two different things - an artifact whose `shippedEmitted` was absent, a corpus the run read and did
           * not record, a total written beside rows instead of summed from them. **A bootstrap that disagrees with the
           * number it is qualifying is not an error bar, it is a second opinion**, and signing on it would be signing
           * on whichever of the two happened to be in the fixture.
           */
          const inconsistent = Math.abs(interval.mean - gain) > Math.max(sd, 1e-9);
          return {
            unit: 'pull request',
            view: 'the paired difference in file-arm F1, resampled over the pull requests both arms read',
            resamples: interval.resamples,
            pullRequests: interval.pullRequests,
            mean: interval.mean,
            sd,
            lower: interval.lower,
            upper: interval.upper,
            positiveRate: interval.positiveRate,
            z,
            pValue: z === null ? null : round(twoSidedP(z)),
            inconsistent,
            ...(interval.estimated ? { estimated: true } : {}),
            rowsWithDevice: pairedRows.onRows,
            rowsWithoutDevice: pairedRows.offRows,
          };
        })()
      : null;
  /**
   * **Signed means three things at once**: the rows reproduce the published figure, the resampled difference is not
   * noise, and - when the corpus is so uniform that every draw returns the same difference - there is no noise for it
   * to be. `sd = 0` is a degenerate corpus rather than a strong result, but a distribution of width zero does not
   * change sign under resampling, so it is signed on the point estimate and the artifact says `sd: 0` for a reader to
   * weigh.
   */
  const signed =
    significance === null
      ? null
      : significance.inconsistent
        ? false
        : significance.sd === 0
          ? gain !== 0
          : significance.pValue !== null && significance.pValue <= 0.05;

  /**
   * **Whether the device did enough to be a test of its contract, when the registration names a floor.**
   *
   * §74.4's rule, made checkable: the second contract may only remove claims whose refutation lives elsewhere in the same
   * hunk, so **a run that removes fourteen claims and moves F1 by −0.001 has demonstrated that this corpus's claims have
   * no independent evidence to find** - a fact about the corpus, which must not be readable as either a confirmation or a
   * falsification of the device. `observed: null` is `met: false` rather than a pass: **a requirement satisfied by the
   * absence of its measurement is not a requirement.**
   */
  const activity = registration?.activity
    ? (() => {
        const [device, counter] = registration.activity.counter.split('.');
        const raw = on?.engineCounters?.[device]?.[counter];
        const observed = typeof raw === 'number' ? raw : null;
        return {
          counter: registration.activity.counter,
          atLeast: registration.activity.atLeast,
          observed,
          met: observed !== null && observed >= registration.activity.atLeast,
        };
      })()
    : null;

  /**
   * **Whether the bar was inside the device's reach before asking whether the device reached it.**
   *
   * §76's arithmetic, read off the arm the device was compared against. **`null` when the registration names no deletion
   * counter, when the arm carries no such counter, or when the arithmetic cannot be supported** - a bound invented from a
   * missing measurement is the failure `activity: { observed: null }` was written to avoid, so the field is absent rather
   * than generous.
   */
  const reach =
    registration?.deletionOnly === true
      ? (() => {
          const [device, counter] = String(registration.deletionCounter ?? '').split('.');
          const raw = on?.engineCounters?.[device]?.[counter];
          const removed = typeof raw === 'number' ? raw : null;
          if (removed === null) return null;
          const ceilingGain = deletionCeiling(offArm, removed, goldens);
          if (ceilingGain === null) return null;
          return {
            counter: registration.deletionCounter,
            removed,
            ceilingGain,
            reachable: registeredGain === null ? null : ceilingGain >= registeredGain,
          };
        })()
      : null;

  const outcome =
    magnitudeMet === null
      ? (readIn ?? 'unregistered: no expectation was written before this run')
      : sliceMatches === false
        ? `not a confirmation: the registration names ${declared.map((s) => `skip ${String(s.skip)} max ${String(s.max)}`).join(' and ')}, and this run read ${readSlices === null ? 'a corpus the artifact does not describe' : readSlices.map((s) => `skip ${String(s.skip)} max ${String(s.max)}`).join(' and ')}`
        : inputsFormed === false
          ? `not a test: the device was registered to merge two reviewers and ran with ${String(on?.merge?.sides?.lanes ?? 0)} lane candidates and ${String(on?.merge?.sides?.reader ?? 0)} reader candidates over ${String(on?.prsReviewed ?? 0)} pull requests, so the union never formed`
          : !resolvable
            ? registrationResolvable(registration, goldens).reason
            : activity !== null && !activity.met
              ? `not a test: the registration needs ${String(activity.atLeast)} ${String(activity.counter)} before a difference is about the contract, and the arm reported ${activity.observed === null ? 'no such counter' : String(activity.observed)}`
              : reach !== null && reach.reachable === false
                ? `unreachable: the device removed ${String(reach.removed)} claims, and had every one of them been a false positive that reached the reviewer this figure moves by ${String(reach.ceilingGain)} at most, under the ${String(registeredGain)} registered - the pool this corpus gave it could not price that bar, so the shortfall is not the device's`
                : !magnitudeMet
                  ? `falsified: the registered gain was not reached on ${armName}${guardMet === false ? `, and the ${armProse(String(guardArm))} fell by ${String(-guardGain)}` : ''}`
                  : mechanismMet === false
                    ? 'falsified: the magnitude arrived, the mechanism did not'
                    : guardMet === false
                      ? `falsified: ${armName} gained ${String(gain)} and the ${armProse(String(guardArm))} it must not lower fell by ${String(-guardGain)}`
                      : signed === false
                        ? significance?.inconsistent
                          ? `met but not signed: ${String(gain)} F1 on ${armName} clears the ${String(registeredGain)} registered, and the ${String(significance?.pullRequests)} pull-request rows resample to ${String(significance?.mean)}, which is ${String(significance?.sd)} wide against a published delta of ${String(gain)} - the rows and the totals are about two different corpora, so there is nothing to sign`
                          : `met but not signed: ${String(gain)} F1 on ${armName} clears the ${String(registeredGain)} registered, and over ${String(significance?.pullRequests)} pull requests the paired difference is ${String(significance?.sd)} wide, so the gain is ${String(significance?.z)} standard deviations (p = ${String(significance?.pValue)})`
                        : signed === null
                          ? `met but unverifiable: ${String(gain)} F1 on ${armName} clears the ${String(registeredGain)} registered, and the artifacts carry ${String(pairedRows.withRows.length)} paired pull-request rows, which is too few to resample a corpus from`
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
     * **Where the reading is, when this job has no verdict to write.** `null` for a pair it can judge - and for a pair
     * nobody registered, which needs no pointer. **A field carrying two devices needs this field**: `registration: null`
     * plus a section number is a sentence a reader can act on; `registration: null` alone is a sentence that invites the
     * question this file exists to answer.
     */
    registrationReadIn: readIn,
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
     * **Whether the registered bar is above the instrument's own error bar**, because a registration under it can only
     * ever read `inconclusive` - and a table of devices that "could not be shown to work" is a table of bars, not of
     * devices. `REPRODUCTION` is the measurement this is computed from.
     */
    resolvable,
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
    /**
     * **The pool this device was judged on, beside the figure it produced** - §75.3's criterion, measured on the
     * removals rather than on the run, so that a gate's number does not move when the reviewer's generation does.
     */
    removalPool: removalPool(offArm, onArm),
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
    /** The resampled interval the verdict was signed on, or `null` when the artifacts carried too few rows. */
    significance,
    verdict: {
      registeredGain,
      /** The arm the threshold above is attached to, as a field rather than as a convention. */
      registeredArm,
      observedGain: gain,
      magnitudeMet,
      mechanismMet,
      /** Whether this run read the rows the registration names, or `null` when it names none. */
      sliceMatches,
      /** The device's own activity against the floor its registration names, or `null` when it names none. */
      activity,
      /**
       * **The most this device could have gained, and whether that was inside the bar** - §76's reach arithmetic, or
       * `null` for a device that is not removal-only and for a run whose artifacts cannot support the bound.
       */
      reach,
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
      /**
       * **Whether a bar of this size could be signed at all on this corpus, asked before the run is bought.**
       *
       * `resolvable` says the bar is outside one standard deviation; **signing needs 1.96 of them**, so a 0.02 bar on a
       * corpus that resolves 0.0191 clears the first gate and cannot clear the second. That is not a reason to refuse
       * the run - the point estimate is still worth having - it is a reason to expect `met but not signed` and to spend
       * the next dispatch on the corpus rather than on the device.
       */
      confirmable: {
        bar: registeredGain,
        // **The width of this run's own difference when it could be measured**, and the corpus constant when it could
        // not: R-32's rows resample to 0.0150 where the R-31 constant predicts 0.0190, so a bar judged against the
        // constant is judged against a corpus that is not this one. **A width of zero falls back to the constant**, because
        // a degenerate corpus would otherwise make every bar signable.
        needs: round(
          1.96 * (significance !== null && significance.sd > 0 ? significance.sd : resolution),
        ),
        confirmed:
          registeredGain === null
            ? null
            : registeredGain >=
              1.96 * (significance !== null && significance.sd > 0 ? significance.sd : resolution),
      },
      /** Whether the paired difference over the corpus is outside the noise: the gate below `confirmed`. */
      signed,
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
  //
  // **And the refusal says what is still readable.** A pair whose arms lost different pull requests has no comparable
  // totals and does have comparable pairs, so the line below prints the paired reading on the rows both arms read -
  // because a job that says only "not the same experiment" gets dispatched again unchanged, at the same price, by
  // whoever needs the answer, which is how a measurement defect becomes a budget defect.
  const paired = detail?.pairedOnCommonPullRequests;
  if (paired) console.log(pairedReading(paired));
  process.exitCode = 1;
  return artifact;
}

/**
 * **The reading a corpus gap does not touch: one pair per golden, on the rows both arms read.**
 *
 * A total over 98 rows cannot be subtracted from a total over 100 - that is the whole reason this file refuses - but a
 * `(pull request, golden)` pair is either covered by an arm or not, and on the rows both arms read the two arms saw the
 * same code, the same goldens and the same judge. **Dropping the rows one arm never reached is what makes the remaining
 * pairs comparable, and naming them is what makes the drop auditable.**
 *
 * The count is of pairs and not of pull requests, so two goldens on one row are two pairs; `commonPullRequests` is
 * reported beside it because a paired test over one shared row and a paired test over ninety-eight are not the same
 * evidence, and only the number of rows distinguishes them.
 */
export function pairedOnCommonPullRequests(on, off) {
  const rowsOf = (artifact) =>
    new Set(
      (artifact.coverage?.byPullRequest ?? []).map((pull) => String(pull.pr)).filter(Boolean),
    );
  const onRows = rowsOf(on);
  const offRows = rowsOf(off);
  const common = new Set([...onRows].filter((pr) => offRows.has(pr)));
  const pairsOf = (artifact) => {
    const pairs = new Set();
    for (const pull of artifact.coverage?.byPullRequest ?? []) {
      const pr = String(pull.pr);
      if (!common.has(pr)) continue;
      for (const at of pull.covered ?? []) pairs.add(`${pr}#${String(at)}`);
    }
    return pairs;
  };
  const paired = pairedComparison(pairsOf(on), pairsOf(off));
  return {
    commonPullRequests: common.size,
    both: paired.both,
    withOnly: paired.oursOnly,
    withoutOnly: paired.theirsOnly,
    pValue: paired.pValue,
    verdict: paired.verdict,
    dropped: {
      with: [...onRows].filter((pr) => !common.has(pr)).slice(0, 10),
      without: [...offRows].filter((pr) => !common.has(pr)).slice(0, 10),
    },
    counts:
      'golden pairs on the rows both arms read; no total is compared and no F1 difference is implied',
  };
}

/** The line, so the job's log and the artifact say the same thing about the same pairs. */
export function pairedReading(paired) {
  const rows = paired.commonPullRequests === 1 ? 'pull request' : 'pull requests';
  return `AACR-ABLATION paired on the ${paired.commonPullRequests} ${rows} both arms read · +${paired.withOnly}/-${paired.withoutOnly} · p=${paired.pValue} · dropped ${paired.dropped.with.length} with, ${paired.dropped.without.length} without`;
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
      // **Both second-reader keys, because a fixture that carried only one of them could not exercise the registration
      // that reads the other.** They are `false` on every fixture that does not ask for them, so no existing assertion
      // sees them vary.
      adjudicate: overrides.adjudicate ?? false,
      falsifier: overrides.falsifier ?? false,
      // **The lane set is an object in the artifact**, `{ name, lanes }`, so a fixture that only ever wrote a string
      // could not exercise the composite registration key that distinguishes §69.5's substitution from §75's union.
      ...(overrides.laneSet ? { laneSet: { name: overrides.laneSet, lanes: [] } } : {}),
    },
    /**
     * **What the second reader did, when a fixture asks for it.**
     *
     * §74.4's rule is not only about a gain: *a gain under 40 removals is a statement about the corpus's claims, not about
     * the device*. That sentence is a gate or it is a remark, so the counter it reads has to be in the fixture and in the
     * verdict.
     */
    ...(typeof overrides.falsifierDropped === 'number'
      ? {
          engineCounters: {
            falsifier: {
              enabled: true,
              dropped: overrides.falsifierDropped,
              candidates: overrides.falsifierCandidates ?? overrides.falsifierDropped * 3,
            },
          },
        }
      : {}),
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
        // **The comments actually posted on this row**, without which the rows cannot be resampled and the fixture is a
        // pair of totals pretending to be a corpus. The false positives are spread evenly, which is what makes the rows
        // reproduce the published figure.
        shippedEmitted: covered.length + Math.round(overrides.fp / overrides.covered.length),
      })),
    },
  });

  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test failed: ${message}`);
  };

  // **A thousand goldens, and the counts scaled to keep every figure the same.** These fixtures used to declare ten, and
  // ten goldens resolve 0.1615 - so `registrationResolvable` refused R-17's 0.02 bar before the magnitude was read and
  // the assertions below were answered by `unfalsifiable`. That went unnoticed while the resolution was 0.0017; a fixture
  // corpus has to be able to resolve the registration it is exercising, and "six of ten" and "six hundred of a thousand"
  // are the same F1 of 0.4.
  // **The covered indices have to add up to the true positives**, because the corpus bar resamples these rows and a
  // fixture whose rows say 6 while its total says 600 is two corpora in one artifact - the gate below refuses to sign
  // it, which is how this was found.
  const range = (from, count) => Array.from({ length: count }, (_, at) => from + at);
  const qualifies = artifact({
    profile: 'defect',
    tp: 600,
    fp: 1400,
    fn: 400,
    covered: [range(0, 300), range(300, 300)],
    goldensPerPr: [500, 500],
  });
  const baseline = artifact({
    profile: 'advisory',
    tp: 300,
    fp: 1700,
    fn: 700,
    covered: [range(0, 150), range(150, 150)],
    goldensPerPr: [500, 500],
  });

  const good = summarise(qualifies, baseline);
  assert(good.variedField === 'emissionProfile', 'the varied field is read from the artifacts');
  assert(
    good.registration?.section === '§19 (R-17)',
    'and the registration is looked up by that field',
  );
  assert(good.verdict.magnitudeMet === true, 'the magnitude branch, against the 0.02 R-17 claim');
  assert(good.verdict.mechanismMet === true, 'precision rose and recall rose');
  assert(
    good.pairedTest.withOnly === 450,
    'four hundred and fifty goldens the device found and the baseline did not',
  );
  assert(
    good.pairedTest.withoutOnly === 150,
    'and a hundred and fifty the other way, because the fixture baseline reads rows the device reads too',
  );
  // **These three assertions used to read 3:0 and `p = 0.25`**, on a fixture of ten goldens where the honest note was
  // that a device worth 0.2 F1 was not significant. The fixture is a corpus now, because the signature gate resamples it
  // and two rows cannot be resampled into anything; at this size the same device is significant, and the note the old
  // assertions made is carried by the tests that build a corpus whose gain is concentrated or whose rows disagree with
  // its totals.
  assert(
    good.pairedTest.pValue < 0.05,
    `three hundred discordant pairs one way is p = ${String(good.pairedTest.pValue)}`,
  );
  assert(good.pairedTest.verdict === 'significant at 0.05', 'and the paired test says so');
  // **Signed, and still not a bar that could have been signed had the gain been small**: 0.02 needs 1.96 standard
  // deviations of a corpus this size, which is 0.0318, so a device that cleared its bar by a hair would be `met but not
  // signed`. Both facts sit in one verdict on purpose.
  assert(good.verdict.signed === true, 'the corpus signs a gain of 0.2');
  assert(
    good.verdict.confirmable.confirmed === false,
    'and the 0.02 bar is still below what this corpus can sign, so a hair-breadth result would not be confirmed',
  );
  // **The resolved step at ten goldens is eight times wider than at 715**, because the formula scales the measured
  // repeat up as the corpus shrinks - and 0.2 is far outside it either way. **The assertion used to read `> 0.04`**,
  // which was true of an anchor taken from three runs over five pull requests; the repeat of 2026-11-16 replaced it,
  // and a self-test that kept the old threshold would have gone on passing while asserting nothing about the new one.
  assert(
    good.resolution === resolutionFor(1000),
    `a thousand goldens resolve ${String(resolutionFor(1000))}, the formula and the artifact agree`,
  );
  assert(
    good.resolution < CORPUS_SAMPLING.deltaSd,
    'and a thousand goldens resolve more finely than the 715 the corpus bar was measured at, which is the direction the law predicts',
  );
  // **The two bars, side by side, and the assertion that they are different questions.** The repeat says the reviewer
  // moves 0.0017 by itself; the corpus says a second 98 rows move the difference by 0.0191. If these ever converge the
  // distinction has stopped meaning anything, so the relation is asserted rather than described.
  assert(
    CORPUS_SAMPLING.deltaSd > 5 * CORPUS_SAMPLING.samplingBar,
    `the corpus bar ${String(CORPUS_SAMPLING.deltaSd)} is not the repeat bar ${String(CORPUS_SAMPLING.samplingBar)}`,
  );
  // **And the paired difference is not much tighter than one arm**, which is a fact about this instrument worth
  // keeping in front of a reader who assumes a paired design buys free precision: 0.0191 against 0.0162, because the
  // reviewer's errors on the two arms are nearly independent.
  assert(
    CORPUS_SAMPLING.armSd < CORPUS_SAMPLING.deltaSd,
    'one arm is tighter than the paired difference, so pairing did not buy the variance reduction it is credited with',
  );
  assert(MINIMUM_REGISTERED_GAIN === CORPUS_SAMPLING.deltaSd, 'the floor is the corpus bar');
  assert(
    resolutionFor(715) === CORPUS_SAMPLING.deltaSd,
    'and the formula lands on it at 715 goldens',
  );
  assert(
    resolutionForPullRequests(98) === CORPUS_SAMPLING.deltaSd,
    'and in the unit the corpus is sampled in: 98 pull requests',
  );
  // **And a bar under the error bar is refused before the magnitude is read**, which is the branch R-32 would have taken
  // had the anchor not been replaced. The answering bar is 0.2 rather than 0.02 because ten goldens resolve 0.16.
  const resolvableGuard = registrationResolvable({ registeredGain: 0.0001, section: 'R-x' }, 10);
  assert(resolvableGuard.resolvable === false, 'a bar under the resolution is unfalsifiable');
  assert(
    registrationResolvable({ registeredGain: 0.2, section: 'R-x' }, 10).resolvable === true,
    'and a bar above it is answerable',
  );

  // **And §73's gate, which is the registration that has to be reachable from an artifact rather than from a dispatch.**
  // The fixture is the arithmetic the registration names: 335 true positives against 300 on the same thousand goldens is
  // F1 0.2291 against 0.2000 - **+0.0291, over the 0.026 bar** - and recall rises, so `recall-holds` holds.
  const gated = summarise(
    artifact({
      profile: 'advisory',
      tp: 335,
      fp: 1590,
      fn: 665,
      covered: [range(0, 168), range(168, 167)],
      goldensPerPr: [500, 500],
      falsifier: true,
    }),
    baseline,
  );
  assert(
    gated.variedField === 'falsifier',
    `the gate is its own configuration key, received ${String(gated.variedField)}`,
  );
  assert(
    gated.registration?.section === '§73 (R-36)',
    `and the sentence it is filed under is found by that key, received ${String(gated.registration?.section)}`,
  );
  assert(
    gated.verdict.magnitudeMet === true,
    'a gain of 0.0291 clears the 0.026 the registration asked for',
  );
  assert(gated.verdict.mechanismMet === true, 'and recall rose, so the mechanism holds');
  // **The failure the mechanism rule exists for**: a gate that buys precision by deleting true positives. Precision rises,
  // recall falls by ten goldens, and the registration says that is a falsification rather than a confirmation.
  const collapsed = summarise(
    artifact({
      profile: 'advisory',
      tp: 290,
      fp: 1200,
      fn: 710,
      covered: [range(0, 145), range(145, 145)],
      goldensPerPr: [500, 500],
      falsifier: true,
    }),
    baseline,
  );
  assert(
    collapsed.verdict.magnitudeMet === true,
    'F1 0.2329 clears the bar on precision alone, which is exactly why the mechanism is registered beside it',
  );
  // **And §74's second contract, which reuses the key and moves only its value.** `falsifier` is a boolean no longer: it
  // carries the contract's name, so the pair `off` vs `independent-evidence-v2` still varies exactly one field - and the
  // registration that answers it is filed under `falsifier:independent-evidence-v2`, reached by the composite lookup
  // rather than by the field alone. **A contract that reused the field without a value-keyed sentence would report the
  // first contract's verdict about the second contract's run**, which is §44's defect with the sign reversed.
  const independent = summarise(
    artifact({
      profile: 'advisory',
      tp: 310,
      fp: 1480,
      fn: 690,
      covered: [range(0, 155), range(155, 155)],
      goldensPerPr: [500, 500],
      falsifier: 'independent-evidence-v2',
      falsifierDropped: 300,
      // **The slice the registration names**, because the slice gate is read before the floor: a fixture on the wrong
      // rows is not a test of this contract at all, and the two gates would otherwise be indistinguishable in the reason.
      slice: { skip: 50, requested: 146 },
    }),
    baseline,
  );
  assert(
    independent.variedField === 'falsifier',
    `the second contract is the same configuration key with a different value, received ${String(independent.variedField)}`,
  );
  assert(
    independent.registration?.section === '§74 (R-36b)',
    `and the value decides which sentence answers it, received ${String(independent.registration?.section)}`,
  );
  assert(
    independent.verdict.magnitudeMet === true,
    'a gain of 0.0222 clears the 0.02 the second contract asked for, which is a thinner bar on purpose',
  );
  assert(
    independent.verdict.mechanismMet === true,
    'and recall held, so a removal-only device that kept its recall is a confirmation',
  );
  assert(
    independent.verdict.activity?.met === true,
    'and it removed enough to be a test of the contract at all',
  );
  // **The floor's failure branch, which is the one §74.4 exists for.** The same gain, and a gate that removed fourteen
  // claims: **a run that barely runs is not a falsification of the device either** - it is a statement that these rows'
  // claims have no independent evidence to find, and the artifact has to say so rather than reporting a delta.
  const idle = summarise(
    artifact({
      profile: 'advisory',
      tp: 310,
      fp: 1480,
      fn: 690,
      covered: [range(0, 155), range(155, 155)],
      goldensPerPr: [500, 500],
      falsifier: 'independent-evidence-v2',
      falsifierDropped: 14,
      slice: { skip: 50, requested: 146 },
    }),
    baseline,
  );
  assert(idle.verdict.activity?.observed === 14, 'the floor reads the count the device reported');
  assert(
    idle.verdict.activity?.met === false,
    'fourteen removals is under the forty the registration needs',
  );
  assert(
    String(idle.verdict.outcome).startsWith('not a test'),
    `and the run is refused as a test rather than reported as a loss, received ${String(idle.verdict.outcome)}`,
  );
  assert(
    idle.verdict.confirms === false,
    'which is the only safe direction for a gate nobody has enough evidence to read',
  );
  assert(
    collapsed.verdict.mechanismMet === false,
    'and the gate is refused for paying with ten true positives',
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
    tp: 400,
    fp: 2000,
    fn: 600,
    // **A hundred and fifty goldens the baseline missed against fifty the other way**, which is the shape of a trade: more
    // found, more paid for, and the F1 barely moved.
    covered: [range(0, 200), range(200, 200)],
    goldensPerPr: [500, 500],
  });
  const traded = summarise(trade, baseline);
  assert(traded.delta.f1 > 0, 'the trade does gain something');
  assert(
    traded.pairedTest.withOnly === 150 && traded.pairedTest.withoutOnly === 50,
    `a hundred and fifty goldens one way and fifty the other, received ${String(traded.pairedTest.withOnly)} and ${String(traded.pairedTest.withoutOnly)}`,
  );

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

  // **And the smallest gain that can exist is larger than the error bar**, which is the statement that replaced
  // "a gain inside the error bar is not a confirmation".
  //
  // That fixture used to move F1 by 0.0667 against a resolution of 0.1649 at ten goldens. The resolution is measured
  // from the repeat now, so at ten goldens it is 0.0144 - **and one true positive at ten goldens is worth more than
  // that**, so the fixture no longer demonstrates the branch it was written for.
  //
  // **The branch is still reachable, and no longer the guard against noise.** One golden at 715 moves F1 by 0.0029
  // against a resolution of 0.0017, so on a fixed corpus any single credit is real; what `insideResolution` catches is a
  // device that trades one credit for several comments - a compensating move, which is a different failure and is
  // asserted below. **The guard against noise is the paired test**, and this file has asserted that separately since
  // `pValue` existed.
  const f1Of = (tp, comments, goldens) =>
    comments === 0 || goldens === 0 ? 0 : (2 * tp) / (comments + goldens);
  // **One credit at 715 goldens is worth 0.0013, and the reviewer moves 0.0017 between two identical runs** - so a
  // device worth a single golden **cannot be confirmed at this corpus**, and that is the honest reading rather than a
  // defect of the formula. It is also why the minimum registered gain is two credits rather than one: a bar the
  // instrument cannot see is a bar a device can clear by luck, and §59's R-32 was registered at 0.01 - eight credits -
  // for the opposite reason, that its mechanism is recall and its categories are coarse.
  const oneGolden = f1Of(144, 657, 715) - f1Of(143, 656, 715);
  assert(
    oneGolden < REPRODUCTION.f1Delta,
    `one credit at 715 goldens is worth ${oneGolden.toFixed(4)}, inside the ${String(REPRODUCTION.f1Delta)} the reviewer moves by itself; the quantum is below the noise, which is what makes the error bar meaningful`,
  );
  assert(
    MINIMUM_REGISTERED_GAIN >= oneGolden,
    'and the minimum bar is at least one credit, or it could be cleared by a rounding error',
  );
  // **A met magnitude is outside the error bar, for every registration on file** - the entailment that replaced the
  // fixture above. `gain >= registeredGain` and `registeredGain >= resolution`, so `|gain| >= resolution` and the branch
  // that used to say `inconclusive` has nothing left to say. **The noise guard is the registered bar and the paired
  // test**, and this asserts that the two are not both weaker than the instrument.
  for (const [key, entry] of Object.entries(REGISTRATIONS)) {
    if (typeof entry.registeredGain !== 'number') continue;
    // **A registration may be below the bar only if it says so**, because the alternative - silently keeping it and
    // reading its outcome as confirmed - is how a table fills with devices made of noise. R-32 is the one entry here:
    // dispatched on 2026-11-16 against §60's 0.0017, before the corpus bar existed.
    if (entry.registeredBelowResolution === true) {
      assert(
        entry.registeredGain < resolutionFor(715),
        `"${key}" is marked as below the corpus resolution and is in fact below it`,
      );
      assert(
        registrationResolvable(entry, 715).resolvable === false,
        `"${key}" is refused as unfalsifiable rather than answered`,
      );
      continue;
    }
    assert(
      entry.registeredGain >= resolutionFor(715),
      `"${key}" registers ${String(entry.registeredGain)} against a ${String(resolutionFor(715))} resolution, so a met magnitude is outside it`,
    );
  }
  assert(
    summarise(onSlice(qualifies), onSlice(baseline)).verdict.insideResolution === false,
    'and the published field still reports the comparison it was asked about',
  );

  // **The arm the registration names, on the pair of numbers that made this field necessary.** These two fixtures are
  // the R-18 run in miniature: the file arm gains 0.2 and the pull-request arm loses 0.0667. Before `arm` existed the
  // threshold was compared against the top-level figure, so this pair - the failing one - reported `magnitudeMet: true`.
  const wideOff = artifact({
    profile: undefined,
    codeContext: false,
    tp: 300,
    fp: 1700,
    fn: 700,
    prTp: 300,
    prFp: 1700,
    prFn: 700,
    covered: [[0, 1, 2], [3]],
    goldensPerPr: [500, 500],
    // **The slice §20 names**, because a run over other rows cannot confirm it whatever its gain - and the arm test
    // would otherwise be answered by the slice gate instead of by the arm.
    slice: { skip: 14, requested: 36 },
  });
  const fileOnly = artifact({
    profile: undefined,
    codeContext: true,
    tp: 600,
    fp: 1400,
    fn: 400,
    prTp: 200,
    prFp: 1800,
    prFn: 800,
    covered: [
      [0, 1, 2],
      [3, 4, 5],
    ],
    goldensPerPr: [500, 500],
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
    tp: 200,
    fp: 1800,
    fn: 800,
    prTp: 500,
    prFp: 1500,
    prFn: 500,
    covered: [[0, 1, 2, 3, 4], [3]],
    goldensPerPr: [500, 500],
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
      tp: 600,
      fp: 1400,
      fn: 400,
      covered: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      goldensPerPr: [500, 500],
    }),
  };
  readerOnly.configuration = { ...readerOnly.configuration, agent: true, ensemble: 'reader' };
  readerOnly.merge = { enabled: true, unionPulls: 0, sides: { lanes: 0, reader: 380 }, pulls: 46 };
  const lanesOnlyArm = {
    ...artifact({
      tp: 300,
      fp: 1700,
      fn: 700,
      covered: [[0, 1], [3]],
      goldensPerPr: [500, 500],
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
      tp: 600,
      fp: 1400,
      fn: 400,
      covered: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      goldensPerPr: [500, 500],
    }),
  };
  oneSided.configuration = { ...oneSided.configuration, agent: true, ensemble: true };
  oneSided.merge = { enabled: true, unionPulls: 0, sides: { lanes: 0, reader: 394 }, pulls: 46 };
  const oneSidedWithout = {
    ...artifact({
      tp: 300,
      fp: 1700,
      fn: 700,
      covered: [[0, 1], [3]],
      goldensPerPr: [500, 500],
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
        tp: 600,
        fp: 1400,
        fn: 400,
        covered: [[0, 1, 2]],
        goldensPerPr: [500, 500],
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
  // **A lane set is its name in every sentence a reader reads**, because the lanes are the same five in both arms and
  // printing them would put the interesting word at the end of a truncated line.
  if ('name' in value && typeof value.name === 'string') return value.name;
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
    //
    // **And it says what is still readable**, which is the paired reading on the rows both arms read. The totals are
    // refused because two denominators built from different rows are not a difference; the pairs are not, because on a
    // shared row the two arms were given the same code and the same goldens. R-31 - two arms, seven hours, and a
    // comparison job that answered with one sentence - is why this is computed rather than deferred.
    let paired = null;
    try {
      paired = pairedOnCommonPullRequests(on, off);
    } catch {
      paired = null;
    }
    refuse('the two artifacts are not the same experiment', {
      confounds,
      ...(paired ? { pairedOnCommonPullRequests: paired } : {}),
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
