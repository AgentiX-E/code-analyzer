#!/usr/bin/env node
/**
 * Doc-code sync gate.
 *
 * The 2026-08-17 audit's §3.3 lists four contradictions between this repository's documents and its code: an
 * 18-phase pipeline where there are 19, "39 tools" in one place and 45 in another, 44 relationship types in one
 * place and 43 in another. Each was true when written and each went stale, which is the defect class the whole
 * family of gates here exists for.
 *
 * This gate reads the counts **from the code** and fails when a document states a different one. The counts are
 * computed, never configured, because a configured count is just another document.
 *
 * Usage:  node scripts/doc-code-sync-gate.js [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Count `registry.register(...)` *calls*, not lines — the arguments may be spread over several lines. */
function countToolRegistrations(file) {
  const text = fs.readFileSync(file, 'utf8');
  const starts = [...text.matchAll(/registry\.register\(/g)].map((m) => m.index);
  const names = [];
  for (const start of starts) {
    // The first single-quoted string after the call is the tool name.
    const rest = text.slice(start, start + 400);
    const name = rest.match(/'([^']+)'/);
    if (name) names.push(name[1]);
    else names.push(`<unnamed at offset ${start}>`);
  }
  return { calls: starts.length, names, distinct: new Set(names).size };
}

/** Count the pipeline's phase imports, which is what "N-phase pipeline" refers to. */
function countPipelinePhases(file) {
  const text = fs.readFileSync(file, 'utf8');
  const imports = text.match(/^\s+[A-Z][A-Za-z]*Phase,\s*$/gm) ?? [];
  return imports.length;
}

