/**
 * Tests for the review command.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  reviewCode,
  formatReviewResult,
  type ReviewOutput,
} from '../commands/review.js';

describe('reviewCode — file mode', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `code-analyzer-review-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('should detect console.log', async () => {
    const filePath = join(testDir, 'bad.ts');
    writeFileSync(filePath, 'console.log("hello");\nconst x = 1;\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    expect(result.success).toBe(true);
    const consoleIssues = result.issues.filter((i) => i.ruleId === 'no-console-log');
    expect(consoleIssues.length).toBeGreaterThan(0);
  });

  it('should detect debugger statement', async () => {
    const filePath = join(testDir, 'debug.ts');
    writeFileSync(filePath, 'function foo() { debugger; }\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const debuggerIssues = result.issues.filter((i) => i.ruleId === 'no-debugger');
    expect(debuggerIssues.length).toBeGreaterThan(0);
  });

  it('should detect eval()', async () => {
    const filePath = join(testDir, 'unsafe.ts');
    writeFileSync(filePath, 'eval("1+1");\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const evalIssues = result.issues.filter((i) => i.ruleId === 'no-eval');
    expect(evalIssues.length).toBeGreaterThan(0);
    expect(evalIssues[0].severity).toBe('critical');
  });

  it('should detect hardcoded secrets', async () => {
    const filePath = join(testDir, 'config.ts');
    writeFileSync(filePath, 'const password = "superSecret123";\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const secretIssues = result.issues.filter((i) => i.ruleId === 'no-hardcoded-secrets');
    expect(secretIssues.length).toBeGreaterThan(0);
    expect(secretIssues[0].severity).toBe('critical');
  });

  it('should detect innerHTML', async () => {
    const filePath = join(testDir, 'dom.ts');
    writeFileSync(filePath, 'el.innerHTML = "<div>" + userInput + "</div>";\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const xssIssues = result.issues.filter((i) => i.ruleId === 'no-xss-innerhtml');
    expect(xssIssues.length).toBeGreaterThan(0);
  });

  it('should detect TODO/FIXME comments', async () => {
    const filePath = join(testDir, 'todo.ts');
    writeFileSync(filePath, '// TODO: implement this\n// FIXME: bug here\nfunction bar() {}\n');
    const result = await reviewCode({ target: filePath, mode: 'file', severity: 'info' });
    const todoIssues = result.issues.filter((i) => i.ruleId === 'todo-fixme');
    expect(todoIssues.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect "any" type usage in TypeScript', async () => {
    const filePath = join(testDir, 'loose.ts');
    writeFileSync(filePath, 'function process(data: any): any { return data; }\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const anyIssues = result.issues.filter((i) => i.ruleId === 'avoid-any-type');
    expect(anyIssues.length).toBeGreaterThan(0);
  });

  it('should not report for clean code', async () => {
    const filePath = join(testDir, 'clean.ts');
    writeFileSync(filePath, 'const x = 1;\nconst y = 2;\nconst sum = x + y;\n');
    const result = await reviewCode({ target: filePath, mode: 'file', severity: 'warning' });
    // Only info-level issues (like TODO) would appear at warning severity
    const warnings = result.issues.filter((i) =>
      i.severity === 'warning' || i.severity === 'error' || i.severity === 'critical',
    );
    expect(warnings.length).toBe(0);
  });

  it('should respect severity filter', async () => {
    const filePath = join(testDir, 'mixed.ts');
    writeFileSync(filePath, 'console.log("hello");\neval("code");\n// TODO: fix\n');
    const result = await reviewCode({ target: filePath, mode: 'file', severity: 'error' });
    // eval is critical, console.log is warning — with error filter, eval should appear
    const evalIssues = result.issues.filter((i) => i.ruleId === 'no-eval');
    expect(evalIssues.length).toBeGreaterThan(0);
    // console.log should NOT appear (warning < error)
    const consoleIssues = result.issues.filter((i) => i.ruleId === 'no-console-log');
    expect(consoleIssues.length).toBe(0);
  });

  it('should handle non-existent file', async () => {
    const result = await reviewCode({
      target: '/tmp/non-existent-file-xyz.ts',
      mode: 'file',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should provide issue line numbers', async () => {
    const filePath = join(testDir, 'numbered.ts');
    writeFileSync(filePath, '// line 1\n// line 2\ndebugger;\n// line 4\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const debuggerIssue = result.issues.find((i) => i.ruleId === 'no-debugger');
    expect(debuggerIssue).toBeDefined();
    expect(debuggerIssue!.line).toBe(3);
  });
});

describe('reviewCode — other modes', () => {
  it('should handle diff mode', async () => {
    const result = await reviewCode({ mode: 'diff' });
    // May succeed with 0 issues if not in a git repo with staged changes
    expect(result.success).toBe(true);
    expect(result.mode).toBe('diff');
  });

  it('should handle dir mode', async () => {
    const testDir = resolve(tmpdir(), `review-dir-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'a.ts'), 'console.log("test");\n');
    writeFileSync(join(testDir, 'b.ts'), 'const x = 1;\n');

    const result = await reviewCode({ target: testDir, mode: 'dir' });
    expect(result.success).toBe(true);

    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('should respect maxIssues limit', async () => {
    const filePath = resolve(tmpdir(), `many-issues-${Date.now()}.ts`);
    const lines = Array.from({ length: 100 }, (_, i) => `console.log("line ${i}");`);
    writeFileSync(filePath, lines.join('\n'));

    const result = await reviewCode({
      target: filePath,
      mode: 'file',
      maxIssues: 5,
    });
    expect(result.issues.length).toBeLessThanOrEqual(5);

    try { rmSync(filePath); } catch { /* */ }
  });
});

describe('formatReviewResult', () => {
  const sampleOutput: ReviewOutput = {
    success: true,
    target: 'src/utils.ts',
    mode: 'file',
    issues: [
      {
        ruleId: 'no-console-log',
        category: 'quality',
        severity: 'warning',
        file: 'src/utils.ts',
        line: 15,
        message: 'Avoid console.log in production code.',
        suggestion: 'Replace with structured logging.',
      },
      {
        ruleId: 'no-eval',
        category: 'security',
        severity: 'critical',
        file: 'src/utils.ts',
        line: 23,
        message: 'eval() is a security risk (CWE-95).',
        suggestion: 'Replace eval() with a safer alternative.',
      },
    ],
    totalIssues: 2,
    summary: { critical: 1, error: 0, warning: 1, info: 0 },
    duration: 42,
  };

  it('should format as JSON', () => {
    const output = formatReviewResult(sampleOutput, 'json');
    const parsed = JSON.parse(output);
    expect(parsed.issues.length).toBe(2);
    expect(parsed.summary.critical).toBe(1);
  });

  it('should format as text', () => {
    const output = formatReviewResult(sampleOutput, 'text');
    expect(output).toContain('src/utils.ts');
    expect(output).toContain('no-console-log');
    expect(output).toContain('no-eval');
    expect(output).toContain('CRITICAL');
    expect(output).toContain('WARNING');
  });

  it('should format as markdown', () => {
    const output = formatReviewResult(sampleOutput, 'markdown');
    expect(output).toContain('## Code Review');
    expect(output).toContain('| 🔴 Critical |');
    expect(output).toContain('| 🟡 Warning  |');
  });

  it('should show summary counts', () => {
    const output = formatReviewResult(sampleOutput, 'text');
    expect(output).toContain('Critical: 1');
    expect(output).toContain('Warning: 1');
  });
});
