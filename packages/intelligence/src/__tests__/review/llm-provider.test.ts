// @code-analyzer/intelligence — LLM Provider Tests
// Tests for DeepSeekProvider: API integration, retry logic, error handling, timeouts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeepSeekProvider,
  LLMError,
  LLMAuthError,
  LLMTimeoutError,
  LLMRateLimitError,
} from '../../review/llm/provider.js';
import type { LLMProvider } from '../../review/llm/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFetch(
  responseFactory: () => Response | Promise<Response>,
): typeof globalThis.fetch {
  return vi.fn().mockImplementation(async () => {
    const response = responseFactory();
    // Support both sync and async factories
    return response instanceof Promise ? response : response;
  }) as unknown as typeof globalThis.fetch;
}

function successResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'cmpl-123',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function toolCallResponse(toolName: string, args: string): Response {
  return new Response(
    JSON.stringify({
      id: 'cmpl-456',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: args },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function emptyChoicesResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'cmpl-789',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deepseek-chat',
      choices: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, body?: string): Response {
  return new Response(
    body ?? JSON.stringify({ error: { message: 'Test error' } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// Environment Setup
// ---------------------------------------------------------------------------

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  // Set a test API key for all tests
  process.env['DEEPSEEK_API_KEY'] = 'test-api-key-for-unit-tests';
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Constructor Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — Constructor', () => {
  it('should create a provider with default settings', () => {
    const provider = new DeepSeekProvider();
    expect(provider.name).toBe('DeepSeek');
    expect(provider.model).toBe('deepseek-chat');
  });

  it('should create a provider with custom model', () => {
    const provider = new DeepSeekProvider({ model: 'deepseek-coder' });
    expect(provider.model).toBe('deepseek-coder');
  });

  it('should create a provider with custom base URL', () => {
    const provider = new DeepSeekProvider({ baseUrl: 'https://custom.api.com/v1' });
    expect(provider.name).toBe('DeepSeek');
  });

  it('should create a provider with custom timeout', () => {
    const provider = new DeepSeekProvider({ timeout: 30000 });
    expect(provider).toBeDefined();
  });

  it('should throw LLMAuthError when API key is missing', () => {
    delete process.env['DEEPSEEK_API_KEY'];
    expect(() => new DeepSeekProvider()).toThrow(LLMAuthError);
  });

  it('should throw LLMAuthError when API key is empty', () => {
    process.env['DEEPSEEK_API_KEY'] = '';
    expect(() => new DeepSeekProvider()).toThrow(LLMAuthError);
  });
});

// ---------------------------------------------------------------------------
// Completion Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — complete()', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // maxRetries: 0 for fast tests — retry logic is tested separately
    provider = new DeepSeekProvider({ maxRetries: 0 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should make a completion request and parse the response', async () => {
    const mockFetch = createMockFetch(() => successResponse('Hello, world!'));
    globalThis.fetch = mockFetch;

    const result = await provider.complete('Say hello');

    expect(result.content).toBe('Hello, world!');
    expect(result.model).toBe('deepseek-chat');
    expect(result.usage).toBeDefined();
    expect(result.usage!.promptTokens).toBe(50);
    expect(result.usage!.completionTokens).toBe(30);
    expect(result.usage!.totalTokens).toBe(80);
    expect(result.finishReason).toBe('stop');
    expect(result.createdAt).toBeTruthy();

    // Verify the fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = (mockFetch as any).mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('/chat/completions');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers).toBeDefined();
  });

  it('should pass completion options to the API', async () => {
    const mockFetch = createMockFetch(() => successResponse('ok'));
    globalThis.fetch = mockFetch;

    await provider.complete('test', {
      maxTokens: 100,
      temperature: 0.5,
      topP: 0.9,
      stop: ['END'],
    });

    const callArgs = (mockFetch as any).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body.stop).toEqual(['END']);
  });

  it('should handle API 401 error as LLMAuthError', async () => {
    const mockFetch = createMockFetch(() => errorResponse(401));
    globalThis.fetch = mockFetch;

    await expect(provider.complete('test')).rejects.toThrow(LLMAuthError);
  });

  it('should handle API 429 error as LLMRateLimitError', async () => {
    const mockFetch = createMockFetch(() => errorResponse(429));
    globalThis.fetch = mockFetch;

    await expect(provider.complete('test')).rejects.toThrow(LLMRateLimitError);
  });

  it('should handle generic API errors with LLMError', async () => {
    const mockFetch = createMockFetch(() => errorResponse(500));
    vi.stubGlobal('fetch', mockFetch);

    await expect(provider.complete('test')).rejects.toThrow(LLMError);
    try {
      await provider.complete('test');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).statusCode).toBe(500);
    }
  });

  it('should handle empty choices array', async () => {
    vi.stubGlobal('fetch', createMockFetch(() => emptyChoicesResponse()));

    await expect(provider.complete('test')).rejects.toThrow(LLMError);
  });
});

