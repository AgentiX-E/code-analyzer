// @code-analyzer — what the grounding gate is worth, priced on removals a paid run already produced
//
// **§147.5 registered the question and §148 removed the obstacle.** The question is whether the gate that drops findings it
// cannot ground buys precision or costs recall; the obstacle was that the artifact's `existingCode` was a placeholder, so
// the check the gate was written around had nothing to read. **Both halves are decidable without a model**: the verdict
// matrix is in the artifact and the files sit at a pinned revision, so the gate's verdicts and their price are arithmetic
// over text on disk.
//
// **What this prices, exactly.** The shipped policy decides what reaches a reader (`drop test`, `drop path test`,
// `budget 12`). The gate is a *device proposed in front of it*, so the replay runs it upstream - filter, then cut - and
// scores the same goldens against the same verdicts both ways. **Applying it after the cut would be a different device**:
// a filter that removes a posted comment frees no budget, so the findings the budget refused would stay refused. The
// upstream position is the one the product would use, and it is the one measured.
//
// **The removal pool is the criterion, not the figure it leaves behind.** §75.3 asks a precision device for 209 false
// positives at a pool that is ≤ 4 % true positives, so `removals` reports what the gate removed *from the posted set*,
// how many of those were true, and their share - **a gate that reaches an F1 target by deleting true positives is a
// different device from one that reaches it by deleting the wrong comments**, and the two are indistinguishable from the
// resulting F1 alone.
//
// **What it cannot say.** It cannot invent findings the run did not emit, and it cannot read a file at a revision the API
// no longer serves; it reports the coverage it got rather than assuming the rest. **A pull request whose gate was withheld
// is reported as withheld**, because `decideGrounding` refuses to delete from a list it could only partly read, and a
// replay that quietly overrode that refusal would be measuring a device nobody ships.

import {
  applyCut,
  describeCut,
  matchingByPullRequest,
  pullRequestOf,
  score,
} from './operating-point.mjs';

/**
 * **The row as the gate reads it, without changing what the cut reads.**
 *
 * The artifact's row already carries `path`, `startLine`, `endLine` and the sentence, so the only field the gate needs
 * that the row does not spell is the one it calls `content`. **The row is spread rather than rebuilt**, because
 * `applyCut` and `score` read `score`, `category`, `pr` and `matchedGoldens` off the same object: a copy carrying only
 * the gate's five fields would score zero findings and report it as a gate that removed everything.
 *
 * `existingCode` is omitted when the row has none, and **that is not the same as an empty string**: the judge keeps a
 * finding that offers no quotation and drops one whose quotation is absent. Passing `''` would ask a different question.
 */
export function groundableRow(row) {
  const quote = typeof row?.['existingCode'] === 'string' ? row['existingCode'] : '';
  return {
    ...row,
    content: typeof row?.['text'] === 'string' ? row['text'] : '',
    ...(quote.trim().length === 0 ? {} : { existingCode: quote }),
  };
}

/**
 * **Every (pull request, path) the replay has to be able to read**, which is the fetch list and the coverage claim at once.
 *
 * A set per pull request rather than a set of paths, because the same path at two revisions is two different files: a
 * cache keyed on the path alone would answer one pull request's question with another's text.
 */
export function requiredSources(findings) {
  const byPr = new Map();
  for (const finding of findings) {
    const path = String(finding?.['path'] ?? '');
    if (path.length === 0) continue;
    const key = pullRequestOf(finding);
    const bucket = byPr.get(key);
    if (bucket === undefined) byPr.set(key, new Set([path]));
    else bucket.add(path);
  }
  return byPr;
}

/** Rows grouped by the pull request they were judged under, in the artifact's own order. */
function indicesByPullRequest(findings) {
  const groups = new Map();
  for (const [at, finding] of findings.entries()) {
    const key = pullRequestOf(finding);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [at]);
    else bucket.push(at);
  }
  return groups;
}

/**
 * **A key two rows share exactly when the gate gives them the same verdict.**
 *
 * The gate reads `path`, the range, the quotation and the sentence and nothing else, so the four of them identify its
 * input. **The sentence is part of the key** because `namesOccurInRegion` reads it: two rows on one range with different
 * prose are two different questions, and a key that collapsed them would credit one row's survival to the other.
 */
