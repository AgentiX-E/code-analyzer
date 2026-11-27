#!/usr/bin/env node
/**
 * Target gate - a target is never set below the competitor measured under the same LLM, and a baseline is the number
 * the artifact actually carries.
 *
 * **The defect this closes.** The campaign's铁律 is written in prose in a dozen places: *a target may only be greater
 * than or equal to the competitor under our own LLM*. `§173.5` set `S63`'s target at `code defect 0.3110 → ≥ 0.40`.
 * Both numbers were wrong and nothing could tell:
 *
 *   - `0.3110` was the **live** board's reading (F1 `0.2674`). After the diff repair of `§175`, the same fifty pull
 *     requests read `0.3828` on the pinned document (F1 `0.3274`) - so the baseline named a document that no longer
 *     exists, the same class of error `§175` fixed one level up in the harness.
 *   - `0.40` was **below** the competitor's `0.4641` on that pinned document under our DeepSeek. The target was set
 *     below the bar the铁律 forbids crossing, and it was copied into five sections of the contract, so editing one
 *     would leave four telling a different story.
 *
 * A sentence cannot enforce either rule. **A single source of truth can**: `benchmarks/targets.json` names every
 * target, the artifact each baseline and competitor figure comes from, and the path to it. This gate re-reads those
 * artifacts on every run and refuses a target that falls below its competitor, a baseline that disagrees with its
 * source, or a source that cannot be opened. **A target is a claim about a number another file already published**, and
 * the claim is now checked against that file rather than against the paragraph that copied it.
 *
 * Usage:
 *   node scripts/target-gate.mjs [--registry benchmarks/targets.json] [--json]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';

const DEFAULT_REGISTRY = 'benchmarks/targets.json';

function parseArgs(argv) {
  const options = { registry: DEFAULT_REGISTRY, json: false, repo: '.' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--registry') options.registry = argv[(i += 1)];
    else if (arg === '--repo') options.repo = argv[(i += 1)];
    else if (arg === '--json') options.json = true;
  }
  return options;
}

/**
 * Read `file#path`, where path is dot-separated and an array step may carry `[key=value]`.
 *
 * A path is parsed rather than evaluated: `rows[category=Code Defect].oursRecall` selects the row whose `category`
 * equals `Code Defect`, then its `oursRecall`. An unmatched selector is a refusal, not an undefined that later reads
 * as zero - a target whose source no longer names its row must fail loudly.
 */
export function resolveRef(ref, repo) {
  if (typeof ref !== 'string') return { ok: false, reason: 'not a string' };
  const hash = ref.indexOf('#');
  if (hash < 0) return { ok: false, reason: 'no #file#path separator' };
  const file = ref.slice(0, hash);
  const path = ref.slice(hash + 1);
  if (file === '' || path === '') return { ok: false, reason: 'empty file or path' };
  const absolute = isAbsolute(file) ? file : resolve(repo, file);
  if (!existsSync(absolute)) return { ok: false, reason: `file ${file} does not exist` };
  let value;
  try {
    value = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    return { ok: false, reason: `file ${file} is not readable JSON` };
  }
  const steps = path.split('.').filter((step) => step !== '');
  for (const step of steps) {
    const bracket = step.indexOf('[');
    if (bracket < 0) {
      if (value === null || typeof value !== 'object' || !(step in value)) {
        return { ok: false, reason: `path ${path} has no field ${step}` };
      }
      value = value[step];
      continue;
    }
    const key = step.slice(0, bracket);
    const predicate = step.slice(bracket + 1, step.lastIndexOf(']'));
    if (key !== '' && value !== null && typeof value === 'object' && key in value)
      value = value[key];
    if (!Array.isArray(value)) return { ok: false, reason: `path ${path} selects a non-array` };
    const eq = predicate.indexOf('=');
    if (eq < 0) return { ok: false, reason: `path ${path} has a malformed selector` };
    const field = predicate.slice(0, eq);
    const wanted = predicate.slice(eq + 1);
    const found = value.find(
      (row) => row !== null && typeof row === 'object' && String(row[field]) === wanted,
    );
    if (found === undefined)
      return { ok: false, reason: `path ${path} selects no row with ${field}=${wanted}` };
    value = found;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      reason: `path ${path} resolves to ${JSON.stringify(value)}, not a finite number`,
    };
  }
  return { ok: true, value, file };
}

