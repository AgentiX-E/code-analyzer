// @code-analyzer/core — Plugin Loader Tests

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginLoader } from '../plugins/plugin-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempPlugin(content: string): { path: string; cleanup: () => void } {
  const dir = join(tmpdir(), `plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const filePath = join(dir, 'plugin.js');
  // Create directory if it doesn't exist
  const { mkdirSync } = require('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return {
    path: filePath,
    cleanup: () => {
      try { unlinkSync(filePath); } catch { /* */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginLoader', () => {
  let loader: PluginLoader;

  afterEach(() => {
    loader = new PluginLoader();
  });

  beforeEach(() => {
    loader = new PluginLoader();
  });

  describe('validatePlugin', () => {
    it('should return true for valid plugin', () => {
      expect(loader.validatePlugin({
        name: 'valid', version: '1.0.0', description: 'desc',
      })).toBe(true);
    });

    it('should return false for invalid plugin', () => {
      expect(loader.validatePlugin({})).toBe(false);
    });

    it('should return false for null', () => {
      expect(loader.validatePlugin(null)).toBe(false);
    });

    it('should return false for string', () => {
      expect(loader.validatePlugin('string')).toBe(false);
    });
  });

  describe('loadFromPath', () => {
    it('should throw for non-existent path', async () => {
      await expect(loader.loadFromPath('/nonexistent/path/plugin.js')).rejects.toThrow(/not found/);
    });

    it('should throw when plugin has no default export', async () => {
      const { path, cleanup } = createTempPlugin('export const x = 1;');
      try {
        await expect(loader.loadFromPath(path)).rejects.toThrow(/does not export/);
      } finally {
        cleanup();
      }
    });

    it('should load a valid plugin via default export', async () => {
      const { path, cleanup } = createTempPlugin(
        'export default { name: "loaded-plugin", version: "1.0.0", description: "loaded via path" };',
      );
      try {
        const plugin = await loader.loadFromPath(path);
        expect(plugin.name).toBe('loaded-plugin');
        expect(plugin.version).toBe('1.0.0');
      } finally {
        cleanup();
      }
    });

    it('should load a valid plugin via named export', async () => {
      const { path, cleanup } = createTempPlugin(
        'export const plugin = { name: "named-plugin", version: "2.0.0", description: "named export" };',
      );
      try {
        const plugin = await loader.loadFromPath(path);
        expect(plugin.name).toBe('named-plugin');
      } finally {
        cleanup();
      }
    });

    it('should throw when plugin has missing required fields', async () => {
      const { path, cleanup } = createTempPlugin(
        'export default { name: "bad" };',
      );
      try {
        await expect(loader.loadFromPath(path)).rejects.toThrow(/Invalid plugin/);
      } finally {
        cleanup();
      }
    });

    it('should prefer default export over named export', async () => {
      const { path, cleanup } = createTempPlugin(
        'export default { name: "default-plugin", version: "1.0.0", description: "default wins" };\n' +
        'export const plugin = { name: "named-plugin", version: "2.0.0", description: "named loses" };',
      );
      try {
        const plugin = await loader.loadFromPath(path);
        expect(plugin.name).toBe('default-plugin');
      } finally {
        cleanup();
      }
    });

    it('should increment totalLoaded counter', async () => {
      const { path, cleanup } = createTempPlugin(
        'export default { name: "counter-plugin", version: "1.0.0", description: "count me" };',
      );
      try {
        expect(loader.totalLoaded).toBe(0);
        await loader.loadFromPath(path);
        expect(loader.totalLoaded).toBe(1);
      } finally {
        cleanup();
      }
    });
  });

  describe('loadFromNpm', () => {
    it('should throw for not-installed package', async () => {
      await expect(
        loader.loadFromNpm('this-package-definitely-does-not-exist-xyz'),
      ).rejects.toThrow(/not installed|Cannot find/);
    });
  });
});
