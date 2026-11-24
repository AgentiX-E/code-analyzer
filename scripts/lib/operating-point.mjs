// @code-analyzer — The arithmetic an operating point is, over verdicts a run already paid for
//
// **A run judges every (finding, golden) pair once and then reports one cut of that matrix.** The cut used to be fixed
// in the harness before the run, which meant the only way to ask "what would a different cut have scored" was another
// dispatch - two hours and about a dollar per question, with fresh model output on both sides, so the answer arrived
// carrying the model's variance on top of the question's.
//
// The artifact already carries the verdicts. `rankedFindings[].matchedGoldens` is that finding's row of the matrix
// **before** the per-pull-request maximum matching, so every cut can be scored from one run's own arithmetic. That is
// what this module does, and it is why an operating point is now a `$0` question with no sampling noise: the findings
// and the verdicts are identical across the cuts being compared, and the only thing that changes is which of them
// reach a reader.
//
// **What it is not.** It cannot invent findings a run did not emit, so it prices cuts and not devices that change
// emission. A device needs a dispatch; a cut does not, and the difference used to be invisible because both were
// measured the same way.
//
// **The matching is the corpus's protocol, not a second one invented here**: one verdict per pair, then a maximum
// bipartite matching per pull request, because **one finding is credited with one golden and one golden with one
// finding**. Greedy assignment over the same rows reports more credit than the corpus does - two findings that both
// claim the same golden while a second golden has a single claimant is the ordinary case - so this is not an
// optimisation.

/**
 * **The size of the maximum matching, per pull request.**
 *
 * Kuhn's augmenting path, which is enough for the reason the corpus makes it enough: a pull request carries tens of
 * findings and a handful of goldens, so the quadratic factor is smaller than the cost of reading the list.
 *
 * Golden indices are **per pull request**, which is why the matching cannot be computed across the run: two pull
 * requests both numbering their goldens from zero would share credit the corpus holds separately.
 */
export function maximumMatchingByPullRequest(findings, creditOf) {
  const byPullRequest = new Map();
  for (const [at, finding] of findings.entries()) {
    const key = pullRequestOf(finding);
    const bucket = byPullRequest.get(key);
    if (bucket === undefined) byPullRequest.set(key, [at]);
    else bucket.push(at);
  }

  let total = 0;
  for (const positions of byPullRequest.values()) {
    /** golden index -> position of the finding that holds it. */
    const holder = new Map();
    const augment = (position, seen) => {
      for (const golden of creditOf(findings[position])) {
        if (seen.has(golden)) continue;
        seen.add(golden);
        const incumbent = holder.get(golden);
        if (incumbent === undefined || augment(incumbent, seen)) {
          holder.set(golden, position);
          return true;
        }
      }
      return false;
    };
    for (const position of positions) augment(position, new Set());
    total += holder.size;
  }
  return total;
}

/** The pairing key. The corpus keys a golden by pull request plus its index within that pull request. */
export function pullRequestOf(finding) {
  return String(finding?.['pr'] ?? '');
}

/** The score a budget ranks by, read from either shape an artifact has carried. */
export function scoreOf(finding) {
  const value = finding?.['score'];
  if (typeof value === 'number') return value;
  return Number(value?.score ?? 0);
}

/**
 * **F1 as credit over the sum of the two denominators, which is the same number and a checkable one.**
 *
 * `2PR/(P+R)` with `P = TP/C` and `R = TP/G` cancels to `2·TP/(C+G)`. **This is not a third formula, it is the shortest
 * form of the second** - and it is the form that answers the question every remaining device asks, because it makes the
 * marginal value of one more comment `2p/(C+G)` against a cost of `1/(C+G)`: **an added comment earns its place exactly
 * when its own precision exceeds `TP/(C+G)`, which is half the F1 it joins.**
 *
 * The cancelled form is what `score` publishes, so the threshold in `breakEvenPrecision` cannot drift from the figure it
 * is derived from. A run that computed F1 one way and priced a device the other would be two arithmetics about one
 * number, which is the defect this file exists to remove.
 */
export function f1FromCounts(truePositives, emitted, goldens) {
  const denominators = emitted + goldens;
  if (denominators === 0) return 0;
  return (2 * truePositives) / denominators;
}

/**
 * **One operating point, scored the way the artifact scored its own.**
 *
 * `goldens` is the run's denominator, passed in rather than counted from the cut: **a cut does not change how many
 * goldens the corpus holds**, and a recall computed from the cut's own misses would rise every time the cut shrank.
 */
