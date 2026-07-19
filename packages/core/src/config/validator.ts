import { validateConfig as validateSharedConfig } from '@code-analyzer/shared';

import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

/**
 * A validation error produced during config validation.
 */
export interface ValidationError {
  /** The config key path that failed validation (dot-separated). */
  path: string;
  /** Human-readable error message. */
  message: string;
}

/**
 * Validate a configuration object against the Code Analyzer schema.
 * First validates the shape (unknown -> roughly config-like), then delegates
 * to the shared validator for detailed field-level validation.
 *
 * @param config - The configuration object to validate.
 * @returns An array of ValidationError objects. Empty array means valid.
 */
export function validateConfig(config: unknown): ValidationError[] {
  if (config === null || config === undefined) {
    return [{ path: '', message: 'Configuration must not be null or undefined' }];
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    return [
      {
        path: '',
        message: `Configuration must be a plain object, got ${typeof config}`,
      },
    ];
  }

  // Delegate detailed validation to the shared package
  const sharedErrors = validateSharedConfig(config as CodeAnalyzerConfig);

  return sharedErrors.map((msg: string) => {
    // Extract a path from the shared error message if possible
    // Shared errors follow the format "config.<key> ..."
    const pathMatch = msg.match(/^config\.(?<key>[a-zA-Z0-9.]+)\s/);
    const path = pathMatch?.groups?.['key'] ?? '';
    return { path, message: msg };
  });
}
