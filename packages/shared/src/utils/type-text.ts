// @code-analyzer/shared — the two textual reductions every language reader needs from a type expression
//
// **Both exist because the single-pass version of each is wrong on the input the language actually allows.**
//
// `text.replace(/<[^>]*>/g, '')` removes a *prefix* of a nested type argument list: `Map<String, List<Integer>>` matches
// `<String, List<Integer>` and leaves `Map>` behind, so the name a caller reads afterwards is `Map>` - a declaration that
// does not exist, filed under a name nothing will ever join. The Java and TypeScript readers all carried a copy of that
// line, which is how a wrong answer gets to be consistent.
//
// **The scan is depth-counted rather than repeated.** A loop of `replace` until the text stops changing removes a nest
// of any depth and costs a pass per level; a counter removes any depth in one pass, and it can say what it did with an
// unbalanced `<` instead of guessing.

/**
 * A type expression without its type arguments: `Map<String, List<Integer>>` becomes `Map`.
 *
 * A `<` with no matching `>` is left in place, because it is not a type argument list - it is a comparison, and a
 * reader that dropped the rest of the expression would be reading an operator as syntax it recognises.
 */
export function stripTypeArguments(text: string): string {
  let out = '';
  let depth = 0;
  // Where the outermost `<` of the group being skipped sits, so an unbalanced group can be put back verbatim.
  let openedAt = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '<') {
      if (depth === 0) openedAt = out.length;
      out += '<';
      depth += 1;
      continue;
    }
    if (char === '>' && depth > 0) {
      depth -= 1;
      if (depth === 0 && openedAt >= 0) {
        // Drop the whole group, including the `<` that opened it.
        out = out.slice(0, openedAt);
        openedAt = -1;
      }
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * The simple name a qualified type refers to: `a.b.C<D>` becomes `C`.
 *
 * **One function and not a `lastIndexOf('.')` at each call site**, because the two reductions are always wanted
 * together - a caller that takes the last segment without removing the arguments reads `C<D>` as the name.
 */
export function simpleTypeName(text: string): string {
  const plain = stripTypeArguments(text).trim();
  return plain.slice(plain.lastIndexOf('.') + 1).trim();
}
