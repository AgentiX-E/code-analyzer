// @code-analyzer/vscode — Status Bar Indicator
// Manages the VS Code status bar item for Code Analyzer.

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
}

const DISPLAY_MAP: Record<StatusBarState, StatusBarDisplay> = {
  idle: {
    text: '$(search) Code Analyzer',
    tooltip: 'Code Analyzer — click to open sidebar',
  },
  indexing: {
    text: '$(sync~spin) Analyzing...',
    tooltip: 'Code Analyzer is indexing the codebase',
  },
  ready: {
    text: '$(check) Code Analyzer',
    tooltip: 'Code Analyzer — index is up to date',
  },
  error: {
    text: '$(error) Code Analyzer',
    tooltip: 'Code Analyzer encountered an error',
  },
};

// ---------------------------------------------------------------------------
// StatusBarManager — pure logic (no VS Code dependency)
// ---------------------------------------------------------------------------

export class StatusBarManager {
  private state: StatusBarState = 'idle';
  private progress = 0;
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
   * Set the ready state (indexing complete).
   */
  setReady(): void {
    this.state = 'ready';
    this.progress = 100;
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
   * Get the display text for the current state.
   */
  getDisplay(): StatusBarDisplay {
    const base = DISPLAY_MAP[this.state];
    if (this.state === 'indexing' && this.progress > 0) {
      return {
        ...base,
        text: `$(sync~spin) Analyzing... ${this.progress}%`,
      };
    }
    return base;
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

  private updateDisplay(): void {
    if (!this.item) return;
    const display = this.getDisplay();
    this.item.text = display.text;
    this.item.tooltip = display.tooltip;
    this.item.command = 'code-analyzer.showSidebar';
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

  // Listen for indexing completion
  engine.onIndexingComplete(() => {
    manager.setReady();
  });

  return manager;
}
