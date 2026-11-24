// @code-analyzer — What a better selector could and could not buy
//
// **A cut can only buy a reference comment that some emitted sentence is about.** §140.3 asked the ranker to separate the
// comments that buy something from the ones that do not and got AUC 0.5555. Iteration 146 then asked the same question
// five more ways and the answer did not move: the emission's own fields - claim shape, quoted code, path class,
// severity, lane, agreement, the pull request a comment sits in, and whether its subject appears in the change - separate
// buyers from non-buyers at no better than 0.60, and every alternative key to the budget's ranking loses to the key the
// product already ships. **So the useful question stopped being "which selector" and became "how much is left to select".**
//
// This module answers that, and it is deliberately arithmetic rather than clever. For every reference comment in the row
// set it asks one decidable question: **does any sentence this run emitted, for this file, name a code object the
// reference comment also names?** Nothing about ranking enters. A comment no sentence shares a subject with cannot be
// bought by a cut, a budget, a quota or a ranker, however good - it needs a sentence somebody did not write.
//
// Four decisions, and each one is a way this number could lie:
//
// 1. **The denominator is the row set's reference comments, not the emission's.** A pull request whose comments a cut
//    removed still has its answer key. Taking the denominator from the comments that survived would make the ceiling rise
//    every time a rule abstains, which is the defect `scripts/lib/operating-point.mjs` refuses for cuts and §141 found in
//    the row set one level up.
// 2. **A covered reference comment is reachable by definition.** A lexical test that runs out of vocabulary on one is a
//    limit of the test. Counting it unreachable would understate the selector in order to make a point.
// 3. **A reference comment that names no code object is unmeasurable here, not unreachable.** "Consider verifying whether
//    passing explicit nullptr values adheres to intended API behaviour" is a real answer key entry and has no subject to
//    match. Folding those into the unreachable bucket would attribute a limit of this measure to the reviewer.
// 4. **A subject is an identifier.** Camel case, snake case, a run of capitals, or anything inside backticks. Ordinary
//    prose is excluded on purpose: two sentences sharing the word "error" are not two sentences about the same thing, and
//    a measure that counts them would report a ceiling this repository has not earned.

/** The version of this arithmetic, recorded in the artifact beside the figure it produced. */
export const CEILING_VERSION = 'selection-ceiling-v1';

const normalisePath = (path) =>
  String(path ?? '')
    .replace(/\\/gu, '/')
    .toLowerCase();

/**
 * **The code objects one sentence names.**
 *
 * Backticked spans are read as identifiers even when they are one character long, because a claim that quotes `i` is
 * talking about a variable called `i`. Prose words are read only when their shape says identifier, because `error` in a
 * sentence is a topic and `parseConfig` is a thing.
 */
