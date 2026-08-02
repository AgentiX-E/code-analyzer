// @code-analyzer/intelligence — Structure Lens Tests
import { describe, it, expect } from 'vitest';
import { analyzeStructure, generateStructureReport } from '../lenses/structure-lens.js';

describe('Structure Lens', () => {
  // -----------------------------------------------------------------------
  // Complexity
  // -----------------------------------------------------------------------
  it('should detect high cyclomatic complexity (>15 branches)', () => {
    // Generate code with many branches to trigger >15 complexity
    const lines = ['function complex() {'];
    for (let i = 0; i < 18; i++) {
      lines.push(`  if (x === ${i}) { doThing(${i}); }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/complex.ts');
    const complexityFinding = findings.find(f => f.id.startsWith('str-') && f.title.includes('Cyclomatic Complexity'));
    expect(complexityFinding).toBeDefined();
    expect(complexityFinding!.severity).toBe('high');
  });

  it('should not flag low complexity files', () => {
    const content = 'function simple() {\n  return 42;\n}';
    const findings = analyzeStructure(content, '/src/simple.ts');
    const complexityFinding = findings.find(f => f.id.startsWith('str-') && f.title.includes('Cyclomatic'));
    expect(complexityFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Coupling
  // -----------------------------------------------------------------------
  it('should detect high coupling (>30 imports)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 35; i++) {
      lines.push(`import { Thing${i} } from './module${i}';`);
    }
    lines.push('export function useAll() { return 1; }');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/coupled.ts');
    const couplingFinding = findings.find(f => f.id.startsWith('str-') && f.title.includes('High Coupling'));
    expect(couplingFinding).toBeDefined();
    expect(couplingFinding!.severity).toBe('medium');
  });

  // -----------------------------------------------------------------------
  // God class (line count)
  // -----------------------------------------------------------------------
  it('should detect god class by line count (>500 lines)', () => {
    const lines = ['class GodClass {'];
    for (let i = 0; i < 505; i++) {
      lines.push(`  method${i}() { return ${i}; }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/god.ts');
    const godFinding = findings.find(f => f.title.includes('God Class') && f.title.includes('lines'));
    expect(godFinding).toBeDefined();
    expect(godFinding!.severity).toBe('high');
  });

  // -----------------------------------------------------------------------
  // God class (method count)
  // -----------------------------------------------------------------------
  it('should detect god class by method count (>20 methods)', () => {
    const lines = ['class GodClass {'];
    for (let i = 0; i < 25; i++) {
      lines.push(`  method${i}() { return ${i}; }`);
    }
    lines.push('}');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/god-methods.ts');
    const godFinding = findings.find(f => f.title.includes('God Class') && f.title.includes('methods'));
    expect(godFinding).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Long method
  // -----------------------------------------------------------------------
  it('should detect long method (>50 lines)', () => {
    const lines = ['function longMethod() {'];
    for (let i = 0; i < 55; i++) {
      lines.push(`  const x${i} = ${i};`);
    }
    lines.push('  return 1;');
    lines.push('}');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/long.ts');
    const longFinding = findings.find(f => f.title.includes('Long Method'));
    expect(longFinding).toBeDefined();
    expect(longFinding!.severity).toBe('medium');
  });

  it('should not flag short methods', () => {
    const content = 'function short() {\n  return 1;\n}';
    const findings = analyzeStructure(content, '/src/short.ts');
    const longFinding = findings.find(f => f.title.includes('Long Method'));
    expect(longFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Deep nesting
  // -----------------------------------------------------------------------
  it('should detect deep nesting (>4 levels)', () => {
    const content = [
      'function deep() {',
      '  if (a) {',
      '    if (b) {',
      '      if (c) {',
      '        if (d) {',
      '          if (e) {',
      '            return 1;',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');

    const findings = analyzeStructure(content, '/src/deep.ts');
    const nestFinding = findings.find(f => f.title.includes('Deep Nesting'));
    expect(nestFinding).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Low cohesion
  // -----------------------------------------------------------------------
  it('should detect low cohesion (<30%) for large files', () => {
    const lines = ['import { helperA } from "./a";', 'import { helperB } from "./b";'];
    for (let i = 0; i < 100; i++) {
      lines.push(`import { utilX${i} } from "./module_${i}";`);
    }
    lines.push('export function calculateTotal() { return helperA + helperB; }');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/low-cohesion.ts');
    const cohesionFinding = findings.find(f => f.title.includes('Low Module Cohesion'));
    expect(cohesionFinding).toBeDefined();
    expect(cohesionFinding!.severity).toBe('low');
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it('should handle empty content gracefully', () => {
    const findings = analyzeStructure('', '/src/empty.ts');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBe(0);
  });

  it('should handle files with no functions or classes', () => {
    const content = '// This file has no functions\n// Just comments\n';
    const findings = analyzeStructure(content, '/src/comments.ts');
    expect(findings).toHaveLength(0);
  });

  it('should produce multiple findings on same file', () => {
    const lines = ['import { a1 } from "./m1";'];
    for (let i = 0; i < 35; i++) {
      lines.push(`import { x${i} } from "./m${i}";`);
    }
    lines.push('function godMethod() {');
    for (let i = 0; i < 60; i++) lines.push(`  const v${i} = ${i};`);
    lines.push('  return 1;');
    lines.push('}');
    const content = lines.join('\n');

    const findings = analyzeStructure(content, '/src/multi.ts');
    expect(findings.length).toBeGreaterThan(1);
  });

  // -----------------------------------------------------------------------
  // Real-world examples
  // -----------------------------------------------------------------------
  it('should analyze real-world TypeScript class', () => {
    const content = [
      'export class UserService {',
      '  private db: Database;',
      '  private cache: CacheService;',
      '  private email: EmailService;',
      '  private logger: Logger;',
      '',
      '  constructor() {',
      '    this.db = new Database();',
      '    this.cache = new CacheService();',
      '  }',
      '',
      '  async getUser(id: string): Promise<User> {',
      '    const cached = await this.cache.get(id);',
      '    if (cached) return cached;',
      '    const user = await this.db.query("SELECT * FROM users WHERE id = ?", [id]);',
      '    await this.cache.set(id, user);',
      '    return user;',
      '  }',
      '',
      '  async updateUser(id: string, data: Partial<User>): Promise<void> {',
      '    await this.db.query("UPDATE users SET ? WHERE id = ?", [data, id]);',
      '    await this.cache.del(id);',
      '    this.logger.info(`User ${id} updated`);',
      '  }',
      '}',
    ].join('\n');

    const findings = analyzeStructure(content, '/src/user-service.ts');
    // Should not flag this as a god class (only 2 methods, ~20 lines)
    const godFinding = findings.find(f => f.title.includes('God Class'));
    expect(godFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // generateStructureReport
  // -----------------------------------------------------------------------
  it('should generate a valid LensReport', () => {
    const content = 'export function simple() { return 1; }';
    const report = generateStructureReport(content, '/src/report.ts');
    expect(report.lens).toBe('structure');
    expect(report.name).toBe('Structure Lens');
    expect(report.filesScanned).toBe(1);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: class not a god class (<500 lines, <20 methods)
  // -----------------------------------------------------------------------
  it('should not flag a normal class as a god class', () => {
    const content = [
      'class NormalClass {',
      '  constructor() {}',
      '  method1() { return 1; }',
      '  method2() { return 2; }',
      '}',
    ].join('\n');
    const findings = analyzeStructure(content, '/src/normal.ts');
    const godFinding = findings.find(f => f.title.includes('God Class'));
    expect(godFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: nesting depth <= 4
  // -----------------------------------------------------------------------
  it('should not flag nesting depth of 4 or less', () => {
    const content = [
      'function shallow() {',
      '  if (a) {',
      '    if (b) {',
      '      return 1;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const findings = analyzeStructure(content, '/src/shallow.ts');
    const nestFinding = findings.find(f => f.title.includes('Deep Nesting'));
    expect(nestFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: function <= 50 lines (no long method)
  // -----------------------------------------------------------------------
  it('should not flag methods with exactly 50 lines', () => {
    const lines = ['function mediumMethod() {'];
    for (let i = 0; i < 47; i++) {
      lines.push(`  const x${i} = ${i};`);
    }
    lines.push('  return 1;');
    lines.push('}');
    const content = lines.join('\n');
    const findings = analyzeStructure(content, '/src/medium.ts');
    const longFinding = findings.find(f => f.title.includes('Long Method'));
    expect(longFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: low cohesion when totalLines <= 100
  // -----------------------------------------------------------------------
  it('should not flag low cohesion when total lines <= 100', () => {
    // Only 3 lines → totalLines <= 100, cohesion short-circuits
    const content = [
      'import { a } from "./x";',
      'import { b } from "./y";',
      'export function foo() { return a + b; }',
    ].join('\n');
    const findings = analyzeStructure(content, '/src/small.ts');
    const cohesionFinding = findings.find(f => f.title.includes('Low Module Cohesion'));
    expect(cohesionFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: file with imports <= 30 (no coupling finding)
  // -----------------------------------------------------------------------
  it('should not flag normal import counts', () => {
    const content = [
      'import { a } from "./a";',
      'import { b } from "./b";',
      'export function foo() { return a + b; }',
    ].join('\n');
    const findings = analyzeStructure(content, '/src/normal-imports.ts');
    const couplingFinding = findings.find(f => f.title.includes('High Coupling'));
    expect(couplingFinding).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: class exactly at 500 lines boundary
  // -----------------------------------------------------------------------
  it('should not flag class exactly at 500 lines as god class', () => {
    const lines = ['class BoundedClass {'];
    for (let i = 0; i < 498; i++) {
      lines.push(`  method${i}() { return ${i}; }`);
    }
    lines.push('}');
    const content = lines.join('\n');
    const findings = analyzeStructure(content, '/src/bounded.ts');
    const godFindingByLines = findings.find(f => f.title.includes('God Class') && f.title.includes('lines'));
    expect(godFindingByLines).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Branch Coverage: generateStructureReport with findings
  // -----------------------------------------------------------------------
  it('should generate a report with multiple findings', () => {
    const lines = ['import { a } from "./a";'];
    for (let i = 0; i < 35; i++) {
      lines.push(`import { x${i} } from "./m${i}";`);
    }
    lines.push('function longFunc() {');
    for (let i = 0; i < 55; i++) lines.push(`  const v${i} = ${i};`);
    lines.push('  return 1;');
    lines.push('}');
    const content = lines.join('\n');
    const report = generateStructureReport(content, '/src/multi-report.ts');
    expect(report.lens).toBe('structure');
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.linesAnalyzed).toBeGreaterThan(0);
  });
});
