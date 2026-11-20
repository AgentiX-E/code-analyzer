// @code-analyzer — Is a selection knob a property of the corpus, or a property of the run that chose it?
//
// **Every cut in `registeredCuts` was chosen by looking at a corpus.** `drop test` was not: it came from a structural
// argument (a test file is rarely the site of the defect a pull request fixes) and was registered before the run that
// measured it. The others - which category to remove, how large a per-pull-request budget to allow - were chosen by
// reading a table of twenty-three cuts over one paid run's verdicts, and a table is a fitting procedure whether or not
// anybody called it one.
//
// **A fitted choice has to be read out of sample or it is not a measurement.** This module is that reading. It takes the
// artifact a run already paid for, and for each pull request in turn it chooses the knob on the other forty-nine and
// applies that choice to the one held out. The result is the figure a campaign would have obtained had it been forced to
// decide without the row it was deciding about - which is what shipping a knob means, because the next corpus is a
// corpus nobody has seen.
//
// **What it is for.** A knob whose held-out figure is worse than the shipped point is a knob that was fitting noise, and
// the number this module prints is the size of the mistake. That is the same discipline §47.5 applied to a prompt, moved
// to the one place the campaign had not applied it: its own choice of cut.
//
// **What it cannot do.** It cannot invent findings a run did not emit, so it prices selection among the sentences a run
// paid for - `operating-point.mjs`'s "cut versus device" line holds here unchanged.

import { applyCut, pullRequestOf, score } from './operating-point.mjs';

/** The categories a run emitted, most frequent first, so a printed table starts where the mass is. */
export function emittedCategories(findings) {
  const counts = new Map();
  for (const finding of findings) {
    const category = String(finding?.['category'] ?? '');
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category]) => category);
}

/** The pull requests a pool covers, in the artifact's own order. */
export function pullRequestsOf(findings) {
  return [...new Set(findings.map((finding) => pullRequestOf(finding)))];
}

/**
 * **One knob's held-out price.**
 *
 * `choose(rows)` returns whatever the fitting procedure picks from `rows`, and `stepsOf(choice)` turns that pick into a
 * cut. The procedure never sees the held-out pull request: its rows are removed before `choose` is called, and the
 * verdicts on them are only used to score what the choice then kept.
 */
export function heldOut(fittings, { choose, stepsOf, baseSteps }) {
  const byPullRequest = new Map();
  for (const finding of fittings) {
    const key = pullRequestOf(finding);
    const bucket = byPullRequest.get(key);
    if (bucket === undefined) byPullRequest.set(key, [finding]);
    else bucket.push(finding);
  }

  const kept = [];
  const choices = new Map();
  for (const [key, rows] of byPullRequest) {
    const train = fittings.filter((finding) => pullRequestOf(finding) !== key);
    const choice = choose(train);
    choices.set(choice, (choices.get(choice) ?? 0) + 1);
    kept.push(...applyCut(rows, [...baseSteps, ...stepsOf(choice)]));
  }
  return { kept, choices };
}

/** A choice that removes one category, or nothing when the procedure picked the empty string. */
export const categorySteps = (category) =>
  category === '' ? [] : [{ kind: 'drop', categories: [category] }];

/** A choice that caps a pull request at `k` comments. */
export const budgetSteps = (k) => [{ kind: 'budget', k }];

/**
 * **The category half.** Each candidate is `drop one category`, priced on the training pull requests, and the winner is
 * applied to the held-out one. `''` is a candidate because **the answer "remove nothing" has to be available**, or the
 * procedure is guaranteed to print a gain - and a procedure that cannot decline cannot be falsified.
 */
export function auditCategories(findings, creditOf, goldens, baseSteps) {
  const candidates = ['', ...emittedCategories(findings)];
  const inSample = candidates.map((category) => ({
    category,
    point: score(applyCut(findings, [...baseSteps, ...categorySteps(category)]), creditOf, goldens),
  }));
  const choose = (rows) => {
    let best = { category: '', f1: -1 };
    for (const category of candidates) {
      const point = score(
        applyCut(rows, [...baseSteps, ...categorySteps(category)]),
        creditOf,
        goldens,
      );
      if (point.f1 > best.f1) best = { category, f1: point.f1 };
    }
    return best.category;
  };
  const { kept, choices } = heldOut(findings, { choose, stepsOf: categorySteps, baseSteps });
  return { inSample, heldOut: score(kept, creditOf, goldens), choices };
}

/**
 * **The budget half.** Same procedure over a list of caps, and it answers a different question: not "which category is
 * noise" but **"was the cap this campaign ships a measured optimum or a policy"**. A cap is a policy when F1 is still
 * rising at it, and saying so is the point of printing the curve beside the choice.
 */
export function auditBudgets(findings, creditOf, goldens, baseSteps, budgets) {
  const inSample = budgets.map((k) => ({
    k,
    point: score(applyCut(findings, [...baseSteps, ...budgetSteps(k)]), creditOf, goldens),
  }));
  const choose = (rows) => {
    let best = { k: budgets[0], f1: -1 };
    for (const k of budgets) {
      const point = score(applyCut(rows, [...baseSteps, ...budgetSteps(k)]), creditOf, goldens);
      if (point.f1 > best.f1) best = { k, f1: point.f1 };
    }
    return best.k;
  };
  const { kept, choices } = heldOut(findings, { choose, stepsOf: budgetSteps, baseSteps });
  return { inSample, heldOut: score(kept, creditOf, goldens), choices };
}

/**
 * **Whether a procedure earned its choice, and by how much.**
 *
 * The comparison is against the shipped cut scored on the same artifact - **one instrument, two readings** - and the bar
 * is the campaign's own noise band: a held-out gain under two per cent of the shipped F1 is not a gain, because §106.7
 * measured two runs of one configuration 1.9 % apart.
 */
export function verdictOf({ shipped, audited, budgetAudited }) {
  const delta = audited.heldOut.f1 - shipped.f1;
  const noise = 0.02 * shipped.f1;
  return {
    shippedF1: shipped.f1,
    categoriesHeldOutF1: audited.heldOut.f1,
    categoriesDelta: delta,
    categoriesEarned: delta > noise,
    budgetsHeldOutF1: budgetAudited.heldOut.f1,
    budgetsDelta: budgetAudited.heldOut.f1 - shipped.f1,
    noiseBand: noise,
  };
}