/** Equality to four decimals, the resolution every figure in this campaign is published at. */
function sameNumber(a, b) {
  return Math.abs(a - b) < 5e-5;
}

export function analyse(repo, registryPath) {
  const absolute = isAbsolute(registryPath) ? registryPath : resolve(repo, registryPath);
  const failures = [];
  const checks = [];
  if (!existsSync(absolute)) {
    return {
      ok: false,
      failures: [`registry ${registryPath} does not exist`],
      checks,
      targets: [],
    };
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    return {
      ok: false,
      failures: [`registry ${registryPath} is not readable JSON`],
      checks,
      targets: [],
    };
  }
  const targets = Array.isArray(registry?.targets) ? registry.targets : [];
  // **A gate that inspected nothing is a gate that passed.** This is the same floor as `numbers-gate`'s claim count.
  if (targets.length === 0) {
    failures.push('registry names zero targets — a gate with nothing to check is a green gate');
  }
  const ids = new Set();
  for (const target of targets) {
    const id = typeof target?.id === 'string' ? target.id : '<unnamed>';
    if (ids.has(id)) failures.push(`${id}: duplicate target id`);
    ids.add(id);
    for (const field of ['baseline', 'competitor']) {
      if (target[field] === undefined) {
        failures.push(`${id}: no ${field} block`);
        continue;
      }
      if (typeof target[field].value !== 'number' || typeof target[field].from !== 'string') {
        failures.push(`${id}: ${field} must carry a numeric value and a source ref`);
        continue;
      }
      const read = resolveRef(target[field].from, repo);
      if (!read.ok) {
        failures.push(`${id}: ${field} source cannot be read: ${read.reason}`);
        continue;
      }
      // R2: the recorded value must be the value the artifact carries.
      if (!sameNumber(target[field].value, read.value)) {
        failures.push(
          `${id}: ${field} says ${target[field].value.toFixed(4)} but ${target[field].from} carries ` +
            `${read.value.toFixed(4)} — a stale baseline named a document that no longer exists`,
        );
      }
      checks.push({ id, field, value: read.value, from: target[field].from });
    }
    if (typeof target.target !== 'number' || !Number.isFinite(target.target)) {
      failures.push(`${id}: target is not a finite number`);
      continue;
    }
    // R1: the铁律. The competitor figure is read from the artifact, never trusted from the registry alone.
    const competitorRead = resolveRef(target.competitor?.from, repo);
    const competitorValue = competitorRead.ok ? competitorRead.value : target.competitor?.value;
    if (typeof competitorValue === 'number' && target.target + 5e-5 < competitorValue) {
      failures.push(
        `${id}: target ${target.target.toFixed(4)} is below the competitor under our LLM ` +
          `${competitorValue.toFixed(4)} — a target may not be set below the bar`,
      );
    }
  }
  return { ok: failures.length === 0, failures, checks, targets };
}

function main() {
  const options = parseArgs(process.argv);
  const result = analyse(options.repo, options.registry);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  console.log(
    `target gate · ${result.targets.length} targets · ${result.checks.length} source reads`,
  );
  for (const check of result.checks) {
    console.log(`  ${check.id} ${check.field} ${check.value.toFixed(4)} — ${check.from}`);
  }
  if (result.failures.length > 0) {
    console.error(`\nTarget gate failed:\n${result.failures.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log(
    'Every target is at or above the competitor under our LLM, and every baseline is the number its artifact carries.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main();
}
