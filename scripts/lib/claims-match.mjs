// @code-analyzer — the rejected pairs a run already paid for, and the control that says whether a second reading is evidence

/**
 * **A judge asked for one boolean is a judge that answers conservatively, and the artifact cannot tell you which way.**
 *
 * The lanes run of 2026-11-16 rejected **434 goldens that sat in a file it had commented on**, 263 of them on the exact
 * line. Reading eight of the 263 by hand splits them three ways:
 *
 * | what the pair is | example | who can repair it |
 * | --- | --- | --- |
 * | the same defect, said differently | *"direct deletion of `this` bypasses normal destruction"* against *"deletes itself while `operations_` still holds live observers"* | **the matcher** |
 * | a different defect at the same line | a use-after-free against an O(n²) erase in the same loop | §59's second concern |
 * | a nit this reviewer does not write | *"update the doc comment to say ULID"* | nobody, and it should stay lost |
 *
 * **The three want three different devices and the artifact reports one number**, so the split is worth measuring. The
 * cheap way to measure it is to re-read the pairs - they are already in the artifact, the goldens are already fetched,
 * and a re-read costs judge calls rather than a dispatch.
 *
 * **And the reason this is a library rather than a paragraph is the same reason `sameConstructLines` is:** a second
 * reading that is not controlled is a looser matcher wearing the word "semantic", and **the looser matcher is the one
 * direction that cannot be allowed** - it raises recall by definition and precision only on paper.
 */
export const PAIR_KINDS = Object.freeze(['same-defect', 'different-defect', 'not-a-defect']);

/** **The pairs a re-read can be run on**: on the file, on the line, and rejected. */
export function sameLineRejects(artifact) {
  const records = artifact?.missedGoldens?.records;
  if (!Array.isArray(records)) return [];
  const pairs = [];
  for (const record of records) {
    if (record?.bucket !== 'findingOnPathRejected') continue;
    if (record?.proximity !== 0) continue;
    const note = String(record.note ?? '').trim();
    const comment = String(record?.nearestFinding?.text ?? '').trim();
    // **A pair without both sentences is not a pair**, and a golden with an empty note would let any comment match it.
    if (note === '' || comment === '') continue;
    pairs.push({
      id: `${String(record.pr)}#${String(record.goldenIndex)}`,
      pr: String(record.pr ?? ''),
      path: String(record.path ?? ''),
      goldenIndex: Number(record.goldenIndex ?? -1),
      startLine: Number(record?.nearestFinding?.startLine ?? -1),
      endLine: Number(record?.nearestFinding?.endLine ?? -1),
      note,
      comment,
    });
  }
  return pairs;
}

/**
 * **The harder negative: the golden comes from the same pull request.**
 *
 * The crossed control is easy and its zero is not evidence on its own. A reader given a comment about a Dart file and a
 * golden about a C++ file can reject the pair without reading either - **and a control that can be passed without
 * reading the thing under test measures nothing.** Two harder controls are available inside every pull request:
 *
 * - **`sameFile`**: a different golden from the *same file of the same pull request*. This is the pair §58.4 found 276
 *   of, and it is the hardest negative that exists in the artifact - the vocabulary, the module and the change are all
 *   shared, and only the defect differs.
 * - **`samePull`**: a golden from another file of the same pull request. A reader that keys on the feature's vocabulary
 *   rather than on the defect accepts these.
 *
 * **The rate that matters is the highest of the three**, because the three differ in difficulty and the easiest one that
 * still accepts something is the floor under the real rate. A real rate of 18 % against a `sameFile` rate of 15 % is
 * three points of evidence, not eighteen.
 */
