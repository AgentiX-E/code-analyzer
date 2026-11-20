// The corpus a direct competitor published, judged by us and by them.
//
// **Why this one, ahead of the others on the audit's list.** `Alibaba-Aone/aacr-bench` is **the one public corpus that
// measures what our distinctive claim claims**: **200 real pull requests across 10 languages, 1,505 expert-confirmed
// issues, three context levels - and the third is `Repo Level`, which is cross-file by construction.** **Their
// dataset card also ships `negative_samples.json`, 640 invalid comments, which means it can compute a noise rate** -
// **and the noise rate is the axis our own competitor-corpus job could only measure as a denominator.**
//
// **And the correction that belongs in this file rather than in a footnote.** **Alibaba built both the tool and the
// benchmark it wins on**, which an independent party stated plainly: *"an instrument that agrees with itself is not
// evidence."* **Their own reported absolute precision is 33.9%** - so **even their winner is wrong two times in
// three**, and **their 33.90% against 7.23% gap and their 9x token claim are their measurements on their corpus.**
// **This job therefore reports our numbers on that corpus and states that the comparison is against a
// self-published figure rather than against a run we performed**, which is **the same distinction the whole stretch
// has been about.**
//
// **And what it cannot do, said before it is run.** **Their README's claim is OCR against Claude Code on the same
// base model** - **two review systems, one model.** **Our engine is a third review system**, so **a row for us is a
// third column and not a re-run of theirs**, and **the artifact says which columns were produced here.**

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  GOLDEN_BUCKETS,
  REJECTION_SHAPES,
  attributeGoldens,
  dominantRejectionShape,
  largestBucket,
  mergeAttributions,
  normalisePath,
} from './lib/golden-attribution.mjs';
import { requestedPullRequests, skippedPullRequests, spendCeilingUsd } from './lib/run-config.mjs';
import { checkoutsToPrune, createOneIndexCache } from './lib/one-index-cache.mjs';
import { DEFAULT_ATTEMPTS, backoffMs, retryAfterMs } from './lib/retry-after.mjs';
import { exactMcNemar } from './lib/paired-test.mjs';
import {
  WITHHELD,
  compareAgainstCompetitor,
  describeComparison,
} from './lib/competitor-comparison.mjs';
import { goldenDiscordance, pairedCorpus } from './lib/paired-corpus.mjs';
import { scoreCorpusFileSemantic, scoreFileSemantic } from './lib/file-semantic.mjs';
import { describeUnread, readTheWholeCorpus, unreadCorpus } from './lib/unread-corpus.mjs';
import {
  DEFAULT_BASELINE_PATH,
  corpusFingerprint,
  parseCompetitorMode,
  readBaseline,
  recordedPull,
  pullFingerprint,
  replayedPull,
  resolveCompetitor,
  startRecording,
  refreshProvenance,
  withRecord,
  writeBaseline,
} from './lib/competitor-baseline.mjs';
import { operatingPointTable } from '../../scripts/lib/operating-point.mjs';
import { locateLaneFindings } from '../../scripts/lib/lane-attribution.mjs';
import { isTransientStatus, withRetry } from '../../scripts/lib/transient-fetch.mjs';

const BENCH = process.env['AACR_DIR'] ?? '/tmp/aacr-bench';
const MODEL = process.env['AACR_JUDGE_MODEL'] ?? process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const BASE =
  process.env['AACR_JUDGE_BASE'] ??
  process.env['MARTIAN_BASE_URL'] ??
  'https://api.deepseek.com/v1';
const KEY =
  process.env['AACR_JUDGE_KEY'] ??
  process.env['MARTIAN_API_KEY'] ??
  process.env['DEEPSEEK_API_KEY'];
/**
 * **How many pull requests the run reviews, and why the default rose from five to fourteen.**
 *
 * Five was the number that fitted a first reading of the corpus. **It is not the number at which a prompt device can be
 * measured**: three runs over the same five pull requests and the same fifty goldens moved the file arm's F1 between
 * 0.2368 and 0.2781, so **±0.04 is this instrument's resolution at that size**, and §8 of `docs/EVAL-CONTRACT.md`
 * says plainly that a rule expected to move F1 by less than that will not be measured here - it will be a rule that
 * cannot fail. **Fourteen pull requests is about a hundred and forty goldens**, which is where a 0.04 move stops being
 * a coin toss, and it is the number the registration was written against rather than a number chosen after the run.
 */
const MAX_PRS = requestedPullRequests(process.env['MAX_PRS']);

/**
 * **Where the run starts in the corpus, so a confirmation is not scored on the rows that produced the hypothesis.**
 *
 * The discovery that produced R-17 was made on AACR-Bench's first fifty pull requests. **A threshold chosen between two
 * measured groups and then confirmed on the same rows is a threshold fitted to them**, so the confirmation reads the
 * hundred after those fifty - and the artifact records both numbers, because **a run that says "one hundred" without
 * saying "one hundred starting at fifty" is a run whose corpus cannot be reconstructed.**
 */
const SKIP_PRS = skippedPullRequests(process.env['AACR_SKIP_PRS']);

/**
 * **The competitor arm, parsed once.**
 *
 * The spend ceiling depends on it - a recording run buys the competitor's own result and a replaying one does not - and
 * **two independent reads of the same variable are two chances to disagree about what was bought.** Parsed here, used
 * by the ceiling and by the arm itself, and reported by the artifact.
 */
const COMPETITOR_CHOICE = parseCompetitorMode(process.env['AACR_COMPETITOR']);

/**
 * **The one switch the paired experiment turns.** `AACR_CHECKLIST=on` puts the per-language defect checklist into every
 * lane prompt; anything else leaves it out. **A string rather than a boolean**, because the value arrives from a
 * workflow's `env:` block where everything is a string, and **a flag that reads `"false"` as true is the kind of bug a
 * comparison would report as a null result.**
 *
 * **The unset default is `off`, and it moved to match the product.** The engine shipped the checklist on until two
 * paired runs put it 12 and then 13 goldens behind the prompt without it (`docs/EVAL-CONTRACT.md` §15.3), and **a
 * harness whose default disagrees with the engine's measures a configuration nobody ships** - the `with` arm of the
 * matrix names `on` explicitly, so aligning the default costs the experiment nothing and stops a bare local run from
 * measuring the retired arrangement.
 */
const CHECKLIST = String(process.env['AACR_CHECKLIST'] ?? 'off').toLowerCase() === 'on';

/**
 * **The second switch a run turns, and the one the bill is about: where the target-and-diff block sits.**
 *
 * `boilerplate-first` is what ships - the lane's role, checklist, output contract and examples lead, and the file's own
 * path and diff close the prompt - so **the reusable prefix is the same for every file the lane reads.**
 * `lane-first` is the arrangement before the device and `diff-first` is the one §9 of `EVAL-CONTRACT.md` registered
 * before it was measured. **All three are product values rather than harness values**, because a run that measured
 * something the product does not do would be a run about a different product.
 */
const PROMPT_ORDER = String(process.env['AACR_PROMPT_ORDER'] ?? 'boilerplate-first');

/**
 * **What the run emits: every category, or only the ones a corpus with an answer key accepted.**
 *
 * `category-prior.ts` carries the measurement - on this corpus, `test` findings were accepted 11 times out of 95 and
 * `architecture` 36 out of 179, while `bug` was 86 of 211. **A mixture problem is not repaired by wording**, so the
 * profile is an input rather than a constant: `AACR_PROFILE=advisory` (the default) keeps every category, and
 * `AACR_PROFILE=defect` drops the categories measured below the 0.22 acceptance floor.
 *
 * **The default was `defect` for exactly as long as it took to confirm it, and the confirmation is why it is not.**
 * Registered in §19 (R-17) as at least +0.02 F1 and confirmed on the hundred pull requests the discovery did not see
 * (run 42871500941, `skip_pull_requests: 50`): precision 0.1622 → 0.2559, recall 0.1768 → 0.1354, F1 0.1692 → 0.1771.
 * **That is +0.0079 against a registered +0.02, inside the 0.0194 this instrument resolves at 724 goldens, and the
 * paired test loses 68 goldens for every 38 it gains at p = 0.0046** - so the device bought precision by spending
 * coverage, significantly, and the F1 it moved is not distinguishable from zero. **A filter that costs a significant
 * number of goldens to move F1 by less than the noise is not a default**, whatever it does to precision.
 *
 * It stays in the code because it is a measured device and a reader may want it; flipping it back requires a
 * registration that a run of unseen pull requests reaches.
 *
 * **The value is validated rather than defaulted**, because **a typo in an environment variable that silently falls
 * back to the default is an experiment that measures the wrong arm and says so in its own metadata** - the defect the
 * prompt-order input was written to avoid.
 */
const PROFILE = (() => {
  const raw = String(process.env['AACR_PROFILE'] ?? 'advisory');
  if (raw !== 'defect' && raw !== 'advisory')
    throw new Error(`AACR_PROFILE must be "defect" or "advisory", not "${raw}"`);
  return raw;
})();

/**
 * **Which lane set a run bought, refused rather than defaulted when it is unrecognised.**
 *
 * The same rule `PROFILE` follows and for the same reason: **a typo that falls through to a default is a run that pays
 * for one reviewer and publishes another's name.** `behaviuor`, `on` and the empty string are all refused here, before
 * a single call, rather than silently reviewing with the five lanes and writing a `laneSet` nobody implemented.
 */
/**
 * **The sets this file accepts, in one list, because the list had two copies and the second one went stale.**
 *
 * `LANE_SETS` in `packages/intelligence/src/review/llm/prompts.ts` is the definition; this is the copy the refusal reads.
 * Adding R-37's `wide` to the module and not to the `if` below produced a dispatch that threw at module scope - **the
 * right failure, on an input the workflow had just declared valid**, which is the pair a reader cannot tell apart without
 * opening both files. `tests/unit/scripts/a-lane-set-the-bench-refuses-is-a-set-that-exists.test.ts` keeps them equal.
 */
const LANE_SET_NAMES = ['shipped', 'behaviour', 'wide'];

function parseLaneSet(raw) {
  const value = String(raw ?? 'shipped');
  if (!LANE_SET_NAMES.includes(value))
    throw new Error(`AACR_LANE_SET must be one of ${LANE_SET_NAMES.join(', ')}, not "${value}"`);
  return value;
}

/** **The lane set this run bought**, and the one value in this file whose typo would re-price every published figure. */
const LANE_SET = parseLaneSet(process.env['AACR_LANE_SET']);

/**
 * **How the lanes are put to a file: one call each, or one call for all of them.**
 *
 * `AACR_LANE_MODE=fused` sends `FUSED_REVIEW_PROMPT` once per file and files each answer under the lane it labels
 * itself with. **What it buys is arithmetic rather than a hope**: on one 8 000-character diff the five lane prompts are
 * 68 111 characters and the fused prompt is 14 944, which is 21.9 % - and that is the whole claim of R-47. **What it may
 * cost is accuracy**, which is why the default is the arrangement every published figure was measured under and why a
 * fused dispatch is a diagnostic against a same-day arm rather than a new baseline.
 *
 * **Refused rather than defaulted when it is unrecognised**, for the reason `parseLaneSet` is: a typo that falls through
 * to `separate` is a run that pays for one reviewer and publishes it under the other's name.
 */
const LANE_MODE_NAMES = ['separate', 'fused'];

function parseLaneMode(raw) {
  const value = String(raw ?? 'separate');
  if (!LANE_MODE_NAMES.includes(value))
    throw new Error(`AACR_LANE_MODE must be one of ${LANE_MODE_NAMES.join(', ')}, not "${value}"`);
  return value;
}

/** **The call shape this run bought.** */
const LANE_MODE = parseLaneMode(process.env['AACR_LANE_MODE']);

/**
 * **The switch the head-to-head made necessary: a reviewer that can read the repository.**
 *
 * `AACR_AGENT=on` replaces the five lanes with `ReviewAgent`: it groups the changed files, gives the model the five tools
 * their `internal/tool/definitions.go` gives theirs, and files a finding only when the code it quotes can be found. The
 * reason is a number this repository published: **on 36 paired pull requests the competitor reached F1 0.4043 and we
 * reached 0.2033**, and 158 of the 282 goldens we missed had **a finding of ours on their path, within ten lines, that
 * described something else.** That is not a prompt-tuning gap; it is a reviewer reasoning about a patch it cannot read.
 *
 * **Why it is a switch and not the default**: the default has to stay the arm every published figure was measured under,
 * or a run that forgets the switch reproduces half a new number. **And why the repository is a checkout rather than the
 * API**: the agent's `read_file` is synchronous by design - so that the module that decides what a reviewer may read is
 * testable - and a checkout is also what the competitor's own harness is given, which keeps the two arms comparable in
 * the resource that matters.
 */
const AGENT = String(process.env['AACR_AGENT'] ?? 'off').toLowerCase() === 'on';
/**
 * **ARM SEVEN: both reviewers, merged into one list** (§56).
 *
 * `AACR_ENSEMBLE=on` requires `AACR_AGENT=on` and adds one thing to the arm: the pull request's findings are the lanes'
 * **and** the reader's, and `mergeReviewers` decides which of them are posted.
 *
 * **Why this is a different arm rather than a fix to the reader's.** On `43676036390` the two reviewers found 198 and 171
 * distinct goldens with **93 in common**: a union of 276 of 724 against 198 for either alone. The second reviewer is a
 * second field of view, and the reason it has never paid for itself is that it spends 1 920 comments to express one. **The
 * merge is the device; this flag is the arm that measures whether the device works.**
 */
const ENSEMBLE_MODE = String(process.env['AACR_ENSEMBLE'] ?? 'off').toLowerCase();
/**
 * **The flag has three states, and the third one exists because a device nobody chose was measured by accident.**
 *
 * `on` is the union of §56 - both reviewers, one merged list. `reader` is **one reviewer, de-duplicated and cut**: the
 * same selection pass, run over the reading reviewer's candidates alone.
 *
 * **Why it is a state rather than a side effect.** R-29 was registered as the union and dispatched with the lanes emptied
 * by the cost rule upstream (§57.2), so the run measured the one-sided device at **0.2504 F1 over 0.2148** and called it
 * the union's. **A device that is reachable only by an accident of another device's configuration cannot be registered,
 * re-run, or falsified** - and this one is not an accident: it is the cheapest arm that has ever beaten the shipped
 * point on this corpus. `reader` names it, publishes `merge.sides.lanes: 0`, and is judged against its own registration.
 */
const ENSEMBLE = ENSEMBLE_MODE === 'on' || ENSEMBLE_MODE === 'reader';
const ENSEMBLE_READER_ONLY = ENSEMBLE_MODE === 'reader';
/** What the artifact records: `false`, `on`, or `reader`. The confound guard reads this value, and the registration is
 * chosen by it - **two devices under one flag is how a pair comes to compare an arm with itself.** */
const ENSEMBLE_SETTING = ENSEMBLE ? ENSEMBLE_MODE : false;
// **A merge with nothing to merge is refused before a single call is bought.** `AACR_ENSEMBLE=on` with `AACR_AGENT=off`
// leaves the arm reviewing with the five lanes and writing `ensemble: true` into its configuration - **an artifact that
// says both reviewers ran when one did**, and a pair whose varied key is the flag rather than the device. There is no
// version of this that is a measurement, so it ends here rather than in a footnote on a figure.
if (ENSEMBLE && !AGENT) {
  console.error(
    'AACR-ENSEMBLE refuses to run: the merge needs `AACR_AGENT=on` (a merge of one reviewer is not a merge)',
  );
  process.exit(2);
}

/**
 * **How many findings one file may carry, which §23.7 measured to be a binding cap rather than a safety rail.**
 *
 * On `43176459822` the arm filed 225 drafts and kept 196: **25 were dropped as `over-budget`, every one of them a comment
 * the model had already written and grounded and was then refused a slot for.** Against that, 74 of the 232 goldens the
 * arm missed sit on a file it read and said nothing about, and 35 on a file it never opened - **109 of 232, nearly half,
 * are volume rather than aim.** Three per file is a number inherited from the lane arm, where three slots *per file per
 * lane* was the whole emission contract; a reader that has seen the file has no such reason.
 *
 * **So it is an input rather than a constant**, validated like every other switch here: a run at 6 and a run at 3 on the
 * same rows differ in this line and in nothing else, and the artifact records which one produced the figure.
 */
const MAX_FINDINGS_PER_FILE = (() => {
  const raw = String(process.env['AACR_MAX_FINDINGS_PER_FILE'] ?? '3');
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20)
    throw new Error(`AACR_MAX_FINDINGS_PER_FILE must be an integer in 1..20, not "${raw}"`);
  return parsed;
})();

/**
 * **The rule the lanes are calibrated under**, applied to a list of ranked findings: the actionability gate and the
 * category profile's floor, which are one operating point rather than two conditions.
 *
 * Extracted from the per-pull-request row so that **§23.7's decision is arithmetic a dry run can check** instead of a
 * ternary buried in a five-hundred-line loop: the lane rule is computed for *every* arm, and which of the two vectors
 * becomes `keep` is the single line §23.7 changed.
 */
const laneRuleKeep = (entries, profileKept) =>
  entries.map((entry) => entry.score.actionable && profileKept.has(entry));

/**
 * **The product's emission policy, imported from the package that ships it.**
 *
 * Read at module load rather than inside `main`, because the rule below is a top-level constant and **a rule that had to
 * be passed around a five-hundred-line loop is a rule that gets a second copy**. `dist/` is built by the workflow before
 * the dry run (`Build all packages` precedes `--dry-run`), which is the same order every other built import in this file
 * relies on; a checkout without it fails by name instead of silently measuring something else.
 */
const {
  applyEmissionPolicy,
  describeEmissionSteps,
  PREVIOUS_EMISSION_STEPS,
  SHIPPED_EMISSION_STEPS,
} = await import('../../packages/intelligence/dist/review/emission-policy.js');

/**
 * **One pull request's findings under a named policy, with the counts the policy refused them on.**
 *
 * The steps are an argument rather than a constant because §106 has to print two rows - the cut that ships and the cut
 * every figure before it was filed under - **from one pool and one set of verdicts**, and a second copy of this loop for
 * the second row is a second rule that will drift one field at a time. Every finding's path travels into the policy:
 * a path-class step handed no path reads every finding as `other` and would price a step that never fires.
 */
const keepUnder = (steps, entries, pullRequest, profileKept) => {
  if (entries.length === 0) return { keep: [], droppedByPathClass: [] };
  // **The profile is applied before the policy, not instead of it.** `drop test, budget 12` was priced on the advisory
  // profile, where the floor removes nothing; a `defect` run would otherwise publish a point that quietly posted the
  // categories its own profile had dropped - **one figure about two rules**, which is the defect §54 fixed one level up.
  const published = applyEmissionPolicy(
    entries
      .filter((entry) => profileKept === undefined || profileKept.has(entry))
      .map((entry) => ({
        entry,
        category: entry.finding?.category,
        score: entry.score?.score,
        // **The path, because §106's step classifies it** and a policy handed no path classifies every finding as
        // `other` - which would price a step that never fires.
        path: entry.path,
        pr: pullRequest,
      })),
    steps,
  );
  const keep = new Set(published.kept.map((item) => item.entry));
  return {
    keep: entries.map((entry) => keep.has(entry)),
    droppedByPathClass: published.droppedByPathClass,
  };
};

/**
 * **Which findings reach a reader: the cut the product ships, applied to one pull request's ranked findings.**
 *
 * **This used to be the actionability gate and the category floor**, and it was wrong by measurement: on the pair
 * `43676036390` the gate scored F1 0.1823 while `drop test, budget 12` - the same findings, the same goldens, the same
 * judge - scored 0.2121 with 148 fewer comments and precision 0.2236 against 0.1735. **A published point 0.0298 below
 * the best point the artifact could already price, beside the table that said so.**
 *
 * **The rule is imported rather than restated**, because the `review pr` command applies the same object to the comments
 * it posts - so a figure measured here is a figure about the reviewer a user runs. `laneRuleKeep` stays, because a
 * scoping decision that stops being re-measured is a decision that can quietly become wrong, and the artifact still
 * prints the gate beside the headline.
 */
const shippedRuleKeep = (entries, pullRequest, profileKept) =>
  keepUnder(SHIPPED_EMISSION_STEPS, entries, pullRequest, profileKept).keep;

/** **The point every figure before §106 was filed under**, so the artifact holds the comparison rather than a changelog. */
const previousRuleKeep = (entries, pullRequest, profileKept) =>
  keepUnder(PREVIOUS_EMISSION_STEPS, entries, pullRequest, profileKept).keep;

/**
 * **The switch this iteration is about: whether a lane is shown the code each hunk sits in.**
 *
 * `AACR_CODE_CONTEXT=on` reads every changed file at the pull request's head commit through the API and passes it to
 * `reviewPullRequest`, which shows each lane the block around each hunk instead of the hunk alone. `off` is the
 * behaviour every figure this repository has published was measured under, so **the default is `off` and a run that
 * forgets the switch reproduces the old number rather than half of a new one.**
 *
 * **Why it is a switch rather than a fix.** `docs/EVAL-CONTRACT.md` §20 registers the claim before the run, and **a
 * device a run cannot turn off is a device whose contribution cannot be measured** - the same reason the checklist and
 * the prompt order are environment values. The retrieval costs one API call per changed file and 650 tokens per file of
 * prompt, so **an on-arm spends money the off-arm does not: the artifact records both the calls and the characters.**
 */
const CODE_CONTEXT =
  AGENT || String(process.env['AACR_CODE_CONTEXT'] ?? 'off').toLowerCase() === 'on';

/**
 * **`AACR_CHANGE_SHAPE=on` classifies every hunk before a lane is paid to read it.**
 *
 * §79: a finding standing entirely outside the lines a pull request touched is a finding about code the change did not
 * write, and the patch can say so without a model call. `on` computes that set per file from the unified diff and hands
 * it to the gate; `off` is every figure this repository has published, so **the default reproduces the old number
 * rather than half of a new one** - the same reason `AACR_CODE_CONTEXT` defaults to `off`.
 *
 * **It is worth nothing without a gate to consume it**, so the switch reports that rather than pretending: a shape-only
 * run would compute a set no device reads.
 */
const CHANGE_SHAPE = String(process.env['AACR_CHANGE_SHAPE'] ?? 'off').toLowerCase() === 'on';

/**
 * **`AACR_REACH=on` supplies the repository graph the lanes were never given** (§100 registered it, §101 built the
 * supply).
 *
 * §100 moved the index in front of the sentence and the device could not be run: **`buildRepoIndex` had no caller that
 * had a repository.** The benchmark fetches the changed files and nothing else, so *"three callers still pass two
 * arguments"* was a sentence no arm could produce. This switch gives the lanes a checkout: the pull request's head
 * commit is cloned once, every file the index can read is walked once, and each changed file is handed the one line
 * describing what it reaches.
 *
 * **`off` is the default and it is every figure this repository has published**, for the reason `AACR_CODE_CONTEXT`
 * says it: a default that silently turned the device on would make the next run incomparable with the last one rather
 * than with itself.
 *
 * **It is not free.** A clone per pull request is bandwidth, and the index is a few hundred milliseconds per
 * repository; **the artifact records both**, because a device whose price is not in the artifact is a device nobody can
 * decide to keep.
 */
const REACH = String(process.env['AACR_REACH'] ?? 'off').toLowerCase() === 'on';

/**
 * **The pull-request arm's budget, and the arithmetic that chose it before the run.**
 *
 * The file arm fills three slots **per file per lane**; over 199 files it emitted **183 findings carrying 21 goldens**
 * - precision 0.2019, recall 0.42, F1 0.2727. The same contract applied to a whole pull request fills three slots **per
 * pull request per lane**; over five pull requests it emitted **15 findings carrying 6** - precision **0.40**, recall
 * 0.12, F1 0.1846.
 *
 * **Those two figures measure the same budget against two scopes, and they are the whole argument.** At fifteen
 * findings, the file arm's precision on the curve already recorded is **0.20** and the pull-request arm's is **0.40** -
 * so **the scope is worth a factor of two in precision at equal emission**, and the small arm's problem was never
 * precision, it was that three slots for a whole pull request buys a tenth of the recall.
 *
 * **Sixteen was where the arithmetic crossed the figure to beat**, and it was a pre-registration rather than an optimum:
 * with 50 goldens and 80 emitted findings, F1 > 0.45 needs 30 true positives, which is precision 0.375 - *below* the 0.40
 * the arm had already demonstrated.
 *
 * **Twelve replaces it, and this is a registered change made before the run rather than after it.** `witness-replay.mjs`
 * replays the artifact's findings under the artifact's matching protocol, so the truncation can be re-scored without a
 * model, and the curve has a peak:
 *
 * | findings per pull request | emitted | matched | precision | recall | F1       |
 * | ------------------------- | ------- | ------- | --------- | ------ | -------- |
 * | 4                         | 175     | 54      | 0.3086    | 0.1211 | 0.1739   |
 * | 8                         | 275     | 81      | 0.2945    | 0.1816 | 0.2247   |
 * | **12**                    | **338** | **90**  | **0.2663** | **0.2018** | **0.2296** |
 * | 16 (**what shipped**)     | 383     | 93      | 0.2428    | 0.2085 | 0.2244   |
 *
 * **The 13th to 16th comment of a pull request buys three matches for forty-five comments**, which is the whole of the
 * argument: the tail of every pull request's ranking is close to noise, and a cap is the cheapest instrument that can
 * refuse it. **The engine's own default is the same number** (`DEFAULT_PULL_REQUEST_BUDGET` in
 * `packages/intelligence/src/review/llm/llm-review-engine.ts`), and a test asserts the two have not drifted apart -
 * **the benchmark arm and the shipped default disagreeing silently is how a number stops describing the product.**
 *
 * **The falsifier is restated in the currency this corpus reports**: F1 0.45 on 452 goldens needs about **178 matched
 * goldens**, which at 338 emissions is precision 0.53. The registration is therefore *precision must stay above 0.24 and
 * matched goldens above 90 at the smaller budget* - a decay to 80 would mean the curve was a property of the old run.
 */
const PR_BUDGET = Number(process.env['PR_BUDGET'] ?? '12');

function findSamples(name) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === name) hits.push(full);
    }
  };
  walk(BENCH, 0);
  return hits[0] ?? null;
}

/**
 * **One judge call's usage, added to the run's judge total.**
 *
 * **`prompt_cache_hit_tokens` is read here as well as on the reviewer**, because the judge's system prompt is the same
 * for every pair - so the judge is a prefix-cache client too, and **a judge that reported a hundred per cent misses
 * would be a second device left on the table.**
 */
function recordJudgeUsage(usage) {
  if (!usage || typeof usage !== 'object') return;
  judgeSpend.calls += 1;
  judgeSpend.promptTokens += Number(usage.prompt_tokens ?? 0);
  judgeSpend.completionTokens += Number(usage.completion_tokens ?? 0);
  judgeSpend.cacheHitTokens += Number(usage.prompt_cache_hit_tokens ?? 0);
  judgeSpend.cacheMissTokens += Number(usage.prompt_cache_miss_tokens ?? 0);
}

/**
 * **What the judge spent, in the same units as the reviewer.**
 *
 * **Why this exists and why it took until now.** The reviewer's calls go through a client this repository owns, so the
 * ledger sees them; **the judge is a bare `fetch` in this file, so it was invisible** - and the audit that priced a job
 * at 62.82 CNY had to *infer* that the reviewer was about a fifth of it rather than read it. **A bill with one
 * unmetered line is a bill whose largest line might be the unmetered one.**
 *
 * **The figures are kept beside the ledger's rather than inside it**, because the ledger prices calls made through
 * `DeepSeekProvider` and this is not one of them; **merging two sources into one total without saying which is which
 * is how a total stops being checkable.**
 */
const judgeSpend = {
  calls: 0,
  failures: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  // **How many refusals were rate limits**, because a judge that gave up on a 429 and a judge that gave up on a bad
  // answer are different failures with different fixes, and `failures` alone cannot tell them apart.
  rateLimited: 0,
};

/** Their judge prompt, reconstructed from their paper's description: same defect, different words is a match. */
async function judgeImpl(comment, golden) {
  const prompt = [
    'You are comparing a code review comment against an expert-confirmed issue from the same pull request.',
    'Answer with one JSON object: {"match": true|false}.',
    'They match when they describe the same underlying defect, even in different words.',
    '',
    `Expert-confirmed issue:\n${golden}`,
    '',
    `Review comment:\n${comment}`,
  ].join('\n');
  for (let attempt = 0; attempt < DEFAULT_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          // **A verdict is four tokens wide.** The prompt says "reply with JSON only" and the model complies, but an
          // unbounded field is an instruction rather than a bound, and **the difference between a bound and an
          // instruction is the half of the bill that arrives on the days the model explains itself.**
          max_tokens: 16,
          messages: [
            {
              role: 'system',
              content: 'You compare code review statements. Reply with JSON only.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        // **The wait the endpoint asked for, carried on the error so the catch block can honour it.** A `Retry-After`
        // read here and dropped there is the same thing as not reading it.
        const refusal = new Error(`http ${res.status}`);
        refusal.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after'));
        if (res.status === 429) judgeSpend.rateLimited += 1;
        throw refusal;
      }
      const body = await res.json();
      recordJudgeUsage(body.usage);
      const text = String(body.choices?.[0]?.message?.content ?? '')
        .replace(/```json|```/g, '')
        .trim();
      return Boolean(JSON.parse(text).match);
    } catch (error) {
      // **A header wins over the schedule, and the schedule is long enough to cross a window.** Three attempts inside
      // six seconds was three attempts inside one rate-limit window: the same request refused three times, and the third
      // refusal was recorded as the judge having nothing to say. **That is how 183 pairs of one arm and none of the
      // other became a recall figure**, and it is why this loop now waits what it is told and then waits longer.
      const wait = Number.isFinite(error?.retryAfterMs)
        ? Number(error.retryAfterMs)
        : backoffMs(attempt, { jitter: Math.random() });
      await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
    }
  }
  // **A judge that did not answer is not a non-match**, the same distinction as everywhere else in this repository.
  judgeSpend.failures += 1;
  return null;
}

/**
 * **The judge this run uses, and the seam that lets the arithmetic be tested without the model.**
 *
 * **Why a seam is not a mock of the thing under test.** The arithmetic below - ranking, matching, the curve, the paired
 * test - is what a run is *for*, and **it can only be checked against a corpus whose answers are known in advance.**
 * `--dry-run` substitutes a table here, asserts the figures against numbers written by hand, and exits without writing
 * an artifact; **every other call in this file is the one that runs in the job.**
 */
let judgeFn = judgeImpl;

/**
 * **One judge pass per pair, and every verdict kept.**
 *
 * **Why the whole matrix and not the first match.** The previous version stopped judging a finding once it had matched
 * one golden, which makes the score depend on the order findings were judged in - and **a score that depends on an
 * order cannot be compared between two reviewers judged in different orders.** Judging every pair costs
 * `findings × goldens` calls per pull request - about a thousand for the corpus at this size - and buys the two things
 * the next iteration needs: **a maximum matching rather than a greedy walk**, and **a curve that can be redrawn at any
 * budget without spending the model's budget again**.
 *
 * **And it is bounded work rather than unbounded work**, because the pairs are known before the first call, so the
 * concurrency below is a limit on calls in flight and not a race between them.
 */
const JUDGE_CONCURRENCY = Number(process.env['AACR_JUDGE_CONCURRENCY'] ?? '6');