function shapeOf(row) {
  return [row.path, row.startLine, row.endLine, row.existingCode ?? '', row.content ?? ''].join(
    '\u0000',
  );
}

/**
 * **The gate's decision per pull request, and the coverage each one got.**
 *
 * `decide` is `decideGrounding` itself rather than a copy of its rule: **the all-or-nothing coverage rule is the device**,
 * and a replay that re-implemented it would be pricing a rule that exists only here. It is a parameter so the arithmetic
 * can be held to a stub in a test, and so this module never imports a package the caller has not built.
 *
 * **Survivors are re-attributed by shape rather than by identity.** `judgeGrounding` returns `{ ...comment, filtered:
 * false }`, so the object it hands back is a copy; the shape is what it read, and a queue per shape attributes the copies
 * to the rows they came from without assuming the gate preserved anything it does not document.
 */
export function decidePerPullRequest(findings, sourcesFor, decide) {
  const groups = indicesByPullRequest(findings);
  const keptIndices = new Set();
  const decisions = [];
  let offered = 0;
  let readable = 0;
  let dropped = 0;
  let unpostable = 0;
  let unverifiableQuotes = 0;
  let namesNowhere = 0;
  const byReason = new Map();

  for (const [key, indices] of groups) {
    const rows = indices.map((at) => findings[at]);
    const sources = sourcesFor(key);
    // **The change as a whole and the paths it deleted**, because §150 gave both to the gate: a name can live in a sibling
    // file of the same change, and a deleted path is unpostable rather than unread.
    const decision = decide(
      rows.map(groundableRow),
      sources?.contents ?? new Map(),
      sources?.diffs,
      {
        ...(sources?.change === undefined ? {} : { change: sources.change }),
        ...(sources?.absent === undefined ? {} : { absent: sources.absent }),
      },
    );

    offered += decision.coverage.findings;
    readable += decision.coverage.readable;
    unpostable += decision.coverage.unpostable ?? 0;
    unverifiableQuotes += decision.report.unverifiableQuotes ?? 0;
    namesNowhere += decision.report.namesNowhere ?? 0;

    if (!decision.applied) {
      // **Everything is kept, and the report says why**, because a withheld gate is inert by construction: a replay that
      // dropped rows here would be pricing the gate the product refuses to run.
      for (const at of indices) keptIndices.add(at);
      decisions.push({
        pr: key,
        applied: false,
        withheld: decision.withheld,
        coverage: decision.coverage,
        dropped: 0,
      });
      continue;
    }

    const pending = new Map();
    for (const [at, row] of rows.entries()) {
      const shape = shapeOf(groundableRow(row));
      const queue = pending.get(shape);
      if (queue === undefined) pending.set(shape, [indices[at]]);
      else queue.push(indices[at]);
    }
    let removedHere = 0;
    for (const survivor of decision.kept) {
      const queue = pending.get(shapeOf(survivor));
      const at = queue?.shift();
      if (at === undefined) continue;
      keptIndices.add(at);
    }
    for (const queue of pending.values()) removedHere += queue.length;
    dropped += removedHere;

    for (const verdict of decision.report.ungrounded) {
      const reason = verdict.reason ?? 'unnamed';
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    decisions.push({
      pr: key,
      applied: true,
      withheld: null,
      coverage: decision.coverage,
      dropped: removedHere,
    });
  }

  return {
    keptIndices,
    decisions,
    coverage: { offered, readable, unpostable },
    dropped,
    unverifiableQuotes,
    namesNowhere,
    byReason,
  };
}

/**
 * **Where a comment's names live, which is the question the name check was trying to ask.**
 *
 * §150 priced the check and found nothing left in it, so what remains is the *distribution* that made it look informative:
 * how many comments name nothing at all, how many name something in the lines they point at, and how many name something
 * that only the rest of the file or the rest of the change contains. **A comment whose names are nowhere is the only one
 * the check could ever have been right about**, and this is the count that says whether that class is common enough to
 * justify a device.
 *
 * **Literals and proposed names are not names**, the same two exclusions the judge now makes, so the two cannot report
 * different numbers for the same corpus.
 */
const NOT_A_NAME = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'nil',
  'None',
  'True',
  'False',
  'NaN',
  'Infinity',
  'void',
  'this',
  'self',
  'super',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'async',
  'await',
  'yield',
  'return',
  'break',
  'continue',
  'throw',
  'catch',
  'else',
  'finally',
  'var',
  'let',
  'const',
  'def',
  'fn',
  'func',
  'yes',
  'no',
  'on',
  'off',
]);