export function samePullRequestControl(artifact, pairs, { samePath = true } = {}) {
  const records = artifact?.missedGoldens?.records;
  if (!Array.isArray(records) || !Array.isArray(pairs)) return [];
  const byPull = new Map();
  for (const record of records) {
    const note = String(record?.note ?? '').trim();
    if (note === '') continue;
    const key = String(record?.pr ?? '');
    if (!byPull.has(key)) byPull.set(key, []);
    byPull.get(key).push(record);
  }
  const controls = [];
  for (const pair of pairs) {
    const candidates = (byPull.get(pair.pr) ?? []).filter((record) => {
      if (Number(record.goldenIndex) === pair.goldenIndex) return false;
      return samePath
        ? String(record.path ?? '') === pair.path && String(record.path ?? '') !== ''
        : String(record.path ?? '') !== pair.path;
    });
    if (candidates.length === 0) continue;
    // **The nearest one by line, because a distance is the difficulty being tested.** A golden two hundred lines away is
    // a weaker negative than one twenty lines away, and a control that takes whichever came first would vary with the
    // corpus's ordering rather than with the question.
    const nearest = candidates.reduce((best, record) => {
      const distance = Math.abs(Number(record?.nearestFinding?.startLine ?? 0) - pair.startLine);
      return best === null || distance < best.distance ? { record, distance } : best;
    }, null);
    const record = nearest.record;
    controls.push({
      ...pair,
      note: String(record.note ?? '').trim(),
      donorId: `${pair.pr}#${String(record.goldenIndex)}`,
      donorPath: String(record.path ?? ''),
    });
  }
  return controls;
}

/**
 * **The same pairs with the golden taken from a different pull request.**
 *
 * A controlled re-read needs a set of pairs that are **definitely not the same concern**, and the artifact already holds
 * one: any two of its sentences from different pull requests. The donor is chosen by a fixed stride rather than at
 * random, because **a control that changes between two runs of the same artifact is a control whose rate cannot be
 * compared** - and the stride is coprime with small counts so that a donor is never its own pair.
 *
 * **What the control rate means.** If a matcher accepts 40 % of the real pairs and 35 % of the crossed ones, its evidence
 * is five points, and a re-read that reported "40 % recovered" would be reporting the model's willingness to agree.
 */
export function crossPairControl(pairs, { stride = 7 } = {}) {
  const n = Array.isArray(pairs) ? pairs.length : 0;
  if (n < 2) return [];
  const controls = [];
  for (let i = 0; i < n; i += 1) {
    let donor = -1;
    for (let step = 1; step < n; step += 1) {
      const candidate = (i + step * stride) % n;
      if (pairs[candidate].pr !== pairs[i].pr) {
        donor = candidate;
        break;
      }
    }
    if (donor === -1) continue;
    controls.push({ ...pairs[i], note: pairs[donor].note, donorId: pairs[donor].id });
  }
  return controls;
}

/**
 * **The re-read's question, which is not the judge's question.**
 *
 * The run's judge is asked for `{"match": true|false}` and answers in four tokens. This one is asked **to say what the
 * two statements share before it decides**, in the vocabulary of the code, and to reject in three named cases: the two
 * are about different things, one is about wording rather than about what the code does, or the shared sentence would be
 * equally true of any two comments on the same function. **Naming the rejection cases is what keeps "semantic" from
 * meaning "adjacent"**, and asking for the shared claim first is what gives a paraphrase somewhere to land.
 */
export function claimsPrompt({ note, comment }) {
  return [
    'Two statements were made about the same lines of a pull request.',
    'Decide whether they are about the SAME concern.',
    '',
    'Answer with one JSON object: {"shared": "<one sentence, naming the symbol or mechanism both are about>", "verdict": "same"|"different"|"wording"}.',
    '',
    'Answer "different" when the two are about different defects or different risks, however close their lines.',
    'Answer "wording" when the concern is how something is written - a comment, a name, an ordering for readability - rather than what the code does.',
    'Answer "same" only when the sentence you wrote would be a fair summary of BOTH statements.',
    'A sentence that would be equally true of any two comments on this function is not a shared concern.',
    '',
    `First statement:\n${note}`,
    '',
    `Second statement:\n${comment}`,
  ].join('\n');
}

/**
 * **What the re-read found, with the control subtracted.**
 *
 * `rows` is one entry per pair: `{ id, real, control }`, where each reading is `'same'`, `'different'`, `'wording'` or
 * `null` for a call that did not answer. **A null is not a rejection** - the same distinction the judge loop makes,
 * one instrument further out.
 *
 * **`beyondControl` is the only number that licenses a re-scoring**: the share of real pairs accepted minus the share of
 * crossed pairs the same reader accepted, times the number of pairs. A reader that accepts everything has a lift of
 * zero and an evidence count of zero, however many pairs it "recovered".
 */
