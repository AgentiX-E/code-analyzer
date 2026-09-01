// @code-analyzer/vscode — production manifest preparation
//
// Strips `devDependencies` from `packages/vscode/package.json` and writes the
// result back, so a subsequent `npm install --omit=dev` can produce a standard,
// flat `node_modules` tree.
//
// Why this is necessary: `@vscode/vsce` resolves the extension's runtime
// dependencies with `npm list --production` and copies them without following
// symlinks. A pnpm layout (symlinked `node_modules/.pnpm`) would yield broken
// links inside the `.vsix`. Reinstalling the production-only tree with npm
// produces a real directory layout vsce can traverse.
//
// The `devDependencies` block also contains `@code-analyzer/*` entries with the
// pnpm `workspace:*` protocol, which npm cannot resolve (EUNSUPPORTEDPROTOCOL)
// even with `--omit=dev`. Removing the block entirely sidesteps that error.
// Those workspace packages are already inlined into the esbuild bundle, so they
// are not needed at install time.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = resolve(fileURLToPath(new URL('..', import.meta.url)), 'package.json');

const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));

if (!manifest.devDependencies) {
  console.log('[prepare-prod] no devDependencies to strip');
} else {
  delete manifest.devDependencies;
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('[prepare-prod] stripped devDependencies from package.json');
}
