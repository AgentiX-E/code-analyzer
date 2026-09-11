// @code-analyzer/core — Plugin Loader
// Dynamically loads plugins from file paths or node_modules packages.
// Supports CommonJS and ESM plugins with validation before registration.

import { isValidPlugin, getValidationErrors } from './plugin-interface.js';
import type { CodeAnalyzerPlugin } from './plugin-interface.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a dynamic import failed because the specifier could not be resolved.
 *
 * The `code` is the signal, and the reason is that the message is not stable:
 * Node words the same failure two different ways, reporting "Cannot find package
 * '<name>'" for an unresolvable bare specifier and "Cannot find module '<path>'"
 * for an unresolvable relative one. Matching on a single phrasing — as this used
 * to — silently never fires for the package case it exists to catch, while a
 * message check covering both phrasings is still unreachable on Node, which always
 * sets `code`. Test the structured field.
 */
function isModuleNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;

  const code: unknown = (err as { code?: unknown }).code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

// ---------------------------------------------------------------------------
// Plugin Loader
// ---------------------------------------------------------------------------

export class PluginLoader {
  private loadedCount = 0;

  /**
   * Load a plugin from a local file path.
   * The file must export a default or named export matching CodeAnalyzerPlugin.
   */
  async loadFromPath(pluginPath: string): Promise<CodeAnalyzerPlugin> {
    const resolvedPath = resolve(pluginPath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Plugin not found at path: ${resolvedPath}`);
    }

    // Dynamic import for ESM and CJS interop
    const module = (await import(resolvedPath)) as {
      default?: unknown;
      plugin?: unknown;
    };

    // Accept both default export and named 'plugin' export
    const candidate = module.default ?? module.plugin;

    if (!candidate) {
      throw new Error(
        `Plugin at "${resolvedPath}" does not export a default or named "plugin" export`,
      );
    }

    return this.validateAndReturn(candidate);
  }

  /**
   * Load a plugin from a node_modules package.
   * The package must export a default or named 'plugin' export.
   */
  async loadFromNpm(packageName: string): Promise<CodeAnalyzerPlugin> {
    try {
      const module = (await import(packageName)) as {
        default?: unknown;
        plugin?: unknown;
      };

      const candidate = module.default ?? module.plugin;

      if (!candidate) {
        throw new Error(
          `Package "${packageName}" does not export a default or named "plugin" export`,
        );
      }

      return this.validateAndReturn(candidate);
    } catch (err) {
      // Matching on "Cannot find module" alone left this branch unreachable for
      // the case it exists to handle: Node reports a missing *bare specifier* as
      // "Cannot find package", so every not-installed lookup fell through to
      // `throw err` and the caller saw ERR_MODULE_NOT_FOUND instead of this
      // message. The loose assertion in the old test (`/not installed|Cannot
      // find/`) accepted both, which is why nothing caught it.
      if (isModuleNotFound(err)) {
        throw new Error(`Package "${packageName}" is not installed`);
      }
      throw err;
    }
  }

  /**
   * Validate a candidate object against the CodeAnalyzerPlugin interface.
   */
  validatePlugin(candidate: unknown): candidate is CodeAnalyzerPlugin {
    return isValidPlugin(candidate);
  }

  /** Get the number of plugins loaded by this loader instance. */
  get totalLoaded(): number {
    return this.loadedCount;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private validateAndReturn(candidate: unknown): CodeAnalyzerPlugin {
    if (!isValidPlugin(candidate)) {
      const errors = getValidationErrors(candidate);
      throw new Error(`Invalid plugin: ${errors.join('; ')}`);
    }

    this.loadedCount++;
    return candidate as CodeAnalyzerPlugin;
  }
}
