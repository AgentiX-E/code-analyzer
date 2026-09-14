#!/usr/bin/env node
/**
 * Per-file lint ratchet — every file the linter knows about may not get worse.
 *
 * The gate exists because the CI step that ran `pnpm lint` had nothing to lint: `turbo.json` declares a
 * `lint` task but no package defined a `lint` script, so turbo ran zero tasks, exited 0 and reported
 * success. A gate that cannot fail is worse than no gate, and this repository had one for its whole
 * history.
 *
 * It follows the shape of `typecheck-per-file.js` and `coverage-per-file.js`:
 *
 *   - a file **absent** from `scripts/lint-baseline.json` must have **0** findings;
 *   - a file **present** must not exceed its recorded count;
 *   - improving is always allowed, and `--update` lowers the recorded numbers.
 *
 * Lint runs **per package**. A repository-wide type-aware run builds one program over every package and
 * aborts out of memory (exit 134), which is also why `turbo.json` runs this task per package.
 *
 * Usage: `node scripts/lint-per-file.js [--update] [--package <name>] [--quiet]`
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'lint-baseline.json');

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const quiet = argv.includes('--quiet');
const pkgArg = argv.indexOf('--package');
const only = pkgArg >= 0 ? argv[pkgArg + 1] : null;
// Read a pre-collected ESLint JSON array instead of invoking the linter. The contract tests use this
// to supply doctored input; without it the gate could only be exercised by running ESLint for real.
const jsonArg = argv.indexOf('--json');
const jsonPath = jsonArg >= 0 ? argv[jsonArg + 1] : null;
const baseArg = argv.indexOf('--baseline');
const baselinePath = baseArg >= 0 ? argv[baseArg + 1] : BASELINE;

function packages() {
  const dir = path.join(ROOT, 'packages');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'tsconfig.json')))
    .map((e) => e.name)
    .filter((name) => !only || name === only)
    .sort();
}

/** Findings keyed by repository-relative path. */
function collect() {
  const counts = new Map();
  const messages = new Map();
  let failed = null;

  if (jsonPath) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (error) {
      console.error(
        `❌ ${jsonPath} is not readable JSON (${error.message}) — the linter did not run.`,
      );
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      console.error(`❌ ${jsonPath} is not an ESLint JSON array — the linter did not run.`);
      process.exit(1);
    }
    for (const entry of parsed) {
      if (!entry.messages || !entry.messages.length) continue;
      const rel = path.relative(ROOT, entry.filePath);
      counts.set(rel, (counts.get(rel) || 0) + entry.messages.length);
      if (!messages.has(rel)) messages.set(rel, []);
      for (const m of entry.messages) {
        const at = m.line ? `${m.line}:${m.column}` : '';
        messages
          .get(rel)
          .push(`${rel}(${at}): ${m.ruleId || 'parse'} — ${String(m.message).slice(0, 120)}`);
      }
    }
    return { counts, messages, failed };
  }

  for (const name of packages()) {
    const target = path.join('packages', name, 'src');
    let out;
    try {
      out = execFileSync('npx', ['eslint', target, '--format', 'json'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // ESLint exits non-zero when it has findings; that is the normal path, not a failure.
      out = error.stdout;
      if (!out) failed = `${name}: eslint produced no output (exit ${error.status})`;
    }
    if (!out) continue;

    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      console.error(`❌ ${name}: eslint did not produce JSON — the linter did not run.`);
      process.exit(1);
    }
    for (const entry of parsed) {
      const rel = path.relative(ROOT, entry.filePath);
      if (!entry.messages.length) continue;
      counts.set(rel, (counts.get(rel) || 0) + entry.messages.length);
      if (!messages.has(rel)) messages.set(rel, []);
      for (const m of entry.messages) {
        const at = m.line ? `${m.line}:${m.column}` : '';
        messages
          .get(rel)
          .push(`${rel}(${at}): ${m.ruleId || 'parse'} — ${String(m.message).slice(0, 120)}`);
      }
    }
  }
  return { counts, messages, failed };
}

const { counts, messages, failed } = collect();
if (failed) {
  console.error(`❌ ${failed} — the linter did not run for that package.`);
  process.exit(1);
}
// A gate that passes on empty input passes when the linter silently stops finding files, which is the
// exact failure this gate was built to replace. Zero files inspected is a failure, not a clean tree.
if (counts.size === 0) {
  console.error('❌ The linter reported no files at all — the linter did not run.');
  process.exit(1);
}

const recorded = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')).files
  : {};

if (update) {
  const files = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE, `${JSON.stringify({ files }, null, 2)}\n`);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`Baseline updated: ${counts.size} file(s), ${total} finding(s) recorded.`);
  process.exit(0);
}

const grew = [];
const appeared = [];
for (const [file, count] of counts) {
  const was = recorded[file];
  if (was === undefined) appeared.push({ file, count });
  else if (count > was) grew.push({ file, was, count });
}
const improved = Object.keys(recorded).filter((f) => (counts.get(f) || 0) < recorded[f]);

if (!quiet) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log('Per-file lint ratchet — a file the linter sees may not get worse.');
  console.log(
    `${counts.size} file(s) with findings · ${total} finding(s) · ${improved.length} improved`,
  );
}

if (grew.length || appeared.length) {
  console.error('\n❌ Lint ratchet violated:\n');
  for (const g of grew) {
    console.error(`  • ${g.file}: ${g.was} → ${g.count} finding(s)`);
    for (const m of (messages.get(g.file) || []).slice(0, 20)) console.error(`      ${m}`);
  }
  for (const a of appeared) {
    console.error(`  • ${a.file}: ${a.count} finding(s) in a file that was clean`);
    for (const m of (messages.get(a.file) || []).slice(0, 20)) console.error(`      ${m}`);
  }
  process.exit(1);
}

console.log('\n✅ No new lint findings, and no file exceeded its recorded count.');
