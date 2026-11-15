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
function scoreOf(finding) {
  const value = finding?.['score'];
  if (typeof value === 'number') return value;
  return Number(value?.score ?? 0);
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
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { emitted, truePositives, falsePositives, falseNegatives, precision, recall, f1 };
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
    if (step.kind === 'drop') {
      const unwanted = new Set(step.categories);
      kept = kept.filter((finding) => !unwanted.has(String(finding?.['category'] ?? '')));
    } else if (step.kind === 'keep-category') {
      const wanted = new Set(step.categories);
      kept = kept.filter((finding) => wanted.has(String(finding?.['category'] ?? '')));
    } else if (step.kind === 'gate') {
      kept = kept.filter((finding) => finding?.['actionable'] === true);
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
      if (step.kind === 'gate') return 'actionability gate';
      if (step.kind === 'budget') return `budget ${step.k}`;
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
    if (kind === 'budget') {
      const k = Number(argument);
      if (!Number.isInteger(k) || k < 1) throw new Error(`"${token}" is not a budget`);
      return { kind: 'budget', k };
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
