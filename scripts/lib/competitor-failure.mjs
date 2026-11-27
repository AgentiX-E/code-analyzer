/**
 * **A pull request the competitor's harness could not read is not a pull request it read and found nothing in.**
 *
 * `§177` measured the cost of the collapse. On the fifty-pull-request slice, two pull requests (`ComfyUI#7952`,
 * `ComfyUI#9560`) name commits the remote no longer holds, so the competitor's harness fails at `git` before it reviews
 * anything:
 *
 *     fatal: remote error: upload-pack: not our ref 4936d01872b8719ede33f9a11dc8e898c33d39e4
 *
 * **The harness filed a row with zero findings for each of them**, because the branch that decides what to do with a
 * failure only recognised one way of not running - the provider refusing the call for want of credit - and scored every
 * other failure as *ran and found nothing*. Eleven goldens on those two pull requests then entered the competitor's
 * denominator as false negatives, and its recall read `0.3673` where the rows it actually held rebuild `0.3764`.
 *
 * **The three outcomes have three different repairs**, which is why they are named here rather than tested inline:
 *
 * - `credit` - the account had no balance. **A fact about this repository, not about the reviewer**: filed as a hole in
 *   the pairing, and the run records that it happened.
 * - `unreachable` - the range does not exist on the remote any more. **A fact about the corpus**: the same two pull
 *   requests answer `404` to the pinned compare and count as `unread` in the reach partition, so this is the third
 *   instrument to see one defect, and it must use the same word for it.
 * - `ran` - the tool started and failed. An observation of the tool, scored as a zero, because a crash on a pull request
 *   the run could read is a result about the tool.
 */

/** The provider refused the call. Priced at the account, filed as a hole rather than as a miss. */
const CREDIT = /402|Insufficient Balance|Payment Required/i;

/**
 * The range the harness was asked to review does not exist on the remote.
 *
 * **Every pattern here is a `git` message, not a reviewer's**, and the list is deliberately short: `not our ref` is what
 * a squashed or force-pushed branch leaves behind, `couldn't find remote ref` is a deleted branch, and `bad object` is a
 * commit a shallow mirror never received. **A pattern that matched a tool's own crash would turn a result into a hole**,
 * which is the opposite of the defect being repaired.
 */
const UNREACHABLE = [
  /upload-pack: not our ref/i,
  /couldn't find remote ref/i,
  /could not find remote ref/i,
  /fatal: bad object/i,
  /fatal: invalid object name/i,
  /fatal: ambiguous argument/i,
  /fatal: the remote end hung up/i,
];

/** The reason string the harness publishes for a credit failure, kept identical so an artifact written before this file does not change meaning. */
export const CREDIT_REASON = 'the provider refused the call for want of credit';

/**
 * **Which of the three happened**, from the raw failure text the harness already captured.
 *
 * The order matters: a refusal that also mentions a range reads as credit, because the account is the thing that can be
 * fixed and the range was resolved before the call was made.
 */
export function classifyCompetitorFailure(message) {
  const raw = typeof message === 'string' ? message.trim() : '';
  if (CREDIT.test(raw)) return 'credit';
  if (UNREACHABLE.some((pattern) => pattern.test(raw))) return 'unreachable';
  return 'ran';
}

/**
 * **The sentence a hole is filed with**, so the two holes and the one observed zero are told apart in the artifact and
 * not only in this file.
 */
export function failureReason(kind, raw) {
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (kind === 'credit') {
    return message === '' ? CREDIT_REASON : `${CREDIT_REASON}: ${message.slice(0, 300)}`;
  }
  if (kind === 'unreachable') {
    return `the corpus names a range this remote no longer holds: ${message.slice(0, 300)}`;
  }
  return message === '' ? '(the tool reported a failure with no message)' : message;
}
