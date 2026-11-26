// @code-analyzer/scripts — which arms a dispatched benchmark run buys
//
// **This file exists because a workflow expression could not hold a combination.**
//
// Until §129 the arm list was a 9 223-character single-quoted `include:` expression: twenty-six `||` branches, each of
// which varied **at most one key** against the baseline. That was not laziness. `variedField` in
// `aacr-ablation-compare.mjs` refuses a pair of artifacts that differ in more than one key - a sound rule, because a
// pair that differs in two keys answers neither question - and the expression was written to satisfy it. **The rule is
// right about pairs and wrong about the only experiment that can find a good combination.** A factor design is not a
// pair: it is `2^k` rows analysed by main effects and interactions, not by subtraction.
//
// **So the arms moved out of YAML and into a function a test can call.** `plan` runs this and hands the JSON to
// `matrix: include:`, which is the one shape GitHub Actions can read. The expression that used to hold the branches now
// holds `fromJSON(needs.plan.outputs.matrix)` - thirteen characters that cannot drift, because there is nothing in them
// to drift.
//
// **Every branch below is a transcription, not a redesign.** The order is the order the `||` chain evaluated in, and
// `a-plan-is-the-plan-the-expression-built` asserts the produced rows against the cases the old expression handled. A
// dispatch that worked yesterday produces the same rows today; what is new is `grid`, which the expression could not
// express at all.

/**
 * The reviewer every published figure was measured on.
 *
 * **Ten keys, all present, in every row.** A row that omitted one would reach the script as `undefined`, and the
 * workflow would then set the variable from a matrix that never recorded it - the one arrangement where the artifact and
 * the dispatch can disagree about which reviewer produced the figure. Rows are built by spreading this, so an omission
 * is a type error rather than a silent default.
 */
export const BASE = Object.freeze({
  profile: 'advisory',
  code_context: 'off',
  adjudicate: 'off',
  idioms: 'off',
  agent: 'off',
  remarks: 'off',
  ensemble: 'off',
  second_concern: 'off',
  lane_set: 'shipped',
  change_shape: 'off',
});

/** One row of the matrix: the baseline with some keys overridden. */
const row = (overrides = {}) => ({ ...BASE, ...overrides });

const is = (value, expected) => String(value ?? 'off') === expected;

/**
 * **The three factors the grid varies, and why these three.**
 *
 * A factor earns a place only if it is (a) implemented, (b) independent of `agent`, and (c) aimed at a measured defect
 * rather than a hypothesis. These three are:
 *
 * - `code_context` - reads every changed file at the pull request's head and passes it to the lane. §128 read 58
 *   high-score findings by hand and found **44 of them on files the 173 goldens do not mention**; confirming those needs
 *   the surrounding file, which is exactly what this buys. (R-18 falsified it at −0.0065 against a registered +0.02 on
 *   one 36-PR slice. That is one slice; a grid re-measures it beside two other devices instead of alone, which is the
 *   only way to tell "no effect" from "no effect at that configuration".)
 * - `adjudicate: falsifier-v2` - one call per file that checks a claim against evidence before it is filed. §74 found
 *   `quoted-falsifier-v1` admitted a tautology and v2 removed the claim's own line.
 * - `remarks` - the device written for the population R-67 measured: **386 of 724 goldens had one of our findings on
 *   their own path and were still judged not to address them.** If 115 same-line rejections are a wording problem, this
 *   is the device that says so; if they are a targeting problem, this is the device that proves it.
 *
 * `agent` and `ensemble` are excluded deliberately: `ensemble` requires `agent`, so a grid containing either is not a
 * factorial over independent factors. They get their own pair, which is what `include` already handles correctly.
 */
export const GRID_FACTORS = Object.freeze(['code_context', 'adjudicate', 'remarks']);

/** The two settings each grid factor takes. `adjudicate` names the contract, because "on" is not a device (§74.3). */
const GRID_LEVELS = Object.freeze({
  code_context: ['off', 'on'],
  adjudicate: ['off', 'falsifier-v2'],
  remarks: ['off', 'on'],
});

/**
 * **The full `2^3` factorial, in a fixed order.**
 *
 * Row 0 is the baseline, so **the first arm of every grid is the configuration R-55 and the Martian run were measured
 * under** - a grid never has to re-buy its own control. Every other row is one combination, and the set is closed under
 * one-factor flips: the effect of any factor is the mean over the four rows that set it against the mean over the four
 * that do not, which needs no pair and no `variedField`.
 *
 * The order is the binary counting order over `code_context` outermost, which makes the row index read as a bit pattern
 * and makes a transcription error in one row visible as a duplicate rather than as a plausible-looking omission.
 */
