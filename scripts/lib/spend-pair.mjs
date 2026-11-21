// @code-analyzer — A bill with the vendor's cache priced out of it
//
// **A cost comparison between two arms of one dispatch is not a comparison of two amounts of work.** The vendor's prefix
// cache is state that outlives a process, so the arm that runs second is billed less for the same tokens: on
// 2026-11-21 the same job ran `lean` and `shipped`, and **the arm with one fewer lane out of five was the more
// expensive of the two in USD** - 1.3692 against 1.2391 - because the five-lane arm hit the cache on 82.9 % of its
// prompt tokens and the four-lane arm on 51.0 %. At the vendor's own prices the hit class is one fiftieth of the miss
// class, so **5.3 million more cached tokens remove a tenth of a bill without one call being removed.**
//
// **The clause this file exists to make readable was written in `totalUsd` and was therefore unreadable**: it asked
// whether the cheaper arm came to at most 85 % of the other, and the number it was read on answered *"which arm ran
// second"*. That is the third time in this line of work that a clause was written in a unit the apparatus could not
// isolate, after a ±0.005 tolerance the corpus could not resolve and a ceiling measured in the wrong count.
//
// **So the second figure is computed from the artifact's own tokens**, with every prompt token charged as a miss, and
// **the multiplier is read back from the arm's own bill rather than assumed**. That last part matters: a run at the
// vendor's peak is billed twice what the same run costs off-peak, and a tool that hardcoded either rate would price
// every historical artifact wrong by a factor of two while looking entirely plausible. Reading the factor back means
// an artifact measured at an unknown hour is priced at the hour it was measured, and the factor itself is printed so a
// reader can check it against the vendor's stated `1` and `0.5`.

/** What one model charges, per million tokens, in USD. */
const PRICE_KEYS = ['cacheHit', 'cacheMiss', 'output'];

/**
 * **The arm's own multiplier, recovered from its own bill.**
 *
 * `billed = factor * (hit*hitPrice + miss*missPrice + completion*outputPrice) / 1e6`, so `factor` falls out of the four
 * numbers the artifact already carries. A run that bought a model the price table does not know has no billed figure,
 * and this returns `null` rather than `1` for it - **a factor invented for an unpriced bill would turn a lower bound
 * into a confident number.**
 */
export function factorOf(group, prices) {
  const billed = billedOf(group);
  if (billed === null) return null;
  const atList = listUsdOf(group, prices);
  if (!(atList > 0)) return null;
  return billed / atList;
}

/**
 * **What the group's tokens would have cost at the table's prices, with the cache charged at the hit rate.**
 *
 * **The miss total is derived when the artifact did not send one**, by the same rule the pricer uses: a usage without a
 * split is billed as if every prompt token missed. Without that, an artifact from before the split was recorded would
 * price at zero, its multiplier would come out `null`, and **an arm would be reported as unpriceable for a reason that
 * is a missing field rather than a missing capability.**
 */
export function listUsdOf(group, prices) {
  const { hit, miss } = splitOf(group);
  const completion = tokenOf(group, 'completionTokens');
  return (hit * prices.cacheHit + miss * prices.cacheMiss + completion * prices.output) / 1_000_000;
}

/** The prompt split, with whichever half the artifact omitted derived from the total it did send. */
function splitOf(group) {
  const hit = tokenOf(group, 'cacheHitTokens');
  const miss = tokenOf(group, 'cacheMissTokens');
  // The larger of the two totals is the one that cannot understate the prompt, and understating a prompt is the
  // direction that flatters a cost claim.
  const prompt = Math.max(tokenOf(group, 'promptTokens'), hit + miss);
  return { hit, miss: Math.max(miss, prompt - hit) };
}

/**
 * **The billed figure under either spelling.** The ledger's own block calls it `costUsd`; a caller holding the normalised
 * group calls it `usd`. Reading only one of them made the first version of this module price nothing at all, silently and
 * with a `null` that read like "this bill cannot be priced" rather than "this tool cannot find the number".
 */
function billedOf(group) {
  return numberOrNull(group?.costUsd) ?? numberOrNull(group?.usd);
}

