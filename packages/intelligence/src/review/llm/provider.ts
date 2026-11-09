// @code-analyzer/intelligence — LLM Provider Abstraction Layer
// Defines the LLMProvider interface and provides a DeepSeek-backed implementation.

import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import { CostBudget, CostLedger, costUsdOf, type LLMTokenUsage } from './cost.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for controlling LLM completion behavior. */
export interface CompletionOptions {
  /** Maximum tokens to generate in the response. */
  maxTokens?: number;
  /** Sampling temperature (0-2). Lower = more deterministic. */
  temperature?: number;
  /** Nucleus sampling probability. */
  topP?: number;
  /** Stop sequences that halt generation. */
  stop?: string[];
  /** Timeout in milliseconds for the HTTP request. Defaults to 120000. */
  timeout?: number;
  /**
   * **What this call is for, in the caller's own words** - `review:security`, `judge`, `rerank`.
   *
   * **The ledger groups by it**, so **this field is the whole difference between a bill that says how much a run cost
   * and a bill that says which part of the run cost it.** A call without one is recorded as `untagged` rather than
   * dropped, because **an unattributed call is still a call someone paid for.**
   */
  tag?: string;
}

/** The structured result of an LLM completion call. */
export interface CompletionResult {
  /** The generated text content. */
  content: string;
  /** The model used for this completion. */
  model: string;
  /**
   * Token usage statistics, **with the cache split the vendor reports**, so a caller can price the call.
   *
   * The shape is `LLMTokenUsage` rather than a second interface with the same three fields: **two declarations of one
   * bill is how a figure and its source drift**, and `costUsdOf` takes exactly this type.
   */
  usage?: LLMTokenUsage;
  /** ISO timestamp of when the completion was created. */
  createdAt: string;
  /** Reason the completion stopped (stop, length, etc.). */
  finishReason: string;
  /**
   * **What this completion cost in USD, when the model is one the price table knows.**
   *
   * **`undefined` and not `0` for an unknown model**, because **a zero is absorbed silently by any total** and a bill
   * that reports an unpriced model as free is worse than one that reports it as unknown. The ledger counts those
   * separately; this field is the same fact for a caller that reads one completion at a time.
   */
  costUsd?: number;
  /**
   * The tools the model asked to call, when it asked for any.
   *
   * **The calls were rendered into `content` and nowhere else** - `read_file({\"path\":\"a.ts\"})` as a line of prose -
   * so a caller that wanted the name and the arguments had to parse a string the provider had just formatted. Both
   * are here: `content` keeps the rendering for a prompt that wants text, and this keeps the call.
   */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

/** Definition of a tool/function the LLM can invoke. */
export interface ToolDefinition {
  /** The name of the tool. */
  name: string;
  /** Human-readable description of the tool's purpose. */
  description: string;
  /** JSON Schema describing the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** Unified interface for all LLM provider backends. */
export interface LLMProvider {
  /** Human-readable name of the provider (e.g. "DeepSeek"). */
  readonly name: string;
  /** Model identifier used for completions. */
  readonly model: string;

  /**
   * Send a completion request to the LLM.
   * @param prompt - The prompt text to send.
   * @param options - Optional completion parameters.
   * @returns The completion result.
   */
  complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;

  /**
   * Send a completion request with tool/function definitions.
   * @param prompt - The prompt text to send.
   * @param tools - Tool definitions the model can invoke.
   * @param options - Optional completion parameters.
   * @returns The completion result (may include tool calls in the content).
   */
  completeWithTools(
    prompt: string,
    tools: ToolDefinition[],
    options?: CompletionOptions,
  ): Promise<CompletionResult>;

  /**
   * Health check that verifies the provider is reachable and authenticated.
   * @returns true if the health check succeeded.
   */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Typed Errors
// ---------------------------------------------------------------------------

/** Base error class for LLM-related failures. */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly providerName?: string,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** Error thrown when the API key is missing or invalid. */
export class LLMAuthError extends LLMError {
  constructor(providerName: string) {
    super(
      `Authentication failed for provider "${providerName}". Verify the API key is correctly set.`,
      401,
      providerName,
    );
    this.name = 'LLMAuthError';
  }
}

/** Error thrown when the request times out. */
export class LLMTimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'LLMTimeoutError';
  }
}

/** Error thrown when the provider's rate limit is exceeded. */
export class LLMRateLimitError extends LLMError {
  /** The `Retry-After` the provider sent, if it sent one. */
  public readonly retryAfter: string | undefined;

