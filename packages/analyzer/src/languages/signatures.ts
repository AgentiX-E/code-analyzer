// @code-analyzer/analyzer — declaration signatures
//
// **The header of a declaration, with its body removed**, which is the thing an IDE shows in an outline, a caller reads
// before committing to a call, and a search index has never had.

/**
 * The part of the tree-sitter node API a signature is read from.
 *
 * **Structural, not nominal**, so this module can be exercised on hand-built nodes without a grammar: the shape below is
 * a subset of `TreeSitterSyntaxNode`, and the type is what a test has to satisfy instead of a parser.
 */
export interface SignatureNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly namedChildCount: number;
  readonly childCount: number;
  namedChild(index: number): SignatureNode;
  child(index: number): SignatureNode;
  childForFieldName(fieldName: string): SignatureNode | null;
}

/**
 * How long a signature may be before it stops being one.
 *
 * **A generated command table declares a method with a hundred parameters**, and its header is not a signature a reader
 * or an index can use - it is the table itself. Returning nothing for those keeps a pathological declaration out of the
 * field rather than letting one line dominate every document's length.
 */
export const MAX_SIGNATURE_LENGTH = 400;

/**
 * **The trailing tokens a header carries because of the token that had to follow it, removed in one pass.**
 *
 * This was `/(\s*(=>|:|;|\{|=\s*))+$/` - a quantified group whose alternatives can each match nothing, which is the
 * textbook shape of catastrophic backtracking. **Measured, not suspected**: twenty thousand `= ` in a row and a letter
 * that stops the anchor matching took the regex past fifteen seconds before it was killed, and a header is built from
 * every declaration in a file. **A parser that a source file can stop is a parser that reviews nothing.**
 *
 * The replacement is a loop that consumes the same tokens from the end, and it is linear for a reason a reader can check
 * without a backtracking model: **every iteration either shortens the string or returns.** The token set is unchanged -
 * `=>`, `:`, `;`, `{`, `=`, and the whitespace each may carry - because **the point is to remove the same characters, not
 * to remove fewer of them quickly.**
 */
export function stripTrailingNoise(header: string): string {
  // The caller has already trimmed, and doing it here too means the loop never has to reason about a trailing space.
  const text = header.trimEnd();
  // **The cut only moves when a token is consumed.** Reading right to left, whitespace is skipped but does not of
  // itself shorten the header, because a space after the last token is not noise - and that is exactly the distinction
  // the regex drew with `\s*` inside the repeated group rather than outside it.
  let cut = text.length;
  let at = text.length;
  while (at > 0) {
    const char = text[at - 1]!;
    // **Whitespace immediately before a token is consumed with it**, which is what the regex's leading `\s*` did:
    // `'a = '` became `'a'` and not `'a '`. A space after the last token is still not noise, which is why this skip
    // happens here, after a token has been found, rather than at the top of the loop.
    const consume = (tokenStart: number): void => {
      at = tokenStart;
      while (at > 0 && /\s/.test(text[at - 1]!)) at -= 1;
      cut = at;
    };
    if (char === ':' || char === ';' || char === '{' || char === '=') {
      consume(at - 1);
      continue;
    }
    if (char === '>' && at >= 2 && text[at - 2] === '=') {
      consume(at - 2);
      continue;
    }
    if (/\s/.test(char)) {
      at -= 1;
      continue;
    }
    break;
  }
  return text.slice(0, cut);
}

/**
 * The signature of a declaration: **the declaration's own text up to its body**.
 *
 * **Cutting at the body is the rule that works in every grammar**, because it makes no assumption about where a return
 * type sits. `public void run(String a)` puts it before the name, `function f(a: number): void` puts it after, C puts it
 * before a declarator that holds the parameters - and in all three, everything that is not the body is the header. A
 * rule that composed `name(params) + returnType` would need a per-language table of which half comes first, and would
 * still miss the modifiers that are part of how a developer recognises the declaration.
 *
 * **A declaration with no body** - an abstract method, an interface's contract, a `declare function` - has no cut point
 * to find, so the parameter list and the result type are used instead, whichever ends later. That is the same cut,
 * reached from the other side.
 *
 * Returns `undefined` when there is nothing to say: a node that is not a declaration at all, a header that is empty
 * after tidying, or one longer than {@link MAX_SIGNATURE_LENGTH}.
 */
export function signatureOf(
  node: SignatureNode,
  limit: number = MAX_SIGNATURE_LENGTH,
): string | undefined {
  const end = cutOf(node);
  if (end === undefined) return undefined;

  const header = node.text.slice(0, end - node.startIndex);
  return tidy(header, limit);
}

/**
 * Where the header of a declaration ends.
 *
 * **The body first**, because it is the only landmark every grammar agrees on. **Then the parameter list or the result
 * type**, for a declaration that has neither a body nor a `;`. **Then the whole node**, minus its terminator, which is
 * what a `declare function f(a: number): void;` is.
 */
function cutOf(node: SignatureNode): number | undefined {
  const body = node.childForFieldName('body');
  if (body !== null) return body.startIndex;

  const parameters = parameterListOf(node);
  const result = resultTypeOf(node, parameters);
  const ends = [parameters?.endIndex ?? -1, result?.endIndex ?? -1].filter((index) => index >= 0);
  if (ends.length > 0) return Math.max(...ends);

  // **Nothing to cut at is nothing to report.** The whole node is *not* the fallback, because the node a capture was
  // built from is not always a declaration: `app.use = function () {}` produces a `FUNCTION_DEF` whose node is the
  // assignment, and its whole text is the body this function exists to remove.
  return undefined;
}

/**
 * The parameter list of a declaration, or `undefined`.
 *
 * **The field first**, because a grammar that names the field is saying exactly which child it is. The type scan is the
 * fallback for the grammars that do not: `formal_parameters`, `parameters`, `parameter_list`,
 * `function_value_parameters`, `parameter_clause` and `params` are what the twenty grammars this package speaks call
 * the same thing.
 */
function parameterListOf(node: SignatureNode): SignatureNode | undefined {
  const fielded = node.childForFieldName('parameters');
  if (fielded !== null) return fielded;

  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (/param/i.test(child.type)) return child;
  }
  return undefined;
}

/**
 * The declared result type, when one is written.
 *
 * **Only where it follows the parameters**, because that is the only position in which it is unambiguously a result:
 * `type` is also the field a variable declaration uses for its own type, and a node whose `type` child ends *before* the
 * parameter list has named something else.
 */
function resultTypeOf(
  node: SignatureNode,
  parameters: SignatureNode | undefined,
): SignatureNode | undefined {
  if (parameters === undefined) return undefined;
  for (const field of ['return_type', 'result', 'type'] as const) {
    const child = node.childForFieldName(field);
    if (child !== null && child.endIndex > parameters.endIndex) return child;
  }
  return undefined;
}

/** Collapse the whitespace a multi-line header carries, drop the terminator, and refuse what is left if it is empty. */
function tidy(header: string, limit: number): string | undefined {
  const collapsed = header
    .replace(/\s+/g, ' ')
    // **A list written one entry per line collapses to `( a, b )`**, and the spaces inside the parentheses are artefacts
    // of the line breaks rather than of the signature.
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    // A trailing comma is the artefact of the same line breaks.
    .replace(/,\s*\)/g, ')')
    // **Trimmed before the terminator is dropped, and not after**: the terminator is separated from the header by the
    // space that ended the last token, so `(x: number) => ` does not end with `=>` until the space is gone.
    .trim();
  const stripped = stripTrailingNoise(collapsed).trim();
  if (stripped.length === 0 || stripped.length > limit) return undefined;
  return stripped;
}