export function anchorsOf(findings, sourcesFor) {
  const tally = {
    findings: findings.length,
    readable: 0,
    noName: 0,
    inRange: 0,
    inFile: 0,
    inChange: 0,
    nowhere: 0,
  };
  const nowhere = [];
  for (const row of findings) {
    const sources = sourcesFor(pullRequestOf(row));
    const content = sources?.contents?.get(row.path);
    if (typeof content !== 'string') continue;
    tally.readable += 1;

    const proposal = String(row?.suggestionCode ?? '');
    const body = `${String(row?.text ?? row?.content ?? '')} ${proposal}`;
    const names = [...body.matchAll(/`([A-Za-z_$][\w$]{2,})`/g)]
      .map((match) => match[1])
      .filter((name) => !NOT_A_NAME.has(name) && !proposal.includes(name));
    if (names.length === 0) {
      tally.noName += 1;
      continue;
    }

    const lines = content.split('\n');
    const region = lines
      .slice(Math.max(0, Number(row.startLine) - 1), Number(row.endLine))
      .join('\n');
    const file = lines.join('\n');
    const change = sources?.change ?? '';
    const missing = names.filter(
      (name) => !region.includes(name) && !file.includes(name) && !change.includes(name),
    );
    if (missing.length === 0) {
      const inRegion = names.some((name) => region.includes(name));
      if (inRegion) tally.inRange += 1;
      else if (names.some((name) => file.includes(name))) tally.inFile += 1;
      else tally.inChange += 1;
      continue;
    }
    tally.nowhere += 1;
    if (nowhere.length < 20)
      nowhere.push({ pr: pullRequestOf(row), path: row.path, line: row.startLine, names: missing });
  }
  return { ...tally, examples: nowhere };
}

/** A point as a table row can quote it, rounded once so two readers cannot disagree about the last digit. */
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function pointOf(findings, goldens) {
  const point = score(findings, (finding) => finding?.['matchedGoldens'] ?? [], goldens);
  return {
    emitted: point.emitted,
    truePositives: point.truePositives,
    falsePositives: point.falsePositives,
    falseNegatives: point.falseNegatives,
    precision: round6(point.precision),
    recall: round6(point.recall),
    f1: round6(point.f1),
  };
}

/** The goldens a list of findings buys, keyed by `pull request\0index` so a set difference can hold the identity. */
function boughtGoldens(findings) {
  const bought = new Set();
  for (const [key, holder] of matchingByPullRequest(
    findings,
    (finding) => finding?.['matchedGoldens'] ?? [],
  )) {
    for (const golden of holder.keys()) bought.add(`${key}\u0000${String(golden)}`);
  }
  return bought;
}

function difference(left, right) {
  const out = [];
  for (const entry of left) if (!right.has(entry)) out.push(entry);
  return out.sort();
}

/**
 * **Whether the replay reproduced the figure the artifact published.**
 *
 * The artifact spells the emitted count `k` in `emissionRules.*.point` and `emitted` in `byBudgetPerPullRequest`, so both
 * spellings are read: **a comparison that silently read `undefined` for one of them would report every artifact as
 * unreproduced**, which is the failure that makes a check useless rather than loud.
 *
 * **And the tolerance is the artifact's own resolution rather than a convenience.** A published point carries four
 * decimals, so `0.2668` stands for `0.26684…`; comparing at a millionth would report a faithful reproduction as a
 * disagreement about the fifth digit, and a check that cries wolf is turned off.
 */
function samePoint(left, right) {
  const emitted = Number(right['emitted'] ?? right['k'] ?? Number.NaN);
  return (
    left.emitted === emitted &&
    left.truePositives === Number(right['truePositives'] ?? Number.NaN) &&
    Math.abs(left.f1 - Number(right['f1'] ?? 0)) <= 5e-5
  );
}

