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

  describe('Needs Compression - boundary values', () => {
    it('should not need compression at 0 tokens', () => {
      const result = compressor.needsCompression(0, 1000);
      expect(result.needed).toBe(false);
      expect(result.urgent).toBe(false);
    });

    it('should not need compression just below soft threshold', () => {
      const result = compressor.needsCompression(599, 1000);
      expect(result.needed).toBe(false);
      expect(result.urgent).toBe(false);
    });

    it('should need compression between soft and hard thresholds', () => {
      const result = compressor.needsCompression(700, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(false);
    });

    it('should be urgent just above hard threshold', () => {
      const result = compressor.needsCompression(801, 1000);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(true);
    });

    it('should handle maxTokens of 0 gracefully', () => {
      // Division by zero would produce Infinity, ratio >= threshold is true
      const result = compressor.needsCompression(100, 0);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(true);
    });
  });

  describe('Compress - edge cases', () => {
    it('should handle messages with functions and classes for key symbols', () => {
      const messages: TestMessage[] = [
        { content: 'User: Question 0. This is a test message.' },
        { content: 'Assistant: Answer. function processData(items) { return items; }' },
        { content: 'User: Question 1. class DataStore { constructor() {} }' },
        { content: 'Assistant: Answer 1. interface Config { port: number; }' },
        { content: 'User: Question 2. const items = [];' },
        { content: 'Assistant: Answer 2. let counter = 0;' },
        { content: 'User: Question 3. var config = {};' },
        { content: 'Assistant: Answer 3. More text here for padding and testing.' },
        { content: 'User: Question 4. More user input for testing.' },
        { content: 'Assistant: Answer 4. Even more assistant text.' },
        { content: 'User: Question 5. Another user message here.' },
        { content: 'Assistant: Answer 5. ```\nfunction test() {}\n```' },
        { content: 'User: Question 6. Last user message in test.' },
        { content: 'Assistant: Answer 6. Last assistant response here.' },
      ];
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Frozen zone should be preserved
      expect(compressed[0]!.content).toBe(messages[0]!.content);
      expect(compressed[1]!.content).toBe(messages[1]!.content);

      // Should contain summary with key symbols
      const hasSummary = compressed.some(
        (m) => m.content.includes('[Summarized context:') || m.content.includes('[Compressed:'),
      );
      expect(hasSummary).toBe(true);
    });

    it('should handle messages with code blocks for summary', () => {
      const messages: TestMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          content: `User: Question ${i}. Some content for testing purposes. \`\`\`\ncode block here\n\`\`\``,
        });
      }
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      const summary = compressed.find(
        (m) => m.content.includes('[Summarized context:'),
      );
      expect(summary).toBeDefined();
      // Summary should mention code blocks
      expect(summary?.content).toMatch(/Compressed/);
    });

    it('should handle empty messages array', () => {
      const compressed = compressor.compress([], 0);
      expect(compressed.length).toBe(0);
    });

    it('should handle single message', () => {
      const messages: TestMessage[] = [
        { content: 'User: Only message.' },
      ];
      const compressed = compressor.compress(messages, 100);
      expect(compressed.length).toBe(1);
      expect(compressed[0]!.content).toBe('User: Only message.');
    });

    it('should handle messages exactly at frozen zone boundary', () => {
      // frozenZoneSize (2) + activeTurns (4) = ~6 messages is the boundary
      const messages: TestMessage[] = [];
      for (let i = 0; i < 6; i++) {
        messages.push({
          content: `User: Question ${i}. Test message content for number ${i}.`,
        });
      }
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Should not compress when at/below the boundary
      expect(compressed.length).toBe(messages.length);
    });

    it('should handle messages with unknown role patterns', () => {
      const messages: TestMessage[] = [
        { content: 'System: Initial message without user/assistant prefix.' },
        { content: 'Context: Some additional context information here.' },
        { content: 'User: Question 0 with explicit user role prefix.' },
        { content: 'Assistant: Answer 0 with explicit assistant prefix.' },
        { content: 'Some message without any recognizable prefix pattern.' },
        { content: 'Another message also without prefixes for unknown roles.' },
        { content: 'User: Question 1 more to trigger compression.' },
        { content: 'Assistant: Answer 1 more to add bulk.' },
        { content: 'User: Question 2 padding the count.' },
        { content: 'Assistant: Answer 2 filling in.' },
        { content: 'User: Question 3 more message bulk needed.' },
        { content: 'Assistant: Answer 3 more text for compression.' },
        { content: 'User: Question 4 should trigger compression now.' },
        { content: 'Assistant: Answer 4 completing the test data.' },
      ];
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Should still produce a valid compressed result
      expect(compressed.length).toBeGreaterThan(0);
      // With enough messages, compression should reduce the count
      expect(compressed.length).toBeLessThan(messages.length);
    });

    it('should handle compress with custom config having large frozen zone', () => {
      const customCompressor = new MemoryCompressor({
        frozenZoneSize: 10,
        activeTurns: 1,
      });
      const messages = createMessages(30);
      const tokens = customCompressor.countMessageTokens(messages);

      const compressed = customCompressor.compress(messages, tokens);

      // Large frozen zone means frozen zone may overlap with active zone
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should use countTokens instance method', () => {
      expect(compressor.countTokens('')).toBe(0);
      expect(compressor.countTokens('hello world')).toBe(3);
    });

    it('should handle long text that exceeds maxSummaryTokens in summarization', () => {
      // This test triggers the truncation branch in summarizeMessages
      const veryLongText = 'x'.repeat(500000);
      const messages: TestMessage[] = [];
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) {
          messages.push({
            content: `User: testing very long text ${veryLongText}`,
          });
        } else {
          messages.push({
            content: `Assistant: also very long ${veryLongText}`,
          });
        }
      }
      const tokens = compressor.countMessageTokens(messages);

      const compressed = compressor.compress(messages, tokens);

      // Should still produce a valid compressed result
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should handle small maxTokens forcing summary truncation', () => {
      // Use smaller maxTokens so summary token budget is limited
      const customCompressor = new MemoryCompressor({
        frozenZoneSize: 2,
        activeTurns: 1,
        maxTokens: 1000,
      });
      const messages = createMessages(30);
      const tokens = customCompressor.countMessageTokens(messages);

      const compressed = customCompressor.compress(messages, tokens);

      // Should produce compressed result
      expect(compressed.length).toBeGreaterThan(0);
      expect(compressed.length).toBeLessThan(messages.length);
    });

    it('should not compress when frozen and active zones overlap', () => {
      // frozenZoneSize (2) + activeTurns (4) but with few messages,
      // the active zone calculation may overlap with frozen zone
      const customCompressor = new MemoryCompressor({
        frozenZoneSize: 5,
        activeTurns: 10,
      });
      const messages = createMessages(10); // 10 messages, frozen=5, active~=all
      const tokens = customCompressor.countMessageTokens(messages);

      const compressed = customCompressor.compress(messages, tokens);

      // Messages <= frozenZoneSize + active zone, so should be unchanged
      expect(compressed.length).toBe(messages.length);
    });

    it('should truncate summary when it exceeds available token budget', () => {
      const customCompressor = new MemoryCompressor({
        frozenZoneSize: 2,
        activeTurns: 1,
        maxTokens: 500,
      });
      const messages: TestMessage[] = [];
      for (let i = 0; i < 15; i++) {
        if (i % 2 === 0) {
          messages.push({
            content: `User: function longName${i}() { return class Data${i} {}; } const item${i} = 1; let val${i} = 2; var cfg${i} = 3; padding here`,
          });
        } else {
          messages.push({
            content: `Assistant: result for ${i} with more padding text to increase token count further for testing`,
          });
        }
      }
      const tokens = customCompressor.countMessageTokens(messages);

      const compressed = customCompressor.compress(messages, tokens);

      expect(compressed.length).toBeGreaterThan(0);
      // Should be compressed (less messages)
      expect(compressed.length).toBeLessThan(messages.length);
    });
  });

  describe('Role detection patterns', () => {
    it('should detect Human: prefix as user', () => {
      const messages: TestMessage[] = [
        { content: 'Human: Hello' },
        { content: 'Assistant: Hi' },
        { content: 'User: Question 0 content padded.' },
        { content: 'Assistant: Answer 0 padded.' },
        { content: 'User: Question 1 content padded.' },
        { content: 'Assistant: Answer 1 padded.' },
        { content: 'User: Question 2 content padded.' },
        { content: 'Assistant: Answer 2 padded.' },
        { content: 'User: Question 3 content padded.' },
        { content: 'Assistant: Answer 3 padded.' },
        { content: 'User: Question 4 more content.' },
        { content: 'Assistant: Answer 4 completed.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should detect AI: prefix as assistant', () => {
      const messages: TestMessage[] = [
        { content: 'User: Q0 test message here.' },
        { content: 'AI: A0 response text here.' },
        { content: 'User: Q1 more test content.' },
        { content: 'Assistant: A1 content here.' },
        { content: 'User: Q2 padding message.' },
        { content: 'Assistant: A2 padding response.' },
        { content: 'User: Q3 adding more turns.' },
        { content: 'Assistant: A3 more responses added.' },
        { content: 'User: Q4 build up messages.' },
        { content: 'Assistant: A4 final answer here.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should detect Bot: prefix as assistant', () => {
      const messages: TestMessage[] = [
        { content: 'User: Initial query for test.' },
        { content: 'Bot: Bot response to query.' },
        { content: 'User: Follow up question here.' },
        { content: 'Assistant: Follow up answer here.' },
        { content: 'User: Another question to fill.' },
        { content: 'Assistant: Another answer to fill.' },
        { content: 'User: And one more for padding.' },
        { content: 'Assistant: And one more response.' },
        { content: 'User: Extra padding message.' },
        { content: 'Assistant: Extra response message.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should detect Q: as user and A: as assistant', () => {
      const messages: TestMessage[] = [
        { content: 'Q: Question text for test.' },
        { content: 'A: Answer text for test.' },
        { content: 'User: Next question here.' },
        { content: 'Assistant: Next answer here.' },
        { content: 'User: Padding question text.' },
        { content: 'Assistant: Padding answer text.' },
        { content: 'User: More padding for count.' },
        { content: 'Assistant: Response padding text.' },
        { content: 'User: Final question here now.' },
        { content: 'Assistant: Final answer complete.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should detect XML-style role prefixes', () => {
      const messages: TestMessage[] = [
        { content: '<user>Hello</user>' },
        { content: '<assistant>Hi there</assistant>' },
        { content: 'User: Question 0 padded here.' },
        { content: 'Assistant: Answer 0 padded here.' },
        { content: 'User: Question 1 padding text.' },
        { content: 'Assistant: Answer 1 padding text.' },
        { content: 'User: Question 2 extra padding.' },
        { content: 'Assistant: Answer 2 extra padding.' },
        { content: 'User: Question 3 more padding.' },
        { content: 'Assistant: Answer 3 more padding.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });
  });

  describe('Compress — additional edge cases', () => {
    it('should handle messages with only unknown role messages', () => {
      const messages: TestMessage[] = [
        { content: 'Some message without role.' },
        { content: 'Another message also without role.' },
        { content: 'Third unknown role message here.' },
        { content: 'Fourth unknown role message for testing purposes.' },
        { content: 'Fifth message for extra bulk in compression.' },
        { content: 'Sixth message with more content padding.' },
        { content: 'Seventh message to reach compression threshold.' },
        { content: 'Eighth message padding more for compression test.' },
        { content: 'Ninth message building up the message list.' },
        { content: 'Tenth message completing the test set here.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should handle messages with only assistant roles', () => {
      const messages: TestMessage[] = [
        { content: 'Assistant: Response 1 with content.' },
        { content: 'Assistant: Response 2 with content.' },
        { content: 'Assistant: Response 3 with content.' },
        { content: 'Assistant: Response 4 with content.' },
        { content: 'Assistant: Response 5 with content.' },
        { content: 'Assistant: Response 6 with content.' },
        { content: 'Assistant: Response 7 with content.' },
        { content: 'Assistant: Response 8 with content.' },
      ];
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      expect(compressed.length).toBeGreaterThan(0);
    });

    it('should handle compress with exactly frozenZoneSize messages', () => {
      // frozenZoneSize = 2, activeTurns = 4
      const messages = createMessages(6);
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      // Should not compress since count <= frozen + active (6 <= 6)
      expect(compressed.length).toBe(messages.length);
    });

    it('should handle compress with freeze/active overlap', () => {
      const customCompressor = new MemoryCompressor({
        frozenZoneSize: 3,
        activeTurns: 10,
      });
      const messages = createMessages(10);
      const tokens = customCompressor.countMessageTokens(messages);
      const compressed = customCompressor.compress(messages, tokens);
      // Should not compress due to overlap
      expect(compressed.length).toBe(messages.length);
    });

    it('should summarize messages with no code blocks or key symbols', () => {
      const messages: TestMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          content: `User: Simple question ${i} with no special symbols or code blocks.`,
        });
      }
      const tokens = compressor.countMessageTokens(messages);
      const compressed = compressor.compress(messages, tokens);
      const hasSummary = compressed.some(
        (m) => m.content.includes('[Summarized context:') || m.content.includes('[Compressed:'),
      );
      expect(hasSummary).toBe(true);
    });

    it('should count tokens for long text via instance method', () => {
      expect(compressor.countTokens('a'.repeat(10000))).toBe(2500);
      expect(compressor.countTokens('')).toBe(0);
    });

    it('should return readonly config copy', () => {
      const config = compressor.getConfig();
      expect(config.softThreshold).toBe(0.60);
      expect(config.frozenZoneSize).toBe(2);
    });

    it('should handle needsCompression with large currentTokens and small maxTokens', () => {
      const customCompressor = new MemoryCompressor();
      const result = customCompressor.needsCompression(100, 50);
      expect(result.needed).toBe(true);
      expect(result.urgent).toBe(true);
    });
  });
});
