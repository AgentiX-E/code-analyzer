// @code-analyzer/vscode — Enhanced Status Bar
// Shows active project, last analysis time, review finding count,
// and provides quick access to the review panel.

import type { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Status bar types (VS Code stubs for testing)
// ---------------------------------------------------------------------------

export interface StatusBarItem {
  text: string;
  tooltip: string;
  command?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface StatusBarAlignment {
  readonly Left: 1;
  readonly Right: 2;
}

// ---------------------------------------------------------------------------
// CodeAnalyzerStatusBar
// ---------------------------------------------------------------------------

export class CodeAnalyzerStatusBar {
  private item: StatusBarItem | null = null;
  private projectName = '';
  private lastAnalysisTime: Date | null = null;
  private reviewCount = 0;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private engine: EngineBridge,
    private createStatusBarItem: (alignment: number, priority: number) => StatusBarItem,
    private alignment: StatusBarAlignment,
  ) {}

  /** Initialize the status bar and start periodic refresh. */
  initialize(): void {
    this.item = this.createStatusBarItem(this.alignment.Right, 100);
    this.updateDisplay();
    this.updateTimer = setInterval(() => this.refresh(), 30_000);
  }

  /** Refresh status bar from engine data. */
  async refresh(): Promise<void> {
    try {
      const comments = await this.engine.reviewWorkspace();
      this.reviewCount = comments?.length ?? 0;
      this.lastAnalysisTime = new Date();
      this.updateDisplay();
    } catch {
      // Engine not available — keep stale data
    }
  }

  /** Update the status bar text and tooltip. */
  private updateDisplay(): void {
    if (!this.item) return;

    const reviewIcon = this.reviewCount > 0 ? '$(warning)' : '$(check)';
    const reviewText = this.reviewCount > 0 ? ` ${this.reviewCount} findings` : ' clean';

    this.item.text = `${reviewIcon} Code Analyzer${reviewText}`;
    this.item.tooltip = this.buildTooltip();
    this.item.command = 'code-analyzer.showReviewPanel';
    this.item.show();
  }

  /** Build the hover tooltip string. */
  private buildTooltip(): string {
    const parts: string[] = [];
    if (this.projectName) {
      parts.push(`Project: ${this.projectName}`);
    }
    if (this.lastAnalysisTime) {
      parts.push(`Last Analysis: ${this.lastAnalysisTime.toLocaleTimeString()}`);
    }
    parts.push(`Review Findings: ${this.reviewCount}`);
    parts.push('Click to open Review Panel');
    return parts.join('\n');
  }

  /** Set the active project name. */
  setProject(name: string): void {
    this.projectName = name;
    this.updateDisplay();
  }

  /** Update the review count directly. */
  setReviewCount(count: number): void {
    this.reviewCount = count;
    this.updateDisplay();
  }

  /** Dispose the status bar and stop refresh timer. */
  dispose(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.item) {
      this.item.dispose();
      this.item = null;
    }
  }
}
