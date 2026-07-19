// @code-analyzer/intelligence — Memory Compressor Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCompressor, countTokens } from '../compression/memory-compressor.js';
import type { CompressionConfig } from '../compression/memory-compressor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestMessage {
  content: string;
}

function createMessages(count: number): TestMessage[] {
  const messages: TestMessage[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      messages.push({
        content: `User: Question number ${i}. This is a longer message with some content to make it more realistic for testing purposes.`,
      });
    } else {
      messages.push({
        content: `Assistant: Answer number ${i}. Here is a comprehensive response that includes some details and explanations about the topic at hand.`,
      });
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Token Counting Tests
// ---------------------------------------------------------------------------

describe('Token Counting', () => {
  it('should count tokens for a given string', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('a')).toBe(1);
    expect(countTokens('abcd')).toBe(1);
    expect(countTokens('abcde')).toBe(2);
    expect(countTokens('hello world')).toBe(3); // 11 chars / 4 = 3
  });

  it('should handle long strings', () => {
    const longText = 'x'.repeat(10000);
    expect(countTokens(longText)).toBe(2500);
  });

  it('should handle zero-length text', () => {
    expect(countTokens('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Memory Compressor Tests
// ---------------------------------------------------------------------------

describe('Memory Compressor', () => {
  let compressor: MemoryCompressor;

  beforeEach(() => {
    compressor = new MemoryCompressor();
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = compressor.getConfig();
      expect(config.softThreshold).toBe(0.60);
      expect(config.hardThreshold).toBe(0.80);
      expect(config.frozenZoneSize).toBe(2);
      expect(config.activeTurns).toBe(4);
      expect(config.maxTokens).toBe(128000);
    });

    it('should accept partial configuration', () => {
      const custom = new MemoryCompressor({
        frozenZoneSize: 4,
        activeTurns: 6,
      });
      const config = custom.getConfig();
      expect(config.frozenZoneSize).toBe(4);
      expect(config.activeTurns).toBe(6);
      expect(config.softThreshold).toBe(0.60); // Default
    });

    it('should accept full configuration', () => {
      const config: CompressionConfig = {
        softThreshold: 0.5,
        hardThreshold: 0.9,
        frozenZoneSize: 3,
        activeTurns: 5,
        maxTokens: 64000,
      };
      const custom = new MemoryCompressor(config);
      const cfg = custom.getConfig();
      expect(cfg.softThreshold).toBe(0.5);
      expect(cfg.hardThreshold).toBe(0.9);
      expect(cfg.frozenZoneSize).toBe(3);
      expect(cfg.activeTurns).toBe(5);
      expect(cfg.maxTokens).toBe(64000);
    });
  });

  describe('Needs Compression', () => {
    it('should not need compression when under soft threshold', () => {
      const result = compressor.needsCompression(500, 1000);
      expect(result.needed).toBe(false);
      expect(result.urgent).toBe(false);
    });

    it('should need compression when over soft threshold', () => {
      const result = compressor.needsCompression(650, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(false);
    });

    it('should need urgent compression when over hard threshold', () => {
      const result = compressor.needsCompression(850, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(true);
    });

    it('should not need urgent compression at exactly soft threshold', () => {
      const result = compressor.needsCompression(600, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(false);
    });

    it('should be urgent at hard threshold', () => {
      const result = compressor.needsCompression(800, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(true);
    });
  });

  describe('Compression Zones', () => {
    it('should preserve frozen zone messages', () => {
      const messages = createMessages(30);
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // First frozenZoneSize messages should be preserved
      expect(compressed[0]!.content).toBe(messages[0]!.content);
      expect(compressed[1]!.content).toBe(messages[1]!.content);
    });

    it('should include a summary message for compressed zone', () => {
      const messages = createMessages(50);
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // The summary should be between frozen and active zones
      const hasSummary = compressed.some(
        (m) => m.content.includes('[Compressed:') || m.content.includes('[Summarized context:'),
      );
      expect(hasSummary).toBe(true);
    });

    it('should preserve active turn messages', () => {
      const messages = createMessages(50);
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Last message should be preserved (part of active zone)
      const lastOriginal = messages[messages.length - 1]!;
      const lastCompressed = compressed[compressed.length - 1]!;
      expect(lastCompressed.content).toBe(lastOriginal.content);
    });

    it('should not compress when message count is small', () => {
      const messages = createMessages(3);
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Should be identical since count <= frozen + active
      expect(compressed.length).toBe(messages.length);
    });

    it('should reduce total message count when compressing', () => {
      const messages = createMessages(100);
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Compressed should have fewer messages
      expect(compressed.length).toBeLessThan(messages.length);
    });
  });

  describe('Token Counting on Messages', () => {
    it('should count tokens across all messages', () => {
      const messages = [
        { content: 'hello' },
        { content: 'world' },
      ];

      const tokens = compressor.countMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty message array', () => {
      const tokens = compressor.countMessageTokens([]);
      expect(tokens).toBe(0);
    });
  });
});
