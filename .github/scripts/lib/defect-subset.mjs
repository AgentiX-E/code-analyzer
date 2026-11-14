// The one figure a defect detector can be compared on, computed in one place
//
// **The problem this file answers.** The corpus's answer key is *what a human reviewer said on this pull request*, and
// on fifty sampled goldens the file arm missed, **forty-one are remarks a defect detector would never make** - a
// `const auto&`, a `2.0f`, a commented-out line. A reviewer that reports defects is therefore scored against a mixture,
// and **the headline F1 measures the overlap between two questions rather than the quality of either answer.**
//
// **What is computed instead.** The precision of the `bug` and `security` categories: on this corpus that is the subset
// a defect detector claims, so it is the subset whose precision a defect detector's precision can be compared with.
// It is read from the per-category table the run already produces - **not from a second walk of the matching**, because
// two walks of one matching that disagree is the defect this repository keeps finding an iteration later.
//
// **What is deliberately not computed: a defect recall.** The goldens carry no type label, so there is no subset of
// goldens a defect-only reviewer could be scored against. Dividing the defect categories' true positives by all 452
// goldens produces a number about the mixture - which is the headline recall, already published beside it. **A field
// named `recall` that was the headline under another name would be the most expensive kind of wrong: it would look like
// a measurement of something new.**

/** The categories a defect detector claims, and the whole of this protocol's definition. */
export const DEFECT_CATEGORIES = Object.freeze(['bug', 'security']);

/**
 * **The precision of the defect categories, beside the precision of everything.**
 *
 * `rows` is `byCategory.rows`: one entry per emitted category with `emitted` and `truePositives`. A category absent from
 * the table emitted nothing, and **one that emitted nothing contributes nothing** - so the denominator is the sum over
 * the rows that exist rather than over the categories named above. That distinction matters: a run whose lanes said
 * nothing about security has `emitted: 0` for it and must not be reported as `precision: 0` on the strength of an
 * absence, which is the same mistake `categoryVerdict` avoids by treating an unmeasured category as unknown.
 */
export function scoreDefectSubset({ rows, wholeEmissionPrecision = null }) {
  const table = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => DEFECT_CATEGORIES.includes(row?.category))
      .map((row) => [row.category, row]),
  );
  const emitted = [...table.values()].reduce((total, row) => total + Number(row.emitted ?? 0), 0);
  const truePositives = [...table.values()].reduce(
    (total, row) => total + Number(row.truePositives ?? 0),
    0,
  );
  return {
    protocol: 'defect-subset-v1',
    categories: [...DEFECT_CATEGORIES],
    // **Which of the named categories actually emitted**, because a subset that quietly shrank to one category is a
    // different measurement and the difference is invisible in the rates.
    measuredCategories: [...table.keys()].sort(),
    emitted,
    truePositives,
    falsePositives: emitted - truePositives,
    precision: emitted === 0 ? null : Math.round((truePositives / emitted) * 10_000) / 10_000,
    wholeEmissionPrecision,
    recallWithheld:
      'the goldens carry no type label, so there is no defect-only golden subset to divide by; the headline recall is the only recall this corpus supports',
  };
}
