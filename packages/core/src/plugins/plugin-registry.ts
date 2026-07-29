/* v8 ignore file -- @preserve */
// @code-analyzer/core — Plugin Registry
// Central registry for managing loaded plugins.
// Aggregates rules, lenses, standards, and MCP tools from all registered plugins.

import type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginLens,
  PluginStandard,
  PluginMCPTool,
} from './plugin-interface.js';

// ---------------------------------------------------------------------------
// Plugin Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins: Map<string, CodeAnalyzerPlugin> = new Map();

  /**
   * Register a plugin. Throws if a plugin with the same name is already registered.
   */
  register(plugin: CodeAnalyzerPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Unregister a plugin by name. Returns true if the plugin was found and removed.
   */
  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  /**
   * Get a specific plugin by name.
   */
  get(name: string): CodeAnalyzerPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugins.
   */
  getAll(): CodeAnalyzerPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get aggregated analysis rules from all registered plugins.
   * Rules are deduplicated by id (first registered wins).
   */
  getRules(): PluginRule[] {
    const seen = new Set<string>();
    const rules: PluginRule[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.rules) continue;
      for (const rule of plugin.rules) {
        if (!seen.has(rule.id)) {
          seen.add(rule.id);
          rules.push(rule);
        }
      }
    }
    return rules;
  }

  /**
   * Get aggregated review lenses from all registered plugins.
   * Lenses are deduplicated by id (first registered wins).
   */
  getLenses(): PluginLens[] {
    const seen = new Set<string>();
    const lenses: PluginLens[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.lenses) continue;
      for (const lens of plugin.lenses) {
        if (!seen.has(lens.id)) {
          seen.add(lens.id);
          lenses.push(lens);
        }
      }
    }
    return lenses;
  }

  /**
   * Get aggregated project standards from all registered plugins.
   */
  getStandards(): PluginStandard[] {
    const seen = new Set<string>();
    const standards: PluginStandard[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.standards) continue;
      for (const std of plugin.standards) {
        if (!seen.has(std.id)) {
          seen.add(std.id);
          standards.push(std);
        }
      }
    }
    return standards;
  }

  /**
   * Get aggregated MCP tools from all registered plugins.
   * Tools are deduplicated by name (first registered wins).
   */
  getMCPTools(): PluginMCPTool[] {
    const seen = new Set<string>();
    const tools: PluginMCPTool[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.mcpTools) continue;
      for (const tool of plugin.mcpTools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  /**
   * Reload a plugin by name. Unloads it (calls onUnload if present),
   * then removes it from the registry. The caller is responsible for
   * re-loading and re-registering the new version.
   */
  async reload(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // Call onUnload lifecycle hook
    if (plugin.onUnload) {
      await Promise.resolve(plugin.onUnload());
    }

    this.plugins.delete(name);
    return true;
  }

  /**
   * Check if a plugin with the given name is registered.
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get the number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance
// ---------------------------------------------------------------------------

/** Global plugin registry singleton */
let globalRegistry: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry();
  }
  return globalRegistry;
}

export function resetPluginRegistry(): void {
  globalRegistry = null;
}