export function codeObjectsIn(text) {
  const raw = String(text ?? '');
  const named = new Set();
  for (const span of raw.matchAll(/`([^`\n]{1,80})`/gu)) {
    for (const word of span[1].split(/[^A-Za-z0-9_]+/u))
      if (word.length >= 1) named.add(word.toLowerCase());
  }
  for (const word of raw.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/gu)) {
    const token = word[0];
    if (/[a-z][A-Z]/u.test(token) || token.includes('_') || /^[A-Z]{2,}$/u.test(token)) {
      named.add(token.toLowerCase());
    }
  }
  return named;
}

/** The share of the reference comment's code objects that a sentence names. */
function shareNamed(reference, sentence) {
  if (reference.size === 0 || sentence.size === 0) return 0;
  let shared = 0;
  for (const word of reference) if (sentence.has(word)) shared += 1;
  return shared / reference.size;
}

/**
 * **The ceiling, per reference comment.**
 *
 * `rows` is the row set: one entry per pull request, carrying its reference comments and the indices a maximum matching
 * already covered. `corpus` is the answer key, one entry per pull request carrying the reference comments' text. Both are
 * whole-row-set inputs; neither is filtered by what a cut kept.
 */
export function selectionCeiling({ findings, rows, corpus }) {
  const referenceText = new Map();
  for (const entry of corpus ?? []) {
    referenceText.set(String(entry.pullRequest ?? ''), entry.comments ?? []);
  }

  // Every sentence the run produced, by pull request and file. **The whole emission, not the shipped cut**: the question
  // is what the sentences can reach, and a sentence a cut discarded is still a sentence that could have been kept.
  const sentences = new Map();
  for (const finding of findings ?? []) {
    const key = `${String(finding?.['pr'] ?? '')}\u0000${normalisePath(finding?.['path'])}`;
    const bucket = sentences.get(key);
    const subjects = codeObjectsIn(finding?.text);
    if (bucket === undefined) sentences.set(key, [subjects]);
    else bucket.push(subjects);
  }

  const covered = new Set();
  for (const row of rows ?? []) {
    for (const index of row?.covered ?? [])
      covered.add(`${String(row.pr ?? '')}\u0000${String(index)}`);
  }

  let referenceComments = 0;
  let coveredComments = 0;
  let reachable = 0;
  let unreachable = 0;
  let unmeasurable = 0;
  const examples = [];

  for (const row of rows ?? []) {
    const pullRequest = String(row?.pr ?? '');
    const notes = referenceText.get(pullRequest) ?? [];
    const expected = Number(row?.goldens ?? 0);
    if (expected !== notes.length) {
      throw new Error(
        `pull request ${pullRequest} has ${String(expected)} reference comments in the row set and ${String(
          notes.length,
        )} in the corpus; a ceiling over two answer keys is a ceiling over neither`,
      );
    }
    for (const [index, note] of notes.entries()) {
      referenceComments += 1;
      if (covered.has(`${pullRequest}\u0000${String(index)}`)) {
        coveredComments += 1;
        continue;
      }
      const wanted = codeObjectsIn(note);
      if (wanted.size === 0) {
        unmeasurable += 1;
        continue;
      }
      let best = 0;
      const prefix = `${pullRequest}\u0000`;
      for (const [key, bucket] of sentences) {
        if (!key.startsWith(prefix)) continue;
        for (const sentence of bucket) best = Math.max(best, shareNamed(wanted, sentence));
        if (best === 1) break;
      }
      if (best > 0) reachable += 1;
      else {
        unreachable += 1;
        if (examples.length < 8) {
          examples.push({ pullRequest, note: String(note).replace(/\s+/gu, ' ').slice(0, 160) });
        }
      }
    }
  }

  if (referenceComments === 0) {
    throw new Error(
      'the row set holds no reference comment, so there is no denominator; a ceiling of zero over zero is not a ceiling',
    );
  }

  return {
    version: CEILING_VERSION,
    referenceComments,
    covered: coveredComments,
    reachableWithoutCoverage: reachable,
    unmeasurable,
    unreachable,
    /** The largest share of the answer key a re-selection of this emission could cover. */
    ceiling: (coveredComments + reachable) / referenceComments,
    /** And what no re-selection can reach, however good the selector. */
    unreachableShare: unreachable / referenceComments,
    examples,
  };
}

/**
 * **The ceiling as a pair of counts, so a table can put it beside a figure.**
 *
 * A ceiling is a statement about recall, and recall has a denominator. Reporting it as a percentage alone would let a
 * reader compare it against a precision without noticing that they are two different quantities.
 */
export function ceilingLine(ceiling) {
  const reachable = ceiling.covered + ceiling.reachableWithoutCoverage;
  return (
    `${String(reachable)} of ${String(ceiling.referenceComments)} reference comments are covered or share a code ` +
    `object with something this run emitted (${(ceiling.ceiling * 100).toFixed(1)}%); ` +
    `${String(ceiling.unreachable)} name objects no sentence of ours names and ${String(
      ceiling.unmeasurable,
    )} name no object at all`
  );
}
