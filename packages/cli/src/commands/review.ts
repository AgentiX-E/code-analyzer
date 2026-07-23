// @code-analyzer/cli — Review Command
// Runs code review on a file, directory, or git diff using the
// deterministic rules engine. Supports multiple output formats
// and integration with the standards engine.

import { existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { EOL } from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewOptions {
  /** File or directory to review */
  target?: string;
  /** Review mode: diff (git changes), file (single file), or dir (directory) */
  mode?: 'diff' | 'file' | 'dir';
  /** Minimum severity to report */
  severity?: 'info' | 'warning' | 'error' | 'critical';
  /** Review categories to include */
  categories?: string[];
  /** Output format */
  format?: 'text' | 'json' | 'markdown';
  /** Max issues to report */
  maxIssues?: number;
}

export interface ReviewIssue {
  ruleId: string;
  category: string;
  severity: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface ReviewOutput {
  success: boolean;
  target: string;
  mode: string;
  issues: ReviewIssue[];
  totalIssues: number;
  summary: {
    critical: number;
    error: number;
    warning: number;
    info: number;
  };
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map file extension to language for the rules engine.
 */
function getLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.cs': 'csharp',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sh': 'shell',
    '.sql': 'sql',
  };
  return map[ext] ?? 'text';
}

/**
 * Collect all files recursively from a directory.
 */
async function collectFiles(dir: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(dir, { withFileTypes: true }));

  for (const entry of entries) {
    if (files.length >= maxFiles) break;
    const fullPath = resolve(dir, entry.name);

    // Skip common exclusions
    if (
      entry.name.startsWith('.') ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'build'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, maxFiles - files.length);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Review code for quality issues using deterministic rules.
 *
 * Supports three modes:
 *   - `diff`: reviews staged git changes (git diff HEAD)
 *   - `file`: reviews a single file
 *   - `dir`: reviews all files in a directory
 */
export async function reviewCode(
  options: ReviewOptions = {},
): Promise<ReviewOutput> {
  const startTime = Date.now();
  const mode = options.mode ?? 'file';
  const maxIssues = options.maxIssues ?? 500;
  const severity: string = options.severity ?? 'warning';
  const issues: ReviewIssue[] = [];

  try {
    if (mode === 'diff') {
      // Get git diff content
      let diffContent = '';
      try {
        diffContent = execSync(
          'git diff --staged --unified=0',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
        );
      } catch {
        // May fail if not in a git repo
      }

      if (!diffContent) {
        return {
          success: true,
          target: 'git diff',
          mode: 'diff',
          issues: [],
          totalIssues: 0,
          summary: { critical: 0, error: 0, warning: 0, info: 0 },
          duration: Date.now() - startTime,
        };
      }

      // Parse diff and apply rules to each changed line
      const lines = diffContent.split('\n');
      const rules = loadRules();

      for (let i = 0; i < lines.length && issues.length < maxIssues; i++) {
        const line = lines[i];
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const content = line.slice(1);

        for (const rule of rules) {
          if (issues.length >= maxIssues) break;
          if (severityWeight(rule.severity) < severityWeight(severity)) continue;

          const match = rule.pattern.test(content);
          if (match) {
            issues.push({
              ruleId: rule.id,
              category: rule.category,
              severity: rule.severity,
              file: 'diff',
              line: i + 1,
              message: rule.message,
              suggestion: rule.suggestion,
            });
          }
        }
      }

    } else if (mode === 'file' && options.target) {
      const filePath = resolve(options.target);
      if (!existsSync(filePath)) {
        return {
          success: false,
          target: options.target,
          mode: 'file',
          issues: [],
          totalIssues: 0,
          summary: { critical: 0, error: 0, warning: 0, info: 0 },
          duration: Date.now() - startTime,
          error: `File not found: ${options.target}`,
        };
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const language = getLanguage(filePath);
      const rules = loadRules();

      for (let i = 0; i < lines.length && issues.length < maxIssues; i++) {
        for (const rule of rules) {
          if (issues.length >= maxIssues) break;
          if (severityWeight(rule.severity) < severityWeight(severity)) continue;

          const match = rule.pattern.test(lines[i]);
          if (match) {
            issues.push({
              ruleId: rule.id,
              category: rule.category,
              severity: rule.severity,
              file: relative(process.cwd(), filePath),
              line: i + 1,
              message: rule.message,
              suggestion: rule.suggestion,
            });
          }
        }
      }

    } else if (mode === 'dir' && options.target) {
      const dir = resolve(options.target);
      const files = await collectFiles(dir, maxIssues);

      for (const file of files.slice(0, 200)) {
        if (issues.length >= maxIssues) break;
        const singleResult = await reviewCode({
          target: file,
          mode: 'file',
          severity: options.severity,
          categories: options.categories,
          maxIssues: maxIssues - issues.length,
          format: options.format,
        });
        issues.push(...singleResult.issues);
      }
    }

    // Build summary
    const summary = {
      critical: issues.filter((i) => i.severity === 'critical').length,
      error: issues.filter((i) => i.severity === 'error').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    };

    return {
      success: true,
      target: options.target ?? 'current directory',
      mode,
      issues,
      totalIssues: issues.length,
      summary,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      target: options.target ?? 'unknown',
      mode,
      issues: [],
      totalIssues: 0,
      summary: { critical: 0, error: 0, warning: 0, info: 0 },
      duration: Date.now() - startTime,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in rules (subset for CLI review)
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  category: string;
  severity: string;
  pattern: RegExp;
  message: string;
  suggestion?: string;
}

const BUILT_IN_RULES: Rule[] = [
  {
    id: 'no-eval',
    category: 'security',
    severity: 'critical',
    pattern: /\beval\s*\(/,
    message: 'eval() is a security risk (CWE-95). Use alternatives like JSON.parse or Function constructor only when absolutely necessary.',
    suggestion: 'Replace eval() with a safer alternative.',
  },
  {
    id: 'no-debugger',
    category: 'quality',
    severity: 'error',
    pattern: /\bdebugger\b/,
    message: 'Remove debugger statements.',
    suggestion: 'Remove the debugger statement before committing.',
  },
  {
    id: 'no-console-log',
    category: 'quality',
    severity: 'warning',
    pattern: /console\.log\s*\(/,
    message: 'Avoid console.log in production code. Use a proper logger.',
    suggestion: 'Replace with structured logging (e.g., pino, winston).',
  },
  {
    id: 'no-hardcoded-secrets',
    category: 'security',
    severity: 'critical',
    pattern: /(password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    message: 'Hardcoded secret detected (CWE-798). Use environment variables or a secrets manager.',
    suggestion: 'Move this value to an environment variable or secrets vault.',
  },
  {
    id: 'no-sql-injection-raw',
    category: 'security',
    severity: 'critical',
    pattern: /\.query\s*\(\s*['"`].*\$\{/,
    message: 'Potential SQL injection via string interpolation (CWE-89). Use parameterized queries.',
    suggestion: 'Use parameterized queries or ORM escape functions.',
  },
  {
    id: 'no-xss-innerhtml',
    category: 'security',
    severity: 'error',
    pattern: /\.innerHTML\s*=/,
    message: 'innerHTML assignment may enable XSS (CWE-79). Use textContent or sanitized HTML.',
    suggestion: 'Use textContent, createElement, or a sanitizer library.',
  },
  {
    id: 'avoid-any-type',
    category: 'maintainability',
    severity: 'warning',
    pattern: /\bany\b(?!\s*[=:]\s*['"`])/,
    message: 'Using "any" type bypasses type safety. Use specific types or "unknown".',
    suggestion: 'Define a proper interface or use "unknown" with type guards.',
  },
  {
    id: 'todo-fixme',
    category: 'maintainability',
    severity: 'info',
    pattern: /\b(TODO|FIXME|HACK)\b/i,
    message: 'TODO/FIXME/HACK comment found. Track these as technical debt.',
    suggestion: 'Create a tracking issue and reference it in the comment.',
  },
];

function loadRules(): Rule[] {
  return BUILT_IN_RULES;
}

function severityWeight(severity: string): number {
  const weights: Record<string, number> = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
  };
  return weights[severity] ?? 0;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format review output for display.
 */
export function formatReviewResult(
  result: ReviewOutput,
  format: 'text' | 'json' | 'markdown',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];

  if (format === 'markdown') {
    lines.push(`## Code Review: ${result.target}`);
    lines.push('');
    lines.push(`**Mode:** ${result.mode} | **Issues:** ${result.totalIssues} | **Duration:** ${result.duration}ms`);
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| 🔴 Critical | ${result.summary.critical} |`);
    lines.push(`| 🟠 Error    | ${result.summary.error} |`);
    lines.push(`| 🟡 Warning  | ${result.summary.warning} |`);
    lines.push(`| 🔵 Info     | ${result.summary.info} |`);
    lines.push('');

    for (const issue of result.issues) {
      const icon = issue.severity === 'critical' ? '🔴' :
        issue.severity === 'error' ? '🟠' :
        issue.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`- ${icon} **${issue.ruleId}** — ${issue.file}:${issue.line}`);
      lines.push(`  ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`  > 💡 ${issue.suggestion}`);
      }
    }
    return lines.join(EOL);
  }

  // Text format
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Code Analyzer — Review: ${result.target}`);
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Mode: ${result.mode} | Issues: ${result.totalIssues} | Duration: ${result.duration}ms`);
  lines.push(` `);
  lines.push(`  Critical: ${result.summary.critical}  Error: ${result.summary.error}  Warning: ${result.summary.warning}  Info: ${result.summary.info}`);
  lines.push(` `);

  if (result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join(EOL);
  }

  for (const issue of result.issues) {
    lines.push(`${'─'.repeat(40)}`);
    lines.push(`  [${issue.severity.toUpperCase()}] ${issue.ruleId} — ${issue.file}:${issue.line}`);
    lines.push(`  ${issue.message}`);
    if (issue.suggestion) {
      lines.push(`  Suggestion: ${issue.suggestion}`);
    }
  }
  lines.push(`${'='.repeat(60)}`);

  return lines.join(EOL);
}
