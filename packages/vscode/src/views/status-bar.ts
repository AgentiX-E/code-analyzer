// @code-analyzer/vscode — Status Bar Indicator
// Manages the VS Code status bar item for Code Analyzer.
// Shows analysis status, symbol count, review issues, and click actions.

import type { EngineBridge } from '../services/engine-bridge.js';
import type { StatusBarItem } from '../services/vscode-api.js';
import { StatusBarAlignment } from '../services/vscode-api.js';

// ---------------------------------------------------------------------------
// StatusBarState — testable pure state management
// ---------------------------------------------------------------------------

export type StatusBarState = 'idle' | 'indexing' | 'ready' | 'error';

export interface StatusBarDisplay {
  text: string;
  tooltip: string;
  command: string;
}

export interface StatusBarSnapshot {
  state: StatusBarState;
  progress: number;
  symbolCount: number;
  issueCount: number;
  display: StatusBarDisplay;
}

const DISPLAY_MAP: Record<StatusBarState, StatusBarDisplay> = {
  idle: {
    text: '$(search) Code Analyzer',
    tooltip: 'Code Analyzer — click to open sidebar',
    command: 'code-analyzer.showSidebar',
  },
  indexing: {
    text: '$(sync~spin) Analyzing...',
    tooltip: 'Code Analyzer is indexing the codebase',
    command: 'code-analyzer.analyze',
  },
  ready: {
    text: '$(check) Code Analyzer',
    tooltip: 'Code Analyzer — index is up to date',
    command: 'code-analyzer.showSidebar',
  },
  error: {
    text: '$(error) Code Analyzer',
    tooltip: 'Code Analyzer encountered an error',
    command: 'code-analyzer.analyze',
  },
};

// ---------------------------------------------------------------------------
// StatusBarManager — pure logic (no VS Code dependency)
// ---------------------------------------------------------------------------

export class StatusBarManager {
  private state: StatusBarState = 'idle';
  private progress = 0;
  private symbolCount = 0;
  private issueCount = 0;
  private item: StatusBarItem | null = null;

  /**
   * Set the VS Code status bar item (injected by extension.ts).
   */
  setItem(item: StatusBarItem): void {
    this.item = item;
    this.updateDisplay();
    this.item.show();
  }

  /**
   * Set the indexing state with optional progress percentage.
   */
  setIndexing(progress?: number): void {
    this.state = 'indexing';
    this.progress = progress ?? this.progress;
    this.updateDisplay();
  }

  /**
   * Set the ready state (indexing complete) with optional symbol count.
   */
  setReady(symbolCount?: number): void {
    this.state = 'ready';
    this.progress = 100;
    if (symbolCount !== undefined) {
      this.symbolCount = symbolCount;
    }
    this.updateDisplay();
  }

  /**
   * Set the error state.
   */
  setError(): void {
    this.state = 'error';
    this.updateDisplay();
  }

  /**
   * Set the idle state.
   */
  setIdle(): void {
    this.state = 'idle';
    this.progress = 0;
    this.symbolCount = 0;
    this.issueCount = 0;
    this.updateDisplay();
  }

  /**
   * Set the current symbol count (shown in tooltip).
   */
  setSymbolCount(count: number): void {
    this.symbolCount = count;
    this.updateDisplay();
  }

  /**
   * Set the current review issue count.
   */
  setReviewIssues(count: number): void {
    this.issueCount = count;
    this.updateDisplay();
  }

  /**
   * Get the current state.
   */
  getState(): StatusBarState {
    return this.state;
  }

  /**
   * Get the current progress.
   */
  getProgress(): number {
    return this.progress;
  }

  /**
   * Get the current symbol count.
   */
  getSymbolCount(): number {
    return this.symbolCount;
  }

  /**
   * Get the current issue count.
   */
  getIssueCount(): number {
    return this.issueCount;
  }

  /**
   * Get a complete snapshot of the current state for testing.
   */
  getSnapshot(): StatusBarSnapshot {
    return {
      state: this.state,
      progress: this.progress,
      symbolCount: this.symbolCount,
      issueCount: this.issueCount,
      display: this.getDisplay(),
    };
  }

  /**
   * Get the display text for the current state.
   */
  getDisplay(): StatusBarDisplay {
    const base = DISPLAY_MAP[this.state];

    switch (this.state) {
      case 'indexing': {
        const progressText = this.progress > 0
          ? `${this.progress}%`
          : '';
        return {
          text: `$(sync~spin) Analyzing... ${progressText}`.trim(),
          tooltip: `Code Analyzer — indexing codebase${this.progress > 0 ? ` (${this.progress}%)` : ''}`,
          command: base.command,
        };
      }
      case 'ready': {
        const symbolText = this.symbolCount > 0
          ? `${this.symbolCount} symbols`
          : 'Code Analyzer';
        return {
          text: `$(check) ${symbolText}`,
          tooltip: this.buildReadyTooltip(),
          command: 'code-analyzer.showSidebar',
        };
      }
      case 'error': {
        return {
          text: '$(error) Code Analyzer',
          tooltip: 'Code Analyzer encountered an error — click to retry',
          command: 'code-analyzer.analyze',
        };
      }
      default:
        return base;
    }
  }

  /**
   * Dispose the status bar item.
   */
  dispose(): void {
    if (this.item) {
      this.item.dispose();
      this.item = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private updateDisplay(): void {
    if (!this.item) return;
    const display = this.getDisplay();
    this.item.text = display.text;
    this.item.tooltip = display.tooltip;
    this.item.command = display.command;
  }

  private buildReadyTooltip(): string {
    const parts: string[] = ['Code Analyzer — index is up to date'];

    if (this.symbolCount > 0) {
      parts.push(`\n\nIndexed: ${this.symbolCount} symbols`);
    }

    if (this.issueCount > 0) {
      parts.push(`\nIssues: ${this.issueCount} found`);
    }

    parts.push('\n\nClick: Open sidebar');
    parts.push('\nRight-click for actions');

    return parts.join('');
  }
}

// ---------------------------------------------------------------------------
// Factory for VS Code integration
// ---------------------------------------------------------------------------

export interface StatusBarItemFactory {
  createStatusBarItem(
    alignment: number,
    priority: number,
  ): StatusBarItem;
}

export function createStatusBarManager(
  factory: StatusBarItemFactory,
  engine: EngineBridge,
): StatusBarManager {
  const manager = new StatusBarManager();
  const item = factory.createStatusBarItem(
    StatusBarAlignment.Right,
    100,
  );
  manager.setItem(item);

  // Listen for indexing progress updates
  engine.onIndexingProgress((state) => {
    switch (state.status) {
      case 'indexing':
        manager.setIndexing(state.progress);
        break;
      case 'ready':
        manager.setReady(state.symbolCount);
        break;
      case 'error':
        manager.setError();
        break;
      default:
        manager.setIdle();
        break;
    }
  });

  // Listen for indexing completion (backward compat)
  engine.onIndexingComplete(() => {
    const indexState = engine.getIndexingState();
    manager.setReady(indexState.symbolCount);
  });

  return manager;
}
