// @code-analyzer/vscode — Comment Decoration Provider
// Manages inline diagnostic decorations in the VS Code editor.
// Maps review comments from the engine to diagnostic objects.

import type { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Diagnostic-like types (no VS Code dependency)
// ---------------------------------------------------------------------------

export interface DiagnosticInfo {
  path: string;
  startLine: number;
  endLine: number;
  severity: string;
  message: string;
  source: string;
}

export interface DecorationRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface DecoratedDiagnostic {
  range: DecorationRange;
  message: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  source: string;
  filePath: string;
}

// ---------------------------------------------------------------------------
// CommentLogic — testable conversion logic
// ---------------------------------------------------------------------------

export class CommentLogic {
  constructor(private engine: EngineBridge) {}

  /**
   * Convert review comments from the engine into decorated diagnostics.
   */
  async getDecoratedDiagnostics(): Promise<DecoratedDiagnostic[]> {
    const comments = await this.engine.reviewWorkspace();
    return this.mapCommentsToDiagnostics(comments);
  }

  /**
   * Convert a raw comment array to decorated diagnostics.
   * Pure function — no side effects.
   */
  mapCommentsToDiagnostics(
    comments: Array<{
      severity: string;
      title: string;
      path: string;
      startLine: number;
      endLine: number;
      message: string;
    }>,
  ): DecoratedDiagnostic[] {
    return comments.map((c) => ({
      range: {
        startLine: Math.max(0, c.startLine - 1),
        startCharacter: 0,
        endLine: Math.max(0, c.endLine - 1),
        endCharacter: 0,
      },
      message: `[Code Analyzer] ${c.message}`,
      severity: this.mapSeverity(c.severity),
      source: 'Code Analyzer',
      filePath: c.path,
    }));
  }

  /**
   * Map a severity string to diagnostic severity.
   */
  mapSeverity(severity: string): 'error' | 'warning' | 'information' | 'hint' {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'information';
      case 'low':
      case 'info':
        return 'hint';
      default:
        return 'information';
    }
  }

  /**
   * Group diagnostics by file path for efficient VS Code API usage.
   */
  groupByFile(diagnostics: DecoratedDiagnostic[]): Map<string, DecoratedDiagnostic[]> {
    const groups = new Map<string, DecoratedDiagnostic[]>();
    for (const d of diagnostics) {
      const existing = groups.get(d.filePath) ?? [];
      existing.push(d);
      groups.set(d.filePath, existing);
    }
    return groups;
  }
}
