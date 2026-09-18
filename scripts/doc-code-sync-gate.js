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

const FACTS = {
  mcpTools: countToolRegistrations('packages/mcp/src/tools/index.ts'),
  pipelinePhases: countPipelinePhases('packages/analyzer/src/pipeline/index.ts'),
  nodeTypes: countConstArray('packages/shared/src/types/graph.ts', 'NODE_LABELS'),
  relationshipTypes: countConstArray('packages/shared/src/types/graph.ts', 'RELATIONSHIP_TYPES'),
};

/** Every place a document states one of the counts. */
const CLAIMS = [
  { file: 'README.md', label: 'MCP tools', fact: 'mcpTools', pattern: /(\d+)\s+tools\b/g },
  { file: 'README.md', label: 'node types', fact: 'nodeTypes', pattern: /(\d+)\s+node types\b/g },
  {
    file: 'README.md',
    label: 'relationship types',
    fact: 'relationshipTypes',
    pattern: /(\d+)\s+relationship types\b/g,
  },
];

const failures = [];
const arguments_ = process.argv.slice(2);
const asJson = arguments_.includes('--json');

for (const claim of CLAIMS) {
  if (!fs.existsSync(claim.file)) continue;
  const text = fs.readFileSync(claim.file, 'utf8');
  const fact = FACTS[claim.fact];
  const actual = typeof fact === 'number' ? fact : (fact?.calls ?? fact?.distinct);
  for (const match of text.matchAll(claim.pattern)) {
    if (Number(match[1]) !== actual) {
      failures.push(`${claim.file}: claims ${match[1]} ${claim.label}, the code has ${actual}`);
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
