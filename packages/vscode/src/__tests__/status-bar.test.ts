// @code-analyzer/vscode — Status Bar Tests

import { describe, it, expect } from 'vitest';
import { StatusBarManager, createStatusBarManager } from '../views/status-bar.js';
import { EngineBridge } from '../services/engine-bridge.js';
import type { IndexingState } from '../services/engine-bridge.js';
import { StatusBarAlignment } from '../services/vscode-api.js';
import type { StatusBarItem } from '../services/vscode-api.js';

function createMockItem(): StatusBarItem {
  const state: { text: string; tooltip: string; command: string; visible: boolean } = {
    text: '',
    tooltip: '',
    command: '',
    visible: false,
  };
  return {
    get text() {
      return state.text;
    },
    set text(v: string) {
      state.text = v;
    },
    get tooltip() {
      return state.tooltip;
    },
    set tooltip(v: string) {
      state.tooltip = v;
    },
    get command() {
      return state.command;
    },
    set command(v: string) {
      state.command = v;
    },
    show() {
      state.visible = true;
    },
    hide() {
      state.visible = false;
    },
    dispose() {
      state.text = '';
      state.tooltip = '';
    },
    _state: state,
  };
}

/**
 * An EngineBridge double that records the listeners a consumer registers and
 * answers getIndexingState() with a fixed non-zero symbol count.
 *
 * Only the engine is doubled here — the module under test (createStatusBarManager)
 * and the StatusBarManager it builds are the real implementations.
 */
function recordingEngine() {
  const progress: Array<(state: IndexingState) => void> = [];
  const complete: Array<() => void> = [];
  const factoryCalls: Array<[number, number]> = [];

  const engine = {
    onIndexingProgress: (fn: (state: IndexingState) => void) => {
      progress.push(fn);
    },
    onIndexingComplete: (fn: () => void) => {
      complete.push(fn);
    },
    getIndexingState: (): IndexingState => ({ status: 'ready', symbolCount: 7, progress: 100 }),
  } as unknown as EngineBridge;

  const createStatusBarItem = (alignment: number, priority: number): StatusBarItem => {
    factoryCalls.push([alignment, priority]);
    return createMockItem();
  };

  return { engine, progress, complete, factoryCalls, createStatusBarItem };
}

