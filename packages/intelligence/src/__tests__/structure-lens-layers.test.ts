// @code-analyzer/intelligence — Structure Lens: Layer Rules & Edge Cases
// Covers parseLayerRules edge cases (comments, blank lines, the `forbidden:`
// variant, multiple layers, empty path/forbidden items), detectLayerViolations
// (require imports, multiple forbidden layers, non-matching file paths, layers
// without forbidden_imports), barrel export variants (brace / wildcard / single),
// arrow-function block extraction, and cohesion computation on empty input.

import { describe, it, expect } from 'vitest';
import { analyzeStructure, generateStructureReport } from '../review/lenses/structure-lens.js';

// ---------------------------------------------------------------------------
// Layer rule parsing & violation detection
// ---------------------------------------------------------------------------

describe('Structure Lens — Layer Rule Parsing', () => {
  const fullConfig = `
# architecture layers
layers:
  - name: web
    paths:
      - src/web/
    forbidden_imports:
      - data
      - ui

  - name: data
    paths:
      - src/data/

  - name: ui
    paths:
      - src/ui/
    forbidden:
      - data
`;

  it('parses multiple layers with comments, blank lines, and the forbidden: variant', () => {
    const code = `import { db } from 'src/data/database';\n`;
    const findings = analyzeStructure(code, 'src/web/app.ts', { layerConfig: fullConfig });
    const violations = findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]!.title).toContain('web');
    expect(violations[0]!.title).toContain('data');
  });

  it('detects a violation against the second forbidden layer', () => {
    const code = `import { Button } from 'src/ui/component';\n`;
    const findings = analyzeStructure(code, 'src/web/app.ts', { layerConfig: fullConfig });
    const violations = findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation');
    expect(violations.some((f) => f.title.includes('ui'))).toBe(true);
  });

  it('detects violations expressed via require() calls', () => {
    const code = `const db = require('src/data/database');\n`;
    const findings = analyzeStructure(code, 'src/web/app.ts', { layerConfig: fullConfig });
    const violations = findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation');
    expect(violations.some((f) => f.title.includes('data'))).toBe(true);
  });

  it('detects the forbidden: variant layer (ui -> data)', () => {
    const code = `import { db } from 'src/data/database';\n`;
    const findings = analyzeStructure(code, 'src/ui/view.tsx', { layerConfig: fullConfig });
    const violations = findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation');
    expect(violations.some((f) => f.title.includes('data'))).toBe(true);
  });

  it('returns no violations for a file outside any layer path', () => {
    const code = `import { db } from 'src/data/database';\n`;
    const findings = analyzeStructure(code, 'src/other/util.ts', { layerConfig: fullConfig });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation')).toHaveLength(0);
  });

  it('returns no violations for a layer with no forbidden imports', () => {
    const code = `import { db } from 'src/data/database';\n`;
    // data layer has no forbidden_imports entry
    const findings = analyzeStructure(code, 'src/data/repo.ts', { layerConfig: fullConfig });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation')).toHaveLength(0);
  });

  it('parses a layer with empty paths and forbidden items', () => {
    const config = `
layers:
  - name: orphan
    paths:
    forbidden_imports:
`;
    const findings = analyzeStructure('const x = 1;\n', 'src/web/app.ts', { layerConfig: config });
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-layer-violation')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Barrel export detection
// ---------------------------------------------------------------------------

describe('Structure Lens — Barrel Export Detection', () => {
  it('detects wildcard barrel exports', () => {
    const code = `export * from './a';\nexport * from './b';\n`;
    const findings = analyzeStructure(code, 'src/index.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-barrel-export')).toBe(true);
  });

  it('detects brace barrel exports exceeding the threshold', () => {
    const exports = Array.from({ length: 12 }, (_, i) => `mod${i}`).join(', ');
    const code = `export { ${exports} } from './mods';\n`;
    const findings = analyzeStructure(code, 'src/index.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-barrel-export')).toBe(true);
  });

  it('does not flag non-index files', () => {
    const code = `export * from './a';\nexport * from './b';\n`;
    const findings = analyzeStructure(code, 'src/util.ts');
    expect(findings.filter((f) => f.evidence.ruleId === 'struct-barrel-export')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Function/class block extraction & cohesion
// ---------------------------------------------------------------------------

describe('Structure Lens — Block Extraction & Cohesion', () => {
  it('extracts arrow-function const blocks for long-method detection', () => {
    const body = Array.from({ length: 55 }, (_, i) => `  console.log(${i});`).join('\n');
    const code = `const longArrow = () => {\n${body}\n};\n`;
    const findings = analyzeStructure(code, '/src/long-arrow.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-long-method')).toBe(true);
  });

  it('handles empty content for cohesion (total === 0)', () => {
    const findings = analyzeStructure('', '/src/empty.ts');
    expect(findings).toEqual([]);
  });

  it('detects deep nesting via indentation', () => {
    const deep = Array.from({ length: 8 }, () => '  '.repeat(7) + 'if (true) {}').join('\n');
    const findings = analyzeStructure(`function deep() {\n${deep}\n}\n`, '/src/deep.ts');
    expect(findings.some((f) => f.evidence.ruleId === 'struct-deep-nesting')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateStructureReport
// ---------------------------------------------------------------------------

describe('Structure Lens — generateStructureReport', () => {
  it('generates a lens report with correct metadata', () => {
    const report = generateStructureReport('function a() {}\n', '/src/a.ts');
    expect(report.lens).toBe('structure');
    expect(report.name).toBe('Structure Lens');
    expect(report.filesScanned).toBe(1);
    expect(report.linesAnalyzed).toBe(2);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.findings)).toBe(true);
  });
});