export function summariseRejudge(rows) {
  const answered = (value) => value === 'same' || value === 'different' || value === 'wording';
  const list = Array.isArray(rows) ? rows : [];
  const rate = (field) => {
    const seen = list.filter((row) => answered(row?.[field]));
    const same = seen.filter((row) => row[field] === 'same').length;
    return { answered: seen.length, same, share: seen.length === 0 ? 0 : same / seen.length };
  };
  const real = rate('real');
  const crossed = rate('crossed');
  const sameFile = rate('sameFile');
  const samePull = rate('samePull');
  const controls = [crossed, sameFile, samePull].filter((control) => control.answered > 0);
  /**
   * **The floor, taken as the highest control that answered**, because the controls differ in difficulty and the one that
   * accepts the most is the one a real acceptance has to be distinguished from. An artifact where only the crossed
   * control could be built is measured against the crossed control and **says so**, rather than against a zero it never
   * measured.
   */
  const ceiling = controls.reduce(
    (worst, control) => (worst === null || control.share > worst.share ? control : worst),
    null,
  );
  const ceilingShare = ceiling === null ? 0 : ceiling.share;
  return {
    pairs: list.length,
    answered: real.answered,
    unanswered: list.length - real.answered,
    same: real.same,
    different: list.filter((row) => row?.real === 'different').length,
    wording: list.filter((row) => row?.real === 'wording').length,
    realShare: round(real.share),
    crossed: { answered: crossed.answered, same: crossed.same, share: round(crossed.share) },
    sameFile: { answered: sameFile.answered, same: sameFile.same, share: round(sameFile.share) },
    samePull: { answered: samePull.answered, same: samePull.same, share: round(samePull.share) },
    /**
     * **Which control the floor came from**, because "against a control" without naming it is the sentence that lets a
     * reader assume the hard one.
     */
    floorFrom:
      ceiling === null
        ? 'none'
        : ceiling === sameFile
          ? 'sameFile'
          : ceiling === samePull
            ? 'samePull'
            : 'crossed',
    floorShare: round(ceilingShare),
    /**
     * **The evidence, in pairs.** The real acceptance share minus the highest control share, times the answered pairs -
     * the part of the recovery the same reader would not have produced from a pairing that shares everything but the
     * defect.
     */
    lift: round(real.share - ceilingShare),
    beyondControl: Math.max(0, Math.round((real.same - ceilingShare * real.answered) * 100) / 100),
  };
}

function round(value) {
  return Math.round(Number(value) * 10_000) / 10_000;
}

/**
 * **Two readings of one corpus, compared pair by pair, because a floor is only a property of the pairs if a second
 * reader reproduces it.**
 *
 * The two readings are the *same* pairs read by two judges, so subtracting one share from the other throws away the only
 * thing that makes the comparison cheap: **the pairs are paired, and the error bar belongs to the pairs where the judges
 * disagreed rather than to the size of the corpus.** `mcnemarP` is the exact two-sided binomial on those discordant
 * cells, which is the test a paired proportion comparison is; with `n` discordant pairs and `k` of them going one way,
 * `p = 2 * sum_{i<=k} C(n,i) / 2^n`, capped at 1 - **capped because the sum is a doubling of a one-sided tail and a
 * disagreement smaller than a coin flip is not evidence of anything.**
 *
 * **`withinBar` is pre-registered, not chosen after the fact**: the floor is a property of the pairs if the second
 * reading stays inside `bar` of the first *and* the discordant pairs do not separate at `alpha`. Both, because a large
 * sample can make a difference of two pairs significant and a small one cannot make a difference of ten insignificant.
 */
