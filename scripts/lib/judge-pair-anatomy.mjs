/**
 * **What the judge is asked, before it is asked.**
 *
 * The judge is called once per `(finding, golden)` pair of each pull request, so its bill is a **product** and not a
 * sum: §117 measured 14.42 calls per finding on the five-lane arm and 14.74 on the four-lane one, and no lane decision
 * moves that number. Two devices could move it - **judge fewer pairs** (a path filter) or **price each pair lower** (a
 * batch, R-56) - and the first one looks free until the pairs it drops are counted.
 *
 * **This module counts them.** It reads the artifact's own findings and one corpus file, applies each candidate rule to
 * the `(finding path, golden path)` pairs the judge was asked about, and reports the point that survives. It buys
 * nothing and calls nothing.
 *
 * **The honest boundary, stated where the arithmetic is.** A rule here reads the **golden's path**, which the product
 * never sees. So a rule is **not a product feature**: it is a statement about what the judge's pairs are made of. The
 * `filtered` column prices a rule applied to the evaluation's own work (the review is unchanged and the judge is asked
 * fewer questions); the `gated` column prices the review a rule would produce if the product could apply it, which it
 * cannot - and printing both is what keeps the second one from being read as a plan.
 */
import { applyCut, score } from './operating-point.mjs';

/**
 * **The candidate rules, weakest to strongest.**
 *
 * `same top segment` is the one a person writes down first - *a finding about `src/` cannot match a golden about
 * `docs/`* - and it is the one that looks most obviously safe. It is here so that the table can disagree with that.
 */
export const PAIR_RULES = [
  { name: 'same path', matches: (finding, golden) => finding === golden },
  {
    name: 'same directory',
    matches: (finding, golden) => directoryOf(finding) === directoryOf(golden),
  },
  {
    name: 'same directory or one inside the other',
    matches: (finding, golden) => {
      const a = directoryOf(finding);
      const b = directoryOf(golden);
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    },
  },
  {
    name: 'same top two segments',
    matches: (finding, golden) => segmentsOf(finding, 2) === segmentsOf(golden, 2),
  },
  {
    name: 'same top segment',
    matches: (finding, golden) => segmentsOf(finding, 1) === segmentsOf(golden, 1),
  },
];

/** The control: every pair the judge was asked about, which is what the artifact was scored on. */
export const NO_FILTER = { name: 'no filter', matches: () => true };

function directoryOf(path) {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

function segmentsOf(path, count) {
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts.length >= count ? parts.slice(0, count).join('/') : path;
}

/**
 * **The goldens of each pull request, indexed the way the artifact indexes them.**
 *
 * `rankedFindings[].matchedGoldens` holds **indices into its own pull request's golden list**, and that list is
 * `comments` with the empty notes dropped - the filter `aacr-bench.mjs` applies before it builds either the texts or
 * the coordinates. A reader that indexed `comments` instead would be off by one for every empty note in the corpus, and
 * the table would still add up.
 */
function goldensByPullRequest(corpus) {
  const byPull = new Map();
  for (const pull of corpus) {
    const url = String(pull?.githubPrUrl ?? '');
    if (url.length === 0) continue;
    const comments = Array.isArray(pull?.comments) ? pull.comments : [];
    byPull.set(
      url,
      comments
        .filter((comment) => String(comment?.note ?? '') !== '')
        .map((comment) => ({ path: String(comment?.path ?? '') })),
    );
  }
  return byPull;
}

/** The path a finding carries, under either spelling the artifact has used. */
function pathOf(finding) {
  return String(finding?.path ?? finding?.filePath ?? '');
}

/**
 * **The two points a rule can produce, and the one it cannot.**
 *
 * - `filtered` - the same review, with the judge asked only the surviving pairs. The emission is the artifact's own, so
 *   a drop here is a drop in the **evaluation**, not in the product.
 * - `gated` - the review a rule would produce if the product could apply it: a finding survives when at least one of
 *   its pairs survives. **The product cannot, because the rule reads the golden's path**, and this column exists to be
 *   quoted with that sentence attached.
 */
export function pairAnatomy(bench, corpus, rules = PAIR_RULES) {
  const findings = Array.isArray(bench?.rankedFindings) ? bench.rankedFindings : [];
  const goldens = goldensByPullRequest(corpus);
  const published =
    Number(bench?.fullEmission?.truePositives ?? 0) +
    Number(bench?.fullEmission?.falseNegatives ?? 0);

  const goldensOf = (finding) => goldens.get(String(finding?.pr ?? '')) ?? [];

  /** The credit of one finding under one rule, in its own pull request's indexing. */
  const creditUnder = (rule) => (finding) => {
    const rows = goldensOf(finding);
    const credited = [];
    for (const index of finding?.matchedGoldens ?? []) {
      const row = rows[index];
      if (row === undefined) continue;
      if (rule.matches(pathOf(finding), row.path)) credited.push(index);
    }
    return credited;
  };

  /** Whether any pair at all survives - the gate's condition, which is not the same as *any credit* surviving. */
  const anyPairUnder = (rule) => (finding) => {
    const findingPath = pathOf(finding);
    return goldensOf(finding).some((row) => rule.matches(findingPath, row.path));
  };

  const steps = bench?.emissionRules?.shipped?.steps;
  const shippedFindings = Array.isArray(steps) ? applyCut(findings, steps) : findings;
  const full = score(findings, creditUnder(NO_FILTER), published);
  const shipped = score(shippedFindings, creditUnder(NO_FILTER), published);

  const rows = [NO_FILTER, ...rules].map((rule) => {
    let pairs = 0;
    let allPairs = 0;
    for (const finding of findings) {
      const findingPath = pathOf(finding);
      for (const row of goldensOf(finding)) {
        allPairs += 1;
        if (rule.matches(findingPath, row.path)) pairs += 1;
      }
    }
    const filtered = score(shippedFindings, creditUnder(rule), published);
    const gated = score(findings.filter(anyPairUnder(rule)), creditUnder(rule), published);
    return {
      name: rule.name,
      pairs,
      allPairs,
      survival: allPairs === 0 ? null : pairs / allPairs,
      filtered,
      gated,
      // **The point the rule would have to beat**, so that a row is read against the figure it replaces rather than
      // against the row above it.
      deltaFiltered: filtered.f1 - shipped.f1,
      deltaGated: gated.f1 - shipped.f1,
    };
  });

  return {
    findings: findings.length,
    goldens: published,
    allPairs: rows[0]?.allPairs ?? 0,
    judgeCalls: Number(bench?.spend?.judge?.calls ?? 0),
    /**
     * **The calls these pairs do not explain.** On the five-lane arm of `44891741390` the artifact records 7 434 judge
     * calls and the ranked findings account for 5 170, with `rateLimited`, `failures` and `batchCalls` all zero - so the
     * difference is not a retry and not a batch. **The judge is called on a list this artifact does not publish**, and
     * reporting the difference as a number is the honest form of not knowing: the first draft of this module called it
     * "the competitor arm", which was wrong on a run dispatched with `competitor: off`.
     */
    judgeGap: Math.max(0, Number(bench?.spend?.judge?.calls ?? 0) - (rows[0]?.allPairs ?? 0)),
    full,
    shipped,
    rows,
  };
}
