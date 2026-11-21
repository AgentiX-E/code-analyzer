// @code-analyzer/scripts — the one reader of the configuration the product ships
//
// **Why this module exists at all.** `DEFAULT_PULL_REQUEST_BUDGET` lived in the engine and `DEFAULT_PR_BUDGET` lived in
// the benchmark script, and a test compared them by regular expression. **Two numbers that must agree and cannot see
// each other drift apart**, and the test that watched them was a test about punctuation - it would have accepted
// `const DEFAULT_PR_BUDGET = compute();` and it could not have noticed a third copy in a workflow input's `default:`.
//
// **So there is one copy.** `packages/intelligence/config/review-defaults.json` holds every knob the reviewer ships
// with, the engine reads a module generated from it, the harness reads the file itself, and the promoter is the only
// writer. **A guard test re-renders the module and fails when the two disagree**, which makes the drift a build error
// rather than a slow divergence between two numbers nobody compares.
//
// **And the knobs are a closed set.** `KNOB_SPEC` names every knob the promotion can move; a knob in the JSON that is
// not in the spec is a typo that would have been silently ignored by every reader, and a knob in the spec that is
// missing from the JSON is a default the engine has and nobody can find. Both are refusals rather than warnings.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root, from this file's own location, so no caller has to guess a working directory. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

export const DEFAULTS_PATH = join(
  REPO_ROOT,
  'packages',
  'intelligence',
  'config',
  'review-defaults.json',
);
export const RULE_PATH = join(
  REPO_ROOT,
  'packages',
  'intelligence',
  'config',
  'promotion-rule.json',
);

/** Where the generated module lives, relative to the repository root, because a test asserts the path. */
export const GENERATED_PATH = join(
  REPO_ROOT,
  'packages',
  'intelligence',
  'src',
  'review',
  'llm',
  'review-defaults.generated.ts',
);

/**
 * **Every knob a promotion may move, with the range it may move within.**
 *
 * The ranges are not decoration. `maxFindingsPerPullRequest` outside 1..64 is a run that emits nothing or a run whose
 * budget is a category error; `sameSiteConcerns` of 0 would delete every finding a lane ever made at a range. **A
 * promotion is a machine's decision**, so the machine checks the bounds a human reviewer would have checked.
 */
export const KNOB_SPEC = Object.freeze({
  maxFindingsPerPullRequest: Object.freeze({ kind: 'integer', min: 1, max: 64 }),
  sameSiteConcerns: Object.freeze({ kind: 'integer', min: 1, max: 8 }),
  secondConcern: Object.freeze({ kind: 'boolean' }),
  codeContext: Object.freeze({ kind: 'boolean' }),
  adjudicate: Object.freeze({ kind: 'boolean' }),
  remarks: Object.freeze({ kind: 'boolean' }),
  languageChecklist: Object.freeze({ kind: 'boolean' }),
});

export const KNOB_NAMES = Object.freeze(Object.keys(KNOB_SPEC));

/** The JSON, parsed and shape-checked. Throws rather than returning a half-read configuration. */
export function readReviewDefaults(path = DEFAULTS_PATH) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `the shipped reviewer configuration could not be read at ${path}: ${String(error)}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not JSON: ${String(error)}`);
  }
  const errors = validateDefaults(parsed);
  if (errors.length > 0) {
    throw new Error(`${path} is not a configuration: ${errors.join('; ')}`);
  }
  return parsed;
}

export function readPromotionRule(path = RULE_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const errors = [];
  if (!Number.isInteger(parsed?.version) || parsed.version < 1)
    errors.push('version must be a positive integer');
  if (typeof parsed?.primary !== 'string') errors.push('primary must name a metric');
  // **The metric the promotion is decided on, as a dotted path into an artifact.** Naming it in the rule rather than
  // in the promoter is what lets the product's arm change when the product's arm changes, without editing code.
  if (typeof parsed?.metric !== 'string' || parsed.metric.length === 0)
    errors.push('metric must be a dotted path into an artifact');
  if (!(typeof parsed?.minimumDelta === 'number' && parsed.minimumDelta >= 0))
    errors.push('minimumDelta must be a non-negative number');
  for (const key of ['precision', 'recall']) {
    if (!(typeof parsed?.guards?.[key] === 'number')) errors.push(`guards.${key} must be a number`);
  }
  for (const key of ['pullRequests', 'goldens']) {
    if (!(Number.isInteger(parsed?.minimumSample?.[key]) && parsed.minimumSample[key] > 0))
      errors.push(`minimumSample.${key} must be a positive integer`);
  }
  if (errors.length > 0) throw new Error(`${path} is not a promotion rule: ${errors.join('; ')}`);
  return parsed;
}