/** Length of a `const X = [ ... ] as const` literal. */
function countConstArray(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  if (!match) return null;
  return (match[1].match(/'[^']+'/g) ?? []).length;
}

// A root, so the tests can point this at a synthetic repository. Derived from `process.argv` directly rather than
// from the parsed arguments, because `const` does not hoist: an earlier version read `arguments_` here, which is
// declared below, and the module threw at load with "Cannot access 'arguments_' before initialization".
const ROOT_INDEX = process.argv.indexOf('--root');
const ROOT = ROOT_INDEX === -1 ? '.' : process.argv[ROOT_INDEX + 1];
const at = (file) => path.join(ROOT, file);

const FACTS = {
  mcpTools: countToolRegistrations(at('packages/mcp/src/tools/index.ts')),
  pipelinePhases: countPipelinePhases(at('packages/analyzer/src/pipeline/index.ts')),
  nodeTypes: countConstArray(at('packages/shared/src/types/graph.ts'), 'NODE_LABELS'),
  relationshipTypes: countConstArray(
    at('packages/shared/src/types/graph.ts'),
    'RELATIONSHIP_TYPES',
  ),
};

/**
 * Which files, and what to look for.
 *
 * The sweep was the wrong instrument, and my own earlier work says so: `scripts/verify-code-counts.mjs` in the docs
 * repository checks an explicit list of documents, for the reason this file rediscovered. A regex over every
 * markdown file reported **78 findings**, most of them false — a status-table cell, an ASCII diagram label, and a
 * competitor-comparison row all look like a claim to a pattern and are not one. Telling a claim from a table cell
 * needs the table's structure, not a lookbehind.
 *
 * So the documents are named. Each is a description of the platform as it is, and a dated record that keeps an old
 * number is simply not in the list — which is a property of the list rather than of a regex.
 */
const DOCUMENTS = [
  'README.md',
  'docs/USER_GUIDE.md',
  'docs/ARCHITECTURE.md',
  'docs/API_REFERENCE.md',
  'docs/MCP-SERVER.md',
  'docs/adr/ARCHITECTURE_DECISION_RECORDS.md',
];

/**
 * The prefix a claim's number may have.
 *
 * Two exclusions, and the digit one is not cosmetic. A number in parentheses is a breakdown — `Indexing & Lifecycle
 * (4 tools)` — and not a claim about the total. But a lookbehind applies per position: excluding only `(` made the
 * engine skip the `4` of `48 tools` and match the `8`, so every correct statement of the tool count was reported as
 * `claims 8 MCP tools`. Excluding a preceding digit as well is what stops a number being split.
 */
const CLAIM_PREFIX = '(?<![\\d(])';
const CLAIMS = [
  {
    label: 'MCP tools',
    fact: 'mcpTools',
    pattern: new RegExp(CLAIM_PREFIX + '(\\d+)\\s+tools\\b', 'g'),
  },
  {
    label: 'node types',
    fact: 'nodeTypes',
    pattern: new RegExp(CLAIM_PREFIX + '(\\d+)\\s+(?:node|entity) types\\b', 'g'),
  },
  {
    label: 'relationship types',
    fact: 'relationshipTypes',
    pattern: new RegExp(CLAIM_PREFIX + '(\\d+)\\s+(?:relationship|edge) types\\b', 'g'),
  },
  {
    label: 'pipeline phases',
    fact: 'pipelinePhases',
    pattern: new RegExp(CLAIM_PREFIX + '(\\d+)[- ]phases?\\b', 'g'),
  },
];

const failures = [];
const arguments_ = process.argv.slice(2);
const asJson = arguments_.includes('--json');

for (const file of DOCUMENTS) {
  if (!fs.existsSync(at(file))) continue;
  const text = fs.readFileSync(at(file), 'utf8');
  for (const claim of CLAIMS) {
    const fact = FACTS[claim.fact];
    const actual = typeof fact === 'number' ? fact : (fact?.calls ?? fact?.distinct);
    for (const match of text.matchAll(claim.pattern)) {
      if (Number(match[1]) !== actual) {
        const before = text.slice(0, match.index);
        const line = before.split('\n').length;
        const lineText = text.split('\n')[line - 1] ?? '';
        // Two structural exclusions, both learned by getting them wrong.
        //
        // A table row carries several numbers in a fixed layout, and `| ... | 8 tools | ... |` is a cell rather
        // than a claim: prose that states a total does not contain a pipe.
        //
        // A line naming a *profile* names a subset — `28 tools with \`analysis\` profile` should be 35, and `all`
        // should be 9, and neither is the tool count. Correcting one of those to the true subset size made the gate
        // report it as a claim of 9, which is the same pattern problem one level down: a subset count is not a total
        // either, and the sentence's own words say so.
        if (lineText.includes('|') || /profile/i.test(lineText)) continue;
        failures.push(`${file}:${line}: claims ${match[1]} ${claim.label}, the code has ${actual}`);
      }
    }
  }
}

const summary = {
  mcpToolCalls: FACTS.mcpTools.calls,
  mcpToolDistinctNames: FACTS.mcpTools.distinct,
  pipelinePhases: FACTS.pipelinePhases,
  nodeTypes: FACTS.nodeTypes,
  relationshipTypes: FACTS.relationshipTypes,
};

if (asJson) {
  console.log(JSON.stringify({ summary, failures }, null, 2));
} else {
  console.log(
    `code says: ${summary.mcpToolCalls} register calls (${summary.mcpToolDistinctNames} distinct names), ` +
      `${summary.pipelinePhases} pipeline phases, ${summary.nodeTypes} node types, ` +
      `${summary.relationshipTypes} relationship types`,
  );
  // Distinct names differing from calls is worth reporting, not failing: it means either a duplicate registration
  // or a call whose name this parser could not read, and both are worth a look.
  if (summary.mcpToolCalls !== summary.mcpToolDistinctNames) {
    console.log(
      `  note: ${summary.mcpToolCalls} calls but ${summary.mcpToolDistinctNames} distinct names — ` +
        `a duplicate registration, or a name this parser did not read`,
    );
  }
}

if (failures.length > 0 && !asJson) {
  console.error(`\n❌ Doc-code sync failed:\n${failures.map((f) => `  • ${f}`).join('\n')}\n`);
  process.exit(1);
}
if (failures.length > 0 && asJson) {
  process.exit(1);
}
if (!asJson) console.log('✅ Every stated count matches the code.');

module.exports = { countToolRegistrations, countPipelinePhases, countConstArray };