export function compareReadings(
  rowsA,
  rowsB,
  { field = 'sameFile', bar = 0.05, alpha = 0.05 } = {},
) {
  const answered = (value) => value === 'same' || value === 'different' || value === 'wording';
  const index = (rows) => {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) if (row?.id) map.set(row.id, row[field]);
    return map;
  };
  const mapA = index(rowsA);
  const mapB = index(rowsB);
  // **The union of the two readings**, because a pair only one of them has is a fact about the reading rather than about
  // the judge - and a pair both of them have with an unanswered field is the third case, which is neither.
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);

  let paired = 0;
  let aOnly = 0;
  let bOnly = 0;
  let bothSame = 0;
  let aSame = 0;
  let bSame = 0;
  let unanswered = 0;
  let unpaired = 0;
  for (const id of ids) {
    const a = mapA.get(id);
    const b = mapB.get(id);
    if (a === undefined || b === undefined) {
      unpaired += 1;
      continue;
    }
    if (!answered(a) || !answered(b)) {
      unanswered += 1;
      continue;
    }
    paired += 1;
    const aIsSame = a === 'same';
    const bIsSame = b === 'same';
    if (aIsSame) aSame += 1;
    if (bIsSame) bSame += 1;
    if (aIsSame && bIsSame) bothSame += 1;
    else if (aIsSame) aOnly += 1;
    else if (bIsSame) bOnly += 1;
  }

  const shareA = paired === 0 ? 0 : aSame / paired;
  const shareB = paired === 0 ? 0 : bSame / paired;
  const difference = shareB - shareA;
  const discordant = aOnly + bOnly;
  const mcnemarP = exactBinomial(discordant, Math.min(aOnly, bOnly));

  return {
    field,
    paired,
    unpaired,
    unanswered,
    bothSame,
    aOnly,
    bOnly,
    discordant,
    shareA: round(shareA),
    shareB: round(shareB),
    difference: round(difference),
    mcnemarP,
    withinBar: Math.abs(difference) <= bar,
    /** **Both halves of the pre-registered bar**, because either one alone can be satisfied by a corpus the other refuses. */
    pairsRule: Math.abs(difference) <= bar && mcnemarP > alpha,
    /** The pre-registered bar, so a report quotes the rule it was judged by rather than the rule it met. */
    bar,
    alpha,
  };
}

/** The exact two-sided binomial tail `2 * P(X <= k | n, 1/2)`, capped at 1, in integers so 263 pairs are exact. */
function exactBinomial(n, k) {
  if (n === 0) return 1;
  let sum = 0n;
  let term = 1n;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) term = (term * BigInt(n - i + 1)) / BigInt(i);
    sum += term;
  }
  const denominator = 2n ** BigInt(n);
  return Math.min(1, (2 * Number(sum)) / Number(denominator));
}

/**
 * **How many unanswered calls a reading may carry before it is a reading of something else.**
 *
 * The second judge answered 34 of 263 pairs, and the report printed four rates and a recovery of 1.08 pairs computed
 * over the 13 % that answered. **A rate over a subsample whose composition nobody chose is not a rate about the
 * corpus** - the calls that failed are the calls that took longest, which in a reasoning model are the pairs the model
 * found hardest, so the subsample is biased in the worst direction. One in five is the line: a rate limit loses a
 * handful, a configuration that cannot answer loses most of them.
 */
export const UNANSWERED_LIMIT = 0.2;

/** **Whether a reading may be quoted at all**, so a failed reading is a loud refusal rather than a table of rates. */
export function readingIsUsable({ pairs, unanswered } = {}) {
  const total = Number(pairs);
  const missing = Number(unanswered);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(missing) || missing < 0) return false;
  return missing / total <= UNANSWERED_LIMIT;
}

/** **The ceiling an escalated answer budget stops at**, because "give it room" must not become "give it anything". */
export const TOKEN_CEILING = 4000;

/**
 * **The answer budget after a truncated call: eight times the last one, capped.**
 *
 * `max_tokens: 160` is six lines of prose - measured on `deepseek-chat`, where a verdict and a sentence is 120 tokens.
 * On a reasoning judge the same field covers the thinking as well as the answer, so **the cap that keeps the bill bounded
 * is the cap that emptied the answer**: the second judge returned `finish_reason: length` with no content on 66 of 66
 * failed calls. Escalating on the failure itself rather than by reading the model's name keeps the repair in one place -
 * a judge that needs more room asks for it by truncating, whatever it is called.
 */
export function escalateTokens(current) {
  const tokens = Number(current);
  if (!Number.isFinite(tokens) || tokens <= 0) return TOKEN_CEILING;
  return Math.min(Math.round(tokens * 8), TOKEN_CEILING);
}