/**
 * **Every way a configuration object can be wrong, listed rather than thrown one at a time.**
 *
 * A promoter that refused on the first bad knob would report one problem and hide the rest, and the person reading the
 * record would fix the one and be refused by the next. **The list is the report.**
 */
export function validateDefaults(defaults) {
  const errors = [];
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return ['the file must be an object'];
  }
  if (defaults.schema !== 1) errors.push(`schema must be 1, not ${String(defaults.schema)}`);
  const knobs = defaults.knobs;
  if (knobs === null || typeof knobs !== 'object' || Array.isArray(knobs)) {
    errors.push('knobs must be an object');
    return errors;
  }
  for (const name of Object.keys(knobs)) {
    if (!Object.hasOwn(KNOB_SPEC, name))
      errors.push(`knobs.${name} is not a knob any reader reads`);
  }
  for (const name of KNOB_NAMES) {
    if (!Object.hasOwn(knobs, name)) {
      errors.push(
        `knobs.${name} is missing, so the engine would fall back to a number nobody wrote down`,
      );
      continue;
    }
    const spec = KNOB_SPEC[name];
    const value = knobs[name];
    if (spec.kind === 'boolean') {
      if (typeof value !== 'boolean')
        errors.push(`knobs.${name} must be true or false, not ${JSON.stringify(value)}`);
    } else if (!Number.isInteger(value)) {
      errors.push(`knobs.${name} must be an integer, not ${JSON.stringify(value)}`);
    } else if (value < spec.min || value > spec.max) {
      errors.push(
        `knobs.${name} must be in ${String(spec.min)}..${String(spec.max)}, not ${String(value)}`,
      );
    }
  }
  const provenance = defaults.provenance;
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    errors.push(
      'provenance must be an object: a configuration with no record of who moved it is a configuration nobody can defend',
    );
  } else {
    for (const key of ['decision', 'resolvedBy', 'resolvedAt']) {
      if (typeof provenance[key] !== 'string' || provenance[key].length === 0)
        errors.push(`provenance.${key} must be a non-empty string`);
    }
  }
  return errors;
}

/**
 * **The module the engine imports, rendered from the JSON.**
 *
 * Sorted key order and two-space indent, so two renders of the same configuration are byte-identical and a test can
 * compare strings rather than objects. **The provenance is rendered too**, because a figure whose configuration travels
 * without the experiment that chose it is a configuration nobody can date.
 */
export function renderDefaultsModule(defaults) {
  const knobs = KNOB_NAMES.map(
    (name) => `    ${name}: ${JSON.stringify(defaults.knobs[name])},`,
  ).join('\n');
  // **Both braces are dropped because the template writes them**, at the indent the surrounding object uses; every
  // remaining line keeps JSON's own indentation and gains two spaces, so the body sits one level in from `provenance:`.
  const provenance = JSON.stringify(defaults.provenance, null, 2)
    .split('\n')
    .slice(1, -1)
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    '// @code-analyzer/intelligence — GENERATED FROM packages/intelligence/config/review-defaults.json',
    '//',
    '// **Do not edit this file.** It is rendered by `node .github/scripts/aacr-review-defaults-codegen.mjs`, which',
    '// reads the JSON and writes this module; a guard test renders it again and fails when the two disagree, so an edit',
    '// here is a build error rather than a quiet difference of opinion between two copies of one configuration.',
    '//',
    '// **Why a module rather than a JSON import.** The package is compiled with `tsc` and consumed from `dist/`, and a',
    '// JSON import would leave a `require("../../config/review-defaults.json")` in the output pointing at a file the',
    '// build never copies. A rendered module is inlined by the compiler and cannot point anywhere.',
    '//',
    `// Chosen by ${String(defaults.provenance.resolvedBy)} on ${String(defaults.provenance.resolvedAt)}, decision: ${String(defaults.provenance.decision)}.`,
    '',
    '/** The reviewer configuration the product ships, and the record of how it got here. */',
    'export const REVIEW_DEFAULTS = {',
    '  schema: 1,',
    '  knobs: {',
    knobs,
    '  },',
    '  provenance: {',
    provenance,
    '  },',
    '} as const;',
    '',
    '/** The type of a knob name, so a caller that asks for a knob the file does not have fails to compile. */',
    'export type ReviewKnob = keyof typeof REVIEW_DEFAULTS.knobs;',
    '',
  ].join('\n');
}
