// @code-analyzer/core — plugin fixture (default export)
//
// Exists so `PluginLoader.loadFromNpm()` can be driven over a module that really
// resolves. A relative specifier is resolved against the loader, which is the
// same code path a real published package takes. Excluded from coverage by the
// `**/fixtures/**` pattern.
import type { CodeAnalyzerPlugin } from '../plugin-interface.js';

const plugin: CodeAnalyzerPlugin = {
  name: 'fixture-default',
  version: '1.0.0',
  description: 'A fixture plugin exported as the default export',
};

export default plugin;
