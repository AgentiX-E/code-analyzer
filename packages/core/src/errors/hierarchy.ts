import { ERROR_CATEGORIES } from '@code-analyzer/shared';

import type { ErrorCategory } from '@code-analyzer/shared';

/**
 * Base error class for all Code Analyzer errors.
 * Supports JSON serialization for MCP transport and structured context.
 */
export class CodeAnalyzerError extends Error {
  /** Unique error code following the pattern CA_{CATEGORY}_{CODE}. */
  readonly code: string;

  /** Error category for classification. */
  readonly category: ErrorCategory;

  /** Timestamp of error creation. */
  readonly timestamp: string;

  /** Additional structured context. */
  readonly context: Record<string, unknown>;

  constructor(
    category: ErrorCategory,
    codeSuffix: string,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.code = `CA_${category}_${codeSuffix}`;
    this.timestamp = new Date().toISOString();
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Serialize the error to a JSON-compatible object for MCP transport.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Deserialize a JSON object back into a CodeAnalyzerError.
   */
  static fromJSON(data: Record<string, unknown>): CodeAnalyzerError {
    const name = typeof data['name'] === 'string' ? data['name'] : '';
    const code = typeof data['code'] === 'string' ? data['code'] : '';
    const category = ERROR_CATEGORIES.includes(data['category'] as ErrorCategory)
      ? (data['category'] as ErrorCategory)
      : 'INTERNAL';
    const message = typeof data['message'] === 'string' ? data['message'] : 'Unknown error';
    const context = isRecord(data['context']) ? data['context'] : {};
    const stack = typeof data['stack'] === 'string' ? data['stack'] : undefined;
    const timestamp =
      typeof data['timestamp'] === 'string' ? data['timestamp'] : new Date().toISOString();

    // Try to match a specific error type name
    const ErrorCtor = ERROR_REGISTRY[name];
    const ctor = ErrorCtor ?? CodeAnalyzerError;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const err: CodeAnalyzerError = Object.create(ctor.prototype) as CodeAnalyzerError;

     
    const mutable = err as unknown as {
      code: string;
      category: ErrorCategory;
      message: string;
      timestamp: string;
      context: Record<string, unknown>;
      stack: string | undefined;
    };
    mutable.code = code || `CA_${category}_UNKNOWN`;
    mutable.category = category;
    mutable.message = message;
    mutable.timestamp = timestamp;
    mutable.context = context;
    if (stack) {
      mutable.stack = stack;
    }

    return err;
  }
}

/**
 * Configuration-related errors.
 * Error code pattern: CA_CONFIG_*
 */
export class ConfigError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('CONFIG', 'ERROR', message, context);
  }
}

/**
 * I/O related errors.
 * Error code pattern: CA_IO_*
 */
export class IOError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('IO', 'ERROR', message, context);
  }
}

/**
 * Parsing errors.
 * Error code pattern: CA_PARSE_*
 */
export class ParseError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('PARSE', 'ERROR', message, context);
  }
}

/**
 * Resolution errors.
 * Error code pattern: CA_RESOLVE_*
 */
export class ResolutionError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('RESOLVE', 'ERROR', message, context);
  }
}

/**
 * Graph integrity errors.
 * Error code pattern: CA_GRAPH_*
 */
export class GraphIntegrityError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('GRAPH', 'ERROR', message, context);
  }
}

/**
 * Embedding-related errors.
 * Error code pattern: CA_EMBED_*
 */
export class EmbeddingError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('EMBED', 'ERROR', message, context);
  }
}

/**
 * LLM provider errors.
 * Error code pattern: CA_LLM_*
 */
export class LLMProviderError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('LLM', 'ERROR', message, context);
  }
}

/**
 * MCP protocol errors.
 * Error code pattern: CA_MCP_*
 */
export class MCPProtocolError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('MCP', 'ERROR', message, context);
  }
}

/**
 * Rate limit errors.
 * Error code pattern: CA_RATE_LIMIT_*
 */
export class RateLimitError extends CodeAnalyzerError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('RATE_LIMIT', 'ERROR', message, context);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Registry mapping error class names to their constructors for deserialization. */
const ERROR_REGISTRY: Record<string, new (...args: never[]) => CodeAnalyzerError> = {
  ConfigError,
  IOError,
  ParseError,
  ResolutionError,
  GraphIntegrityError,
  EmbeddingError,
  LLMProviderError,
  MCPProtocolError,
  RateLimitError,
  CodeAnalyzerError,
};
