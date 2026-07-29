// @code-analyzer/core — Plugins barrel
export type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginRuleResult,
  PluginRuleContext,
  PluginLens,
  PluginLensFinding,
  PluginLensContext,
  PluginStandard,
  PluginMCPTool,
} from './plugin-interface.js';

export { PluginLoader } from './plugin-loader.js';
export { PluginRegistry, getPluginRegistry, resetPluginRegistry } from './plugin-registry.js';
