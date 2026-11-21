// @code-analyzer/code-analyzer — can a fitted ordering beat the weights already in the tree?
//
// **The question this holds, and why it is a tool rather than a section.** §106.4 published an AUC of 0.642 for the
// eight engine-side features and said the fitted model was not shipped, which left open whether fitting them would
// improve the cut. **That question costs nothing to answer and everything to answer late**: a fitted ranker that ships
// and does not generalise is a re-pricing of every figure in `EVAL-CONTRACT.md`, and the artifact already carries the
// features and the verdict matrix it would need.
//
// **Leave one pull request out, every fold.** A row's score comes from a model fitted on the other forty-nine, so no
// finding is ever ranked by a model that saw it, and the fold boundary is the pull request because that is the unit the
// corpus holds goldens for.
//
// **What it is not.** It cannot invent findings a run did not emit, and it does not fit anything the artifact does not
// carry. A ranker with a diff hunk, a callee list or a file's own history is a different question and a different run.

import { readFileSync } from 'node:fs';

import {
  applyCut,
  f1FromCounts,
  maximumMatchingByPullRequest,
  pathClassOf,
  scoreOf,
} from './operating-point.mjs';

/**
 * **The features, in the order the vector is written in.**
 *
 * Named rather than positional beyond this file, because a weight table read without its column names is a table nobody
 * can check: `agreement` sitting where `span` belongs would fit, converge and report a number.
 */
export const FEATURE_NAMES = [
  'grounded',
  'quotesDiff',
  'namesSymbol',
  'proposesChange',
  'hedged',
  'agreement',
  'isHigh',
  'isMedium',
  'isLow',
  'span',
  'textLen',
  'lane:security',
  'lane:architecture',
  'lane:performance',
  'lane:maintainability',
  'lane:testing',
  'cat:bug',
  'cat:architecture',
  'cat:test',
  'cat:maintainability',
  'cat:security',
  'cat:documentation',
  'cat:performance',
  'cat:style',
  'path:test',
];

/** A finding's row, as the model reads it. */
export function featuresOf(finding) {
  const facts = finding?.features ?? {};
  const severity = String(finding?.severity ?? facts.severity ?? '').toLowerCase();
  const lane = String(finding?.lane ?? facts.lane ?? '');
  const category = String(finding?.category ?? '');
  const span = Number(finding?.endLine ?? 0) - Number(finding?.startLine ?? 0) + 1;
  const text = String(finding?.text ?? '');
  const flag = (value) => (value ? 1 : 0);
  const one = (name, value) => (name === value ? 1 : 0);
  return [
    flag(facts.grounded),
    flag(facts.quotesDiff),
    flag(facts.namesSymbol),
    flag(facts.proposesChange),
    flag(facts.hedged),
    Number(facts.agreement ?? 0),
    one(severity, 'high'),
    one(severity, 'medium'),
    one(severity, 'low'),
    Math.min(Math.max(span, 0), 60) / 60,
    Math.min(text.length, 400) / 400,
    one(lane, 'security'),
    one(lane, 'architecture'),
    one(lane, 'performance'),
    one(lane, 'maintainability'),
    one(lane, 'testing'),
    one(category, 'bug'),
    one(category, 'architecture'),
    one(category, 'test'),
    one(category, 'maintainability'),
    one(category, 'security'),
    one(category, 'documentation'),
    one(category, 'performance'),
    one(category, 'style'),
    one(pathClassOf(finding?.path ?? finding?.filePath), 'test'),
  ];
}

/** The label: a finding the judge accepted is a positive, whatever it matched. */
export function labelOf(finding) {
  return Array.isArray(finding?.matchedGoldens) && finding.matchedGoldens.length > 0 ? 1 : 0;
}

/** Ascending gradient descent on the mean log loss with an L2 pull, which is enough at this size. */
export function fitLogistic(rows, labels, { l2 = 1e-2, iterations = 800, rate = 0.5 } = {}) {
  const width = rows[0]?.length ?? 0;
  const weights = new Array(width).fill(0);
  const n = Math.max(1, rows.length);
  for (let step = 0; step < iterations; step += 1) {
    const gradient = new Array(width).fill(0);
    for (let i = 0; i < rows.length; i += 1) {
      let z = 0;
      for (let j = 0; j < width; j += 1) z += rows[i][j] * weights[j];
      const p = 1 / (1 + Math.exp(-z));
      const error = p - labels[i];
      for (let j = 0; j < width; j += 1) gradient[j] += error * rows[i][j];
    }
    for (let j = 0; j < width; j += 1) weights[j] -= rate * (gradient[j] / n + l2 * weights[j]);
  }
  return weights;
}

