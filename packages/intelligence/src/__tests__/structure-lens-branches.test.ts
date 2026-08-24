// @ts-nocheck
// @code-analyzer/intelligence — Structure Lens branch coverage (graph-backed
// detections + parser edge cases not covered by structure-lens-layers.test.ts).

import { describe, it, expect } from 'vitest';
import { analyzeStructure } from '../review/lenses/structure-lens.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';

function node(store, id, overrides = {}) {
  const n = {
    projectId: 'test-project',
    label: 'File',
    name: 'file',
    qualifiedName: `qn:${id}`,
    filePath: '/src/a.ts',
    startLine: 1,
    endLine: 1,
    isExported: false,
    ...overrides,
  };
  store.insertNode({ id, ...n });
  return id;
}

function edge(store, sourceId, targetId, type = 'IMPORTS') {
  store.insertEdge({
    projectId: 'test-project',
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
  });
}

describe('Structure Lens — loadLayerConfig without a layers section', () => {
  it('returns no rules when config has no layers: block', () => {
    const findings = analyzeStructure('const x = 1;\n', '/src/a.ts', {
      layerConfig: 'just:\n  some config\n',
    });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation')).toHaveLength(0);
  });
});

describe('Structure Lens — parseLayerRules with a top-level non-name line first', () => {
  it('skips lines before the first - name: entry', () => {
    const config = `
layers:
  paths:
    - src/ignored/
  - name: web
    paths:
      - src/web/
    forbidden_imports:
      - data
  - name: data
    paths:
      - src/data/
`;
    const findings = analyzeStructure(
      "import { db } from 'src/data/database';\n",
      'src/web/app.ts',
      {
        layerConfig: config,
      },
    );
    const violations = findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation');
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Structure Lens — Barrel export brace-with-from branch', () => {
  it('counts brace exports with a from clause', () => {
    // `export { a } from './x'` hits the braceMatch branch (distinct from the
    // bare wildcard branch) and accumulates re-exports toward the threshold.
    const lines = Array.from({ length: 12 }, (_, i) => `export { mod${i} } from './m${i}';`).join(
      '\n',
    );
    const findings = analyzeStructure(lines, '/src/index.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-barrel-export')).toBe(true);
  });
});

describe('Structure Lens — function declaration with brace on the next line', () => {
  it('recognizes a function whose opening brace is on the following line', () => {
    const body = Array.from({ length: 55 }, (_, i) => `  console.log(${i});`).join('\n');
    const code = `function multiLineFn()\n{\n${body}\n}\n`;
    const findings = analyzeStructure(code, '/src/multiline.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-long-method')).toBe(true);
  });
});

describe('Structure Lens — detectCircularImports (graph-backed)', () => {
  it('detects a 2-node import cycle', () => {
    const store = new InMemoryGraphStore();
    const a = node(store, 1, {
      label: 'File',
      name: 'a.ts',
      qualifiedName: 'qn:a',
      filePath: 'src/a.ts',
    });
    const b = node(store, 2, {
      label: 'File',
      name: 'b.ts',
      qualifiedName: 'qn:b',
      filePath: 'src/b.ts',
    });
    edge(store, a, b, 'IMPORTS');
    edge(store, b, a, 'IMPORTS');

    const findings = analyzeStructure('', 'src/a.ts', { store, projectId: 'test-project' });
    expect(findings.some((f) => f.evidence.ruleId === 'struct-circular-import')).toBe(true);
  });

  it('returns no circular import when the file has no File node', () => {
    const store = new InMemoryGraphStore();
    node(store, 1, {
      label: 'Function',
      name: 'f',
      qualifiedName: 'qn:f',
      filePath: 'src/other.ts',
    });
    const findings = analyzeStructure('', 'src/missing.ts', { store, projectId: 'test-project' });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-circular-import')).toHaveLength(0);
  });
});

describe('Structure Lens — detectOrphanCode (graph-backed)', () => {
  it('skips non-function nodes and non-exported functions', () => {
    const store = new InMemoryGraphStore();
    node(store, 1, { label: 'Class', name: 'C', qualifiedName: 'qn:C', filePath: 'src/orphan.ts' });
    node(store, 2, {
      label: 'Function',
      name: 'priv',
      qualifiedName: 'qn:priv',
      filePath: 'src/orphan.ts',
      isExported: false,
    });
    node(store, 3, {
      label: 'Function',
      name: 'orphan',
      qualifiedName: 'qn:orphan',
      filePath: 'src/orphan.ts',
      isExported: true,
      startLine: null,
      endLine: null,
    });
    const findings = analyzeStructure('', 'src/orphan.ts', { store, projectId: 'test-project' });
    const orphans = findings.filter((f) => f.evidence.ruleId === 'struct-orphan-code');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].title).toContain('orphan');
  });

  it('does not flag an exported function that has an incoming CALLS edge', () => {
    const store = new InMemoryGraphStore();
    node(store, 1, {
      label: 'Function',
      name: 'used',
      qualifiedName: 'qn:used',
      filePath: 'src/used.ts',
      isExported: true,
    });
    node(store, 2, {
      label: 'Function',
      name: 'caller',
      qualifiedName: 'qn:caller',
      filePath: 'src/caller.ts',
    });
    edge(store, 2, 1, 'CALLS');
    const findings = analyzeStructure('', 'src/used.ts', { store, projectId: 'test-project' });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-orphan-code')).toHaveLength(0);
  });
});
