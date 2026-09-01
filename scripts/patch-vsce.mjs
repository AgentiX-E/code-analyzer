// @code-analyzer — patch @vscode/vsce to tolerate `npm list` peer conflicts
//
// `@vscode/vsce` collects a VS Code extension's runtime dependencies by running
// `npm list --production --parseable --depth=99999` and treating any non-zero
// exit code as a fatal error. That assumption breaks for this repository:
//
//   tree-sitter 0.25 changed the grammar ABI, but several grammar packages
//   (tree-sitter-typescript, tree-sitter-java, tree-sitter-rust, ...) still
//   declare a peer range of `^0.21`/`^0.22`. npm therefore reports the resolved
//   `tree-sitter` as "invalid" and exits with ELSPROBLEMS — even though the
//   `--parseable` output on stdout still lists every dependency path correctly.
//
// This script patches the globally installed vsce so `getNpmDependencies`
// consumes stdout regardless of the exit code (rejecting only when npm produced
// no output at all). The patch is idempotent and fails loudly if the expected
// implementation is no longer found (i.e. vsce was upgraded).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = 'consume stdout regardless of the exit code';

const OLD = [
  'function getNpmDependencies(cwd) {',
  '    return checkNPM()',
  "        .then(() => exec('npm list --production --parseable --depth=99999 --loglevel=error', { cwd, maxBuffer: 5000 * 1024 }))",
  '        .then(({ stdout }) => stdout.split(/[\\r\\n]/).filter(dir => path.isAbsolute(dir)));',
  '}',
].join('\n');

const NEW = [
  'function getNpmDependencies(cwd) {',
  '    return checkNPM()',
  '        .then(() => new Promise((resolve, reject) => {',
  '            // ' + MARKER,
  "            cp.exec('npm list --production --parseable --depth=99999 --loglevel=error', { cwd, maxBuffer: 5000 * 1024, encoding: 'utf8' }, (err, stdout) => {",
  '                if (stdout) {',
  '                    resolve(stdout);',
  '                }',
  '                else if (err) {',
  '                    reject(err);',
  '                }',
  '                else {',
  "                    resolve('');",
  '                }',
  '            });',
  '        }))',
  '        .then(stdout => stdout.split(/[\\r\\n]/).filter(dir => path.isAbsolute(dir)));',
  '}',
].join('\n');

const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const npmJsPath = join(npmRoot, '@vscode', 'vsce', 'out', 'npm.js');

const source = readFileSync(npmJsPath, 'utf8');

if (source.includes(MARKER)) {
  console.log('[patch-vsce] already patched — no-op');
  process.exit(0);
}

if (!source.includes(OLD)) {
  console.error(
    '[patch-vsce] ERROR: could not locate the expected getNpmDependencies implementation.\n' +
      `            vsce at ${npmJsPath} may have been upgraded; update this script to match.`,
  );
  process.exit(1);
}

writeFileSync(npmJsPath, source.replace(OLD, NEW));
console.log(`[patch-vsce] patched ${npmJsPath}`);