function tokenOf(group, field) {
  const value = group?.[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * **What the group would have been billed with nothing warm.** Every prompt token at the miss price, the completion
 * tokens unchanged, and the arm's own multiplier applied - so a peak run and an off-peak run with identical tokens come
 * out at different dollars, which is correct, and two arms of one dispatch come out comparable, which is the point.
 *
 * The prompt total is the vendor's `promptTokens` when it reported one and the two halves when it did not; **a group
 * whose halves sum to more than its total is reported as the sum**, because understating the prompt is the direction
 * that flatters a cost claim.
 */
export function coldUsdOf(group, prices) {
  const factor = factorOf(group, prices);
  if (factor === null) return null;
  const { hit, miss } = splitOf(group);
  const completion = tokenOf(group, 'completionTokens');
  return (((hit + miss) * prices.cacheMiss + completion * prices.output) / 1_000_000) * factor;
}

/**
 * **One arm's three bills.** `engine` is the reviewer, `judge` is the scoring client the benchmark counts separately,
 * and `total` is the two added - the split the artifact already publishes for `usd`, carried to the cold-cache figure so
 * that **the half nobody reorders is visible in both units.**
 */
export function readArm(artifact, prices) {
  const spend = artifact?.spend;
  if (!spend || typeof spend !== 'object') {
    throw new Error(
      'an artifact with no spend block cannot be compared on cost: the balance delta is a fact about the account, ' +
        'and pricing one arm from it would compare two runs through a third number',
    );
  }
  const judge = spend.judge ?? null;
  // **The reviewer's block is normalised through the same reader as the judge's**, because it carries the fields under
  // the ledger's own names (`costUsd`, `cacheNeutralUsd`) and a second spelling of the same four numbers is how one of
  // them ends up priced and the other left blank.
  const engine = groupOf(spend, prices);
  const scored = judge ? groupOf(judge, prices) : null;
  const total = {
    calls: engine.calls + (scored?.calls ?? 0),
    promptTokens: engine.promptTokens + (scored?.promptTokens ?? 0),
    cacheHitTokens: engine.cacheHitTokens + (scored?.cacheHitTokens ?? 0),
    cacheMissTokens: engine.cacheMissTokens + (scored?.cacheMissTokens ?? 0),
    completionTokens: engine.completionTokens + (scored?.completionTokens ?? 0),
    usd: sumOrNull(engine.usd, scored?.usd ?? null),
    coldUsd: sumOrNull(engine.coldUsd, scored?.coldUsd ?? null),
    // **No multiplier on the total**: the two halves are priced at their own clocks and the arms were measured in one
    // dispatch, so a ratio of two sums is a number that would look like a rate and is an average of one. The column is
    // read on the two halves, where each figure came from one bill.
    factor: null,
  };
  return {
    label: labelOf(artifact),
    engine: withRatios(engine),
    judge: scored ? withRatios(scored) : null,
    total: withRatios(total),
  };
}

function groupOf(group, prices) {
  const normal = {
    calls: tokenOf(group, 'calls'),
    promptTokens: tokenOf(group, 'promptTokens'),
    cacheHitTokens: tokenOf(group, 'cacheHitTokens'),
    cacheMissTokens: tokenOf(group, 'cacheMissTokens'),
    completionTokens: tokenOf(group, 'completionTokens'),
    // **Either spelling**, because the reviewer's block says `costUsd` and a caller reading its own object says `usd`,
    // and the first version of this function read only the second and priced nothing at all.
    usd: billedOf(group),
  };
  return {
    ...normal,
    // **The multiplier this arm was billed at, read back from its own bill** rather than assumed: a peak run and an
    // off-peak run of the same tokens differ by a factor of two, and a tool that hardcoded either rate would price
    // every artifact measured at the other hour wrong while looking entirely plausible.
    factor: factorOf(normal, prices),
    coldUsd: numberOrNull(group.cacheNeutralUsd) ?? coldUsdOf(normal, prices),
  };
}

function withRatios(group) {
  const denominator = group.cacheHitTokens + group.cacheMissTokens;
  return {
    ...group,
    // **`null` rather than `0` when no split was reported**: a zero ratio is a statement that nothing was cached, and an
    // artifact that never received the field has not made that statement.
    hitRatio: denominator > 0 ? group.cacheHitTokens / denominator : null,
  };
}

/** A short name for the arm, from the configuration it varied or the lane set it ran. */
export function labelOf(artifact) {
  const lanes = artifact?.configuration?.laneSet;
  // **The named set before the list**, because `shipped` and `security+architecture+performance+maintainability+testing`
  // are the same arm and only one of them fits in a column.
  if (lanes !== null && typeof lanes === 'object' && typeof lanes.name === 'string')
    return lanes.name;
  if (Array.isArray(lanes)) return lanes.join('+');
  const name = artifact?.configuration?.emissionProfile;
  return typeof name === 'string' ? name : 'arm';
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumOrNull(left, right) {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

/**
 * **The two arms side by side, with the ratio in every unit, because the units disagree and that disagreement is the
 * finding.** `usdRatio` is what the clause was written in; `coldUsdRatio` and `promptTokenRatio` are the units a second
 * run cannot move by having run after the first. When `usdRatio` and `coldUsdRatio` fall on opposite sides of a bar, the
 * bar was not measured - and the return value says so rather than picking one.
 */
export function compareSpend(a, b, prices) {
  const rows = [];
  for (const name of ['engine', 'judge', 'total']) {
    const one = a[name];
    const two = b[name];
    if (!one || !two) continue;
    rows.push({
      part: name,
      a: one,
      b: two,
      usdRatio: ratioOf(two.usd, one.usd),
      coldUsdRatio: ratioOf(two.coldUsd, one.coldUsd),
      promptTokenRatio: ratioOf(two.promptTokens, one.promptTokens),
      callRatio: ratioOf(two.calls, one.calls),
    });
  }
  const total = rows.find((row) => row.part === 'total') ?? null;
  return {
    a: a.label,
    b: b.label,
    prices,
    rows,
    // **Whether the two units agree about the direction**, which is the one thing a reader of a cost clause needs first.
    // *Level* is a direction here: **an arm that costs the same on a cold cache and a tenth less as billed has not been
    // shown to be cheaper** - it has been shown to have run second - and the two units disagreeing about whether there
    // is a difference at all is exactly the case this file exists to make visible.
    unitsAgree:
      total === null
        ? null
        : agreeOrNull(directionOf(total.usdRatio), directionOf(total.coldUsdRatio)),
  };
}

/**
 * **A direction with a tolerance, because a ratio of two equal quantities is not exactly one.** Recomputing the same
 * tokens from two blocks arrives at `0.9999999999999998`, and a comparison without an epsilon would read that as *"the
 * second arm is cheaper"* - a statement about floating point arithmetic that would be published as a statement about an
 * arm.
 */
function directionOf(ratio) {
  if (ratio === null) return null;
  if (Math.abs(ratio - 1) < 1e-9) return 'level';
  return ratio > 1 ? 'up' : 'down';
}

function agreeOrNull(a, b) {
  if (a === null || b === null) return null;
  return a === b;
}

function ratioOf(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}
