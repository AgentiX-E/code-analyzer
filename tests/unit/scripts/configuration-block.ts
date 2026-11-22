/**
 * **The artifact's `configuration` object, read by braces rather than by a character window.**
 *
 * Four suites assert that a switch reaches `configuration`, and each used to do it with `slice(0, 6000)` — **which is
 * not an assertion about the key, it is an assertion about the comments above the key.** Adding twenty-one lines of
 * reasoning beside `judgeBatch` moved `sameSiteConcerns` past the six thousandth character and turned two green tests
 * red without changing a byte of behaviour. The wrong repair is a longer window: it breaks again at the next comment,
 * and nobody who sees it fail will know why.
 *
 * So the block is matched by depth. It begins at `configuration: {` and ends at the brace that closes it, whatever the
 * prose in between, and a source with no such block is a failure with a sentence rather than an empty string that makes
 * every `toContain` on it pass.
 */
export function configurationBlock(source: string): string {
  const start = source.indexOf('configuration: {');
  if (start < 0) throw new Error('the artifact has no `configuration: {` block to read');
  let depth = 0;
  for (let at = source.indexOf('{', start); at < source.length; at += 1) {
    const character = source[at];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, at + 1);
    }
  }
  throw new Error('the `configuration` block is never closed in this source');
}
