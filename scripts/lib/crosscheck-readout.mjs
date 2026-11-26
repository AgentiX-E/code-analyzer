/**
 * **The arithmetic a paired re-read needs, with the reading kept out of it.**
 *
 * §166.4's prize is *the same 227 comments, the sentences corrected*: the device changes what a comment says and nothing
 * about how many there are, so **the readout has to be able to say that the count did not move** - and it has to say it
 * from the data rather than from the promise. That is what `withRewrites` is for: it takes the rows that were posted and a
 * set of replacements addressed by row position, and returns a list of the same length, in the same order, with the same
 * anchors. A rewrite that addressed a row which was not posted would change the length, so the count check is a property
 * of the function rather than a hope about the caller.
 *
 * **And the comparison is paired, because the corpus is.** Two arms judged separately report a difference that carries the
 * judge's drift between them; the same judge in one run over the same pairs does not. `pairedChange` counts the two cells
 * that can move - a pair the arm broke and a pair it fixed - and gives the exact McNemar probability of that split under
 * the null that a moved pair is equally likely to move either way.
 *
 * **Nothing in this file calls a model.** It is the readout, not the reading.
 */

import { exactMcNemar } from '../../.github/scripts/lib/paired-test.mjs';
import { applyCut, score } from './operating-point.mjs';

/** The shipped cut with its budget replaced, in the order the artifact published its steps. */
function cutAtBudget(steps, budget) {
  return steps.map((step) => (step.kind === 'budget' ? { ...step, k: budget } : step));
}

/** The rows a cut actually posts, in the order it posts them. `budget` overrides whatever the shipped cut carried. */
export function postedRows(rows, steps, budget) {
  return applyCut(rows, cutAtBudget(steps, budget));
}

/**
 * **The posted rows, with a rewrite applied where one was asked for.**
 *
 * `rewrites` is a `Map` from the row's position in the artifact to the sentence that replaces it. A position that is not in
 * the posted list is **ignored rather than appended**, which is the invariant §166.4 rests on: a device that may only edit
 * cannot change the denominator, and a function that appended would be the place that changed it.
 */
export function withRewrites(posted, rewrites) {
  return posted.map((row) => {
    const text = rewrites.get(Number(row.at));
    if (text === undefined) return row;
    return { ...row, text };
  });
}

/** The point a set of rows earns against a corpus, through the same cut and the same scoring the artifact used. */
export function pointOf(rows, creditOf, goldens, steps, budget) {
  const cut = applyCut(rows, cutAtBudget(steps, budget));
  return { ...score(cut, creditOf, goldens), rows: cut };
}

/**
 * **What moved, pair by pair.**
 *
 * `bitsA` and `bitsB` are equal-length lists of booleans over the same (comment, golden) pairs in the same order, so the
 * two cells that can differ are `broken` (A matched, B did not) and `fixed` (B matched, A did not). **Unequal lengths are
 * refused rather than truncated**, because a pairing that silently dropped the tail would report a smaller corpus as a
 * cleaner result.
 */
export function pairedChange(bitsA, bitsB) {
  if (bitsA.length !== bitsB.length) {
    throw new Error(
      `pairedChange needs two readings of the same pairs: ${String(bitsA.length)} against ${String(bitsB.length)}`,
    );
  }
  let broken = 0;
  let fixed = 0;
  for (let at = 0; at < bitsA.length; at += 1) {
    const a = Boolean(bitsA[at]);
    const b = Boolean(bitsB[at]);
    if (a && !b) broken += 1;
    if (!a && b) fixed += 1;
  }
  return {
    pairs: bitsA.length,
    broken,
    fixed,
    delta: fixed - broken,
    p: exactMcNemar(fixed, broken),
  };
}
