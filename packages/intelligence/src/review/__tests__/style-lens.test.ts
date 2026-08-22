// @code-analyzer/intelligence — Style Lens Tests
import { describe, it, expect } from 'vitest';
import { analyzeStyle, generateStyleReport } from '../lenses/style-lens.js';

describe('Style Lens', () => {
  it('should detect non-standard naming conventions', () => {
    const content = 'const My_Function = 42;';
    const findings = analyzeStyle(content, '/src/bad-naming.ts');
    const namingFinding = findings.find((f) => f.title.includes('Non-Standard Naming'));
    expect(namingFinding).toBeDefined();
    expect(namingFinding!.severity).toBe('low');
  });

  it('should skip valid camelCase variable names', () => {
    const content = 'const myFunction = 42;';
    const findings = analyzeStyle(content, '/src/camel.ts');
    const namingFinding = findings.find((f) => f.title.includes('Non-Standard Naming'));
    expect(namingFinding).toBeUndefined();
  });

  it('should skip valid PascalCase class names', () => {
    const content = 'class MyComponent { }';
    const findings = analyzeStyle(content, '/src/pascal.ts');
    const namingFinding = findings.find((f) => f.title.includes('Non-Standard Naming'));
    expect(namingFinding).toBeUndefined();
  });

  it('should skip valid UPPER_CASE constant names', () => {
    const content = 'const MAX_COUNT = 100;';
    const findings = analyzeStyle(content, '/src/constant.ts');
    const namingFinding = findings.find((f) => f.title.includes('Non-Standard Naming'));
    expect(namingFinding).toBeUndefined();
  });

  it('should detect magic numbers', () => {
    const content = 'const timeout = 4567;';
    const findings = analyzeStyle(content, '/src/magic.ts');
    const magicFinding = findings.find((f) => f.title.includes('Magic Numbers'));
    expect(magicFinding).toBeDefined();
  });

  it('should skip common allowed numbers (0, 1, -1, 2, 3, 100, etc.)', () => {
    const content = 'const x = 0;\nconst y = 1;\nconst z = -1;\nconst w = 100;\nconst v = 1024;';
    const findings = analyzeStyle(content, '/src/safe-nums.ts');
    const magicFinding = findings.find((f) => f.title.includes('Magic Numbers'));
    expect(magicFinding).toBeUndefined();
  });

  it('should detect line length violations (>120 chars)', () => {
    const content =
      'const thisIsAnExtremelyLongVariableNameThatExceedsOneHundredTwentyCharactersAndShouldTriggerAWarningInTheStyleLensAnalysis = true;';
    const findings = analyzeStyle(content, '/src/long-line.ts');
    const lineFinding = findings.find((f) => f.title.includes('Line Too Long'));
    expect(lineFinding).toBeDefined();
  });

  it('should detect trailing whitespace', () => {
    const content = 'const x = 1;   ';
    const findings = analyzeStyle(content, '/src/trailing.ts');
    const trailFinding = findings.find((f) => f.title.includes('Trailing Whitespace'));
    expect(trailFinding).toBeDefined();
  });

  it('should detect low comment ratio (<5%) on files >50 lines', () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`const x${i} = ${i};`);
    }
    const content = lines.join('\n');
    const findings = analyzeStyle(content, '/src/no-comments.ts');
    const commentFinding = findings.find((f) => f.title.includes('Low Comment Ratio'));
    expect(commentFinding).toBeDefined();
  });

  it('should skip small files for comment ratio check', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const findings = analyzeStyle(content, '/src/small.ts');
    const commentFinding = findings.find((f) => f.title.includes('Low Comment Ratio'));
    expect(commentFinding).toBeUndefined();
  });

  it('should handle empty content gracefully', () => {
    const findings = analyzeStyle('', '/src/empty.ts');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBe(0);
  });

  it('should generate a valid LensReport', () => {
    const content = 'const x = 1;';
    const report = generateStyleReport(content, '/src/report.ts');
    expect(report.lens).toBe('style');
    expect(report.name).toBe('Style Lens');
    expect(report.filesScanned).toBe(1);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
