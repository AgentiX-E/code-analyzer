// @code-analyzer/intelligence — Docs Lens Tests
import { describe, it, expect } from 'vitest';
import { analyzeDocs, generateDocsReport } from '../lenses/docs-lens.js';

describe('Docs Lens', () => {
  it('should detect exported function without JSDoc', () => {
    const content = 'export function getUser(id: string) {\n  return { id };\n}';
    const findings = analyzeDocs(content, '/src/user.ts');
    const docFinding = findings.find((f) => f.title.includes('Missing JSDoc'));
    expect(docFinding).toBeDefined();
    expect(docFinding!.severity).toBe('medium');
  });

  it('should detect missing @param docs', () => {
    const content = [
      '/** Get user by ID */',
      'export function getUser(id: string, name: string) {',
      '  return { id, name };',
      '}',
    ].join('\n');

    const findings = analyzeDocs(content, '/src/user.ts');
    const paramFinding = findings.find((f) => f.title.includes('Missing @param'));
    expect(paramFinding).toBeDefined();
  });

  it('should detect under-documented parameters', () => {
    const content = [
      '/** Get user info */',
      'export function createUser(name: string, email: string, role: string) {',
      '  return { name, email, role };',
      '}',
    ].join('\n');

    const findings = analyzeDocs(content, '/src/user.ts');
    const incompleteFinding = findings.find((f) => f.title.includes('@param'));
    expect(incompleteFinding).toBeDefined();
  });

  it('should detect missing @returns documentation', () => {
    const content = [
      '/** Get user */',
      'export function getUser(id: string): User {',
      '  return { id };',
      '}',
    ].join('\n');

    const findings = analyzeDocs(content, '/src/user.ts');
    const returnFinding = findings.find((f) => f.title.includes('Missing @returns'));
    expect(returnFinding).toBeDefined();
  });

  it('should skip internal (non-exported) functions without JSDoc', () => {
    const content = 'function helper(x: number) {\n  return x * 2;\n}';
    const findings = analyzeDocs(content, '/src/helper.ts');
    const docFinding = findings.find((f) => f.title.includes('Missing JSDoc'));
    expect(docFinding).toBeUndefined();
  });

  it('should skip functions with proper JSDoc', () => {
    const content = [
      '/**',
      ' * Create a new user',
      ' * @param name - The user name',
      ' * @param email - The user email',
      ' * @returns The created user',
      ' */',
      'export function createUser(name: string, email: string) {',
      '  return { name, email };',
      '}',
    ].join('\n');

    const findings = analyzeDocs(content, '/src/user.ts');
    const docFinding = findings.find((f) => f.title.includes('Missing JSDoc'));
    expect(docFinding).toBeUndefined();
  });

  it('should detect missing README in package.json', () => {
    const content = JSON.stringify({
      name: 'my-package',
      version: '1.0.0',
    });
    const findings = analyzeDocs(content, '/project/package.json');
    const readmeFinding = findings.find((f) => f.title.includes('Missing README'));
    expect(readmeFinding).toBeDefined();
  });

  it('should handle empty files gracefully', () => {
    const findings = analyzeDocs('', '/src/empty.ts');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBe(0);
  });

  it('should detect multiple functions in same file', () => {
    const content = [
      'export function first(x: number) { return x; }',
      'export function second(y: string) { return y; }',
      'export function third(z: boolean) { return z; }',
    ].join('\n');

    const findings = analyzeDocs(content, '/src/multi.ts');
    const jsdocFindings = findings.filter((f) => f.title.includes('Missing JSDoc'));
    expect(jsdocFindings.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate a valid LensReport', () => {
    const content = 'function test() { return 1; }';
    const report = generateDocsReport(content, '/src/report.ts');
    expect(report.lens).toBe('docs');
    expect(report.name).toBe('Docs Lens');
    expect(report.filesScanned).toBe(1);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
