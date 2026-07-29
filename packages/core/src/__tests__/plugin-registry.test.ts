// @code-analyzer/core — Plugin Registry Tests
import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PluginRegistry } from '../plugins/plugin-registry.js';

import type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginLens,
  PluginStandard,
  PluginMCPTool,
} from '../plugins/plugin-interface.js';

// Extend globalThis for reload test tracking
declare global {
  // eslint-disable-next-line no-var
  var __unloaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __asyncLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __asyncNpmLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __syncLoaded: boolean | undefined;
}

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

function makeRule(id: string): PluginRule {
  return {
    id,
    name: `Rule ${id}`,
    category: 'security',
    severity: 'high',
    check: () => null,
  };
}

function makeLens(id: string): PluginLens {
  return {
    id,
    name: `Lens ${id}`,
    description: `Lens ${id} description`,
    scan: () => [],
  };
}

function makeStandard(id: string): PluginStandard {
  return {
    id,
    name: `Standard ${id}`,
    description: `Standard ${id} description`,
    severity: 'medium',
    check: () => [],
  };
}

function makeMCPTool(name: string): PluginMCPTool {
  return {
    name,
    description: `Tool ${name} description`,
    schema: { type: 'object' },
    handler: async () => ({ result: 'ok' }),
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    PluginRegistry.resetInstance();
    registry = PluginRegistry.getInstance();
  });

  afterEach(() => {
    PluginRegistry.resetInstance();
  });

  // =========================================================================
  // Singleton
  // =========================================================================

  describe('singleton', () => {
    it('should return the same instance', () => {
      const a = PluginRegistry.getInstance();
      const b = PluginRegistry.getInstance();
      expect(a).toBe(b);
    });

    it('should return a new instance after reset', () => {
      const a = PluginRegistry.getInstance();
      PluginRegistry.resetInstance();
      const b = PluginRegistry.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // =========================================================================
  // register
  // =========================================================================

  describe('register', () => {
    it('should register a valid plugin', () => {
      const plugin = makeValidPlugin();
      registry.register(plugin);
      expect(registry.size).toBe(1);
      expect(registry.isEmpty).toBe(false);
    });

    it('should throw on duplicate registration', () => {
      registry.register(makeValidPlugin({ name: 'plugin-a' }));
      expect(() => {
        registry.register(makeValidPlugin({ name: 'plugin-a' }));
      }).toThrow(/already registered/);
    });

    it('should throw on invalid plugin', () => {
      expect(() => {
        registry.register({ name: '' } as unknown as CodeAnalyzerPlugin);
      }).toThrow(/Invalid plugin/);
    });

    it('should trigger onLoad when registering', () => {
      let called = false;
      const plugin = makeValidPlugin({
        name: 'onload-plugin',
        onLoad: () => { called = true; },
      });
      registry.register(plugin);
      expect(called).toBe(true);
    });

    it('should handle async onLoad rejection silently', async () => {
      // Register a plugin with an async onLoad that rejects.
      // The rejection should be caught silently.
      const plugin = makeValidPlugin({
        name: 'async-reject-plugin',
        onLoad: async () => { throw new Error('async load failed'); },
      });
      // Should not throw
      expect(() => registry.register(plugin)).not.toThrow();
      // Wait a tick for promise rejection to be handled
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(registry.get('async-reject-plugin')).toBeDefined();
    });
  });

  // =========================================================================
  // unregister
  // =========================================================================

  describe('unregister', () => {
    it('should unregister an existing plugin', () => {
      const plugin = makeValidPlugin({ name: 'to-remove' });
      registry.register(plugin);
      expect(registry.size).toBe(1);
      const result = registry.unregister('to-remove');
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.isEmpty).toBe(true);
    });

    it('should return false when unregistering non-existent plugin', () => {
      const result = registry.unregister('does-not-exist');
      expect(result).toBe(false);
    });

    it('should call onUnload when unregistering', () => {
      let called = false;
      const plugin = makeValidPlugin({
        name: 'unload-plugin',
        onUnload: () => { called = true; },
      });
      registry.register(plugin);
      registry.unregister('unload-plugin');
      expect(called).toBe(true);
    });

    it('should handle onUnload throwing', () => {
      const plugin = makeValidPlugin({
        name: 'unload-error-plugin',
        onUnload: () => { throw new Error('unload error'); },
      });
      registry.register(plugin);
      expect(() => registry.unregister('unload-error-plugin')).not.toThrow();
      expect(registry.size).toBe(0);
    });
  });

  // =========================================================================
  // getAll / get
  // =========================================================================

  describe('getAll', () => {
    it('should return empty array when no plugins', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered plugins', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      registry.register(makeValidPlugin({ name: 'p2' }));
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.name).sort()).toEqual(['p1', 'p2']);
    });
  });

  describe('get', () => {
    it('should return a plugin by name', () => {
      const plugin = makeValidPlugin({ name: 'find-me' });
      registry.register(plugin);
      expect(registry.get('find-me')).toBe(plugin);
    });

    it('should return undefined for unknown plugin', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  // =========================================================================
  // Aggregators
  // =========================================================================

  describe('getRules', () => {
    it('should return empty array when no plugins have rules', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      expect(registry.getRules()).toEqual([]);
    });

    it('should aggregate rules from all plugins', () => {
      registry.register(makeValidPlugin({
        name: 'p1',
        rules: [makeRule('r1'), makeRule('r2')],
      }));
      registry.register(makeValidPlugin({
        name: 'p2',
        rules: [makeRule('r3')],
      }));
      const rules = registry.getRules();
      expect(rules).toHaveLength(3);
      expect(rules.map((r) => r.id).sort()).toEqual(['r1', 'r2', 'r3']);
    });
  });

  describe('getLenses', () => {
    it('should return empty array when no plugins have lenses', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      expect(registry.getLenses()).toEqual([]);
    });

    it('should aggregate lenses from all plugins', () => {
      registry.register(makeValidPlugin({
        name: 'p1',
        lenses: [makeLens('l1'), makeLens('l2')],
      }));
      registry.register(makeValidPlugin({
        name: 'p2',
        lenses: [makeLens('l3')],
      }));
      const lenses = registry.getLenses();
      expect(lenses).toHaveLength(3);
    });
  });

  describe('getStandards', () => {
    it('should return empty array when no plugins have standards', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      expect(registry.getStandards()).toEqual([]);
    });

    it('should aggregate standards from all plugins', () => {
      registry.register(makeValidPlugin({
        name: 'p1',
        standards: [makeStandard('s1')],
      }));
      registry.register(makeValidPlugin({
        name: 'p2',
        standards: [makeStandard('s2'), makeStandard('s3')],
      }));
      const standards = registry.getStandards();
      expect(standards).toHaveLength(3);
    });
  });

  describe('getMCPTools', () => {
    it('should return empty array when no plugins have MCP tools', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      expect(registry.getMCPTools()).toEqual([]);
    });

    it('should aggregate MCP tools from all plugins', () => {
      registry.register(makeValidPlugin({
        name: 'p1',
        mcpTools: [makeMCPTool('tool1')],
      }));
      registry.register(makeValidPlugin({
        name: 'p2',
        mcpTools: [makeMCPTool('tool2'), makeMCPTool('tool3')],
      }));
      const tools = registry.getMCPTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name).sort()).toEqual(['tool1', 'tool2', 'tool3']);
    });
  });

  // =========================================================================
  // loadFromPath
  // =========================================================================

  describe('loadFromPath', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-registry-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should load and register a plugin from path', async () => {
      const plugin = makeValidPlugin({ name: 'loaded-plugin' });
      const content = `module.exports = ${JSON.stringify(plugin)};`;
      const filePath = path.join(tempDir, 'plugin.cjs');
      fs.writeFileSync(filePath, content, 'utf-8');

      const loaded = await registry.loadFromPath(filePath);
      expect(loaded.name).toBe('loaded-plugin');
      expect(registry.size).toBe(1);
    });

    it('should handle async onLoad when loading from path', async () => {
      let asyncLoaded = false;
      const filePath = path.join(tempDir, 'async-plugin.cjs');
      fs.writeFileSync(
        filePath,
        'module.exports = {' +
        '  name: "async-onload-plugin",' +
        '  version: "1.0.0",' +
        '  description: "Plugin with async onLoad",' +
        '  onLoad: async function() { globalThis.__asyncLoaded = true; }' +
        '};',
        'utf-8',
      );
      globalThis.__asyncLoaded = false;
      const loaded = await registry.loadFromPath(filePath);
      expect(loaded.name).toBe('async-onload-plugin');
      expect(globalThis.__asyncLoaded).toBe(true);
      delete globalThis.__asyncLoaded;
    });

    it('should handle sync onLoad when loading from path', async () => {
      let syncLoaded = false;
      const filePath = path.join(tempDir, 'sync-plugin.cjs');
      fs.writeFileSync(
        filePath,
        'module.exports = {' +
        '  name: "sync-onload-plugin",' +
        '  version: "1.0.0",' +
        '  description: "Plugin",' +
        '  onLoad: function() { globalThis.__syncLoaded = true; }' +
        '};',
        'utf-8',
      );
      globalThis.__syncLoaded = false;
      const loaded = await registry.loadFromPath(filePath);
      expect(loaded.name).toBe('sync-onload-plugin');
      expect(globalThis.__syncLoaded).toBe(true);
      delete globalThis.__syncLoaded;
    });

    it('should throw for non-existent path', async () => {
      await expect(
        registry.loadFromPath(path.join(tempDir, 'nope')),
      ).rejects.toThrow(/does not exist/);
    });
  });

  // =========================================================================
  // loadFromNpm
  // =========================================================================

  describe('loadFromNpm', () => {
    let npmTempDir: string;

    beforeEach(() => {
      npmTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-npm-test-'));
    });

    afterEach(() => {
      fs.rmSync(npmTempDir, { recursive: true, force: true });
    });

    it('should throw for non-existent package', async () => {
      await expect(
        registry.loadFromNpm('non-existent-npm-pkg-xyz'),
      ).rejects.toThrow(/Failed to load plugin/);
    });

    it('should load a plugin via file URL (import path)', async () => {
      const plugin = makeValidPlugin({ name: 'npm-loaded-plugin' });
      const filePath = path.join(npmTempDir, 'npm-plugin.mjs');
      fs.writeFileSync(
        filePath,
        `const plugin = ${JSON.stringify(plugin)};\nexport default plugin;`,
        'utf-8',
      );
      const fileUrl = pathToFileURL(filePath).href;
      const loaded = await registry.loadFromNpm(fileUrl);
      expect(loaded.name).toBe('npm-loaded-plugin');
      expect(registry.size).toBe(1);
      expect(registry.get('npm-loaded-plugin')).toBeDefined();
    });

    it('should handle async onLoad when loading from npm', async () => {
      const filePath = path.join(npmTempDir, 'npm-async-plugin.mjs');
      fs.writeFileSync(
        filePath,
        'const plugin = {' +
        '  name: "npm-async-onload-plugin",' +
        '  version: "1.0.0",' +
        '  description: "Plugin with async onLoad",' +
        '  onLoad: async function() { globalThis.__asyncNpmLoaded = true; }' +
        '};' +
        'export default plugin;',
        'utf-8',
      );
      globalThis.__asyncNpmLoaded = false;
      const fileUrl = pathToFileURL(filePath).href;
      const loaded = await registry.loadFromNpm(fileUrl);
      expect(loaded.name).toBe('npm-async-onload-plugin');
      expect(globalThis.__asyncNpmLoaded).toBe(true);
      delete globalThis.__asyncNpmLoaded;
    });
  });

  // =========================================================================
  // reload
  // =========================================================================

  describe('reload', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-reload-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should throw when reloading a non-existent plugin', async () => {
      await expect(registry.reload('not-registered')).rejects.toThrow(
        /not registered/,
      );
    });

    it('should throw when reloading a directly registered plugin', async () => {
      registry.register(makeValidPlugin({ name: 'direct-plugin' }));
      await expect(registry.reload('direct-plugin')).rejects.toThrow(
        /Cannot reload plugin.*registered directly/,
      );
    });

    it('should reload from npm source when source looks like a package', async () => {
      const npmTempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-npm-reload-'));
      const filePath = path.join(npmTempDir2, 'npm-reload-plugin.mjs');
      const plugin = makeValidPlugin({ name: 'my-npm-pkg', version: '1.0.0' });
      fs.writeFileSync(
        filePath,
        `const plugin = ${JSON.stringify(plugin)};\nexport default plugin;`,
        'utf-8',
      );
      const fileUrl = pathToFileURL(filePath).href;

      await registry.loadFromNpm(fileUrl);
      expect(registry.get('my-npm-pkg')!.version).toBe('1.0.0');

      // Reload should work (it goes through loadFromNpm again)
      await registry.reload('my-npm-pkg');
      expect(registry.get('my-npm-pkg')!.version).toBe('1.0.0');

      fs.rmSync(npmTempDir2, { recursive: true, force: true });
    });

    it('should hot-reload a plugin loaded from path', async () => {
      const filePath = path.join(tempDir, 'reload-plugin.cjs');
      // Write the plugin as executable code so functions are preserved
      fs.writeFileSync(
        filePath,
        'module.exports = { name: "hot-reload-plugin", version: "1.0.0", description: "test" };',
        'utf-8',
      );

      await registry.loadFromPath(filePath);
      expect(registry.get('hot-reload-plugin')!.version).toBe('1.0.0');

      // Update the file on disk with new version
      fs.writeFileSync(
        filePath,
        'module.exports = { name: "hot-reload-plugin", version: "2.0.0", description: "test" };',
        'utf-8',
      );

      await registry.reload('hot-reload-plugin');
      expect(registry.get('hot-reload-plugin')!.version).toBe('2.0.0');
    });

    it('should trigger onUnload during reload', async () => {
      let unloaded = false;
      const filePath = path.join(tempDir, 'reload-unload.cjs');
      // Write a module with onUnload that sets a global flag
      fs.writeFileSync(
        filePath,
        'const plugin = {' +
        '  name: "reload-unload-plugin",' +
        '  version: "1.0.0",' +
        '  description: "test",' +
        '  onUnload: function() { globalThis.__unloaded = true; }' +
        '};' +
        'module.exports = plugin;',
        'utf-8',
      );

      await registry.loadFromPath(filePath);
      // Verify the module was parsed as a plugin with onUnload
      const loadedPlugin = registry.get('reload-unload-plugin');
      expect(loadedPlugin).toBeDefined();
      expect(loadedPlugin!.onUnload).toBeDefined();

      // Now reload — this should trigger onUnload on the old instance
      fs.writeFileSync(
        filePath,
        'const plugin = {' +
        '  name: "reload-unload-plugin",' +
        '  version: "1.0.0",' +
        '  description: "test",' +
        '  onUnload: function() { globalThis.__unloaded = true; }' +
        '};' +
        'module.exports = plugin;',
        'utf-8',
      );
      globalThis.__unloaded = false;
      await registry.reload('reload-unload-plugin');
      expect(globalThis.__unloaded).toBe(true);
      delete globalThis.__unloaded;
    });
  });

  // =========================================================================
  // Size & isEmpty
  // =========================================================================

  describe('size and isEmpty', () => {
    it('should be empty initially', () => {
      expect(registry.isEmpty).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should not be empty after registering', () => {
      registry.register(makeValidPlugin({ name: 'p1' }));
      expect(registry.isEmpty).toBe(false);
      expect(registry.size).toBe(1);
    });
  });
});
