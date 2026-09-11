// @code-analyzer/core — plugin fixture (named export, no default)
//
// Covers the other half of the loader's `module.default ?? module.plugin` lookup:
// a package that publishes only the named form.
import type { CodeAnalyzerPlugin } from '../plugin-interface.js';

export const plugin: CodeAnalyzerPlugin = {
  name: 'fixture-named',
  version: '1.0.0',
  description: 'A fixture plugin exported under the name "plugin"',
};