  constructor(providerName: string, retryAfter?: string) {
    super(
      `Rate limit exceeded for provider "${providerName}"${retryAfter ? `. Retry after ${retryAfter}` : ''}`,
      429,
      providerName,
    );
    this.name = 'LLMRateLimitError';
    // **The message said it and the object did not hold it.** A caller that wants to wait has to parse a message,
    // which is why the field is here.
    this.retryAfter = retryAfter;
  }
}

/**
 * The completion's timestamp, from the field the response carries or from the clock.
 *
 * **The provider's own `created` is not guaranteed** - a compatible API need not send it - and the field was read
 * unconditionally, so a response without one crashed on `toISOString()`.
 */
function createdAtOf(data: DeepSeekResponse): string {
  const created = (data as { created?: unknown }).created;
  return typeof created === 'number'
    ? new Date(created * 1000).toISOString()
    : new Date().toISOString();
}

// ---------------------------------------------------------------------------
// DeepSeek Provider
// ---------------------------------------------------------------------------

interface DeepSeekChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  type?: string;
}

interface DeepSeekTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /**
     * **The cache split, which the vendor reports and this client used to discard.**
     *
     * `prompt_cache_hit_tokens` is billed at one fiftieth of the miss price on the rows in `cost.ts`, so **a client that
     * throws it away cannot tell a run that reused a prefix from one that paid full price twice** - and cannot show
     * that a prompt reordering worked.
     */
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

/**
 * DeepSeek LLM provider using the OpenAI-compatible API.
 *
 * Reads the API key from the `DEEPSEEK_API_KEY` environment variable.
 * Never hardcode the key in source code.
 */
export class DeepSeekProvider implements LLMProvider {
  public readonly name = 'DeepSeek';
  public readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;
  private readonly maxRetries: number;
  private logger: PhaseLogger = createNoopPhaseLogger();
  /** What every completion in this process cost, when a caller asked for one. */
  private readonly ledger: CostLedger | undefined;
  /** The ceiling this provider refuses to cross, when a caller set one. */
  private readonly budget: CostBudget | undefined;
  /** The clock, injected so a price that depends on the hour can be tested at a chosen hour. */
  private readonly now: () => Date;

  constructor(options?: {
    model?: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    /**
     * **Where the cost of every call is recorded.** Optional, because a unit test of a prompt has no budget and no
     * reason to carry a ledger - and **the default is `undefined` rather than a silently created ledger**, so a caller
     * that did not ask for accounting cannot mistake an empty ledger for a run that spent nothing.
     */
    ledger?: CostLedger;
    /**
     * **USD this provider may spend before it refuses to send another call.**
     *
     * **A ceiling needs a ledger to mean anything**, so one given without the other is a configuration mistake rather
     * than a feature: it throws here, at construction, where a test can hold it, instead of at the first call, where the
     * only evidence is a spent balance.
     */
    ceilingUsd?: number;
    /** The clock. Defaults to `Date`, injected by tests that price a call at a known hour. */
    now?: () => Date;
  }) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options?.model ?? DEFAULT_MODEL;
    this.defaultTimeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES;
    this.ledger = options?.ledger;
    this.now = options?.now ?? (() => new Date());

    if (options?.ceilingUsd !== undefined) {
      if (!options.ledger) {
        throw new Error(
          'A spend ceiling was given without a ledger. A ceiling is a comparison against recorded spend, ' +
            'and there is nothing to compare against without one.',
        );
      }
      this.budget = new CostBudget(options.ceilingUsd, options.ledger);
    }

