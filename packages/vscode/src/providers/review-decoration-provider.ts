// @code-analyzer/vscode — Review Decoration Provider
// Pure logic class for review comment decorations.
// Generates decoration configs, hover content, code lens actions, and gutter icons.
// No VS Code dependency — all VS Code integration lives in extension.ts.

import type { ReviewCommentItem } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecorationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface DecorationConfig {
  severity: DecorationSeverity;
  gutterIconPath?: string;
  overviewRulerColor: string;
  overviewRulerLane: number;
  backgroundColor: string;
  borderColor: string;
  borderStyle: string;
}

export interface HoverContent {
  title: string;
  message: string;
  severity: string;
  category: string;
  suggestion?: string;
}

export interface CodeLensAction {
  title: string;
  command: string;
  tooltip: string;
}

export interface FileDecorationGroup {
  line: number;
  config: DecorationConfig;
  comment: ReviewCommentItem;
}

// ---------------------------------------------------------------------------
// Severity constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: DecorationSeverity[] = [
  'critical', 'high', 'medium', 'low', 'info',
];

const SEVERITY_RANK: Record<DecorationSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

// ---------------------------------------------------------------------------
// ReviewDecorationLogic
// ---------------------------------------------------------------------------

export class ReviewDecorationLogic {
  /**
   * Get the decoration configuration for a given severity level.
   */
  getDecorationConfig(severity: DecorationSeverity): DecorationConfig {
    switch (severity) {
      case 'critical':
        return {
          severity: 'critical',
          overviewRulerColor: '#f44747',
          overviewRulerLane: 7,
          backgroundColor: 'rgba(244, 71, 71, 0.1)',
          borderColor: '#f44747',
          borderStyle: 'solid',
        };
      case 'high':
        return {
          severity: 'high',
          overviewRulerColor: '#e2a23b',
          overviewRulerLane: 5,
          backgroundColor: 'rgba(226, 162, 59, 0.1)',
          borderColor: '#e2a23b',
          borderStyle: 'solid',
        };
      case 'medium':
        return {
          severity: 'medium',
          overviewRulerColor: '#4ec9b0',
          overviewRulerLane: 3,
          backgroundColor: 'rgba(78, 201, 176, 0.1)',
          borderColor: '#4ec9b0',
          borderStyle: 'solid',
        };
      case 'low':
        return {
          severity: 'low',
          overviewRulerColor: '#569cd6',
          overviewRulerLane: 1,
          backgroundColor: 'rgba(86, 156, 214, 0.08)',
          borderColor: '#569cd6',
          borderStyle: 'dashed',
        };
      case 'info':
        return {
          severity: 'info',
          overviewRulerColor: '#808080',
          overviewRulerLane: 1,
          backgroundColor: 'rgba(128, 128, 128, 0.05)',
          borderColor: '#808080',
          borderStyle: 'dotted',
        };
      default:
        return this.getDecorationConfig('info');
    }
  }

  /**
   * Build hover content (markdown) from a review comment.
   */
  buildHoverContent(comment: ReviewCommentItem): HoverContent {
    const severity = comment.severity || 'info';
    const suggestion = this.deriveSuggestion(comment);
    return {
      title: `[${severity.toUpperCase()}] ${comment.title || comment.message}`,
      message: comment.message,
      severity,
      category: this.categorizeIssue(comment),
      suggestion,
    };
  }

  /**
   * Determine CodeLens actions for a review comment based on severity.
   */
  getCodeLensActions(comment: ReviewCommentItem): CodeLensAction[] {
    const actions: CodeLensAction[] = [];
    const severity = comment.severity || 'info';

    if (severity === 'critical' || severity === 'high') {
      actions.push({
        title: '🔧 Fix',
        command: 'code-analyzer.fixIssue',
        tooltip: 'Apply suggested fix for this issue',
      });
    }

    if (severity === 'medium' || severity === 'low' || severity === 'info') {
      actions.push({
        title: '👁 Ignore',
        command: 'code-analyzer.ignoreIssue',
        tooltip: 'Ignore this issue',
      });
    }

    actions.push({
      title: '💡 Explain',
      command: 'code-analyzer.explainIssue',
      tooltip: 'Get AI explanation for this issue',
    });

    return actions;
  }

  /**
   * Filter comments by minimum severity level.
   * e.g., filterByMinSeverity(comments, 'medium') keeps critical, high, medium.
   */
  filterByMinSeverity(
    comments: ReviewCommentItem[],
    minSeverity: DecorationSeverity,
  ): ReviewCommentItem[] {
    const minRank = SEVERITY_RANK[minSeverity] ?? 0;
    return comments.filter((c) => {
      const rank = SEVERITY_RANK[c.severity as DecorationSeverity] ?? 0;
      return rank >= minRank;
    });
  }

