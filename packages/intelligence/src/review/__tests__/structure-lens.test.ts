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
});
