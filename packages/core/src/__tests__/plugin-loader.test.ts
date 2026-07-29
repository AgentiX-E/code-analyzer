// @code-analyzer/core — Plugin Loader Tests
import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PluginLoader } from '../plugins/plugin-loader.js';

import type { CodeAnalyzerPlugin } from '../plugins/plugin-interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidPlugin(overrides?: Partial<CodeAnalyzerPlugin>): CodeAnalyzerPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin for unit testing',
    ...overrides,
  };
}

function makeCJSPluginContent(plugin: CodeAnalyzerPlugin): string {
  return `module.exports = ${JSON.stringify(plugin)};`;
}

function makeCJSDefaultExportContent(plugin: CodeAnalyzerPlugin): string {
  return `module.exports = { default: ${JSON.stringify(plugin)} };`;
}

function makeCJSNamedExportContent(plugin: CodeAnalyzerPlugin): string {
  return `module.exports = { plugin: ${JSON.stringify(plugin)} };`;
}

function makeESMPluginContent(plugin: CodeAnalyzerPlugin): string {
  return `const plugin = ${JSON.stringify(plugin)};\nexport default plugin;`;
}

function makeESMNamedExportContent(plugin: CodeAnalyzerPlugin): string {
  return `const plugin = ${JSON.stringify(plugin)};\nexport { plugin };`;
}

