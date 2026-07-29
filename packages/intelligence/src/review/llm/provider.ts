// @code-analyzer/intelligence — LLM Provider Abstraction Layer
// Defines the LLMProvider interface and provides a DeepSeek-backed implementation.

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
}

/** The structured result of an LLM completion call. */
export interface CompletionResult {
  /** The generated text content. */
  content: string;
  /** The model used for this completion. */
  model: string;
  /** Token usage statistics. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** ISO timestamp of when the completion was created. */
  createdAt: string;
  /** Reason the completion stopped (stop, length, etc.). */
  finishReason: string;
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
  constructor(providerName: string, retryAfter?: string) {
    super(
      `Rate limit exceeded for provider "${providerName}"${retryAfter ? `. Retry after ${retryAfter}` : ''}`,
      429,
      providerName,
    );
    this.name = 'LLMRateLimitError';
  }
}

// ---------------------------------------------------------------------------
// DeepSeek Provider
// ---------------------------------------------------------------------------

interface DeepSeekChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

  constructor(
    options?: {
      model?: string;
      baseUrl?: string;
      timeout?: number;
      maxRetries?: number;
    },
  ) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options?.model ?? DEFAULT_MODEL;
    this.defaultTimeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES;

    const apiKey = process.env['DEEPSEEK_API_KEY'];
    if (!apiKey) {
      throw new LLMAuthError(this.name);
    }
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async complete(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const messages: DeepSeekChatMessage[] = [
      { role: 'user', content: prompt },
    ];
    return this.sendRequest(messages, undefined, options);
  }

  async completeWithTools(
    prompt: string,
    tools: ToolDefinition[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const messages: DeepSeekChatMessage[] = [
      { role: 'user', content: prompt },
    ];

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
      const result = await this.sendRequest(
        [{ role: 'user', content: 'ping' }],
        undefined,
        { maxTokens: 1, timeout: 10_000 },
      );
      return result.content.length > 0;
    } catch {
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

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const body: Record<string, unknown> = {
          model: this.model,
          messages,
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

          const errorText = await response.text().catch(() => 'Unknown error');
          throw new LLMError(
            `DeepSeek API returned status ${status}: ${errorText.slice(0, 200)}`,
            status,
            this.name,
          );
        }

        const data = (await response.json()) as DeepSeekResponse;

        const choice = data.choices[0];
        if (!choice) {
          throw new LLMError(
            'DeepSeek API returned empty choices array',
            undefined,
            this.name,
          );
        }

        const content =
          choice.message.content ??
          choice.message.tool_calls
            ?.map((tc) => `${tc.function.name}(${tc.function.arguments})`)
            .join('\n') ??
          '';

        return {
          content,
          model: data.model,
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
          createdAt: new Date(data.created * 1000).toISOString(),
          finishReason: choice.finish_reason,
        };
      } catch (err: unknown) {
        let caught = err instanceof Error ? err : new Error(String(err));

        // Convert AbortError (from AbortController timeout) to LLMTimeoutError
        if (caught.name === 'AbortError') {
          caught = new LLMTimeoutError(timeout);
        }

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

        lastError = caught;

        // Wait with exponential backoff before retrying
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await this.sleep(delay);
      }
    }

    // Should be unreachable due to logic above, but satisfy TypeScript
    throw lastError ?? new LLMError('Unknown error', undefined, this.name);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