export function score(findings, creditOf, goldens) {
  const emitted = findings.length;
  const truePositives = maximumMatchingByPullRequest(findings, creditOf);
  const falsePositives = emitted - truePositives;
  const falseNegatives = Math.max(0, goldens - truePositives);
  const precision = emitted === 0 ? 0 : truePositives / emitted;
  const recall = goldens === 0 ? 0 : truePositives / goldens;
  const f1 = f1FromCounts(truePositives, emitted, goldens);
  return { emitted, truePositives, falsePositives, falseNegatives, precision, recall, f1 };
}

/**
 * **The precision an added comment needs to be worth adding, which is half the F1 it joins.**
 *
 * §58.4 published **0.30** for this and the arithmetic says **0.104** on the same run. The difference is not a rounding
 * of the same caution: at 0.30 every device that adds a comment is ruled out by construction, and at 0.104 the two
 * candidates the same paragraph was arguing against become measurable questions. **A threshold is a claim, and this one
 * is cheap enough to derive that it should never have been estimated.**
 *
 * It is `null` when the point credits nothing, because a run with no F1 has no line to cross and a caller that reads a
 * fabricated `0` would accept every comment ever written.
 */
export function breakEvenPrecision(point) {
  const f1 = Number(point?.f1 ?? 0);
  return Number.isFinite(f1) ? f1 / 2 : null;
}

/**
 * **What a run would have scored with `comments` more comments, `truePositives` of them credited.**
 *
 * The goldens are read back from the point as `TP + FN`, because **a projection may not change the corpus** - and a
 * caller that passed its own denominator could quietly compare two runs on two different corpora and call the
 * difference a device.
 *
 * `delta` is against the point **as it stands**, so a row of a table built from this function cannot show a projection
 * that improves F1 while the threshold says it should not: both read the same cancellation.
 */
export function projectAddition(point, { comments, truePositives }) {
  const goldens = Number(point?.truePositives ?? 0) + Number(point?.falseNegatives ?? 0);
  const projected = score(
    Array.from({ length: Number(point?.emitted ?? 0) + comments }, (_, at) => ({
      // **The credit is handed over as rows rather than as a count**, because the count is the projection's input and the
      // matching is the scorer's job - a shortcut here would be a second implementation of the number under test.
      pr: 'projected',
      matchedGoldens: at < Number(point?.truePositives ?? 0) + truePositives ? [at] : [],
    })),
    (finding) => finding.matchedGoldens ?? [],
    goldens,
  );
  return { ...projected, delta: projected.f1 - Number(point?.f1 ?? 0) };
}

/**
 * **Which class a finding's path belongs to, for `drop-path-class`.**
 *
 * **A second implementation of `reviewPathClass`, and the test is the guard.** `scripts/lib` is plain ESM with no build
 * step, so it cannot import the package; §54's own solution to this - two implementations of one cut, with
 * `the-shipped-point-is-a-row-of-the-table-that-prices-it.test.ts` asserting they agree on a fixture that reaches every
 * branch - is the one followed here, and the fixture was extended by §106 to carry one path per class.
 */
const PATH_CLASS_RULES = [
  ['fixture', /(^|\/)(testdata|__snapshots__|baselines|goldens?)(\/|$)/u],
  [
    'test',
    /(^|\/)(test|tests|testing|spec|specs|__tests__|e2e)(\/|$)|(^|\/)[^/]*[._-](test|spec)\.[a-z]+$/u,
  ],
  [
    'vendored',
    /(^|\/)(3rdparty|third[_-]party|vendor|vendored|external|extern|node_modules)(\/|$)/u,
  ],
  ['docs', /(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc|txt)$/u],
  [
    'source',
    /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|py|pyi|js|jsx|mjs|cjs|ts|tsx|java|kt|kts|groovy|scala|swift|go|rs|rb|php|cs|dart|lua|pl|r|jl|ex|exs|hs|ml|clj)$/u,
  ],
];

/** The class of one path, from the path alone. */
export function pathClassOf(path) {
  const normalised = String(path ?? '')
    .replace(/\\/gu, '/')
    .toLowerCase();
  if (normalised === '') return 'other';
  for (const [pathClass, test] of PATH_CLASS_RULES) if (test.test(normalised)) return pathClass;
  return 'other';
}

/**
 * **A cut, as steps applied in order.**
 *
 * The structure is the smallest that can express the two things a run has ever varied: **what kind of finding may
 * reach a reader** (`gate`, `drop`, `keep-category`) and **how many may reach one per pull request** (`budget`).
 * Composing them is not a convenience - the registered profile floor and the registered actionability gate are one
 * operating point, and a table that scored them separately would be two rows about a reviewer nobody ran.
 *
 * The step set is deliberately small. **A rule language with more expressive power than the campaign has hypotheses is
 * a rule language that can fit the corpus**, and the point of this module is to price cuts that were registered, not
 * to search for the cut that maximises the last column of its own table.
 */
