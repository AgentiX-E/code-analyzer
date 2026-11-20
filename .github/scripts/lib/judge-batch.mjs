/**
 * **One judge call, several pairs, and the reason the constant block moves to the front.**
 *
 * The judge scored 5 080 pairs on `44758245838` for 0.1899 USD, and **its prompt cache ratio was 8.5 %** on the same
 * provider, the same day, as a reviewer whose ratio was 52.9 %. §110 asked why and answered it as an ordering question:
 * the constant block should lead, and consecutive calls should share the longest prefix. **Both were already true** -
 * `judgeMatrix` has been golden-major with a warm pass since 2026-11-10 - and the ratio did not move, which is the
 * measurement that makes the ordering hypothesis false rather than unfinished.
 *
 * **What the arithmetic says instead.** A judge prompt is about **250 tokens**: three instruction lines, one golden, one
 * comment. The constant part is about **57 tokens**, and a prefix cache works in blocks of **64** - so the block that
 * is shared does not exist, and **every call pays for its own instructions**. Batching is the device that creates the
 * block: eight comments behind one instruction block make the shared prefix **larger than one block by a factor of
 * three**, and divide the per-pair instruction cost by eight.
 *
 * **And it is the same device as §107's, one layer down.** There, one call answered six questions about one diff and the
 * five separate calls became one; here one call answers one question about eight pairs. **The unit that is repeated is
 * what changes, and the constant is what the repetition pays for.**
 *
 * **What this module is.** The prompt and the parser, both pure, so the arithmetic is testable without the model:
 * `buildJudgeBatch` returns the two messages, `parseJudgeBatch` returns one verdict per comment **or `null`** - and null
 * is the whole point, because **a batch whose answer cannot be read is not a batch of non-matches**. The caller falls
 * back to one call per pair, which is the answer this repository gives everywhere else: *a judge that did not answer is
 * not a verdict*.
 */

/**
 * The system message, which is the part every batch for one golden shares.
 *
 * **The golden is in the system message rather than in the user message** because a prefix cache is written from the
 * start of the request: the rubric *and* the golden are the same for every batch scored against that golden, so they
 * belong inside the cached prefix. **A golden in the user message would have been cached only up to the rubric**, which
 * is under one block.
 */
export function buildJudgeMessages(golden, comments) {
  const numbered = comments.map((comment, at) => `${at + 1}. ${comment}`).join('\n');
  return {
    system: [
      'You compare code review comments against one expert-confirmed issue from the same pull request.',
      'A comment matches when it describes the same underlying defect, even in different words.',
      'Judge each comment independently: another comment in the same list is not evidence for or against it.',
      'Answer with one JSON object and nothing else.',
      '',
      'Expert-confirmed issue:',
      golden,
    ].join('\n'),
    user: [
      `Review comments (${comments.length}):`,
      numbered,
      '',
      `Answer with exactly ${comments.length} booleans, in this order: {"matches":[${comments
        .map(() => 'true|false')
        .join(',')}]}`,
    ].join('\n'),
  };
}

/** The verdicts in an answer, or `null` when the answer is not one verdict per comment. */
export function parseJudgeBatch(text, count) {
  if (!Number.isInteger(count) || count < 1) return null;
  const stripped = String(text ?? '')
    .replace(/```json|```/g, '')
    .trim();
  let body;
  try {
    body = JSON.parse(stripped);
  } catch {
    return null;
  }
  const matches = body?.matches;
  // **Length is checked rather than inferred.** A short list is a model that stopped reading, and padding it with
  // `false` would record the unread comments as non-matches - the failure mode this repository has paid for twice.
  if (!Array.isArray(matches) || matches.length !== count) return null;
  if (!matches.every((value) => typeof value === 'boolean')) return null;
  return matches;
}

/** The indices of `count` items, in chunks of at most `size`. */
export function chunkIndices(count, size) {
  if (!Number.isInteger(size) || size < 1)
    throw new Error(`chunk size ${size} is not a positive integer`);
  const chunks = [];
  for (let at = 0; at < count; at += size) {
    const chunk = [];
    for (let index = at; index < Math.min(at + size, count); index += 1) chunk.push(index);
    chunks.push(chunk);
  }
  return chunks;
}