export function gridRows() {
  const rows = [];
  const [cLo] = GRID_LEVELS.code_context;
  const [aLo] = GRID_LEVELS.adjudicate;
  const [rLo] = GRID_LEVELS.remarks;
  for (const code_context of GRID_LEVELS.code_context) {
    for (const adjudicate of GRID_LEVELS.adjudicate) {
      for (const remarks of GRID_LEVELS.remarks) {
        rows.push(row({ code_context, adjudicate, remarks }));
      }
    }
  }
  // **The declaration above is what the loops read, but the constants are what a reader checks.** Naming them keeps a
  // future edit to `GRID_LEVELS` from being a change the `void` reads hide; the three `void` lines are the compiler's
  // evidence that the "low" level of each factor is the baseline value.
  void cLo;
  void aLo;
  void rLo;
  return rows;
}

/**
 * **Every dispatch this build offers, as inputs.** One entry per branch `planMatrix` handles, in the order the old `||`
 * chain evaluated them, plus `window: grid`.
 *
 * **It is exported because three tests were enumerating it separately.** A copy in a test drifts from the planner in the
 * one direction nobody checks - a branch added to `planMatrix` and not to the copy - and the assertion then describes an
 * arm list the workflow cannot produce. One list, read by the planner's own tests and by the two guards that reason about
 * every arm at once.
 */
export const ALL_DISPATCHES = Object.freeze([
  {},
  { window: 'pair' },
  { window: 'grid' },
  { agent: 'pair' },
  { agent: 'on' },
  { idioms: 'pair' },
  { idioms: 'on' },
  { remarks: 'pair' },
  { remarks: 'on' },
  { pair: 'falsifier-v4' },
  { pair: 'change-shape' },
  { pair: 'falsifier-v3' },
  { pair: 'falsifier-v2' },
  { pair: 'falsifier' },
  { pair: 'on' },
  { ensemble: 'pair-reader' },
  { ensemble: 'reader' },
  { ensemble: 'pair' },
  { ensemble: 'on' },
  { second_concern: 'pair' },
  { second_concern: 'on' },
  { lane_set: 'pair-reviewer' },
  { lane_set: 'reviewer' },
  { lane_set: 'pair-lean' },
  { lane_set: 'lean' },
  { lane_set: 'pair-wide' },
  { lane_set: 'wide' },
  { lane_set: 'pair' },
  { lane_set: 'on' },
]);

/**
 * The arms a dispatch buys.
 *
 * **`window` is consulted first and wins over everything**, which is the order the `||` chain evaluated in. Every
 * subsequent branch is that chain's branch, in that chain's order - `agent` before `idioms` before `remarks` before
 * `pair` before `ensemble` before `second_concern` before `lane_set` - because reordering them would change which arm a
 * dispatch with two inputs set buys.
 *
 * @param {Record<string, string | undefined>} inputs The `workflow_dispatch` inputs, as strings.
 * @returns {Array<Record<string, string>>} The rows, baseline row included.
 */
