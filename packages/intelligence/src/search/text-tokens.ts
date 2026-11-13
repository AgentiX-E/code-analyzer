// **How text becomes terms, in one place.**
//
// The index, the query and the fusion weight all have to agree about what a word is, and they agree by calling this
// function rather than by three similar regular expressions. `hybrid-search.ts` re-exports it, so the public surface
// (`@code-analyzer/intelligence`) is unchanged and every existing import keeps working.

/** Tokenize an identifier string by splitting on camelCase, snake_case, and kebab-case boundaries.
 * Example: "getUserProfile" -> ["get", "user", "profile"]
 * Example: "process_request" -> ["process", "request"]
 * Example: "my-component" -> ["my", "component"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // Replace separators with spaces
  const withSpaces = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMCamel
    // **Any character that is not a letter or a digit is a boundary**, which is what a word boundary is. The earlier
    // rule listed `_ - . : /` and that list was complete for identifiers - a qualified name is `file:types:ZodType`,
    // and splitting on `:` is what stopped `file:types` from being one word - **but it was not complete for text**.
    // A declaration's body is source, where the words that matter are quoted (`['escape',` kept its brackets and
    // apostrophe) and a developer's question is prose (`input?` kept its question mark), so the two halves of the
    // vocabulary could not meet. `\p{L}` and `\p{N}` rather than `a-z0-9`: a letter is a letter in any script, and a
    // character class that deletes a Chinese identifier is not a tokenizer.
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // every non-word character: snake_case, kebab-case, paths, quotes, punctuation
    .replace(/\s+/g, ' ')
    .trim();

  return withSpaces
    .split(' ')
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}