/**
 * **The replay itself: one artifact, one cut, one device, two points.**
 *
 * `sourcesFor(pullRequest)` returns `{ contents, diffs }` for the text the gate may read, or `undefined` when nothing could
 * be read - **and an unread pull request is not an empty one**: the gate withholds on it and the decision records that.
 *
 * `published` is compared with `baseline` rather than trusted. **An instrument that does not reproduce the figure it is
 * replaying is reporting about a different run**, so the disagreement is published as `reproduced: false` beside both
 * points instead of as a delta nobody can attribute.
 */
export function replayGroundingGate({ findings, goldens, steps, sourcesFor, decide, published }) {
  const decision = decidePerPullRequest(findings, sourcesFor, decide);
  const kept = findings.filter((_, at) => decision.keptIndices.has(at));
  const keptSet = new Set(kept);

  const baselinePosted = applyCut(findings, steps);
  const gatedPosted = applyCut(kept, steps);
  const baseline = pointOf(baselinePosted, goldens);
  const gated = pointOf(gatedPosted, goldens);

  // **The removals that matter are removals from what was posted.** A finding the budget already refused never reached a
  // reader, so its deletion changes nothing anybody sees and counting it would inflate the pool with rows that cost F1
  // nothing.
  const removed = baselinePosted.filter((finding) => !keptSet.has(finding));
  const postedBefore = new Set(baselinePosted);
  const admitted = gatedPosted.filter((finding) => !postedBefore.has(finding));

  const before = boughtGoldens(baselinePosted);
  const after = boughtGoldens(gatedPosted);
  const removedTruePositives = boughtGoldens(removed).size;

  // **The same two points, per pull request**, because the total hides the only thing a reader can act on: *where* the
  // gate acted. Matching is already per pull request, so a pull request's own goldens are its own arithmetic rather than
  // a share of the total - and a page that drew a waterfall from the total would have to invent the split.
  const perPullRequest = decision.decisions.map((entry) => {
    const rows = findings.filter((finding) => pullRequestOf(finding) === entry.pr);
    const rowsKept = kept.filter((finding) => pullRequestOf(finding) === entry.pr);
    const postedBefore = baselinePosted.filter((finding) => pullRequestOf(finding) === entry.pr);
    const postedAfter = gatedPosted.filter((finding) => pullRequestOf(finding) === entry.pr);
    return {
      pr: entry.pr,
      applied: entry.applied,
      withheld: entry.withheld,
      findings: entry.coverage.findings,
      readable: entry.coverage.readable,
      dropped: entry.dropped,
      postedBefore: postedBefore.length,
      postedAfter: postedAfter.length,
      goldensBefore: boughtGoldens(rows).size,
      goldensAfter: boughtGoldens(rowsKept).size,
    };
  });

  return {
    cut: { label: describeCut(steps), steps },
    baseline,
    gated,
    reproduced: published === undefined ? null : samePoint(baseline, published),
    delta: {
      emitted: gated.emitted - baseline.emitted,
      truePositives: gated.truePositives - baseline.truePositives,
      precision: round6(gated.precision - baseline.precision),
      recall: round6(gated.recall - baseline.recall),
      f1: round6(gated.f1 - baseline.f1),
    },
    gate: {
      findings: findings.length,
      dropped: decision.dropped,
      coverage: decision.coverage,
      unverifiableQuotes: decision.unverifiableQuotes,
      namesNowhere: decision.namesNowhere,
      withheldPullRequests: decision.decisions.filter((entry) => !entry.applied).length,
      byReason: [...decision.byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
      decisions: decision.decisions,
      perPullRequest,
    },
    removals: {
      posted: removed.length,
      truePositives: removedTruePositives,
      // **`null` rather than `0` when nothing was removed**, for the reason §75.3's table gives: a zero reads as a perfect
      // pool, and a device that removed nothing has no pool to be perfect at.
      share: removed.length === 0 ? null : round6(removedTruePositives / removed.length),
    },
    admitted: { posted: admitted.length, truePositives: boughtGoldens(admitted).size },
    goldens: {
      before: before.size,
      after: after.size,
      lost: difference(before, after),
      gained: difference(after, before),
    },
  };
}
