#!/usr/bin/env node
/**
 * Node-version gate.
 *
 * One runtime is described in three places, and until this gate existed nothing compared them:
 *
 *   `.nvmrc`                     which version a developer installs
 *   `engines.node` (11 files)    the oldest version the packages claim to support
 *   `.github/workflows`, Docker  which version actually runs
 *
 * The three had drifted into a **`>=20.0.0` floor no workflow ever installed**, a CI matrix that said `22` and
 * resolved to whatever patch was newest — across the exact range where `better-sqlite3` 13 segfaults on 22.13.1 —
 * and a Dockerfile that said `22` a third time. A floor nobody runs is an intention; a floating matrix is a
 * denominator nobody chose; a coverage figure produced on an engine that moves is a figure that cannot be compared
 * with last week's.
 *
 * What this gate requires:
 *
 *   1. `.nvmrc` exists and names a full version. A line (`22`) is not a version.
 *   2. Every manifest declares the same `engines.node` floor, in the same comparable form.
 *   3. The floor is not above the pinned version.
 *   4. No workflow passes a scalar to `setup-node`; it names `.nvmrc` or a matrix entry.
 *   5. Some matrix installs **both** the floor and the pinned version, so the declaration is tested rather than
 *      asserted, and no matrix tests a version below the floor.
 *   6. Every `matrix.node-version == '<v>'` comparison names a version the matrix contains — a comparison with a
 *      version that is not in the list is a condition that is never true, which is how an artifact-upload step
 *      silently stopped running.
 *   7. The Dockerfile builds the same version the packages are tested on.
 *
 * Usage:
 *   node scripts/node-version-gate.js [--repo .] [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const FLOOR = /^>=(\d+)\.(\d+)\.(\d+)$/;

function parseArgs(argv) {
  const args = { repo: '.', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

const triple = (text) => text.split('.').map(Number);

function isOlder(a, b) {
  const [am, an, ap] = triple(a);
  const [bm, bn, bp] = triple(b);
  if (am !== bm) return am < bm;
  if (an !== bn) return an < bn;
  return ap < bp;
}

function workflowFiles(repo) {
  const dir = path.join(repo, '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf-8') }));
}

function engineFloors(repo) {
  const manifests = [path.join(repo, 'package.json')];
  const packages = path.join(repo, 'packages');
  if (fs.existsSync(packages)) {
    for (const name of fs.readdirSync(packages).sort()) {
      const manifest = path.join(packages, name, 'package.json');
      if (fs.existsSync(manifest)) manifests.push(manifest);
    }
  }
  const floors = [];
  for (const manifest of manifests) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    } catch {
      continue;
    }
    const declared = parsed.engines?.node;
    if (typeof declared !== 'string') continue;
    floors.push({ file: path.relative(repo, manifest).replace(/\\/g, '/'), declared });
  }
  return floors;
}

function analyse(repo) {
  const failures = [];
  const facts = { pinned: null, floor: null, matrices: [], comparisons: [] };

  const nvmrcPath = path.join(repo, '.nvmrc');
  if (!fs.existsSync(nvmrcPath)) {
    failures.push(
      '.nvmrc: missing — nothing names the version that runs, so `node-version: 22` picks one.',
    );
  } else {
    const raw = fs.readFileSync(nvmrcPath, 'utf-8').trim();
    if (!SEMVER.test(raw)) {
      failures.push(
        `.nvmrc: "${raw}" is a line, not a version — write three numbers (x.y.z), because a line resolves to ` +
          'whatever patch is newest and that is the denominator every coverage figure is divided by.',
      );
    } else {
      facts.pinned = raw;
    }
  }

  const floors = engineFloors(repo);
  if (floors.length === 0) {
    failures.push(
      'engines.node: no manifest declares a floor, so there is nothing for a matrix to test.',
    );
  }
  const distinct = [...new Set(floors.map((entry) => entry.declared))];
  if (distinct.length > 1) {
    for (const entry of floors) {
      if (entry.declared !== distinct[0]) {
        failures.push(
          `${entry.file}: engines.node is "${entry.declared}" while others say "${distinct[0]}" — one runtime, ` +
            'one floor, or the floor means nothing.',
        );
      }
    }
  }
  const floorValue = distinct[0];
  if (floorValue !== undefined && !FLOOR.test(floorValue)) {
    failures.push(
      `engines.node: "${floorValue}" is not a comparable floor — write it as >=x.y.z so a matrix can be checked ` +
        'against it.',
    );
  } else if (floorValue !== undefined) {
    facts.floor = FLOOR.exec(floorValue).slice(1).join('.');
  }

  if (facts.floor !== null && facts.pinned !== null && isOlder(facts.pinned, facts.floor)) {
    failures.push(
      `.nvmrc: pinned ${facts.pinned} is below the declared floor ${floorValue} — the version that runs is one the ` +
        'packages say they do not support.',
    );
  }

  for (const { name, text } of workflowFiles(repo)) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      const scalar = line.match(/^\s*node-version:\s*(.+)$/);
      if (scalar) {
        const value = scalar[1].trim();
        const isReference = value.startsWith('${{') || value.startsWith('[');
        if (!isReference) {
          failures.push(
            `${name}:${index + 1}: node-version: ${value} — a scalar floats. Use ` +
              '`node-version-file: .nvmrc`, or a matrix entry that this gate can compare.',
          );
        }
        if (value.startsWith('[')) {
          const listed = [...value.matchAll(/'([^']+)'|"([^"]+)"|([0-9]+\.[0-9]+\.[0-9]+)/g)].map(
            (match) => match[1] ?? match[2] ?? match[3],
          );
          facts.matrices.push({ workflow: name, listed });
        }
      }
      for (const match of line.matchAll(/matrix\.node-version\s*==\s*'([^']+)'/g)) {
        facts.comparisons.push({ workflow: name, line: index + 1, value: match[1] });
      }
    });
  }

  if (facts.matrices.length === 0) {
    failures.push('workflows: no node-version matrix — the floor is declared and never installed.');
  } else if (facts.floor !== null && facts.pinned !== null) {
    const testsBoth = facts.matrices.some(
      (entry) => entry.listed.includes(facts.floor) && entry.listed.includes(facts.pinned),
    );
    if (!testsBoth) {
      failures.push(
        `workflows: no matrix installs both ${facts.floor} (the floor in engines.node) and ${facts.pinned} (the ` +
          'version in .nvmrc) — one of the two declarations is untested.',
      );
    }
  }
  if (facts.floor !== null) {
    for (const entry of facts.matrices) {
      for (const listed of entry.listed) {
        if (SEMVER.test(listed) && isOlder(listed, facts.floor)) {
          failures.push(
            `${entry.workflow}: the matrix installs ${listed}, below the declared floor ${floorValue} — a version ` +
              'the packages say they do not support.',
          );
        }
      }
    }
  }
  const allListed = new Set(facts.matrices.flatMap((entry) => entry.listed));
  for (const comparison of facts.comparisons) {
    if (!allListed.has(comparison.value)) {
      failures.push(
        `${comparison.workflow}:${comparison.line}: compares matrix.node-version with '${comparison.value}', which ` +
          'no matrix contains — a condition that is never true, and a step that therefore never runs.',
      );
    }
  }

  const dockerfile = path.join(repo, 'Dockerfile');
  if (fs.existsSync(dockerfile)) {
    const arg = fs.readFileSync(dockerfile, 'utf-8').match(/^\s*ARG NODE_VERSION=(\S+)$/m);
    if (arg && facts.pinned !== null && arg[1] !== facts.pinned) {
      failures.push(
        `Dockerfile: builds node:${arg[1]} while the packages are tested on ${facts.pinned} — the image ships a ` +
          'runtime no test has run on.',
      );
    }
  }

  return { facts, failures };
}

function main() {
  const args = parseArgs(process.argv);
  const { facts, failures } = analyse(args.repo);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...facts, failures }, null, 2)}\n`);
    process.exit(failures.length === 0 ? 0 : 1);
  }

  console.log(
    `pinned ${facts.pinned ?? '—'} (${'.nvmrc'}) · floor ${facts.floor ?? '—'} (engines.node) · ` +
      `${facts.matrices.length} matrix/matrices · ${facts.comparisons.length} comparison(s)`,
  );
  if (failures.length > 0) {
    console.error(
      `\n❌ Node version check failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log(
    '✅ the floor is installed, the pinned version is what produces the numbers, and they agree.',
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { analyse };
