// @code-analyzer/core — Configuration System
// Full implementation with layered config loading and validation

export type { CodeAnalyzerConfig } from '@code-analyzer/shared';
export { getDefaultConfig } from './defaults.js';
export {
  canonicalProjectConfigPath,
  deepMerge,
  globalConfigPath,
  legacyProjectConfigPath,
  loadConfig,
  loadConfigWithDiagnostics,
} from './loader.js';
export type {
  ConfigLayer,
  ConfigLayerName,
  IgnoredSetting,
  LoadConfigOptions,
  LoadedConfig,
} from './loader.js';
export { validateConfig } from './validator.js';
export type { ValidationError } from './validator.js';
