// @code-analyzer — The head-to-head, recomputed from an artifact instead of re-bought
//
// **Why this exists.** Every figure the project publishes about a competitor is derived from two files: the bench
// artifact, which carries one row per finding with the goldens the judge matched it to, and the competitor's baseline,
// which carries the same thing for their arm. **Both are already paid for.** A report that quotes a number from them is
// a report about arithmetic, and arithmetic can be checked: this module recomputes the whole comparison from the two
// files and nothing else - no model, no network, no corpus download.
//
// **And the arithmetic is reimplemented rather than imported.** The harness scores with
// `maximumMatchingCount` from `@code-analyzer/intelligence`; this file carries its own Kuhn walk. **A second
// implementation is the point**: a verifier that calls the function under test cannot find a defect in it, and the two
// agreeing on a published figure is evidence that the figure is the corpus's and not the code's. The two are held
// together by `tests/unit/scripts/the-artifact-replays-to-its-own-figure.test.ts`, which replays the committed artifact
// and asserts the precision, recall and F1 the artifact itself publishes.
//
// **What it is not.** It does not decide anything: every rule it applies - which findings are kept, which categories a
// profile drops, which pull requests pair - is read from the artifact's own fields or passed in by the caller, so a
// replay of a run is a replay of *that run* rather than of this module's opinion about it.

/**
 * **The goldens a maximum matching covers.**
 *
 * Kuhn's augmenting-path walk, iterative over findings and recursive over goldens, which is the size this corpus is:
 * a pull request carries tens of goldens and hundreds of findings, not millions. Returns the indices rather than the
 * count because **the pairing needs the set and the metric needs only its size** - two reviewers scored alike can have
 * found different issues, and a significance test is about which.
 */
export function maximumMatchingIndices(matches, goldens) {
  return matchingOwners(matches, goldens).flatMap((owner, at) => (owner === -1 ? [] : [at]));
}

/**
 * **Which finding owns each golden, rather than how many were owned.**
 *
 * A count answers the metric; **the owner answers the question the next iteration asks**, which is *what kind of
 * finding carries a golden the other reviewer missed*. `owners[3] === 7` means golden 3 belongs to finding 7, so a
 * breakdown by category costs one pass over an array instead of a second matching.
 */
export function matchingOwners(matches, goldens) {
  const limit = Math.max(0, Math.trunc(Number(goldens ?? 0)));
  const owner = new Array(limit).fill(-1);

  /** Try to give finding `finding` a golden it can call its own, displacing a finding that can find another. */
  const augment = (finding, seen) => {
    for (const golden of matches[finding] ?? []) {
      const at = Math.trunc(Number(golden));
      if (!Number.isFinite(at) || at < 0 || at >= limit || seen[at]) continue;
      seen[at] = true;
      if (owner[at] === -1 || augment(owner[at], seen)) {
        owner[at] = finding;
        return true;
      }
    }
    return false;
  };

  for (let finding = 0; finding < matches.length; finding += 1) {
    if ((matches[finding] ?? []).length === 0) continue;
    augment(finding, new Array(limit).fill(false));
  }

  return owner;
}

/** A point, with the four counts it was computed from, so a reader can re-derive it by hand. */
function point(truePositives, falsePositives, falseNegatives) {
  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const round = (value) => Math.round(value * 10000) / 10000;
  return {
    findings: truePositives + falsePositives,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

/**
 * **The corpus a run scored, which is the coverage list and not the finding list.**
 *
 * **A pull request with no emitted finding still has goldens and still counts as a miss**, so a replay that iterated the
 * findings would drop it from the denominator and report a recall nobody measured. The committed artifact of fifty pull
 * requests carries forty-nine pull requests' worth of findings and fifty pull requests' worth of goldens, and the
 * difference is six goldens - exactly the gap between the published recall and a replay over `rankedFindings`.
 */
function scoredPullRequests(bench) {
  const rows = bench?.coverage?.byPullRequest;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    key: String(row.pr),
    goldens: Math.max(0, Math.trunc(Number(row.goldens ?? 0))),
  }));
}

/** One row per pull request: which goldens each of the caller's arms covers, and how many findings it emitted. */
/**
 * **The arm that ships, read from the rows the artifact published for it.**
 *
 * Since §54 the headline is an emission policy - `drop test, budget 12` - and not a predicate over a single finding, so
 * it cannot be reconstructed by `armOf`: **the budget is a function of the pull request, not of the finding.** The
 * artifact therefore publishes one row per pull request with the goldens the rule covered (`covered`) and how many
 * comments it posted (`shippedEmitted`), and this reads them back.
 *
 * **`null` for an artifact that predates the field**, so an old artifact is replayed under the arm it recorded rather
 * than under an arm reconstructed from fields it does not have.
 */