// ---------------------------------------------------------------------------
// completeWithTools Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — completeWithTools()', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    provider = new DeepSeekProvider({ maxRetries: 0 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should send tool definitions to the API', async () => {
    const mockFetch = createMockFetch(() => successResponse('Called tool'));
    globalThis.fetch = mockFetch;

    await provider.completeWithTools('test', [
      { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
    ]);

    const callArgs2 = (mockFetch as any).mock.calls[0] as [string, RequestInit];
    const body2 = JSON.parse(callArgs2[1].body as string);
    expect(body2.tools).toBeDefined();
    expect(body2.tools).toHaveLength(1);
    expect(body2.tools[0].type).toBe('function');
    expect(body2.tools[0].function.name).toBe('get_weather');
  });

  it('should handle tool call response where content is null', async () => {
    const mockFetch = createMockFetch(() => toolCallResponse('get_weather', '{"city":"London"}'));
    globalThis.fetch = mockFetch;

    const result = await provider.completeWithTools('What is the weather in London?', [
      { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
    ]);

    expect(result.content).toBe('get_weather({"city":"London"})');
    expect(result.model).toBe('deepseek-chat');
  });

  it('should pass options alongside tools', async () => {
    const mockFetch = createMockFetch(() => successResponse('ok'));
    globalThis.fetch = mockFetch;

    await provider.completeWithTools('test', [
      { name: 'search', description: 'Search', parameters: {} },
    ], { temperature: 0.1, timeout: 30000 });

    const callArgs3 = (mockFetch as any).mock.calls[0] as [string, RequestInit];
    const body3 = JSON.parse(callArgs3[1].body as string);
    expect(body3.tools).toBeDefined();
    expect(body3.temperature).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// Retry Logic Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — Retry Logic', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    provider = new DeepSeekProvider({ maxRetries: 3, timeout: 120000 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should retry on server errors up to maxRetries', async () => {
    let callCount = 0;
    const mockFetch = createMockFetch(() => {
      callCount++;
      if (callCount <= 2) {
        return errorResponse(503);
      }
      return successResponse('Success after retry');
    });
    globalThis.fetch = mockFetch;

    // Override sleep to avoid real delays in test
    const sleepSpy = vi.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

    const result = await provider.complete('test');

    expect(result.content).toBe('Success after retry');
    expect(callCount).toBe(3); // 2 failures + 1 success
    expect(sleepSpy).toHaveBeenCalledTimes(2); // slept between retry 1→2 and 2→3
    sleepSpy.mockRestore();
  });

  it('should throw after max retries exhausted', async () => {
    const mockFetch = createMockFetch(() => errorResponse(500));
    globalThis.fetch = mockFetch;

    // Override sleep to skip delays
    const sleepSpy = vi.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

    await expect(provider.complete('test')).rejects.toThrow(LLMError);
    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(sleepSpy).toHaveBeenCalledTimes(3); // slept 3 times (between each retry)
    sleepSpy.mockRestore();
  });

  it('should NOT retry on auth errors', async () => {
    const mockFetch = createMockFetch(() => errorResponse(401));
    globalThis.fetch = mockFetch;

    // Override sleep to verify it's NOT called
    const sleepSpy = vi.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

    await expect(provider.complete('test')).rejects.toThrow(LLMAuthError);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    expect(sleepSpy).toHaveBeenCalledTimes(0); // No sleep — no retry
    sleepSpy.mockRestore();
  });

  it('should NOT retry on rate limit errors', async () => {
    const mockFetch = createMockFetch(() => errorResponse(429));
    globalThis.fetch = mockFetch;

    const sleepSpy = vi.spyOn(provider as any, 'sleep').mockResolvedValue(undefined);

    await expect(provider.complete('test')).rejects.toThrow(LLMRateLimitError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledTimes(0);
    sleepSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Timeout Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — Timeout', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    provider = new DeepSeekProvider({ timeout: 500, maxRetries: 0 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should throw LLMTimeoutError when request is aborted', async () => {
    // Simulate an AbortError from fetch (as would happen with AbortController timeout)
    const mockFetch = createMockFetch(() => {
      return new Promise((_, reject) => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
    globalThis.fetch = mockFetch;

    await expect(provider.complete('test')).rejects.toThrow(LLMTimeoutError);
  });

  it('should handle timeout with AbortController signal abort', async () => {
    // Simulate AbortError coming through the signal
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    const mockFetch = vi.fn().mockRejectedValue(abortError);
    globalThis.fetch = mockFetch;

    await expect(provider.complete('test')).rejects.toThrow(LLMTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// Health Check Tests
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — healthCheck()', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    provider = new DeepSeekProvider({ maxRetries: 0 });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return true when API responds successfully', async () => {
    globalThis.fetch = createMockFetch(() => successResponse('pong'));
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  it('should return false when API returns an error', async () => {
    globalThis.fetch = createMockFetch(() => errorResponse(500));
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it('should return false when API times out', async () => {
    globalThis.fetch = createMockFetch(() => {
      return new Promise((_, reject) => {
        reject(new Error('Connection refused'));
      });
    });
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider Interface Compliance
// ---------------------------------------------------------------------------

describe('DeepSeekProvider — Interface Compliance', () => {
  it('should satisfy the LLMProvider interface', () => {
    const provider: LLMProvider = new DeepSeekProvider();
    expect(provider.name).toBe('DeepSeek');
    expect(provider.model).toBe('deepseek-chat');
    expect(typeof provider.complete).toBe('function');
    expect(typeof provider.completeWithTools).toBe('function');
    expect(typeof provider.healthCheck).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// LLMError Hierarchy Tests
// ---------------------------------------------------------------------------

describe('LLMError class hierarchy', () => {
  it('should create LLMError with default values', () => {
    const err = new LLMError('test message');
    expect(err.name).toBe('LLMError');
    expect(err.message).toBe('test message');
    expect(err.statusCode).toBeUndefined();
    expect(err.providerName).toBeUndefined();
  });

  it('should create LLMError with status code and provider name', () => {
    const err = new LLMError('server error', 500, 'DeepSeek');
    expect(err.statusCode).toBe(500);
    expect(err.providerName).toBe('DeepSeek');
  });

  it('should create LLMAuthError with correct properties', () => {
    const err = new LLMAuthError('OpenAI');
    expect(err.name).toBe('LLMAuthError');
    expect(err.statusCode).toBe(401);
    expect(err.providerName).toBe('OpenAI');
    expect(err.message).toContain('OpenAI');
  });

  it('should create LLMTimeoutError with correct properties', () => {
    const err = new LLMTimeoutError(5000);
    expect(err.name).toBe('LLMTimeoutError');
    expect(err.message).toContain('5000ms');
  });

  it('should create LLMRateLimitError with retry-after', () => {
    const err = new LLMRateLimitError('DeepSeek', '60');
    expect(err.name).toBe('LLMRateLimitError');
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('Retry after 60');
  });

  it('should create LLMRateLimitError without retry-after', () => {
    const err = new LLMRateLimitError('DeepSeek');
    expect(err.message).toContain('DeepSeek');
    expect(err.message).not.toContain('Retry after');
  });

  it('should be instanceof Error', () => {
    const authErr = new LLMAuthError('test');
    expect(authErr).toBeInstanceOf(Error);
    expect(authErr).toBeInstanceOf(LLMError);

    const timeoutErr = new LLMTimeoutError(1000);
    expect(timeoutErr).toBeInstanceOf(Error);
    expect(timeoutErr).toBeInstanceOf(LLMError);
  });
});
