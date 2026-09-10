// @code-analyzer/infra — Optional better-sqlite3 Loader Tests

import { describe, it, expect } from 'vitest';
import {
  loadBetterSqlite3,
  loadDefaultBetterSqlite3,
  type BetterSqlite3Ctor,
} from '../storage/sqlite-loader.js';

describe('loadBetterSqlite3', () => {
  it('resolves the installed better-sqlite3 constructor by default', () => {
    const ctor = loadBetterSqlite3();
    expect(ctor).toBeTruthy();
    expect(typeof ctor).toBe('function');
  });

  it('returns null when the dependency cannot be resolved', () => {
    const ctor = loadBetterSqlite3(() => {
      throw new Error("Cannot find module 'better-sqlite3'");
    });
    expect(ctor).toBeNull();
  });

  it('returns the constructor supplied by an injected loader', () => {
    const injected = function FakeDatabase() {
      /* stand-in constructor */
    } as unknown as BetterSqlite3Ctor;
    expect(loadBetterSqlite3(() => injected)).toBe(injected);
  });

  it('resolves the same constructor instance on repeated calls', () => {
    // Node caches module resolution, so the default loader is stable and cheap
    // enough to call per construction.
    expect(loadDefaultBetterSqlite3()).toBe(loadDefaultBetterSqlite3());
    expect(loadBetterSqlite3()).toBe(loadBetterSqlite3());
  });
});