export function applyCut(findings, steps) {
  let kept = [...findings];
  for (const step of steps) {
    if (step.kind === 'drop-path-class') {
      const unwanted = new Set(step.classes);
      kept = kept.filter(
        (finding) =>
          !unwanted.has(
            pathClassOf(finding?.['filePath'] ?? finding?.['path'] ?? finding?.['file']),
          ),
      );
    } else if (step.kind === 'drop') {
      const unwanted = new Set(step.categories);
      kept = kept.filter((finding) => !unwanted.has(String(finding?.['category'] ?? '')));
    } else if (step.kind === 'keep-category') {
      const wanted = new Set(step.categories);
      kept = kept.filter((finding) => wanted.has(String(finding?.['category'] ?? '')));
    } else if (step.kind === 'gate') {
      kept = kept.filter((finding) => finding?.['actionable'] === true);
    } else if (step.kind === 'quota') {
      // **A quota is per pull request, like the budget it competes with.** A run-wide quota would be a first-come
      // allocation between repositories, which is a property of the order the corpus was read in and not of the
      // reviewer. Ties keep the artifact's order for the same reason the budget does.
      const capped = new Set(step.categories);
      const held = new Map();
      for (const [at, finding] of kept.entries()) {
        const category = String(finding?.['category'] ?? '');
        if (!capped.has(category)) continue;
        const key = `${pullRequestOf(finding)}\u0000${category}`;
        const bucket = held.get(key);
        if (bucket === undefined) held.set(key, [{ finding, at }]);
        else bucket.push({ finding, at });
      }
      const allowed = new Set();
      for (const bucket of held.values()) {
        const ordered = bucket
          .map((entry) => ({ ...entry, score: scoreOf(entry.finding) }))
          .sort((left, right) => right.score - left.score || left.at - right.at);
        for (const entry of ordered.slice(0, step.k)) allowed.add(entry.finding);
      }
      kept = kept.filter(
        (finding) => !capped.has(String(finding?.['category'] ?? '')) || allowed.has(finding),
      );
    } else if (step.kind === 'budget') {
      const byPullRequest = new Map();
      for (const finding of kept) {
        const key = pullRequestOf(finding);
        const bucket = byPullRequest.get(key);
        if (bucket === undefined) byPullRequest.set(key, [finding]);
        else bucket.push(finding);
      }
      const withinBudget = [];
      for (const bucket of byPullRequest.values()) {
        // **Highest score first, and ties keep the artifact's order** - so a cut is reproducible from the artifact
        // alone rather than from the order a particular engine happened to sort equal keys in.
        const ordered = bucket
          .map((finding, at) => ({ finding, at, score: scoreOf(finding) }))
          .sort((left, right) => right.score - left.score || left.at - right.at);
        for (const entry of ordered.slice(0, step.k)) withinBudget.push(entry.finding);
      }
      kept = withinBudget;
    } else {
      throw new Error(`unknown cut step "${String(step.kind)}"`);
    }
  }
  return kept;
}

/** The label a table row prints, derived from the cut rather than written beside it. */
export function describeCut(steps) {
  if (steps.length === 0) return 'no rule';
  return steps
    .map((step) => {
      if (step.kind === 'drop') return `drop ${step.categories.join('+')}`;
      if (step.kind === 'keep-category') return `keep ${step.categories.join('+')}`;
      if (step.kind === 'drop-path-class') return `drop path ${step.classes.join('+')}`;
      if (step.kind === 'gate') return 'actionability gate';
      if (step.kind === 'budget') return `budget ${step.k}`;
      if (step.kind === 'quota') return `quota ${step.categories.join('+')} ${step.k}`;
      return String(step.kind);
    })
    .join(', ');
}

/**
 * **The cuts the campaign has a hypothesis about, in the order a reader should meet them.**
 *
 * `as shipped` first because it is the figure in every published table, and `no rule` second because **a cut that has
 * never been compared against no cut is a cut nobody has priced** - which was true of the actionability gate for
 * several iterations, and is why this list starts with the two extremes rather than with the candidates.
 *
 * The rest are the registered profile floor's own categories and the budgets the artifact already reports a curve for,
 * so every row here is a row some sentence in `EVAL-CONTRACT.md` can point at.
 */