/**
 * Run `task` over `items` with at most `limit` in flight.
 *
 * **A worker pool rather than `Promise.all(items.map(...))`**, because the matrix is a thousand calls and **a thousand
 * concurrent requests to one endpoint is how a run gets rate-limited into a partial result that reads as a worse
 * reviewer.** The index is taken from a single counter, which JavaScript's single-threaded execution makes safe.
 */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const at = next;
      next += 1;
      if (at >= items.length) return;
      // **The item, and not the index beside it.** The second argument was passed and read by
      // nobody - the one caller maps over a list of indices, so it would have received the same
      // number twice - and a parameter that exists for a caller that does not exist is a signature
      // that lies about what a task is given.
      results[at] = await task(items[at]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Judge every finding against every golden in one pull request.
 *
 * **Returns, per finding, which goldens it matched** - a list rather than a boolean, because **a finding that matches
 * two goldens is evidence about both**, and a boolean would have forced the choice at the moment of judging, which is
 * the moment the answer key is least known.
 *
 * **The order the pairs are judged in is a cost decision, and it changes no verdict.**
 *
 * The judge's prompt is `instructions + expert-confirmed issue + review comment`, and the first two blocks are the same
 * for every finding scored against the same golden. **A prefix cache is written by the first request that carries it and
 * read by the requests that follow**, so a matrix submitted in `finding-major` order has one request per golden carrying
 * a prefix nobody has written yet, and the concurrent ones miss - which is why the run of 2026-11-10 reported **7.9 %**
 * cache reuse on 6 859 calls while the reviewer, which orders its lanes, reported 61 %.
 *
 * **So each golden's first pair is judged alone before the rest of its pairs are submitted together.** The verdicts are
 * identical - every pair is still judged once, against the same inputs, at the same temperature - and the only thing
 * that changes is which request pays the full price for the prefix. **This is the same device as `planLaneWaves`, applied
 * to the judge**, and it is here rather than in the provider because the judge is a bare `fetch` in this file.
 */
async function judgeMatrix(texts, goldens) {
  const pairs = [];
  // **Golden-major**, so a golden's prefix is written once and read `texts.length - 1` times.
  for (let golden = 0; golden < goldens.length; golden += 1) {
    for (let finding = 0; finding < texts.length; finding += 1) pairs.push([finding, golden]);
  }
  const verdicts = new Array(pairs.length);
  const judged = new Set();
  // The warm pass: one call per golden, in sequence, so each prefix exists before anything tries to read it.
  for (let at = 0; at < pairs.length; at += 1) {
    const [finding, golden] = pairs[at];
    if (judged.has(golden)) continue;
    judged.add(golden);
    verdicts[at] = await judgeFn(texts[finding], goldens[golden]);
  }
  const rest = pairs.map((_, at) => at).filter((at) => !judged.has(at));
  const tail = await mapLimit(rest, JUDGE_CONCURRENCY, (at) => {
    const [finding, golden] = pairs[at];
    return judgeFn(texts[finding], goldens[golden]);
  });
  rest.forEach((at, index) => {
    verdicts[at] = tail[index];
  });
  const matches = texts.map(() => []);
  let unanswered = 0;
  pairs.forEach(([finding, golden], at) => {
    const verdict = verdicts[at];
    if (verdict === null) unanswered += 1;
    else if (verdict) matches[finding].push(golden);
  });
  return { matches, unanswered };
}

/**
 * **The measurement, on a corpus whose answers are written by hand.**
 *
 * **Why this exists at all.** A benchmark job that runs once per push and costs a thousand model calls is not a test:
 * **its arithmetic is unverified until the day it produces a number someone quotes.** This mode runs every step of the
 * job except the two that need the network - the review and the judge - over a four-golden, six-finding fixture whose
 * expected precision, recall, F1 and curve are written below **before** the code that computes them runs.
 *
 * **And the fixture is chosen to be able to fail.** Two findings match a golden the gate drops, so the gate's F1 is
 * *lower* than the whole list's here (0.5714 against 0.6) - **a self-test that can only pass is a self-test that says
 * nothing**, and a rule that is allowed to lose is a rule whose gain on the real corpus means something.
 */
async function dryRun() {
  const assert = (await import('node:assert/strict')).default;
  const {
    collectDiffFacts,
    matchedGoldenIndices,
    maximumMatchingCount,
    point,
    rankFindings,
    topKCurve,
  } = await import('../../packages/intelligence/dist/review/actionability.js');

  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    '+const a = source.item;',
    '+return a.value;',
    '+log(a);',
  ].join('\n');
  const goldens = [
    'null deref in the guard',
    'the loop reads past the end',
    'unvalidated input',
    'missing error handling',
  ];

  // **The judge's answers, keyed by the finding's title**, because the title is the part of the prompt the two arms
  // share and the part the fixture controls.
  const answers = new Map([
    ['F1 null deref in the guard', [0]],
    ['F2 null deref reported again', [0]],
    ['F3 the loop reads past the end', [1]],
    ['F4 missing error handling', [3]],
    ['F5 rename the temporary', []],
    ['F6 style remark', []],
  ]);
  const judgeCalls = [];
  judgeFn = async (comment, golden) => {
    const title = comment.slice(0, comment.indexOf(' :: '));
    const goldenAt = goldens.indexOf(golden);
    judgeCalls.push({ title, goldenAt });
    return (answers.get(title) ?? []).some((at) => at === goldenAt);
  };

  const findings = [
    {
      title: 'F1 null deref in the guard',
      startLine: 1,
      endLine: 1,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the guard is missing before the deref',
      suggestion: 'Add a check before the deref',
    },
    {
      title: 'F2 null deref reported again',
      startLine: 2,
      endLine: 2,
      severity: 'medium',
      category: 'bug',
      lane: 'maintainability',
      description: 'the same deref seen from another angle',
      suggestion: null,
    },
    {
      title: 'F3 the loop reads past the end',
      startLine: 99,
      endLine: 99,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the loop bound is one too far',
      suggestion: 'Remove the call',
    },
    {
      title: 'F4 missing error handling',
      startLine: 3,
      endLine: 3,
      severity: 'high',
      category: 'bug',
      lane: 'security',
      description: 'the call can throw and nothing catches',
      suggestion: 'Throw on the error',
    },
    {
      title: 'F5 rename the temporary',
      startLine: 1,
      endLine: 1,
      severity: 'low',
      category: 'style',
      lane: 'maintainability',
      description: 'the temporary is unnamed in meaning',
      suggestion: 'Rename the temporary',
    },
    {
      title: 'F6 style remark',
      startLine: 50,
      endLine: 50,
      severity: 'info',
      category: 'style',
      lane: 'maintainability',
      description: 'spacing near the block',
      suggestion: null,
    },
  ];

  const facts = collectDiffFacts(diff);
  const ranked = rankFindings(
    findings.map((finding) => ({ finding, path: 'a.ts' })),
    facts,
  );
  assert.equal(
    ranked[0].finding.title,
    'F1 null deref in the guard',
    'the grounded finding with a fix and a security lane must rank first',
  );
  assert.deepEqual(
    ranked.map((entry) => entry.score.actionable),
    [true, true, true, false, false, false],
    'the gate keeps the three grounded findings that say what to change',
  );

  const matrix = await judgeMatrix(
    ranked.map((entry) => `${entry.finding.title} :: ${entry.finding.description}`),
    goldens,
  );
  assert.deepEqual(matrix.matches[0], [0], 'the first finding matches the first golden');
  assert.equal(matrix.unanswered, 0, 'a scripted judge never fails to answer');

  // **The order the judge was asked, which is the only part of the cost this file owns.**
  //
  // The prompt is `instructions + golden + comment`, and the first two blocks repeat across every finding scored
  // against the same golden - so **the first request carrying a prefix writes it and the rest read it**, and a
  // `finding-major` submission has one full-price request per golden and a concurrent tail that all miss. The warm pass
  // is asserted here rather than the cache ratio, because **the cache belongs to the vendor and the order belongs to
  // this file**: a run that reports a low hit ratio and a run that submitted in the wrong order are the same run, and
  // only one of them can be fixed here.
  assert.deepEqual(
    judgeCalls.slice(0, goldens.length).map((call) => call.goldenAt),
    goldens.map((_, at) => at),
    'the warm pass touches every golden once, in order, before the rest of the matrix is submitted',
  );
  // **And it is a reordering, not a filter.** Every pair is still judged exactly once: a device that raised the cache
  // ratio by judging fewer pairs would raise it by measuring less.
  assert.equal(
    judgeCalls.length,
    matrix.matches.length * goldens.length,
    'the reordering judges every pair exactly once, so the call count is unchanged',
  );

  // **Hand-computed, in the comment, before the assertion.** Gate keeps F1 (golden 0), F4 (golden 3) and F5 (nothing):
  // 2 true positives, 1 false positive, 2 goldens missed, so precision 2/3, recall 2/4 and F1 0.5714. The whole list is
  // 6 findings over 3 distinct goldens: precision 3/6, recall 3/4, F1 0.6 - **higher than the gate's, which is the
  // fixture doing its job.**
  // **And the attribution is exercised here too**, on a fixture whose goldens are placed so that every bucket is
  // reachable: a golden on a file that was reviewed and matched, one on a file that was reviewed in silence, and one
  // on a file the engine was never handed. **A wiring that published an empty table would pass every assertion above**
  // - the figures do not read the buckets - so the partition is checked where it is produced.
  // **And a fourth golden, on a file the lanes did comment on, at the line they commented on** - which is the bucket
  // that carries more than half the corpus and whose *shape* decides what the next iteration fixes. **A shape table
  // that is only ever exercised on an empty input is a shape table that is never exercised**, so this fixture makes
  // `findingOnPathRejected` reachable and places it on a finding's own line.
  const placed = ranked.find((entry) => Number(entry?.finding?.startLine) > 0) ?? ranked[0];
  const rejectedPath = placed?.path ?? 'src/kept.ts';
  const rejectedLine = Number(placed?.finding?.startLine) > 0 ? placed.finding.startLine : 1;
  const attributed = attributeGoldens({
    goldens: [
      { path: 'src/kept.ts', note: goldens[0] },
      { path: 'src/quiet.ts', note: 'an issue on a file the lanes were silent about' },
      { path: 'src/never.ts', note: 'an issue on a file the engine was never handed' },
      {
        path: rejectedPath,
        note: 'an issue the judge did not accept, on the line we did comment on',
        startLine: rejectedLine,
      },
      // **And a fifth, on a path the pull request does not have**, which is the corpus moving rather than this run
      // dropping a file. Without it the new bucket would be reachable only on the real corpus, which is the one place a
      // mis-wired bucket cannot be told apart from a filter that works.
      { path: 'src/gone.ts', note: 'an issue on a file the pull request no longer touches' },
    ],
    pullPaths: ['src/kept.ts', 'src/quiet.ts', 'src/never.ts', rejectedPath],
    reviewedPaths: ['src/kept.ts', 'src/quiet.ts', rejectedPath],
    findings: ranked,
    // **A matrix of this fixture's own, written out rather than borrowed from the run above.** `matrix.matches` is
    // indexed against the four-golden fixture, so reusing it here marked golden 1 as hit because `F3` answers golden 1
    // in that list - **an index is only meaningful against the list it was produced with**, and the failure looked like
    // a broken bucket rather than a borrowed table.
    matches: [[0], [], [], [], [], []],
  });
  assert.equal(attributed.total, 5, 'every golden is attributed exactly once');
  assert.equal(
    attributed.counts.fileNotReviewed,
    1,
    'the golden on a file the engine was never handed is attributed to the filter, not to the lanes',
  );
  assert.equal(
    attributed.counts.pathNotInPull,
    1,
    'a golden on a path the pull request no longer has is the corpus moving, not a filter to fix',
  );
  assert.equal(
    attributed.counts.noFindingOnPath,
    1,
    'the golden on a file that was read and produced nothing is attributed to the reading',
  );
  assert.equal(
    attributed.counts.hit >= 1,
    true,
    'at least one golden is attributed to a finding the judge accepted',
  );
  assert.equal(
    attributed.counts.findingOnPathRejected,
    1,
    'a golden on a line we commented on, which the judge did not accept, is a targeting-or-wording defect',
  );
  const rejectionShapes = mergeAttributions([{ pr: 'fixture', ...attributed }]).rejectionShape;
  assert.equal(
    rejectionShapes.sameLine,
    1,
    "and its shape is same-line, because the finding stands on the golden's own line",
  );
  assert.equal(
    REJECTION_SHAPES.reduce((sum, shape) => sum + rejectionShapes[shape], 0),
    1,
    'the shape table re-reads the rejected goldens and adds up to them',
  );

  // **The corpus's arithmetic, checked against numbers written down before it ran.**
  //
  // **First that it agrees with the protocol this job shipped wherever the two can agree.** The fixture above has no
  // comment covering two reference comments, so the file-level metric and the maximum matching must produce the same
  // figure - 3 of 4 goldens, 3 of 6 comments, precision 0.5, recall 0.75, F1 0.6. **A new arithmetic that disagreed
  // here would be a new arithmetic with a bug**, and the agreement is what makes the difference below attributable to
  // one-to-many coverage rather than to a re-implementation.
  const agreeing = scoreFileSemantic({
    findings: ranked.map(() => ({ path: 'a.ts' })),
    goldens: [
      { path: 'a.ts', note: goldens[0] },
      { path: 'a.ts', note: goldens[1] },
      { path: 'a.ts', note: goldens[2] },
      { path: 'a.ts', note: goldens[3] },
    ],
    matches: matrix.matches,
  });
  assert.equal(
    agreeing.precision,
    0.5,
    'the corpus arithmetic agrees on precision where nothing is covered twice',
  );
  assert.equal(agreeing.recall, 0.75, 'and on recall');
  assert.equal(
    agreeing.coveredGoldens,
    maximumMatchingCount(matrix.matches, goldens.length),
    'and on which goldens',
  );
  // **Then where they cannot agree, and by exactly the amount the protocol says.** One comment covering three
  // reference comments is one true positive under the old arithmetic and three covered goldens under this one: recall
  // 1 against 1/3, precision 1/2 because the second comment buys nothing it did not already have.
  const covering = scoreFileSemantic({
    findings: [{ path: 'a.ts' }, { path: 'a.ts' }],
    goldens: [{ path: 'a.ts' }, { path: 'a.ts' }, { path: 'a.ts' }],
    matches: [[0, 1, 2], [0]],
  });
  assert.equal(
    covering.coveredGoldens,
    3,
    'one comment may cover every reference comment of its file',
  );
  assert.equal(covering.hitNewGt, 1, 'and counts once towards precision');
  assert.equal(covering.duplicateHits, 1, 'while the restatement beside it counts for nothing');
  assert.equal(covering.precision, 0.5, 'so precision is one of two');
  assert.equal(covering.recall, 1, 'and recall is three of three');

  // **And the comparison, exercised in both of its answers**, because the defect it fixes was invisible precisely
  // because nothing in this file ever asked what the field says when the competitor arm is absent.
  // **Nine against one rather than six against one, because the assertion has to be arithmetically true**: the exact
  // tail over ten discordant pairs is 2(1 + 10)/2^10 = 0.0215, and over seven it is 0.125 - so the first draft of this
  // line asserted a verdict the statistic does not support, which is the dry run's job to catch and it did.
  const stated = compareAgainstCompetitor({
    oursOnly: 9,
    theirsOnly: 1,
    coverage: { requested: 3, covered: 3, missing: 0 },
  });
  assert.equal(stated.comparable, true, 'a fully covered corpus states a verdict');
  assert.equal(
    stated.verdict,
    'significant at 0.05',
    'nine against one is a significant difference',
  );
  assert.equal(stated.theirsOnly, 1, 'and the discordant pair it lost is carried');
  const absent = compareAgainstCompetitor({
    oursOnly: 83,
    theirsOnly: 0,
    coverage: { requested: 50, covered: 0, missing: 50 },
  });
  assert.equal(
    absent.comparable,
    false,
    'eighty-three against an arm with no rows is not a shutout, it is an absent counterpart',
  );
  assert.equal(absent.verdict, WITHHELD, 'and the verdict says so');
  assert.equal(
    absent.theirsOnly,
    null,
    'the zero is removed rather than published, because a zero reads as a shutout',
  );
  assert.equal(absent.pValue, null, 'and no p-value is computed against nothing');
  assert.equal(
    absent.oursOnly,
    83,
    'while our own count survives, because it is a fact about our arm and a reader rebuilding coverage needs it',
  );
  assert.equal(
    describeComparison(absent).includes('withheld'),
    true,
    'the log line reads from the object, so it stops printing a shutout on the run the artifact stopped printing it on',
  );

  const full = point(
    matrix.matches.length,
    maximumMatchingCount(matrix.matches, goldens.length),
    matrix.matches.length - maximumMatchingCount(matrix.matches, goldens.length),
    goldens.length - maximumMatchingCount(matrix.matches, goldens.length),
  );
  assert.deepEqual(full, {
    k: 6,
    truePositives: 3,
    falsePositives: 3,
    falseNegatives: 1,
    precision: 0.5,
    recall: 0.75,
    f1: 0.6,
  });

  // **The gate's own arithmetic, scored the way the job scores it.**
  const keptIndices = ranked
    .map((entry, at) => ({ entry, at }))
    .filter(({ entry }) => entry.score.actionable)
    .map(({ at }) => at);
  const keptMatches = keptIndices.map((at) => matrix.matches[at]);
  const kept = point(
    keptMatches.length,
    maximumMatchingCount(keptMatches, goldens.length),
    keptMatches.length - maximumMatchingCount(keptMatches, goldens.length),
    goldens.length - maximumMatchingCount(keptMatches, goldens.length),
  );
  assert.deepEqual(kept, {
    k: 3,
    truePositives: 2,
    falsePositives: 1,
    falseNegatives: 2,
    precision: 0.6667,
    recall: 0.5,
    f1: 0.5714,
  });

  // **§23.7's decision, as arithmetic instead of as a paragraph.**
  //
  // The actionability gate was calibrated on lane findings and was being applied to a reading arm, where it took three
  // quarters of the score. §54 then priced the gate itself and found it 0.0298 below a better cut of the same findings,
  // so **the gate is now a measured row rather than the shipped rule**: `laneRule` is scored beside the headline on
  // every run, and the shipped vector is the policy the package implements.
  const fixtureProfile = new Set(ranked);
  const laneRule = laneRuleKeep(ranked, fixtureProfile);
  const shipped = shippedRuleKeep(ranked, 'fixture');
  assert.equal(
    laneRule.filter(Boolean).length,
    3,
    'the lane rule keeps three of the fixture\u2019s six findings, whichever arm is under test',
  );
  assert.equal(
    shipped.filter(Boolean).length,
    ranked.length,
    'the policy keeps the fixture whole: it carries no test finding and six is under the budget of twelve',
  );
  assert.equal(
    describeEmissionSteps(SHIPPED_EMISSION_STEPS),
    'drop test, drop path test, budget 12',
    'and the rule it applies is the row of the table the headline is filed under',
  );
  // **§106's step is about the file, and this fixture has no test file** - so the two policies must agree here, and a
  // run that saw them differ on source paths would be reading the step as a category filter.
  assert.deepEqual(
    previousRuleKeep(ranked, 'fixture'),
    shipped,
    'the policy before §106 and the one after agree on a fixture whose paths are all source',
  );
  // **And it fires on the path, on two findings that differ only there.** The category is the same in both rows, so a
  // step that dropped on the category would drop both and one that read no path would drop neither; only a step that
  // classifies the file drops the first.
  const pathPair = [
    { path: 'tests/a.test.ts', finding: { category: 'bug' }, score: { score: 9 } },
    { path: 'src/a.ts', finding: { category: 'bug' }, score: { score: 1 } },
  ];
  const underShipped = keepUnder(SHIPPED_EMISSION_STEPS, pathPair, 'p1', undefined);
  assert.deepEqual(
    underShipped.keep,
    [false, true],
    'the finding on the test path is refused and the one on the source path is kept',
  );
  assert.deepEqual(
    underShipped.droppedByPathClass,
    [{ pathClass: 'test', count: 1 }],
    'and the artifact can say it was the class of the file that refused it',
  );
  assert.deepEqual(
    keepUnder(PREVIOUS_EMISSION_STEPS, pathPair, 'p1', undefined).keep,
    [true, true],
    'the policy before §106 keeps both, so the difference between the two rows is the step and not the pool',
  );

  const curve = topKCurve(matrix.matches, goldens.length);
  assert.deepEqual(
    curve.map((entryAt) => entryAt.truePositives),
    [1, 2, 2, 2, 3, 3],
    'the curve rises as the tail is read, and never falls',
  );

  assert.equal(exactMcNemar(6, 0) < 0.05, true, 'six discordant pairs one way is significant');
  assert.equal(exactMcNemar(0, 0), 1, 'no discordant pairs is no evidence');

  // **The pull-request arm's budget cut, on the same fixture.**
  //
  // The arm emits an ordered list per pull request and the budget keeps its head, so **the arithmetic that decides what
  // a reader sees is `topKCurve` at the budget** - and it is asserted here rather than trusted, because **a budget
  // applied to a different order than the one reported is a figure two readers cannot reproduce.**
  const armCurve = topKCurve(matrix.matches, goldens.length);
  const atBudget = (budget) => armCurve[Math.min(budget, armCurve.length) - 1];
  assert.deepEqual(
    [1, 2, 3].map((budget) => atBudget(budget)?.truePositives),
    [1, 2, 2],
    'a budget of one keeps the first finding, of two the first two, and the third adds no golden',
  );
  assert.deepEqual(
    [1, 2, 3].map((budget) => atBudget(budget)?.falsePositives),
    [0, 0, 1],
    'the third finding is the first false positive the budget buys',
  );

  // **And the paired test between the arms, which is the only comparison two arms on one corpus support.**
  //
  // The fixture's gate keeps three findings covering goldens 0 and 3; the full list covers 0, 2 and 3. So the arms agree
  // on 0 and 3, the file arm alone holds 2, and the pull-request arm alone holds nothing: one discordant pair each way
  // would be p = 1, and here it is one way only.
  const armPairing = (ours, theirs) => {
    const a = new Set(matchedGoldenIndices(ours, goldens.length));
    const b = new Set(matchedGoldenIndices(theirs, goldens.length));
    let onlyA = 0;
    let onlyB = 0;
    for (const at of a) if (!b.has(at)) onlyA += 1;
    for (const at of b) if (!a.has(at)) onlyB += 1;
    return { both: a.size - onlyA, onlyA, onlyB, pValue: exactMcNemar(onlyA, onlyB) };
  };
  assert.deepEqual(
    (({ both, onlyA, onlyB }) => ({ both, onlyA, onlyB }))(armPairing(keptMatches, matrix.matches)),
    { both: 2, onlyA: 0, onlyB: 1 },
    'the gated arm keeps two of the three goldens the full list covers and adds none of its own',
  );
  assert.equal(
    armPairing(keptMatches, matrix.matches).pValue > 0.05,
    true,
    'one discordant pair is not evidence, and the job must be able to report that',
  );

  // **The switch the registered experiment turns, proved to turn before it costs anything.**
  //
  // The comparison in §8 is between two runs of this job that differ in one environment variable. **If that variable did
  // not reach the prompt, the two runs would be the same run twice** - and the report would say the checklist made no
  // difference, which is exactly what a broken flag looks like. So the dry run asserts the three properties the two
  // runs depend on: the checklist is there when it is on, absent when it is off, and absent for a language it does not
  // carry.
  const { defectChecklist } =
    await import('../../packages/intelligence/dist/review/llm/language-rules.js');
  // **Asked for explicitly, because the shipped default is now off.** The dry run is where a change in the shipped
  // arrangement is supposed to fail first, and it did: the same call without this line returned the empty string.
  const checklistOn = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    languageChecklist: true,
  });
  const checklistOff = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/java/com/example/Ledger.java',
    changeType: 'modified',
    languageChecklist: false,
  });
  const checklistForeign = defectChecklist({
    diffContent: diff,
    filePath: 'src/main/rust/lib.rs',
    changeType: 'modified',
  });
  assert.ok(
    checklistOn.includes('Do not report when'),
    'the checklist reaches the prompt when it is on',
  );
  assert.equal(checklistOff, '', 'the switch removes the checklist entirely');
  assert.equal(
    defectChecklist({
      diffContent: diff,
      filePath: 'src/main/java/com/example/Ledger.java',
      changeType: 'modified',
    }),
    '',
    'and an unspecified switch renders nothing, which is what ships',
  );
  assert.equal(
    checklistForeign,
    '',
    'a language it does not carry gets no checklist rather than a generic one',
  );

  /**
   * **The lane set the run bought, rendered without a model.**
   *
   * R-35's device is one substitution, and the two ways it can be wrong are both invisible until the artifact is read:
   * a lane set that names a prompt this build does not carry (a stale `dist/`), and a `behaviour` prompt that quietly
   * turned into a fifth category checklist. **Both are strings**, so both are asserted here, at the cost of no calls -
   * the same rule the checklist's own block follows.
   */
  {
    const { LANE_SETS: sets, LANE_PROMPTS: prompts } =
      await import('../../packages/intelligence/dist/review/llm/prompts.js');
    const lanes = sets[LANE_SET];
    assert.equal(
      lanes.length,
      5,
      'both lane sets are five calls per file, so a pair prices a question',
    );
    for (const lane of lanes)
      assert.equal(
        typeof prompts[lane],
        'function',
        `the build carries no prompt for the ${lane} lane`,
      );
    const behaviour = prompts['behaviour']({
      diffContent: diff,
      filePath: 'src/scoring/rhythm.ts',
      changeType: 'modified',
    });
    assert.ok(
      behaviour.includes('which value, state or sequence'),
      'the behaviour lane asks for a value rather than for a category',
    );
    assert.ok(
      behaviour.includes(diff),
      'and it is shown the same diff as every other lane, which is what makes it a different question',
    );
    assert.equal(
      sets['behaviour'].filter((lane) => !sets['shipped'].includes(lane)).join(','),
      'behaviour',
      'exactly one lane is substituted, so a difference between the arms is the question and not the budget',
    );
  }

  /**
   * **The reading arm, rehearsed without a model.**
   *
   * The agent's wiring is four things that fail independently and silently: the repository the job builds, the tool
   * dispatch inside the loop, the locator that turns a quote into a line, and the account of which files were reviewed.
   * A run that gets any of them wrong produces a plausible artifact with a lower figure, which is the shape this
   * repository has paid for twelve times. **So the arm is exercised here, on a two-file fixture, with a provider whose
   * answers are written down** - the same seam the judge uses, and for the same reason.
   */
  {
    const { ReviewAgent } =
      await import('../../packages/intelligence/dist/review/agent/review-agent.js');
    const { DirectoryRepository } =
      await import('../../packages/intelligence/dist/review/agent/repository.js');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'aacr-dry-agent-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src/ledger.ts'),
        'export const rate = 1;\nexport function total(x: number) {\n  return x * rate;\n}\n',
      );
      const planted =
        'diff --git a/src/ledger.ts b/src/ledger.ts\n--- a/src/ledger.ts\n+++ b/src/ledger.ts\n@@ -1,1 +1,4 @@\n export const rate = 1;\n+export function total(x: number) {\n+  return x * rate;\n+}\n';
      const repository = new DirectoryRepository({
        root,
        changed: new Map([['src/ledger.ts', planted]]),
      });
      const script = [
        () => ({
          content: 'the multiplication ignores a null x',
          toolCalls: [
            { id: 'r1', name: 'read_file', arguments: JSON.stringify({ path: 'src/ledger.ts' }) },
          ],
        }),
        () => ({
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'file_comment',
              arguments: JSON.stringify({
                comments: [
                  {
                    path: 'src/ledger.ts',
                    content: 'x is not checked before the multiply',
                    existing_code: 'return x * rate;',
                  },
                  {
                    path: 'src/ledger.ts',
                    content: 'a quote that is not in the file',
                    existing_code: 'return x / rate;',
                  },
                ],
              }),
            },
            {
              id: 'd1',
              name: 'task_done',
              arguments: JSON.stringify({ reviewed: ['src/ledger.ts'] }),
            },
          ],
        }),
        () => ({ content: '{"remove": []}' }),
      ];
      const provider = {
        name: 'dry-run',
        model: 'dry-run',
        async complete() {
          const step = script.shift()();
          return { content: step.content, model: 'dry-run', createdAt: '', finishReason: 'stop' };
        },
        async completeWithTools(prompt) {
          const step = script.shift()();
          prompts.push(prompt);
          return {
            content: step.content,
            model: 'dry-run',
            createdAt: '',
            finishReason: 'stop',
            toolCalls: step.toolCalls,
          };
        },
        async healthCheck() {
          return true;
        },
      };
      const prompts = [];
      const outcome = await new ReviewAgent(provider, { filter: true }).review({
        repository,
        changedPaths: ['src/ledger.ts'],
      });
      assert.equal(
        outcome.comments.length,
        1,
        'the finding whose quote is in the file survives, and only it',
      );
      assert.equal(
        outcome.comments[0].startLine,
        3,
        "the quote locates the finding at its line, not at the model's guess",
      );
      assert.equal(
        outcome.comments[0].existingCode,
        'return x * rate;',
        'the quoted code travels with the finding',
      );
      assert.equal(
        outcome.drops.length,
        1,
        'the finding whose quote is absent is dropped rather than filed',
      );
      assert.equal(outcome.drops[0].reason, 'snippet-not-found', 'and the drop names its reason');
      assert.equal(
        outcome.accounts[0].status,
        'commented',
        'the file is accounted for as commented',
      );
      assert.ok(
        prompts[1].includes('TOOL read_file ->'),
        'the read reached the next round as evidence',
      );
      assert.ok(
        prompts[1].includes('    3|   return x * rate;'),
        'and it arrived with the numbers a quote can be copied from',
      );
      // **The two numbers that tell a broken loop from a quiet reviewer**, rehearsed here because the run that follows
      // this step cannot print them until it has spent an hour and a model: zero drafts over 36 pull requests is a bug
      // in this loop, and zero comments over two drafts is a bug in the locator. They are different failures.
      assert.equal(outcome.ledger.draftsFiled, 2, 'both filed drafts are counted before grounding');
      assert.equal(outcome.trace.length, 2, 'every round left a line in the trace');
      assert.ok(
        outcome.trace[0].startsWith('g1 r1: read_file |'),
        'and the trace names the round, the tools and what was said',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // **`shipped` is printed beside `gate` rather than instead of it**, because since §23.7 the two are different rules
  // for one reviewer and a log line that named only one of them would let a scoping regression pass as a gate result.
  // Under the arm, `shipped` is the full list by construction - that is the whole of §23.7 - so it is `full` read again
  // rather than a second matching.
  const shippedPoint = AGENT ? full : kept;

  // **The defect subset's arithmetic, and the idiom lane's wiring, proved here rather than after a paid run.**
  //
  // Two devices shipped together: `scoring.defectSubset` is the one figure that compares with a defect detector, and
  // `AACR_IDIOMS` is the lane that tries to answer the rest of the corpus. **Both are read from code the dry run does
  // not otherwise execute**, so a broken import or a definition that drifted would first be discovered by a run that had
  // already spent its budget on fifty pull requests.
  const { scoreDefectSubset } = await import('./lib/defect-subset.mjs');
  // **Hand-computed: 178 `bug` findings carried 51 goldens and 10 `security` carried 3, so 188 emitted, 54 carried,
  // and 54/188 is 0.2872.** The architecture row is in the input and must not reach the denominator.
  const defectShape = scoreDefectSubset({
    rows: [
      { category: 'bug', emitted: 178, truePositives: 51 },
      { category: 'security', emitted: 10, truePositives: 3 },
      { category: 'architecture', emitted: 95, truePositives: 17 },
    ],
    wholeEmissionPrecision: 0.2141,
  });
  assert.equal(
    defectShape.emitted,
    188,
    'the defect subset counts two categories, not the mixture',
  );
  assert.equal(defectShape.precision, 0.2872, 'and its precision is what those two carried');
  assert.equal(
    defectShape.wholeEmissionPrecision,
    0.2141,
    'while the headline travels beside it rather than being recomputed from the subset',
  );
  assert.equal(
    scoreDefectSubset({ rows: [] }).precision,
    null,
    'a subset that emitted nothing is unknown rather than zero everywhere',
  );

  const { detectIdioms, IDIOM_RULES } =
    await import('../../packages/intelligence/dist/review/idiom-rules.js');
  // **The lane's own wiring, on a patch built the way the harness builds one.** Every rule names the golden it came
  // from, so a rule list that came back empty is a module that failed to load rather than a corpus with nothing to say.
  assert.equal(IDIOM_RULES.length, 6, 'six rules, each derived from a golden');
  const idiomPatch = [
    '@@ -10,2 +10,4 @@ export function read(value) {',
    '  const before = value;',
    '+//   this.cache.clear();',
    '+if (value == 0) {',
  ].join('\n');
  const { numberedAddedLines } =
    await import('../../packages/intelligence/dist/review/adjudication/patch-lines.js');
  const idiomLines = numberedAddedLines(idiomPatch) ?? [];
  const idiomFindings = detectIdioms({
    path: 'src/subject.ts',
    addedLines: new Map(idiomLines.map((line) => [line.line, line.text])),
    patch: idiomPatch,
  });
  assert.deepEqual(
    idiomFindings.map((finding) => `${finding.id}@${String(finding.startLine)}`),
    ['commented-out-code@11', 'loose-equality@12'],
    "the lane reads the patch's new-side numbers: the context line is 10, so the two added lines are 11 and 12",
  );
  assert.equal(
    detectIdioms({ path: 'src/subject.ts', addedLines: new Map(), patch: idiomPatch }).length,
    0,
    'and says nothing when no line was added, which is what a context-only window is',
  );

  console.log(
    `AACR-BENCH dry run ok · full F1 ${full.f1} · shipped F1 ${shippedPoint.f1} · gate F1 ${kept.f1} · curve ${curve.map((p) => p.truePositives).join(',')} · defect P ${defectShape.precision} · idioms ${idiomFindings.length} · checklist ${checklistOn.length} chars on / ${checklistOff.length} off`,
  );
}