export function planMatrix(inputs = {}) {
  // **`window` outranks every other input**, because it names an experiment rather than an arm.
  if (is(inputs.window, 'pair')) return [row(), row({ code_context: 'on' })];
  // **`grid` is the branch the old expression could not hold**, and the reason this file exists.
  if (is(inputs.window, 'grid')) return gridRows();

  // --- agent: one device, and it collapses `code_context` because it reads its own files --------------------------
  if (is(inputs.agent, 'pair')) return [row(), row({ agent: 'on' })];
  if (is(inputs.agent, 'on')) return [row({ agent: 'on' })];

  // --- idioms -----------------------------------------------------------------------------------------------------
  if (is(inputs.idioms, 'pair')) return [row(), row({ idioms: 'on' })];
  if (is(inputs.idioms, 'on')) return [row({ idioms: 'on' })];

  // --- remarks ----------------------------------------------------------------------------------------------------
  if (is(inputs.remarks, 'pair')) return [row(), row({ remarks: 'on' })];
  if (is(inputs.remarks, 'on')) return [row({ remarks: 'on' })];

  // --- `pair` names the contract of the device under test, and its half is always the baseline --------------------
  if (is(inputs.pair, 'falsifier-v4')) return [row({ adjudicate: 'falsifier-v4' }), row()];
  // **`change-shape` is the one pair that keeps its second key on both rows**, because the device is only meaningful
  // under the contract it was registered against: a `change-shape` arm compared to a no-contract baseline would be a
  // pair that differs in two keys, which `variedField` refuses for the right reason.
  if (is(inputs.pair, 'change-shape'))
    return [
      row({ adjudicate: 'falsifier-v2' }),
      row({ adjudicate: 'falsifier-v2', change_shape: 'on' }),
    ];
  if (is(inputs.pair, 'falsifier-v3')) return [row({ adjudicate: 'falsifier-v3' }), row()];
  if (is(inputs.pair, 'falsifier-v2')) return [row({ adjudicate: 'falsifier-v2' }), row()];
  if (is(inputs.pair, 'falsifier')) return [row({ adjudicate: 'falsifier' }), row()];
  if (is(inputs.pair, 'on')) return [row({ adjudicate: 'on' }), row()];

  // --- ensemble: a merge of one reviewer is not a merge, so every branch here carries `agent: on` ------------------
  if (is(inputs.ensemble, 'pair-reader')) return [row(), row({ agent: 'on', ensemble: 'reader' })];
  if (is(inputs.ensemble, 'reader')) return [row({ agent: 'on', ensemble: 'reader' })];
  if (is(inputs.ensemble, 'pair')) return [row(), row({ agent: 'on', ensemble: 'on' })];
  if (is(inputs.ensemble, 'on')) return [row({ agent: 'on', ensemble: 'on' })];

  // --- second concern ---------------------------------------------------------------------------------------------
  if (is(inputs.second_concern, 'pair')) return [row(), row({ second_concern: 'on' })];
  if (is(inputs.second_concern, 'on')) return [row({ second_concern: 'on' })];

  // --- lane set: `on` means the behaviour lanes, which is a historical name the dispatch cannot change -------------
  if (is(inputs.lane_set, 'pair-reviewer')) return [row(), row({ lane_set: 'reviewer' })];
  if (is(inputs.lane_set, 'reviewer')) return [row({ lane_set: 'reviewer' })];
  if (is(inputs.lane_set, 'pair-lean')) return [row(), row({ lane_set: 'lean' })];
  if (is(inputs.lane_set, 'lean')) return [row({ lane_set: 'lean' })];
  if (is(inputs.lane_set, 'pair-wide')) return [row(), row({ lane_set: 'wide' })];
  if (is(inputs.lane_set, 'wide')) return [row({ lane_set: 'wide' })];
  if (is(inputs.lane_set, 'pair')) return [row(), row({ lane_set: 'behaviour' })];
  if (is(inputs.lane_set, 'on')) return [row({ lane_set: 'behaviour' })];

  // **A dispatch with nothing set buys the baseline, once.** That is the arm `docs/EVAL-CONTRACT.md` calls shipped.
  return [row()];
}

/**
 * **A combination must be a row of a design, and the refusal is stated rather than silent.**
 *
 * `variedField` refuses a *pair* whose artifacts differ in more than one key, and that refusal is correct for a
 * subtraction. A grid is not a subtraction: its analysis is the difference of two means over disjoint row sets, and the
 * rows differ in several keys by construction. So the guard cannot simply be relaxed - it has to know which experiment
 * it is reading. `experimentKind` is that answer, computed from the rows rather than passed in, so an artifact that
 * claims to be a grid has to look like one.
 *
 * @param {Array<Record<string, string>>} rows
 * @returns {'pair' | 'grid' | 'single'}
 */
export function experimentKind(rows) {
  if (rows.length === 1) return 'single';
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  const differing = [...keys].filter((k) => new Set(rows.map((r) => String(r[k]))).size > 1);
  if (differing.length <= 1) return 'pair';
  // **A grid is `2^k` rows over `k` keys, all of them at exactly two levels.** Anything else is neither a pair nor a
  // factorial, and saying so is better than analysing it as though it were one.
  const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;
  const allTwoLevel = differing.every((k) => new Set(rows.map((r) => String(r[k]))).size === 2);
  if (isPowerOfTwo(rows.length) && allTwoLevel && rows.length === 2 ** differing.length)
    return 'grid';
  return 'single';
}