function shippedArmOf(bench) {
  const rows = bench?.coverage?.byPullRequest;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!rows.every((row) => Number.isInteger(row?.shippedEmitted))) return null;
  const byPull = new Map();
  for (const row of rows) {
    const key = String(row.pr);
    const covered = Array.isArray(row.covered) ? row.covered : [];
    const goldens = Math.max(0, Math.trunc(Number(row.goldens ?? 0)));
    const truePositives = covered.length;
    byPull.set(key, {
      truePositives,
      falsePositives: Math.max(0, row.shippedEmitted - truePositives),
      falseNegatives: Math.max(0, goldens - truePositives),
      covered: new Set(covered.map((golden) => `${key}#${String(golden)}`)),
    });
  }
  return byPull;
}

/** The sums of `shippedArmOf` over a corpus, in the shape every other arm is returned in. */
function scoreShipped(shippedByPull, corpus) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const covered = new Set();
  for (const pull of corpus) {
    const row = shippedByPull.get(String(pull.key));
    if (row === undefined) continue;
    truePositives += row.truePositives;
    falsePositives += row.falsePositives;
    falseNegatives += row.falseNegatives;
    for (const golden of row.covered) covered.add(golden);
  }
  return { point: point(truePositives, falsePositives, falseNegatives), covered };
}

function armOf(findings, keep) {
  const kept = [];
  for (const finding of findings) {
    if (!keep(finding)) continue;
    kept.push({
      matches: Array.isArray(finding.matchedGoldens) ? finding.matchedGoldens : [],
      category: String(finding.category ?? 'unknown'),
    });
  }
  return kept;
}

/**
 * **What an arm's true positives are made of, category by category.**
 *
 * A single F1 says the two reviewers differ; **a table of which categories carry the difference says what to build
 * next.** It costs one pass over findings that were already matched: the owner array says which finding carries each
 * golden, so a category's true positives are the findings in that category that own one.
 *
 * **The denominator is the arm's own findings in that category, not the corpus's goldens in it** - the corpus labels
 * its goldens with a different taxonomy, and a rate whose numerator and denominator come from two taxonomies is a
 * number nobody can check.
 */
function tally(byCategory, kept, owners) {
  const owned = new Set(owners.filter((owner) => owner !== -1));
  for (let at = 0; at < kept.length; at += 1) {
    const bucket = (byCategory[kept[at].category] ??= { findings: 0, truePositives: 0 });
    bucket.findings += 1;
    if (owned.has(at)) bucket.truePositives += 1;
  }
}

function scoreArm({ corpus, findingsByPr, keep }) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const covered = new Set();
  const byCategory = {};

  for (const pull of corpus) {
    const kept = armOf(findingsByPr.get(pull.key) ?? [], keep);
    const owners = matchingOwners(
      kept.map((entry) => entry.matches),
      pull.goldens,
    );
    const owned = new Set(owners.filter((owner) => owner !== -1));
    truePositives += owned.size;
    falsePositives += kept.length - owned.size;
    falseNegatives += Math.max(0, pull.goldens - owned.size);
    for (const golden of owned) covered.add(`${pull.key}#${String(golden)}`);
    tally(byCategory, kept, owners);
  }

  return { point: point(truePositives, falsePositives, falseNegatives), covered, byCategory };
}

/** The competitor's arm, from its baseline rows: `matches` and one `keep` flag per finding, as recorded. */
function scoreCompetitor({ corpus, pulls, applyTheirGate = true }) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const covered = new Set();
  const byCategory = {};

  for (const pull of corpus) {
    const row = pulls[pull.key];
    if (row === undefined) continue;
    const kept = [];
    for (let at = 0; at < (row.matches ?? []).length; at += 1) {
      // **Their own gate, or none at all** - the two readings the project has compared against, and the difference
      // between them is why `theirsEverything` exists: a figure quoted from their own publication was produced without
      // a gate, and quoting it against our gated arm would be two rules in one subtraction.
      if (applyTheirGate && row.keep?.[at] === false) continue;
      kept.push({
        matches: row.matches[at],
        // **`detail` is the same rows in the same order**, so a category costs nothing to read; when a transcribed
        // baseline does not carry it, `unknown` is the honest name rather than a guess.
        category: String(row.detail?.[at]?.category ?? 'unknown'),
      });
    }
    const owners = matchingOwners(
      kept.map((entry) => entry.matches),
      pull.goldens,
    );
    const owned = new Set(owners.filter((owner) => owner !== -1));
    truePositives += owned.size;
    falsePositives += kept.length - owned.size;
    falseNegatives += Math.max(0, pull.goldens - owned.size);
    for (const golden of owned) covered.add(`${pull.key}#${String(golden)}`);
    tally(byCategory, kept, owners);
  }

  return { point: point(truePositives, falsePositives, falseNegatives), covered, byCategory };
}

