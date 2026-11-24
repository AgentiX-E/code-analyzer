/**
 * **A profile is a denominator, and a denominator is part of the question.**
 *
 * Martian's Code Review Bench publishes **173** human-curated comments and scores tools on a **Core** subset of **158** -
 * the eight categories `bug, security, concurrency, data, api, perf, test_gap, doc_defect`, which is the full set minus
 * `style` (10) and `speculative` (5). Every number on that board is on 158. This repository's Martian run counted all 173,
 * so **our F1 and every competitor's F1 were divided by different numbers** - the §140.5 defect one level up, in the corpus
 * rather than in the emission.
 *
 * The correction is arithmetic and costs nothing: the judge already adjudicated each (comment, golden) pair, so restricting
 * the golden set to the board's profile is a re-index of verdicts already paid for. What it must not become is a second
 * opinion: this module never re-judges, never re-ranks and never changes which comments were emitted.
 *
 * **The mapping is per pull request.** Goldens are identified by position within their own answer key, so dropping
 * `style` comment 4 of `sentry#1234` renumbers that pull request's goldens and no other's - which is why every function
 * here takes the corpus and returns a map keyed by pull request.
 */

/** The board's Core profile, in the order the board lists it. */
export const MARTIAN_CORE_CATEGORIES = Object.freeze([
  'bug',
  'security',
  'concurrency',
  'data',
  'api',
  'perf',
  'test_gap',
  'doc_defect',
]);

/**
 * The named profiles this repository publishes. **`all` is the absence of a filter, not the ten categories this corpus
 * happens to use** - a profile written as a category list would silently drop an eleventh category the corpus added later.
 */
export const PROFILES = Object.freeze({
  all: null,
  core: MARTIAN_CORE_CATEGORIES,
});

/** Raised when a profile name is not one this repository has registered, rather than silently scoring all of them. */
export class UnknownProfileError extends Error {
  constructor(name, known) {
    super(
      `profile ${JSON.stringify(name)} is not registered; known profiles are ${known.join(', ')}`,
    );
    this.name = 'UnknownProfileError';
  }
}

/**
 * The old index of every comment the profile keeps, in order, so a verdict can be re-indexed rather than re-made.
 *
 * @returns `Map<oldIndex, newIndex>` for the comments whose category the profile names.
 */
export function profileIndex(categories, profileName) {
  if (!(profileName in PROFILES)) throw new UnknownProfileError(profileName, Object.keys(PROFILES));
  const keep = PROFILES[profileName];
  if (keep === null) return new Map(categories.map((_, at) => [at, at]));
  const allowed = new Set(keep);
  const index = new Map();
  for (const [at, category] of categories.entries()) {
    if (allowed.has(String(category))) index.set(at, index.size);
  }
  return index;
}

/**
 * **One corpus, one profile, one map from pull request to re-index.**
 *
 * The corpus rows are `{ githubPrUrl, comments: [{ category }] }`, which is the shape the board publishes. A row without a
 * pull request URL cannot be matched to a run's rows and is skipped rather than keyed under an empty string, because an
 * empty string is already a legitimate key for a finding that named no pull request.
 */
export function profileMaps(corpus, profileName) {
  const maps = new Map();
  let goldens = 0;
  for (const row of corpus) {
    const pr = row?.githubPrUrl;
    if (typeof pr !== 'string' || pr === '') continue;
    const categories = (row.comments ?? []).map((comment) => String(comment?.category ?? ''));
    const index = profileIndex(categories, profileName);
    maps.set(pr, index);
    goldens += index.size;
  }
  return { maps, goldens };
}

/**
 * The same findings, with each verdict re-indexed into the profile and the ones outside it dropped.
 *
 * A finding whose verdicts all fall outside the profile keeps an empty list rather than disappearing: **it was emitted, and
 * a cut does not remove it from the denominator** - the same rule §141 and §144.4 hold for a silenced pull request.
 */
export function restrictFindings(findings, { maps, profileField = 'profileGoldens' }) {
  return findings.map((finding) => {
    const index = maps.get(String(finding?.pr ?? ''));
    const remapped = index
      ? (finding.matchedGoldens ?? [])
          .map((golden) => index.get(golden))
          .filter((golden) => golden !== undefined)
      : [];
    return { ...finding, [profileField]: remapped };
  });
}

/** The version of this re-indexing, recorded beside a figure produced from it. */
export const CORPUS_PROFILE_VERSION = 'martian-core-profile-v1';
