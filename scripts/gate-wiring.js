#!/usr/bin/env node
/**
 * Gate-wiring gate.
 *
 * `baseline-anchors-gate.js` was a correct, tested, and entirely uninvoked script until two workflow files were
 * edited by hand. Nothing could tell the difference between a gate that guards a pull request and a gate that
 * guards nothing — both are a file in `scripts/` with tests beside it — so the repository accumulated guards that
 * never guarded, and the only way to find one was to grep by hand and hope the name was not also a substring of
 * something larger.
 *
 * This gate answers the question for every script at once. A script is **wired** when a workflow names it, when a
 * workflow invokes a `package.json` script that names it, or when another wired script requires it. It is
 * **registered** when a human wrote down, in `scripts/gate-wiring-register.json`, why it does not need to be wired
 * — a local tool that needs a credential, for instance. It is **orphaned** otherwise, and that fails.
 *
 * Three details are deliberate:
 *
 *   1. **A file name matches with a boundary.** `scripts/benchmark.js` is not named by a workflow that runs
 *      `scripts/benchmark.ts`, and an early hand-written audit counted exactly that as coverage.
 *   2. **A `package.json` script counts only when a workflow runs it.** Naming a script is free; a name nothing
 *      invokes is the thing being measured, not the thing that measures.
 *   3. **The register is checked in both directions.** An entry that has since become wired is a stale record, and
 *      a record that outlives its file is the defect this repository already recorded once, in the coverage
 *      exclusion register.
 *
 * Usage:
 *   node scripts/gate-wiring.js [--repo .] [--register scripts/gate-wiring-register.json] [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_ROOTS = ['scripts', '.github/scripts'];
const EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts'];
const DEFAULT_REGISTER = path.join('scripts', 'gate-wiring-register.json');

function parseArgs(argv) {
  const args = { repo: '.', register: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--register') args.register = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  if (args.register === null) args.register = path.join(args.repo, DEFAULT_REGISTER);
  return args;
}

/** Script files, relative to the repository root, with POSIX separators. */
function collectScripts(repo) {
  const found = [];
  for (const root of SCRIPT_ROOTS) {
    const dir = path.join(repo, root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!EXTENSIONS.includes(path.extname(name))) continue;
      const abs = path.join(dir, name);
      if (!fs.statSync(abs).isFile()) continue;
      found.push(path.posix.join(root, name));
    }
  }
  return found.sort();
}

function readWorkflowText(repo) {
  const dir = path.join(repo, '.github', 'workflows');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf-8'))
    .join('\n');
}

/**
 * Script names a workflow runs through the package manager. `npm run -s x` and `pnpm -s x` are the same call as
 * `npm run x`, and both spellings appear in this repository.
 */
function calledScriptNames(workflowText) {
  const cleaned = workflowText
    .replace(/\b(npm|pnpm|yarn)\s+run\s+(?:-s|--silent)\s+/g, '$1 run ')
    .replace(/\b(pnpm|yarn)\s+(?:-s|--silent)\s+/g, '$1 ');
  const names = new Set();
  const pattern = /\b(?:npm\s+run|pnpm\s+run|yarn\s+run|pnpm|yarn)\s+([A-Za-z0-9:._-]+)/g;
  for (const match of cleaned.matchAll(pattern)) names.add(match[1]);
  return names;
}