/** How many goldens one arm covers that the other does not, which is what a paired test is over. */
function discordance(ours, theirs) {
  let oursOnly = 0;
  for (const key of ours) if (!theirs.has(key)) oursOnly += 1;
  let theirsOnly = 0;
  for (const key of theirs) if (!ours.has(key)) theirsOnly += 1;
  return { oursOnly, theirsOnly };
}

/**
 * **The whole comparison, from the two files.**
 *
 * Three arms of ours are reported because three different claims are made about them and they are not
 * interchangeable:
 *
 * - `everything` - every finding the engine emitted. **What the competitor's own published figure is about**, and the
 *   only arm that may be quoted against a number they printed without a gate.
 * - `gate` - the actionability gate the run registers before it starts. **The operating point a head-to-head must use,
 *   because the same rule is applied to their findings.**
 * - `profile` - the gate with the category profile on top, which the `defect` arm adds. **A device, not a default**, and
 *   a replay that reported only this arm would report the device's precision as the reviewer's.
 *
 * `paired` is computed over the pull requests both arms scored and `whole` over all of ours; **the two are different
 * denominators and a reader must not subtract one figure from a number taken from the other**, which is why they are
 * separate fields rather than one field with a note.
 */
export function replayHeadToHead({ bench, baseline, dropCategories = [] } = {}) {
  const corpus = scoredPullRequests(bench);
  const pulls = baseline?.pulls ?? {};
  const drop = new Set(dropCategories);

  const findingsByPr = new Map();
  for (const finding of bench?.rankedFindings ?? []) {
    const key = String(finding.pr);
    if (!findingsByPr.has(key)) findingsByPr.set(key, []);
    findingsByPr.get(key).push(finding);
  }

  const arms = {
    everything: () => true,
    gate: (finding) => finding.actionable === true,
    profile: (finding) => finding.actionable === true && !drop.has(String(finding.category)),
    // **The reading reviewer's published arm under a category profile**: its own filing rule keeps everything it can
    // locate, and the profile floor is the only thing removed on top of that. It requires no actionability, which is the
    // whole difference between it and `profile`.
    'everything-filtered': (finding) => !drop.has(String(finding.category)),
  };

  const pairedCorpus = corpus.filter((pull) => pulls[pull.key] !== undefined);
  const scoredByThemOnly = Object.keys(pulls)
    .filter((key) => !corpus.some((pull) => pull.key === key))
    .map((key) => ({ key, reason: 'this run has no scored row for this pull request' }));

  const whole = {};
  const paired = {};
  const theirsWhole = scoreCompetitor({ corpus, pulls });
  const theirsWholeUngated = scoreCompetitor({ corpus, pulls, applyTheirGate: false });
  const theirsPaired = scoreCompetitor({ corpus: pairedCorpus, pulls });
  const theirsPairedUngated = scoreCompetitor({
    corpus: pairedCorpus,
    pulls,
    applyTheirGate: false,
  });

  /**
   * **And the arm that ships, from the rows rather than from a predicate**, because a budget is a property of the pull
   * request and `keep(finding)` cannot express it. Absent from an artifact written before §54, in which case nothing is
   * added and a `publishedArm` of `shipped` finds no arm - which is why the checker only asks for it when it exists.
   */
  const shippedByPull = shippedArmOf(bench);
  if (shippedByPull !== null) {
    const overWhole = scoreShipped(shippedByPull, corpus);
    const overPaired = scoreShipped(shippedByPull, pairedCorpus);
    whole.shipped = overWhole.point;
    paired.shipped = {
      ...overPaired.point,
      against: theirsPaired.point,
      discordance: discordance(overPaired.covered, theirsPaired.covered),
      byCategory: {},
    };
  }

  for (const [name, keep] of Object.entries(arms)) {
    const overWhole = scoreArm({ corpus, findingsByPr, keep });
    const overPaired = scoreArm({ corpus: pairedCorpus, findingsByPr, keep });
    whole[name] = overWhole.point;
    paired[name] = {
      ...overPaired.point,
      against: theirsPaired.point,
      discordance: discordance(overPaired.covered, theirsPaired.covered),
      // **What the true positives are made of**, which is the only part of this file that says what to build next.
      byCategory: overPaired.byCategory,
    };
  }

  return {
    measuredAt: bench?.measuredAt ?? null,
    pullRequestsScored: corpus.length,
    goldensScored: corpus.reduce((total, pull) => total + pull.goldens, 0),
    paired: {
      pullRequests: pairedCorpus.length,
      goldens: pairedCorpus.reduce((total, pull) => total + pull.goldens, 0),
      excluded: corpus
        .filter((pull) => pulls[pull.key] === undefined)
        .map((pull) => ({
          key: pull.key,
          reason: 'the competitor has no row for this pull request',
        })),
      scoresByThemOnly: scoredByThemOnly,
      // **Their two readings, side by side**, so the rule each figure was produced under is a field rather than a
      // memory: `theirs` is the same actionability gate ours is scored under, `theirsEverything` is what their own
      // publication quoted.
      theirs: { ...theirsPaired.point, byCategory: theirsPaired.byCategory },
      theirsEverything: {
        ...theirsPairedUngated.point,
        byCategory: theirsPairedUngated.byCategory,
      },
      oursUngatedAgainstTheirsUngated: discordance(
        scoreArm({ corpus: pairedCorpus, findingsByPr, keep: arms.everything }).covered,
        theirsPairedUngated.covered,
      ),
      ...paired,
    },
    whole: { ...whole, theirs: theirsWhole.point, theirsEverything: theirsWholeUngated.point },
    dropCategories: [...drop],
  };
}

