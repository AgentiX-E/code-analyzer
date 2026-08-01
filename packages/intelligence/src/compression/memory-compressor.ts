// @code-analyzer/intelligence — Memory Compressor
// Three-zone message compression for context window management.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  /** Soft threshold — begin compression when usage exceeds this ratio (default: 0.60) */
  softThreshold: number;
  /** Hard threshold — urgent compression when usage exceeds this ratio (default: 0.80) */
  hardThreshold: number;
  /** Number of messages in the frozen zone at the start (default: 2) */
  frozenZoneSize: number;
  /** Number of complete conversation turns to keep active (default: 4) */
  activeTurns: number;
  /** Model context window in tokens (default: 128000) */
  maxTokens: number;
}

const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  softThreshold: 0.60,
  hardThreshold: 0.80,
  frozenZoneSize: 2,
  activeTurns: 4,
  maxTokens: 128000,
};

// ---------------------------------------------------------------------------
// Token Counting
// ---------------------------------------------------------------------------

/**
 * Approximate token count for a string.
 * Uses the heuristic: 1 token ≈ 4 characters for English text.
 * This is a fast approximation — actual token counts depend on the tokenizer.
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // A very rough heuristic: ~4 characters per token
  // Whitespace and special chars count less but this is a good average
  const charCount = text.length;
  return Math.ceil(charCount / 4);
}

// ---------------------------------------------------------------------------
// Message Summarization
// ---------------------------------------------------------------------------

interface CompressibleMessage {
  content: string;
}

/**
 * Generate a compressed summary of a set of messages.
 * When no LLM is available, we produce a structural summary based on
 * message patterns and key information density.
 */
function summarizeMessages<T extends CompressibleMessage>(
  messages: T[],
  maxSummaryTokens: number,
): string {
  if (messages.length === 0) return '';

  // Collect key elements from messages
  const parts: string[] = [];
  parts.push(`[Compressed: ${messages.length} messages]`);

  // Extract patterns: code blocks, key terms, structural markers
  const codeBlockCount = messages.filter(
    (m) => m.content.includes('```'),
  ).length;
  const keyIndicators: string[] = [];

  for (const msg of messages) {
    const content = msg.content.slice(0, 200);

    // Extract key phrases
    if (content.includes('function') || content.includes('class') || content.includes('interface')) {
      const funcMatch = content.match(/(?:function|class|interface)\s+(\w+)/);
      if (funcMatch) {
        keyIndicators.push(funcMatch[0]);
      }
    }

    if (content.includes('const') || content.includes('let') || content.includes('var')) {
      const varMatch = content.match(/(?:const|let|var)\s+(\w+)\s*[=:]/);
      if (varMatch) {
        keyIndicators.push(varMatch[0]);
      }
    }
  }

  if (codeBlockCount > 0) {
    parts.push(`Includes ${codeBlockCount} code blocks.`);
  }

  if (keyIndicators.length > 0) {
    const unique = [...new Set(keyIndicators)].slice(0, 10);
    parts.push(`Key symbols: ${unique.join(', ')}.`);
  }

  // Truncate summary to max tokens
  let summary = parts.join(' ');
  const summaryTokens = countTokens(summary);

  if (summaryTokens > maxSummaryTokens) {
    summary = summary.slice(0, maxSummaryTokens * 4) + '...';
  }

  return summary;
}

// ---------------------------------------------------------------------------
// User/Assistant Turn Detection
// ---------------------------------------------------------------------------

/**
 * Detect role from message content prefix patterns.
 * Returns 'user', 'assistant', or 'unknown'.
 */
function detectRole(message: CompressibleMessage): 'user' | 'assistant' | 'unknown' {
  const content = message.content;

  // Common patterns to identify roles
  if (content.startsWith('Human:') || content.startsWith('User:') ||
      content.startsWith('<user>') || content.startsWith('Q:')) {
    return 'user';
  }

  if (content.startsWith('Assistant:') || content.startsWith('AI:') ||
      content.startsWith('<assistant>') || content.startsWith('A:') ||
      content.startsWith('Bot:')) {
    return 'assistant';
  }

  // Role-less messages: alternate based on position heuristic
  return 'unknown';
}