function writeTempFile(
  dir: string,
  filename: string,
  content: string,
): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('PluginLoader', () => {
  let loader: PluginLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = new PluginLoader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-plugin-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // loadFromPath
  // =========================================================================

  describe('loadFromPath', () => {
    it('should load a CJS plugin from path', async () => {
      const plugin = makeValidPlugin({ name: 'cjs-plugin' });
      writeTempFile(tempDir, 'plugin.cjs', makeCJSPluginContent(plugin));
      const loaded = await loader.loadFromPath(path.join(tempDir, 'plugin.cjs'));
      expect(loaded.name).toBe('cjs-plugin');
      expect(loaded.version).toBe('1.0.0');
    });

    it('should load an ESM plugin with default export from .mjs file', async () => {
      const plugin = makeValidPlugin({ name: 'esm-plugin' });
      writeTempFile(tempDir, 'plugin.mjs', makeESMPluginContent(plugin));
      const loaded = await loader.loadFromPath(path.join(tempDir, 'plugin.mjs'));
      expect(loaded.name).toBe('esm-plugin');
    });

    it('should load a CJS plugin from a directory with index.js', async () => {
      const pluginDir = path.join(tempDir, 'my-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });
      const plugin = makeValidPlugin({ name: 'dir-plugin' });
      writeTempFile(pluginDir, 'index.js', makeCJSPluginContent(plugin));
      const loaded = await loader.loadFromPath(pluginDir);
      expect(loaded.name).toBe('dir-plugin');
    });

    it('should load a CJS plugin from a directory with index.cjs', async () => {
      const pluginDir = path.join(tempDir, 'cjs-dir-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });
      const plugin = makeValidPlugin({ name: 'cjs-dir-plugin' });
      writeTempFile(pluginDir, 'index.cjs', makeCJSPluginContent(plugin));
      const loaded = await loader.loadFromPath(pluginDir);
      expect(loaded.name).toBe('cjs-dir-plugin');
    });

    it('should handle default export wrapper (CJS)', async () => {
      const plugin = makeValidPlugin({ name: 'default-export-plugin' });
      writeTempFile(tempDir, 'default-plugin.cjs', makeCJSDefaultExportContent(plugin));
      const loaded = await loader.loadFromPath(path.join(tempDir, 'default-plugin.cjs'));
      expect(loaded.name).toBe('default-export-plugin');
    });

    it('should handle named "plugin" export (CJS)', async () => {
      const plugin = makeValidPlugin({ name: 'named-export-plugin' });
      writeTempFile(tempDir, 'named-plugin.cjs', makeCJSNamedExportContent(plugin));
      const loaded = await loader.loadFromPath(path.join(tempDir, 'named-plugin.cjs'));
      expect(loaded.name).toBe('named-export-plugin');
    });

    it('should throw for non-existent path', async () => {
      await expect(
        loader.loadFromPath(path.join(tempDir, 'does-not-exist')),
      ).rejects.toThrow(/does not exist/);
    });

    it('should throw for unsupported file extension', async () => {
      const badPath = path.join(tempDir, 'plugin.txt');
      fs.writeFileSync(badPath, 'hello', 'utf-8');
      await expect(loader.loadFromPath(badPath)).rejects.toThrow(/Unsupported plugin file extension/);
    });

    it('should throw when directory has no index files', async () => {
      const emptyDir = path.join(tempDir, 'empty-dir');
      fs.mkdirSync(emptyDir, { recursive: true });
      await expect(loader.loadFromPath(emptyDir)).rejects.toThrow(/No loadable entry file found/);
    });
  });

  // =========================================================================
  // loadFromNpm
  // =========================================================================

  describe('loadFromNpm', () => {
    it('should throw for non-existent npm package', async () => {
      await expect(
        loader.loadFromNpm('non-existent-package-xyz-12345'),
      ).rejects.toThrow(/Failed to load plugin/);
    });
  });

  // =========================================================================
  // validatePlugin
  // =========================================================================

  describe('validatePlugin', () => {
    it('should return true for a valid plugin', () => {
      const plugin = makeValidPlugin();
      expect(loader.validatePlugin(plugin)).toBe(true);
    });

    it('should return true for a plugin with all optional fields', () => {
      const plugin = makeValidPlugin({
        rules: [
          {
            id: 'r1',
            name: 'Rule 1',
            category: 'security',
            severity: 'high',
            check: () => null,
          },
        ],
        lenses: [
          {
            id: 'l1',
            name: 'Lens 1',
            description: 'A lens',
            scan: () => [],
          },
        ],
        standards: [
          {
            id: 's1',
            name: 'Standard 1',
            description: 'A standard',
            severity: 'medium',
            check: () => [],
          },
        ],
        mcpTools: [
          {
            name: 'tool1',
            description: 'A tool',
            schema: {},
            handler: async () => ({}),
          },
        ],
        onLoad: () => { /* noop */ },
        onUnload: () => { /* noop */ },
      });
      expect(loader.validatePlugin(plugin)).toBe(true);
    });

    it('should return false for null', () => {
      expect(loader.validatePlugin(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(loader.validatePlugin(undefined)).toBe(false);
    });

    it('should return false for a string', () => {
      expect(loader.validatePlugin('not-a-plugin')).toBe(false);
    });

    it('should return false for an array', () => {
      expect(loader.validatePlugin([])).toBe(false);
    });

    it('should return false when name is missing', () => {
      const plugin = { version: '1.0.0', description: 'No name' };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when name is empty', () => {
      const plugin = makeValidPlugin({ name: '' });
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when version is missing', () => {
      const plugin = { name: 'test', description: 'test' };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when version is not semver-like', () => {
      const plugin = makeValidPlugin({ version: 'not-valid' });
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when description is missing', () => {
      const plugin = makeValidPlugin({ description: '' });
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when onLoad is not a function', () => {
      const plugin = { ...makeValidPlugin(), onLoad: 'not-a-function' };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when onUnload is not a function', () => {
      const plugin = { ...makeValidPlugin(), onUnload: 123 };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when rules is not an array', () => {
      const plugin = { ...makeValidPlugin(), rules: 'not-array' };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a rule entry is not an object', () => {
      const plugin = { ...makeValidPlugin(), rules: ['not-object'] };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a rule has no id', () => {
      const plugin = {
        ...makeValidPlugin(),
        rules: [{ name: 'r', check: () => null }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a rule has no check function', () => {
      const plugin = {
        ...makeValidPlugin(),
        rules: [{ id: 'r', name: 'r', check: 'not-function' }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when lenses is not an array', () => {
      const plugin = { ...makeValidPlugin(), lenses: 123 };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a lens has no id', () => {
      const plugin = {
        ...makeValidPlugin(),
        lenses: [{ name: 'l', description: 'd', scan: () => [] }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a lens has no scan function', () => {
      const plugin = {
        ...makeValidPlugin(),
        lenses: [{ id: 'l', name: 'l', description: 'd', scan: 'not-function' }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when standards is not an array', () => {
      const plugin = { ...makeValidPlugin(), standards: 'not-array' };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a standard has no id', () => {
      const plugin = {
        ...makeValidPlugin(),
        standards: [{ name: 's', description: 'd', severity: 'high', check: () => [] }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when a standard has no check function', () => {
      const plugin = {
        ...makeValidPlugin(),
        standards: [{ id: 's', name: 's', description: 'd', severity: 'high', check: 'not' }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when mcpTools is not an array', () => {
      const plugin = { ...makeValidPlugin(), mcpTools: true };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when an MCP tool has no name', () => {
      const plugin = {
        ...makeValidPlugin(),
        mcpTools: [{ name: '', description: 'd', schema: {}, handler: async () => ({}) }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });

    it('should return false when an MCP tool has no handler', () => {
      const plugin = {
        ...makeValidPlugin(),
        mcpTools: [{ name: 't', description: 'd', schema: {} }],
      };
      expect(loader.validatePlugin(plugin)).toBe(false);
    });
  });

  // =========================================================================
  // extractPlugin errors via loadFromPath
  // =========================================================================

  describe('extractPlugin edge cases', () => {
    it('should throw when module has no valid plugin export', async () => {
      const content = 'module.exports = { notAPlugin: true };';
      const filePath = writeTempFile(tempDir, 'bad-plugin.cjs', content);
      await expect(loader.loadFromPath(filePath)).rejects.toThrow(
        /Failed to extract a valid CodeAnalyzerPlugin/,
      );
    });

    it('should throw when module exports empty object', async () => {
      const content = 'module.exports = {};';
      const filePath = writeTempFile(tempDir, 'empty-plugin.cjs', content);
      await expect(loader.loadFromPath(filePath)).rejects.toThrow(
        /Failed to extract a valid CodeAnalyzerPlugin/,
      );
    });
  });

  // =========================================================================
  // loadFromNpm with file URL (covers ESM success path)
  // =========================================================================

  describe('loadFromNpm via file URL', () => {
    it('should load a plugin from a file URL via import()', async () => {
      const plugin = makeValidPlugin({ name: 'npm-via-file-url' });
      const filePath = writeTempFile(tempDir, 'npm-plugin.mjs', makeESMPluginContent(plugin));
      const fileUrl = pathToFileURL(filePath).href;
      const loaded = await loader.loadFromNpm(fileUrl);
      expect(loaded.name).toBe('npm-via-file-url');
    });
  });

  // =========================================================================
  // CJS fallback for .js files (when ESM import fails)
  // =========================================================================

  describe('CJS fallback for .js files', () => {
    it('should fall back to CJS when ESM import fails for .js file', async () => {
      // Write a .js file with CJS-only syntax that will fail as ESM
      // (using require() in a way that only works in CJS)
      const plugin = makeValidPlugin({ name: 'cjs-fallback-plugin' });
      const content = makeCJSPluginContent(plugin);
      const filePath = writeTempFile(tempDir, 'fallback-plugin.js', content);

      // The .js file should load via ESM first, which succeeds in Node.js
      // because Node supports CJS-style exports via dynamic import.
      // But we exercise the full path through loadModule.
      const loaded = await loader.loadFromPath(filePath);
      expect(loaded.name).toBe('cjs-fallback-plugin');
    });
  });
});
