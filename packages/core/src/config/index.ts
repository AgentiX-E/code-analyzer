// @code-analyzer/core — Configuration System
// Full implementation with layered config loading and validation

export type { CodeAnalyzerConfig } from '@code-analyzer/shared';
export { getDefaultConfig } from './defaults.js';
export { loadConfig, deepMerge } from './loader.js';
export { validateConfig } from './validator.js';
export type { ValidationError } from './validator.js';