/**
 * Group messages into conversation turns.
 * A turn is a user message followed by assistant response(s).
 */
function groupIntoTurns<T extends CompressibleMessage>(
  messages: T[],
): Array<{ user: T; assistant: T[] }> {
  const turns: Array<{ user: T; assistant: T[] }> = [];
  let currentTurn: { user: T; assistant: T[] } | null = null;

  for (const message of messages) {
    const role = detectRole(message);

    if (role === 'user' || (role === 'unknown' && !currentTurn)) {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = { user: message, assistant: [] };
    } else if (role === 'assistant' || (role === 'unknown' && currentTurn)) {
      if (currentTurn) {
        currentTurn.assistant.push(message);
      }
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Memory Compressor
// ---------------------------------------------------------------------------

export class MemoryCompressor {
  private readonly config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  }

  /**
   * Three-zone compression:
   * [0:frozenZoneSize] — Frozen (always preserved)
   * [frozenZoneSize:compressEnd] — Compressed (summarized)
   * [compressEnd:] — Active (last K turns, verbatim)
   */
  compress<T extends CompressibleMessage>(
    messages: T[],
    _currentTokens: number,
  ): T[] {
    const { frozenZoneSize, activeTurns, maxTokens } = this.config;

    if (messages.length <= frozenZoneSize + activeTurns) {
      return messages;
    }

    // Group into turns for active zone preservation
    const turns = groupIntoTurns(messages);

    // Calculate frozen zone messages
    const frozenMessages = messages.slice(0, frozenZoneSize);

    // Calculate active zone messages: last `activeTurns` turns
    const activeTurnCount = Math.min(activeTurns, turns.length);
    const activeTurnStart = turns.length - activeTurnCount;
    const activeTurnsMessages = turns.slice(activeTurnStart);

    // Convert active turns back to flat message list
    const activeMessages: T[] = [];
    for (const turn of activeTurnsMessages) {
      activeMessages.push(turn.user);
      for (const a of turn.assistant) {
        activeMessages.push(a);
      }
    }

    // Calculate which messages are in the compressible zone
    const frozenEnd = frozenZoneSize;
    const activeStart = messages.length - activeMessages.length;

    if (activeStart <= frozenEnd) {
      // No room for compression — overlap, just return as-is
      return messages;
    }

    const compressibleMessages = messages.slice(frozenEnd, activeStart);

    // Estimate available tokens for the summary
    const frozenTokens = frozenMessages.reduce(
      (sum, m) => sum + countTokens(m.content), 0,
    );
    const activeTokens = activeMessages.reduce(
      (sum, m) => sum + countTokens(m.content), 0,
    );
    const availableSummaryTokens = Math.max(
      100,
      maxTokens - frozenTokens - activeTokens - 200, // 200 token buffer
    );

    // Summarize compressed zone
    const summary = summarizeMessages(
      compressibleMessages,
      Math.floor(availableSummaryTokens),
    );

    // Build compressed result
    const compressed: T[] = [
      ...frozenMessages,
      // Insert summary as a compressed message
      // Cast to match T since we need content property
      { content: `[Summarized context: ${summary}]` } as unknown as T,
      ...activeMessages,
    ];

    return compressed;
  }

  /**
   * Count approximate tokens in a string.
   */
  countTokens(text: string): number {
    return countTokens(text);
  }

  /**
   * Check if compression is needed based on token usage ratio.
   */
  needsCompression(
    currentTokens: number,
    maxTokens: number,
  ): { needed: boolean; urgent: boolean } {
    const ratio = currentTokens / maxTokens;

    return {
      needed: ratio >= this.config.softThreshold,
      urgent: ratio >= this.config.hardThreshold,
    };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<CompressionConfig> {
    return { ...this.config };
  }

  /**
   * Estimate total tokens in an array of messages.
   */
  countMessageTokens<T extends CompressibleMessage>(messages: T[]): number {
    return messages.reduce((sum, msg) => sum + countTokens(msg.content), 0);
  }
}
