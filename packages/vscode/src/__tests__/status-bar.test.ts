// @code-analyzer/vscode — Status Bar Tests

import { describe, it, expect } from 'vitest';
import { StatusBarManager } from '../views/status-bar.js';
import type { StatusBarItem } from '../services/vscode-api.js';

function createMockItem(): StatusBarItem {
  const state: { text: string; tooltip: string; command: string; visible: boolean } = {
    text: '',
    tooltip: '',
    command: '',
    visible: false,
  };
  return {
    get text() { return state.text; },
    set text(v: string) { state.text = v; },
    get tooltip() { return state.tooltip; },
    set tooltip(v: string) { state.tooltip = v; },
    get command() { return state.command; },
    set command(v: string) { state.command = v; },
    show() { state.visible = true; },
    hide() { state.visible = false; },
    dispose() {
      state.text = '';
      state.tooltip = '';
    },
    _state: state,
  };
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
      const styleItem = item as unknown as { _state: { visible: boolean; text: string; tooltip: string } };
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
});