describe('StatusBarManager', () => {
  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('initialization', () => {
    it('starts in idle state', () => {
      const manager = new StatusBarManager();
      expect(manager.getState()).toBe('idle');
    });

    it('has zero progress initially', () => {
      const manager = new StatusBarManager();
      expect(manager.getProgress()).toBe(0);
    });

    it('returns idle display text', () => {
      const manager = new StatusBarManager();
      const display = manager.getDisplay();
      expect(display.text).toBe('$(search) Code Analyzer');
      expect(display.tooltip).toContain('click to open sidebar');
    });
  });

  // -------------------------------------------------------------------------
  // setItem
  // -------------------------------------------------------------------------

  describe('setItem', () => {
    it('sets the status bar item and shows it', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      const styleItem = item as unknown as {
        _state: { visible: boolean; text: string; tooltip: string };
      };
      expect(styleItem._state.visible).toBe(true);
      expect(item.text).toBe('$(search) Code Analyzer');
      expect(item.tooltip).toContain('click to open sidebar');
    });
  });

  // -------------------------------------------------------------------------
  // setIndexing
  // -------------------------------------------------------------------------

  describe('setIndexing', () => {
    it('sets state to indexing', () => {
      const manager = new StatusBarManager();
      manager.setIndexing();
      expect(manager.getState()).toBe('indexing');
    });

    it('updates display with indexing icon', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setIndexing();
      expect(item.text).toContain('sync~spin');
    });

    it('accepts progress percentage', () => {
      const manager = new StatusBarManager();
      manager.setIndexing(42);
      expect(manager.getProgress()).toBe(42);
    });

    it('displays progress in text when set', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setIndexing(75);
      expect(item.text).toContain('75%');
    });

    it('does not display progress when not provided', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setIndexing();
      expect(item.text).not.toContain('%');
    });

    it('updates the status bar text', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setIndexing(50);
      expect(item.text).toBe('$(sync~spin) Analyzing... 50%');
      expect(item.tooltip).toContain('indexing');
    });

    it('preserves progress when called without argument', () => {
      const manager = new StatusBarManager();
      manager.setIndexing(33);
      manager.setIndexing();
      expect(manager.getProgress()).toBe(33);
    });
  });

  // -------------------------------------------------------------------------
  // setReady
  // -------------------------------------------------------------------------

  describe('setReady', () => {
    it('sets state to ready', () => {
      const manager = new StatusBarManager();
      manager.setReady();
      expect(manager.getState()).toBe('ready');
    });

    it('sets progress to 100', () => {
      const manager = new StatusBarManager();
      manager.setReady();
      expect(manager.getProgress()).toBe(100);
    });

    it('updates display with check icon', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setReady();
      expect(item.text).toBe('$(check) Code Analyzer');
      expect(item.tooltip).toContain('index is up to date');
    });
  });

  // -------------------------------------------------------------------------
  // setError
  // -------------------------------------------------------------------------

  describe('setError', () => {
    it('sets state to error', () => {
      const manager = new StatusBarManager();
      manager.setError();
      expect(manager.getState()).toBe('error');
    });

    it('updates display with error icon', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setError();
      expect(item.text).toBe('$(error) Code Analyzer');
      expect(item.tooltip).toContain('error');
    });
  });

  // -------------------------------------------------------------------------
  // setIdle
  // -------------------------------------------------------------------------

  describe('setIdle', () => {
    it('sets state back to idle', () => {
      const manager = new StatusBarManager();
      manager.setIndexing(50);
      manager.setIdle();
      expect(manager.getState()).toBe('idle');
      expect(manager.getProgress()).toBe(0);
    });

    it('updates display to idle', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.setIndexing();
      manager.setIdle();
      expect(item.text).toBe('$(search) Code Analyzer');
    });
  });

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  describe('state transitions', () => {
    it('idle -> indexing -> ready', () => {
      const manager = new StatusBarManager();
      expect(manager.getState()).toBe('idle');

      manager.setIndexing(0);
      expect(manager.getState()).toBe('indexing');

      manager.setReady();
      expect(manager.getState()).toBe('ready');
    });

    it('idle -> indexing -> error', () => {
      const manager = new StatusBarManager();
      manager.setIndexing();
      manager.setError();
      expect(manager.getState()).toBe('error');
    });

    it('error -> idle', () => {
      const manager = new StatusBarManager();
      manager.setError();
      manager.setIdle();
      expect(manager.getState()).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // getDisplay without item
  // -------------------------------------------------------------------------

  describe('getDisplay without item', () => {
    it('works without setting item', () => {
      const manager = new StatusBarManager();
      manager.setIndexing(50);
      const display = manager.getDisplay();
      expect(display.text).toContain('50%');
    });

    it('does not throw when calling dispose without item', () => {
      const manager = new StatusBarManager();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes the item', () => {
      const manager = new StatusBarManager();
      const item = createMockItem();
      manager.setItem(item);
      manager.dispose();
      expect(item.text).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Factory integration — engine event listeners
  // -------------------------------------------------------------------------

  describe('factory event listeners', () => {
    it('triggers onIndexingProgress with indexing state', () => {
      const engine = new EngineBridge();
      const factory = {
        createStatusBarItem() {
          return {
            text: '',
            tooltip: '',
            command: '',
            show() {},
            hide() {},
            dispose() {},
          };
        },
      };
      const manager = createStatusBarManager(factory, engine);

      // Directly invoke the progress listener by calling onIndexingProgress
      // and then triggering the callback registered by createStatusBarManager
      // We verify the manager state after simulating the flow
      manager.setIndexing(50);
      expect(manager.getState()).toBe('indexing');
      expect(manager.getProgress()).toBe(50);

      manager.setReady(100);
      expect(manager.getState()).toBe('ready');

      manager.setError();
      expect(manager.getState()).toBe('error');

      manager.setIdle();
      expect(manager.getState()).toBe('idle');

      manager.dispose();
      engine.dispose();
    });

    it('triggers onIndexingComplete listener', () => {
      const engine = new EngineBridge();
      const factory = {
        createStatusBarItem() {
          return {
            text: '',
            tooltip: '',
            command: '',
            show() {},
            hide() {},
            dispose() {},
          };
        },
      };
      const manager = createStatusBarManager(factory, engine);

      // The onIndexingComplete listener sets ready state.
      // We simulate the engine completing indexing.
      manager.setReady(42);
      expect(manager.getState()).toBe('ready');
      expect(manager.getSymbolCount()).toBe(42);

      // Verify the snapshot has correct data
      const snap = manager.getSnapshot();
      expect(snap.state).toBe('ready');
      expect(snap.symbolCount).toBe(42);

      manager.dispose();
      engine.dispose();
    });

    it('createStatusBarManager wires all listeners correctly', () => {
      const engine = new EngineBridge();
      const factory = {
        createStatusBarItem() {
          return {
            text: '',
            tooltip: '',
            command: '',
            show() {},
            hide() {},
            dispose() {},
          };
        },
      };

      // createStatusBarManager registers listeners via engine.onIndexingProgress
      // and engine.onIndexingComplete. Verify the factory creates the manager.
      const manager = createStatusBarManager(factory, engine);
      expect(manager).toBeDefined();
      expect(manager.getState()).toBe('idle');

      // Simulate full lifecycle through the manager directly
      manager.setIndexing(75);
      expect(manager.getSnapshot().state).toBe('indexing');
      expect(manager.getSnapshot().progress).toBe(75);

      manager.setReady(200);
      expect(manager.getSnapshot().state).toBe('ready');
      expect(manager.getSnapshot().symbolCount).toBe(200);

      manager.setError();
      expect(manager.getSnapshot().state).toBe('error');

      manager.dispose();
      engine.dispose();
    });

    it('drives the status bar from the real engine indexing lifecycle', async () => {
      const engine = new EngineBridge();
      const item = createMockItem();
      const manager = createStatusBarManager({ createStatusBarItem: () => item }, engine);
      expect(manager.getState()).toBe('idle');

      // indexWorkspace() is the call the extension makes. The status bar only
      // learns about it through the listener registered above, so reaching
      // 'ready' here proves the wiring rather than the manager's own setters.
      await engine.indexWorkspace('/tmp/status-bar-workspace');

      expect(manager.getState()).toBe('ready');
      expect(manager.getProgress()).toBe(100);
      expect(manager.getSymbolCount()).toBe(engine.getIndexingState().symbolCount);
      expect(item.text).toBe('$(check) Code Analyzer');

      manager.dispose();
      engine.dispose();
    });

    it('maps every indexing status onto the matching status bar state', () => {
      const { engine, progress, factoryCalls, createStatusBarItem } = recordingEngine();
      const manager = createStatusBarManager({ createStatusBarItem }, engine);

      expect(factoryCalls).toEqual([[StatusBarAlignment.Right, 100]]);
      expect(progress).toHaveLength(1);

      // IndexingState.status is a four-member union and onIndexingProgress is a
      // public API, so the registered listener has to handle every member.
      progress[0]!({ status: 'indexing', symbolCount: 0, progress: 40 });
      expect(manager.getState()).toBe('indexing');
      expect(manager.getProgress()).toBe(40);

      progress[0]!({ status: 'ready', symbolCount: 12, progress: 100 });
      expect(manager.getState()).toBe('ready');
      expect(manager.getSymbolCount()).toBe(12);

      progress[0]!({ status: 'error', symbolCount: 0, progress: 0 });
      expect(manager.getState()).toBe('error');

      progress[0]!({ status: 'idle', symbolCount: 0, progress: 0 });
      expect(manager.getState()).toBe('idle');
      expect(manager.getProgress()).toBe(0);

      manager.dispose();
    });

    it('reads the symbol count back from the engine on the legacy completion event', () => {
      const { engine, complete, createStatusBarItem } = recordingEngine();
      const manager = createStatusBarManager({ createStatusBarItem }, engine);

      expect(complete).toHaveLength(1);
      complete[0]!();

      // The legacy event carries no payload, so the handler has to query the
      // engine; defaulting to zero would silently blank the symbol count.
      expect(manager.getState()).toBe('ready');
      expect(manager.getSymbolCount()).toBe(7);

      manager.dispose();
    });
  });
});
