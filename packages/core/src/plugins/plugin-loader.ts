// @code-analyzer/core — Plugin Loader
// Loads plugins from the local file system or node_modules.
// Supports both CommonJS (CJS) and ECMAScript Module (ESM) plugin formats.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import type { CodeAnalyzerPlugin } from './plugin-interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a `require` function scoped to the caller.
 * Uses `__filename` for CJS compatibility (this package is compiled as CJS).
 */
function getRequire(): NodeRequire {
  return createRequire(__filename);
}

/**
 * Check whether a value is a non-null object (excludes arrays).
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate that a plugin value is a string and not empty.
 */
function isValidString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a version string looks like semver (major.minor.patch).
 */
function isValidVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+/.test(value);
}

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

export class PluginLoader {
  /**
   * Load a plugin from a local file-system path.
   *
   * Accepts:
   * - A directory path (looks for index.js/index.mjs/index.cjs)
   * - A file path (must end in .js, .mjs, .cjs, .ts)
   *
   * ESM files are loaded via dynamic `import()`.
   * CJS files are loaded via `createRequire`.
   */
  async loadFromPath(pluginPath: string): Promise<CodeAnalyzerPlugin> {
    const resolved = this.resolvePluginPath(pluginPath);
    const mod = await this.loadModule(resolved);
    return this.extractPlugin(mod, resolved);
  }

  /**
   * Load a plugin from node_modules by package name.
   *
   * Uses `createRequire` to resolve the package entry point at the caller's
   * module resolution scope. Falls back to `import()` for ESM-only packages.
   */
  async loadFromNpm(packageName: string): Promise<CodeAnalyzerPlugin> {
    let mod: unknown;

    // Try ESM first (works for both CJS and ESM packages).
    try {
      mod = await import(packageName);
    } catch {
      // Fall back to CJS require.
      try {
        const req = getRequire();
        mod = req(packageName);
      } catch (requireErr: unknown) {
        const msg = requireErr instanceof Error ? requireErr.message : String(requireErr);
        throw new Error(
          `Failed to load plugin "${packageName}" from node_modules: ${msg}`,
        );
      }
    }

    return this.extractPlugin(mod, packageName);
  }

  /**
   * Validate a plugin object against the CodeAnalyzerPlugin interface.
   * Returns a type predicate — if true, the value conforms to the interface.
   */
  validatePlugin(plugin: unknown): plugin is CodeAnalyzerPlugin {
    if (!isObject(plugin)) return false;

    if (!isValidString(plugin['name'])) return false;
    if (!isValidVersion(String(plugin['version']))) return false;
    if (!isValidString(plugin['description'])) return false;

    // onLoad/onUnload are optional — validate only if present.
    if (plugin['onLoad'] !== undefined && typeof plugin['onLoad'] !== 'function') return false;
    if (plugin['onUnload'] !== undefined && typeof plugin['onUnload'] !== 'function') return false;

    // Validate rules array if present.
    if (plugin['rules'] !== undefined) {
      if (!Array.isArray(plugin['rules'])) return false;
      for (const rule of plugin['rules'] as unknown[]) {
        if (!isObject(rule)) return false;
        if (!isValidString(rule['id'])) return false;
        if (typeof rule['check'] !== 'function') return false;
      }
    }

    // Validate lenses array if present.
    if (plugin['lenses'] !== undefined) {
      if (!Array.isArray(plugin['lenses'])) return false;
      for (const lens of plugin['lenses'] as unknown[]) {
        if (!isObject(lens)) return false;
        if (!isValidString(lens['id'])) return false;
        if (typeof lens['scan'] !== 'function') return false;
      }
    }

    // Validate standards array if present.
    if (plugin['standards'] !== undefined) {
      if (!Array.isArray(plugin['standards'])) return false;
      for (const std of plugin['standards'] as unknown[]) {
        if (!isObject(std)) return false;
        if (!isValidString(std['id'])) return false;
        if (typeof std['check'] !== 'function') return false;
      }
    }

    // Validate MCP tools if present.
    if (plugin['mcpTools'] !== undefined) {
      if (!Array.isArray(plugin['mcpTools'])) return false;
      for (const tool of plugin['mcpTools'] as unknown[]) {
        if (!isObject(tool)) return false;
        if (!isValidString(tool['name'])) return false;
        if (typeof tool['handler'] !== 'function') return false;
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a plugin path to an actual loadable file path.
   */
  private resolvePluginPath(pluginPath: string): string {
    const abs = path.isAbsolute(pluginPath)
      ? pluginPath
      : path.resolve(pluginPath);

    if (!fs.existsSync(abs)) {
      throw new Error(`Plugin path does not exist: ${abs}`);
    }

    const stat = fs.statSync(abs);

    // Directory — look for index.*
    if (stat.isDirectory()) {
      for (const candidate of ['index.js', 'index.mjs', 'index.cjs']) {
        const candidatePath = path.join(abs, candidate);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
      throw new Error(`No loadable entry file found in directory: ${abs}`);
    }

    // File — ensure it has a supported extension.
    const ext = path.extname(abs);
    if (!['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
      throw new Error(
        `Unsupported plugin file extension "${ext}". Expected .js, .mjs, .cjs, or .ts.`,
      );
    }

    return abs;
  }

  /**
   * Load a module from the given file path.
   */
  private async loadModule(filePath: string): Promise<unknown> {
    const ext = path.extname(filePath);

    // .mjs and .ts — always use dynamic import (ESM).
    if (ext === '.mjs' || ext === '.ts') {
      // Add cache busting timestamp for ESM to force re-evaluation.
      const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
      return import(fileUrl);
    }

    // .cjs — always use createRequire (CommonJS).
    // Clear require cache to support hot-reloading.
    if (ext === '.cjs') {
      this.clearRequireCache(filePath);
      const req = getRequire();
      return req(filePath);
    }

    // .js — try ESM first, fall back to CJS.
    try {
      const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
      return await import(fileUrl);
    } catch {
      this.clearRequireCache(filePath);
      const req = getRequire();
      return req(filePath);
    }
  }

  /**
   * Clear the Node.js require cache for a given file path.
   * This allows hot-reloading of CJS plugins.
   */
  private clearRequireCache(filePath: string): void {
    try {
      const req = getRequire();
      const resolvedPath = req.resolve(filePath);
      delete req.cache[resolvedPath];
    } catch {
      // If resolve fails, the module wasn't cached — that's fine.
    }
  }

  /**
   * Extract a CodeAnalyzerPlugin from a loaded module.
   * Supports default export, named `plugin` export, and module that IS the plugin.
   */
  private extractPlugin(mod: unknown, source: string): CodeAnalyzerPlugin {
    const candidates: unknown[] = [];

    if (isObject(mod)) {
      const m = mod as Record<string, unknown>;
      if (typeof m['default'] === 'object' && m['default'] !== null) {
        candidates.push(m['default']);
      }
      if (typeof m['plugin'] === 'object' && m['plugin'] !== null) {
        candidates.push(m['plugin']);
      }
      if (isValidString(m['name']) && m['name'] !== 'default' && m['name'] !== 'plugin') {
        candidates.push(m);
      }
    }

    for (const candidate of candidates) {
      if (this.validatePlugin(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `Failed to extract a valid CodeAnalyzerPlugin from "${source}". ` +
      `Ensure the module exports a default CodeAnalyzerPlugin, a named "plugin" export, or IS a CodeAnalyzerPlugin.`,
    );
  }
}
