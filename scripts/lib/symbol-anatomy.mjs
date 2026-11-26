// @code-analyzer — Where a golden we never credit was standing, read off the symbols rather than off a paragraph
//
// **The corpus has no coordinates.** Every one of the board's 173 goldens carries `path: null`, `from_line: null`,
// `to_line: null`, because Martian's judge compares two sentences and never asks where either stood
// (`benchmarks/martian/README.md`). The consequence is arithmetic and it is not a property of any run: all five buckets
// of `golden-attribution.mjs` except `hit` and `noPath` are **structurally zero** on this board, so "did we comment on
// the line and assert the wrong thing" - the question every previous iteration of this campaign tried to answer - cannot
// be asked of a path, and `aacr-miss-anatomy.mjs` prints `0 rejects, all accounted for` on every artifact from it.
//
// **The only anchor left is the sentence.** So the unit of adjacency here is a **symbol**: the identifier a human's
// comment names, and the identifiers our own comments name. On this arm 27 of the 33 goldens only the competitor credits
// sit on a symbol a comment we already post names, and 27 of those 27 comments are inside their pull request's first
// five. That is the finding this module measures, and it moves the campaign's statement of the deficit from *we never
// named it* to *we named it and said something else*.
//
// **And the number that keeps that statement honest is the rate outside the set**, because co-location is the board's
// base rate and not a property of the goldens we miss: 99 of the 125 goldens that are *not* in the set are adjacent to a
// comment by the same rule. **So adjacency is not a selector** - a device that rewrote every comment it could find an
// adjacent golden for would rewrite four comments in five - and this instrument says so before it says anything else.
// What the set buys is not the adjacency but the *demonstration*: these are the goldens the competitor converted, so they
// are the ones a conditioning device can be held to.
//
// **A count of matches proves nothing on its own**, which is why the rule is mechanical and why it comes with two
// controls. Every long word in a 984-finding pool is "mentioned"; the question is whether a *name* is mentioned, and the
// difference between a name and a word is measurable: **how many pull requests' pools contain it**. A token that appears
// in one pull request's pool is a name. A token that appears in thirty is the word `function`. The threshold is not
// written here, it is swept, and both ends of the sweep are published - the loose end shows why the loose reading of
// §164.3 ("a symbol appears in our text", counted by hand) was not evidence on its own.
//
// The three controls, in the order they weaken a claim:
//
//   1. **A permutation null.** The symbol sets are swapped between goldens - the pool, the pull requests, the sizes and
//      the vocabulary all held fixed - and adjacency is recounted. A count that does not clear this is a count of the
//      corpus's vocabulary rather than of anything any comment did.
//   2. **A wrong-pull-request control.** The same symbols against another pull request's pool *in the same repository*.
//      If a golden is adjacent to a pool that never saw its diff, the adjacency is about shared identifiers, not place.
//   3. **The rate outside the set.** The last and the strongest, because it is the one that can deflate the reading
//      rather than support it: on this board it does. **A device cannot select on adjacency**; it can only be pointed at
//      every comment it posts and asked a better question.
//
// **And the number that decides the iteration is not the adjacency but its prize.** The comments that name these symbols
// are already posted, and 22 of the 23 of them already rank inside their pull request's first five - so the budget has
// already been spent on them. Crediting the golden to the comment that names its symbol is **the sentence being
// corrected and nothing else moving**: no comment added, no rank changed, no cut re-implemented. That ceiling is what a
// conditioning device can reach, and comparing it with the bar says whether such a device can reach it at all.
//
// **It is an upper bound and it is labelled one.** The judge never saw the corrected sentence, so this is a ceiling on a
// device and never a score; the record carries the label and the page prints it above the bars. What it can do is
// refuse: if the ceiling is below the bar, no conditioning of the comments we already post can reach it, and the
// deficit is discovery. That refusal is worth a measurement.

import { applyCut, matchingByPullRequest, score } from './operating-point.mjs';

/** A symbol is an identifier, and an identifier is not a word of English: four characters, identifier-shaped. */
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]{3,}/g;

/** Raised when a caller hands this module something that is not the artifact it claims to be. */
export class SymbolAnatomyInputError extends Error {}

/**
 * **The identifiers a sentence names, in order and without repeats.**
 *
 * Backticks are not treated as a signal. The board's humans quote code inconsistently - `refreshOAuthTokens` in one
 * comment, `retryCount: reminder.retryCount + 1` in the next - so a rule that trusted backticks found **4 of 33** where
 * the identifiers themselves are present in 25. The rule is therefore lexical and uniform: any identifier-shaped token,
 * and specificity decides the rest.
 */
export function identifiersOf(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(IDENTIFIER)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    out.push(match[0]);
  }
  return out;
}