async function main() {
  // **The arithmetic without the model**, for a runner that has no credential and a reviewer who wants the maths checked.
  if (process.argv.includes('--dry-run')) {
    await dryRun();
    return;
  }
  /**
   * **A figure is written by the run that produced it, or it is not there at all.**
   *
   * `benchmarks/aacr-bench.json` is a tracked file: it is the figure this repository publishes. **So a run that dies
   * before `write()` leaves the *previous* run's artefact at that path**, and the upload step - which is `always()`,
   * because a skipped run still has something to say - copies it under the new arm's name. That happened on R-30: the
   * merge arm hit the 340-minute job ceiling during the review step, and published `benchmarks/aacr-bench.json` as it
   * stood in the checkout, **a figure from 2026-11-10 with F1 0.2026 that had been judged under a different device.**
   * Nothing in the pipeline could tell it apart from a result: the name matched, the schema matched, the numbers added
   * up. **A cancelled run publishing a number is worse than a cancelled run publishing nothing**, so the path is
   * cleared here, before the first request, and an upload that finds no file is the honest report.
   */
  rmSync(resolve(process.cwd(), 'benchmarks', 'aacr-bench.json'), { force: true });
  // **The arm's definition, loaded once for the whole run.** The reviewer is built from these and the artifact records
  // them, so two separate loads could only ever disagree by being two - and a figure whose configuration was resolved
  // twice is a figure that can name a configuration it did not run. Loaded after the dry-run return on purpose: the dry
  // run's job is to check arithmetic on a runner with no build, and importing the built package would make it need one.
  const { BASELINE_AGENT_OPTIONS, SHIPPED_AGENT_OPTIONS, AGENT_ARM_DIVERGENCE } =
    await import('../../packages/intelligence/dist/review/agent/review-agent.js');
  const { DEFAULT_AGENT_LIMITS } =
    await import('../../packages/intelligence/dist/review/agent/budget.js');
  const base = {
    comment: [
      'Our review engine on AACR-Bench, the corpus a direct competitor published.',
      '',
      '**Why this corpus**: 200 real PRs, 10 languages, 1,505 expert-confirmed issues and **three context levels, the',
      'third of which is Repo Level** - so **it measures cross-file behaviour, which is our distinctive claim**.',
      '',
      '**And the caveat that belongs in the artifact**: **Alibaba built both the tool and the benchmark it wins on**,',
      'and an independent party said so - *"an instrument that agrees with itself is not evidence."* **Their reported',
      'absolute precision is 33.9%**, so **their 33.90-versus-7.23 gap and their 9x token claim are their measurements',
      'on their corpus, not runs reproduced here.**',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    /**
     * **Which run wrote this file**, because a figure outlives the run that produced it and the file it lives in is
     * tracked. §58.1 is the incident: a cancelled run uploaded the previous figure under its own arm's name, and the
     * artifact had no field that could say the numbers were three weeks old. `finishedAt` is stamped by `write()` - it is
     * the field that only a run which reached the end can carry.
     */
    provenance: {
      runId: process.env['GITHUB_RUN_ID'] ?? null,
      runAttempt: process.env['GITHUB_RUN_ATTEMPT'] ?? null,
      sha: process.env['GITHUB_SHA'] ?? null,
      startedAt: new Date().toISOString(),
    },
    where: 'github-actions',
    // **Which answer key this run was scored on**, read from the job rather than written here: the runner serves two
    // corpora now, and **a field hard-coded to one of them is a field that will name the wrong one on the day it
    // matters** - which is the same defect as the workflow header that described a job nobody had written.
    corpus:
      process.env['AACR_CORPUS_LABEL'] ??
      'Alibaba-Aone/aacr-bench (Apache-2.0, public on Hugging Face)',
    judge: { model: MODEL, endpoint: BASE },
    route: 'our engine reading each PR diff; no bot account installed',
    comparisonBasis: 'their published figures, not a run we performed',
  };

  const positive = findSamples('positive_samples.json');
  const negative = findSamples('negative_samples.json');
  if (!positive) {
    write({
      ...base,
      skipped: { reason: 'positive_samples.json was not found; clone alibaba/aacr-bench' },
    });
    console.log('AACR-BENCH skipped: dataset not found');
    return;
  }
  if (!KEY) {
    write({ ...base, skipped: { reason: 'no judge credential configured' } });
    console.log('AACR-BENCH skipped: no judge credential');
    return;
  }

  // **Their real schema, read from `claude-code-demo/utils/model.py` rather than guessed.** `PRDataItem` carries
  // `githubPrUrl`, `source_commit`, `target_commit` and `comments[]`; a `Comment` carries `note` (the text), `path`,
  // `from_line`/`to_line`, `category` and `context`. **And the dataset holds no diff** - so this job fetches each PR
  // from GitHub, which **is what their own demo does** and **why the input is a URL rather than a patch.**
  const positives = JSON.parse(readFileSync(positive, 'utf8'));
  const negatives =
    negative && existsSync(negative) ? JSON.parse(readFileSync(negative, 'utf8')) : [];
  const allRows = Array.isArray(positives) ? positives : Object.values(positives);
  // **The slice a confirmation needs**: `skip` is what a previous run already saw, so the two runs' corpora are
  // disjoint by construction rather than by an argument in a document.
  const rows = allRows.slice(SKIP_PRS, SKIP_PRS + MAX_PRS);

  // **And a second reviewer, on the same ground truth, with the same judge.**
  //
  // **Why this is the step that turns a volume figure into a correctness one.** Everything measured so far in this
  // comparison has been a **count** - findings per file, comments per commit - and **a count cannot rank a reviewer**,
  // because **a tool that says everything and a tool that says only true things produce the same kind of number.**
  // **AACR-Bench supplies ground truth**, so **running a competitor on it produces an F1 that can be placed beside this
  // repository's 0.0377 on the same 1,505 annotated issues.**
  //
  // **And the mechanics are its own documented ones**: the dataset names `githubPrUrl`, `source_commit` and
  // `target_commit`, so **a checkout at those two commits is what its `review --from --to` needs** - **the same
  // three fields this repository already reads to fetch the diff.**
  /**
   * **Where the competitor's own output goes when a field cannot hold it.**
   *
   * **This constant was missing when the spill was first written, and the field reported it in one line**:
   * `firstFailure: "OUTPUTS_DIR is not defined"` - **because the spill was copied from `runnable-competitors.mjs`,
   * where the constant exists, and this file never had one.** **A name that resolves in one file and not another is
   * exactly what a copy does not tell you**, and **the reason the failure was legible is that every fallible step here
   * writes its reason into a field.**
   */
  const OUTPUTS_DIR = resolve(process.cwd(), 'benchmarks', 'runnable-competitors-outputs');

  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  /**
   * **The prose parser, written from a report that was read rather than guessed.**
   *
   * **`ocr review` has no machine-readable mode.** **`scan --json` works and `review --json` reports `unknown flag`**
   * - so **four extraction strategies over a stream containing no document all failed**, and **the only way forward
   * was to keep one whole output and read it.**
   *
   * **And the format is regular**, which is what the whole output showed:
   *
   *     Review complete: 9 finding(s) across 35 selected item(s).
   *
   *     --- src/Mod/TechDraw/App/DrawViewPart.cpp:1299-1300 ---
   *     [bug . medium] `angle` is declared uninitialized and only assigned inside the two `if` branches. ...
   *     -     double angle;
   *     +     double angle = 0.0;
   *
   * **Three shapes, one regular each**: **a header carrying the tool's own count**, **a separator carrying the file and
   * a line range**, and **a bracketed tag carrying a category and a severity**, followed by prose and **sometimes a
   * suggested diff**. **The separator uses U+2500 box-drawing characters**, which is why it is matched on the code
   * point rather than on a dash.
   *
   * **And the tool's own count is kept**, because **a parser that returns fewer findings than the tool reported is
   * indistinguishable from a tool that found fewer** - which is **the same distinction `prsFailed` draws one level
   * up, applied to a parser instead of a run.**
   */
  const REVIEW_SEPARATOR = /^\u2500{3}\s+(.+?):(\d+)-(\d+)\s+\u2500{3}$/;
  const REVIEW_TAG = /^\[([^\u00b7\]]+?)\s*\u00b7\s*([^\]]+?)\]\s*(.*)$/;
  const REVIEW_COUNT = /Review complete:\s*(\d+)\s+finding/i;

  function parseProseReport(text) {
    const lines = String(text).split(String.fromCharCode(10));
    const findings = [];
    let declaredCount = null;
    let current = null;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const countMatch = REVIEW_COUNT.exec(line);
      if (countMatch) {
        declaredCount = Number(countMatch[1]);
        continue;
      }
      const sep = REVIEW_SEPARATOR.exec(line);
      if (sep) {
        if (current) findings.push(current);
        // **A separator closes the previous finding**, so **prose that spans lines is gathered rather than truncated
        // to its first line.**
        current = {
          path: sep[1],
          startLine: Number(sep[2]),
          endLine: Number(sep[3]),
          category: null,
          severity: null,
          body: [],
        };
        continue;
      }
      if (!current) continue;
      const tag = REVIEW_TAG.exec(line);
      if (tag && current.category === null) {
        current.category = tag[1].trim();
        current.severity = tag[2].trim();
        current.body.push(tag[3]);
        continue;
      }
      // **A diff line is part of the finding**, and **a blank line ends nothing** - the next separator does.
      current.body.push(line);
    }
    if (current) findings.push(current);
    return {
      declaredCount,
      findings: findings.map((f) => ({ ...f, body: f.body.join(String.fromCharCode(10)).trim() })),
    };
  }

  /**
   * `owner/repo` from a pull request URL.
   *
   * **Split rather than matched.** The first version used a regular expression, and **the `/` inside `[^/]` ended the
   * literal early** - `SyntaxError: Unexpected token '^'` - which is **the twelfth time in this stretch that a quoted
   * pattern met text it was not written for.** **A URL has a fixed shape and `split` states that shape without an
   * escape**: `https://github.com/owner/repo/pull/123` is **five `/`-separated pieces from the scheme onward**.
   */
  /**
   * **The competitor's finding, in the shape the ranker reads.**
   *
   * **Why a translation rather than a second ranker.** The ranker is applied to both reviewers with the same rules and
   * the same weights, so **a difference between the two arms is a difference between the reviewers** - and **the only
   * thing this function may do is lose information, never add it.** Its severity tag becomes a severity, its category
   * tag becomes a category, and the suggested diff it prints inline becomes the suggestion, because that is where the
   * tool puts it.
   *
   * **A finding with no text is dropped rather than scored**, because a comment that says nothing cannot be ranked
   * above or below anything and counting it as a false positive would be counting the parser's own limitation.
   */
  const CATEGORY_NAMES = [
    'bug',
    'security',
    'performance',
    'maintainability',
    'test',
    'style',
    'documentation',
    'architecture',
    'api',
  ];

  function competitorRowOf(entry) {
    const body = String(
      typeof entry === 'string' ? entry : (entry.content ?? entry.body ?? ''),
    ).trim();
    if (body === '') return null;

    const severityTag = String(entry.severity ?? '').toLowerCase();
    const severity = severityTag.includes('critical')
      ? 'critical'
      : severityTag.includes('high') || severityTag.includes('major')
        ? 'high'
        : severityTag.includes('low') || severityTag.includes('minor')
          ? 'low'
          : 'medium';
    const categoryTag = String(entry.category ?? '').toLowerCase();
    const category = CATEGORY_NAMES.find((name) => categoryTag.includes(name)) ?? 'other';

    const lines = body.split(String.fromCharCode(10));
    const suggested = lines.filter(
      (line) => /^[+-]/.test(line.trimStart()) && !/^[+-]{3}/.test(line),
    );
    const startLine = Number(entry.startLine ?? entry.line ?? Number.NaN);
    const endLine = Number(entry.endLine ?? entry.line ?? Number.NaN);

    return {
      path: String(entry.path ?? ''),
      finding: {
        startLine: Number.isFinite(startLine) ? startLine : 0,
        endLine: Number.isFinite(endLine) ? endLine : 0,
        severity,
        category,
        title: lines[0].slice(0, 160),
        description: body,
        suggestion: suggested.length > 0 ? suggested.join(String.fromCharCode(10)) : null,
      },
    };
  }

  const shortRepo = (url) => {
    const parts = String(url ?? '').split('/');
    const at = parts.indexOf('github.com');
    return at >= 0 && parts.length > at + 2 ? `${parts[at + 1]}/${parts[at + 2]}` : null;
  };

  const { createDiff } =
    await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  /**
   * Run a competitor over one labelled pull request, and return its findings as text.
   *
   * **This function was deleted by the edit that replaced `shortRepo`**, because **it sat between that edit's two
   * markers** - **the thirteenth time in this stretch that a bulk edit matched text it was not written for, and the
   * first time it removed a definition rather than changing one.** **The job said so in one line** -
   * `AACR-BENCH failed: reviewWithOcr is not defined` - **which is what a missing binding reports.**
   *
   * **A checkout of two commits and `review --from --to`**, because **that is the interface its own documentation names
   * for a local review of a range** - and **the checkout is shallow and temporary**, because **the corpus is 200 pull
   * requests** and **a full clone per pull request is a cost this job would pay 200 times for history it never reads.**
   */
  const reviewWithOcr = (endpoint, key, url, source, target) => {
    const repo = shortRepo(url);
    if (!repo) return { ok: false, reason: 'the pull request URL did not name a repository' };
    const dir = mkdtempSync(`${tmpdir()}/ocr-`);
    try {
      // **The two commits have to share a history, and the first version made sure they did not.**
      //
      // **What the tool said, once `firstFailure` was carrying a sentence rather than nothing**:
      //
      //     [ocr] Summary: 0 file(s) reviewed, 0 comment(s), ~0 token(s) used, 0s elapsed
      //     Review failed (input): 0 finding(s); 0 of 0 selected item(s) failed.
      //
      // **`0 file(s) reviewed` and `0 of 0 selected item(s)` is a range it could not resolve** - because **two
      // independent `--depth 1` fetches produce a repository with two root commits and no merge base**, so
      // **`--from A --to B` had nothing between them.**
      //
      // **So the history is fetched without its blobs**, which is **the one shape that gives a merge base cheaply**:
      // **`--filter=blob:none` downloads every commit and no file contents**, and **the checkout then fetches only the
      // blobs that commit needs.** **A shallow fetch was cheaper and wrong; this is cheap and right.**
      execFileSync(
        'git',
        [
          'clone',
          '-q',
          '--filter=blob:none',
          '--no-checkout',
          `https://github.com/${repo}.git`,
          dir,
        ],
        {
          stdio: 'pipe',
          timeout: 600_000,
        },
      );
      execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin', source, target], {
        stdio: 'pipe',
        timeout: 300_000,
      });
      execFileSync('git', ['-C', dir, 'checkout', '-q', target], {
        stdio: 'pipe',
        timeout: 300_000,
      });
      // **`--json` is for `scan` and not for `review`, and the field said so.**
      //
      // **`firstFailure` reported `Error: unknown flag: --json` on the first run after it was fixed** - **which is what
      // a repaired reason field buys**: **the next iteration gets a sentence instead of a guess.** **`scan --json`
      // works, because that is where this project already succeeded**; **`review` does not take it.**
      //
      // **And the default output is kept rather than parsed blind**, because **the shape of `review`'s output has not
      // been seen yet** - **so the raw text travels in the artifact, and the next iteration reads the shape instead of
      // assuming one**, which is **the fifth time in this stretch that a shape was learned rather than guessed.**
      const stdout = execFileSync('ocr', ['review', '--from', source, '--to', target], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
        env: { ...process.env, OCR_LLM_URL: endpoint, OCR_LLM_TOKEN: key },
      });
      // **And the output is spilled to a file, because its format has never been seen.**
      //
      // **Four extraction strategies were tried and all four failed**, and **the last one's error was the informative
      // one**: `Unexpected token 'R', "Review com"…` - **the output is prose, and there is no JSON anywhere in it.**
      // **`--json` is accepted by `scan` and rejected by `review`**, so **this subcommand has no machine-readable
      // mode**, and **the only way to learn its format is to keep one whole** - **which is what
      // `firstOutputHead`'s six hundred characters could not do.**
      mkdirSync(OUTPUTS_DIR, { recursive: true });
      const spilled = join(
        OUTPUTS_DIR,
        `open-code-review-review-${String(source).slice(0, 8)}.txt`,
      );
      writeFileSync(spilled, stdout);
      return { ok: true, stdout, outputFile: spilled };
    } catch (error) {
      // **Both streams, because the reason can be in either.** **A tool that fails silently on stdout and explains
      // itself on stderr is the common case**, and **the first version read only the first of the two.**
      const out = String(error.stdout ?? '').trim();
      const err = String(error.stderr ?? '').trim();
      const message = String(error.message ?? '').trim();
      const reason = out || err || message || '';
      return {
        ok: false,
        reason: reason.slice(0, 600),
        status: typeof error.status === 'number' ? error.status : null,
        signal: error.signal ?? null,
      };
    }
  };

  const { LLMReviewEngine } =
    await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  // **The lane set comes from the module that owns it**, so the list a run puts to a diff and the list a test asserts on
  // are one list. A copy here would drift, and the artifact would name a question whose sentence nobody could find.
  const { LANE_SETS } = await import('../../packages/intelligence/dist/review/llm/prompts.js');
  /**
   * **The graph, imported rather than re-implemented** (§101). The walk, the caps and the note are the package's, so the
   * line this run puts in a prompt is the line the product will put in one - **a harness with its own copy of a device
   * measures the copy.**
   */
  const { readRepoFiles } = REACH
    ? await import('../../packages/intelligence/dist/review/index/repo-files.js')
    : {};
  const { buildRepoIndex } = REACH
    ? await import('../../packages/intelligence/dist/review/index/repo-index.js')
    : {};
  const { reachNoteOf, reachLine } = REACH
    ? await import('../../packages/intelligence/dist/review/index/cross-file.js')
    : {};
  /**
   * **One index, held for one pull request.**
   *
   * This was a `Map` keyed by head commit and never evicted, on the argument that *two pull requests can share a commit
   * and a rebuild would be the same answer* - which is true and is not what the map was doing: **it kept every index the
   * run had ever built, and the loop reviews one pull request at a time.** The fifty-pull-request confirmation of R-44
   * died of it at 4 055 MB of heap (§105.1), and the fourteen-pull-request run of the same code passed.
   *
   * **The smaller cache trades seconds for gigabytes**, and the trade is counted in `reach.indexEvictions` so the
   * artifact shows the bound was reached instead of asserting it.
   */
  const reachIndexes = createOneIndexCache();
  /** The index the lane's `reach` closure reads, and `null` whenever this pull request has none. */
  let reachIndex = null;
  const {
    ACTIONABILITY_WEIGHTS,
    collectDiffFacts,
    goldenOwners,
    matchedGoldenIndices,
    maximumMatchingCount,
    point,
    rankFindings,
    scoreSubset,
    topKCurve,
  } = await import('../../packages/intelligence/dist/review/actionability.js');
  // **The profile's own module, imported where it is used rather than at the top**, because the top of this file runs
  // in `--dry-run` too and `dist/` is only guaranteed to exist after a build.
  const { applyEmissionProfile } =
    await import('../../packages/intelligence/dist/review/category-prior.js');
  const { DeepSeekProvider } =
    await import('../../packages/intelligence/dist/review/llm/provider.js');
  // **The rule names come from the module, not from a list repeated here.** A run that recorded a hand-written list of
  // rules would keep reporting a rule after it had been deleted, and **the artifact is the place a reader checks which
  // rules produced the figure.**
  const { IDIOM_RULES } = await import('../../packages/intelligence/dist/review/idiom-rules.js');
  const IDIOM_RULE_NAMES = IDIOM_RULES.map((rule) => rule.id);
  // **The remark families, read from the module for the same reason the rule names are**: an artifact that carried a
  // hand-written list would keep naming a family after the prompt stopped asking for it.
  const { REMARK_FAMILIES, REMARKS_PER_FILE_CEILING } =
    await import('../../packages/intelligence/dist/review/remark-lane.js');
  const REMARK_FAMILY_IDS = REMARK_FAMILIES.map((family) => family.id);
  // **And the defect subset's arithmetic, from the module a test can reach**, so the figure in the artifact and the
  // figure in the test come from one implementation rather than from two that agree today.
  const { scoreDefectSubset } = await import('./lib/defect-subset.mjs');
  // **The ledger, and the ceiling that stops a runaway job.** The balance reading below says what the *account* spent
  // between two moments; **this says which lane spent it, and refuses the next call once the job has spent what it was
  // allowed.** The default is a bound the observed job fits inside: a 14-pull-request run with both arms moved the
  // balance by 62.82 CNY on 2026-11-09, which is about 8.9 USD at 7.1 - so 12 USD admits a legitimate run and stops a
  // retry storm at roughly one and a third of it. **A ceiling set below the cost of a valid run would be a ceiling that
  // measures the ceiling.**
  const { CostLedger, costUsdOf } =
    await import('../../packages/intelligence/dist/review/llm/cost.js');
  const ledger = new CostLedger();
  // **The ceiling is a rate over the corpus this run was asked to read, not a constant**, because the constant was
  // written for fourteen pull requests and a larger dispatch would have been admitted by a bound that was never about
  // it. The arithmetic and its margins live in `lib/run-config.mjs`, where a test can reach them; **an override still
  // wins, and the artifact records the number the run was bounded by** so that a deliberate one-off is visible in the
  // data rather than in a memory of the dispatch.
  const MAX_USD = spendCeilingUsd({
    pullRequests: MAX_PRS,
    mode: COMPETITOR_CHOICE.mode,
    override: process.env['AACR_MAX_USD'],
    // **The arm's own rate**, because an agent reading a checkout is not five lanes reading a diff and a ceiling written
    // for one of them would stop the other halfway.
    agent: AGENT,
    // **Which arm reviewed**, in the field the confound guard reads: `ensemble` on means both reviewers ran and the merge
    // decided, so a pair that varies it varies one device. **Spelled `AGENT && ENSEMBLE` rather than
    // `mergeCounters.enabled`** because this literal is built before the counters exist, and a value read from a binding
    // in its temporal dead zone is a crash rather than a figure.
    ensemble: AGENT ? ENSEMBLE_SETTING : false,
  });
  // **The dedup threshold is a parameter now, and this run takes the next point on its curve.**
  //
  // **At 0.6 the merge removed 360 of 488 findings, raised precision 2.3 times and lowered recall from 0.56 to 0.36** -
  // **ten true positives were merged with neighbours that shared most of their vocabulary.** **So 0.6 over-merges, and
  // the cheapest next measurement is the same run at a higher threshold**: **0.8 requires four fifths of the content
  // words to agree, so a genuinely different defect in the adjacent line survives.**
  const DEDUP_THRESHOLD = Number(process.env['AACR_DEDUP_THRESHOLD'] ?? 0.8);
  /**
   * **Whether a finding's claim is checked before it is filed**, and the arm this dispatch exists to measure.
   *
   * The diagnosis it comes from is in the published artifact, in two rows: **302 false positives against 160 accepted**,
   * whose largest block is comments that assert nothing about the code, and **141 goldens missed by a comment standing
   * on the golden's own line**. Neither is a targeting failure and neither is repaired by wording - **one needs a reader
   * that asks "is this true", the other needs one that asks "what is true here"** - which is
   * `packages/intelligence/src/review/adjudication/`.
   *
   * **It is an input rather than an edit for the reason every device in this repository is**: `off` is the configuration
   * every published figure was measured under, so an arm that cannot be switched off cannot be measured against them.
   */
  const ADJUDICATE_MODE = String(process.env['AACR_ADJUDICATE'] ?? 'off').toLowerCase();
  const ADJUDICATE = ADJUDICATE_MODE === 'on';
  /**
   * **Whether the independent gate runs, and it is the same switch with a third value rather than a second switch.**
   *
   * `AACR_ADJUDICATE=falsifier` is R-36's arm. **It is not a fourth input** because the two devices are two forms of one
   * question - *does a second reader agree with this sentence* - and a run is only comparable with the next one if the
   * field that already answers that question says which form produced it. **A gate that kept the field and changed its
   * meaning would be the defect §44's artifact recorded twice.**
   *
   * What separates the forms is the contract, not the model: `on` asks once per finding and trusts the answer's reason,
   * `falsifier` asks **once per file**, keeps by default, and **applies a removal only when the reader quotes a line the
   * diff added** - so a reader that invents refutations costs an unchanged pool rather than a silent reviewer.
   */
  /**
   * **The value is the contract, and §74 is the reason it is not a boolean.**
   *
   * The first gate's artifact recorded `falsifier: true` and `contract: 'quoted-falsifier-v1'` from a constant in this
   * file rather than from the device, so the number could not say which rules produced it - and the next contract would
   * have written the same string. **A field whose value is a constant of the writer is a field that cannot record a
   * change.** It now records what the gate itself reported for the last file it read, which is the only value that can
   * differ between the two arms.
   */
  const { buildSymbolIndex } =
    await import('../../packages/intelligence/dist/review/index/symbols.js');
  const FALSIFY =
    ADJUDICATE_MODE === 'falsifier'
      ? 'quoted-falsifier-v1'
      : ADJUDICATE_MODE === 'falsifier-v2'
        ? 'independent-evidence-v2'
        : ADJUDICATE_MODE === 'falsifier-v3'
          ? 'independent-evidence-v3'
          : ADJUDICATE_MODE === 'falsifier-v4'
            ? 'independent-evidence-v4'
            : false;
  /**
   * **`v3` reads the file, so the run fetches it whether or not the code-context arm was asked for.**
   *
   * **The alternative was a contract that silently degrades**: `v3` with no surrounding text is `v2` with a different
   * name in the artifact, and a figure that says `independent-evidence-v3` while measuring `v2` is the §74 defect one
   * device later - a field that cannot record a change. So the fetch is owned by the contract rather than by the other
   * arm's switch, and the two arms of this pair differ in one field: the gate.
   */
  // **`v4` needs the same fetch `v3` does, and for a stronger reason**: it builds an index out of the file rather than a
  // window, so a run without the text would reach the gate with no second block at all.
  const NEEDS_FILE_TEXT =
    FALSIFY === 'independent-evidence-v3' || FALSIFY === 'independent-evidence-v4';
  /**
   * **The file text of the pull request being reviewed, read by the gate through a closure.**
   *
   * The engine is constructed once and the corpus runs serially through it, so one binding is enough - and binding it
   * rather than passing it keeps `LLMReviewEngine` free of a transport, which is the property that lets the engine be
   * tested without a network.
   */
  let fileTextsForGate = new Map();
  // **The same per-pull-request binding for the shape**, cleared with it so a path from the previous pull request cannot
  // answer a question about this one.
  let shapeLinesForGate = new Map();
  /**
   * **The files whose entire diff is a re-indent**, and the only ones a lane may be skipped for.
   *
   * The skip is not an optimisation that trades recall for money: a gate told this file's `allowedLines` is empty drops
   * **every** finding in it, so the lane calls it would have taken produce nothing that can survive. Skipping them is
   * outcome-identical and the saving is the calls themselves - 5 per file, and on the 30-pull-request reading of
   * `pair: change-shape` the shape counter saw 87 files whose every hunk was non-substantive.
   *
   * **Only `whitespaceOnly`, not `noneSubstantive`.** A comment edit is text somebody wrote and a relocation is code
   * that moved; both can be reviewed, and neither is skipped.
   *
   * **Declared without an initial value, because both branches below assign one** and CodeQL is right that a fresh `Set`
   * here is written and thrown away. The type annotation is what keeps it honest: a branch that forgot to assign would
   * be a compile error rather than an empty set that skips nothing.
   *
   * @type {Set<string>}
   */
  let whitespaceOnlyForGate;
  /**
   * **Whether the deterministic idiom lane runs beside the five model lanes.**
   *
   * The measurement it comes from is in `rejectedGoldens`: of fifty sampled goldens the file arm missed, **forty-one
   * describe a remark the lanes never attempt** - `const auto&` on a variable that is only read, a `2.0` that should be
   * `2.0f`, a commented-out `Fill(0.0)`, an `async` with nothing to await. **The two reviewers are not disagreeing
   * about the same question; they are answering different ones**, which is why two prompt contracts and a stated
   * line-number window did not move the figure.
   *
   * **Off is the configuration every published figure was measured under**, so an arm cannot be compared with them
   * unless it can be turned off - and the artifact records which side of the switch produced its numbers.
   */
  const IDIOMS = String(process.env['AACR_IDIOMS'] ?? 'off').toLowerCase() === 'on';
  /**
   * **Whether the model-driven remark pass runs beside the five lanes, and it is the device R-25 registers.**
   *
   * R-21 measured the six deterministic rules at **+0.0148 against a registered +0.02** - the right direction and short
   * of the bar - and §47.1 says why a rule list cannot get there: **the bucket is a vocabulary, not six constructs**.
   * This switch buys one call per file whose contract is the remark families in `remark-lane.ts`, each naming the golden
   * or the count it came from, with the patch's added lines as the only place it may speak.
   *
   * **Off by default**, because every published figure here was measured with the five lanes and a switch that cannot be
   * turned off cannot be compared with them.
   */
  const REMARKS = String(process.env['AACR_REMARKS'] ?? 'off').toLowerCase() === 'on';
  /**
   * **Whether a finding of a different category is a second concern at a site rather than a duplicate of it (§59).**
   *
   * The run of 2026-11-16 merged **2 273 of its 2 295 removals under the range rule alone** - overlapping ranges with no
   * textual agreement behind the merge - and **276 of its 455 rejected goldens sat on a line it had commented on**.
   * `electron#47361` carries two defects on one line, and **a reviewer that says one true thing per site loses the
   * second every time.** The switch keeps one extra finding per site when the category differs, and nothing else.
   *
   * **Off by default**, because every published lane figure was measured with the range rule merging unconditionally -
   * and **a device that cannot be switched off cannot be compared with them.**
   */
  const SECOND_CONCERN = String(process.env['AACR_SECOND_CONCERN'] ?? 'off').toLowerCase() === 'on';
  /**
   * **Which question the lanes put to a diff, and the device R-35 registers (§69.5).**
   *
   * `shipped` is the five lanes every published figure was measured under. `behaviour` swaps one of them - `testing`,
   * which reaches this corpus's question 8.6 % of the time at precision 0.111 and whose own removal gains 0.0069 F1 -
   * for a lane asked for the value that breaks a changed line rather than for a category of improvement.
   *
   * **A substitution and not an addition**, because the claim is about the question and not about the budget: five
   * calls per file either way, so a difference between the arms is what the lanes were asked and not how many of them
   * there were. **And it is an input rather than an edit**, because every figure in `EVAL-CONTRACT.md` was measured
   * under `shipped` and a lane set that cannot be switched off re-prices all of them.
   *
   * **The reader of this value is the engine's `lanes` option** - this constant is the name the artifact carries, and
   * `LANE_SETS` is where the list itself lives, so a run and its artifact cannot disagree about which question ran.
   */
  // **`LANE_SET` is read at module scope with `PROFILE`**, so that `--dry-run` refuses an unrecognised value as well:
  // a run whose first refusal arrives after the corpus is cloned has already paid to discover a typo.
  /**
   * **How many refusals the artifact carries, and why it is not all of them.**
   *
   * A corpus of fifty pull requests refuses about five hundred comments, and five hundred rows in one field would make
   * the artifact a log file that nobody diffs. **Sixty is enough to read the distribution by hand**, which is the only
   * use this field has: the question it answers - *is the reader too strict, or is it looking at a line it cannot see?* -
   * is answered by sixty sentences and not by six hundred, and `refusedTotal` beside it keeps the sample honest about
   * what fraction of the population it is.
   */
  const ADJUDICATION_REFUSAL_SAMPLES = 60;
  /**
   * **Every refusal, in the order the corpus produced them, and the sample is taken from it at the end.**
   *
   * Taking the first sixty as they arrive would be **the first sixty of the first six pull requests**, which is a sample
   * of six repositories reported as a sample of fifty - and a distribution read off it would be a distribution of the
   * alphabet. The stride below spreads the same sixty across the whole run, and the field says how it was drawn.
   */
  const refusalsSeen = [];
  /**
   * **Every claim the gate removed, in corpus order, sampled at the end for the same reason the refusals are.**
   *
   * A reader looking at this list is asking one question - *is the gate removing sentences that were wrong, or sentences
   * it could quote a line against* - and the second answer reads as the first in every total. **The quote is carried
   * with the removal** because it is the only field that lets a reader check the check.
   */
  const falsifierDropsSeen = [];
  /** How many of them the artifact keeps: enough to read the pattern, few enough to open. */
  const FALSIFIER_DROP_SAMPLES = 80;
  const engine = new LLMReviewEngine(new DeepSeekProvider({ ledger, ceilingUsd: MAX_USD }), {
    dedupThreshold: DEDUP_THRESHOLD,
    languageChecklist: CHECKLIST,
    promptOrder: PROMPT_ORDER,
    adjudicate: ADJUDICATE,
    falsify: FALSIFY,
    // **Only `v3` reads this**, and it returns `undefined` for every other contract - so a file fetched for the code
    // context arm is not silently promoted into evidence for a gate that was never asked to use it.
    /**
     * **The graph, handed to the lane as one line per file** (§100), **and `null` when the arm is off or the checkout
     * failed** - the engine treats `null` as *no note* and omits the section, so the off-arm's prompt is byte-identical
     * to the prompt every published figure was measured on.
     */
    reach: (path) => {
      if (reachIndex === null) return null;
      const note = reachNoteOf(reachIndex, path);
      if (note === null) {
        reachCounters.filesWithoutNote += 1;
        return null;
      }
      reachCounters.notesServed += 1;
      reachCounters.chars += reachLine(note).length;
      return note;
    },
    surroundingOf: (path) => fileTextsForGate.get(path),
    /**
     * **The file read as structure, for `independent-evidence-v4`** (§80). Built per file from the text the fetch already
     * paid for - no call, no token, and the same 600 characters whether the file is forty lines or four thousand. A path
     * the fetch did not reach returns `undefined`, and `v4` then degrades to the window rather than to a gate with no
     * evidence beyond the hunk.
     */
    fileIndexOf: (path) => {
      const text = fileTextsForGate.get(path);
      return typeof text === 'string' ? buildSymbolIndex(path, text) : undefined;
    },
    touchedLinesOf: (path) => shapeLinesForGate.get(path),
    idioms: IDIOMS,
    remarks: REMARKS,
    secondConcern: SECOND_CONCERN,
    // **The lanes are named, not defaulted**, so the artifact's `laneSet` and the calls the run actually bought are the
    // same five questions. A run that recorded a set and dispatched the engine's default would be the §58.1 shape one
    // device later: an artifact internally consistent and about a different reviewer.
    lanes: [...LANE_SETS[LANE_SET]],
    // **The shape of the calls, beside the questions they ask**: a run that recorded five lanes and sent one call would
    // be an artifact about a reviewer nobody dispatched.
    laneMode: LANE_MODE,
  });
  console.log(
    `AACR-BENCH dedup threshold ${DEDUP_THRESHOLD} · prompt order ${PROMPT_ORDER} · adjudicate ${ADJUDICATE} · idioms ${IDIOMS} · remarks ${REMARKS} · second concern ${SECOND_CONCERN} · lanes ${LANE_SET} (${LANE_MODE})`,
  );

  /**
   * **The second parameter of every draw this job takes.**
   *
   * **Why a credit reading belongs in the artifact.** **Five runs of this script on one corpus produced F1 values of
   * 0.0377, 0, 0.1724, 0.037 and 0**, and **the run that got furthest reported `402 Payment Required` with
   * `Insufficient Balance`** - so **the engine, the judge and the competitor all spend from one key**, and **a balance
   * that runs out mid-run lowers recall in a way indistinguishable from a worse reviewer.**
   *
   * **`GET /user/balance` is the provider's own reading of that**, so **it is taken before the loop and after it**,
   * and **both are stored** - because **a figure that moved while the account moved is a figure with a second
   * parameter, and the parameter belongs in the same file as the figure.**
   */
  const creditPosition = async () => {
    const key = process.env['DEEPSEEK_API_KEY'] ?? process.env['MARTIAN_API_KEY'] ?? '';
    if (!key) return { probed: false, reason: 'no key in the environment' };
    try {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // **A balance endpoint that refuses is itself the reading** - `402` here means the same thing it means on a
        // completion call, and **it arrives before any work is done**.
        return { probed: true, ok: false, status: response.status, body: body.slice(0, 240) };
      }
      const payload = await response.json();
      const info = Array.isArray(payload?.balance_infos) ? payload.balance_infos[0] : null;
      return {
        probed: true,
        ok: true,
        isAvailable: payload?.is_available ?? null,
        currency: info?.currency ?? null,
        totalBalance: info?.total_balance ?? null,
        grantedBalance: info?.granted_balance ?? null,
        toppedUpBalance: info?.topped_up_balance ?? null,
      };
    } catch (error) {
      return { probed: true, ok: false, reason: String(error.message ?? '').slice(0, 240) };
    }
  };

  const creditBefore = await creditPosition();
  console.log(`AACR-BENCH credit before: ${JSON.stringify(creditBefore).slice(0, 200)}`);

  // **The engine's counters belong to the engine.** **The first version wrote them onto `competitor`, which is the
  // other reviewer's record, so the artifact reported 199 files under the competitor's name** - **a unit-of-attribution
  // defect in the file that exists to attribute.**
  /**
   * **What the graph cost and what it was asked**, and the split exists for the same reason every other counter here
   * does: a run whose `notesServed` is zero is a run without the device, and one whose `noCheckout` is fourteen is a run
   * whose clones failed - **those two produce the same F1 and need opposite repairs.**
   */
  const reachCounters = REACH
    ? {
        enabled: true,
        pullsWithIndex: 0,
        indexBuilds: 0,
        /**
         * **The commits dropped so that the run could hold one index** (§105.1). A run whose evictions equal its builds
         * minus one never held two, which is the check the artifact exists to make possible.
         */
        indexEvictions: 0,
        /** Working trees deleted for the same reason, because a clone is a directory and a runner's disk is fixed. */
        checkoutsPruned: 0,
        filesIndexed: 0,
        indexMs: 0,
        noCheckout: 0,
        notesServed: 0,
        filesWithoutNote: 0,
        chars: 0,
        firstFailure: null,
      }
    : { enabled: false };

  const engineCounters = {
    filesReviewed: 0,
    emptyDiffs: 0,
    fileFailures: 0,
    firstFileFailure: null,
    laneStats: null,
    /**
     * **What §106's path-class step removed, by class**, summed over the corpus.
     *
     * **A count and not a silent filter**, because the step drops findings whose category the policy keeps: without this
     * number, a reader comparing the new headline against an old one would be comparing two pools and calling the
     * difference a device.
     */
    emissionPathDrops: {},
    // **What the remark pass kept and what its two rails removed**, summed over the corpus, because **a pass that filed
    // nothing is two different findings depending on which rail fired**: a model that said nothing about a clean diff is
    // the device working, and a rail that refused every line it named is the device measuring its own prompt.
    remarks: REMARKS
      ? { enabled: true, kept: 0, notAddedLine: 0, capped: 0, notAPatch: 0, files: 0 }
      : { enabled: false },
    // **What the category profile removed and why**, filled during the loop and published beside the figure, because
    // **a precision that rose because two thirds of the emission left is a different claim from one that rose because
    // the findings got better**, and only the count can tell them apart.
    profile: { name: PROFILE, dropped: {}, reasons: {} },
    // **What the code-context retrieval asked for and what it got**, filled during the loop: **a window that is missing
    // in half the files is a device measured at half strength**, and a run that could not say so would publish the
    // half-strength number as the device's own.
    /**
     * **The fetch counters exist whenever a file is fetched, which is not the same as whenever the window is on.**
     *
     * `v3` and `v4` read the file for the gate, so a run with `AACR_CODE_CONTEXT=off` still fetches every changed file -
     * and until this line said `CODE_CONTEXT || NEEDS_FILE_TEXT` the counters were `{ enabled: false }`, so the first
     * page that failed to fetch wrote `reasons.length` onto an object with no `reasons` and **the run died 35 minutes in
     * with `Cannot read properties of undefined (reading 'length')`**.
     *
     * **`enabled` still means the window**, because that is the arm the figure is compared by; the fields beside it mean
     * *a file was fetched*, and a run can have one without the other.
     */
    codeContext:
      CODE_CONTEXT || NEEDS_FILE_TEXT || REACH
        ? {
            enabled: CODE_CONTEXT,
            requested: 0,
            read: 0,
            absent: 0,
            failed: 0,
            chars: 0,
            reasons: [],
          }
        : { enabled: false },
    /**
     * **Whether each golden's file is still one the pull request touches**, which is a fact about the corpus and not
     * about the review.
     *
     * `requested` counts the pull requests whose file list was asked for, `failed` the ones where no answer came and the
     * older bucket therefore stands, and `moved` the goldens that landed in `pathNotInPull`. **The three numbers are
     * published because the alternative is a recall figure whose denominator nobody can check**: a corpus pinned to
     * snapshots of moving objects will always have some rows no reviewer can answer, and the honest artifact says how
     * many rather than letting them read as findings we failed to make.
     */
    snapshot: { requested: 0, ok: 0, failed: 0, moved: 0, reasons: [] },
    /**
     * **What the claim check did to the findings, summed over the corpus.**
     *
     * **Four counts and not one**, because they answer four different questions and only the split can say which device
     * earned a figure: `refuted` and `unanchored` are comments removed (a precision claim), `repaired` is a comment
     * rewritten (the only one that can raise recall as well), and `unchecked` is a call that did not happen - **a run
     * whose `unchecked` is not zero describes a reviewer without this device for that part of the corpus**, which is the
     * distinction a single "kept" count would erase.
     */
    adjudication: ADJUDICATE
      ? {
          enabled: true,
          /**
           * **Which contract the reader was asked under, because "adjudicate: on" is not a device.**
           *
           * §44's run and §45's run both wrote `adjudicate: true` and they are not the same experiment: the first showed
           * the reader a whole patch with no line numbers and never said which line the comment was on, the second shows
           * the numbered lines around that line and names it. **An artifact that cannot say which prompt produced it is an
           * artifact that cannot be compared with the next one**, and the cost of finding that out is one run.
           */
          contract: 'numbered-window-v1',
          candidates: 0,
          upheld: 0,
          repaired: 0,
          refuted: 0,
          unanchored: 0,
          unchecked: 0,
          unreadable: 0,
          narrationRefused: {},
          /**
           * **Every comment the pass removed, with the reader's own sentence for removing it.**
           *
           * The counts above say *"494 refuted"*, and a count answers no question anyone asks next: **whether the reader
           * was too strict or was looking at a line it could not see is a fact about the reasons, not about the
           * totals**, and without them the next iteration is a guess bought at the price of a corpus run. Bounded,
           * because an artifact is a thing people open.
           */
          refused: [],
          refusedTotal: 0,
        }
      : { enabled: false },
    /**
     * **What the independent gate did, summed over the corpus, in the counters its registration is stated in.**
     *
     * `candidates` is the pool it was shown and `dropped` the part it removed with a verified quote; **the number that
     * decides whether the device is working is `keptBecauseQuoteMissing`** - a reader that refutes twenty claims and can
     * quote a line for none of them is a reader guessing, and a gate with no such counter cannot tell that from a gate
     * that found nothing. `notAPatch` counts files whose text carried no quotable line, because a file the gate could
     * not read is not a file it cleared.
     */
    falsifier: FALSIFY
      ? {
          enabled: true,
          /**
           * **Which contract the gate was asked under**, for the reason `adjudication.contract` exists one device over:
           * a quote-verified, keep-by-default gate and a reason-trusting, per-finding adjudicator both wrote
           * `adjudicate: true` for as long as the field had two values, and **a figure that cannot say which contract
           * produced it is a figure the next run can contradict without being wrong.**
           */
          // **Left empty until the gate answers**, and written from `report.contract` on the first file it reads: a
          // default here would be a second source of truth for the same fact.
          contract: null,
          candidates: 0,
          dropped: 0,
          keptBecauseQuoteMissing: 0,
          keptBecauseSelfReferential: 0,
          /**
           * **Claims the diff refuted before a reader was paid to look at them** (§79). Kept apart from `dropped` for
           * the reason `keptBecauseSelfReferential` is kept apart from `keptBecauseQuoteMissing`: the two removals are
           * different devices with the same effect on F1, and only this one costs nothing.
           */
          droppedBecauseUntouched: 0,
          untouchedFrom: { wholeFile: 0, offTheChange: 0 },
          /**
           * **What the classifier saw**, so a run that bought nothing can say whether the corpus had non-substantive
           * hunks at all - a device that never fired and a device that fired and changed nothing are opposite facts,
           * and `droppedBecauseUntouched` alone cannot tell them apart.
           */
          shape: {
            hunks: 0,
            noneSubstantive: 0,
            whitespaceOnly: 0,
            /**
             * **Files whose five lanes were never called**, because every hunk in them was whitespace and the gate
             * would have refuted every finding in them. **Counted rather than inferred from the bill**, so a later
             * reading can subtract this run's spend from a run without the skip and hold the difference to it.
             */
            skippedFiles: 0,
            novelLines: 0,
            allowedLines: 0,
          },
          unreadable: 0,
          notAsked: 0,
          notAPatch: 0,
          calls: 0,
          droppedFindings: [],
        }
      : { enabled: false },
  };
  /**
   * **What the agent arm spent and what it decided**, per pull request.
   *
   * The three numbers that matter are not the cost: **how many changed files it never accounted for** (the 31 goldens we
   * missed on files nobody opened), **how many findings it withheld because the quote was not in the file** (the
   * competitor's resolver, made countable), and **how many the filter removed** - because a reviewer that improves by
   * removing its own output is a different claim from one that improves by reading.
   */
  /**
   * **What the merge decided, per pull request, so the figure beside the headline can say which path produced it.**
   *
   * Three paths can decide a merge - no call needed, the model's answer, or the fallback - and **a run that reported only
   * the score would be unable to distinguish a merge that worked from a fallback that quietly replaced it**.
   */
  const mergeCounters = {
    enabled: ENSEMBLE && AGENT,
    pulls: 0,
    calls: 0,
    paths: { budget: 0, model: 0, fallback: 0 },
    kept: 0,
    candidates: 0,
    /**
     * **What each side of the union contributed, because "the merge ran" is not the claim the registration makes.**
     *
     * R-29 was registered as a merge of the five lanes and the reading reviewer, and it ran with the lanes emptied by an
     * upstream cost rule - so the artifact could not be read to say whether the union existed, and `candidates` alone
     * could not tell one reviewer's 394 from two reviewers' 800. **`unionPulls` counts the pull requests where both
     * sides were non-empty**, which is the only number that says a merge happened at all: a merge of one list and
     * nothing is a sort.
     */
    sides: { lanes: 0, reader: 0 },
    unionPulls: 0,
    dropped: { duplicate: 0, 'over-budget': 0, 'not-kept': 0, 'unknown-ref': 0 },
    fallbackReasons: [],
    firstFailure: null,
  };
  const agentCounters = {
    enabled: AGENT,
    pulls: 0,
    modelCalls: 0,
    toolCalls: 0,
    readChars: 0,
    checkoutFailures: 0,
    firstCheckoutFailure: null,
    groundingReads: 0,
    disambiguated: 0,
    filtered: 0,
    draftsFiled: 0,
    drops: {},
    accounts: { commented: 0, 'reviewed-clean': 0, skipped: 0, unaccounted: 0 },
    unaccountedPaths: [],
    /**
     * **One line per round, capped**, so the artifact can answer *why* an arm filed nothing.
     *
     * The first run of this arm produced F1 0 with `draftsFiled: 0`, and the artifact could not distinguish a model that
     * could not call the tool from one that never reached the round where it would have. A benchmark that records the
     * score and not the reason a score is zero is a benchmark that cannot be debugged from its own output.
     */
    trace: [],
    firstFailure: null,
  };
  const ocrKey = process.env['OCR_LLM_TOKEN'] ?? process.env['DEEPSEEK_API_KEY'] ?? '';
  /**
   * **The competitor arm is a recorded input, and its default is the cheap side of the choice.**
   *
   * **The arithmetic that made this the next fix**: the run of 2026-11-10 cost 8.53 USD, of which **5.89 USD - 69 % -
   * was this arm**, driven through the competitor's CLI from the same key, over fourteen pull requests whose goldens had
   * not changed. **Its figure is a property of the corpus, not of this project's code** - it does not move when a prompt
   * does - so buying it on every run is buying the same number twice.
   *
   * **`replay` is the default and `record` is a decision someone makes**, because the two mistakes are not symmetric:
   * a stale replay is a wrong figure, a stray record is a bill. **A missing record is reported and excluded**, never
   * repaired by buying one - `competitor.missing` carries the reason into the artifact.
   */
  const COMPETITOR_BASELINE_PATH = resolve(
    process.env['AACR_COMPETITOR_BASELINE'] ?? DEFAULT_BASELINE_PATH,
  );
  const competitorChoice = COMPETITOR_CHOICE;
  const corpusFingerprintOfRun = corpusFingerprint(rows);
  // **A file of another version throws here rather than being read as if the shape had not changed**, which is the
  // one failure this run should not paper over: every row below it is only meaningful under the shape it was written in.
  const existingBaseline = readBaseline(COMPETITOR_BASELINE_PATH);
  let competitorBaseline =
    competitorChoice.mode === 'record'
      ? startRecording({
          existing: existingBaseline,
          fingerprint: corpusFingerprintOfRun,
          judgeModel: MODEL,
          tool: 'open-code-review',
        })
      : existingBaseline;
  /** The rows this run paid for, written once at the end - so a run that dies mid-loop leaves the old file intact. */
  let recordedAny = 0;
  const competitor = {
    tool: 'open-code-review',
    // **What this run did with the arm, and why** - the three figures a reader needs to price the run without reading
    // the code: which mode was asked for, how many pull requests were replayed, and how many the record could not answer.
    mode: competitorChoice.mode,
    modeReason: competitorChoice.reason,
    replayed: 0,
    recorded: 0,
    // **How each replayed row was checked**, because a row transcribed before per-pull fingerprints existed can only be
    // checked by its golden count - and **a figure resting on fourteen count-checked rows is a different figure from one
    // resting on fourteen fingerprint-checked rows**, even though both are called "replayed".
    verifiedBy: { fingerprint: 0, count: 0 },
    missing: [],
    baselinePath: competitorChoice.mode === 'record' ? COMPETITOR_BASELINE_PATH : null,
    prsAttempted: 0,
    prsFailed: 0,
    // **The pull requests it failed on, named**, because **a count of failures in a head-to-head is a number a reader
    // cannot check** - and because the one failure of 2026-11-09 was scored as a non-event for a whole iteration
    // precisely because nothing in this object said which pull request it was.
    failedPullRequests: [],
    firstFailure: null,
    findings: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    judgeUnanswered: 0,
    // **The shape and size of its output, and the head of it when it will not parse** - because **a reviewer that
    // spoke and was not understood is a fact worth keeping**, the same distinction as `prsFailed`.
    outputKeys: null,
    outputChars: null,
    firstOutputHead: null,
    // **Where the whole output of the first run that spoke is kept**, because **its format is the thing being learned.**
    firstOutputFile: null,
    // **The parser's own account**: which strategy worked, how many the tool claimed, how many were parsed, and
    // whether the two agree.
    extraction: null,
    declaredCount: null,
    parsedCount: null,
    countsAgree: null,
    firstFinding: null,
    // **A provider that refused for want of credit is a fact about the account, not about the reviewer** - and **it is
    // the one failure class that also explains a variance in this repository's own numbers.**
    creditExhausted: false,
  };
  let unanswered = 0;
  /**
   * **The per-pull-request judged matrices, which are the raw material of every figure below.**
   *
   * **Why they are kept rather than summed.** A curve, a gate and a maximum matching are three questions about one
   * matrix, and **re-judging the corpus to ask a second question would spend the model's budget on pairs it had already
   * answered** - and, worse, would answer them again at a different temperature-free draw and call the difference a
   * finding. **So the verdicts are collected once and every figure is derived from them.**
   */
  const perPr = [];
  const rankedDetail = [];
  // **One entry per pull request: which bucket each of its goldens fell in**, merged and published below.
  const attributed = [];
  const competitorPerPr = [];
  const competitorDetail = [];
  /**
   * **Both reviewers' comments and both reviewers' reference comments, kept for the corpus's own arithmetic.**
   *
   * The headline figures of this job are a maximum matching over (finding, golden) pairs, which is the protocol
   * `Alibaba-Aone/aacr-bench` records as **deprecated** in its own `docs/metrics.md` - the one behind
   * `--use-deprecated-score`. Their metric groups by file and lets **one comment cover several reference comments**,
   * so a defect three reviewers restated scores three and not one. **A run that reports one protocol while the corpus
   * defines another is reporting a figure nobody can compare**, and the difference is a third of recall on this slice.
   *
   * **Nothing is re-judged to compute it.** The verdicts below are the ones this run already paid for; what changes is
   * the arithmetic applied to them. So the score costs no model call, the two figures are printed side by side, and
   * the residual difference - their judge reads one file's list at a time, ours reads one pair - is named in the
   * result rather than left for a reader to discover.
   */
  const fileSemanticPulls = { our: [], competitor: [] };
  /**
   * **The goldens we were in the right file for and did not say the same thing about**, as sentences.
   *
   * `findingOnPathRejected` is 259 of 452 goldens on this slice and it is **the largest block a reviewer can move** -
   * and a count of it answers no question the next iteration can act on, because *"we spoke on that file about
   * something else"* is compatible with two opposite repairs: **look for different things**, or **say the same thing
   * differently**. The corpus's own note beside our nearest comment is the answer key, it was already fetched, and it
   * cost nothing to keep. Bounded and sampled at a stride, for the same reason `refused` is: an artifact nobody opens
   * is an artifact that changed nothing.
   */
  const rejectedGoldens = [];
  // **The second arm's accumulators, kept separate so neither can consume the other's matches.**
  let tpWhole = 0;
  let fpWhole = 0;
  let fnWhole = 0;
  let unansweredWhole = 0;
  let wholePrFindingsTotal = 0;
  let wholePrLanesTotal = 0;
  /** **Per pull request, for the pull-request arm** - a paired test needs the two arms on the same goldens. */
  const prArmPerPr = [];
  const prArmDetail = [];
  let reviewed = 0;
  let unfetched = 0;
  /** **Which pull requests this run could not read, and why** - a list, not a count. */
  const unfetchedPulls = [];
  const categories = {};
  const contextLevels = {};

  /** The pull request's unified diff, through the API, because **the corpus stores a URL and not a patch.** */
  async function fetchPrDiff(url) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
    const [, owner, repo, num] = m;
    // **`GH_TOKEN` as well as `GITHUB_TOKEN`**, because the double read of one name is what a copy-paste looks like and
    // **a silently unauthenticated fetch is a sixty-request hour against a five-thousand one**. The run of 2026-11-11
    // lost twelve of fifty pull requests and this line is the reason it could not say why.
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
    // **Four attempts, because the failure this exists for cost the corpus two pull requests and a dispatch.** The run
    // of 2026-11-16 asked for 100 and read 98: two `.diff` requests returned `500` with 4 615 and 4 486 requests left in
    // the hour, and the harness filed them under "the corpus could not supply it". **A 500 with budget left is a request
    // that failed, and a request that failed is a request that is tried again** - while a 404 is a URL that is wrong,
    // and four attempts at a wrong URL spend the hour's budget to learn what the first answer already said.
    return withRetry(
      async () => {
        try {
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
            headers: {
              accept: 'application/vnd.github.v3.diff',
              'user-agent': 'agentix-e-aacr-bench',
              ...(token ? { authorization: `token ${token}` } : {}),
            },
          });
          if (res.ok) return { ok: true, diff: await res.text() };
          // **The status and the remaining budget, because the two failures that look alike here are a typo in the
          // corpus and a rate limit**, and only one of them is repaired by running again later.
          const remaining = res.headers.get('x-ratelimit-remaining');
          return {
            ok: false,
            // **Which of the two it was decides whether to try again, and the answer is the status.**
            retryable: isTransientStatus(res.status),
            reason:
              `the diff request returned ${String(res.status)}` +
              (remaining === null ? '' : ` with ${remaining} requests left in the hour`) +
              (token ? '' : ' and the request was unauthenticated'),
          };
        } catch (error) {
          // **A throw is the socket's failure rather than the corpus's**, so it is retried - and its own message is the
          // reason, because `ECONNRESET` and `getaddrinfo ENOTFOUND` are two different repairs.
          return {
            ok: false,
            retryable: true,
            reason: `the diff request threw: ${String(error?.message ?? error)}`,
          };
        }
      },
      { attempts: 4 },
    );
  }

  /**
   * **The commit the pull request's head points at, which is the revision a hunk's line numbers belong to.**
   *
   * **Not the corpus's `source_commit`.** The corpus names two commits and the competitor's harness is invoked
   * `--from source --to target`, so the pair is `base → head` in that order - and reading the *base* file under the
   * *head's* line numbers is the same file with every number shifted by however many lines the change added. The window
   * would then show the old code under the new coordinates, which is a false statement in the prompt and a silent one.
   * **The pull request resource has the answer and it is one call per pull request**, not one per file.
   */
  async function fetchPullHead(url) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
    const [, owner, repo, num] = m;
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'agentix-e-aacr-bench',
          ...(token ? { authorization: `token ${token}` } : {}),
        },
      });
      if (res.ok) return { ok: true, sha: String((await res.json())?.head?.sha ?? '') };
      return { ok: false, reason: `the pull request request returned ${String(res.status)}` };
    } catch (error) {
      return {
        ok: false,
        reason: `the pull request request threw: ${String(error?.message ?? error)}`,
      };
    }
  }

  /**
   * **The files the pull request has today, which is not the same set as the corpus's snapshot of it.**
   *
   * Fifty-four of the 724 goldens sit on paths the pull request no longer touches - `ClickHouse/ClickHouse#74070` has
   * fifteen on a file that is not among its five changed files today, and two gemini-cli pulls are the same shape. **A
   * golden there is not a missed finding; it is a row nobody can answer**, and until this call existed the attribution
   * filed it under the bucket that names a path filter, which is a working path filter being blamed for the corpus
   * moving. One request per pull request, paginated because a large pull request has more than a hundred files, and a
   * refusal returns `null` rather than an empty list - **an empty list is the claim that the pull request changed
   * nothing**, and a transport fault must not be able to make that claim.
   */
  async function fetchPullPaths(url) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
    const [, owner, repo, num] = m;
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
    const paths = [];
    try {
      for (let page = 1; page <= 30; page += 1) {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${num}/files?per_page=100&page=${String(page)}`,
          {
            headers: {
              accept: 'application/vnd.github+json',
              'user-agent': 'agentix-e-aacr-bench',
              ...(token ? { authorization: `token ${token}` } : {}),
            },
          },
        );
        if (!res.ok) return { ok: false, reason: `the file list returned ${String(res.status)}` };
        const batch = await res.json();
        if (!Array.isArray(batch)) return { ok: false, reason: 'the file list was not a list' };
        for (const file of batch) paths.push(String(file?.filename ?? ''));
        if (batch.length < 100) return { ok: true, paths };
      }
      return { ok: true, paths, truncated: true };
    } catch (error) {
      return {
        ok: false,
        reason: `the file list request threw: ${String(error?.message ?? error)}`,
      };
    }
  }

  /**
   * **One changed file at one revision, because a hunk is not the function it sits in.**
   *
   * Three answers rather than two: the text, a refusal with a reason, and `absent` for a 404 - **a file the pull request
   * deletes has no head version, and reading that as a failure would make a deletion look like a transport fault.** The
   * caller passes the reason on, because **a window that is missing is a fact the artifact has to be able to state**
   * (the rule §18.2 wrote).
   */
  async function fetchFileAt(url, ref, path) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return { ok: false, reason: `"${String(url ?? '')}" is not a pull request URL` };
    if (typeof ref !== 'string' || ref.length === 0) {
      return { ok: false, reason: 'the corpus row carries no source commit to read the file at' };
    }
    const [, owner, repo] = m;
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '';
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${String(path)
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/')}?ref=${encodeURIComponent(ref)}`,
        {
          headers: {
            accept: 'application/vnd.github.raw',
            'user-agent': 'agentix-e-aacr-bench',
            ...(token ? { authorization: `token ${token}` } : {}),
          },
        },
      );
      if (res.ok) return { ok: true, text: await res.text() };
      if (res.status === 404)
        return { ok: false, absent: true, reason: `the file is not at ${ref}` };
      const remaining = res.headers.get('x-ratelimit-remaining');
      return {
        ok: false,
        reason:
          `the file request returned ${String(res.status)}` +
          (remaining === null ? '' : ` with ${remaining} requests left in the hour`),
      };
    } catch (error) {
      return { ok: false, reason: `the file request threw: ${String(error?.message ?? error)}` };
    }
  }

  /**
   * **The repository, at the commit the review is about, on disk.**
   *
   * The agent's `read_file` is synchronous, so the transport has to be a checkout rather than an HTTP call inside the
   * tool loop - and **a checkout is what the competitor's harness is given too**, which is the comparison this arm
   * exists to make. `--filter=blob:none` downloads every commit and no file contents, so the clone is cheap and the
   * checkout fetches only the blobs that commit needs; a `--depth 1` fetch would be cheaper and would give a repository
   * with no merge base, which is the mistake the competitor arm already paid for.
   *
   * **A clone that fails returns null rather than throwing**, because the arm must still run: the caller falls back to
   * the changed files the API already delivered, and the artifact records which of the two it used.
   */
  const checkouts = new Map();
  const checkoutAt = (url, sha) => {
    if (checkouts.has(sha)) return checkouts.get(sha);
    const repo = shortRepo(url);
    if (!repo || !sha) {
      checkouts.set(sha, null);
      return null;
    }
    const dir = mkdtempSync(`${tmpdir()}/agent-`);
    try {
      execFileSync(
        'git',
        [
          'clone',
          '-q',
          '--filter=blob:none',
          '--no-checkout',
          `https://github.com/${repo}.git`,
          dir,
        ],
        {
          stdio: 'pipe',
          timeout: 600_000,
        },
      );
      execFileSync('git', ['-C', dir, 'checkout', '-q', sha], { stdio: 'pipe', timeout: 600_000 });
      checkouts.set(sha, dir);
      return dir;
    } catch (error) {
      agentCounters.checkoutFailures += 1;
      if (agentCounters.firstCheckoutFailure === null) {
        agentCounters.firstCheckoutFailure = String(error.message ?? '').slice(0, 200);
      }
      checkouts.set(sha, null);
      return null;
    }
  };

  for (const pr of rows) {
    // **Their field names, and the diff fetched rather than read from the corpus.** **A PR whose diff cannot be
    // fetched is counted separately and not skipped quietly**, because **"the corpus had no data for it" and "we could
    // not read it" are different facts** - the distinction this repository keeps drawing.
    const comments = pr.comments ?? [];
    // **The note and its coordinates, kept or dropped together.**
    //
    // This was `comments.map((c) => String(c.note ?? '')).filter(Boolean)`: the texts survived and **the `path` and
    // `from_line` that travelled beside each one were discarded**, which is why this job could report a recall and not a
    // reason for it. The filter is the same, applied to the comment rather than to the text, so `issueTexts` is
    // byte-identical to what it was and `goldens` is the same list with its coordinates attached.
    const goldenComments = comments.filter((c) => String(c.note ?? '') !== '');
    const issueTexts = goldenComments.map((c) => String(c.note ?? ''));
    const goldens = goldenComments.map((c) => ({
      path: String(c.path ?? ''),
      note: String(c.note ?? ''),
      startLine: Number(c.from_line ?? c.to_line ?? 0) || null,
      endLine: Number(c.to_line ?? c.from_line ?? 0) || null,
    }));
    const fetched = await fetchPrDiff(pr.githubPrUrl);
    if (!fetched.ok) {
      unfetched += 1;
      // **Named, with the reason, because twelve of fifty pull requests left this run without a word.** A corpus that
      // silently shrinks by a quarter is a recall computed over a corpus nobody chose, and **the run that lost them could
      // not say whether the cause was the corpus, the network or a rate limit** - which are three different repairs.
      unfetchedPulls.push({ key: String(pr.githubPrUrl ?? ''), reason: fetched.reason });
      continue;
    }
    const diff = fetched.diff;
    // **The competitor, on this pull request, judged by the same judge against the same goldens.**
    //
    // **And its findings are extracted the way its own output shapes them** - a `comments` array carrying `content` and
    // `path` - because **the key was learned from a previous run rather than assumed**, and **an extractor that guesses
    // returns an empty list that reads as a silent reviewer.**
    // **The diff, read once per pull request and shared by both reviewers**, because **the ranking in
    // `review/actionability.ts` grounds a finding against the lines the diff added** - and **two reviewers scored
    // against two different readings of the same diff would differ by the reading rather than by the review.**
    const prFacts = collectDiffFacts(diff);
    // **Three answers, and the two that are not a purchase come first.**
    //
    // A replayed pull request contributes exactly the fields a live one contributes, so the scoring below cannot tell
    // which it received; a missing one is named with its reason and left out of the comparison rather than silently
    // counted as a zero, because **a competitor with no row is a hole in the pairing, not a competitor that found
    // nothing.**
    const competitorKey = pr.githubPrUrl ?? `pr-${competitorPerPr.length}`;
    // **The row's own identity, not the selection's.** A recorded row is a function of this pull request's goldens and
    // of nothing else, so the check that guards it has to be taken over this pull request: the run of 2026-11-10 went
    // from fourteen pull requests to fifty, the selection fingerprint moved, **every row was refused including the
    // fourteen whose own inputs had not changed**, and the free arm replayed nothing.
    const competitorDecision = resolveCompetitor({
      mode: competitorChoice.mode,
      baseline: competitorBaseline,
      judgeModel: MODEL,
      pull: { key: competitorKey, fingerprint: pullFingerprint(pr), goldens: issueTexts.length },
    });
    if (competitorDecision.kind === 'off') {
      // **A mode whose entire purpose is to remove an arm must not run it.**
      //
      // **The chain below used to fall through to the live branch for `off`**, because every decision that was not
      // `replay`, `missing` or a `record` without a credential arrived at `else if (ocrKey)` - and a credential was
      // configured. **So the arm described as switched off ran on all thirty-six pull requests**, and the run of
      // 2026-11-12 reported it in two fields that contradict each other: `secondReviewer.mode: "off"` beside
      // `prsAttempted: 36` and 258 competitor rows. **The artifact audit added an hour earlier read
      // `5 accounted for of 36 attempted` and failed the job**, which is the only reason a spent arm was noticed: the
      // money was real and the figure was not used by anything.
      //
      // **A default that spends money is the defect this module was written against**, and this was not even a default:
      // it was an explicit instruction not to spend. **The branch is empty on purpose** - `off` means this run has no
      // competitor row for this pull request, and the artifact says so through `mode` rather than through a count of
      // zero that a reader would have to interpret.
    } else if (competitorDecision.kind === 'replay') {
      competitor.verifiedBy[competitorDecision.verified === 'count' ? 'count' : 'fingerprint'] += 1;
      competitorPerPr.push(replayedPull(competitorKey, competitorDecision.pull));
      for (const row of competitorDecision.pull.detail ?? []) {
        competitorDetail.push({ ...row, pr: competitorKey, which: 'competitor' });
      }
      competitor.findings += Number(competitorDecision.pull.findings ?? 0);
      competitor.judgeUnanswered += Number(competitorDecision.pull.unanswered ?? 0);
      competitor.replayed += 1;
    } else if (competitorDecision.kind === 'missing') {
      competitor.missing.push({ key: competitorKey, reason: competitorDecision.reason });
    } else if (competitorDecision.kind === 'record' && !ocrKey) {
      // **A recording run without a credential is a missing row, not a failure of the tool**: the run asked for a
      // purchase it could not pay for, which is a fact about the environment rather than about the competitor.
      competitor.missing.push({
        key: competitorKey,
        reason: 'the run was asked to record and no competitor credential is configured',
      });
    } else if (ocrKey) {
      const outcome = reviewWithOcr(
        process.env['OCR_LLM_URL'] ?? '',
        ocrKey,
        pr.githubPrUrl,
        pr.source_commit,
        pr.target_commit,
      );
      competitor.prsAttempted += 1;
      if (!outcome.ok) {
        // **A failure with an empty reason is a failure this file has already seen.**
        //
        // **The first version recorded the reason only when it was the first failure AND the field was `null`**, and
        // **the run that installed the tool reported `firstFailure: ""`** - **an empty string, not a null** - so
        // **the reason was lost at the one moment it mattered.** **An empty reason reads exactly like no reason**, and
        // **the difference between "it did not run" and "it did not run and here is why" is the whole value of the
        // field.**
        //
        // **So the guard is on the content rather than on the sentinel**, and **the raw stderr is the fallback**,
        // because **`spawnSync ocr ENOENT` arrived in a field named `reason` and a lower-case message arrived in
        // neither.**
        const raw = typeof outcome.reason === 'string' ? outcome.reason.trim() : '';
        // **And one class of failure is not about the tool at all.**
        //
        // **What the run that got furthest reported**:
        //
        //     [ocr] 35 file(s) changed, reviewing 35
        //     [ocr] LLM grouping failed (POST "https://api.deepseek.com/anthropic/v1/messages":
        //           402 Payment Required {"error":{"message":"Insufficient Balance"}})
        //
        // **The range resolved, the endpoint was accepted, and the provider refused the call for want of credit.**
        // **That is a fact about the account rather than about the reviewer**, and **it is also the likeliest
        // explanation for this repository's own AACR figure moving between 0 and 0.1724 across four runs on one corpus
        // and one script** - because **our engine and the judge spend from the same key.**
        //
        // **So it is named rather than folded into a generic sentence**, because **a run that had credit and a run
        // that did not produce the same zero and mean different things** - **the same distinction `prsFailed` draws one
        // level up.**
        const creditFailure = /402|Insufficient Balance|Payment Required/i.test(raw);
        const reason = creditFailure
          ? `the provider refused the call for want of credit: ${raw.slice(0, 300)}`
          : raw !== ''
            ? raw
            : '(the tool reported a failure with no message)';
        if (creditFailure) competitor.creditExhausted = true;
        if (
          !competitor.firstFailure ||
          competitor.firstFailure === '(the tool reported a failure with no message)'
        ) {
          competitor.firstFailure = reason;
        }
        // **And the attempt gets a row, because a count without a name is a hole the next reader has to guess at.**
        //
        // **The run of 2026-11-11 reported `prsFailed: 4` and named one of them.** The parse-failure branch below
        // pushes a row for every pull request it loses, with the reason and the golden count, and **this branch - the
        // other way an attempt can fail - pushed nothing at all**: four failures, one name, and the three that were
        // only counted contributed **no goldens to the competitor's denominator while contributing nothing to its
        // numerator either**. That is the same asymmetry the comment below says was worth 0.0130 of F1 in the
        // competitor's favour, surviving in a second code path for six iterations after the first one was fixed -
        // **because the fix was applied where the symptom was read rather than where the accounting is done.**
        //
        // **A failure that ran is an observation, so it is scored as a zero**; a failure that could not run is an
        // environment fact and is filed as `missing` instead, because the two have different repairs and only one of
        // them is about the competitor. The credit case is the one this repository has already paid for: the tool was
        // installed, the range resolved, and the provider refused the call, which says nothing about the reviewer.
        if (creditFailure) {
          // **Filed as a hole in the pairing rather than as a failure of the reviewer**, and therefore not counted in
          // `prsFailed` either: the two lists are one fact written twice, and a run whose provider refused the call did
          // not observe the competitor at all.
          competitor.missing.push({ key: competitorKey, reason });
        } else {
          competitor.prsFailed += 1;
          competitorPerPr.push({
            key: competitorKey,
            matches: [],
            goldens: issueTexts.length,
            keep: [],
          });
          competitor.failedPullRequests.push({
            key: competitorKey,
            goldens: issueTexts.length,
            reason: reason.slice(0, 200),
            // **Which of the two ways it failed**, so that a later run can tell a crash from a refusal without parsing
            // prose out of a reason string.
            stage: 'run',
          });
        }
      } else {
        try {
          // **The output is looked at before it is parsed**, because **its shape has not been seen** - **the same
          // lesson `scan` taught when the array turned out to be `comments` rather than `findings`.**
          const text = String(outcome.stdout).trim();
          // **Its logging and its JSON share one stream, and the first character of a log line is `[`.**
          //
          // **What the previous run printed**: `its output did not parse: Unexpected token 'o', "[ocr] 35 fi"` -
          // **the locator found the `[` of `[ocr]` and started parsing a log line.** **`35 file(s) changed, reviewing
          // 35` is in the same string**, which is **how the range was known to have resolved** - **so the evidence and
          // the bug were one line apart.**
          //
          // **So the log lines are removed before the JSON is located**, and **only lines that do not start with the
          // tool's own prefix are considered** - **a filter on the writer rather than a search for a bracket.**
          // **A ladder of strategies, and the one that worked is recorded.**
          //
          // **Four attempts at one extraction, and each failure named the next**:
          //
          //   1. `JSON.parse(whole)`            -> `Unexpected token 'o', "[ocr] 35 fi"`
          //   2. strip `[ocr]` lines            -> `Unexpected token 'b', "[bug · high"`
          //   3. strip every bracketed heading  -> `Expected property name or '}' … (line 2 column 15)`
          //
          // **The third is the informative one.** **Stripping heading lines *removed bytes from the middle of a
          // document*** - because **the tool writes progress headings into the same stream as its output, and a line
          // removed from between two lines of JSON joins them.** **A filter that removes lines cannot repair a
          // document it is editing.**
          //
          // **So the strategies are tried in order of how little they alter the input**, and **the one that produced
          // the parse is stored in `extraction`** - because **which strategy worked is a fact about the tool's output,
          // and the next iteration should read it rather than rediscover it.**
          const candidates = [
            // **The least alteration first**: the document is the longest suffix that parses.
            { name: 'whole', value: text },
            // **From the first object rather than the first bracket**, because **a `[` at position zero is as likely
            // to be a heading as an array**, and **the tool's document is an object** - so **`{` is the character that
            // carries information here.**
            {
              name: 'from-first-object',
              value: (() => {
                const i = text.indexOf('{');
                return i >= 0 ? text.slice(i) : text;
              })(),
            },
            {
              name: 'from-last-line-starting-with-brace',
              value: (() => {
                const lines = text.split(String.fromCharCode(10));
                for (let i = lines.length - 1; i >= 0; i -= 1)
                  if (lines[i].trimStart().startsWith('{'))
                    return lines.slice(i).join(String.fromCharCode(10));
                return text;
              })(),
            },
            // **And the heading-stripping last**, because it is the one that edits the document.
            {
              name: 'headings-removed',
              value: text
                .split(String.fromCharCode(10))
                .filter((line) => {
                  const match = /^\s*\[([^\]]{0,80})\]/.exec(line);
                  return !(match !== null && !match[1].includes('{'));
                })
                .join(String.fromCharCode(10))
                .trim(),
            },
          ];
          let parsed = null;
          let strategy = null;
          let lastError = null;
          for (const candidate of candidates) {
            if (candidate.value === '') continue;
            try {
              parsed = JSON.parse(candidate.value);
              strategy = candidate.name;
              break;
            } catch (error) {
              lastError = `${candidate.name}: ${error.message}`;
            }
          }
          // **And when no candidate is a document, the output is a report and the parser reads it.**
          //
          // **The ladder is not deleted**, because **`scan` writes JSON and this repository has read 207,811
          // characters of it** - so **a future `review` that grows a machine-readable mode is already handled.** **But
          // `review` has none today**, and **four candidates over a stream with no document is four failures** - so
          // **the fallback speaks the format this tool actually writes.**
          let list;
          if (parsed === null) {
            const prose = parseProseReport(text);
            list = prose.findings;
            competitor.extraction = 'prose';
            competitor.declaredCount = prose.declaredCount;
            // **The tool's own count against what was parsed**, because **a parser that quietly drops findings is
            // indistinguishable from a tool that found fewer** - **the distinction `prsFailed` draws one level up,
            // applied to a parser instead of a run.**
            competitor.parsedCount = list.length;
            competitor.countsAgree =
              prose.declaredCount === null ? null : prose.declaredCount === list.length;
            if (!list.length) {
              // **What the candidates said, not only that they all failed.** `lastError` was written on every failed
              // candidate and read by nothing, so a parse that fell through to prose lost the reason it had to.
              throw new Error(
                `the report parsed to no findings (${prose.findings.length} prose, no JSON candidate parsed; last candidate error: ${lastError ?? 'none'})`,
              );
            }
          } else {
            competitor.extraction = strategy;
            list = Array.isArray(parsed)
              ? parsed
              : (parsed.comments ?? parsed.findings ?? parsed.issues ?? parsed.results ?? []);
          }
          competitor.firstFinding = list[0] ? JSON.stringify(list[0]).slice(0, 240) : null;
          competitor.outputKeys =
            parsed === null
              ? null
              : Array.isArray(parsed)
                ? ['(array)']
                : Object.keys(parsed).slice(0, 12);
          competitor.outputChars = text.length;
          // **And how many lines the tool wrote outside its JSON**, because **a stream that mixes two formats is a fact
          // about the tool** and **a parse that succeeds does not say how close it came to failing.**
          // **`body` was the filtered variable the ladder replaced, and this line still referred to it.**
          //
          // **The run reported `its output did not parse: body is not defined`** - **one line, one name, and it was
          // the fourth time in this stretch that a replacement left a reference to what it removed.** **The heading
          // count is what this line wanted**, so **it counts headings rather than subtracting a variable that no
          // longer exists.**
          const allLines = text.split(String.fromCharCode(10));
          competitor.logLines = allLines.filter((line) => {
            const match = /^\s*\[([^\]]{0,80})\]/.exec(line);
            return match !== null && !match[1].includes('{');
          }).length;
          competitor.findings += list.length;
          // **The same treatment ours gets, on the same judge, over the same goldens.**
          //
          // **Two reviewers, one ranker.** The ranking below is applied to the competitor's findings as well as to this
          // repository's, because **the claim under test is that ordering by actionability raises a reviewer's F1, not
          // that this reviewer's sentences are better** - and **if the competitor gains as much as we do, the gain
          // belongs to the ranker; if it does not, the sentences are the difference.** **One control, two arms, no
          // extra calls**: every verdict is already in the matrix.
          const competitorRows = list
            .map((entry) => competitorRowOf(entry))
            .filter((row) => row !== null);
          const competitorRanked = rankFindings(
            competitorRows.map((row) => ({ finding: row.finding, path: row.path })),
            prFacts,
          );
          const competitorMatrix = await judgeMatrix(
            competitorRanked.map(
              (ranked) => `${ranked.finding.title} :: ${ranked.finding.description}`,
            ),
            issueTexts,
          );
          competitor.judgeUnanswered += competitorMatrix.unanswered;
          const keepFlags = competitorRanked.map((ranked) => ranked.score.actionable);
          competitorPerPr.push({
            key: competitorKey,
            matches: competitorMatrix.matches,
            goldens: issueTexts.length,
            keep: keepFlags,
          });
          // **The same coordinates we keep for ourselves**, because a comparison scored by two arithmetics is the defect
          // this field exists to remove: their rows carry `matches` and a path per comment, and the goldens are the same
          // list we already hold with their paths attached.
          fileSemanticPulls.competitor.push({
            findings: competitorRanked.map((entry) => ({ path: entry.path, text: '' })),
            goldens,
            matches: competitorMatrix.matches,
            keep: keepFlags,
          });
          // **The same rows the artifact publishes, kept once and used twice** - published here, and written to the
          // baseline so that the next run pays for them zero times. **`pr` and `which` are added at publication rather
          // than stored**, because they are the same two constants for every row in the file and a record that repeats
          // them is a record whose size is mostly its own labels.
          const detailRows = competitorRanked.map((ranked, at) => ({
            path: ranked.path,
            startLine: ranked.finding.startLine,
            endLine: ranked.finding.endLine,
            severity: ranked.finding.severity,
            category: ranked.finding.category,
            score: ranked.score.score,
            features: ranked.score.features,
            scoreTerms: ranked.score.scoreTerms,
            actionable: ranked.score.actionable,
            matchedGoldens: competitorMatrix.matches[at],
            // **The competitor's own sentence, which this row did not carry and ours did.**
            //
            // Every figure in this project is about *whether* the judge accepted a remark, and not one of them says what
            // the remark was. Our own rows kept `text` from the first run, so `findingOnPathRejected` could be read
            // beside the sentence that was rejected; **the competitor's rows kept the coordinates and dropped the
            // words**, which means the one instruction every competitor analysis ends with - *learn what they say and
            // say it as well* - had no data behind it: the baseline in `benchmarks/aacr/competitor-baseline.json` was
            // paid for once and is replayed for free, and it stores 23 rows per pull request at nine fields each with no
            // text among them.
            //
            // **The omission was deliberate and its reason was size.** The comment above says a record that repeats a
            // label is a record whose size is mostly its own labels, and 320 characters per row is not a label. The
            // baseline is 94 kB; with the text it is about 220 kB, in a file that is read by a comparison job and
            // reviewed by a person. **A comparison that cannot be re-read is cheaper only until somebody needs to read
            // it**, which is the same ledger entry as the five attribution examples.
            text: `${ranked.finding.title} :: ${ranked.finding.description}`.slice(0, 320),
          }));
          for (const row of detailRows) {
            competitorDetail.push({ ...row, pr: competitorKey, which: 'competitor' });
          }
          if (competitorChoice.mode === 'record') {
            competitorBaseline = withRecord(
              competitorBaseline,
              competitorKey,
              recordedPull({
                matches: competitorMatrix.matches,
                goldens: issueTexts.length,
                keep: keepFlags,
                detail: detailRows,
                unanswered: competitorMatrix.unanswered,
                findings: list.length,
                // **Stored with the row**, so the next run checks this pull request's goldens instead of checking how
                // many pull requests happened to be selected.
                fingerprint: pullFingerprint(pr),
              }),
            );
            competitor.recorded += 1;
            recordedAny += 1;
          }
        } catch (error) {
          competitor.prsFailed += 1;
          // **The head of the output is kept when it cannot be parsed**, because **the shape is what the next
          // iteration needs and the message alone does not carry it.**
          competitor.firstOutputHead = String(outcome.stdout ?? '').slice(0, 600);
          // **And where the whole of it is**, because **a six-hundred-character head is a sample and a format is not a
          // sample** - the same distinction the `scan` output taught when a 207,811-character answer was cut to 3,200.
          competitor.firstOutputFile = outcome.outputFile ?? null;
          const reason = `its output did not parse: ${error.message}`;
          if (!competitor.firstFailure) competitor.firstFailure = reason;
          // **And the pull request it failed on counts against it.**
          //
          // **This row was missing, and its absence was worth 0.0130 of F1 in the competitor's favour.** The run of
          // 2026-11-09 attempted fourteen pull requests, failed one, and the scoring never heard about it: a throw here
          // skipped the push below, so that pull request contributed no goldens to the denominator while its thirteen
          // goldens contributed nothing to the numerator either - **which is recall 0.3185 read against a denominator
          // of 157 instead of the 170 both reviewers were given.** The honest reading of that run is
          // **P 0.3289 / R 0.2941 / F1 0.3106**, and the difference is not a rounding: **a reviewer whose output did not
          // parse is a reviewer that found nothing on that pull request**, and scoring a crash as a non-event is the
          // one asymmetry a head-to-head cannot carry, because it flatters whichever arm has more moving parts.
          //
          // **And it is deliberately not the same as `missing`.** A missing baseline row is a **hole in the pairing** -
          // the competitor was never run on that pull request in this run, so there is no observation to score and the
          // comparison is marked incomparable. A crash is an **observation**: it ran, it spent the money, and it produced
          // nothing. **One is excluded and one is a zero**, and the two were the same code path until now.
          competitorPerPr.push({
            key: competitorKey,
            matches: [],
            goldens: issueTexts.length,
            keep: [],
          });
          competitor.failedPullRequests.push({
            key: competitorKey,
            goldens: issueTexts.length,
            reason: String(error.message ?? '').slice(0, 200),
            // **The stage, so the two lists read the same way**: this one ran and could not be understood, the other
            // one ran and produced nothing - and both are observations that belong in the denominator.
            stage: 'parse',
          });
        }
      }
    }

    // **The diff is split by file, and no golden path is read.**
    //
    // **What the head-to-head found and this explains**: **the engine emitted 2 findings across five pull requests
    // while a competitor emitted 24**, and **the cause was in the two lines that used to stand here.**
    //
    //     const firstPath = String(comments[0]?.path ?? 'unknown');   // the first GOLDEN comment's path
    //     engine.reviewDiff(createDiff(firstPath, 'added', diff), diff);
    //
    // **Two defects in two lines.** **The path came from the answer key** - **so the engine was told where the first
    // labelled issue lives** - and **a multi-file pull request diff was handed over as the content of one file**, so
    // **the engine read one file's story and emitted one file's findings.**
    //
    // **And the first defect made the second invisible**: **an engine given the right path by accident looks like an
    // engine that found it**, and **the recall it produced was low enough to look like a ranking problem** - which is
    // where every tuning attempt in this repository's history had been aimed.

    /** The per-file sections of a unified diff, `a/` and `b/` prefixes stripped. */
    const splitDiffByFile = (unified) => {
      const sections = [];
      let current = null;
      for (const line of String(unified).split(String.fromCharCode(10))) {
        const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        if (header) {
          if (current) sections.push(current);
          current = { path: header[2], lines: [line] };
          continue;
        }
        if (current) current.lines.push(line);
      }
      if (current) sections.push(current);
      return sections.filter((section) => section.lines.length > 1);
    };

    const sections = splitDiffByFile(diff);

    /**
     * **The diff's own verdict, taken before a lane is paid to read the file** (§79).
     *
     * The classifier reads each section's unified patch and returns the new-side line numbers a compiler would see as
     * new. It costs nothing - no call, no token, no parse - and it is cleared per pull request for the same reason the
     * file texts are: a path that answered last time must not answer now.
     */
    if (CHANGE_SHAPE && FALSIFY) {
      const { classifyPatch } =
        await import('../../packages/intelligence/dist/review/adjudication/change-shape.js');
      const shape = engineCounters.falsifier.shape;
      const shapeForFile = new Map();
      const whitespaceOnly = new Set();
      for (const section of sections) {
        const shaped = classifyPatch(section.lines.join(String.fromCharCode(10)));
        /**
         * **`allowedLines` and not `novelLines`, and the first reading of this device is why.**
         *
         * `novelLines` is the *written* lines: what a reader has to see, which is a token argument. `allowedLines` is
         * the *standing* surface: the hunk's span plus its deletion points, which is a precision argument. They were
         * the same set for one commit, and on 30 pull requests that refuted **three true positives about deletions** -
         * a hunk that only removed wrote no line, so the set was empty and every finding about the removal was dropped
         * as standing on code the change did not touch.
         */
        shapeForFile.set(section.path, shaped.allowedLines);
        shape.hunks += shaped.hunks.length;
        shape.novelLines += shaped.novelLines.size;
        shape.allowedLines += shaped.allowedLines.size;
        if (shaped.noneSubstantive) shape.noneSubstantive += 1;
        if (shaped.whitespaceOnly) {
          shape.whitespaceOnly += 1;
          whitespaceOnly.add(section.path);
        }
      }
      shapeLinesForGate = shapeForFile;
      whitespaceOnlyForGate = whitespaceOnly;
    } else {
      shapeLinesForGate = new Map();
      whitespaceOnlyForGate = new Set();
    }

    if (!sections.length) {
      // **A pull request with no per-file sections is a fact about the input**, so **it is recorded rather than
      // counted as a review that found nothing.**
      engineCounters.emptyDiffs += 1;
    }
    engineCounters.filesReviewed += sections.length;
    // **The code each hunk sits in, fetched once per changed file and reused by both arms.**
    //
    // **Why this is fetched here rather than inside the engine**: the engine is given text, not a transport, and **a
    // review engine that reached the network by itself would be a review engine that cannot be unit-tested** - the same
    // division the provider abstraction follows. **Why it is one call per file rather than a checkout**: the competitor
    // gets a checkout and pays a clone for it; 249 files over 36 pull requests is 249 small requests, which is the same
    // fact for a fraction of the bytes.
    const fileTexts = new Map();
    // **The binding the gate reads**, set before the lanes run and cleared per pull request so a path from the previous
    // pull request cannot answer a question about this one.
    fileTextsForGate = fileTexts;
    // **The head commit, hoisted out of the retrieval block** because the agent arm needs the same revision and reading it
    // twice is a second request for a fact already in hand.
    let pullHead = null;
    if (CODE_CONTEXT || NEEDS_FILE_TEXT || REACH) {
      const head = await fetchPullHead(pr.githubPrUrl);
      pullHead = head.ok ? head : null;
      if (!head.ok) {
        engineCounters.codeContext.failed += 1;
        if (engineCounters.codeContext.reasons.length < 3) {
          engineCounters.codeContext.reasons.push({ path: '(pull request)', reason: head.reason });
        }
      }
      for (const section of sections) {
        if (!head.ok) break;
        engineCounters.codeContext.requested += 1;
        const read = await fetchFileAt(pr.githubPrUrl, head.sha, section.path);
        if (read.ok) {
          engineCounters.codeContext.read += 1;
          engineCounters.codeContext.chars += read.text.length;
          fileTexts.set(section.path, read.text);
          continue;
        }
        if (read.absent) engineCounters.codeContext.absent += 1;
        else engineCounters.codeContext.failed += 1;
        // **Three of these, because a list of a hundred reasons is a log**, and **the count without a reason is the
        // defect §18.2 named.**
        if (engineCounters.codeContext.reasons.length < 3) {
          engineCounters.codeContext.reasons.push({ path: section.path, reason: read.reason });
        }
      }
    }
    /**
     * **The repository, walked once per head commit, and its price recorded** (§101).
     *
     * **A pull request whose clone fails is reviewed without a graph and counted**, because `noCheckout` is the only
     * field that separates *the device found nothing* from *the device was not there* - and those two produce the same
     * F1. **The clone counter is the agent arm's**, and that is deliberate: `checkoutAt` already owns the clone, and a
     * second one would be a second copy of the retry policy rather than a second checkout.
     */
    reachIndex = null;
    if (REACH) {
      const checkout = pullHead === null ? null : checkoutAt(pr.githubPrUrl, pullHead.sha);
      if (checkout === null) {
        reachCounters.noCheckout += 1;
        if (reachCounters.firstFailure === null) reachCounters.firstFailure = 'no checkout';
      } else {
        const cached = reachIndexes.get(pullHead.sha);
        if (cached !== undefined) {
          reachIndex = cached;
        } else {
          const startedIndex = Date.now();
          const tree = readRepoFiles(checkout, {
            maxFiles: 20_000,
            maxTotalBytes: 64 * 1024 * 1024,
          });
          reachIndex = buildRepoIndex(tree.files);
          reachCounters.indexBuilds += 1;
          reachCounters.filesIndexed += tree.stats.read;
          reachCounters.indexMs += Date.now() - startedIndex;
          if (tree.stats.skippedOverCap > 0 || tree.stats.skippedOverBytes > 0) {
            if (reachCounters.firstFailure === null) {
              reachCounters.firstFailure = `${String(tree.stats.skippedOverCap)} over the file cap, ${String(tree.stats.skippedOverBytes)} over the byte cap`;
            }
          }
          reachIndexes.set(pullHead.sha, reachIndex);
          reachCounters.indexEvictions = reachIndexes.evictions;
        }
        reachCounters.pullsWithIndex += 1;
      }
    }
    /**
     * **The working trees of the pull requests already reviewed, deleted.**
     *
     * A clone is a directory, and remembering every commit keeps every tree on a runner whose disk is fixed: the same
     * arithmetic that killed the fifty-pull-request run in the heap (§105.1) has a second copy on the disk, and **the
     * second copy fails as `ENOSPC` in the middle of a checkout, which reads like a network fault**. One pull request is
     * reviewed at a time, so one tree is in use at a time, and this is the place that knows which one that is.
     *
     * A delete that fails is counted rather than thrown: **a run that lost a directory it no longer needed is not a run
     * that should stop**, and a disk that refused is worth a line in the artifact rather than a stack trace.
     */
    if (pullHead !== null) {
      for (const directory of checkoutsToPrune(checkouts, pullHead.sha)) {
        try {
          rmSync(directory, { recursive: true, force: true });
          reachCounters.checkoutsPruned += 1;
        } catch {
          // **Counted as not pruned**, which is the fact: the directory is still there.
        }
      }
      for (const [sha, directory] of [...checkouts]) {
        if (sha !== pullHead.sha && typeof directory === 'string') checkouts.delete(sha);
      }
    }

    const lanes = [];
    // **The lanes do not run when the agent is the arm under test, unless the arm is a merge of the two.**
    //
    // The agent's findings replace the lanes' a hundred lines below, so every lane call this loop makes under
    // `AACR_AGENT=on` is bought and then discarded: the measured run spent 0.46 of its 0.79 USD on 1 245 lane calls
    // whose findings were never scored, and most of its 41 minutes the same way. **An arm that pays for a second
    // reviewer it does not use is an arm whose cost per iteration cannot come down.**
    //
    // **`AACR_ENSEMBLE=on` is the one arm that does use them, and the first run of it proved why the condition has to
    // say so.** R-29 was registered as *a list merged from the five lanes and the reading reviewer*; with the lanes
    // emptied it became a de-duplication and selection pass over the reader's own candidates. It still lifted the
    // shipped point from 0.2148 to 0.2504, and **it did so as a different device from the one the registration names** -
    // `merge.candidates` was 394 for 46 pull requests, which is one reviewer's worth. **A device that cannot be run
    // because a cost optimisation upstream of it emptied one of its two inputs is not a device**, and the artifact now
    // carries `merge.sides` so that the next reader can check the union was really a union.
    const lanesRun = !AGENT || (ENSEMBLE && !ENSEMBLE_READER_ONLY);
    for (const section of lanesRun ? sections : []) {
      // **A file whose whole diff is a re-indent is not reviewed, because nothing it produces could survive.** The gate
      // is told this file touched no line, so every finding in it is refuted unread; buying five lanes to produce them
      // is buying findings for the bin. **The condition names the gate**, because without one the findings would survive
      // and this would be the recall trade it is not.
      if (CHANGE_SHAPE && FALSIFY && whitespaceOnlyForGate.has(section.path)) {
        engineCounters.falsifier.shape.skippedFiles += 1;
        continue;
      }
      const sectionDiff = section.lines.join(String.fromCharCode(10));
      try {
        // **One file per call, and the file's own path** - **so neither the count nor the location depends on the
        // answer key.**
        const produced = await engine.reviewDiff(
          createDiff(section.path, 'added', sectionDiff),
          sectionDiff,
        );
        lanes.push(...produced);
        // **And what the claim check decided about this file's findings**, summed where the engine already keeps the
        // per-call report. **A device whose effect is only visible in the score is a device nobody can debug**: a run
        // whose F1 did not move can be one whose adjudicator refuted nothing, or one whose every call was unchecked, and
        // those two need opposite repairs.
        const claims = engine.lastAdjudication;
        if (claims && engineCounters.adjudication.enabled) {
          const totals = engineCounters.adjudication;
          totals.candidates += claims.claims?.candidates ?? 0;
          totals.upheld += claims.claims?.upheld ?? 0;
          totals.repaired += claims.claims?.repaired ?? 0;
          totals.refuted += claims.claims?.refuted ?? 0;
          totals.unanchored += claims.claims?.unanchored ?? 0;
          totals.unchecked += claims.claims?.unchecked ?? 0;
          totals.unreadable += claims.claims?.unreadable ?? 0;
          for (const [rule, count] of Object.entries(claims.narration.refusedByRule)) {
            totals.narrationRefused[rule] = (totals.narrationRefused[rule] ?? 0) + count;
          }
          totals.refusedTotal += claims.refused.length;
          refusalsSeen.push(...claims.refused);
        }
        // **And what the independent gate removed from this file, with the line it quoted.** The counts answer *how
        // many*, which is the registration; the rows answer *on what evidence*, which is the only way to read a figure
        // that did not move - **a gate that dropped nothing and a gate that dropped everything it was shown are both
        // "F1 unchanged" in the score and opposite facts about the reader.**
        const gate = engine.lastFalsifier;
        if (gate && engineCounters.falsifier.enabled) {
          const totals = engineCounters.falsifier;
          totals.contract ??= gate.report.contract;
          totals.candidates += gate.report.candidates;
          totals.dropped += gate.report.dropped;
          totals.keptBecauseQuoteMissing += gate.report.keptBecauseQuoteMissing;
          totals.keptBecauseSelfReferential += gate.report.keptBecauseSelfReferential;
          totals.droppedBecauseUntouched += gate.report.droppedBecauseUntouched ?? 0;
          totals.untouchedFrom.wholeFile += gate.report.untouchedFrom?.wholeFile ?? 0;
          totals.untouchedFrom.offTheChange += gate.report.untouchedFrom?.offTheChange ?? 0;
          totals.unreadable += gate.report.unreadable;
          totals.notAsked += gate.report.notAsked;
          totals.calls += gate.report.calls;
          if (gate.report.notAPatch) totals.notAPatch += 1;
          for (const one of gate.dropped) {
            falsifierDropsSeen.push({
              path: section.path,
              startLine: one.finding.startLine,
              endLine: one.finding.endLine,
              title: one.finding.title.slice(0, 160),
              // **The line the quote stood on, which §74 had to infer.** The first run's sample carried the quote's text
              // and the claim's range and nothing that joined them, so "was this quote the claim's own line?" could only
              // be answered by reading twelve rows by hand. `quoteLine` and `claimIndex` make it a count.
              quoteLine: one.quoteLine,
              claimIndex: one.claimIndex,
              quote: one.quote.slice(0, 200),
              reason: one.reason.slice(0, 240),
            });
          }
        }
        // **And what the remark pass kept, and which rail removed the rest.** A pass that filed nothing is either the
        // device working on a clean diff or a rail refusing every line it named, and only these four counts tell those
        // two apart - which is the difference between keeping the switch and rewriting its prompt.
        if (REMARKS) {
          const selection = engine.lastRemarks;
          const totals = engineCounters.remarks;
          totals.files += 1;
          totals.kept += selection.kept.length;
          totals.notAddedLine += selection.notAddedLine;
          totals.capped += selection.capped;
          if (selection.notAPatch) totals.notAPatch += 1;
        }
        // **And what the engine's own parse and filter did with this file's findings.**        //
        // **The chain is `complete` -> `parseLLMResponse` -> `filterFindings`**, and **the third ran a check with the
        // wrong coordinate system**: **it compared the model's file line numbers against the DIFF's line count**, so a
        // correct finding at line 900 of a 1,500-line file died on a 40-line diff. **The engine now counts its drops
        // per rule, and those counts are what this job needs** - because **a filter that eats the answer and a reviewer
        // with nothing to say produce the same zero.**
        // **And what the deduplication removed**, because **five lanes review one diff and a defect they all see is one
        // defect** - and **a count that fell because duplicates were merged is not a count that fell because the engine
        // went quiet.**
        const dd = engine.lastDeduplication;
        if (dd) {
          const acc = engineCounters.dedup;
          if (acc) {
            acc.before += dd.before;
            acc.after += dd.after;
            acc.dropped += dd.dropped;
            // **Which rule did the merging**, because the three are not the same evidence: `rangeOnly` is a merge with
            // no textual agreement behind it at all, and a report that says only `dropped: 1186` cannot tell a
            // restatement removed from a second defect removed.
            for (const rule of ['rangeAndWords', 'rangeOnly', 'wordsNearby']) {
              acc.mergedBy[rule] = (acc.mergedBy[rule] ?? 0) + dd.mergedBy[rule];
            }
            // **And the removals themselves, because a total cannot be read.** The artifact carries each removed
            // finding beside the one that absorbed it, so a cross-category absorb - the bug lane's finding merged into
            // the architecture lane's remark because their ranges overlapped - can be counted without a dispatch.
            // **Bounded at the run level too**: the per-review ceiling keeps one busy pull request from filling the
            // artifact, and this one keeps a hundred of them from doing it together.
            for (const item of dd.droppedFindings ?? []) {
              if (acc.droppedFindings.length < 4000) acc.droppedFindings.push(item);
              else acc.droppedFindingsBeyondRunCeiling += 1;
            }
            acc.droppedFindingsBeyondCeiling += dd.droppedFindingsBeyondCeiling ?? 0;
            // **And how many the range rule would have removed and did not (§59)**, because a run with the switch on has
            // a *smaller* `dropped` than the run it is compared with, and **a device whose only trace is a number that
            // went down in a different column cannot be told from a corpus that produced fewer duplicates.**
            acc.keptAsSecondConcern =
              (acc.keptAsSecondConcern ?? 0) + (dd.keptAsSecondConcern ?? 0);
          } else {
            engineCounters.dedup = {
              before: dd.before,
              after: dd.after,
              dropped: dd.dropped,
              mergedBy: { ...dd.mergedBy },
              keptAsSecondConcern: dd.keptAsSecondConcern ?? 0,
              droppedFindings: [...(dd.droppedFindings ?? [])].slice(0, 4000),
              droppedFindingsBeyondCeiling: dd.droppedFindingsBeyondCeiling ?? 0,
              droppedFindingsBeyondRunCeiling: Math.max(
                0,
                (dd.droppedFindings ?? []).length - 4000,
              ),
            };
          }
        }
        const counts = engine.lastCounts;
        if (counts) {
          const d2 = engineCounters.filterDrops;
          if (d2) {
            d2.parsed += counts.parsed;
            d2.kept += counts.kept;
            d2.invalidLine += counts.dropped.invalidLine;
            d2.beyondDiffLength += counts.dropped.beyondDiffLength;
            d2.lanes += 1;
          } else {
            engineCounters.filterDrops = {
              parsed: counts.parsed,
              kept: counts.kept,
              invalidLine: counts.dropped.invalidLine,
              beyondDiffLength: counts.dropped.beyondDiffLength,
              lanes: 1,
            };
          }
        }
        // **And the lanes are counted, because a lane that failed produced a zero and said nothing.**
        //
        // **What the run after the split showed**: **199 files reviewed and one finding emitted.** **The input was
        // fixed** - one file's story became 199 files - **and the emission did not move.** **So the count in this
        // artifact said the engine was reading everything and producing nothing, without saying which step dropped
        // it** - and **`lanes.filter((l) => l.success)` is exactly the kind of line that turns a failure into an
        // absence.**
        const laneStats = engineCounters.laneStats ?? {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          findings: 0,
          firstError: null,
        };
        laneStats.attempted += produced.length;
        for (const lane of produced) {
          if (lane.success) {
            laneStats.succeeded += 1;
            laneStats.findings += (lane.findings ?? []).length;
          } else {
            laneStats.failed += 1;
            if (!laneStats.firstError) {
              laneStats.firstError = String(
                lane.error ?? lane.reason ?? '(no error recorded on the lane)',
              ).slice(0, 240);
            }
          }
        }
        engineCounters.laneStats = laneStats;
      } catch (error) {
        // **A file the engine could not read contributes no findings and is counted**, which is **the distinction
        // this repository draws wherever a per-item loop exists.**
        engineCounters.fileFailures += 1;
        if (!engineCounters.firstFileFailure)
          engineCounters.firstFileFailure = String(error.message ?? '').slice(0, 200);
      }
    }

    // **ARM TWO: the whole pull request, in one call per lane, with one budget for the pull request.**
    //
    // **Why an arm rather than a replacement.** **The structural finding was that 995 lanes each see one file**, and
    // **the ground truth carries Repo Level issues that a single file cannot contain** - so **the hypothesis is that
    // the view is the constraint.** **The competitor reviews the whole diff in one call**, and **reproducing that with
    // this repository's own prompt is the control**: **if F1 rises, the view was the constraint; if it does not, the
    // capability is**, and **either answer is one this project has never had.**
    //
    // **And it runs in the same job as the per-file arm**, over the same pull requests, judged by the same judge
    // against the same goldens - so **the two numbers differ by the arm and by nothing else.**
    //
    // **What changed since the last run, said plainly.** The previous version of this arm called `reviewDiff` with the
    // whole diff as one file's content, so **every finding came back about a file named `pull-request.diff` and no
    // finding could be grounded against any real path** - the arm measured a view and forgot to measure a location.
    // `reviewPullRequest` requires a path per finding and judges each range against **its own file's** hunks, so the
    // arm now differs from the file arm in the thing it was meant to test and in nothing else.
    const prSections = sections.map((section) => ({
      path: section.path,
      diffText: section.lines.join(String.fromCharCode(10)),
      // **Omitted rather than empty when the file could not be read**, because the engine distinguishes "no window" from
      // "a window of nothing" and an empty string would tell a model the file is empty.
      ...(CODE_CONTEXT && fileTexts.has(section.path)
        ? { fileText: fileTexts.get(section.path) }
        : {}),
    }));
    let wholePrFindings = [];
    try {
      const prLanes = await engine.reviewPullRequest(prSections, {
        maxFindingsPerPullRequest: PR_BUDGET,
        // **Stated per call rather than at construction**, so the off-arm is the engine's default and the on-arm is one
        // line a reader can find: the two arms of §20 differ here and in nothing else.
        codeContext: CODE_CONTEXT,
        changeShape: CHANGE_SHAPE,
      });
      wholePrFindings = prLanes.filter((l) => l.success).flatMap((l) => l.findings);
    } catch (error) {
      engineCounters.wholePrFailure = String(error.message ?? '').slice(0, 200);
    }
    wholePrLanesTotal += prSections.length;
    wholePrFindingsTotal += wholePrFindings.length;
    // **What the arm's own filter did with this pull request**, because **an arm that emits nothing and an arm whose
    // path check ate the answer produce the same zero.**
    if (engine.lastCounts) {
      const acc = engineCounters.pullRequestArm;
      const own = engine.lastCounts.dropped;
      if (acc) {
        acc.parsed += engine.lastCounts.parsed;
        acc.kept += engine.lastCounts.kept;
        acc.missingPath += own.missingPath;
        acc.unknownPath += own.unknownPath;
        acc.beyondDiffLength += own.beyondDiffLength;
        acc.invalidLine += own.invalidLine;
        acc.capped += own.capped;
      } else {
        engineCounters.pullRequestArm = {
          parsed: engine.lastCounts.parsed,
          kept: engine.lastCounts.kept,
          missingPath: own.missingPath,
          unknownPath: own.unknownPath,
          beyondDiffLength: own.beyondDiffLength,
          invalidLine: own.invalidLine,
          capped: own.capped,
        };
      }
      // **And the findings the rules removed, by path and by rule**, because the first run of this arm dropped 31 of
      // 120 as `unknownPath` and **the artifact could not say which paths they named**.
      const samples = engine.lastCounts.dropped.samples ?? [];
      for (const sample of samples) {
        if (!engineCounters.pullRequestArm.droppedSamples) {
          engineCounters.pullRequestArm.droppedSamples = [];
        }
        if (engineCounters.pullRequestArm.droppedSamples.length < 20) {
          engineCounters.pullRequestArm.droppedSamples.push(sample);
        }
      }
    }

    reviewed += 1;
    // **Their two context dimensions are recorded per PR**, because **a `Repo Level` issue needs the repository and a
    // `Diff Level` one does not** - and **that is the axis this corpus was chosen for.**
    for (const c of comments) {
      const ctx = String(c.context ?? 'unknown');
      contextLevels[ctx] = (contextLevels[ctx] ?? 0) + 1;
      const cat = String(c.category ?? 'unknown');
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    /**
     * **ARM FIVE: an agent that reads the repository before it says anything.**
     *
     * The five lanes above see a diff and a window. This arm sees a checkout and five tools, and it is the arm the
     * competitor's design implies - see `internal/config/template/prompts/` in `alibaba/open-code-review`: a grouping
     * call, a plan of risks with the tool calls that would settle each one, a main loop whose prompt is *"when the
     * context is unclear, use tools to obtain contextual information rather than judging based on assumptions"*, and a
     * `code_comment` tool whose `existing_code` field is how a finding gets located at all.
     *
     * **Its findings replace the lanes' findings for this pull request**, rather than being added to them: two reviewers
     * scored as one is a figure about neither, and the arm exists to answer whether reading the code moves the number.
     *
     * **What it cannot do is comment outside the change.** `allowOffDiff: false` here even though the agent supports it,
     * because a comment on an unchanged line cannot be posted and the competitor's own filter removes exactly those -
     * `Ground A` of `review_filter_task_user.md`. Scored with them, this arm would be measured on a rule the other arm
     * is not held to.
     */
    let agentResult = null;
    if (AGENT) {
      const started = Date.now();
      try {
        const { ReviewAgent } =
          await import('../../packages/intelligence/dist/review/agent/review-agent.js');
        const { DirectoryRepository } =
          await import('../../packages/intelligence/dist/review/agent/repository.js');
        const changedDiffs = new Map(
          sections.map((section) => [section.path, section.lines.join(String.fromCharCode(10))]),
        );
        const checkout = pullHead === null ? null : checkoutAt(pr.githubPrUrl, pullHead.sha);
        let repository = null;
        if (checkout !== null) {
          repository = new DirectoryRepository({ root: checkout, changed: changedDiffs });
        } else if (fileTexts.size > 0) {
          // **The fallback the API already paid for**: the changed files, and nothing else. A run whose clone failed
          // still reviews, and the artifact says which repository it reviewed with.
          const { MappedRepository } =
            await import('../../packages/intelligence/dist/review/agent/repository.js');
          repository = new MappedRepository({ files: fileTexts, changed: changedDiffs });
        }
        if (repository === null) {
          agentCounters.firstFailure =
            'no repository: the clone failed and no file was readable through the API';
        } else {
          const agent = new ReviewAgent(new DeepSeekProvider({ ledger, ceilingUsd: MAX_USD }), {
            // **The measured arm, imported rather than spelled out.** These four values were written here as literals
            // alongside another copy in `pr-review.ts`, and the copies had already diverged on `allowOffDiff` - so the
            // published figure described a configuration no product path offered. `BASELINE_AGENT_OPTIONS` is the one
            // place the measured arm is defined, and the shipped arm is that plus one declared key.
            ...BASELINE_AGENT_OPTIONS,
            maxFindingsPerFile: MAX_FINDINGS_PER_FILE,
            // **`DEFAULT_AGENT_LIMITS` rather than another copy of it**, so a change to the budget moves the arm and the
            // artifact together: `configuration.agentLimits` below records what actually ran, which is what keeps a
            // moved default visible in the figure rather than inferred from a date.
            limits: { ...DEFAULT_AGENT_LIMITS },
            tag: 'aacr-agent',
          });
          const outcome = await agent.review({
            repository,
            changedPaths: sections.map((section) => section.path),
          });
          agentCounters.pulls += 1;
          agentCounters.modelCalls += outcome.ledger.modelCalls;
          agentCounters.toolCalls += outcome.ledger.toolCalls;
          agentCounters.readChars += outcome.ledger.readChars;
          agentCounters.groundingReads += outcome.ledger.groundingReads;
          agentCounters.disambiguated += outcome.ledger.disambiguated;
          agentCounters.filtered += outcome.ledger.filtered;
          // **The number that tells a broken loop from a quiet reviewer.** The first run of this arm filed no finding over
          // 36 pull requests, and the artifact carried no field that could say whether the model had called
          // `file_comment` and been refused, or had never got to it. `draftsFiled` was declared in this object and never
          // written, which is the same defect as a counter that does not exist.
          agentCounters.draftsFiled += outcome.ledger.draftsFiled;
          for (const line of outcome.trace) {
            if (agentCounters.trace.length >= 60) break;
            agentCounters.trace.push(
              `${String(pr.githubPrUrl).replace('https://github.com/', '')} ${line}`,
            );
          }
          for (const drop of outcome.drops) {
            agentCounters.drops[drop.reason] = (agentCounters.drops[drop.reason] ?? 0) + 1;
          }
          for (const account of outcome.accounts) {
            agentCounters.accounts[account.status] =
              (agentCounters.accounts[account.status] ?? 0) + 1;
            if (account.status === 'unaccounted' && agentCounters.unaccountedPaths.length < 20) {
              agentCounters.unaccountedPaths.push(`${String(pr.githubPrUrl)} ${account.path}`);
            }
          }
          agentResult = {
            outcome,
            findings: outcome.comments.map((comment) => ({
              finding: {
                path: comment.path,
                startLine: comment.startLine,
                endLine: comment.endLine,
                severity: comment.severity,
                category: comment.category,
                title: String(comment.content).split(String.fromCharCode(10))[0].slice(0, 160),
                description: comment.content,
                suggestion: comment.suggestionCode ?? null,
                lane: 'agent',
              },
              path: comment.path,
            })),
            repository: checkout === null ? 'api' : 'checkout',
            elapsedMs: Date.now() - started,
          };
        }
      } catch (error) {
        // **A failure is a fact in the artifact**, not an arm that quietly reviewed nothing: the same rule the competitor
        // arm follows, for the same reason.
        agentCounters.firstFailure = String(error?.message ?? error).slice(0, 300);
      }
    }

    // **The per-file findings, each with the path its line numbers belong to.**
    //
    // **`l.findings` alone loses the one thing the ranking needs.** A lane reviews one file and its findings carry line
    // numbers in that file; **the path lived on the result rather than on the finding**, so a flattened list of findings
    // could not be grounded against any diff - which is the same shape of loss as the golden path that was handed to
    // the engine three runs ago.
    // **And the lane each finding came from, which this expression dropped until iteration 145.** The result carried
    // `lane`, the finding did not, so every row of the artifact's `rankedFindings` published `lane: null` - 1 109 of
    // them on the discovery run - and *"which lane earns its 5 785 calls"* was unanswerable from the artifact that paid
    // for them. The flattening is a named function now, because it is where the attribute was lost and a named function
    // is the only version of it a test can call.
    const laneLocated = locateLaneFindings(lanes);
    let located = laneLocated;
    // **The agent's findings, when the arm ran.** Replaced rather than merged: a figure over two reviewers at once is a
    // figure about neither. **`AACR_ENSEMBLE=on` is the exception that gets measured**, and it is an exception precisely
    // because the two reviewers' overlap was measured first: 93 goldens in common out of 276, so a merged list is a list
    // about both rather than a list about neither.
    if (agentResult !== null)
      located = ENSEMBLE ? [...laneLocated, ...agentResult.findings] : agentResult.findings;

    // **ARM THREE: the same findings, ordered by the probability a developer would act on them.**
    //
    // **Why an order and not a filter.** *Sifting the Noise* (arXiv 2601.22952) measured aggressive filtering
    // suppressing 22% of true vulnerabilities, so **nothing here is dropped before it is judged** - every finding is
    // scored, every pair is judged, and **the emission rule is scored as a subset of a matrix that already contains
    // everything**, which means the figures for the rule and the figures for the raw list come from one pass.
    let ranked = rankFindings(located, prFacts);
    /**
     * **The merge runs after ranking and before judging**, and both halves of that are decisions.
     *
     * After ranking, because the fallback and the over-budget cut are score-ordered and a merge that ran on unscored
     * candidates would have no order to fall back to. **Before judging, because a candidate the merge removes is a pair
     * that never has to be paid for** - the judge is the expensive half of this arm, and the merge is the only device in
     * it that removes work.
     */
    if (mergeCounters.enabled && agentResult !== null) {
      try {
        const { mergeReviewers, MERGE_BUDGET_PER_PULL_REQUEST } =
          await import('../../packages/intelligence/dist/review/merge-reviewers.js');
        const candidates = ranked.map((entry, at) => ({
          ref: `c${String(at)}`,
          source: entry.finding.lane === 'agent' ? 'reader' : 'lanes',
          path: entry.path,
          line: entry.finding.startLine ?? 0,
          category: String(entry.finding.category ?? 'unknown'),
          score: entry.score.score,
          text: `${String(entry.finding.title)} :: ${String(entry.finding.description)}`,
        }));
        const lanesSide = candidates.filter((entry) => entry.source === 'lanes');
        const readerSide = candidates.filter((entry) => entry.source === 'reader');
        if (lanesSide.length > 0 && readerSide.length > 0) mergeCounters.unionPulls += 1;
        const mergeProvider = new DeepSeekProvider({ ledger, ceilingUsd: MAX_USD });
        const merged = await mergeReviewers({
          lanes: lanesSide,
          reader: readerSide,
          provider: mergeProvider,
          budget: MERGE_BUDGET_PER_PULL_REQUEST,
          tag: 'aacr-merge',
        });
        const keep = new Set(merged.kept.map((entry) => entry.ref));
        const before = ranked.length;
        ranked = ranked.filter((_, at) => keep.has(`c${String(at)}`));
        mergeCounters.pulls += 1;
        mergeCounters.calls += merged.calls;
        // **From the outcome rather than from the caller's two lists**, so the artifact's `sides` is what the merge itself
        // was given - a harness that counted its own arrays could report a union the device never saw.
        mergeCounters.sides.lanes += merged.sides.lanes;
        mergeCounters.sides.reader += merged.sides.reader;
        mergeCounters.paths[merged.decidedBy] += 1;
        mergeCounters.kept += ranked.length;
        mergeCounters.candidates += before;
        for (const drop of merged.dropped) {
          mergeCounters.dropped[drop.reason] = (mergeCounters.dropped[drop.reason] ?? 0) + 1;
        }
        if (merged.decidedBy === 'fallback' && mergeCounters.fallbackReasons.length < 10) {
          mergeCounters.fallbackReasons.push(
            `${String(pr.githubPrUrl).replace('https://github.com/', '')} ${merged.detail}`,
          );
        }
      } catch (error) {
        mergeCounters.firstFailure = String(error?.message ?? error).slice(0, 300);
      }
    }
    // **What the profile removed, counted once per category with its reason**, and **applied to the ranked list rather
    // than to the judged matrix**: every finding is still scored and still judged, so the curve below remains a curve
    // over the full emission and the profile is one cut of it - the same discipline the actionability gate follows.
    const profile = applyEmissionProfile(ranked, PROFILE);
    const profileKept = new Set(profile.kept);
    for (const entry of profile.dropped) {
      const counts = engineCounters.profile.dropped;
      counts[entry.category] = (counts[entry.category] ?? 0) + entry.count;
      engineCounters.profile.reasons[entry.category] = entry.reason;
    }
    const ourMatrix = await judgeMatrix(
      ranked.map((entry) => `${entry.finding.title} :: ${entry.finding.description}`),
      issueTexts,
    );
    unanswered += ourMatrix.unanswered;
    // **And why each golden that was not hit was not hit**, in the same pass and at no additional cost: the verdicts are
    // already paid for, the diff sections are already in hand, and **the only thing this needs is the coordinates the
    // corpus already carries.** The five buckets are disjoint and their sum is asserted inside `attributeGoldens`, so a
    // refactor that loses a row fails here rather than producing a table that reads plausibly and adds up wrong.
    // **The registered operating point, computed once and used by both the headline and the corpus's arithmetic.** A
    // second call to `shippedRuleKeep` would be a second rule, and two figures about two rules is how a run reports a
    // comparison between itself and itself. **The pull-request key is passed rather than implied**, because the budget
    // counts twelve per pull request and a run-wide count would be a different rule with a better score.
    const shippedCut = keepUnder(SHIPPED_EMISSION_STEPS, ranked, competitorKey, profileKept);
    const shippedKeepFlags = shippedCut.keep;
    for (const entry of shippedCut.droppedByPathClass) {
      engineCounters.emissionPathDrops[entry.pathClass] =
        (engineCounters.emissionPathDrops[entry.pathClass] ?? 0) + entry.count;
    }
    // **The pull request's own file list, one request before the attribution**, because the difference between *the
    // corpus moved* and *this run dropped a file* is the difference between no work and a filter to fix. A refusal
    // leaves the older reading in place rather than emptying the list.
    engineCounters.snapshot.requested += 1;
    const pullPaths = await fetchPullPaths(pr.githubPrUrl);
    if (pullPaths.ok) engineCounters.snapshot.ok += 1;
    else {
      engineCounters.snapshot.failed += 1;
      if (engineCounters.snapshot.reasons.length < 3) {
        engineCounters.snapshot.reasons.push({ pr: competitorKey, reason: pullPaths.reason });
      }
    }
    const attribution = attributeGoldens({
      goldens,
      pullPaths: pullPaths.ok ? pullPaths.paths : null,
      reviewedPaths: sections.map((section) => section.path),
      findings: ranked,
      matches: ourMatrix.matches,
    });
    engineCounters.snapshot.moved += attribution.counts.pathNotInPull;
    attributed.push({ pr: competitorKey, ...attribution });

    // **Both arms, in the shape the corpus's arithmetic reads**, so the figure beside the headline is about the same
    // comments rather than about a second review nobody ran.
    fileSemanticPulls.our.push({
      findings: ranked.map((entry) => ({ path: entry.path, text: String(entry.finding.title) })),
      goldens,
      matches: ourMatrix.matches,
      keep: shippedKeepFlags,
    });

    // **And the goldens we were in the right file for and did not say the same thing about.** The nearest comment on the
    // golden's own path is chosen by line distance, because "we stood on the line and said something else" is a wording
    // defect and "we discussed the other end of the file" is a targeting one - and **the two have different repairs**.
    const covered = new Set(ourMatrix.matches.flat());
    // **Keyed by the same normalisation the attribution uses**, because a diff path and an annotation path are the same
    // file written by two tools - and a lookup that missed would silently report that we never spoke on a file we did.
    const byPath = new Map();
    ranked.forEach((entry, at) => {
      const key = normalisePath(entry.path);
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push({ entry, at });
    });
    goldens.forEach((golden, index) => {
      if (covered.has(index)) return;
      const onPath = byPath.get(normalisePath(golden.path));
      if (onPath === undefined || onPath.length === 0) return;
      const here = golden.startLine ?? 0;
      const nearest = onPath.reduce(
        (best, candidate) => {
          const distance = Math.abs((candidate.entry.finding.startLine ?? 0) - here);
          return distance < best.distance ? { ...candidate, distance } : best;
        },
        { ...onPath[0], distance: Number.POSITIVE_INFINITY },
      );
      rejectedGoldens.push({
        pr: competitorKey,
        path: golden.path,
        startLine: golden.startLine,
        // **The corpus's own sentence and ours**, because a bucket count cannot distinguish "we looked for the wrong
        // thing" from "we said the right thing in words the judge would not call the same defect".
        note: String(golden.note).slice(0, 260),
        ours: String(nearest.entry.finding.title).slice(0, 200),
        oursStartLine: nearest.entry.finding.startLine ?? null,
        distance: Number.isFinite(nearest.distance) ? nearest.distance : null,
        accepted: nearest.at !== undefined && ourMatrix.matches[nearest.at].length > 0,
      });
    });
    ranked.forEach((entry, at) => {
      rankedDetail.push({
        pr: pr.githubPrUrl ?? null,
        path: entry.path,
        startLine: entry.finding.startLine,
        endLine: entry.finding.endLine,
        severity: entry.finding.severity,
        category: entry.finding.category,
        lane: entry.finding.lane ?? null,
        score: entry.score.score,
        actionable: entry.score.actionable,
        features: entry.score.features,
        scoreTerms: entry.score.scoreTerms,
        why: entry.score.why,
        which: 'agentix-e',
        // **The sentence itself, because a rejection is a claim about wording and this artifact could not show one.**
        //
        // `findingOnPathRejected` was 98 of 170 goldens on 2026-11-10 and **73 of those 98 sit within ten lines of a
        // finding we emitted** - so the loss is not that the lane looked elsewhere, it is that what the lane said was
        // not accepted as the same defect. **An artifact that records the coordinates and not the sentence can report
        // that fact and cannot let anyone check it**, which is the same omission as the discarded `path` one iteration
        // earlier, one level up. The text is charged to nothing: it was already in memory and already paid for.
        text: `${entry.finding.title} :: ${entry.finding.description}`.slice(0, 320),
        matchedGoldens: ourMatrix.matches[at],
      });
    });
    perPr.push({
      key: pr.githubPrUrl ?? `pr-${perPr.length}`,
      matches: ourMatrix.matches,
      goldens: issueTexts.length,
      // **Which goldens this run covered, so two runs can be paired.** The key is the pull request plus the index
      // within that pull request's goldens, which is stable while the corpus and its order are - and **a paired test
      // between two runs is only honest if the pairing key is the same one the within-run test uses.**
      // **The emission rule, fixed before the run and applied per finding** - so the operating point is a statement
      // about a comment rather than a budget chosen from the curve below it.
      //
      // **And the rule differs by reviewer, which is §23.7's decision rather than a convenience.** For the five lanes it
      // is the actionability gate *and* the category profile's floor, because **the two conditions are one operating
      // point** - reporting the gate at one profile and the count at another would make the artifact's precision a figure
      // about a reviewer nobody ran. For the reading arm it is the arm's own filing check, because that check is stricter
      // about evidence than the gate is (the quoted code must be located in the file, or in the diff when the file could
      // not be read) and because **the gate's second conjunct asks for a suggestion or a quotation of an added line, which
      // is a lane's shape rather than a reader's**: on `43176459822` it dropped 48 findings that had found a golden and
      // took the arm from F1 0.2092 to 0.0523.
      keep: shippedKeepFlags,
      // **And the same rule kept, for the arm it was calibrated on, even when it is not the one that ships.** §23.7
      // scoped the actionability gate to the lanes because it was taking three quarters of the reading arm's score, and
      // **a scoping that also deleted the comparison would make the cost of the gate invisible in every future run** -
      // which is the failure mode of a decision made once and never re-checked. One boolean per finding, already
      // computed, charged to nothing.
      laneGateKeep: laneRuleKeep(ranked, profileKept),
      // **And the same findings under the policy §106 replaced.** Printed beside the headline rather than remembered, so
      // **the two rows differ in one step and not in the day** - which is the only way a policy change can be read as a
      // change rather than as noise between two dispatches.
      previousKeep: previousRuleKeep(ranked, competitorKey, profileKept),
      // **Index-aligned with `matches` and `keep`**, because the only way to attribute an owned golden to a category is
      // to look up the finding that owns it - and `goldenOwners` answers with a position in this very list.
      categories: ranked.map((entry) => entry.finding.category),
    });

    // **And the same judging, for the whole-pull-request arm.**
    //
    // **A separate matrix over the same goldens**, because **the whole-PR arm's findings are a different set and must be
    // scored independently** - **sharing one matrix would let the two arms consume each other's goldens and report a sum
    // as if it were a maximum.**
    const wholeMatrix = await judgeMatrix(
      wholePrFindings.map((f) => `${String(f.title ?? '')} :: ${String(f.description ?? '')}`),
      issueTexts,
    );
    unansweredWhole += wholeMatrix.unanswered;
    const wholeCovered = maximumMatchingCount(wholeMatrix.matches, issueTexts.length);
    tpWhole += wholeCovered;
    fpWhole += wholePrFindings.length - wholeCovered;
    fnWhole += issueTexts.length - wholeCovered;

    // **And the pull-request arm's own order**, so its curve and the paired test are arithmetic over verdicts that
    // were already judged rather than a second run with a second set of samples.
    const prRanked = rankFindings(
      wholePrFindings.map((finding) => ({ finding, path: String(finding.path ?? '') })),
      prFacts,
    );
    const detailOf = new Map(wholePrFindings.map((finding, at) => [finding, at]));
    prRanked.forEach((entry) => {
      const at = detailOf.get(entry.finding);
      prArmDetail.push({
        pr: pr.githubPrUrl ?? null,
        path: entry.path,
        startLine: entry.finding.startLine,
        endLine: entry.finding.endLine,
        severity: entry.finding.severity,
        category: entry.finding.category,
        lane: entry.finding.lane ?? null,
        score: entry.score.score,
        features: entry.score.features,
        scoreTerms: entry.score.scoreTerms,
        which: 'agentix-e-pull-request',
        matchedGoldens: at === undefined ? [] : wholeMatrix.matches[at],
      });
    });
    prArmPerPr.push({
      key: pr.githubPrUrl ?? `pr-${prArmPerPr.length}`,
      // **Re-ordered the same way as the detail**, because a curve cut from a different order than the one reported is
      // a budget two readers cannot reproduce.
      matches: prRanked.map((entry) => {
        const at = detailOf.get(entry.finding);
        return at === undefined ? [] : wholeMatrix.matches[at];
      }),
      goldens: issueTexts.length,
    });
  }

  // **The record is written once, after the loop**, so a run that dies at the eleventh pull request leaves the previous
  // file intact and the eleven rows it paid for are the only thing lost. **And the write says whether the record covers
  // the corpus** - a file with a hole in it replays as a corpus with a hole in it, and the next reader should meet that
  // fact here rather than in a figure that is quietly computed over thirteen of fourteen pull requests.
  if (competitorChoice.mode === 'record' && recordedAny > 0) {
    // **The header is recomputed from the rows it describes**, because a record that replays rows it did not buy cannot
    // describe itself by what the run did: the file of 2026-11-12 said "32 recorded, 14 transcribed" and listed four
    // holes, one of which the run had just closed.
    competitorBaseline = refreshProvenance(
      { ...competitorBaseline, recordedAt: new Date().toISOString() },
      { selection: rows.map((row) => row.githubPrUrl), run: new Date().toISOString().slice(0, 10) },
    );
    writeBaseline(COMPETITOR_BASELINE_PATH, competitorBaseline);
    competitor.baselineRecordedAt = competitorBaseline.recordedAt;
    competitor.baselineCovers = {
      pullRequests: Object.keys(competitorBaseline.pulls).length,
      ofCorpus: rows.length,
      complete: Object.keys(competitorBaseline.pulls).length >= rows.length,
    };
    console.log(
      `AACR-BENCH competitor baseline written to ${COMPETITOR_BASELINE_PATH} ` +
        `(${String(Object.keys(competitorBaseline.pulls).length)}/${String(rows.length)} pull requests)`,
    );
  }

  // ---------------------------------------------------------------------------
  // From the judged matrices to the figures
  // ---------------------------------------------------------------------------
  //
  // **Every number below is arithmetic over verdicts that were already paid for.** The judging pass produced, per pull
  // request, which goldens each finding matched; a maximum matching turns that into what that set of findings covers,
  // and the same matrix answers the curve, the emission rule and the paired test. **Nothing below calls the judge.**
  const round = (x) => Math.round(x * 10000) / 10000;
  const zero = { tp: 0, fp: 0, fn: 0 };
  const addCounts = (a, b) => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });

  /** Every finding the reviewer emitted, which is the operating point the earlier runs measured. */
  const everythingEmitted = (pull) => ({
    indices: matchedGoldenIndices(pull.matches, pull.goldens),
    emitted: pull.matches.length,
  });

  /**
   * **The rule that ships**: the registered actionability gate for the lanes, the arm's own filing check for the reading
   * arm, which is `keep` as the per-pull request row recorded it. §23.7 has the measurement that moved the arm's rule.
   */
  const gatedEmission = (pull) => {
    const kept = pull.matches.filter((_, at) => pull.keep[at]);
    return { indices: matchedGoldenIndices(kept, pull.goldens), emitted: kept.length };
  };

  /**
   * **And the rule the lanes were calibrated under, scored on the reading arm's own findings anyway.**
   *
   * A scoping decision that stops being re-measured is a decision that can quietly become wrong, so the cost of the gate
   * stays in the artifact: `laneGate` is the same findings under `actionable AND profile`, and the difference between it
   * and the headline is what the arm pays for not being a lane.
   */
  const laneGateEmission = (pull) => {
    const kept = pull.matches.filter((_, at) => pull.laneGateKeep[at]);
    return { indices: matchedGoldenIndices(kept, pull.goldens), emitted: kept.length };
  };

  /**
   * **The point every figure before §106 was filed under, recomputed from this run's own findings.**
   *
   * `shipped` is `drop test, drop path test, budget 12` and this is `drop test, budget 12`: one step apart, one pool, one
   * judge. **A run that printed only the new number would make its own history unreadable**, because the reader would
   * have no way to tell a device from a corpus that moved.
   */
  const previousEmission = (pull) => {
    const kept = pull.matches.filter((_, at) => pull.previousKeep[at]);
    return { indices: matchedGoldenIndices(kept, pull.goldens), emitted: kept.length };
  };

  const countsOver = (perPull, rule) =>
    perPull.reduce((total, pull) => {
      const covered = rule(pull);
      return addCounts(total, {
        tp: covered.indices.length,
        fp: covered.emitted - covered.indices.length,
        fn: pull.goldens - covered.indices.length,
      });
    }, zero);

  const asPoint = (counts) => point(counts.tp + counts.fp, counts.tp, counts.fp, counts.fn);

  // **Our operating point, the rule that was fixed before the run and the rule the product would use.**
  const gatedCounts = perPr.reduce((total, pull) => {
    const scored = scoreSubset(pull.matches, pull.keep, pull.goldens);
    return addCounts(total, {
      tp: scored.truePositives,
      fp: scored.falsePositives,
      fn: scored.falseNegatives,
    });
  }, zero);
  const gated = asPoint(gatedCounts);
  const allCounts = countsOver(perPr, everythingEmitted);
  const allEmitted = asPoint(allCounts);
  // **And what the lanes' rule would have done to the same findings**, so §23.7's scoping is re-measured every run rather
  // than argued once. Under the lanes' rule `keep` and `laneGateKeep` are the same vector and this is the same point.
  const laneGate = asPoint(countsOver(perPr, laneGateEmission));
  const previousShippedPoint = asPoint(countsOver(perPr, previousEmission));

  /**
   * **The corpus's arithmetic, applied to the verdicts this run already bought.**
   *
   * The `keep` filter is applied *before* the walk, because the operating point is a statement about which comments the
   * reviewer files: scoring every comment and then reporting a subset would let a comment the rule never files cover a
   * golden, which is a recall for a reviewer nobody ran.
   */
  const fileSemanticOf = (pulls) =>
    scoreCorpusFileSemantic({
      pulls: pulls.map((pull) => {
        const kept = pull.findings
          .map((_, index) => index)
          .filter((index) => pull.keep[index] === true);
        return {
          findings: kept.map((index) => pull.findings[index]),
          goldens: pull.goldens,
          matches: kept.map((index) => pull.matches[index]),
        };
      }),
    });
  const fileSemanticOur = fileSemanticOf(fileSemanticPulls.our);
  // **The competitor's arm, only when it ran**, because a figure of zero for an arm that was switched off is a
  // comparison with a competitor who said nothing - and that is the same defect as a missing row counted as a zero.
  const fileSemanticCompetitor =
    fileSemanticPulls.competitor.length === 0 ? null : fileSemanticOf(fileSemanticPulls.competitor);

  // **Sixty of the rejected goldens, at a stride, with the corpus's sentence beside ours.** The first sixty would be the
  // first six pull requests and a distribution read off them would be a distribution of the alphabet.
  const GOLDEN_DIAGNOSIS_SAMPLES = 60;
  const goldenDiagnosisStride = Math.max(
    1,
    Math.ceil(rejectedGoldens.length / GOLDEN_DIAGNOSIS_SAMPLES),
  );
  const goldenDiagnosis = rejectedGoldens.filter((_, at) => at % goldenDiagnosisStride === 0);

  /**
   * **The measurement's own error, as an interval rather than as a footnote.**
   *
   * A pair the judge did not answer is neither a match nor a miss, and this job counts it as a miss - which is the only
   * thing it *can* do to produce a single number, and **which is wrong in a direction nobody can see from the figure
   * alone.** The run of 2026-11-09 left **183 pairs unanswered out of roughly 3 800**, and the competitor's arm left
   * none; **so the two arms of that run did not carry the same error, and the comparison was published as if they did.**
   *
   * **The bound is deliberately loose and is labelled as a bound.** Treating every unanswered pair as a match would give
   * one finding credit for several goldens, so the upper end overstates what a perfect judge could do; **the point is not
   * to estimate the true figure but to state how far it could be from the reported one.** When the interval is narrow the
   * reported figure is a measurement; when it is wide, the run needs a judge that answers.
   */
  const judgedInterval = (counts, unansweredPairs) => {
    const goldens = counts.tp + counts.fn;
    const highest = Math.min(counts.tp + Number(unansweredPairs ?? 0), goldens);
    // `k` is what the reviewer emitted, and it does not move: the judge decides which of those are true, not how many
    // there were.
    const upper = point(
      counts.tp + counts.fp,
      highest,
      counts.tp + counts.fp - highest,
      goldens - highest,
    );
    return {
      unansweredPairs: Number(unansweredPairs ?? 0),
      f1IfEveryUnansweredPairIsAMiss: asPoint(counts).f1,
      f1IfEveryUnansweredPairIsAMatch: upper.f1,
    };
  };

  /**
   * **The curve, at budgets a reviewer could actually hold to.**
   *
   * **Per pull request rather than over the concatenation**, because **a budget is a number of comments on one pull
   * request** - sorting all 105 findings into one list and cutting at forty would mean the corpus-wide cut, which is not
   * a rule any reviewer follows. `k` here is therefore "the top k of each pull request", and `0` is everything.
   */
  const BUDGETS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 0];
  const byBudget = BUDGETS.map((budget) => {
    let total = zero;
    for (const pull of perPr) {
      const curve = topKCurve(pull.matches, pull.goldens);
      const at = budget === 0 ? curve.length : Math.min(budget, curve.length);
      const chosen = curve[at - 1];
      if (chosen) {
        total = addCounts(total, {
          tp: chosen.truePositives,
          fp: chosen.falsePositives,
          fn: chosen.falseNegatives,
        });
      }
    }
    return { budgetPerPullRequest: budget === 0 ? null : budget, ...asPoint(total) };
  });

  /**
   * **The paired test, because the two reviewers were scored on the same goldens.**
   *
   * **A difference between two proportions is not a difference between two proportions drawn on paired data.** The
   * goldens both reviewers found, and the goldens neither found, say nothing about which is better; only the goldens one
   * found and the other did not carry that information, and **the exact binomial tail over those discordant pairs is
   * what McNemar's test is.** With fifty goldens the exact form is the right one - the asymptotic chi-square is an
   * approximation that the corpus is too small to earn.
   */
  /**
   * **The corpus both arms were scored on, and the two figures over it.**
   *
   * The run of 2026-11-11 scored 36 pull requests against a competitor arm that had rows for 33 of them, and published
   * `withheld` - correctly, because one figure was over 36 and the other over 33, and **permanently**, because the
   * competitor's harness fails on a pull request in every run and the rule required all of them. **A precondition that
   * is never satisfied is a decision never to answer.**
   *
   * So the pairing is computed rather than assumed: the pull requests both arms scored, the ones left out with the side
   * that left them out, and **both operating points recomputed over the shared rows** - which is what makes the two F1
   * the same measurement instead of two numbers a reader has to trust are comparable.
   *
   * **And one rule for both.** `goldenDiscordance` takes the emission rule once and applies it to both arms, because
   * the previous pairing counted ours under the registered gate and theirs with every finding it emitted, so their side
   * took credit for findings the rule rejects.
   */
  const pairing = pairedCorpus({ ours: perPr, theirs: competitorPerPr });
  const onSharedRows = (side) => pairing.pairs.map((pair) => pair[side]);
  const pairedOurPoint = asPoint(countsOver(onSharedRows('ours'), gatedEmission));
  const pairedTheirPoint = asPoint(countsOver(onSharedRows('theirs'), gatedEmission));
  const { oursOnly, theirsOnly } = goldenDiscordance(pairing.pairs, gatedEmission);

  // **The head-to-head, computed once, with its own precondition attached.**
  //
  // The run of 2026-11-10 published `McNemar ours-only 83 theirs-only 0 p 0 significant` while its own log said
  // `replayed 0 · recorded 0 · missing 50 · findings 0` - **a shutout against an arm that had produced no rows.** The
  // cause was structural rather than arithmetic: this comparison existed twice, once as `secondReviewer.comparable`
  // (which knew) and once as a bare `mcnemar` (which did not), **and the flattering copy was the one a reader quotes.**
  // There is now one object, it says whether it is allowed to state a verdict, and every reader reads it.
  const scoredPullRequests = Math.max(0, rows.length - unfetched);
  const comparison = compareAgainstCompetitor({
    oursOnly,
    theirsOnly,
    // **`requested - covered` rather than `competitor.missing.length`**, because the two can differ: a pull request
    // this run could not fetch has no competitor row either, and counting it as a hole in the comparison would blame the
    // competitor for a hole in our own fetch.
    coverage: {
      requested: scoredPullRequests,
      covered: competitorPerPr.length,
      missing: Math.max(0, scoredPullRequests - competitorPerPr.length),
    },
    // **The statement that the counts above were restricted to the pairing**, which is what allows a verdict when a
    // pull request is missing and what withholds when the caller forgot to restrict.
    paired: { pullRequests: pairing.pullRequests },
  });

  const competitorCounts = countsOver(competitorPerPr, everythingEmitted);
  const competitorPoint = asPoint(competitorCounts);
  const competitorGated = asPoint(countsOver(competitorPerPr, gatedEmission));

  // **The judge's bill, priced with the reviewer's table and the clock of this run.** `costUsdOf` returns `null` for a
  // model the table does not know, and **`null` is carried rather than turned into a zero** for the reason the ledger
  // carries it: a zero is absorbed by every total it touches.
  const judgeCostUsd = costUsdOf(
    {
      promptTokens: judgeSpend.promptTokens,
      completionTokens: judgeSpend.completionTokens,
      totalTokens: judgeSpend.promptTokens + judgeSpend.completionTokens,
      cacheHitTokens: judgeSpend.cacheHitTokens,
      cacheMissTokens: judgeSpend.cacheMissTokens,
    },
    MODEL,
    new Date(),
  );

  /** The attribution table, computed once and read by both the artifact and the log. */
  const merged = mergeAttributions(attributed);
  const missedGoldens = {
    ...merged,
    largest: largestBucket(merged.counts),
    // **The largest bucket's shape, because "98 rejected" and "73 of them within ten lines of something we said" are
    // different sentences about different work.** The bucket names where the loss is; the shape names whether the fix
    // is the lane's search or the lane's sentence.
    dominantRejectionShape: dominantRejectionShape(merged.rejectionShape),
    pullRequests: attributed.length,
  };
  /** **The interval the reported F1 lives in**, because 183 unanswered pairs are an error bar and not a footnote. */
  const ourInterval = judgedInterval(gatedCounts, unanswered);

  /**
   * **The goldens neither reviewer found, which is the ceiling on this whole exercise.**
   *
   * Three stage pages in a row listed *sample the goldens both arms miss* as the next step and none of them took it,
   * for a reason that was structural rather than lazy: this artifact recorded five examples per bucket out of a hundred
   * and sixty characters each, so **the question could only be asked of a run that was bought again**. The detail is now
   * written down at the point it is computed, which makes the analysis free and - more importantly - makes it something
   * a reader can disagree with, because the notes are in the file.
   *
   * **Both sides are read under one rule.** `gatedEmission` is the operating point the run registered before it started,
   * and applying it to `theirs` as well as to `ours` is the same discipline `goldenDiscordance` follows: a golden the
   * competitor "found" with a finding the rule rejects is not a golden the competitor covered, and counting it as one
   * would make the ceiling smaller than it is by exactly the amount nobody explained.
   *
   * **Only the paired pull requests are counted**, because a pull request the competitor's harness failed on has no
   * `theirs` row at all - and a golden it never scored is indistinguishable from a golden it missed. The size of that
   * exclusion is published beside the list rather than folded into it.
   */
  // **Aligned by object identity rather than by the pull request's key**, because the two lists are built in one loop
  // and the key has a different fallback on each side: `attributed` names a pull request without a URL after
  // `competitorPerPr.length` and `perPr` after `perPr.length`, which are the same number only while the two arrays stay
  // the same length. **A lookup that silently pairs the wrong two rows would report a ceiling about a corpus nobody
  // ran**, and the identity of the row is the one thing that cannot drift.
  const attributionByPull = new Map(perPr.map((pull, at) => [pull, attributed[at]]));
  const bothMissed = [];
  /** How many goldens this analysis had a row for, so that `bothMissed.length` has a denominator. */
  let goldensInPairedPulls = 0;
  /** And how many it did not, because an attribution that is missing is not an attribution of zero. */
  let goldensWithoutAttribution = 0;
  /**
   * **Coverage here is the union of accepted remarks, not the maximum matching, and the difference was worth 20 goldens.**
   *
   * The score uses a maximum matching: one golden, one finding, and a finding that lost a golden to another does not
   * count twice. **The diagnosis is a different question** - *did this reviewer say anything the judge accepted about
   * this golden* - and under the matching's rule a golden we demonstrably commented on is reported as a golden nobody
   * found, because a *different* finding of ours owned it. The first version of this field used the matching for both
   * sides and reported 186 on a slice where the honest figure is 166.
   *
   * **Our own attribution already answers the union question**: `attributeGoldens` files a golden under `hit` when *any*
   * finding was accepted against it, which is the same rule applied to the competitor below - every kept finding's
   * goldens, unioned - so the two sides are read by one sentence instead of two.
   */
  const coveredByUnion = (pull) => {
    const covered = new Set();
    (pull.matches ?? []).forEach((goldens, at) => {
      if (!pull.keep?.[at]) return;
      for (const golden of goldens ?? []) covered.add(golden);
    });
    return covered;
  };
  for (const pair of pairing.pairs) {
    const theirsCovered = coveredByUnion(pair.theirs);
    goldensInPairedPulls += pair.ours.goldens;
    const entry = attributionByPull.get(pair.ours);
    if (entry === undefined) {
      goldensWithoutAttribution += pair.ours.goldens;
      continue;
    }
    for (const golden of entry.perGolden) {
      // **`hit` is this side's union**, so it is read rather than recomputed - and reading it is what keeps the ceiling
      // and the bucket table from disagreeing about the same golden.
      if (golden.bucket === 'hit' || theirsCovered.has(golden.index)) continue;
      bothMissed.push({
        pr: pair.key,
        goldenIndex: golden.index,
        path: golden.path,
        // **The whole note, not the example's hundred and sixty characters**, because the question this list answers is
        // *"is this a defect at all"* and a truncated comment cannot be judged.
        note: golden.note,
        // Which bucket our own attribution put it in, so that a reader can see whether we were silent, rejected, or
        // never sent the file - three different ceilings with three different fixes.
        ourBucket: golden.bucket,
      });
    }
  }

  /**
   * **What each category of remark is worth, measured as emission, because F1 cannot be attributed to a category.**
   *
   * The corpus's goldens are not labelled by category, so a per-category F1 would divide a numerator it does not have
   * by a denominator it does not have. What can be measured without inventing anything is **how often a remark of each
   * category is a remark the judge accepted at all** - and that is the number that decides whether the lane producing it
   * is earning its prompt.
   *
   * `accepted` is a count of findings and `acceptedGoldens` a count of distinct goldens, and **both are stated because
   * they answer different questions**: a category whose findings pile onto one golden has a high `accepted` and a
   * `acceptedGoldens` of one, and the second is the one that matters. **`acceptedGoldens` is not de-duplicated across
   * categories**, so the column does not sum to the run's true positives - it is a reading of where the remarks land,
   * not a decomposition of the score.
   *
   * The gate here is `actionable` rather than `keep`, and under the `advisory` profile the two are the same thing by
   * construction; under `defect` they are not, which `engineCounters.profile` records. **A table that silently used one
   * gate while the run was scored under another is the defect this whole file has been fixing for two iterations.**
   */
  const byCategory = (() => {
    const table = new Map();
    const cellFor = (name) => {
      const key = String(name ?? 'other');
      let cell = table.get(key);
      if (cell === undefined) {
        cell = { category: key, emitted: 0, truePositives: 0, falsePositives: 0 };
        table.set(key, cell);
      }
      return cell;
    };
    let attributedTruePositives = 0;
    for (const pull of perPr) {
      const keptAt = [];
      const kept = [];
      for (let at = 0; at < pull.matches.length; at += 1) {
        if (!pull.keep[at]) continue;
        keptAt.push(at);
        kept.push(pull.matches[at] ?? []);
      }
      const categories = pull.categories ?? [];
      // **Emission is attributed per finding, because every finding was emitted by one lane.**
      for (const at of keptAt) cellFor(categories[at]).emitted += 1;
      // **Coverage is attributed per golden, to the finding the maximum matching gave it.** This is the difference
      // between a breakdown and an estimate: three lanes can each mention the same golden, and only one of them can own
      // it - so counting findings that matched something would put one golden in three categories at once and make the
      // columns add up to more true positives than the run scored.
      const owners = goldenOwners(kept, pull.goldens);
      for (const owner of owners) {
        if (owner === -1) continue;
        attributedTruePositives += 1;
        cellFor(categories[keptAt[owner]]).truePositives += 1;
      }
    }
    const rows = [...table.values()]
      .map((cell) => ({
        category: cell.category,
        emitted: cell.emitted,
        truePositives: cell.truePositives,
        falsePositives: cell.emitted - cell.truePositives,
        // **The share of this category's remarks that carried a golden**, which is the one figure that decides whether
        // the lane producing them is earning its prompt.
        precision: cell.emitted === 0 ? 0 : round(cell.truePositives / cell.emitted),
        // **The share of the run's true positives this category owns**, so that a reader can see whether the volume and
        // the value are the same column. It sums to 1 by construction, which is the property the check below asserts.
        shareOfTruePositives: gatedCounts.tp === 0 ? 0 : round(cell.truePositives / gatedCounts.tp),
      }))
      // **Most emitted first**, because the table's job is to show where the volume is and a sort by precision would
      // rank a category that emitted twice above the one that emitted a hundred and thirty times.
      .sort((a, b) => b.emitted - a.emitted || a.category.localeCompare(b.category));
    return {
      rows,
      /**
       * **The bookkeeping checked against the score, in the file rather than in a report.**
       *
       * `gatedCounts.tp` is counted once, over the covered goldens, by the emission rule; the rows above are counted by
       * asking which finding owns each of them. **Two walks of the same matching that disagree mean one of them is
       * wrong**, and a breakdown that does not add up to the figure beside it is exactly the kind of quiet inconsistency
       * this project keeps finding one iteration later. It is reported rather than thrown, because a run that dies after
       * the money is spent reports nothing - and `scripts/aacr-bench-audit.mjs --check` fails on `agrees: false`.
       */
      totals: {
        attributedTruePositives,
        reportedTruePositives: gatedCounts.tp,
        agrees: attributedTruePositives === gatedCounts.tp,
      },
    };
  })();

  /**
   * **The one figure that is comparable with a defect detector, and the one that is not, said in the file.**
   *
   * Fifty sampled `rejectedGoldens` sorted into three buckets: **five were the same concern in other words, four aimed at
   * the same function with a different focus, and forty-one described something else entirely** - a `const auto&`, a
   * `2.0f`, a commented-out line. This corpus measures *what a human reviewer said*, and roughly three fifths of what
   * they said is a maintainability remark; **an engine that only reports defects is answering a different question, and
   * its F1 against this answer key is a measurement of the question's overlap rather than of the engine.**
   *
   * **So the precision of the defect categories is published beside the headline**, computed from `byCategory` rather
   * than from a second walk: `bug` and `security` are what a defect detector claims, and their precision is the figure
   * that compares with a defect detector's.
   *
   * **Recall is withheld, and the reason is the corpus rather than the arithmetic.** The goldens carry no type label,
   * so there is no subset of *goldens* that a defect-only reviewer could be scored against - a "defect recall" computed
   * by dividing the defect categories' true positives by all 452 goldens would be a number about the mixture, which is
   * the number the headline already reports.
   */
  const defectSubset = scoreDefectSubset({
    rows: byCategory.rows,
    // **The headline beside it**, because the two numbers are only interesting as a pair: one is what a defect detector
    // claims on its own ground, the other is what the mixture costs it.
    wholeEmissionPrecision: gated.precision,
  });

  // **The gate's removals, sampled evenly for the reason the refusals are.**
  if (engineCounters.falsifier.enabled) {
    const stride = Math.max(1, Math.ceil(falsifierDropsSeen.length / FALSIFIER_DROP_SAMPLES));
    engineCounters.falsifier.droppedFindings = falsifierDropsSeen.filter(
      (_, at) => at % stride === 0,
    );
    engineCounters.falsifier.droppedSampled = {
      drawn: engineCounters.falsifier.droppedFindings.length,
      from: falsifierDropsSeen.length,
      stride,
      how: 'every nth removal in corpus order, so the sample is not the first repository',
    };
  }

  // **The refusals, sampled evenly rather than taken from the front** - see `ADJUDICATION_REFUSAL_SAMPLES`.
  if (engineCounters.adjudication.enabled) {
    const stride = Math.max(1, Math.ceil(refusalsSeen.length / ADJUDICATION_REFUSAL_SAMPLES));
    engineCounters.adjudication.refused = refusalsSeen.filter((_, at) => at % stride === 0);
    engineCounters.adjudication.refusedSampled = {
      drawn: engineCounters.adjudication.refused.length,
      from: refusalsSeen.length,
      stride,
      how: 'every nth refusal in corpus order, so the sample is not the first repository',
    };
  }

  write({
    ...base,
    // **The threshold every row below was drawn under**, because **a curve whose points are not labelled is a set of
    // numbers rather than a measurement** - and **this label was missing from the artifact for one run**, which is
    // **how a point loses its coordinate.**
    dedupThreshold: DEDUP_THRESHOLD,
    // **What the top-level figures mean, said in the file rather than in a report about the file.** They are the
    // emission rule's, not the whole list's - and **the whole list's are kept beside them**, because **a rule that is
    // reported without the list it was applied to cannot be checked.**
    scoring: {
      defectSubset,
      protocol:
        'one judge verdict per (finding, golden) pair, then a maximum bipartite matching per pull request; the same protocol for both reviewers in the same job',
      /**
       * **The corpus's own arithmetic, beside the one this job shipped, over the same verdicts.**
       *
       * `Alibaba-Aone/aacr-bench/docs/metrics.md` records the pairwise protocol above as deprecated and defines the
       * file-level semantic one instead: comments grouped by normalised path, **one comment may cover several reference
       * comments**, and precision counts only a comment that covered something nothing before it had (`hit_new_gt`).
       * The two arithmetics differ on this slice by a third of recall, so **every figure this project published under
       * the first one understated coverage** - and the correction costs no model call, because the verdicts are the same
       * verdicts.
       *
       * **What is not equal, and is written here rather than left to be discovered.** Our judge reads one pair at a
       * time; theirs is shown one file's numbered list. This block applies their *arithmetic* to our *verdicts*, so it
       * removes one difference and not the other, and `judge` says which half is ours. A figure from it is comparable
       * with the corpus's in one direction and is not an official score.
       */
      fileSemantic: {
        protocol: fileSemanticOur.protocol,
        judge: fileSemanticOur.judge,
        note: 'the corpus arithmetic over this run’s pairwise verdicts; not an official score, because the judge still sees one pair rather than one file’s list',
        operatingPoint: 'the same findings the headline figures are computed over',
        our: fileSemanticOur,
        competitor: fileSemanticCompetitor,
        // **The distance between the two arithmetics on this very run**, which is the only honest way to say how much of
        // a previously published figure was the protocol rather than the reviewer.
        legacyOur: { precision: gated.precision, recall: gated.recall, f1: gated.f1 },
        counterfactual: {
          recallLostToTheOldArithmetic: fileSemanticOur.recall - gated.recall,
          precisionLostToTheOldArithmetic: fileSemanticOur.precision - gated.precision,
          f1LostToTheOldArithmetic: fileSemanticOur.f1 - gated.f1,
        },
      },
      emissionRule: AGENT
        ? 'the reading arm files only what it can locate: the quoted code must appear in the file at the reviewed commit, or in the diff when the file could not be read (§23.7; the actionability gate is a lane instrument and is reported beside it as emissionRules.laneGate)'
        : 'actionability gate: the range covers an added line AND (the suggestion names an action OR the finding quotes added code), AND the category profile floor',
      emissionRuleRegisteredBeforeRun: true,
      /**
       * **Which of `replayHeadToHead`'s arms the top-level `precision`, `recall` and `f1` were computed over.**
       *
       * `scripts/aacr-paired-replay.mjs --check` recomputes them from `rankedFindings` and fails the job when the two
       * disagree, which is the property that makes a published figure auditable from its own rows. **It used to derive
       * the arm instead of reading it**, and derived `gate` for every run that was not the `defect` profile - so the
       * first hundred-pull-request run of the reading reviewer, whose published F1 was 0.1947, was replayed against the
       * actionability gate's 0.072 and failed for a disagreement that existed only in the checker.
       *
       * **Recorded rather than re-derived here too**, because the same derivation written twice is the defect this
       * field exists to remove: the value below is the one arm whose rule the three figures above are.
       */
      /**
       * **`shipped`, which is the emission policy and not the actionability gate.**
       *
       * §54 moved the headline from the gate to `drop test, budget 12` and **this field went on saying `gate`** - so
       * `aacr-paired-replay.mjs --check` recomputed the gate (0.1997 on the 46 rows of `43775832164`) against a published
       * 0.2148 and the job failed. **The checker was right and the artifact was lying about which rule it published**,
       * which is exactly the defect the field exists to prevent: a reader who cannot reproduce a figure from the rows
       * beside it has no reason to believe the figure.
       */
      // **`shipped` whenever a rule with a budget decided what was posted** - which is the lanes and the merge, and not
      // the single-pass reader, whose own filing check keeps everything it can locate. An ensemble arm that recorded
      // `everything` would be replayed against 1 920 comments it never posted.
      publishedArm:
        ENSEMBLE || !AGENT
          ? 'shipped'
          : PROFILE === 'defect'
            ? 'everything-filtered'
            : 'everything',
      judgeConcurrency: JUDGE_CONCURRENCY,
      /**
       * **Two arms of this engine, one judge, one set of goldens, one job.**
       *
       * The question this run was registered to answer is **where the budget should sit**, and a single figure cannot
       * answer it: the file arm and the pull-request arm are the same five lanes, the same prompts and the same model,
       * differing in the unit of review and the budget's denominator. **The paired test between them is in
       * `armsPairedTest`**, because the two arms read the same pull requests against the same goldens.
       */
      arms: {
        file: 'one call per file per lane, at most 3 findings per file per lane',
        pullRequest: `one call per lane for the whole pull request, at most ${PR_BUDGET} findings for the pull request`,
      },
      registeredRule:
        'the pull-request arm at 16 findings per pull request exceeds the competitor figure of 0.4500 F1 on the same corpus, same judge, same goldens; the file arm stays in the same job as the control',
      pairsJudged:
        perPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0) +
        competitorPerPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0) +
        prArmPerPr.reduce((total, pull) => total + pull.matches.length * pull.goldens, 0),
      weights: ACTIONABILITY_WEIGHTS,
      changedFrom:
        'the previous protocol consumed each golden with the first finding that matched it, in judging order',
    },
    /**
     * **What this run was configured to be, because a figure without its configuration is a figure two runs can
     * disagree about.**
     *
     * The registered comparison of §8 turns exactly one switch, and **this field is how the artifact proves which side
     * of it the number came from** - a report that says "with the checklist" and an artifact that does not say which
     * run was which is a report about an unspecified experiment.
     */
    configuration: {
      languageChecklist: CHECKLIST,
      maxPullRequests: MAX_PRS,
      judgeModel: MODEL,
      judgeEndpoint: BASE,
      dedupThreshold: DEDUP_THRESHOLD,
      pullRequestBudget: PR_BUDGET,
      // **Whether the lanes were shown the block each hunk sits in**, because §20 of `EVAL-CONTRACT.md` is a claim
      // about this switch and **an artifact that does not record which side of it the figure came from is a figure a
      // second run can disagree with without either being wrong.**
      codeContext: CODE_CONTEXT,
      changeShape: CHANGE_SHAPE,
      // **Whether the lanes were told what each changed file reaches** (§100's device, §101's supply), because a figure
      // from either side of this switch is a different reviewer and the artifact has to say which one produced it.
      reach: REACH,
      // **Which arrangement of the prompt produced this figure**, because §9 and §10 of `EVAL-CONTRACT.md` are two
      // claims about one file and an artifact that does not say which side it came from is a figure without a
      // coordinate.
      promptOrder: PROMPT_ORDER,
      // **Which categories this run emitted**, because two runs of the same corpus differing in this field are two
      // reviewers and not one: `defect` drops the categories measured below the floor in `category-prior.ts`, and
      // **`advisory` is what makes the drop measurable** - the same findings, one switch, one artifact each.
      emissionProfile: PROFILE,
      // **Which reviewer produced the figure.** `false` is the five lanes and `true` is `ReviewAgent`, and the two are not
      // comparable as settings of one instrument: they differ in what the model is given, in how many calls it makes and
      // in what a finding must contain to survive. **A figure without this field is a figure with no reviewer attached.**
      agent: AGENT,
      // **Which arm reviewed**, in the field the confound guard reads: `ensemble` on means both reviewers ran and the merge
      // decided, so a pair that varies it varies one device. **Spelled `AGENT && ENSEMBLE` rather than
      // `mergeCounters.enabled`** because this literal is built before the counters exist, and a value read from a binding
      // in its temporal dead zone is a crash rather than a figure.
      ensemble: AGENT ? ENSEMBLE_SETTING : false,
      // **Whether a finding's claim was checked before it was filed**, because this is the arm under test and a figure
      // whose artifact does not name the side of the switch it came from is a figure a second run can disagree with
      // without either being wrong - the defect every other field in this block was added to prevent, one device later.
      adjudicate: ADJUDICATE,
      // **Which form of the second reader produced this figure**, because the two forms share one field for the reason
      // the field exists: a reader of the artifact has to be able to say whether the pool was filtered once per finding
      // or once per file, and `adjudicate: false` cannot say it.
      falsifier: FALSIFY,
      // **Whether the deterministic lane ran**, and which rules it read rather than "some heuristics": a figure from a
      // run with this on and one with it off are two reviewers, and **the rules are named so the next reader can retire
      // one on evidence** - each carries the golden it was derived from.
      idioms: {
        enabled: IDIOMS,
        lane: 'idioms',
        rules: IDIOM_RULE_NAMES,
        why: '41 of 50 sampled missed goldens are remarks the five lanes never attempt, and each is decidable from the syntax of one construct',
      },
      // **Which question the lanes put to each diff, and the list itself rather than its name alone.** R-35 asks whether
      // a lane asked for the value that breaks a line beats a lane asked for test problems; **a comparison that reads
      // only the name would be comparing two artifacts whose reviewer it cannot see**, and one that reads only the list
      // would report a set with no sentence behind it. Both travel, and `variedField` sees one key because they are one
      // object.
      laneSet: { name: LANE_SET, lanes: [...LANE_SETS[LANE_SET]] },
      // **Whether those questions were asked five times or once.** §106's ledger is five almost equal lane bills over
      // one diff, and a device that removes four of them changes the *price* of a figure rather than its meaning - so
      // the axis travels beside `laneSet` and a comparison between two artifacts read both.
      laneMode: LANE_MODE,
      // **Whether a model was asked for the rest of that bucket**, and the families it was asked for rather than "some
      // remarks": **a figure from a run with this on and one with it off are two reviewers**, and a family list that is
      // not in the artifact is a prompt nobody can reproduce.
      // **§59's switch, named in the artifact because a figure from a run with it on and one with it off are two
      // reviewers**: the second keeps a finding whose category differs from the survivor's at the same range, and the
      // arm that publishes reviews differs from the arm behind every earlier figure in exactly this key.
      secondConcern: SECOND_CONCERN,
      remarks: {
        enabled: REMARKS,
        families: REMARK_FAMILY_IDS,
        ceilingPerFile: REMARKS_PER_FILE_CEILING,
        why: '386 of 724 goldens had one of our findings on their own path and were still judged not to address them; 29 of 50 read goldens are maintainability or convention remarks',
      },
      // **The cap that §23.7 measured to bind**: 25 of one run's 225 drafts were refused a slot rather than found
      // wanting. **A figure from a capped run and a figure from an uncapped one are two reviewers**, so the number is a
      // coordinate of the figure beside `agent` rather than a detail of the harness.
      maxFindingsPerFile: MAX_FINDINGS_PER_FILE,
      // **The rest of the arm, recorded rather than implied.** `maxFindingsPerFile` above is the one key the harness
      // varies; every other key of the reviewer is fixed by `BASELINE_AGENT_OPTIONS`, and a figure that names only the
      // varied key cannot say whether the model was shown untouched files or given the default budget. **`shipped`
      // travels beside it** so a reader can see, without opening the source, that the arm which publishes reviews
      // differs from the arm behind this figure in exactly one key and which one.
      agentOptions: {
        baseline: { ...BASELINE_AGENT_OPTIONS, maxFindingsPerFile: MAX_FINDINGS_PER_FILE },
        limits: { ...DEFAULT_AGENT_LIMITS },
        shipped: { ...SHIPPED_AGENT_OPTIONS },
        divergence: [...AGENT_ARM_DIVERGENCE],
      },
      // **The statement of intent the arm was run under, in the artifact rather than in a dispatch log**, so that a
      // later run can tell an arm that was asked to be cheap from one that hit its ceiling.
      competitorMode: COMPETITOR_CHOICE.mode,
    },
    // **How many pull requests the dataset held, not how many this run read.** `prsInDataset` is the run's choice and
    // **a choice cannot be told apart from a limit unless both are recorded.**
    datasetRows: allRows.length,
    prsInDataset: rows.length,
    // **Where in the corpus this run started.** A confirmation is a run of rows the discovery did not see, and the two
    // numbers together are what makes that checkable: 100 at a skip of 50 is a different corpus from 100 at a skip of 0.
    corpusSlice: { skip: SKIP_PRS, requested: MAX_PRS },
    prsReviewed: reviewed,
    /**
     * **Which goldens the registered operating point covered, keyed the way the paired test keys them.**
     *
     * This is what makes a comparison **between two runs** possible at all: run A and run B review the same corpus with
     * the same judge and differ in one configuration flag, and the only thing that carries information about which
     * configuration is better is **the goldens one covered and the other did not**. Without this field the comparison
     * would be two F1 values and a story about them, which is the mistake §6 of `EVAL-CONTRACT.md` was written to
     * stop.
     */
    coverage: {
      protocol: 'per pull request, the golden indices the registered rule covered',
      byPullRequest: perPr.map((pull) => ({
        pr: pull.key,
        goldens: pull.goldens,
        covered: matchedGoldenIndices(
          pull.matches.filter((_, at) => pull.keep[at]),
          pull.goldens,
        ),
        emitted: pull.matches.length,
        // **How many of those comments the rule that ships actually posts**, because `covered` above is already scoped
        // to that rule and a row that carries one without the other cannot be replayed: `emitted` is the full emission,
        // and a checker that divided `covered` by it would report a precision about a reviewer nobody ran.
        shippedEmitted: pull.matches.filter((_, at) => pull.keep[at]).length,
      })),
      coveredTotal: gated.truePositives,
    },
    prsWithoutDiff: unfetched,
    // **How much of the corpus arrived**, as a share rather than a count, because **recall over 38 pull requests is not
    // recall over 50 and the reader has to be able to see that without dividing two numbers**.
    corpusRead: {
      ...unreadCorpus({ requested: rows.length, unread: unfetched }),
      whole: readTheWholeCorpus({ requested: rows.length, unread: unfetched }),
    },
    // **And which, and why.** A count says the corpus shrank; a list says whether to fetch again, fix the URL, or raise
    // the token's budget - and **the three repairs are not interchangeable.**
    prsWithoutDiffReasons: unfetchedPulls,
    positiveSamples: positives.length ?? rows.length,
    negativeSamples: Array.isArray(negatives) ? negatives.length : null,
    truePositives: gated.truePositives,
    falsePositives: gated.falsePositives,
    falseNegatives: gated.falseNegatives,
    judgeUnanswered: unanswered,
    // **And how far the figure above could be from the truth, because 183 pairs went unanswered in the run this
    // section was written for and the competitor's arm carried none.**
    judgedInterval: ourInterval,
    // **Why each missed golden was missed, as five disjoint buckets.**
    //
    // **`recall 0.2059` is a number and not a diagnosis**, and the run of 2026-11-09 could not say whether its 155
    // missed goldens were in files it never read, in files it read in silence, or in files where it spoke about the
    // wrong thing - **three defects whose fixes are a filter, a lane, and a target.** The sum of the buckets is asserted
    // to equal the golden count inside `attributeGoldens`, so this table cannot quietly lose a row.
    missedGoldens,
    /**
     * **The goldens neither reviewer found, with the sentences**, because every stage page since 122 has listed reading
     * them as the next step and the artifact made it impossible. `records` inside `missedGoldens` is the same idea for
     * our own misses: **a bucket count is a diagnosis of the artifact's author, and a list is a claim a reader can
     * check.**
     */
    bothMissed,
    bothMissedCorpus: {
      pullRequests: pairing.pullRequests,
      goldens: goldensInPairedPulls,
      // **The goldens this analysis had no attribution row for**, published rather than folded into the list, because
      // an exclusion a reader cannot see is an exclusion that flatters the number.
      withoutAttribution: goldensWithoutAttribution,
    },
    /** Where the emitted remarks land, per category - the one per-category reading this corpus supports. */
    byCategory,
    precision: gated.precision,
    recall: gated.recall,
    f1: gated.f1,
    /**
     * **The same findings under the rule the lanes were calibrated on, and the rule that ships.**
     *
     * §23.7 found that the actionability gate is a lane instrument: on `43176459822` it kept 24 of the reading arm's 196
     * findings, eight of them true, and took F1 from 0.2092 to 0.0523 - because its second conjunct asks for a suggestion
     * or a quotation of an added line, and **a reviewer that quoted the file it read expresses a defect as a sentence
     * instead.** The gate is therefore scoped to the lanes, and **`laneGate` is the number it would have produced**,
     * recomputed on every run so the decision keeps being measured instead of being remembered.
     */
    emissionRules: {
      shipped: {
        // **The label is derived from the steps the product applies**, so a figure filed under it is the price of the
        // row with that label rather than of a rule this file wrote down beside the arithmetic.
        rule: `${describeEmissionSteps(SHIPPED_EMISSION_STEPS)} (the policy packages/intelligence applies to the comments it posts)`,
        steps: SHIPPED_EMISSION_STEPS,
        point: gated,
      },
      laneGate: {
        rule: 'actionability gate (the range covers an added line AND (a suggestion names an action OR the finding quotes added code)) AND the profile floor',
        point: laneGate,
      },
      /**
       * **The point §106 replaced, computed in the same pass**, because a policy change published alone is a number a
       * reader has to take on trust. The two rows differ in one step - `drop path test` - and in nothing else.
       */
      previousShipped: {
        rule: `${describeEmissionSteps(PREVIOUS_EMISSION_STEPS)} (the policy §106 replaced)`,
        steps: PREVIOUS_EMISSION_STEPS,
        point: previousShippedPoint,
      },
      /** **What the path-class step refused, by class**, because it drops findings whose category the policy keeps. */
      droppedByPathClass: engineCounters.emissionPathDrops,
    },
    // **The list before the rule, because the rule is only interesting beside it.**
    fullEmission: allEmitted,
    // **The curve, at every budget the rule could have been.**
    byBudgetPerPullRequest: byBudget,
    // **The paired test against the competitor at its own operating point, or the reason there is not one.**
    //
    // **`verdict` is `withheld` when the two arms were not scored over the same corpus**, and in that case `theirsOnly`
    // and `pValue` are `null` rather than zero: **a guaranteed zero in a column reads as a shutout**, which is exactly
    // what this field said for a whole iteration while the arm behind it had produced nothing.
    mcnemar: comparison,
    /**
     * **The corpus the head-to-head was computed over, and both operating points on it.**
     *
     * `mcnemar` above says whether a verdict may be stated; this says **what the verdict is about**. Without it a reader
     * takes `pValue` and the two F1 from two different corpora and compares them, which is the failure this field
     * exists to make impossible: **both points below are computed over `pairs`, by the same rule, in one pass.**
     *
     * `excluded` and `theirsOnly` are lists rather than counts because **a pairing hole is a fact about one pull
     * request** - the competitor's harness failing on it, or ours - and a count sends the next person to re-run the
     * whole corpus to find out which.
     */
    pairedCorpus: {
      pullRequests: pairing.pullRequests,
      excluded: pairing.excluded,
      scoredByThemOnly: pairing.theirsOnly,
      emissionRule: AGENT
        ? `the reading arm's own filing rule, applied to both arms`
        : 'the registered actionability gate, applied to both arms',
      ours: pairedOurPoint,
      theirs: pairedTheirPoint,
      // **The same two arms with every finding emitted**, which is what the earlier runs measured and what the
      // competitor's own published figures are. Kept so a comparison to their number is possible without pretending it
      // is this run's registered rule.
      oursEverything: asPoint(countsOver(onSharedRows('ours'), everythingEmitted)),
      theirsEverything: asPoint(countsOver(onSharedRows('theirs'), everythingEmitted)),
    },
    // **The control arm, reported beside the first rather than instead of it.**
    /**
     * **The second arm: one call per lane over the whole pull request, with one budget for the pull request.**
     *
     * **Two arms of one engine, one judge, one set of goldens, one job** - so the two figures differ by the scope and
     * by nothing else. The artifact carries both because **the question this run answers is not "how good is the
     * reviewer" but "where should the budget sit"**, and a single figure cannot answer it.
     */
    pullRequestArm: {
      view: 'one call per lane over the whole pull request, one budget for the pull request',
      budgetPerPullRequest: PR_BUDGET,
      filesPerArm: wholePrLanesTotal,
      findings: wholePrFindingsTotal,
      truePositives: tpWhole,
      falsePositives: fpWhole,
      falseNegatives: fnWhole,
      judgeUnanswered: unansweredWhole,
      precision: round(tpWhole + fpWhole > 0 ? tpWhole / (tpWhole + fpWhole) : 0),
      recall: round(tpWhole + fnWhole > 0 ? tpWhole / (tpWhole + fnWhole) : 0),
      f1: round(
        tpWhole + fpWhole + fnWhole > 0 ? (2 * tpWhole) / (2 * tpWhole + fpWhole + fnWhole) : 0,
      ),
      // **What its own budget did, per pull request**, so a curve over this arm is a cut of the order it reported.
      byBudgetPerPullRequest: BUDGETS.map((budget) => {
        let total = zero;
        for (const pull of prArmPerPr) {
          const curve = topKCurve(pull.matches, pull.goldens);
          const at = budget === 0 ? curve.length : Math.min(budget, curve.length);
          const chosen = curve[at - 1];
          if (chosen) {
            total = {
              tp: total.tp + chosen.truePositives,
              fp: total.fp + chosen.falsePositives,
              fn: total.fn + chosen.falseNegatives,
            };
          }
        }
        const scored = asPoint(total);
        return { budgetPerPullRequest: budget, ...scored };
      }),
      // **And the arm's per-pull-request verdicts**, which is what a paired test against the file arm needs.
      perPullRequest: prArmPerPr.map((pull) => ({
        pr: pull.key,
        findings: pull.matches.length,
        goldens: pull.goldens,
        covered: maximumMatchingCount(pull.matches, pull.goldens),
      })),
      rankedFindings: prArmDetail,
    },
    /**
     * **The paired test between the two arms**, because **they read the same pull requests against the same goldens**
     * and that is exactly the design McNemar's test is for: only the goldens one arm found and the other did not carry
     * information about which arm is better.
     */
    armsPairedTest: (() => {
      const ours = new Set();
      for (const pull of prArmPerPr) {
        for (const at of matchedGoldenIndices(pull.matches, pull.goldens))
          ours.add(`${pull.key}#${at}`);
      }
      const theirs = new Set();
      for (const pull of perPr) {
        for (const at of matchedGoldenIndices(pull.matches, pull.goldens))
          theirs.add(`${pull.key}#${at}`);
      }
      let both = 0;
      let pullRequestOnly = 0;
      let fileOnly = 0;
      for (const key of ours) {
        if (theirs.has(key)) both += 1;
        else pullRequestOnly += 1;
      }
      for (const key of theirs) if (!ours.has(key)) fileOnly += 1;
      return {
        view: 'pull-request arm vs file arm, same pull requests, same goldens, same judge',
        both,
        pullRequestOnly,
        fileOnly,
        pValue: round(exactMcNemar(pullRequestOnly, fileOnly)),
        verdict:
          exactMcNemar(pullRequestOnly, fileOnly) <= 0.05
            ? 'significant at 0.05'
            : 'not significant at 0.05',
      };
    })(),
    reviewCategories: categories,
    /**
     * **What the emission profile removed, in its own counts and with its own reasons.**
     *
     * `configuration.emissionProfile` names the arm; it does not say **what the arm did**. Without this field a reader
     * of the artifact has a precision figure for a reviewer whose gate is described in a TypeScript file at a commit
     * they have to go and find, and **two runs that differ only in this table publish the same configuration line** -
     * which is a comparison between two reviewers reported as two arms of one.
     */
    emissionProfile: {
      name: engineCounters.profile.name,
      dropped: engineCounters.profile.dropped,
      // **Each dropped category's sentence carries the acceptance rate and the floor it was measured against**, so the
      // threshold travels in the reason rather than being written here a second time - **a floor copied into the script
      // is a floor that can disagree with the one the gate used.**
      reasons: engineCounters.profile.reasons,
      appliedTo:
        'the ranked list before judging, so every finding is still scored and the curve is over the full emission',
    },
    // **The context split, which is the reason this corpus was chosen**: `Repo Level` is cross-file by construction.
    groundTruthContextLevels: contextLevels,
    // **The competitor's F1, computed with the same formula over the same goldens** - so **the two numbers are
    // comparable because they were produced by one measurement, not because they were printed side by side.**
    secondReviewer: {
      ...competitor,
      ...competitorPoint,
      /**
       * **Whether the two figures are the same measurement this time.**
       *
       * With the arm replayed, the comparison holds; with rows missing - no baseline, a corpus that moved, a judge that
       * changed - the competitor's side is computed over fewer pull requests than ours, and **a precision stated over a
       * different denominator reads exactly like a worse reviewer**. So the run says which of the two it is, in the same
       * object that carries the figure, rather than leaving the reader to infer it from a count they would have to know
       * to check first.
       */
      // **The same object the artifact's `mcnemar` field carries**, so the figure and the sentence about whether it may
      // be stated cannot disagree - which is the defect that produced a published shutout against an absent arm. The
      // per-row reasons live in `missing[]`; the condition lives in one place.
      comparable: comparison.comparable,
      notComparableReason: comparison.withheldReason,
      /**
       * **The corpus this arm's figures above are over, named in the object that carries them.**
       *
       * `competitorPoint` is every pull request the arm had a row for, under the rule it emitted everything by; the
       * head-to-head is `pairedCorpus`, over the pull requests both arms scored, under the registered gate. **The two
       * are different measurements and a reader must not subtract one from ours** - which is why this field exists
       * rather than a footnote in a report about this file.
       */
      figuresAboveAreOver: 'every pull request with a row, every finding emitted',
      headToHead: 'pairedCorpus',
      pullRequestsWithARow: competitorPerPr.length,
      // **And the same ranker applied to its output**, which separates the two explanations: **if its F1 rises as far
      // as ours did, the gain is the ranker's; if it does not, the sentences were the difference.**
      withTheSameRanker: competitorGated,
      // **Its own interval, on its own unanswered pairs**, so the two arms are read with their own error beside them.
      judgedInterval: judgedInterval(competitorCounts, competitor.judgeUnanswered),
      findingsAtItsOwnOperatingPoint: competitorDetail,
    },
    // **Every finding either reviewer emitted, with its features and the goldens the judge matched it to.**
    //
    // **Why this belongs in the artifact rather than in a log.** The next iteration's first question is *which*
    // findings were wrong and what made them different from the right ones, and **a figure without the rows it was
    // computed from cannot answer it** - so the rows travel, and the curve above can be recomputed from them without
    // another run.
    /**
     * **The goldens we were on the right file for and did not say the same thing about**, as sentences.
     *
     * `findingOnPathRejected` is the largest block a reader can move on this corpus and a count of it implies no repair:
     * **we looked for the wrong thing** and **we said the right thing in words the judge would not call the same
     * defect** are opposite instructions, and the bucket cannot tell them apart. The corpus's note beside the nearest
     * comment of ours can, and both were already in memory.
     */
    rejectedGoldens: {
      protocol: 'the corpus note beside the nearest comment of ours on the same path',
      sampled: {
        drawn: goldenDiagnosis.length,
        from: rejectedGoldens.length,
        stride: goldenDiagnosisStride,
      },
      rows: goldenDiagnosis,
    },
    /**
     * **Every registered cut, scored from the rows below it, inside the artifact that carries them.**
     *
     * §49.3 established that an operating point is arithmetic over `rankedFindings[].matchedGoldens` and that the cut
     * the run was dispatched at is therefore one row of a table, not the only question the artifact can answer. **The
     * CLI could already print that table; the artifact could not carry it**, so the figure a reader meets first is the
     * dispatched cut and every other cut costs a download and a script.
     *
     * **The rows are here and the denominator is the corpus** (`truePositives + falseNegatives` at the published
     * point), which is the property that makes the table replayable: take a row's own `steps`, apply them to the
     * `rankedFindings` in this file, and the number must be the row's. **A table whose rows could not be replayed from
     * its own artifact would be a second place for a figure to live.**
     */
    operatingPoints: operatingPointTable(rankedDetail, gated.truePositives + gated.falseNegatives),
    rankedFindings: rankedDetail,
    // **And the reading after the loop**, so **what the run spent is derivable** and **a draw taken on an empty
    // account is labelled rather than reported as a reviewer's result.**
    credit: { before: creditBefore, after: await creditPosition() },
    // **And what the reviewer itself spent, decomposed by lane**, which is the figure the credit pair cannot produce:
    // a balance delta attributes nothing, and **a bill whose largest line nobody can name is a bill nobody can reduce.**
    // `unpricedCalls` travels with the total because a total containing one is a lower bound.
    spend: {
      ceilingUsd: MAX_USD,
      ...ledger.toJSON().totals,
      byTag: ledger.toJSON().byTag,
      // **The line the ledger could not see.** The judge is a bare `fetch` in this file, so its tokens are counted here
      // and priced with the same table the reviewer is priced with - **one table, two clients**, because two tables is
      // how the reviewer's share of a job became an inference instead of a figure.
      judge: {
        ...judgeSpend,
        costUsd: judgeCostUsd,
        cacheHitRatio:
          judgeSpend.promptTokens === 0
            ? null
            : judgeSpend.cacheHitTokens / judgeSpend.promptTokens,
      },
      // **What the job cost as far as this file can see**, so that the balance delta taken below can be compared with
      // it: **a total that is smaller than the balance by a wide margin says there is a third client.**
      totalUsd: judgeCostUsd === null ? null : ledger.toJSON().totals.costUsd + judgeCostUsd,
    },
    // **The engine's own account of what it did**, because **a figure that says "one finding" without saying "199
    // files and 199 lanes" is a figure whose cause is not in the file.**
    engineCounters,
    // **What the reading arm did, per pull request.** Published beside the figure because the three numbers that explain
    // it are not the cost: **files the review never accounted for**, findings **withheld because the quote was not in the
    // file**, and comments **the filter removed** - a reviewer that improves by reading and one that improves by deleting
    // its own output produce the same F1 and different entries here.
    agent: agentCounters,
    /**
     * **What the repository graph cost and what it was asked for** (§101), published beside the figure it might move.
     *
     * `notesServed` is the device; `pullsWithIndex` is the denominator it was served for; `indexMs` and `filesIndexed`
     * are the price in a currency that is not tokens. **A run whose notes are zero and a run whose checkouts failed
     * produce the same F1**, and only these fields tell them apart.
     */
    reach: reachCounters,
    merge: mergeCounters,
    skipped: null,
  });
  console.log(
    `AACR-BENCH reviewed ${reviewed} PRs · gate tp ${gated.truePositives} fp ${gated.falsePositives} fn ${gated.falseNegatives} · P ${gated.precision} R ${gated.recall} F1 ${gated.f1}`,
  );
  // **The bill, printed beside the figure it bought.** `calls` is the number the reviewer made, `cache` is the share of
  // prompt tokens the provider served from its prefix cache - **the number a prompt reordering has to move, and the one
  // nothing in this repository could report before the ledger existed.**
  console.log(
    `AACR-BENCH spend · calls ${ledger.totals().calls} · failures ${ledger.totals().failures} · unpriced ${ledger.totals().unpricedCalls} · prompt ${ledger.totals().promptTokens} · cache ${ledger.totals().cacheHitTokens} · usd ${ledger.totals().costUsd.toFixed(4)} · ceiling ${MAX_USD}`,
  );
  console.log(
    `AACR-BENCH judge · calls ${judgeSpend.calls} · unanswered ${judgeSpend.failures} (${judgeSpend.rateLimited} rate limited) · prompt ${judgeSpend.promptTokens} · cache ${judgeSpend.cacheHitTokens} · usd ${judgeCostUsd === null ? 'unpriced' : judgeCostUsd.toFixed(4)} · order ${PROMPT_ORDER}`,
  );
  // **Why the goldens were missed, on one line, because it is the line that decides what the next iteration works on.**
  console.log(
    `AACR-BENCH missed · ${GOLDEN_BUCKETS.map((bucket) => `${bucket} ${missedGoldens.counts[bucket]}`).join(' · ')} · f1 in [${ourInterval.f1IfEveryUnansweredPairIsAMiss}, ${ourInterval.f1IfEveryUnansweredPairIsAMatch}]`,
  );
  // **And the largest bucket's shape, which is the line that says whether the next iteration fixes a search or a
  // sentence.** A bucket reported without its shape is a bucket whose two causes are still one number.
  console.log(
    `AACR-BENCH rejected · ${REJECTION_SHAPES.map((shape) => `${shape} ${missedGoldens.rejectionShape[shape]}`).join(' · ')} · dominant ${missedGoldens.dominantRejectionShape === null ? 'none' : `${missedGoldens.dominantRejectionShape.shape} ${missedGoldens.dominantRejectionShape.count}`}`,
  );
  console.log(
    `AACR-BENCH full list tp ${allEmitted.truePositives} fp ${allEmitted.falsePositives} · P ${allEmitted.precision} R ${allEmitted.recall} F1 ${allEmitted.f1}`,
  );
  console.log(
    `AACR-BENCH competitor ${competitor.tool} · ${competitor.mode} · replayed ${String(competitor.replayed)} (${String(competitor.verifiedBy.fingerprint)} by goldens, ${String(competitor.verifiedBy.count)} by count) · recorded ${String(competitor.recorded)} · missing ${String(competitor.missing.length)} · findings ${competitor.findings} · P ${competitorPoint.precision} R ${competitorPoint.recall} F1 ${competitorPoint.f1} · same ranker F1 ${competitorGated.f1}`,
  );
  // **One line, derived from the object rather than from the counts**, because a console line assembled from the raw
  // counts keeps printing a shutout after the artifact has stopped - which is the state this run was in for an iteration.
  const unreadLine = describeUnread({
    requested: rows.length,
    unread: unfetched,
    pulls: unfetchedPulls,
  });
  if (unreadLine !== null) console.log(`AACR-BENCH ${unreadLine}`);
  console.log(`AACR-BENCH ${describeComparison(comparison)}`);
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  // **`finishedAt` is added here rather than at the call sites**, so that every path out of this script - a result, a
  // skip, a shutout - carries the stamp, and a file without one is a file this script did not finish writing.
  const stamped = {
    ...payload,
    provenance: { ...(payload.provenance ?? {}), finishedAt: new Date().toISOString() },
  };
  writeFileSync(
    resolve(process.cwd(), 'benchmarks', 'aacr-bench.json'),
    JSON.stringify(stamped, null, 2) + '\n',
  );
}

main().catch((error) => {
  console.error('AACR-BENCH failed:', error && error.message);
  /**
   * **Where it failed, because a message is not a location.**
   *
   * The run of 2026-11-18 spent 34 minutes and reported `Cannot read properties of undefined (reading 'length')` - which
   * is true of perhaps forty lines in this file and identifies none of them. **A failure that costs a dispatch to locate
   * is a failure this job will keep paying for**, so the first frame in this file is printed beside the message. One
   * line of log, and the next occurrence is a fix rather than a hunt.
   */
  const frame = String((error && error.stack) || '')
    .split('\n')
    .find((row) => row.includes('aacr-bench.mjs'));
  if (frame !== undefined) console.error('AACR-BENCH at:', frame.trim());
  process.exit(1);
});
