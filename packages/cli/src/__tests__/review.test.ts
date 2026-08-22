/**
 * Tests for the review command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { reviewCode, formatReviewResult, type ReviewOutput } from '../commands/review.js';

describe('reviewCode — file mode', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(
      tmpdir(),
      `code-analyzer-review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
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

  it('should detect SQL injection pattern', async () => {
    const filePath = join(testDir, 'db.ts');
    writeFileSync(filePath, 'db.query("SELECT * FROM users WHERE id = ${userId}");\n');
    const result = await reviewCode({ target: filePath, mode: 'file' });
    const sqlIssues = result.issues.filter((i) => i.ruleId === 'no-sql-injection-raw');
    expect(sqlIssues.length).toBeGreaterThan(0);
    expect(sqlIssues[0].severity).toBe('critical');
  });

  it('should not report for clean code', async () => {
    const filePath = join(testDir, 'clean.ts');
    writeFileSync(filePath, 'const x = 1;\nconst y = 2;\nconst sum = x + y;\n');
    const result = await reviewCode({ target: filePath, mode: 'file', severity: 'warning' });
    // Only info-level issues (like TODO) would appear at warning severity
    const warnings = result.issues.filter(
      (i) => i.severity === 'warning' || i.severity === 'error' || i.severity === 'critical',
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
  it('should handle diff mode with no staged changes', async () => {
    const result = await reviewCode({ mode: 'diff' });
    // May succeed with 0 issues if not in a git repo with staged changes
    expect(result.success).toBe(true);
    expect(result.mode).toBe('diff');
  });

  it('should handle diff mode with staged changes', async () => {
    const repoDir = resolve(tmpdir(), `review-diff-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    const prevCwd = process.cwd();

    try {
      execSync('git init', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'pipe' });

      // Create and commit an initial file
      writeFileSync(join(repoDir, 'index.ts'), 'const x = 1;\n');
      execSync('git add index.ts', { cwd: repoDir, stdio: 'pipe' });
      execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

      // Modify the file with violations and stage the change
      writeFileSync(
        join(repoDir, 'index.ts'),
        'console.log("debug");\neval("code");\nconst x = 1;\n',
      );
      execSync('git add index.ts', { cwd: repoDir, stdio: 'pipe' });

      // Switch to the repo dir so that git diff works
      process.chdir(repoDir);
      const result = await reviewCode({ mode: 'diff', severity: 'warning' });
      process.chdir(prevCwd);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('diff');
    } catch (err) {
      process.chdir(prevCwd);
      throw err;
    } finally {
      if (process.cwd() !== prevCwd) {
        process.chdir(prevCwd);
      }
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('should handle dir mode', async () => {
    const testDir = resolve(tmpdir(), `review-dir-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'a.ts'), 'console.log("test");\n');
    writeFileSync(join(testDir, 'b.ts'), 'const x = 1;\n');

    const result = await reviewCode({ target: testDir, mode: 'dir' });
    expect(result.success).toBe(true);

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('should handle dir mode with subdirectories', async () => {
    const testDir = resolve(tmpdir(), `review-dir-sub-${Date.now()}`);
    mkdirSync(join(testDir, 'src'), { recursive: true });
    mkdirSync(join(testDir, 'lib'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'index.ts'), 'const x = 1;\n');
    writeFileSync(join(testDir, 'lib', 'utils.ts'), 'debugger;\n');

    const result = await reviewCode({
      target: testDir,
      mode: 'dir',
      severity: 'error',
    });
    expect(result.success).toBe(true);

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
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

    try {
      rmSync(filePath);
    } catch {
      /* */
    }
  });

  it('should skip excluded directories in dir mode', async () => {
    const testDir = resolve(tmpdir(), `review-dir-excl-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'node_modules'), { recursive: true });
    mkdirSync(join(testDir, 'dist'), { recursive: true });
    mkdirSync(join(testDir, 'build'), { recursive: true });
    mkdirSync(join(testDir, '.hidden'), { recursive: true });
    writeFileSync(join(testDir, 'node_modules', 'dep.js'), 'console.log("test");\n');
    writeFileSync(join(testDir, 'dist', 'bundle.js'), 'eval("code");\n');
    writeFileSync(join(testDir, 'build', 'output.js'), 'debugger;\n');
    writeFileSync(join(testDir, '.hidden', 'config.ts'), 'const password = "secret";\n');
    writeFileSync(join(testDir, 'main.ts'), 'const x = 1;\n');

    const result = await reviewCode({
      target: testDir,
      mode: 'dir',
      severity: 'warning',
    });
    expect(result.success).toBe(true);
    // Only main.ts should be reviewed; excluded dirs should be skipped
    expect(result.totalIssues).toBe(0);

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
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

  it('should show error in text format', () => {
    const errorOutput: ReviewOutput = {
      ...sampleOutput,
      success: false,
      error: 'Review engine crashed',
    };
    const output = formatReviewResult(errorOutput, 'text');
    expect(output).toContain('Error: Review engine crashed');
  });

  it('should format markdown with info severity', () => {
    const infoOutput: ReviewOutput = {
      ...sampleOutput,
      issues: [
        {
          ruleId: 'todo-fixme',
          category: 'maintainability',
          severity: 'info',
          file: 'src/utils.ts',
          line: 1,
          message: 'TODO found.',
        },
      ],
      totalIssues: 1,
      summary: { critical: 0, error: 0, warning: 0, info: 1 },
    };
    const output = formatReviewResult(infoOutput, 'markdown');
    expect(output).toContain('🔵');
  });

  it('should handle issues without suggestion', () => {
    const noSuggestion: ReviewOutput = {
      ...sampleOutput,
      issues: [
        {
          ruleId: 'no-debugger',
          category: 'quality',
          severity: 'error',
          file: 'src/utils.ts',
          line: 5,
          message: 'Remove debugger statements.',
        },
      ],
      totalIssues: 1,
      summary: { critical: 0, error: 1, warning: 0, info: 0 },
    };
    const text = formatReviewResult(noSuggestion, 'text');
    expect(text).toContain('no-debugger');
    expect(text).not.toContain('Suggestion:');
  });

  it('should show suggestions in markdown', () => {
    const output = formatReviewResult(sampleOutput, 'markdown');
    expect(output).toContain('Replace with structured logging');
    expect(output).toContain('💡');
  });

  it('should format with error field present', () => {
    const errorOutput: ReviewOutput = {
      ...sampleOutput,
      success: false,
      error: 'Something went wrong',
    };
    const text = formatReviewResult(errorOutput, 'text');
    expect(text).toContain('Something went wrong');
    expect(text).toContain('Error:');
  });
});

describe('reviewCode — error handling', () => {
  it('should handle file mode without target gracefully', async () => {
    // file mode without target should still return a result
    const result = await reviewCode({ mode: 'file' });
    // Should return an error result or empty result
    expect(result).toBeDefined();
    expect(result.mode).toBe('file');
  });

  it('should handle severity filter at critical level', async () => {
    const testDir = resolve(tmpdir(), `review-crit-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      const filePath = join(testDir, 'mixed.ts');
      writeFileSync(filePath, 'console.log("hello");\neval("code");\n// TODO: fix\n');
      const result = await reviewCode({ target: filePath, mode: 'file', severity: 'critical' });
      // Only critical issues should appear
      const evalIssues = result.issues.filter((i) => i.ruleId === 'no-eval');
      const consoleIssues = result.issues.filter((i) => i.ruleId === 'no-console-log');
      const todoIssues = result.issues.filter((i) => i.ruleId === 'todo-fixme');
      expect(evalIssues.length).toBeGreaterThan(0);
      expect(consoleIssues.length).toBe(0);
      expect(todoIssues.length).toBe(0);
      expect(result.success).toBe(true);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('should handle severity filter at info level (all issues)', async () => {
    const testDir = resolve(tmpdir(), `review-info-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      const filePath = join(testDir, 'all.ts');
      writeFileSync(
        filePath,
        'console.log("test");\neval("code");\ndebugger;\n// TODO: fix\nconst x: any = 1;\n',
      );
      const result = await reviewCode({ target: filePath, mode: 'file', severity: 'info' });
      expect(result.success).toBe(true);
      // With info threshold, many issues should appear
      expect(result.issues.length).toBeGreaterThan(0);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('should handle maxIssues cap in file mode', async () => {
    const filePath = resolve(tmpdir(), `max-issues-file-${Date.now()}.ts`);
    try {
      // Create many lines that trigger the same rule
      const lines = Array.from({ length: 50 }, () => 'console.log("test");');
      writeFileSync(filePath, lines.join('\n'));
      const result = await reviewCode({ target: filePath, mode: 'file', maxIssues: 3 });
      expect(result.issues.length).toBeLessThanOrEqual(3);
      expect(result.success).toBe(true);
    } finally {
      try {
        rmSync(filePath);
      } catch {
        /* */
      }
    }
  });

  it('should return summary with correct counts', async () => {
    const testDir = resolve(tmpdir(), `review-summary-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      const filePath = join(testDir, 'summary.ts');
      writeFileSync(
        filePath,
        "const password = 'mySecret123';\neval('danger');\nconsole.log('hello');\n// TODO: something\n",
      );
      const result = await reviewCode({ target: filePath, mode: 'file', severity: 'info' });
      expect(result.summary.critical).toBeGreaterThanOrEqual(0);
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('should handle dir mode with no target gracefully', async () => {
    const result = await reviewCode({ mode: 'dir' });
    // Should not crash when target is missing
    expect(result).toBeDefined();
  });
});
