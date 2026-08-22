// @code-analyzer/core — Plugin Registry Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../plugins/plugin-registry.js';
import type { CodeAnalyzerPlugin } from '../plugins/plugin-interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides: Partial<CodeAnalyzerPlugin> = {}): CodeAnalyzerPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'Test plugin',
    ...overrides,
  };
}

function makeRulePlugin(name: string, ruleId: string): CodeAnalyzerPlugin {
  return makePlugin({
    name,
    rules: [
      {
        id: ruleId,
        name: 'Test Rule',
        category: 'bug',
        severity: 'high',
        description: 'A test rule',
        check: () => null,
      },
    ],
  });
}

function makeLensPlugin(name: string, lensId: string): CodeAnalyzerPlugin {
  return makePlugin({
    name,
    lenses: [
      {
        id: lensId,
        name: 'Test Lens',
        description: 'A test lens',
        scan: () => [],
      },
    ],
  });
}

function makeToolPlugin(name: string, toolName: string): CodeAnalyzerPlugin {
  return makePlugin({
    name,
    mcpTools: [
      {
        name: toolName,
        description: 'A test tool',
        schema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('register', () => {
    it('should register a plugin', () => {
      registry.register(makePlugin());
      expect(registry.size).toBe(1);
    });

    it('should throw on duplicate registration', () => {
      registry.register(makePlugin({ name: 'dup' }));
      expect(() => registry.register(makePlugin({ name: 'dup' }))).toThrow(/already registered/);
    });

    it('should allow plugins with different names', () => {
      registry.register(makePlugin({ name: 'a' }));
      registry.register(makePlugin({ name: 'b' }));
      expect(registry.size).toBe(2);
    });
  });

  describe('unregister', () => {
    it('should remove a registered plugin', () => {
      registry.register(makePlugin({ name: 'rm' }));
      expect(registry.unregister('rm')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for non-existent plugin', () => {
      expect(registry.unregister('nope')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return a registered plugin', () => {
      const plugin = makePlugin({ name: 'getter' });
      registry.register(plugin);
      expect(registry.get('getter')).toBe(plugin);
    });

    it('should return undefined for unknown name', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered plugins', () => {
      registry.register(makePlugin({ name: 'p1' }));
      registry.register(makePlugin({ name: 'p2' }));
      expect(registry.getAll()).toHaveLength(2);
    });

    it('should return empty array with no plugins', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getRules', () => {
    it('should aggregate rules from all plugins', () => {
      registry.register(makeRulePlugin('p1', 'rule-1'));
      registry.register(makeRulePlugin('p2', 'rule-2'));
      expect(registry.getRules()).toHaveLength(2);
    });

    it('should deduplicate rules by id', () => {
      registry.register(makeRulePlugin('p1', 'same-id'));
      registry.register(makeRulePlugin('p2', 'same-id'));
      expect(registry.getRules()).toHaveLength(1);
    });

    it('should handle plugins with no rules', () => {
      registry.register(makePlugin({ name: 'no-rules' }));
      expect(registry.getRules()).toEqual([]);
    });
  });

  describe('getLenses', () => {
    it('should aggregate lenses from all plugins', () => {
      registry.register(makeLensPlugin('p1', 'lens-1'));
      registry.register(makeLensPlugin('p2', 'lens-2'));
      expect(registry.getLenses()).toHaveLength(2);
    });

    it('should deduplicate lenses by id', () => {
      registry.register(makeLensPlugin('p1', 'dup'));
      registry.register(makeLensPlugin('p2', 'dup'));
      expect(registry.getLenses()).toHaveLength(1);
    });
  });

  describe('getStandards', () => {
    it('should aggregate standards', () => {
      registry.register(
        makePlugin({
          name: 'std-plugin',
          standards: [{ id: 'std-1', name: 'Standard 1', category: 'security', rules: [] }],
        }),
      );
      expect(registry.getStandards()).toHaveLength(1);
    });

    it('should deduplicate by id', () => {
      const std = { id: 'std-dup', name: 'Std', category: 'quality', rules: [] };
      registry.register(makePlugin({ name: 'a', standards: [std] }));
      registry.register(makePlugin({ name: 'b', standards: [std] }));
      expect(registry.getStandards()).toHaveLength(1);
    });
  });

  describe('getMCPTools', () => {
    it('should aggregate MCP tools', () => {
      registry.register(makeToolPlugin('p1', 'tool-1'));
      registry.register(makeToolPlugin('p2', 'tool-2'));
      expect(registry.getMCPTools()).toHaveLength(2);
    });

    it('should deduplicate tools by name', () => {
      registry.register(makeToolPlugin('p1', 'dup-tool'));
      registry.register(makeToolPlugin('p2', 'dup-tool'));
      expect(registry.getMCPTools()).toHaveLength(1);
    });
  });

  describe('has', () => {
    it('should return true for registered plugin', () => {
      registry.register(makePlugin({ name: 'check' }));
      expect(registry.has('check')).toBe(true);
    });

    it('should return false for unknown plugin', () => {
      expect(registry.has('no')).toBe(false);
    });
  });

  describe('reload', () => {
    it('should call onUnload and remove plugin', async () => {
      let unloaded = false;
      registry.register(
        makePlugin({
          name: 'reload-me',
          onUnload: () => {
            unloaded = true;
          },
        }),
      );
      const result = await registry.reload('reload-me');
      expect(result).toBe(true);
      expect(unloaded).toBe(true);
      expect(registry.has('reload-me')).toBe(false);
    });

    it('should return false for non-existent plugin', async () => {
      expect(await registry.reload('nope')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('getPluginRegistry / resetPluginRegistry', () => {
  it('should return the same singleton instance', async () => {
    const { getPluginRegistry, resetPluginRegistry } =
      await import('../plugins/plugin-registry.js');
    resetPluginRegistry();
    const a = getPluginRegistry();
    const b = getPluginRegistry();
    expect(a).toBe(b);
    resetPluginRegistry();
  });
});
