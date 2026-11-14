// The corpus measures what a reviewer said, and that is not what a defect detector claims
//
// **The finding this file is written against.** Fifty sampled goldens the file arm missed were read one at a time:
// **five were the same concern in other words, four aimed at the same function with a different focus, and forty-one
// described something else entirely** - a `const auto&` on a variable that is only read, a `2.0` that should be `2.0f`,
// a commented-out `Fill(0.0)`, an `async` with nothing to await. Roughly three fifths of what the human reviewers in
// this corpus wrote is a maintainability remark. **An engine that reports defects is answering a different question,
// and its headline F1 against this answer key is a measurement of the overlap between two questions.**
//
// **So one number is published beside the headline**: the precision of `bug` and `security`, which is the subset a
// defect detector claims, and therefore the subset whose precision can be compared with one. **The tests below hold that
// number to the readings it must not drift into** - a denominator that grew to include the mixture, a category that was
// dropped because it stayed silent, a recall invented from a corpus with no type labels.

import { describe, expect, it } from 'vitest';

import {
  DEFECT_CATEGORIES,
  scoreDefectSubset,
} from '../../../.github/scripts/lib/defect-subset.mjs';

/** One cell of the per-category table, in the shape the benchmark produces. */
function row(category: string, emitted: number, truePositives: number) {
  return { category, emitted, truePositives, falsePositives: emitted - truePositives };
}

describe('the defect subset is the two categories a defect detector claims', () => {
  it('adds bug and security, and only those', () => {
    // **Hand-computed from the published artifact's shape.** 178 `bug` findings carried 51 goldens and 10 `security`
    // carried 3: 188 emitted, 54 carried, and 54/188 is 0.2872.
    const subset = scoreDefectSubset({
      rows: [
        row('bug', 178, 51),
        row('security', 10, 3),
        row('architecture', 95, 17),
        row('test', 72, 6),
      ],
      wholeEmissionPrecision: 0.2141,
    });
    expect(subset.emitted).toBe(188);
    expect(subset.truePositives).toBe(54);
    expect(subset.falsePositives).toBe(134);
    expect(subset.precision).toBe(0.2872);
    // **The headline travels beside it unchanged.** It is not recomputed from these rows, because the whole emission
    // contains categories this subset does not, and a "whole" derived from a subset would be a second measurement of the
    // subset wearing the first one's name.
    expect(subset.wholeEmissionPrecision).toBe(0.2141);
  });

  it('names which categories actually emitted, so a subset cannot shrink silently', () => {
    const subset = scoreDefectSubset({ rows: [row('bug', 40, 10)] });
    expect(subset.categories).toEqual(['bug', 'security']);
    expect(subset.measuredCategories).toEqual(['bug']);
    expect(subset.precision).toBe(0.25);
  });

  it('reports an unknown precision when nothing was emitted, not a zero', () => {
    // **The distinction is the one `categoryVerdict` makes for an unmeasured category.** A `0` here would say the
    // reviewer was wrong everywhere in the defect categories rather than that it said nothing there, and the two lead
    // to opposite next steps.
    const subset = scoreDefectSubset({ rows: [] });
    expect(subset.emitted).toBe(0);
    expect(subset.precision).toBeNull();
    expect(subset.measuredCategories).toEqual([]);
  });

  it('withholds a recall and says why', () => {
    // **A "defect recall" is not computable from this corpus**, because its goldens carry no type label: dividing the
    // defect categories' true positives by all 452 goldens is the headline recall under another name, and a field that
    // looked like a new measurement but was an old one is worse than no field.
    const subset = scoreDefectSubset({ rows: [row('bug', 10, 4)] });
    expect(subset.recallWithheld).toMatch(/no type label/);
    expect(Object.keys(subset)).not.toContain('recall');
  });

  it('is a definition rather than a preference: the category list is exported', () => {
    expect([...DEFECT_CATEGORIES]).toEqual(['bug', 'security']);
  });
});
