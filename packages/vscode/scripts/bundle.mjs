// @code-analyzer/vscode — Extension bundling script
//
// Bundles the VS Code extension (and every inlined `@code-analyzer/*` workspace
// package) into a single self-contained CommonJS file at
// `dist/extension/extension.js`.
//
// Why bundling? The VS Code Marketplace packager (`@vscode/vsce`) resolves the
// extension's runtime dependencies with `npm list --production`, which cannot
// traverse a pnpm isolated/workspace layout (the `workspace:*` protocol does not
// survive installation, and vsce does not follow symlinks). Inlining the
// workspace packages removes them from the dependency graph, leaving only real
// third-party packages for vsce to ship.
//
// Bundling policy:
//   - `packages: 'bundle'` inlines the workspace packages (`@code-analyzer/*`).
//   - Everything else that the runtime must `require()`/`import()` is marked
//     `external` below. Native addons (tree-sitter, onnxruntime-node,
//     better-sqlite3) cannot be bundled — esbuild has no `.node` loader — and
//     the VS Code API (`vscode`) is injected by the editor host at runtime.
//
// This list is the single source of truth for the extension's external surface.
// Every entry falls into one of four categories, documented inline.

import esbuild from 'esbuild';

const entryPoint = 'src/extension/extension.ts';
const outfile = 'dist/extension/extension.js';

// --- 1. VS Code host API -----------------------------------------------------
// Provided by the editor process; never resolvable at bundle time.
const vsCodeApi = ['vscode'];

// --- 2. Native tree-sitter runtime + grammar packages ------------------------
// tree-sitter is a native addon (`.node`). Grammar packages are loaded via
// dynamic `require(pkg)` (see `GRAMMAR_PACKAGES` in the intelligence rules
// engine and each `packages/analyzer/src/languages/*` provider), so they must
// remain resolvable from node_modules at runtime instead of being inlined.
const treeSitter = [
  'tree-sitter',
  'tree-sitter-bash',
  'tree-sitter-c',
  'tree-sitter-c-sharp',
  'tree-sitter-cpp',
  'tree-sitter-css',
  'tree-sitter-dart',
  'tree-sitter-elixir',
  'tree-sitter-go',
  'tree-sitter-groovy',
  'tree-sitter-html',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-json',
  'tree-sitter-kotlin',
  'tree-sitter-lua',
  'tree-sitter-php',
  'tree-sitter-python',
  'tree-sitter-ruby',
  'tree-sitter-rust',
  'tree-sitter-scala',
  'tree-sitter-sql',
  'tree-sitter-swift',
  'tree-sitter-toml',
  'tree-sitter-typescript',
  'tree-sitter-yaml',
  'tree-sitter-zig',
  '@eagleoutice/tree-sitter-r',
  '@tree-sitter-grammars/tree-sitter-hcl',
];

// --- 3. Embedding backend (ONNX) --------------------------------------------
// `@agentix-e/embed-code-node` is loaded lazily via `await import(...)` inside
// `EmbeddingEngine.initialize()` and pulls in the native `onnxruntime-node`
// addon. All three must stay external so the ONNX runtime ships in node_modules
// and the model can be downloaded at runtime (`npx embed-code download`).
const embedding = ['@agentix-e/embed-code-core', '@agentix-e/embed-code-node', 'onnxruntime-node'];

// --- 4. Optional native storage ---------------------------------------------
// `better-sqlite3` is an optional dependency of `@code-analyzer/infra`, loaded
// lazily with a guarded `require(...)`. It is a native addon and must not be
// bundled, even though most deployments never exercise that code path.
const nativeStorage = ['better-sqlite3'];

const external = [...vsCodeApi, ...treeSitter, ...embedding, ...nativeStorage];

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  // Inline workspace packages (`@code-analyzer/*`); honor the external list.
  packages: 'bundle',
  external,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  // The extension depends on `@types/vscode` for types and `vscode` for the
  // runtime API; resolution must start from this package's directory.
  absWorkingDir: new URL('..', import.meta.url).pathname,
};

const result = await esbuild.build(options);

const warnings = result.warnings ?? [];
if (warnings.length > 0) {
  for (const warning of warnings) {
    console.warn(`[bundle] warning: ${warning.text}`);
  }
}

// When `outfile` is set, esbuild writes directly to disk and `outputFiles`
// is empty; the bundle is verified by its on-disk size in the summary line.
const outputFiles = result.outputFiles?.length ?? 0;
console.log(`[bundle] wrote ${outfile}${outputFiles > 0 ? ` (${outputFiles} output files)` : ''}`);
