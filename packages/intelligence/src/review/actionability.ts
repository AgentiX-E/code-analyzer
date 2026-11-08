// @code-analyzer/intelligence — Ranking findings by whether a developer would act on them
//
// **The measurement this exists for, in this repository's own numbers.** On AACR-Bench's first five pull requests this
// engine emits **105 findings and finds 19 of 50 labelled issues** - recall 0.38, precision 0.18, F1 0.2452. A
// competitor run in the same job over the same diffs, judged by the same model against the same goldens, emits **45
// findings and finds the same 19** - precision 0.42, F1 0.40. **The recall is identical.** The difference is that
// **two thirds of what this engine says is not a defect**, and the reader pays for every one of those lines.
//
// **So the missing capability is not detection, it is selection**, and selection has to be decided from the finding
// itself rather than from the answer key - otherwise it is not a product feature, it is a lookup. Everything below is
// computed from **the diff the review already had** and **the finding the model already wrote**: no goldens, no second
// model, no network.
//
// **The four literatures this follows**, each found by searching rather than assumed:
//
//   - *Refute-or-Promote* (arXiv 2604.19049) reports **~79% of review candidates killed before disclosure** by a gate
//     that requires evidence rather than agreement, which is why the first term below is a location check and not a
//     confidence score.
//   - QASecClaw (arXiv 2605.01885) takes a scanner from **F1 78.39% to 90.93%** by cutting false positives **88.6%**
//     while losing **3.1%** of recall - the shape a selector should have, and the reason recall is reported beside
//     precision everywhere this module is measured.
//   - *Sifting the Noise* (arXiv 2601.22952) is the warning: aggressive filtering **suppressed 22% of true
//     vulnerabilities**, so **nothing here drops a finding** - every rule changes an order, and the caller decides
//     what to emit.
//   - CodeRabbit's published pipeline runs *"a separate judge model that drops findings it cannot ground"*; this is the
//     same idea done with arithmetic, because a second model per finding costs a call per finding and cannot be unit
//     tested.

import type { LLMFinding } from './llm/prompts.js';
import type { Severity } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// What the diff can answer without a model
// ---------------------------------------------------------------------------

/** The two facts a unified diff carries that a finding can be checked against. */
export interface DiffFacts {
  /** Added lines, by path and by the line number they hold **in the new file**. */
  readonly added: ReadonlyMap<string, ReadonlyMap<number, string>>;
  /** Every line the diff shows for a path, added, removed or context, for quotation checks. */
  readonly shown: ReadonlyMap<string, string>;
}

/** `b/` and `a/` prefixes, and the quoting git applies to paths it considers unusual. */
function normalisePath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2);
  return path;
}

/**
 * Read a unified diff into the facts a ranking needs.
 *
 * **New-file line numbers, counted from the hunk header rather than from the top of the diff.** A finding's
 * `startLine` is a line in the file the prompt showed it, and the prompt shows a diff - so the only number the two
 * share is the one the `@@ -a,b +c,d @@` header names. **Counting `+` lines from one and comparing them to a number
 * the model derived from the other is the coordinate-system defect this repository already paid for once**, when a
 * filter compared file lines against a diff's length and discarded 194 findings.
 *
 * Removed lines are kept in `shown` and **not** in `added`: a finding about a line that no longer exists is about the
 * old file, and an old file is not what a reviewer can act on.
 */
export function collectDiffFacts(unified: string): DiffFacts {
  const added = new Map<string, Map<number, string>>();
  const shown = new Map<string, string[]>();
  let path: string | null = null;
  let newLine = 0;

  const remember = (target: string, line: string): void => {
    const lines = shown.get(target);
    if (lines) lines.push(line);
    else shown.set(target, [line]);
  };

  for (const raw of String(unified).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      path = normalisePath(String(header[2]));
      if (!added.has(path)) added.set(path, new Map());
      continue;
    }
    // **A diff without the `diff --git` header is a diff of one file**, which is what a single-hunk paste looks like.
    const plusPlus = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (plusPlus && !line.startsWith('+++ /dev/null')) {
      path = normalisePath(String(plusPlus[1]));
      if (!added.has(path)) added.set(path, new Map());
      continue;
    }
    if (path === null) continue;

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file" addresses the previous line.
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    if (line.startsWith('+')) {
      added.get(path)?.set(newLine, line.slice(1));
      remember(path, line.slice(1));
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      remember(path, line.slice(1));
      continue;
    }
    if (line.startsWith(' ')) {
      remember(path, line.slice(1));
      newLine += 1;
    }
  }

  return {
    added: new Map([...added].filter(([, lines]) => lines.size > 0)),
    shown: new Map([...shown].map(([key, lines]) => [key, lines.join('\n')])),
  };
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/**
 * **What each term is worth, and why the numbers sum to one.**
 *
 * **The sum is one on purpose**: a score is then a proportion of the evidence available, so a threshold on it means
 * the same thing across corpora, and **the operating point can be stated as a rule about a comment rather than as a
 * budget about a corpus** - a budget would have to be chosen from the curve, and a point chosen after seeing the
 * curve is a point tuned on the test set.
 *
 * **Grounding carries the largest share because it is the only term that can be decided.** A comment whose range
 * covers no added line is about code the pull request did not change; whatever else is true of it, the reader cannot
 * act on it here. **The other five are judgements about the sentence**, and they are weighted below it on purpose.
 */
