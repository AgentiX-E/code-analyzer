// @code-analyzer/core — plugin fixture (no plugin export)
//
// Keeps a module that resolves but carries no plugin, so the loader's
// "does not export a default or named plugin export" branch stays reachable.
export const somethingElse = 'not a plugin';
