/**
 * **The budget axis, as four rule families and one bound.**
 *
 * A per-pull-request budget is the only knob that decides *how much* a reviewer says rather than *what*. Every figure the
 * campaign has published about it is a flat `k`, and flat is what a reader has to be able to compare against: the rule
 * that scales the budget by the emission, by the score, or by the goldens the pull request actually held is only
 * interesting beside the flat thirteen it would replace.
 *
 * **The bound is the point of the file.** `oracleGreedy` reads the answers - it scans every `k` for every pull request
 * and keeps the one that maximises that pull request's own credit-per-emission - so it cannot be deployed. What it
 * measures is **the room a device would have to work in**: if the room is small, no count and no classifier will find
 * anything in it, and the next dispatch is better spent elsewhere.
 *
 * **Every rule goes through `applyCut` and `score` from `operating-point.mjs`**, so `fixed 13` here and
 * `drop:test + budget 13` there must print the same number; the test that asserts it is the only thing keeping two
 * implementations of one cut from drifting apart.
 */
import {
  applyCut,
  maximumMatchingByPullRequest,
  pullRequestOf,
  score,
  scoreOf,
} from './operating-point.mjs';

/** The credit a finding's verdicts allow. */
const creditOf = (finding) => finding?.['matchedGoldens'] ?? [];

/** `test` is dropped before any budget rule is applied, because §49.3 measured the category as a loss at every cut. */
export const DROP_TEST = [{ kind: 'drop', categories: ['test'] }];

/**
 * **How many goldens each pull request held**, from the artifact's own coverage rows.
 *
 * An artifact without them is refused: a budget rule read against a missing denominator is a rule scored on the emission
 * it was supposed to reduce.
 */
export function goldensByPullRequest(artifact) {
  const rows = artifact?.coverage?.byPullRequest;
  if (!Array.isArray(rows)) {
    throw new Error('an artifact with no coverage.byPullRequest cannot price a budget rule');
  }
  const counts = new Map();
  for (const pull of rows) counts.set(String(pull?.pr), (pull?.covered ?? []).length);
  return counts;
}

/** The corpus a rule divides by, read the same way the single-arm table reads it. */
function corpusOf(artifact) {
  const published = artifact?.['fullEmission'] ?? artifact;
  return Number(published?.['truePositives'] ?? 0) + Number(published?.['falseNegatives'] ?? 0);
}

/**
 * **Findings grouped by pull request and ordered the way `applyCut`'s budget step orders them**: highest score first, ties
 * in the artifact's own order.
 *
 * **The ordering is not cosmetic.** `budget 13` in `operating-point.mjs` sorts before it takes a prefix, so a rule here
 * that took the artifact's order instead would agree with it on a run whose findings happen to arrive sorted and diverge
 * on one where they do not - the same failure mode §51 documents, one layer down.
 */
function orderedByPullRequest(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = pullRequestOf(finding);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [finding]);
    else bucket.push(finding);
  }
  const ordered = new Map();
  for (const [key, list] of grouped) {
    ordered.set(
      key,
      list
        .map((finding, at) => ({ finding, at, score: scoreOf(finding) }))
        .sort((left, right) => right.score - left.score || left.at - right.at)
        .map((entry) => entry.finding),
    );
  }
  return ordered;
}

/**
 * **The rules a reader can be asked to believe**, each a function of what a run can see before it decides.
 *
 * `flat` is the shipped cut. The two scaling rules are the obvious guesses and the ones most likely to be tried again.
 * The two golden rules are **the answer** - one slot per golden the pull request actually contained - and they are here
 * to show that knowing the answer is not enough.
 */
export const BUDGET_RULES = {
  'fixed 13': () => 13,
  'ceil(emitted / 2)': (list) => Math.ceil(list.length / 2),
  'ceil(sqrt(emitted) * 2)': (list) => Math.ceil(Math.sqrt(list.length) * 2),
  'one per golden': (_list, goldens) => Math.max(1, goldens),
  'one per golden plus three': (_list, goldens) => Math.max(1, goldens + 3),
};

/** One point, from a cut and a per-pull-request budget. */
function scoreWith(artifact, steps, pick) {
  const kept = applyCut(artifact?.rankedFindings ?? [], steps);
  const goldens = goldensByPullRequest(artifact);
  const chosen = [];
  for (const [pr, list] of orderedByPullRequest(kept)) {
    const budget = Math.min(list.length, Math.max(1, pick(list, goldens.get(pr) ?? 0)));
    chosen.push(...list.slice(0, budget));
  }
  return score(chosen, creditOf, corpusOf(artifact));
}

/**
 * **Every rule at one cut**, so the table is about the budget and not about which category was dropped.
 */
export function budgetRuleTable(artifact) {
  const goldens = goldensByPullRequest(artifact);
  const rows = [];
  for (const [name, pick] of Object.entries(BUDGET_RULES)) {
    rows.push({ rule: name, ...scoreWith(artifact, DROP_TEST, pick) });
  }
  // **The bound, named as a bound**: it reads the answers, so it is a ceiling on the axis and never a rule.
  rows.push({ rule: 'oracle (greedy, reads the answers)', ...oracleGreedy(artifact) });
  return { rows, goldens: goldens.size };
}

/**
 * **The best a per-pull-request budget can do with this ranking**, found by scanning every `k` for every pull request.
 *
 * The objective is that pull request's own `2c / (k + goldens)`, which is the F1-shaped term it contributes: **a single
 * global F1 is not a sum of per-pull-request F1s**, so this is a greedy bound and not the maximum. It is stated that way
 * wherever it is quoted.
 */
export function oracleGreedy(artifact) {
  const kept = applyCut(artifact?.rankedFindings ?? [], DROP_TEST);
  const goldens = goldensByPullRequest(artifact);
  const chosen = [];
  const budgets = [];
  for (const [pr, list] of orderedByPullRequest(kept)) {
    const held = goldens.get(pr) ?? 0;
    let best = { k: 1, value: -Infinity };
    for (let k = 1; k <= list.length; k += 1) {
      const credit = maximumMatchingByPullRequest(list.slice(0, k), creditOf);
      const value = (2 * credit) / (k + Math.max(1, held));
      if (value > best.value) best = { k, value };
    }
    budgets.push(best.k);
    chosen.push(...list.slice(0, best.k));
  }
  budgets.sort((left, right) => left - right);
  return {
    ...score(chosen, creditOf, corpusOf(artifact)),
    medianBudget: budgets.length === 0 ? 0 : budgets[Math.floor(budgets.length / 2)],
  };
}

/**
 * **The score threshold, scanned**, because a threshold is a budget written the other way round: it does not decide how
 * many findings a pull request may have, it decides which findings survive, and a reader comparing the two axes needs
 * the best value of each rather than an arbitrary one.
 */
export function bestScoreThreshold(artifact, values) {
  const kept = applyCut(artifact?.rankedFindings ?? [], DROP_TEST);
  const corpus = corpusOf(artifact);
  let best = null;
  for (const threshold of values) {
    const survivors = kept.filter((finding) => scoreOf(finding) >= threshold);
    const point = score(survivors, creditOf, corpus);
    if (best === null || point.f1 > best.f1) best = { ...point, threshold };
  }
  return best;
}
