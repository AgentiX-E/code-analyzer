import { describe, it, expect } from 'vitest';

import {
  CodeAnalyzerError,
  ConfigError,
  IOError,
  ParseError,
  ResolutionError,
  GraphIntegrityError,
  EmbeddingError,
  LLMProviderError,
  MCPProtocolError,
  RateLimitError,
} from '../errors/index.js';

describe('CodeAnalyzerError', () => {
  it('should create a base error with code, category, timestamp, and context', () => {
    const err = new CodeAnalyzerError('CONFIG', 'INVALID', 'invalid config', { field: 'x' });

    expect(err.code).toBe('CA_CONFIG_INVALID');
    expect(err.category).toBe('CONFIG');
    expect(err.message).toBe('invalid config');
    expect(err.context).toEqual({ field: 'x' });
    expect(err.timestamp).toBeDefined();
    expect(new Date(err.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    expect(err.name).toBe('CodeAnalyzerError');
  });

  it('should be an instance of Error', () => {
    const err = new CodeAnalyzerError('INTERNAL', 'TEST', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CodeAnalyzerError);
  });

  it('should have a stack trace', () => {
    const err = new CodeAnalyzerError('INTERNAL', 'TEST', 'test');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });

  it('should serialize to JSON for MCP transport', () => {
    const err = new CodeAnalyzerError('IO', 'READ', 'cannot read', { path: '/tmp' });
    const json = err.toJSON();

    expect(json).toHaveProperty('name', 'CodeAnalyzerError');
    expect(json).toHaveProperty('code', 'CA_IO_READ');
    expect(json).toHaveProperty('category', 'IO');
    expect(json).toHaveProperty('message', 'cannot read');
    expect(json).toHaveProperty('timestamp');
    expect(json).toHaveProperty('context');
    expect(json['context']).toEqual({ path: '/tmp' });
    expect(json).toHaveProperty('stack');
  });
});

describe('Specific error types', () => {
  it('ConfigError should have CONFIG category', () => {
    const err = new ConfigError('bad config');
    expect(err.category).toBe('CONFIG');
    expect(err.code).toBe('CA_CONFIG_ERROR');
    expect(err.message).toBe('bad config');
  });

  it('IOError should have IO category', () => {
    const err = new IOError('file not found', { path: '/x' });
    expect(err.category).toBe('IO');
    expect(err.code).toBe('CA_IO_ERROR');
    expect(err.context).toEqual({ path: '/x' });
  });

  it('ParseError should have PARSE category', () => {
    const err = new ParseError('syntax error');
    expect(err.category).toBe('PARSE');
    expect(err.code).toBe('CA_PARSE_ERROR');
  });

  it('ResolutionError should have RESOLVE category', () => {
    const err = new ResolutionError('unresolved symbol');
    expect(err.category).toBe('RESOLVE');
    expect(err.code).toBe('CA_RESOLVE_ERROR');
  });

  it('GraphIntegrityError should have GRAPH category', () => {
    const err = new GraphIntegrityError('duplicate node');
    expect(err.category).toBe('GRAPH');
    expect(err.code).toBe('CA_GRAPH_ERROR');
  });

  it('EmbeddingError should have EMBED category', () => {
    const err = new EmbeddingError('embedding failed');
    expect(err.category).toBe('EMBED');
    expect(err.code).toBe('CA_EMBED_ERROR');
  });

  it('LLMProviderError should have LLM category', () => {
    const err = new LLMProviderError('api key invalid');
    expect(err.category).toBe('LLM');
    expect(err.code).toBe('CA_LLM_ERROR');
  });

  it('MCPProtocolError should have MCP category', () => {
    const err = new MCPProtocolError('invalid request');
    expect(err.category).toBe('MCP');
    expect(err.code).toBe('CA_MCP_ERROR');
  });

  it('RateLimitError should have RATE_LIMIT category', () => {
    const err = new RateLimitError('too many requests');
    expect(err.category).toBe('RATE_LIMIT');
    expect(err.code).toBe('CA_RATE_LIMIT_ERROR');
  });
});

describe('CodeAnalyzerError.fromJSON', () => {
  it('should deserialize a basic error', () => {
    const err = new CodeAnalyzerError('INTERNAL', 'TEST', 'test error', { meta: 'data' });
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);

    expect(restored.code).toBe('CA_INTERNAL_TEST');
    expect(restored.category).toBe('INTERNAL');
    expect(restored.message).toBe('test error');
    expect(restored.context).toEqual({ meta: 'data' });
  });

  it('should restore specific error type by name', () => {
    const err = new ConfigError('bad config');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);

    expect(restored).toBeInstanceOf(ConfigError);
    expect(restored.code).toBe('CA_CONFIG_ERROR');
    expect(restored.message).toBe('bad config');
  });

  it('should restore IOError from JSON', () => {
    const err = new IOError('permission denied');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(IOError);
  });

  it('should restore ParseError from JSON', () => {
    const err = new ParseError('parse failed');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(ParseError);
  });

  it('should restore ResolutionError from JSON', () => {
    const err = new ResolutionError('unresolved');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(ResolutionError);
  });

  it('should restore GraphIntegrityError from JSON', () => {
    const err = new GraphIntegrityError('bad graph');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(GraphIntegrityError);
  });

  it('should restore EmbeddingError from JSON', () => {
    const err = new EmbeddingError('embed fail');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(EmbeddingError);
  });

  it('should restore LLMProviderError from JSON', () => {
    const err = new LLMProviderError('llm fail');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(LLMProviderError);
  });

  it('should restore MCPProtocolError from JSON', () => {
    const err = new MCPProtocolError('mcp fail');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(MCPProtocolError);
  });

  it('should restore RateLimitError from JSON', () => {
    const err = new RateLimitError('rate limited');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(RateLimitError);
  });

  it('should fallback to CodeAnalyzerError for unknown error name', () => {
    const json = {
      name: 'UnknownError',
      code: 'CA_INTERNAL_UNKNOWN',
      category: 'INTERNAL',
      message: 'something went wrong',
      timestamp: new Date().toISOString(),
      context: {},
    };
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored).toBeInstanceOf(CodeAnalyzerError);
    expect(restored.name).not.toBe('CodeAnalyzerError'); // Object.create preserves original name
    expect(restored.code).toBe('CA_INTERNAL_UNKNOWN');
  });

  it('should handle missing fields gracefully', () => {
    const restored = CodeAnalyzerError.fromJSON({});
    expect(restored.category).toBe('INTERNAL');
    expect(restored.message).toBe('Unknown error');
    expect(restored.code).toContain('CA_');
  });

  it('should preserve the stack trace in deserialized error', () => {
    const err = new CodeAnalyzerError('IO', 'READ', 'test');
    const json = err.toJSON();
    const restored = CodeAnalyzerError.fromJSON(json);
    expect(restored.stack).toBeDefined();
  });
});

describe('Error instanceof checks', () => {
  it('should pass instanceof check for parent class', () => {
    const err = new ConfigError('test');
    expect(err instanceof ConfigError).toBe(true);
    expect(err instanceof CodeAnalyzerError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('should pass instanceof for all subtypes', () => {
    const errors = [
      new IOError('x'),
      new ParseError('x'),
      new ResolutionError('x'),
      new GraphIntegrityError('x'),
      new EmbeddingError('x'),
      new LLMProviderError('x'),
      new MCPProtocolError('x'),
      new RateLimitError('x'),
    ];

    for (const err of errors) {
      expect(err instanceof CodeAnalyzerError).toBe(true);
      expect(err instanceof Error).toBe(true);
    }
  });
});
