// @code-analyzer/intelligence — listwise reranking for the fused retrieval result
//
// **Fusion decides which twenty candidates a user sees; it does not decide their order, and order is what a reader
// feels.** The paraphrase measurement makes that concrete: at weight 1 the fused list answers **0.5657 recall@20** while
// its MRR is 0.2470 — the answer is inside the twenty for three questions in five, and first for one in four. **A
// reranker is the only stage that can move the second number without changing the first**, which is why every
// codebase-QA product in the matrix ships one.
//
// **Listwise, not pointwise.** A pairwise scorer has to be trained; a model asked to *order a short list it can see*
// needs no training at all, and the whole candidate set fits in one prompt at the size this retriever returns. That is
// the same trade the HyDE arm made on the query side: use the model's judgement where a learned component would
// otherwise be required.
//
// **Two invariants, both enforced here rather than trusted to the model.**
//
// 1. **A rerank is a permutation.** An id the model invents, a repeat, or a candidate it forgot is not an ordering of
//    the list - so ids outside the range are dropped, repeats are ignored, and candidates the model did not mention
//    keep their original relative order at the end. **A reranker that can lose a candidate would be able to turn a
//    correct fused answer into a miss**, and a measurement of it would then be measuring the parser.
// 2. **A failure returns the input.** No provider, a timeout, or an answer that parses to nothing leaves the fused
//    order exactly as it was, and says so.

import type { LLMProvider } from '../review/llm/provider.js';

/** One candidate, as the prompt shows it and the caller gets it back. */
export interface RerankCandidate {
  /** Where this candidate sat in the fused list, 1-based. **The id in the prompt is this number.** */
  rank: number;
  name: string;
  /** Qualified name, which disambiguates the nine `parse` functions a polyglot corpus holds. */
  qualifiedName: string;
  filePath: string | null;
  signature?: string | null;
  /** A short excerpt of the body; the prompt is a judgement call, not a reading task. */
  excerpt?: string | null;
}

/** What the reranker did, and what it cost. */
export interface RerankResult<T extends { rank: number }> {
  /** The candidates in the order the model chose, with the ones it omitted appended unchanged. */
  ordered: T[];
  /** Whether the model's answer changed the order at all. */
  applied: boolean;
  /** Why not, when `applied` is false and the caller asked for a rerank. */
  reason?: string;
  /** The raw answer, kept for a reader debugging a prompt rather than a score. */
  answer?: string;
}

/**
 * The prompt.
 *
 * **The candidates are numbered and the answer must be numbers**, because a model asked to *quote* qualified names
 * returns approximations of them, and a reranker whose ids do not match the list is a reranker that silently does
 * nothing. **It is told it may answer with fewer than all of them** - a forced full permutation invites invented ids.
 */
export function rerankPrompt(question: string, candidates: RerankCandidate[]): string {
  const lines = candidates.map((candidate) => {
    const parts = [`[${candidate.rank}] ${candidate.name}`];
    if (candidate.filePath) parts.push(`path: ${candidate.filePath}`);
    if (candidate.signature) parts.push(`signature: ${candidate.signature}`);
    if (candidate.excerpt) parts.push(`body: ${candidate.excerpt}`);
    return parts.join('\n    ');
  });
  return [
    'You are ranking search results for a developer who asked the question below.',
    '',
    `Question: ${question}`,
    '',
    'Candidates:',
    lines.join('\n'),
    '',
    'Order the candidates by how likely each one is the function the question is asking about.',
    'Answer with the bracket numbers only, best first, space separated. Include every candidate you are confident',
    'ranks above the ones you are not; omitting a number leaves it in its original position.',
    '',
    'Answer:',
  ].join('\n');
}

/**
 * The order the model asked for, restricted to what the list can honour.
 *
 * **The parse is the safety boundary**, so it accepts the shapes a model actually produces - `3 1 2`, `3, 1, 2`,
 * `[3,1,2]`, with or without a lead-in sentence - and returns only ids that exist, once each. An answer with no usable
 * id returns an empty array, which the caller treats as "no rerank".
 */
export function parseRerankAnswer(answer: string, count: number): number[] {
  const numbers = answer.match(/\d+/g) ?? [];
  const seen = new Set<number>();
  const order: number[] = [];
  for (const text of numbers) {
    const id = Number.parseInt(text, 10);
    // **0 and `count + 1` are the two an off-by-one answer produces**, and both are dropped rather than clamped.
    if (!Number.isInteger(id) || id < 1 || id > count) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/**
 * A reason a reader can act on, from whatever a provider rejected with.
 *
 * **Exported because the two arms are worth testing without a transport**: a fetch can reject with a string or with an
 * object, and a reason recorded as `undefined` would hide the failure rather than report it.
 */
export function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Apply an order to the candidates, **appending every candidate the order did not mention**. */
export function applyOrder<T extends { rank: number }>(candidates: T[], order: number[]): T[] {
  const byRank = new Map(candidates.map((candidate) => [candidate.rank, candidate]));
  const placed = order
    .map((rank) => byRank.get(rank))
    .filter((candidate): candidate is T => candidate !== undefined);
  const mentioned = new Set(placed.map((candidate) => candidate.rank));
  // **The omitted candidates keep their own relative order**, so an incomplete answer is a partial rerank rather than
  // a truncation: no input can be lost by asking for a better order.
  return [...placed, ...candidates.filter((candidate) => !mentioned.has(candidate.rank))];
}

/**
 * Reorder the candidates with a model's judgement.
 *
 * **The provider is an interface**, so this is not another place one vendor is hard-coded; and **every failure path
 * returns the input**, so a caller can enable it without owning an availability check.
 */
export async function rerankCandidates<T extends { rank: number }>(
  question: string,
  candidates: T[],
  toCandidate: (value: T) => RerankCandidate,
  provider: LLMProvider | null,
  options: { maxTokens?: number; timeout?: number } = {},
): Promise<RerankResult<T>> {
  if (candidates.length < 2) {
    return {
      ordered: candidates,
      applied: false,
      reason: 'fewer than two candidates, so there is no order to choose',
    };
  }
  if (!provider) {
    return { ordered: candidates, applied: false, reason: 'no LLM provider is configured' };
  }

  let answer: string;
  try {
    const completion = await provider.complete(
      rerankPrompt(question, candidates.map(toCandidate)),
      {
        maxTokens: options.maxTokens ?? 120,
        temperature: 0,
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      },
    );
    answer = completion.content;
  } catch (error) {
    // **A rerank that fails must not fail the search**: the fused order is a valid answer, and the caller keeps it.
    return {
      ordered: candidates,
      applied: false,
      reason: `rerank failed: ${describeFailure(error)}`,
    };
  }

  const order = parseRerankAnswer(answer, candidates.length);
  if (order.length === 0) {
    return {
      ordered: candidates,
      applied: false,
      reason: 'the answer contained no usable candidate number',
      answer,
    };
  }
  const ordered = applyOrder(candidates, order);
  const applied = ordered.some((candidate, index) => candidate.rank !== candidates[index]!.rank);
  return {
    ordered,
    applied,
    ...(applied ? {} : { reason: 'the answer kept the fused order' }),
    answer,
  };
}