/** A path mention that ends where the file name ends, so `benchmark.ts` does not name `benchmark.js`. */
function namesFile(text, relative) {
  const escaped = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}(?![\\w.-])`).test(text);
}

/** Relative specifiers a script loads, resolved to members of `known` where possible. */
function localDependencies(text, from, known) {
  const out = new Set();
  const pattern = /(?:require\s*\(\s*|import\s*\(\s*|from\s+)['"](\.[^'"]+)['"]/g;
  for (const match of text.matchAll(pattern)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), match[1]));
    for (const suffix of ['', ...EXTENSIONS]) {
      if (known.has(base + suffix)) {
        out.add(base + suffix);
        break;
      }
    }
  }
  return out;
}

function readRegister(file) {
  if (!fs.existsSync(file)) return { entries: {}, present: false };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const entries = {};
  for (const [key, value] of Object.entries(parsed)) {
    entries[key.replace(/^\.\//, '')] = typeof value === 'string' ? value : '';
  }
  return { entries, present: true };
}

function analyse(repo, registerFile) {
  const scripts = collectScripts(repo);
  const known = new Set(scripts);
  const workflowText = readWorkflowText(repo);

  let packageScripts = {};
  const packagePath = path.join(repo, 'package.json');
  if (fs.existsSync(packagePath)) {
    packageScripts = JSON.parse(fs.readFileSync(packagePath, 'utf-8')).scripts ?? {};
  }

  const wired = new Set();
  for (const script of scripts) {
    if (namesFile(workflowText, script)) wired.add(script);
  }
  for (const name of calledScriptNames(workflowText)) {
    const body = packageScripts[name];
    if (typeof body !== 'string') continue;
    for (const script of scripts) {
      if (namesFile(body, script)) wired.add(script);
    }
  }

  // Transitive closure: a module loaded by a wired script is part of what runs.
  let grew = true;
  while (grew) {
    grew = false;
    for (const script of [...wired]) {
      const abs = path.join(repo, script);
      if (!fs.existsSync(abs)) continue;
      for (const dep of localDependencies(fs.readFileSync(abs, 'utf-8'), script, known)) {
        if (!wired.has(dep)) {
          wired.add(dep);
          grew = true;
        }
      }
    }
  }

  const { entries } = readRegister(registerFile);
  const failures = [];

  const missing = Object.keys(entries)
    .filter((entry) => !known.has(entry))
    .sort();
  for (const entry of missing) {
    failures.push(`${entry}: registered, but no such file exists — a record outlived its script`);
  }
  const emptyReason = Object.entries(entries)
    .filter(([, reason]) => reason.trim() === '')
    .map(([entry]) => entry)
    .sort();
  for (const entry of emptyReason) {
    failures.push(`${entry}: registered with no reason — a silence, not a decision`);
  }
  const stale = Object.keys(entries)
    .filter((entry) => known.has(entry) && wired.has(entry))
    .sort();
  for (const entry of stale) {
    failures.push(`${entry}: registered as a local tool, but a workflow already names it`);
  }

  // **A record that is neither missing nor empty nor stale is what the register exists for.** Deriving the set from
  // the failures instead would have made every valid entry an orphan.
  const registered = new Set(
    Object.keys(entries).filter(
      (entry) => known.has(entry) && !wired.has(entry) && entries[entry].trim() !== '',
    ),
  );
  const orphans = scripts.filter((script) => !wired.has(script) && !registered.has(script)).sort();
  for (const orphan of orphans) {
    failures.push(
      `${orphan}: no workflow names it, no called package script names it, and no wired script loads it`,
    );
  }

  return {
    scripts,
    wired: scripts.filter((script) => wired.has(script)),
    registered: scripts.filter((script) => registered.has(script)),
    orphans,
    failures,
    reasons: entries,
    registerPresent: fs.existsSync(registerFile),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const result = analyse(args.repo, args.register);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }

  console.log(
    `${result.scripts.length} scripts · ${result.wired.length} wired · ${result.registered.length} registered local tool${
      result.registered.length === 1 ? '' : 's'
    } · ${result.orphans.length} orphaned`,
  );
  for (const script of result.registered) {
    console.log(`  local: ${script} — ${result.reasons[script].trim()}`);
  }

  if (result.failures.length > 0) {
    console.error(
      `\n❌ Wire check failed:\n${result.failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ every script is named by something that runs, or says why it is not.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { analyse, collectScripts, calledScriptNames, namesFile };