    const apiKey = process.env['DEEPSEEK_API_KEY'];
    if (!apiKey) {
      throw new LLMAuthError(this.name);
    }
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
    const messages: DeepSeekChatMessage[] = [{ role: 'user', content: prompt }];
    return this.sendRequest(messages, undefined, options);
  }

  async completeWithTools(
    prompt: string,
    tools: ToolDefinition[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const messages: DeepSeekChatMessage[] = [{ role: 'user', content: prompt }];

    const deepseekTools: DeepSeekTool[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    return this.sendRequest(messages, deepseekTools, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.sendRequest([{ role: 'user', content: 'ping' }], undefined, {
        maxTokens: 1,
        timeout: 10_000,
      });
      return result.content.length > 0;
    } catch (error) {
      // **A misconfigured key is not an unreachable provider.** Reporting both as `false` leaves an operator with a
      // boolean that cannot distinguish the two things it is asked to distinguish, so a configuration error is
      // rethrown and only reachability is answered.
      if (error instanceof LLMAuthError) throw error;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async sendRequest(
    messages: DeepSeekChatMessage[],
    tools?: DeepSeekTool[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxRetries = this.maxRetries;
    const tag = options?.tag ?? 'untagged';

    // **Initialised rather than left undefined, so no `??` is needed after the loop.** The loop either returns or

    // throws on every path it takes, and the comment that used to sit on the final throw said so: *should be

    // unreachable, but satisfy TypeScript*. Initialising it is how the compiler is satisfied without a branch.

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // **The ceiling is checked before the request is built**, so a refused call costs nothing - not the network, not
      // the tokens, not the retry budget. See `CostBudget` for why this is the only guarantee that can be exact.
      this.budget?.assertAffordable(tag);
      const startedAt = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const body: Record<string, unknown> = {
          model: this.model,
          messages: messages.map((m) => ({ ...m, type: m.type ?? 'text' })),
          max_tokens: options?.maxTokens ?? 4096,
          temperature: options?.temperature ?? 0.3,
          top_p: options?.topP ?? 1.0,
        };

        if (options?.stop && options.stop.length > 0) {
          body['stop'] = options.stop;
        }

        if (tools && tools.length > 0) {
          body['tools'] = tools;
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const status = response.status;

          if (status === 401) {
            throw new LLMAuthError(this.name);
          }
          if (status === 429) {
            const retryAfter = response.headers.get('Retry-After') ?? undefined;
            throw new LLMRateLimitError(this.name, retryAfter);
          }

          const errorText = await response.text().catch((err) => {
            this.logger.error(
              'Failed to read LLM API error response body',
              err instanceof Error ? err : new Error(String(err)),
              { phaseId: 'llm.provider' },
            );
            return 'Unknown error';
          });
          throw new LLMError(
            `DeepSeek API returned status ${status}: ${errorText.slice(0, 200)}`,
            status,
            this.name,
          );
        }

        const data = (await response.json()) as DeepSeekResponse;

        const choice = data.choices[0];
        if (!choice) {
          throw new LLMError('DeepSeek API returned empty choices array', undefined, this.name);
        }

        const content =
          choice.message.content ??
          choice.message.tool_calls
            ?.map((tc) => `${tc.function.name}(${tc.function.arguments})`)
            .join('\n') ??
          '';

        // **`data.model` rather than `this.model`, because the alias is not always what was billed.** A request sent as
        // `deepseek-chat` is answered by whichever model serves that name, and pricing the name we asked for instead of
        // the model that answered would put the wrong row's price on the bill.
        const billedModel = data.model || this.model;
        const at = this.now();
        const usage: LLMTokenUsage | undefined = data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
              // **Spread conditionally, because `undefined` means "the vendor did not report a split"** and a zero would
              // mean "the vendor reported no cache hits". The two are billed the same way here and must not read the
              // same in a report.
              ...(data.usage.prompt_cache_hit_tokens !== undefined
                ? { cacheHitTokens: data.usage.prompt_cache_hit_tokens }
                : {}),
              ...(data.usage.prompt_cache_miss_tokens !== undefined
                ? { cacheMissTokens: data.usage.prompt_cache_miss_tokens }
                : {}),
            }
          : undefined;
        const costUsd = usage ? costUsdOf(usage, billedModel, at) : null;

        this.ledger?.record({
          at: at.toISOString(),
          model: billedModel,
          tag,
          usage: usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          costUsd,
          attempt,
          outcome: 'ok',
          durationMs: Date.now() - startedAt,
        });

        return {
          content,
          toolCalls: choice.message.tool_calls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })),
          model: data.model,
          usage,
          // **`cond ? value : undefined`, not `value ?? undefined`**: an unpriced call is a fact the caller may want to
          // act on, and the `??` would have been the same expression with a reader wondering what the difference was.
          costUsd: costUsd ?? undefined,
          // **`created` is OpenAI's field and DeepSeek does not send it.** `new Date(undefined * 1000)` is
          // `new Date(NaN)`, and `toISOString()` on that throws `RangeError: Invalid time value` - so every
          // completion that succeeded crashed on the way out. Found by a test that answered with a real payload.
          createdAt: createdAtOf(data),
          finishReason: choice.finish_reason,
        };
      } catch (err: unknown) {
        let caught = err instanceof Error ? err : new Error(String(err));

        // Convert AbortError (from AbortController timeout) to LLMTimeoutError
        if (caught.name === 'AbortError') {
          caught = new LLMTimeoutError(timeout);
        }

        // **An attempt that failed is still recorded**, with no tokens and no price: **the retry count is the one figure
        // that explains a bill larger than the calls it contains**, and a ledger that only counted successes would
        // report a run of three attempts as one call.
        this.ledger?.record({
          at: this.now().toISOString(),
          model: this.model,
          tag,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          costUsd: null,
          attempt,
          outcome: 'error',
          durationMs: Date.now() - startedAt,
          error: caught.message.slice(0, 200),
        });

        // Don't retry on auth / timeout / rate-limit errors
        if (
          caught instanceof LLMAuthError ||
          caught instanceof LLMTimeoutError ||
          caught instanceof LLMRateLimitError
        ) {
          throw caught;
        }

        // On the last attempt, throw
        if (attempt === maxRetries) {
          throw caught;
        }

        // Wait with exponential backoff before retrying
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await this.sleep(delay);
      }
    }

    // The loop returns or throws on every path, so `lastError` holds the last one and needs no fallback arm.
    // **The loop cannot end without a throw, and this says so.** Every iteration either rethrows one of
    // the three errors that are not retried, or throws what it caught on the last attempt - so a
    // `lastError` carried out of the loop was a variable nothing read. A coverage report named the line;
    // reading the loop confirmed it, and the throw below is the guarantee written out.
    throw new LLMError('DeepSeek request attempts exhausted', undefined, this.name);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
