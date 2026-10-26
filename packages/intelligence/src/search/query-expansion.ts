// @code-analyzer/intelligence — query expansion for the semantic half
//
// **The gap this closes is the one the paraphrase figure names.** With a question written from a doc comment and every
// doc comment stripped from the index, the fused retriever answers **0.4747 recall@20** — and the misses are not
// lexical near-misses, they are questions whose words appear nowhere: "How do I find the name of a component declared
// with a decorator in ArkUI code?" against a symbol whose vector holds `ArkTSProvider walkAndCapture(...)` and a body
// of code.
//
// **HyDE** (Gao, Ma, Lin & Callan, *Precise Zero-Shot Dense Retrieval without Relevance Labels*, 2022) is the
// standard answer to exactly this asymmetry, and it is the cheapest one: ask a model to **write the code the question
// would be answered by**, and embed the question together with that hypothesis. A hypothetical implementation lives in
// the same space as the corpus — identifiers, types, call shapes — while the question does not.
//
// **Two deliberate choices.**
//
// 1. **The question stays in the mean.** HyDE alone replaces the question with a hypothesis that may be confidently
//    wrong; averaging keeps the query anchored to what the user asked, so a bad hypothesis moves the vector instead of
//    replacing it.
// 2. **The provider is an interface, not an import.** `LLMProvider` is the same abstraction the review pipeline uses,
//    so this is not another place where one vendor is hard-coded — see the provider-agnostic rule this repository
//    applies to every LLM-dependent component.

import type { LLMProvider } from '../review/llm/provider.js';

/** A question, and the implementation a model wrote for it. */
export interface ExpandedQuery {
  question: string;
  hypothesis: string;
}

/** Knobs a caller can move without touching the prompt. */
export interface ExpansionOptions {
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

/**
 * **A hypothesis shorter than this is not a hypothesis.** A model that answers with "I don't know" or an empty string
 * must not drag the query vector towards the mean of itself and nothing — the caller drops it instead, and the
 * measurement reports how often that happened.
 */
export const MIN_HYPOTHESIS_CHARS = 40;

/**
 * The prompt.
 *
 * **It asks for code, not for an answer.** A model asked "which function does X" will name a function that does not
 * exist in the corpus; a model asked to *write* the code answers in the corpus's own vocabulary — parameter names,
 * types, the shape of a loop — which is what a code vector matches on.
 */
export function hydePrompt(question: string): string {
  return [
    'You are helping a code search engine find a function in a real repository.',
    '',
    'Write a short, plausible implementation of the function that would answer the question below. Invent the name and',
    'the signature. Keep it under 15 lines. Use TypeScript unless the question implies another language.',
    '',
    'Rules:',
    '- Output code only: no explanation, no markdown fence, no commentary.',
    '- It does not have to be correct; it has to look like the code in the repository.',
    '',
    'Question:',
    question,
  ].join('\n');
}

/**
 * The text a model actually returned, reduced to something embeddable.
 *
 * **Models wrap code in fences and prefix it with a sentence**, both of which add tokens that belong to no symbol in
 * the corpus. The fence and the labels are removed rather than tolerated, and an empty result is reported as empty so
 * the caller can skip the hypothesis instead of embedding a stray newline.
 */
export function cleanHypothesis(text: string): string {
  const withoutFence = text
    .replace(/\r\n/g, '\n')
    // **A fence anywhere, not only at the start**: a model often writes "Sure, here it is:" first.
    .replace(/```[a-zA-Z0-9+-]*\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // **A leading label such as `Code:` is a caption, not code.**
  const withoutLabel = withoutFence.replace(/^(?:code|answer|implementation|function)\s*:\s*/i, '');
  return withoutLabel.trim();
}

/** Ask a provider for the implementation a question implies. */
export async function expandQuestion(
  question: string,
  provider: LLMProvider,
  options: ExpansionOptions = {},
): Promise<ExpandedQuery> {
  const completion = await provider.complete(hydePrompt(question), {
    maxTokens: options.maxTokens ?? 220,
    temperature: options.temperature ?? 0,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  return { question, hypothesis: cleanHypothesis(completion.content) };
}

/**
 * The mean of the vectors, **renormalised**.
 *
 * A cosine is a dot product only for unit vectors, and the index's vectors are unit length. The mean of two unit
 * vectors is shorter than either, so it is scaled back: without that, every expanded query would be compared at a
 * smaller magnitude and the `similarity > 0` filter in `vectorSearch` would behave differently for expanded and plain
 * queries. An all-zero input returns an all-zero vector rather than `NaN`, because a zero vector scores 0 against
 * everything, which is the honest answer for "no information".
 */
export function meanVector(vectors: ArrayLike<number>[]): Float32Array {
  const first = vectors[0];
  if (!first) return new Float32Array(0);
  const dimension = first.length;
  const out = new Float32Array(dimension);
  let count = 0;
  for (const vector of vectors) {
    // **A vector of another width is skipped rather than resized**: it belongs to another space, and averaging two
    // spaces is the defect the retrieval figure spent a day correcting.
    if (vector.length !== dimension) continue;
    // **The width is the value's own**, so both indices are in range by construction and neither needs a fallback: a
    // `?? 0` here would be an arm no input could reach.
    for (let i = 0; i < dimension; i++) out[i] = (out[i] as number) + (vector[i] as number);
    count += 1;
  }
  // **`count` is at least one**, because the first vector defines the width it is then compared against - so the
  // "nothing averaged" guard that used to sit here was dead code.
  const mean = out.map((value) => value / count);
  let sum = 0;
  for (const value of mean) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return Float32Array.from(mean);
  return Float32Array.from(mean, (value) => value / norm);
}

/**
 * The vector a query is actually searched with: **the question and its hypothesis in one direction**.
 *
 * Returns the plain question vector when the model produced nothing usable, so a failed expansion degrades to the
 * current behaviour rather than to an empty list — and says so in `hypothesis`, which is `''` in that case.
 */
export async function expandToVector(
  question: string,
  provider: LLMProvider,
  embed: (text: string) => Promise<Float32Array>,
  options: ExpansionOptions = {},
): Promise<ExpandedQuery & { vector: Float32Array }> {
  const expanded = await expandQuestion(question, provider, options);
  const questionVector = await embed(question);
  if (expanded.hypothesis.length < MIN_HYPOTHESIS_CHARS) {
    return { ...expanded, vector: questionVector };
  }
  const hypothesisVector = await embed(expanded.hypothesis);
  return { ...expanded, vector: meanVector([questionVector, hypothesisVector]) };
}