export const ACTIONABILITY_WEIGHTS = Object.freeze({
  /** The finding's range covers at least one added line of the same file. */
  grounded: 0.3,
  /** The suggestion names an action or shows a replacement, rather than describing a wish. */
  proposesChange: 0.2,
  /** The finding quotes text that literally appears among the added lines. */
  quotesDiff: 0.14,
  /** The finding names an identifier the diff touches, so the reader knows what to rename or fix. */
  namesSymbol: 0.08,
  /** Independent lanes agreed: one defect seen by three angles is likelier a defect than one seen by one. */
  agreement: 0.1,
  /** What a maintainer would stop a merge for. */
  severity: 0.12,
  /** The lane's prior, which is a statement about base rates rather than about this finding. */
  lane: 0.06,
  /** **Subtracted**, because hedged language is a claim the model declined to make. */
  hedgePenalty: 0.1,
});

/** The severity prior, and the reason it is a table rather than a multiplier. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.55,
  low: 0.25,
  info: 0,
};

/** Lane priors, from the base rates the review protocol measured per lane. */
const LANE_WEIGHT: Record<string, number> = {
  security: 1,
  performance: 0.7,
  architecture: 0.5,
  testing: 0.4,
  maintainability: 0.35,
};

/** Words that look like identifiers and are not. */
const NOT_A_SYMBOL = new Set(
  `this that these those when which while where there their about above after again against
   other should would could might must value values string number object array function method class
   return returns error errors input output result results code file files line lines null true false
   undefined const let var async await public private static void import export default from with into
   than then also only more most less some such have been were does done make makes made used using
   test tests type types case cases data item items list sets same each every both either neither
   because before below between during under until while without within would still just like need
   needs needed call calls called check checks checking take takes place point points part parts`
    .split(/\s+/)
    .filter(Boolean),
);

/** Imperative openings that make a suggestion an instruction rather than a description. */
const IMPERATIVE =
  /^(add|allow|apply|assert|avoid|await|call|cast|change|check|clamp|close|compare|convert|declare|default|define|delete|document|ensure|escape|extract|fail|fix|guard|handle|hoist|initialise|initialize|inline|lock|log|make|mark|merge|move|pass|prefer|prevent|remove|rename|replace|require|reset|return|reuse|reorder|set|simplify|split|throw|trim|update|use|validate|verify|wrap)\b/i;

/** Hedges, which are a claim the model declined to make. */
const HEDGED =
  /\b(might|could|may|maybe|perhaps|possibly|potentially|consider|would be|seems|appears to|likely|unclear|not sure)\b/i;

/** Identifiers, which are what a developer searches for after reading a comment. */
function identifiers(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g)) {
    const token = match[0];
    if (!NOT_A_SYMBOL.has(token.toLowerCase())) found.add(token);
  }
  return found;
}

/** What a reading of one finding produced, kept separable so a reader can disagree with a term. */
export interface ActionabilityFeatures {
  grounded: boolean;
  quotesDiff: boolean;
  namesSymbol: boolean;
  proposesChange: boolean;
  hedged: boolean;
  /** How many findings the engine's own deduplication folded into this one; 1 when it stood alone. */
  agreement: number;
  severity: Severity;
  lane: string | null;
}

/** A score, the gate it implies, and the reasons behind both. */
export interface ActionabilityScore {
  /** Weighted evidence in `[0, 1]`, rounded to four decimals so two runs print the same number. */
  score: number;
  /** **The pre-registered emission rule**: the comment points at changed code and says what to change. */
  actionable: boolean;
  features: ActionabilityFeatures;
  /** Each condition that failed or each penalty applied, so the verdict can be argued with. */
  why: string[];
}

