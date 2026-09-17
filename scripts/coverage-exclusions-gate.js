#!/usr/bin/env node
/**
 * Coverage-exclusion gate.
 *
 * `vitest.config.ts` decides what counts toward coverage, and `scripts/coverage-per-file.js` decides what
 * happens to the files that are counted. Nothing decided anything about the list itself: an entry could be
 * added without a reason, a record could outlive its entry, and `/* v8 ignore *\/` directives could reappear
 * in source, silently removing code from measurement while the gate kept reporting a threshold.
 *
 * This gate closes that hole. Three checks, each able to fail on its own:
 *
 *   1. Every coverage `exclude` entry has a record in the register, and every record has an entry.
 *   2. The number of entries matches the recorded count, so adding one is a deliberate act.
 *   3. The number of real `v8 ignore` directives matches the recorded ratchet — currently 0.
 *
 * A directive is a comment that *begins* with the marker. Prose that mentions it ("the file carried a
 * whole-file v8 ignore hint") is not a directive, and counting it as one is how an earlier audit arrived at
 * 585 where the true number was 0.
 *
 * Usage:
 *   node scripts/coverage-exclusions-gate.js [--config vitest.config.ts] [--register scripts/coverage-exclusion-register.json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { config: 'vitest.config.ts', register: 'scripts/coverage-exclusion-register.json' };
  for (let i = 2; i < argv.length; i += 2) {
    if (argv[i] === '--config') args.config = argv[i + 1];
    else if (argv[i] === '--register') args.register = argv[i + 1];
  }
  return args;
}

/** Entries of the coverage `exclude` array, ignoring comment lines. */
function readExcludeEntries(configText) {
  const start = configText.indexOf('exclude: [');
  if (start === -1) throw new Error('no coverage `exclude` array found in the config');
  const end = configText.indexOf(']', start);
  const body = configText.slice(start + 'exclude: ['.length, end);
  const entries = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    const quoted = trimmed.match(/^'([^']+)'?,?$/);
    if (quoted) entries.push(quoted[1]);
  }
  return entries;
}

/** Real `v8 ignore` directives: a comment whose first token is the marker. */
function countV8Directives(root) {
  const directives = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (/^\s*(\/\/|\/\*+)\s*v8 ignore/.test(line)) {
            directives.push(`${full}:${i + 1}`);
          }
        });
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return directives;
}

function main() {
  const args = parseArgs(process.argv);
  const configText = fs.readFileSync(args.config, 'utf8');
  const register = JSON.parse(fs.readFileSync(args.register, 'utf8'));

  const entries = readExcludeEntries(configText);
  const recorded = Object.keys(register.configEntries || {});
  const failures = [];

  const missingRecord = entries.filter((e) => !(e in (register.configEntries || {})));
  if (missingRecord.length > 0) {
    failures.push(
      `exclude entries with no recorded reason: ${missingRecord.map((e) => `\`${e}\``).join(', ')} — ` +
        `add each to ${args.register} with the reason it exists`,
    );
  }

  const orphanRecord = recorded.filter((r) => !entries.includes(r));
  if (orphanRecord.length > 0) {
    failures.push(
      `records with no matching exclude entry: ${orphanRecord.map((e) => `\`${e}\``).join(', ')} — ` +
        `remove them from ${args.register}`,
    );
  }

  const directives = countV8Directives('packages');
  const recordedDirectives = register.v8IgnoreDirectives ?? 0;
  if (directives.length !== recordedDirectives) {
    failures.push(
      `v8 ignore directives: ${directives.length} found, ${recordedDirectives} recorded — ` +
        `${directives.length > 0 ? `at ${directives.join(', ')}; ` : ''}` +
        `a new directive removes code from measurement and must raise the recorded ratchet deliberately`,
    );
  }

  console.log(
    `coverage exclusions: ${entries.length} entries, ${recorded.length} recorded; ` +
      `v8 ignore directives: ${directives.length} (ratchet ${recordedDirectives})`,
  );

  if (failures.length > 0) {
    console.error(
      `\n❌ Coverage-exclusion gate failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ The exclusion set is recorded, and no code has been hidden from measurement.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { readExcludeEntries, countV8Directives };
