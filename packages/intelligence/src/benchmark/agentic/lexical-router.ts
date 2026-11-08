/**
 * @fileoverview The lexical arm: what a keyword router picks, so the model's number has something to be better than.
 *
 * **A benchmark without a null is a number without a scale.** Many tools in this cabinet are named after the noun in the
 * question — `find_dead_code` answers "find dead code" — so a BM25 index over the catalog scores well on any task set
 * that was written by reading the catalog. This arm exists to be beaten, and it is also the honest stand-in for the
 * routing layer competing products ship: a description index, a similarity score, a top-1.
 *
 * **It is deterministic**, so it contributes exactly one attempt per task and its interval is not inflated by resampling
 * the same decision.
 */

import type { ToolDefinition } from '../../review/llm/provider.js';

/** One indexed document: a tool, and the words that describe it. */
export interface CatalogDocument {
  readonly name: string;
  readonly description: string;
  /** Parameter names, which a user's sentence often contains ("by line range", "from ref to ref"). */
  readonly parameters: readonly string[];
}

/** Split a tool name or a sentence into lowercase terms, splitting snake_case and camelCase. */
export function tokenise(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Build the documents this arm indexes from a tool catalog. */
export function catalogDocuments(tools: readonly ToolDefinition[]): CatalogDocument[] {
  return tools.map((tool) => {
    const properties =
      (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    return {
      name: tool.name,
      description: tool.description,
      parameters: Object.keys(properties),
    };
  });
}

/**
 * Rank tools for a query with Okapi BM25.
 *
 * **`k1 = 1.2`, `b = 0.75`, the textbook defaults**, because a tuned BM25 would be a second thing to defend and this arm
 * is a floor rather than a contender. Ties break on name so two runs rank identically.
 */
export function rankTools(
  query: string,
  documents: readonly CatalogDocument[],
  options: { readonly k1?: number; readonly b?: number } = {},
): Array<{ name: string; score: number }> {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const queryTerms = tokenise(query);

  const docs = documents.map((doc) => {
    // **The name is counted three times.** A tool called `find_dead_code` is *about* dead code in a way a sentence of
    // description is not, and weighting the name is what makes this arm a fair proxy for a name-matching router rather
    // than a straw man that loses on a technicality.
    const terms = [
      ...tokenise(doc.name),
      ...tokenise(doc.name),
      ...tokenise(doc.name),
      ...tokenise(doc.description),
      ...doc.parameters.flatMap(tokenise),
    ];
    const frequency = new Map<string, number>();
    for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    return { name: doc.name, length: terms.length, frequency };
  });

  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
  const documentFrequency = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    documentFrequency.set(term, docs.filter((doc) => doc.frequency.has(term)).length);
  }
  const total = docs.length;

  return docs
    .map((doc) => {
      let score = 0;
      for (const term of new Set(queryTerms)) {
        const frequency = doc.frequency.get(term) ?? 0;
        if (frequency === 0) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        const denominator =
          frequency + k1 * (1 - b + (b * doc.length) / Math.max(1, averageLength));
        score += idf * ((frequency * (k1 + 1)) / denominator);
      }
      return { name: doc.name, score };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}