/** Column means and spreads, computed on the training half and applied to both. */
function standardise(rows) {
  const width = rows[0]?.length ?? 0;
  const mean = new Array(width).fill(0);
  const spread = new Array(width).fill(0);
  for (const row of rows) for (let j = 0; j < width; j += 1) mean[j] += row[j];
  for (let j = 0; j < width; j += 1) mean[j] /= Math.max(1, rows.length);
  for (const row of rows) for (let j = 0; j < width; j += 1) spread[j] += (row[j] - mean[j]) ** 2;
  for (let j = 0; j < width; j += 1)
    spread[j] = Math.sqrt(spread[j] / Math.max(1, rows.length)) || 1;
  return { mean, spread };
}

/**
 * **One score per finding, none of them from a model that saw it.**
 *
 * The fold key is the pull request, and it has to be: the corpus holds goldens per pull request, so a model fitted
 * across two rows of one pull request has seen that pull request's goldens and would score its own training set.
 */
export function leaveOnePullRequestOut(findings, options = {}) {
  const rows = findings.map(featuresOf);
  const labels = findings.map(labelOf);
  const keys = findings.map((finding) => String(finding?.pr ?? ''));
  const scores = new Array(findings.length).fill(0);
  for (const held of new Set(keys)) {
    const train = [];
    const trainLabels = [];
    for (let i = 0; i < findings.length; i += 1) {
      if (keys[i] === held) continue;
      train.push(rows[i]);
      trainLabels.push(labels[i]);
    }
    if (train.length === 0) continue;
    const { mean, spread } = standardise(train);
    const scaled = train.map((row) => row.map((value, j) => (value - mean[j]) / spread[j]));
    const weights = fitLogistic(scaled, trainLabels, options);
    for (let i = 0; i < findings.length; i += 1) {
      if (keys[i] !== held) continue;
      let z = 0;
      for (let j = 0; j < rows[i].length; j += 1)
        z += ((rows[i][j] - mean[j]) / spread[j]) * weights[j];
      scores[i] = z;
    }
  }
  return scores;
}

/** One operating point, scored the way `operating-point.mjs` scores any other cut. */
export function scoreCut(findings, steps, goldens) {
  const kept = applyCut(findings, steps);
  const truePositives = maximumMatchingByPullRequest(
    kept,
    (finding) => finding.matchedGoldens ?? [],
  );
  return {
    emitted: kept.length,
    truePositives,
    precision: kept.length === 0 ? 0 : truePositives / kept.length,
    recall: goldens === 0 ? 0 : truePositives / goldens,
    f1: f1FromCounts(truePositives, kept.length, goldens),
  };
}

/** The artifact's own cut, as the artifact recorded it. */
export function shippedSteps(artifact) {
  return artifact?.emissionRules?.shipped?.steps ?? [];
}

/**
 * **The two orderings and the budget curve, off one artifact.**
 *
 * `ordering` replaces `score` in a copy of every finding, so nothing the caller holds is mutated - a replay that edited
 * the artifact would make the second reading a reading of the first.
 */
export function replay(artifact, options = {}) {
  const findings = artifact?.rankedFindings ?? [];
  const goldens = Number(artifact?.missedGoldens?.total ?? 0);
  const steps = shippedSteps(artifact);
  if (findings.length === 0 || steps.length === 0) return null;
  const asShipped = findings.map((finding) => ({ ...finding, score: scoreOf(finding) }));
  const fittedScores = leaveOnePullRequestOut(findings, options);
  const asFitted = findings.map((finding, at) => ({ ...finding, score: fittedScores[at] }));
  return {
    goldens,
    shipped: scoreCut(asShipped, steps, goldens),
    fitted: scoreCut(asFitted, steps, goldens),
    curve: curveOf(asShipped, steps, goldens),
  };
}

/** The budget step swept from the smallest useful cap to none at all. */
export function curveOf(
  findings,
  steps,
  goldens,
  budgets = [4, 6, 8, 10, 12, 16, 20, 24, 32, 48, Infinity],
) {
  const prefix = steps.filter((step) => step.kind !== 'budget');
  return budgets.map((k) => ({
    budget: Number.isFinite(k) ? k : null,
    ...scoreCut(
      findings,
      [...prefix, ...(Number.isFinite(k) ? [{ kind: 'budget', k }] : [])],
      goldens,
    ),
  }));
}

/** Read an artifact from disk. Throws rather than returning a zero: an empty artifact is a typo, not a result. */
export function loadArtifact(path) {
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(artifact?.rankedFindings) || artifact.rankedFindings.length === 0)
    throw new Error(`${path} carries no rankedFindings`);
  return artifact;
}
