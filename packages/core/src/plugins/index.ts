// @code-analyzer/core — Plugins barrel
export type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginRuleResult,
  PluginLens,
  PluginLensFinding,
  PluginStandard,
  PluginStandardViolation,
  PluginMCPTool,
} from './plugin-interface.js';

export { PluginLoader } from './plugin-loader.js';
export { PluginRegistry } from './plugin-registry.js';