/**
 * **How many pull requests' pools name a token**, which is what makes it a name rather than a word.
 *
 * Counted over pull requests rather than over findings: a lane that repeats `data` nine times on one pull request should
 * not make it look commoner than a symbol two pull requests happen to share.
 *
 * **A pool is a map from a pull request to `{ at, row }`**, because every quantity here has to be able to name the row it
 * is about: adjacency points at a comment, and a plan that pointed at a copy of it would rewrite nothing.
 */
export function documentFrequency(poolByPullRequest) {
  const frequency = new Map();
  for (const [, findings] of poolByPullRequest) {
    const seen = new Set();
    for (const finding of findings)
      for (const token of identifiersOf(finding?.row?.text)) seen.add(token);
    for (const token of seen) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

/** The tokens of a sentence that the whole board's pool names in at most `cap` pull requests. */
export function specificSymbols(text, frequency, cap) {
  return identifiersOf(text).filter((token) => (frequency.get(token) ?? 0) <= cap);
}

/** **A symbol is named, not contained**: `id` is not a name that `groupId` answers to. */
export function namesSymbol(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(String(text ?? ''));
}

/** A golden is identified by its pull request and its position in that pull request's answer key, never by position alone. */
export const goldenKey = (pullRequest, index) => `${pullRequest}\u0000${String(index)}`;

/** The two halves of a golden's identity, which are also the two halves of a finding's. */
export function splitKey(key) {
  const at = String(key).indexOf('\u0000');
  return [String(key).slice(0, at), Number(String(key).slice(at + 1))];
}

/** The credited goldens of a pool, as identities rather than as a count - the ceiling's own quantity. */
export function creditedGoldens(findings, creditOf) {
  return creditedIdentities(findings, creditOf);
}

function creditedIdentities(findings, creditOf) {
  const credited = new Set();
  for (const [pullRequest, held] of matchingByPullRequest(findings, creditOf)) {
    for (const golden of held.keys()) credited.add(goldenKey(pullRequest, golden));
  }
  return credited;
}

/**
 * **The goldens one arm credits and the other does not, under the matching protocol rather than by counting credits.**
 *
 * `matchedGoldens` is a finding's row of the verdict matrix *before* the matching, so a union of those rows reports more
 * credit than the corpus does - 99 against 97 on this arm, because two goldens have a single claimant and a second
 * finding that also claims them. **The difference is one golden on each side of the set difference**, which is why the
 * numbers here do not equal §164.1's: that table counted rows, and a table of rows is not a table of credit.
 */
export function creditSets({ ours, theirs, maps, creditOf }) {
  if (!Array.isArray(ours)) throw new SymbolAnatomyInputError('the arm has no findings to read');
  if (theirs === null || typeof theirs !== 'object') {
    throw new SymbolAnatomyInputError('the reference arm has no pull requests to read');
  }
  const ourCredit = creditedIdentities(ours, creditOf);
  const theirCredit = new Set();
  for (const [pullRequest, row] of Object.entries(theirs)) {
    const index = maps.get(pullRequest);
    if (index === undefined) continue;
    for (const detail of row?.detail ?? []) {
      for (const golden of detail?.matchedGoldens ?? []) {
        const remapped = index.get(golden);
        if (remapped !== undefined) theirCredit.add(goldenKey(pullRequest, remapped));
      }
    }
  }
  const onlyTheirs = [...theirCredit].filter((key) => !ourCredit.has(key)).sort();
  const shared = [...theirCredit].filter((key) => ourCredit.has(key)).length;
  return {
    ours: ourCredit,
    theirs: theirCredit,
    shared,
    onlyOurs: ourCredit.size - shared,
    onlyTheirs,
  };
}

/**
 * **The pool's comments that name each golden's symbols**, which is the adjacency and nothing more.
 *
 * `rows` is the pool as the cut will see it, so `matches` are **indices into the rows the caller passed in** rather than
 * into the artifact - the rewrite needs to address one of them, and an index into a file is not an index into a list.
 */
export function adjacency({ goldens, poolByPullRequest }) {
  const out = [];
  for (const golden of goldens) {
    const [pullRequest] = splitKey(golden.key);
    if (golden.symbols.length === 0) {
      out.push({ ...golden, matches: [] });
      continue;
    }
    const pool = poolByPullRequest.get(pullRequest) ?? [];
    const matches = pool
      .filter((finding) => golden.symbols.some((symbol) => namesSymbol(finding.row?.text, symbol)))
      .map((finding) => finding.at);
    out.push({ ...golden, matches });
  }
  return out;
}

/**
 * **The same count with the symbol sets swapped between goldens**, which is the null a count has to clear.
 *
 * A linear congruential generator rather than `Math.random`, because a record whose null distribution changes between two
 * runs of the same command is a record that cannot be gated: the seed is an argument, the permutation count is an
 * argument, and both are written into the output.
 */
export function permutationNull({ goldens, poolByPullRequest, permutations, seed }) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const counts = [];
  const adjacentWith = (pullRequest, symbols) => {
    if (symbols.length === 0) return false;
    const pool = poolByPullRequest.get(pullRequest) ?? [];
    return pool.some((finding) => symbols.some((symbol) => namesSymbol(finding.row?.text, symbol)));
  };
  for (let round = 0; round < permutations; round += 1) {
    const order = goldens.map((golden) => golden.symbols);
    for (let at = order.length - 1; at > 0; at -= 1) {
      const swap = Math.floor(next() * (at + 1));
      [order[at], order[swap]] = [order[swap], order[at]];
    }
    let adjacent = 0;
    for (const [at, golden] of goldens.entries()) {
      // The golden keeps its pull request and the size of its claim; only the vocabulary it claims is somebody else's.
      if (adjacentWith(splitKey(golden.key)[0], order[at])) adjacent += 1;
    }
    counts.push(adjacent);
  }
  counts.sort((left, right) => left - right);
  const mean = counts.reduce((total, value) => total + value, 0) / Math.max(1, counts.length);
  return {
    permutations,
    seed,
    mean: Number(mean.toFixed(2)),
    p95: counts[Math.floor(0.95 * (counts.length - 1))] ?? 0,
    max: counts[counts.length - 1] ?? 0,
  };
}

/**
 * **The rate this adjacency has to beat, which is not the null: it is the board's other goldens.**
 *
 * A permutation null asks whether a symbol belongs to this pull request. It does not ask whether *co-location is
 * ordinary*, and on this board it is: most goldens sit on a symbol somebody's comment names, because a corpus of human
 * review comments is a corpus of identifiers that appear in the diff. **A rate quoted without this control invites a
 * reader to conclude that the goldens we miss are special, when the truth may be that every golden is adjacent to
 * something and the failure is uniformly in the sentence.** So the rate is measured on the goldens that are *not* in the
 * set, by the same rule, on the same pool.
 */
export function baseRate({ goldens, poolByPullRequest }) {
  let adjacent = 0;
  let withSymbols = 0;
  for (const golden of goldens) {
    if (golden.symbols.length === 0) continue;
    withSymbols += 1;
    const pool = poolByPullRequest.get(splitKey(golden.key)[0]) ?? [];
    if (
      pool.some((finding) =>
        golden.symbols.some((symbol) => namesSymbol(finding.row?.text, symbol)),
      )
    ) {
      adjacent += 1;
    }
  }
  return { goldens: goldens.length, withSymbols, adjacent };
}

/**
 * **The same symbols against a pool that never saw the diff.**
 *
 * The other pull request is chosen deterministically - the first in the same repository that is not this one - so the
 * control is a function of the corpus and not of a shuffle. A golden with no sibling pull request in its repository is
 * counted as `uncontrolled` rather than as adjacent or as not, because a control that cannot run is not a zero.
 */
export function wrongPullRequest({ goldens, poolByPullRequest, repositoryOf }) {
  const byRepository = new Map();
  for (const pullRequest of poolByPullRequest.keys()) {
    const repository = repositoryOf(pullRequest);
    if (!byRepository.has(repository)) byRepository.set(repository, []);
    byRepository.get(repository).push(pullRequest);
  }
  let adjacent = 0;
  let uncontrolled = 0;
  for (const golden of goldens) {
    if (golden.symbols.length === 0) continue;
    const [pullRequest] = splitKey(golden.key);
    const sibling = (byRepository.get(repositoryOf(pullRequest)) ?? [])
      .filter((candidate) => candidate !== pullRequest)
      .sort()[0];
    if (sibling === undefined) {
      uncontrolled += 1;
      continue;
    }
    const pool = poolByPullRequest.get(sibling) ?? [];
    if (
      pool.some((finding) =>
        golden.symbols.some((symbol) => namesSymbol(finding.row?.text, symbol)),
      )
    ) {
      adjacent += 1;
    }
  }
  return { adjacent, uncontrolled };
}

/**
 * **The prize: the comments are already posted, and the only thing that would change is what they assert.**
 *
 * For each adjacent golden, the highest-scoring comment on its own pull request that names one of its symbols takes the
 * credit. **Nothing is added and nothing moves** - `k` at the budget is unchanged by construction - so the difference
 * between this point and the arm's is the sentence and only the sentence.
 *
 * **Both readings of a rewrite are computed.** A corrected sentence *adds* a credit (the finding now holds its own
 * golden and this one, which a one-to-one matching may or may not be able to buy) or it *replaces* one (the sentence
 * moved, so the credit it used to earn moved with it). They are different sentences about the same device, and reporting
 * one is a choice; when they agree the choice did not matter, and a reader can check that they do.
 */
export function rewriteOracle({ rows, creditOf, goldens, steps, budget, plan }) {
  const goldensOf = new Map();
  for (const entry of plan) {
    if (entry.findingAt === null) continue;
    if (!goldensOf.has(entry.findingAt)) goldensOf.set(entry.findingAt, []);
    goldensOf.get(entry.findingAt).push(entry.golden);
  }
  const rebuilt = (keepOwn) =>
    rows.map((row, at) => {
      const extra = goldensOf.get(at);
      if (extra === undefined) return row;
      return {
        ...row,
        profileGoldens: keepOwn ? [...(row.profileGoldens ?? []), ...extra] : extra,
      };
    });
  const withoutBudget = steps.filter((step) => step.kind !== 'budget');
  const ceilingOf = (findings) =>
    creditedIdentities(applyCut(findings, withoutBudget), creditOf).size;
  const atBudgetOf = (findings) =>
    score(applyCut(findings, [...withoutBudget, { kind: 'budget', k: budget }]), creditOf, goldens);
  const additive = rebuilt(true);
  const replacement = rebuilt(false);
  return {
    converted: plan.filter((entry) => entry.findingAt !== null).length,
    findings: goldensOf.size,
    additive: { ceiling: ceilingOf(additive), atBudget: atBudgetOf(additive) },
    replacement: { ceiling: ceilingOf(replacement), atBudget: atBudgetOf(replacement) },
  };
}

/**
 * **How many conversions actually buy a credit, in the order a verifier would make them.**
 *
 * A conversion is not a credit. One-to-one matching means a corrected sentence buys a golden only if the matching can
 * still find an edge for it, so twenty-seven conversions on twenty-four comments bought thirteen credits on this arm -
 * **and a bar written as "ten credited goldens" is therefore not a bar a device can be held to.** The curve is the
 * translation: the plan in the order a verifier would apply it (most confident comment first), scored at each prefix, so
 * the acceptance is a number of comments rather than a number of goldens.
 */
export function conversionCurve({ rows, creditOf, goldens, steps, budget, plan, points = 6 }) {
  const ordered = [...plan].sort(
    (left, right) =>
      Number(rows[right.findingAt]?.score ?? 0) - Number(rows[left.findingAt]?.score ?? 0),
  );
  const withoutBudget = steps.filter((step) => step.kind !== 'budget');
  const marks = new Set();
  for (let at = 1; at <= points; at += 1)
    marks.add(Math.max(1, Math.round((ordered.length * at) / points)));
  marks.add(ordered.length);
  const curve = [];
  for (const converted of [...marks].sort((left, right) => left - right)) {
    const oracle = rewriteOracle({
      rows,
      creditOf,
      goldens,
      steps,
      budget,
      plan: ordered.slice(0, converted),
    });
    curve.push({
      converted,
      credited: oracle.replacement.atBudget.truePositives,
      f1: Number(oracle.replacement.atBudget.f1.toFixed(4)),
    });
  }
  return curve;
}

/** The smallest prefix of a conversion curve whose F1 clears the target, or `null` if no prefix does. */
export function firstClearing(curve, target) {
  return curve.find((point) => point.f1 >= target)?.converted ?? null;
}

/**
 * **The bar, as conversions rather than as an F1.**
 *
 * F1 is `2·tp / (k + goldens)`, so the credited count a target needs is closed-form and the number of conversions
 * follows from it. An added comment is not free - it enters `k` on the left of that fraction - which is why a device
 * that posts a corrected sentence *beside* the original needs more conversions than one that posts it *instead of* the
 * original. Both counts are reported so that the acceptance is not read as one number.
 */
export function conversionsNeeded({ truePositives, emitted, goldens, target }) {
  const gap = target * (emitted + goldens) - 2 * truePositives;
  return {
    replacement: Math.max(0, Math.ceil(gap / 2)),
    additive: Math.max(0, Math.ceil(gap / (2 - target))),
  };
}

/**
 * **The rank each planned comment holds inside its own pull request**, which is what a budget of five can reach.
 *
 * The rank is taken after the cut and before the budget, so it is the ordinal the budget actually spends: a comment at
 * rank seven is one a budget of five never posts, and a device whose conversions all sit at rank seven is a device that
 * would need the ranker too.
 */
export function ranksOf({ plan, rows, steps, poolByPullRequest }) {
  const withoutBudget = steps.filter((step) => step.kind !== 'budget');
  return plan.map((entry) => {
    if (entry.findingAt === null) return { ...entry, rank: null };
    const finding = rows[entry.findingAt];
    const pool = applyCut(poolByPullRequest.get(String(finding?.pr ?? '')) ?? [], withoutBudget);
    const above = pool.filter(
      (row) => Number(row?.score ?? 0) > Number(finding?.score ?? 0),
    ).length;
    return { ...entry, rank: above + 1 };
  });
}
