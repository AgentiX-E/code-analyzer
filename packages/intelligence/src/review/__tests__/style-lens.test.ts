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

  it('should skip valid PascalCase const names', () => {
    const content = 'const MyClass = 1;';
    const findings = analyzeStyle(content, '/src/pascal-const.ts');
    const namingFinding = findings.find((f) => f.title.includes('Non-Standard Naming'));
    expect(namingFinding).toBeUndefined();
  });

  it('should skip case statements when aggregating magic numbers', () => {
    const content = [
      'switch (value) {',
      '  case 4: result = 1;',
      '}',
      'a = 41; b = 42; c = 43; d = 44; e = 45; f = 46;',
    ].join('\n');
    const findings = analyzeStyle(content, '/src/case.ts');
    expect(findings.some((f) => f.title.includes('Excessive Magic Numbers'))).toBe(true);
  });

  it('should skip duplicate detection when the current file has too few tokens', () => {
    const content = 'const x = 1;';
    const repoFiles = new Map<string, string>([
      ['/src/other.ts', 'alpha beta gamma delta epsilon zeta eta theta iota kappa'],
    ]);
    const findings = analyzeStyle(content, '/src/self.ts', { repoFiles });
    expect(findings.find((f) => f.title.includes('Duplicate Code'))).toBeUndefined();
  });

  it('should skip self, tiny, and dissimilar repo files during duplicate detection', () => {
    const content = [
      'function compute(a, b) { return a + b; }',
      'function compute2(a, b) { return a + b; }',
      'function compute3(a, b) { return a + b; }',
      'function compute4(a, b) { return a + b; }',
    ].join('\n');
    const repoFiles = new Map<string, string>([
      ['/src/self.ts', content], // same path as the analyzed file
      ['/src/tiny.ts', 'short'], // fewer than 10 tokens
      // Dissimilar, with a leading comment-only line that strips to empty.
      [
        '/src/different.ts',
        '// a comment that is stripped away\nconst alpha = 1; const beta = 2; const gamma = 3; const delta = 4; const epsilon = 5; const zeta = 6;',
      ],
    ]);
    const findings = analyzeStyle(content, '/src/self.ts', { repoFiles });
    expect(findings.find((f) => f.title.includes('Duplicate Code'))).toBeUndefined();
  });

  it('should skip a long function that already has JSDoc', () => {
    const lines = ['/**', ' * Documented function', ' */'];
    lines.push('function documented() {');
    for (let i = 0; i < 25; i++) {
      lines.push(`  const line${i} = ${i};`);
    }
    lines.push('}');
    const findings = analyzeStyle(lines.join('\n'), '/src/doc.ts');
    expect(findings.find((f) => f.title.includes('Missing Documentation'))).toBeUndefined();
  });

  it('should skip console.log detection for test files', () => {
    const content = 'console.log("debug");';
    const findings = analyzeStyle(content, '/src/foo.test.ts');
    expect(findings.find((f) => f.title.includes('Debug console.log'))).toBeUndefined();
  });

  it('should flag a function longer than 50 lines', () => {
    const lines = ['function longFunc() {'];
    for (let i = 0; i < 55; i++) {
      lines.push(`  const v${i} = ${i};`);
    }
    lines.push('}');
    const findings = analyzeStyle(lines.join('\n'), '/src/long.ts');
    expect(findings.find((f) => f.title.includes('Long Function'))).toBeDefined();
  });

  it('should flag a function with nesting deeper than 4 levels', () => {
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
    const findings = analyzeStyle(content, '/src/deep.ts');
    expect(findings.find((f) => f.title.includes('Deep Nesting'))).toBeDefined();
  });
});
