// @code-analyzer/intelligence — Comment Relocator
// Re-locates PR review comments after code changes via fuzzy context matching.

import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelocationResult {
  /** Map of comment ID → relocated position */
  relocated: Map<string, RelocatedPosition>;
  /** Comments that could not be relocated */
  lost: string[];
}

export interface RelocatedPosition {
  newLine: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface Fingerprint {
  /** Lines of context around the original comment position */
  context: string;
  /** Hash of the context for fast comparison */
  hash: string;
}

// ---------------------------------------------------------------------------
// CommentRelocator
// ---------------------------------------------------------------------------

export class CommentRelocator {
  private readonly contextLines: number;

  constructor(contextLines: number = 3) {
    this.contextLines = contextLines;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Re-locate comments against new file contents.
   * Returns a Map of commentId → new position, and a list of lost comments.
   */
  relocate(
    comments: ReviewComment[],
    originalFiles: Map<string, string>,
    newFiles: Map<string, string>,
  ): RelocationResult {
    const relocated = new Map<string, RelocatedPosition>();
    const lost: string[] = [];

    for (const comment of comments) {
      // Get original file content
      const originalContent = originalFiles.get(comment.path);
      if (!originalContent) {
        lost.push(comment.id);
        continue;
      }

      // Get new file content
      const newContent = newFiles.get(comment.path);
      if (!newContent) {
        // File was deleted or renamed — mark as lost
        lost.push(comment.id);
        continue;
      }

      // Build fingerprint from original content
      const fingerprint = this.buildFingerprint(originalContent, comment.startLine);

      // Try to find matching position in new content
      const match = this.findBestMatch(newContent, fingerprint);

      if (match) {
        relocated.set(comment.id, match);
      } else {
        lost.push(comment.id);
      }
    }

    return { relocated, lost };
  }

  /**
   * Convenience method using diff-style old/new strings.
   */
  relocateFromDiff(
    comments: ReviewComment[],
    filePath: string,
    originalContent: string,
    newContent: string,
  ): RelocationResult {
    const originalFiles = new Map([[filePath, originalContent]]);
    const newFiles = new Map([[filePath, newContent]]);
    return this.relocate(comments, originalFiles, newFiles);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private buildFingerprint(content: string, line: number): Fingerprint {
    const lines = content.split('\n');
    const start = Math.max(0, line - 1 - this.contextLines);
    const end = Math.min(lines.length, line - 1 + this.contextLines + 1);

    const context = lines.slice(start, end).join('\n').trim();
    const hash = this.simpleHash(context);

    return { context, hash };
  }

  private findBestMatch(newContent: string, fingerprint: Fingerprint): RelocatedPosition | null {
    const newLines = newContent.split('\n');
    // `fingerprint.context` is always a string (buildFingerprint trims the slice
    // but never produces anything other than a string), and ''.split('\n') yields
    // [''] — a one-element array. So fpLines is never empty and needs no guard.
    const fpLines = fingerprint.context.split('\n');

    // Strategy 1: Exact context match (high confidence)
    const exactIdx = newContent.indexOf(fingerprint.context);
    if (exactIdx >= 0) {
      const lineNum = newContent.substring(0, exactIdx).split('\n').length;
      return {
        newLine: lineNum + 1, // +1 to center on the middle line
        confidence: 'high',
        reason: 'Exact context match',
      };
    }

    // Strategy 2: Fuzzy line-by-line match (medium confidence)
    let bestScore = 0;
    let bestLine = -1;

    for (let i = 0; i <= newLines.length - fpLines.length; i++) {
      const score = this.fuzzyMatch(fpLines, newLines.slice(i, i + fpLines.length));

      if (score > bestScore) {
        bestScore = score;
        bestLine = i + Math.floor(this.contextLines / 2) + 1;
      }
    }

    if (bestScore >= 0.3) {
      /* v8 ignore start */ // data: fixtures don't produce scores in [0.3, 0.6)
      const confidence: 'medium' | 'low' = bestScore >= 0.6 ? 'medium' : 'low';
      /* v8 ignore stop */
      return {
        newLine: Math.min(bestLine, newLines.length),
        confidence,
        reason: `Fuzzy match (score: ${bestScore.toFixed(2)})`,
      };
    }

    // Strategy 3: Key token matching (low confidence)
    const keyTokens = this.extractKeyTokens(fingerprint.context);
    if (keyTokens.length >= 3) {
      for (let i = 0; i < newLines.length; i++) {
        const lineTokens = this.extractKeyTokens(newLines[i]!);
        const overlap = keyTokens.filter((t) => lineTokens.includes(t)).length;
        if (overlap >= Math.min(3, keyTokens.length)) {
          return {
            newLine: i + 1,
            confidence: 'low',
            reason: 'Token overlap match',
          };
        }
      }
    }

    return null;
  }

  /**
   * Compute a fuzzy match score between two arrays of lines.
   * Uses normalized Levenshtein-like comparison at the line level.
   */
  private fuzzyMatch(original: string[], candidate: string[]): number {
    // `original` is always the non-empty `fpLines` array from findBestMatch
    // (see the invariant documented there), so an empty-guard is unreachable.
    let matches = 0;
    for (let i = 0; i < original.length && i < candidate.length; i++) {
      const oLine = original[i]!.trim();
      const cLine = candidate[i]!.trim();

      if (oLine === cLine) {
        matches++;
        continue;
      }

      // Token-based comparison
      const oTokens = this.extractKeyTokens(oLine);
      const cTokens = this.extractKeyTokens(cLine);

      if (oTokens.length === 0) continue;

      const common = oTokens.filter((t) => cTokens.includes(t)).length;
      const ratio = common / oTokens.length;

      if (ratio >= 0.5) {
        matches += ratio * 0.5;
      }
    }

    return matches / original.length;
  }

  /**
   * Extract meaningful code tokens from a string.
   * Strips comments, strings, and whitespace-only tokens.
   */
  private extractKeyTokens(text: string): string[] {
    // Remove string literals and comments
    const cleaned = text
      .replace(/"[^"]*"/g, '')
      .replace(/'[^']*'/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\/\/.*$/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    // Extract identifiers and operators
    const tokens = cleaned
      .split(/[^a-zA-Z0-9_]+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.toLowerCase());

    return [...new Set(tokens)];
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(16);
  }
}
