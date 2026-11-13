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

import { LLMRateLimitError } from '../review/llm/provider.js';

import type { LLMTokenUsage } from '../review/llm/cost.js';
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
  /**
   * **How many times the provider said "slow down" before this call got through.**
   *
   * A rate limit is not a reranker's opinion, and it is the one failure a retry can turn into a real answer. It is
   * reported rather than hidden because **a ladder that ran with a queue of one never saw one, and a ladder that runs
   * eight at a time may** - a reader comparing two runs needs to know whether the fast one was answered or throttled,
   * and `reason` alone cannot say that for a call that eventually succeeded.
   */
  rateLimitRetries?: number;
  /**
   * **What the call was billed, when a call was made.**
   *
   * A reranker is the one stage of retrieval that costs money per query, and every figure this repository published
   * about it was an estimate from a per-call average: *"~0.70 USD for two arms"*. **The provider already returns the
   * tokens and the priced amount**, so a measurement that reports an estimate beside a returned number is reporting
   * the weaker of the two. Absent when nothing was sent - no provider, one candidate, a transport failure.
   */
  cost?: RerankCost;
}

/** The bill for one completion, in the provider's own terms. */
export interface RerankCost {
  model: string;
  /** Tokens as the vendor reported them, with the cache split when it sent one. */
  usage?: LLMTokenUsage;
  /** **`undefined` for a model the price table cannot price**, never `0` - see `costUsdOf`. */
  usd?: number;
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

/** The floor of the answer budget, which is what a fifty-candidate pool needs and what every smaller pool inherits. */
const MIN_ANSWER_TOKENS = 120;
/** Four tokens per rank: generous for a three-digit number and a space, and `maxTokens` is a cap rather than a cost. */
const TOKENS_PER_RANK = 4;

/**
 * **The answer budget, which has to fit the pool it answers about.**
 *
 * An answer lists at most one number per candidate, so a budget sized for fifty candidates does not fit a hundred and
 * fifty. `maxTokens` was the constant `120`, chosen when the pool was fifty - and a pool that grows past it produces a
 * completion cut mid-list, which `parseRerankAnswer` keeps the surviving numbers of and `applyOrder` reads as *"the
 * model chose not to reorder these"*. **That is the right reading of a model that stopped early and the wrong reading
 * of a transport that stopped it**, and from the caller's side the two are the same answer.
 *
 * So the budget is derived from the pool rather than declared once, and a caller that widens the pool cannot silently
 * truncate the order it asked for.
 */
export function answerBudget(count: number): number {
  return Math.max(MIN_ANSWER_TOKENS, count * TOKENS_PER_RANK);
}

/**
 * **How many times a rate-limited call is asked again.**
 *
 * Three, because a limit that survives three backoffs is a service that is down for this caller rather than busy, and a
 * rerank that waits longer than this is a search that hangs. **The number is bounded by the search's own timeout**: the
 * worst case here is 1 + 2 + 4 seconds of waiting plus four timeouts, and a caller that passed a 60 s timeout still gets
 * an answer it can act on.
 */
const RATE_LIMIT_RETRIES = 3;

/** The longest a single backoff may be, so a provider's `Retry-After: 3600` cannot turn one search into an hour. */
const RETRY_DELAY_CAP_MS = 30_000;

/** `setTimeout` as a promise, **the one effect the retry has that a test cannot observe by reading a value**. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long to wait before asking a rate-limited call again.
 *
 * **`Retry-After` is honoured when it is usable and ignored when it is not**: the header is either a number of seconds
 * or an HTTP date, providers send both, and a caller that parsed only the first would wait for a parsed `NaN` - which
 * `setTimeout` treats as zero, turning a courtesy into a hammer.
 */
export function rateLimitDelayMs(error: LLMRateLimitError, attempt: number): number {
  const header = error.retryAfter;
  if (header !== undefined && header.trim() !== '') {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RETRY_DELAY_CAP_MS);
    }
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), RETRY_DELAY_CAP_MS));
  }
  // **Exponential from one second**, which is the interval a single client is expected to back off by.
  return Math.min(1000 * 2 ** attempt, RETRY_DELAY_CAP_MS);
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
  let cost: RerankCost;
  let rateLimitRetries = 0;
  const prompt = rerankPrompt(question, candidates.map(toCandidate));
  try {
    /**
     * **A rate limit is retried, and every other failure is not.**
     *
     * `DeepSeekProvider` deliberately does not retry a 429: the provider's job is to say what the service said, and the
     * caller's is to decide what that means. **For a reranker it means "ask again", not "the fused order is my
     * answer"** - the second reading is indistinguishable from a model that had no opinion, so a run that was throttled
     * would publish a reranker's contribution as zero. It became load-bearing when the ladder was given a queue: three
     * thousand completions at one in flight never saw the limit, and eight in flight will.
     */
    for (;;) {
      try {
        const completion = await provider.complete(prompt, {
          // **Derived from the pool, not declared**: see `answerBudget`.
          maxTokens: options.maxTokens ?? answerBudget(candidates.length),
          temperature: 0,
          // **One tag for the whole ranker**, so the ledger can say whether ordering the answer costs more than answering
          // it - a question this product could not ask before, and the one that decides whether the reranker ships on.
          tag: 'search:rerank',
          ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
        });
        answer = completion.content;
        // **The bill, carried out of the call rather than estimated outside it.** `costUsd` is absent for a model the price
        // table does not know, and it stays absent: a measured zero and an unknown price are different facts.
        cost = {
          model: completion.model,
          ...(completion.usage ? { usage: completion.usage } : {}),
          ...(completion.costUsd === undefined ? {} : { usd: completion.costUsd }),
        };
        break;
      } catch (error) {
        if (error instanceof LLMRateLimitError && rateLimitRetries < RATE_LIMIT_RETRIES) {
          rateLimitRetries += 1;
          await sleep(rateLimitDelayMs(error, rateLimitRetries - 1));
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    // **A rerank that fails must not fail the search**: the fused order is a valid answer, and the caller keeps it.
    return {
      ordered: candidates,
      applied: false,
      reason: `rerank failed: ${describeFailure(error)}`,
      ...(rateLimitRetries > 0 ? { rateLimitRetries } : {}),
    };
  }

  // **Carried out of the loop on every path that made a call**, because a reader comparing a fast run with a slow one
  // needs to know whether the fast one was answered or waited out - and the successful path is the one where `reason`
  // cannot say it.
  const retried = rateLimitRetries > 0 ? { rateLimitRetries } : {};

  const order = parseRerankAnswer(answer, candidates.length);
  if (order.length === 0) {
    return {
      ordered: candidates,
      applied: false,
      reason: 'the answer contained no usable candidate number',
      answer,
      // **A call that was billed and answered nothing is still a bill**, and a ledger that dropped it would report the
      // cheapest arm as the one whose prompts the model ignored.
      cost,
      ...retried,
    };
  }
  const ordered = applyOrder(candidates, order);
  const applied = ordered.some((candidate, index) => candidate.rank !== candidates[index]!.rank);
  return {
    ordered,
    applied,
    ...(applied ? {} : { reason: 'the answer kept the fused order' }),
    answer,
    cost,
    ...retried,
  };
}