/** One finding and the path its line numbers belong to. */
export interface LocatedFinding {
  finding: LLMFinding;
  path: string;
}

/**
 * Score one finding against the diff it came from.
 *
 * **No finding is dropped here.** `actionable` is a recommendation and `score` is an order; the caller decides what
 * reaches a reader, because a selector that silently discards is the failure *Sifting the Noise* measured.
 */
export function weighFinding(located: LocatedFinding, facts: DiffFacts): ActionabilityScore {
  const { finding, path } = located;
  const added = facts.added.get(path) ?? new Map<number, string>();
  const addedLines = [...added.values()];
  const narrative = `${finding.title} ${finding.description}`;
  const quoted = `${finding.snippet ?? ''} ${narrative}`.trim();

  // **Grounding is a range intersection, and an inverted range is grounded in nothing.**
  let grounded = false;
  if (Number.isInteger(finding.startLine) && Number.isInteger(finding.endLine)) {
    const from = Math.min(finding.startLine, finding.endLine);
    const to = Math.max(finding.startLine, finding.endLine);
    for (const line of added.keys()) {
      if (line >= from && line <= to) {
        grounded = true;
        break;
      }
    }
  }

  const trimmedQuote = quoted.trim();
  const quotesDiff = addedLines.some((line) => {
    const text = line.trim();
    return text.length >= 12 && trimmedQuote.includes(text);
  });

  const symbolSet = identifiers(narrative);
  const namesSymbol = addedLines.some((line) =>
    [...identifiers(line)].some((token) => symbolSet.has(token)),
  );

  const suggestion = (finding.suggestion ?? '').trim();
  const proposesChange =
    suggestion.length >= 8 &&
    (/[`\n]/.test(suggestion) || IMPERATIVE.test(suggestion) || /\bnot\b/i.test(suggestion));

  const hedged = HEDGED.test(narrative);
  const lane = finding.lane ?? null;
  // **A count the engine did not write is one lane, not zero** - and `NaN` is what an arithmetic slip looks like, so it
  // is treated the same way rather than poisoning every term after it.
  const corroboration = finding.agreement;
  const agreement =
    corroboration !== undefined && Number.isFinite(corroboration) ? Math.max(1, corroboration) : 1;

  const w = ACTIONABILITY_WEIGHTS;
  let score = 0;
  const why: string[] = [];

  if (grounded) score += w.grounded;
  else why.push('the range covers no added line, so the comment is not about this change');
  if (proposesChange) score += w.proposesChange;
  else why.push('the suggestion names no action and shows no replacement');
  if (quotesDiff) score += w.quotesDiff;
  else why.push('no quoted code from the added lines');
  if (namesSymbol) score += w.namesSymbol;
  else why.push('no identifier the diff touches is named');
  score += w.agreement * (Math.min(agreement, 3) / 3);
  score += w.severity * SEVERITY_WEIGHT[finding.severity];
  score += w.lane * (LANE_WEIGHT[lane ?? ''] ?? 0.5);
  if (hedged) {
    score -= w.hedgePenalty;
    why.push('hedged language, which is a claim the model declined to make');
  }

  return {
    score: Math.round(Math.max(0, Math.min(1, score)) * 10_000) / 10_000,
    actionable: grounded && (proposesChange || quotesDiff),
    features: {
      grounded,
      quotesDiff,
      namesSymbol,
      proposesChange,
      hedged,
      agreement,
      severity: finding.severity,
      lane,
    },
    why,
  };
}

/** A finding with its score, and where it sat in the input so a tie is broken deterministically. */
export interface RankedFinding extends LocatedFinding {
  score: ActionabilityScore;
  /** The input position, which is what makes a tie-break stable across runs. */
  index: number;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Order findings by the probability a developer would act on them.
 *
 * **The tie-breaks are stated rather than left to the sort**: score, then agreement, then severity, then input order.
 * **A ranking whose output depends on the engine's sort stability is a ranking two runs cannot compare**, and this
 * project has already paid for that once with a deduplication order that had to be pinned to severity and lane.
 */
export function rankFindings(
  items: ReadonlyArray<LocatedFinding>,
  facts: DiffFacts,
): RankedFinding[] {
  return items
    .map((item, index) => ({ ...item, index, score: weighFinding(item, facts) }))
    .sort(
      (a, b) =>
        b.score.score - a.score.score ||
        b.score.features.agreement - a.score.features.agreement ||
        SEVERITY_ORDER[b.finding.severity] - SEVERITY_ORDER[a.finding.severity] ||
        a.index - b.index,
    );
}

// ---------------------------------------------------------------------------
// Scoring a ranked list at every budget
// ---------------------------------------------------------------------------

/** One point of a top-k curve. */
export interface TopKPoint {
  k: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/**
 * **The largest set of goldens a set of findings can account for, computed rather than assumed.**
 *
 * **Why a maximum matching and not a greedy walk.** The first version of this measurement consumed each golden with the
 * first finding that matched it, which makes the score depend on the order findings were judged in - and **a score
 * that depends on an order is a score that cannot be compared between two reviewers judged in different orders.**
 * Kuhn's augmenting-path algorithm answers the question the metric actually asks: given these findings and these
 * goldens, **how many distinct goldens can be covered at once**.
 *
 * The inputs are tiny - tens of findings against tens of goldens per pull request - so the O(V·E) form is right; a
 * Hopcroft-Karp implementation would be a faster answer to a question that is not slow.
 */
export function maximumMatchingCount(
  matches: ReadonlyArray<ReadonlyArray<number>>,
  goldens: number,
): number {
  return matchedGoldenIndices(matches, goldens).length;
}

/**
 * **Which goldens a maximum matching covers, rather than how many.**
 *
 * **A count answers the metric; the set answers the comparison.** Two reviewers scored 19 and 19 have the same F1 and
 * can have found nineteen different issues - and **a paired significance test needs the pairing, not the totals**, which
 * is the whole reason McNemar exists as a separate test from a difference of proportions.
 *
 * The algorithm is Kuhn's augmenting path, the same one the count has always used; what is returned is the goldens that
 * ended up owned rather than the number of them.
 */
export function matchedGoldenIndices(
  matches: ReadonlyArray<ReadonlyArray<number>>,
  goldens: number,
): number[] {
  // **The owner is the row itself rather than its index**, so no step of the search has to look a row up by a number it
  // just read out of another row - which is the shape that needs a fallback for a lookup that cannot fail. A map rather
  // than a pre-filled array, because **an absent entry and an entry holding nothing are the same state here** and a map
  // says that without a sentinel the type has to be widened for.
  const ownerRow = new Map<number, readonly number[]>();

  const augment = (row: readonly number[], seen: boolean[]): boolean => {
    for (const golden of row) {
      if (golden < 0 || golden >= goldens || seen[golden]) continue;
      seen[golden] = true;
      const owner = ownerRow.get(golden);
      if (owner === undefined || augment(owner, seen)) {
        ownerRow.set(golden, row);
        return true;
      }
    }
    return false;
  };

  for (const row of matches) augment(row, new Array<boolean>(goldens).fill(false));

  return [...ownerRow.keys()].sort((a, b) => a - b);
}

/**
 * The curve: every budget from one finding to all of them.
 *
 * **The input is one boolean per finding, in rank order**, because **the point of a curve is that it can be drawn from
 * a single pass of judging** - re-judging the corpus at every `k` would spend the model's budget on the same pairs.
 * The harness therefore stores, per finding, which goldens it matched, and this function turns that into the curve.
 */
export function topKCurve(
  matchedPerFinding: ReadonlyArray<readonly number[]>,
  totalGoldens: number,
): TopKPoint[] {
  const points: TopKPoint[] = [];
  for (let k = 1; k <= matchedPerFinding.length; k += 1) {
    const truePositives = maximumMatchingCount(matchedPerFinding.slice(0, k), totalGoldens);
    const falsePositives = k - truePositives;
    const falseNegatives = Math.max(0, totalGoldens - truePositives);
    points.push(point(k, truePositives, falsePositives, falseNegatives));
  }
  return points;
}

/** One scored set, whether it came from a budget or from a filter. */
export function point(
  k: number,
  truePositives: number,
  falsePositives: number,
  falseNegatives: number,
): TopKPoint {
  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  return {
    k,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0),
  };
}

/**
 * Score a subset of a judged ranked list - the shape a filter produces.
 *
 * **A subset is not a prefix**, so the curve above cannot answer for it: dropping a middle finding can free a golden
 * for a lower one, and only a matching over the subset says how many were covered.
 */
export function scoreSubset(
  matchedPerFinding: ReadonlyArray<readonly number[]>,
  keep: ReadonlyArray<boolean>,
  totalGoldens: number,
): TopKPoint {
  const kept = matchedPerFinding.filter((_, index) => keep[index] === true);
  const truePositives = maximumMatchingCount(kept, totalGoldens);
  return point(
    kept.length,
    truePositives,
    kept.length - truePositives,
    Math.max(0, totalGoldens - truePositives),
  );
}
