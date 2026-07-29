// @code-analyzer/core — Plugin Registry
// Singleton registry for managing loaded plugins.
// Aggregates rules, lenses, standards, and MCP tools across all plugins.

import type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginLens,
  PluginStandard,
  PluginMCPTool,
} from './plugin-interface.js';

import { PluginLoader } from './plugin-loader.js';

// ---------------------------------------------------------------------------
// Registered Plugin Entry
// ---------------------------------------------------------------------------

interface PluginEntry {
  plugin: CodeAnalyzerPlugin;
  source: string;
}

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

/**
 * Singleton registry that holds all loaded plugins.
 *
 * Usage:
 * ```ts
 * const registry = PluginRegistry.getInstance();
 * await registry.loadFromPath('./my-plugin');
 * const rules = registry.getRules();
 * ```
 */
export class PluginRegistry {
  private static instance: PluginRegistry | null = null;

  private plugins: Map<string, PluginEntry> = new Map();
  private loader: PluginLoader;

  private constructor() {
    this.loader = new PluginLoader();
  }

  /** Get the singleton PluginRegistry instance. */
  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  /** Reset the singleton (for testing). */
  static resetInstance(): void {
    // Synchronously trigger unload for all plugins before clearing
    const registry = PluginRegistry.instance;
    if (registry) {
      for (const { plugin } of registry.plugins.values()) {
        if (plugin.onUnload) {
          try {
            plugin.onUnload();
          } catch {
            // Silently ignore unload failures during reset.
          }
        }
      }
      registry.plugins.clear();
    }
    PluginRegistry.instance = null;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a plugin object directly.
   * Throws if a plugin with the same name is already registered.
   */
  register(plugin: CodeAnalyzerPlugin): void {
    if (!this.loader.validatePlugin(plugin)) {
      throw new Error(
        `Invalid plugin: "${(plugin as { name?: string }).name ?? 'unknown'}". Ensure it has name, version, and description.`,
      );
    }

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered. Unregister it first or use reload().`);
    }

    this.plugins.set(plugin.name, { plugin, source: 'direct' });

    if (plugin.onLoad) {
      const result = plugin.onLoad();
      if (result instanceof Promise) {
        result.catch(() => {
          // Silently handle async onLoad errors.
        });
      }
    }
  }

  /**
   * Unregister a plugin by name.
   * Calls the plugin's onUnload hook if defined.
   * Returns true if the plugin was found and removed.
   */
  unregister(name: string): boolean {
    const entry = this.plugins.get(name);
    if (!entry) return false;

    if (entry.plugin.onUnload) {
      try {
        entry.plugin.onUnload();
      } catch {
        // Silently ignore unload failures.
      }
    }

    return this.plugins.delete(name);
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load a plugin from a local path and register it.
   */
  async loadFromPath(pluginPath: string): Promise<CodeAnalyzerPlugin> {
    const plugin = await this.loader.loadFromPath(pluginPath);
    this.plugins.set(plugin.name, { plugin, source: pluginPath });
    if (plugin.onLoad) {
      const result = plugin.onLoad();
      if (result instanceof Promise) {
        await result;
      }
    }
    return plugin;
  }

  /**
   * Load a plugin from npm.
   */
  async loadFromNpm(packageName: string): Promise<CodeAnalyzerPlugin> {
    const plugin = await this.loader.loadFromNpm(packageName);
    this.plugins.set(plugin.name, { plugin, source: packageName });
    if (plugin.onLoad) {
      const result = plugin.onLoad();
      if (result instanceof Promise) {
        await result;
      }
    }
    return plugin;
  }

  /**
   * Hot-reload a plugin by name.
   * Unloads the existing instance and reloads from its source.
   * For direct registrations, the source is lost and reload will fail.
   */
  async reload(name: string): Promise<CodeAnalyzerPlugin> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" is not registered.`);
    }

    // Unload the existing instance.
    if (entry.plugin.onUnload) {
      try {
        await entry.plugin.onUnload();
      } catch {
        // Silently ignore.
      }
    }

    this.plugins.delete(name);

    // Reload
    if (entry.source === 'direct') {
      // Cannot reload direct registrations.
      throw new Error(
        `Cannot reload plugin "${name}": it was registered directly (no source path).`,
      );
    }

    if (
      entry.source.includes('node_modules') ||
      entry.source.startsWith('file://') ||
      !entry.source.includes('/')
    ) {
      return this.loadFromNpm(entry.source);
    }

    return this.loadFromPath(entry.source);
  }

  // -------------------------------------------------------------------------
  // Aggregation / Queries
  // -------------------------------------------------------------------------

  /** Get all currently registered plugins. */
  getAll(): CodeAnalyzerPlugin[] {
    return Array.from(this.plugins.values()).map((e) => e.plugin);
  }

  /** Get a specific plugin by name. */
  get(name: string): CodeAnalyzerPlugin | undefined {
    const entry = this.plugins.get(name);
    return entry ? entry.plugin : undefined;
  }

  /** Aggregate all rules from all plugins. */
  getRules(): PluginRule[] {
    const rules: PluginRule[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.plugin.rules) {
        rules.push(...entry.plugin.rules);
      }
    }
    return rules;
  }

  /** Aggregate all lenses from all plugins. */
  getLenses(): PluginLens[] {
    const lenses: PluginLens[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.plugin.lenses) {
        lenses.push(...entry.plugin.lenses);
      }
    }
    return lenses;
  }

  /** Aggregate all standards from all plugins. */
  getStandards(): PluginStandard[] {
    const standards: PluginStandard[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.plugin.standards) {
        standards.push(...entry.plugin.standards);
      }
    }
    return standards;
  }

  /** Aggregate all MCP tools from all plugins. */
  getMCPTools(): PluginMCPTool[] {
    const tools: PluginMCPTool[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.plugin.mcpTools) {
        tools.push(...entry.plugin.mcpTools);
      }
    }
    return tools;
  }

  /** Get the total number of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }

  /** Check whether the registry has any plugins. */
  get isEmpty(): boolean {
    return this.plugins.size === 0;
  }
}