  /**
   * Generate an inline SVG badge for a severity level.
   */
  getSeverityBadgeSvg(severity: DecorationSeverity): string {
    const config = this.getDecorationConfig(severity);
    const color = config.overviewRulerColor;
    const label = severity.toUpperCase();
    const width = Math.max(40, label.length * 8 + 16);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18">` +
      `<rect width="${width}" height="18" rx="3" fill="${color}" opacity="0.2"/>` +
      `<rect x="0" y="0" width="${width}" height="18" rx="3" fill="none" stroke="${color}" stroke-width="1"/>` +
      `<text x="${width / 2}" y="13" text-anchor="middle" font-size="10" font-family="sans-serif" fill="${color}" font-weight="bold">${label}</text>` +
      `</svg>`
    );
  }

  /**
   * Generate a gutter icon SVG for a severity level.
   */
  getGutterIconSvg(severity: DecorationSeverity): string {
    const config = this.getDecorationConfig(severity);
    const color = config.overviewRulerColor;
    // Simple circle icon with severity indicator
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">` +
      `<circle cx="7" cy="7" r="5" fill="${color}" opacity="0.3"/>` +
      `<circle cx="7" cy="7" r="5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<text x="7" y="10" text-anchor="middle" font-size="8" font-family="sans-serif" fill="${color}" font-weight="bold">!</text>` +
      `</svg>`
    );
  }

  /**
   * Group decorations by file path with line ranges.
   */
  groupDecorationsByFile(
    comments: ReviewCommentItem[],
  ): Map<string, FileDecorationGroup[]> {
    const groups = new Map<string, FileDecorationGroup[]>();
    for (const comment of comments) {
      const severity = (comment.severity || 'info') as DecorationSeverity;
      const config = this.getDecorationConfig(severity);
      const group: FileDecorationGroup = {
        line: Math.max(0, comment.startLine - 1),
        config,
        comment,
      };
      const existing = groups.get(comment.path) ?? [];
      existing.push(group);
      groups.set(comment.path, existing);
    }
    return groups;
  }

  /**
   * Build a hover markdown string from hover content.
   */
  buildHoverMarkdown(content: HoverContent): string {
    const badge = this.getSeverityBadgeSvg(content.severity as DecorationSeverity);
    const lines = [
      `![severity](${this.svgToDataUri(badge)}) **${content.title}**`,
      '',
      content.message,
    ];
    if (content.category) {
      lines.push(`\n*Category: ${content.category}*`);
    }
    if (content.suggestion) {
      lines.push(`\n> 💡 ${content.suggestion}`);
    }
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private deriveSuggestion(comment: ReviewCommentItem): string | undefined {
    const msg = (comment.message || '').toLowerCase();
    if (msg.includes('complexity') || msg.includes('cyclomatic')) {
      return 'Consider extracting nested logic into smaller functions.';
    }
    if (msg.includes('security') || msg.includes('injection')) {
      return 'Review input sanitization and use parameterized queries.';
    }
    if (msg.includes('naming') || msg.includes('convention')) {
      return 'Follow the project naming convention for consistency.';
    }
    if (msg.includes('performance') || msg.includes('optimize')) {
      return 'Profile the code and consider algorithmic improvements.';
    }
    if (msg.includes('dependency') || msg.includes('coupling')) {
      return 'Consider dependency injection or interface abstraction.';
    }
    if (msg.includes('error') || msg.includes('exception')) {
      return 'Add proper error handling and logging.';
    }
    return undefined;
  }

  private categorizeIssue(comment: ReviewCommentItem): string {
    const msg = (comment.message || '').toLowerCase();
    if (msg.includes('complexity') || msg.includes('cyclomatic')) return 'maintainability';
    if (msg.includes('security') || msg.includes('injection') || msg.includes('xss')) return 'security';
    if (msg.includes('performance') || msg.includes('optimize')) return 'performance';
    if (msg.includes('naming') || msg.includes('convention') || msg.includes('style')) return 'code-style';
    if (msg.includes('error') || msg.includes('exception') || msg.includes('handling')) return 'reliability';
    if (msg.includes('dependency') || msg.includes('coupling')) return 'architecture';
    if (msg.includes('test') || msg.includes('coverage')) return 'testing';
    return 'general';
  }

  private svgToDataUri(svg: string): string {
    const encoded = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
  }
}