export function registeredCuts(budgets = [6, 8, 10, 12, 13, 14, 16, 20, 24]) {
  const cuts = [
    { steps: [{ kind: 'gate' }] },
    { steps: [] },
    { steps: [{ kind: 'drop', categories: ['test'] }] },
    { steps: [{ kind: 'drop', categories: ['test', 'architecture'] }] },
    { steps: [{ kind: 'drop', categories: ['test', 'architecture', 'style'] }] },
  ];
  for (const budget of budgets) {
    cuts.push({
      steps: [
        { kind: 'drop', categories: ['test'] },
        { kind: 'budget', k: budget },
      ],
    });
    // **And the same cut with §106's path step**, because the shipped policy is this pair and a table that priced the
    // policy without one of its steps would be pricing a reviewer nobody runs.
    cuts.push({
      steps: [
        { kind: 'drop', categories: ['test'] },
        { kind: 'drop-path-class', classes: ['test'] },
        { kind: 'budget', k: budget },
      ],
    });
    cuts.push({ steps: [{ kind: 'budget', k: budget }] });
  }
  return cuts;
}

/**
 * **The registered cuts, scored, as rows an artifact can carry.**
 *
 * The CLI prints this table and the benchmark writes it into the artifact, from one implementation, because **two
 * implementations of one table is two tables** - and the artifact's copy is the one a reader will find first, weeks
 * later, with no CLI beside it.
 *
 * Each row carries its own `steps` and not only its label: **a label is a name for a rule and the steps are the rule**,
 * so a reader who disagrees with a row can re-apply it to the same `rankedFindings` and get either the same number or a
 * bug, with no reading of prose in between.
 */
export function operatingPointTable(findings, goldens, budgets) {
  return registeredCuts(budgets).map(({ steps }) => ({
    cut: describeCut(steps),
    steps,
    ...score(applyCut(findings, steps), (finding) => finding?.['matchedGoldens'] ?? [], goldens),
  }));
}

/**
 * **A cut written the way a person writes it**, so a frozen rule can be named in a workflow input and applied to an
 * artifact months later without the reader having to reconstruct it from a table.
 *
 * `drop:test,architecture` · `keep-category:bug,security` · `gate` · `budget:12` · `drop:test+budget:12`
 *
 * The separator inside a category list is a comma and the separator between steps is a plus, because **a cut whose
 * spelling could be read two ways is a cut two readers can disagree about** - and the disagreement would be about the
 * rule rather than about the number, which is the harder one to notice.
 */
export function parseCut(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '' || trimmed === 'all' || trimmed === 'no rule') return [];
  return trimmed.split('+').map((token) => {
    const [kind, argument = ''] = token.trim().split(':');
    if (kind === 'gate') return { kind: 'gate' };
    if (kind === 'drop' || kind === 'keep-category') {
      const categories = argument
        .split(',')
        .map((category) => category.trim())
        .filter((category) => category.length > 0);
      if (categories.length === 0) throw new Error(`"${token}" names no category`);
      return { kind, categories };
    }
    if (kind === 'quota') {
      // `quota:<categories>=<k>`. **Zero is a legal quota and is not a `budget`**: it is the same cut as `drop`, and a
      // parser that refused it would make the two spellings of one cut two cuts.
      const [named, count] = argument.split('=');
      const categories = String(named ?? '')
        .split(',')
        .map((category) => category.trim())
        .filter((category) => category.length > 0);
      if (categories.length === 0) throw new Error(`"${token}" names no category`);
      // **An empty count is not zero**: `Number('')` is `0`, so a quota with nothing after the `=` would silently be a
      // deletion - the one meaning a typo must never acquire.
      const k = String(count ?? '').trim() === '' ? Number.NaN : Number(count);
      if (!Number.isInteger(k) || k < 0) throw new Error(`"${token}" is not a quota`);
      return { kind: 'quota', categories, k };
    }
    if (kind === 'budget') {
      const k = Number(argument);
      if (!Number.isInteger(k) || k < 1) throw new Error(`"${token}" is not a budget`);
      return { kind: 'budget', k };
    }
    // **`drop-path` rather than `drop-path-class`**, because the spelling a person types should be the short one and the
    // step's own name is what `describeCut` prints; a cut named in a report and a cut parsed from a command line have to
    // be the same cut, and the two spellings differ only where the reader is not looking.
    if (kind === 'drop-path') {
      const classes = argument
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (classes.length === 0) throw new Error(`"${token}" names no path class`);
      return { kind: 'drop-path-class', classes };
    }
    throw new Error(`unknown cut step "${token}"`);
  });
}

export const TABLE_HEADER = 'cut                              n   tp       P       R      F1';

/** One line of the table, in the fixed-width shape the artifact's own tables use. */
export function formatRow(label, point, width = 30) {
  return [
    label.padEnd(width),
    String(point.emitted).padStart(5),
    String(point.truePositives).padStart(4),
    point.precision.toFixed(4).padStart(7),
    point.recall.toFixed(4).padStart(7),
    point.f1.toFixed(4).padStart(7),
  ].join(' ');
}
