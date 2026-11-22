// **The verdicts a run bought, in a form the next run can read.**
//
// `judgeMatrix` has always computed the whole matrix - every finding against every golden of its pull request - and has
// always thrown away everything except the matches, because the matches are what the figure needs. The arithmetic is
// then reproducible only by buying it again: on the 2026-11-10 AACR run that is 14 892 judged pairs, and the artifact
// that recorded `pairsJudged: 14892` kept none of them.
//
// **What this file holds is the smallest form that is still the whole answer.** One character per pair, in an order the
// file names, with three answers rather than two:
//
// - `1` the judge said the two statements describe the same defect;
// - `0` the judge said they do not;
// - `?` the judge did not answer, which is not the same sentence as `0`.
//
// **Why a string and not an array of objects.** The matrix is sparse in findings and dense in pairs, and a JSON array of
// 14 892 `{finding, golden, match}` objects is roughly thirty times the file for a table whose two coordinates are
// implied by its position. The cost of that compactness is that **position carries meaning**, so `order` is written into
// the file and checked on the way back in: a ledger whose reader assumes a different order than its writer is a ledger
// that silently transposes the table.
//
// **Why `?` rather than folding an unanswered pair into `0`.** The run of 2026-11-10 recorded three refusals inside one
// rate-limit window as "the judge had nothing to say", which is how a rate-limited job became a recall figure. A ledger
// that repeats that fold would make every later recomputation quietly more lenient than the run it is recomputing.

/** The shape this file writes. A reader that meets another number has met a file it does not understand, and says so. */
export const VERDICT_LEDGER_VERSION = 1;

/** The only coordinates this file knows. Named in the file so a reader never has to infer it from a producer. */
const ORDER = 'golden-major';

/**
 * The three answers, and the two ways of writing "no answer".
 *
 * `undefined` is accepted on the way in and encoded as `?`, because that is what `judgeMatrix` holds for a pair its
 * loop never reached - and a hole and a refusal are the same sentence about the *job*, even though they are different
 * sentences about the model.
 */
const CELL_OF = new Map([
  [true, '1'],
  [false, '0'],
  [null, '?'],
  [undefined, '?'],
]);

/** The inverse, written as a lookup rather than a chain of comparisons so an unknown character cannot fall through. */
const VERDICT_OF = new Map([
  ['1', true],
  ['0', false],
  ['?', null],
]);

function assertCounts(findings, goldens, where) {
  for (const [name, value] of [
    ['findings', findings],
    ['goldens', goldens],
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `${where}: ${name} must be a non-negative integer, received ${JSON.stringify(value)}`,
      );
    }
  }
}

/**
 * **Encode the matrix `judgeMatrix` already computed.**
 *
 * `verdicts` is in `golden-major` order: every finding against the first golden, then every finding against the second.
 * That is the order `judgeMatrix` walks its pairs in, and the order the warm pass depends on, so encoding it in place
 * costs no pass over the matrix.
 */
export function encodeVerdictLedger({ findings, goldens, verdicts }) {
  assertCounts(findings, goldens, 'encodeVerdictLedger');
  if (!Array.isArray(verdicts)) {
    throw new Error('encodeVerdictLedger: verdicts must be an array');
  }
  const expected = findings * goldens;
  if (verdicts.length !== expected) {
    throw new Error(
      `encodeVerdictLedger: ${verdicts.length} verdicts for ${findings} findings and ${goldens} goldens (${expected} pairs)`,
    );
  }

  let cells = '';
  for (let at = 0; at < verdicts.length; at += 1) {
    const cell = CELL_OF.get(verdicts[at]);
    // **A truthy non-boolean is not a verdict.** `1` and `'yes'` reaching here would be encoded as a match by a
    // `Boolean()` that nobody wrote, so the refusal names the value and the position instead.
    if (cell === undefined) {
      throw new Error(
        `encodeVerdictLedger: ${JSON.stringify(verdicts[at])} at pair ${at} is not a verdict (true, false, null or undefined)`,
      );
    }
    cells += cell;
  }

  return { version: VERDICT_LEDGER_VERSION, order: ORDER, findings, goldens, cells };
}

/** Read a ledger back into the matrix, refusing every shape this file did not write. */
export function decodeVerdictLedger(ledger) {
  if (ledger === null || typeof ledger !== 'object') {
    throw new Error('decodeVerdictLedger: a ledger is an object');
  }
  if (ledger.version !== VERDICT_LEDGER_VERSION) {
    throw new Error(
      `decodeVerdictLedger: version ${JSON.stringify(ledger.version)} is not ${VERDICT_LEDGER_VERSION}; a ledger written by another version is not an answer`,
    );
  }
  if (ledger.order !== ORDER) {
    throw new Error(
      `decodeVerdictLedger: order ${JSON.stringify(ledger.order)} is not ${ORDER}; position carries the coordinates, so a different order is a different table`,
    );
  }

  const { findings, goldens } = ledger;
  assertCounts(findings, goldens, 'decodeVerdictLedger');
  const cells = ledger.cells;
  if (typeof cells !== 'string') {
    throw new Error('decodeVerdictLedger: cells must be a string');
  }
  const expected = findings * goldens;
  if (cells.length !== expected) {
    // **A short string is the dangerous one.** It decodes to a matrix with an absent corner, and every figure
    // recomputed from it is a figure about fewer pairs than the ledger says it holds.
    throw new Error(
      `decodeVerdictLedger: ${cells.length} cells for ${findings} findings and ${goldens} goldens (${expected} pairs)`,
    );
  }

  const verdicts = new Array(expected);
  for (let at = 0; at < expected; at += 1) {
    const verdict = VERDICT_OF.get(cells[at]);
    if (verdict === undefined) {
      throw new Error(
        `decodeVerdictLedger: ${JSON.stringify(cells[at])} at pair ${at} is not a verdict; expected one of 1, 0, ?`,
      );
    }
    verdicts[at] = verdict;
  }

  return { findings, goldens, verdicts };
}

/**
 * **The matches, rebuilt from the cells.**
 *
 * The same shape `judgeMatrix` returns, for the same reason: the arithmetic downstream - the maximum matching, the
 * curve, the corpus's file-level walk - reads `matches[finding] = [golden, ...]`, and a recomputation that returned a
 * different shape would need its own copy of all of it. A `null` contributes no match, which is the one place this
 * function agrees with `judgeMatrix` about the unanswered pairs: they are counted as unanswered there, and they are
 * counted as unanswered by whoever reads `?` out of the ledger.
 */
export function matchesFromVerdictLedger({ findings, goldens, verdicts }) {
  const matches = Array.from({ length: findings }, () => []);
  for (let golden = 0; golden < goldens; golden += 1) {
    for (let finding = 0; finding < findings; finding += 1) {
      if (verdicts[golden * findings + finding] === true) matches[finding].push(golden);
    }
  }
  return matches;
}