/**
 * **Whether a replay of an artifact reproduces the figures that artifact publishes.**
 *
 * The three numbers, to the four places they are published at. **A tolerance would defeat the purpose**: this compares
 * one implementation's arithmetic against another's on the same data, and two implementations of a maximum matching
 * agree exactly or one of them is wrong.
 */
export function compareReplayToArtifact(replay, bench) {
  const expected = {
    precision: bench?.precision ?? null,
    recall: bench?.recall ?? null,
    f1: bench?.f1 ?? null,
  };
  const arm = publishedArmOf(bench);
  const actual = replay?.whole?.[arm] ?? null;
  const mismatches = [];
  /**
   * **An arm the artifact names and the rows cannot reproduce is a failure, not a skip.**
   *
   * The three fields below are skipped when the artifact publishes no figure for them, which is correct - an artifact
   * from a run that stopped early has nothing to check. **But an artifact that publishes a figure and names an arm the
   * replay has no rows for would have skipped all three and passed**, which is a check that reports success by not
   * running. That is the shape of the defect §54 introduced into `scoring.publishedArm`, caught one level down.
   */
  if (actual === null && expected.precision !== null) {
    return {
      arm,
      ok: false,
      mismatches: [
        {
          field: 'arm',
          published: arm,
          replayed: null,
          arm,
          reason: 'the artifact names an arm its own rows cannot reproduce',
        },
      ],
    };
  }
  for (const field of ['precision', 'recall', 'f1']) {
    if (expected[field] === null || actual === null) continue;
    if (expected[field] !== actual[field]) {
      mismatches.push({ field, published: expected[field], replayed: actual[field], arm });
    }
  }
  return { arm, ok: mismatches.length === 0, mismatches };
}

/**
 * **Which arm the artifact's published precision, recall and F1 were computed over.**
 *
 * **Read from the artifact when the artifact says so**, and derived only when it does not - because deriving it was
 * wrong once, expensively: the reading arm publishes what its own filing rule kept (`emissionRules.shipped`), while this
 * function used to answer `gate` for every non-`defect` run, so a hundred-pull-request run whose published F1 was 0.1947
 * was replayed against the actionability gate's 0.072 and the job failed for a disagreement that existed only in the
 * reader. **An artifact that records two arms and a checker that reads a third is the defect, not the figure.**
 *
 * `everything-filtered` is the arm the reading reviewer publishes under a category profile: it files what it can locate
 * and the profile floor then drops categories, so it is neither `everything` (which keeps every category) nor `profile`
 * (which also requires the actionability gate).
 */
function publishedArmOf(bench) {
  const recorded = bench?.scoring?.publishedArm;
  if (typeof recorded === 'string') return recorded;
  // **The derivation kept for artifacts written before the field existed**, with the reading arm's own rule restored:
  // `configuration.agent` was in every one of those artifacts even when the arm name was not.
  const profileOn = bench?.configuration?.emissionProfile === 'defect';
  const reading = bench?.configuration?.agent === true;
  if (reading) return profileOn ? 'everything-filtered' : 'everything';
  return profileOn ? 'profile' : 'gate';
}
