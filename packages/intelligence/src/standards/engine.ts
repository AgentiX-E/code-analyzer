import type {
  ProjectStandard,
  StandardsCheckResult,
  RuleCheckResult,
  Violation,
  StandardRule,
  Severity,
} from '@code-analyzer/shared';
import { STANDARD_TEMPLATES, getTemplate, listTemplates } from './templates.js';
import type { StandardTemplate } from './templates.js';

export interface AutoFix {
  filePath: string;
  lineNumber: number;
  original: string;
  replacement: string;
  description: string;
}

export class StandardsEngine {
  private customStandards = new Map<string, ProjectStandard>();

  /** Load a standard by ID — checks built-in templates first, then custom. */
  loadStandard(id: string): ProjectStandard {
    const template = getTemplate(id);
    if (template) return template;

    const custom = this.customStandards.get(id);
    if (custom) return custom;

    throw new Error(`Standard not found: ${id}`);
  }

  /** List all available standard templates (built-in only). */
  listTemplates(): StandardTemplate[] {
    return listTemplates();
  }

  /** Register a custom standard. */
  registerStandard(standard: ProjectStandard): void {
    if (STANDARD_TEMPLATES[standard.id]) {
      throw new Error(`Cannot register custom standard: "${standard.id}" conflicts with a built-in template.`);
    }
    this.customStandards.set(standard.id, standard);
  }

  /** Check a single source string against all rules in a standard. */
  checkSource(source: string, filePath: string, standard: ProjectStandard): RuleCheckResult[] {
    const results: RuleCheckResult[] = [];
    const config = standard.config;
    const disabledRules = new Set(config?.disabledRules ?? []);

    for (const rule of standard.rules) {
      if (disabledRules.has(rule.id)) continue;

      const violations = this.checkRule(source, filePath, rule);
      results.push({
        ruleId: rule.id,
        ruleDescription: rule.description,
        passed: violations.length === 0,
        severity: rule.severity,
        violations,
        autoFixable: rule.autoFixable,
      });
    }

    return results;
  }

  /** Check multiple files against a standard. */
  checkFiles(
    files: Array<{ path: string; content: string }>,
    standardId: string,
  ): StandardsCheckResult {
    const standard = this.loadStandard(standardId);
    const startTime = Date.now();

    const allRuleResults: RuleCheckResult[] = [];
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 0 };
    const config = standard.config;
    const disabledRules = new Set(config?.disabledRules ?? []);

    // Collect results per rule across all files
    const ruleMap = new Map<string, RuleCheckResult>();

    for (const file of files) {
      for (const rule of standard.rules) {
        if (disabledRules.has(rule.id)) continue;

        const violations = this.checkRule(file.content, file.path, rule);
        const existing = ruleMap.get(rule.id);

        if (existing) {
          existing.violations.push(...violations);
          if (violations.length > 0) existing.passed = false;
        } else {
          ruleMap.set(rule.id, {
            ruleId: rule.id,
            ruleDescription: rule.description,
            passed: violations.length === 0,
            severity: rule.severity,
            violations,
            autoFixable: rule.autoFixable,
          });
        }
      }
    }

    for (const result of ruleMap.values()) {
      allRuleResults.push(result);
      if (result.passed) {
        summary.passed++;
      } else {
        const sev = result.severity;
        const rec = summary as Record<string, number>;
        if (sev in summary) {
          rec[sev]! += result.violations.length;
        }
      }
    }

    const totalRules = standard.rules.filter((r) => !disabledRules.has(r.id)).length;
    const complianceScore = files.length === 0 ? 100
      : totalRules > 0 ? (summary.passed / totalRules) * 100 : 100;

    return {
      standardId: standard.id,
      ruleResults: allRuleResults,
      complianceScore: Math.round(complianceScore * 100) / 100,
      filesChecked: files.length,
      summary,
      duration: Date.now() - startTime,
    };
  }

  /** Get auto-fix suggestions for a list of violations. */
  getAutoFixes(violations: Violation[]): AutoFix[] {
    return violations
      .filter((v) => v.autoFix != null)
      .map((v) => ({
        filePath: v.filePath,
        lineNumber: v.lineNumber,
        original: v.codeSnippet,
        replacement: v.autoFix!,
        description: v.suggestion ?? v.message,
      }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private checkRule(source: string, filePath: string, rule: StandardRule): Violation[] {
    switch (rule.checkType) {
      case 'regex':
        return this.checkRegex(source, filePath, rule);
      case 'metric':
        return this.checkMetric(source, filePath, rule);
      case 'ast-pattern':
        return this.checkAstPattern(source, filePath, rule);
      case 'graph-query':
        return []; // Deferred to later iteration
      case 'llm-check':
        return []; // Deferred to later iteration
      default:
        return [];
    }
  }

  private checkRegex(source: string, filePath: string, rule: StandardRule): Violation[] {
    const config = rule.checkConfig as { pattern: string; flags?: string };
    if (!config.pattern) return [];

    try {
      const regex = new RegExp(config.pattern, config.flags ?? 'g');
      const violations: Violation[] = [];
      const lines = source.split('\n');

      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        // Prevent infinite loops on zero-length matches
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        const lineNumber = this.getLineNumber(source, match.index);
        const codeSnippet = lines[lineNumber - 1]?.trim() ?? '';
        violations.push({
          filePath,
          lineNumber,
          message: rule.description,
          codeSnippet,
          suggestion: rule.fixSuggestion,
          autoFix: rule.autoFixable ? rule.fixSuggestion : undefined,
          standardRef: rule.id,
        });
      }

      return violations;
    } catch {
      return [];
    }
  }

  private checkMetric(source: string, filePath: string, rule: StandardRule): Violation[] {
    const config = rule.checkConfig as { metric: string; threshold: number };
    if (!config.metric) return [];

    const violations: Violation[] = [];
    const lines = source.split('\n');

    switch (config.metric) {
      case 'function-lines': {
        const functionBoundaries = this.extractFunctionBoundaries(source);
        for (const fb of functionBoundaries) {
          const funcLines = fb.endLine - fb.startLine + 1;
          if (funcLines > config.threshold) {
            violations.push({
              filePath,
              lineNumber: fb.startLine,
              message: `Function spans ${funcLines} lines (threshold: ${config.threshold})`,
              codeSnippet: lines[fb.startLine - 1]?.trim() ?? '',
              suggestion: rule.fixSuggestion ?? 'Consider splitting this function into smaller functions.',
              standardRef: rule.id,
            });
          }
        }
        break;
      }
      case 'nesting-depth': {
        const maxDepth = this.computeMaxNestingDepth(source);
        if (maxDepth > config.threshold) {
          violations.push({
            filePath,
            lineNumber: 1,
            message: `Maximum nesting depth is ${maxDepth} (threshold: ${config.threshold})`,
            codeSnippet: `Max nesting depth: ${maxDepth}`,
            suggestion: rule.fixSuggestion ?? 'Reduce nesting by extracting logic into helper functions.',
            standardRef: rule.id,
          });
        }
        break;
      }
      default:
        break;
    }

    return violations;
  }

  private checkAstPattern(_source: string, _filePath: string, _rule: StandardRule): Violation[] {
    // AST pattern matching is a simplified heuristic check.
    // Real AST-based checks require a parser integration (deferred).
    return [];
  }

  // ---------------------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------------------

  private getLineNumber(source: string, offset: number): number {
    const before = source.substring(0, offset);
    return before.split('\n').length;
  }

  /** Heuristic function boundary extraction for metric checks. */
  private extractFunctionBoundaries(source: string): Array<{ startLine: number; endLine: number }> {
    const boundaries: Array<{ startLine: number; endLine: number }> = [];
    const lines = source.split('\n');
    const functionPatterns = [
      /^\s*(?:export\s+)?(?:async\s+)?function\s+\w/,
      /^\s*(?:export\s+)?(?:async\s+)?\w+\s*:\s*(?:async\s+)?function/,
      /^\s*(?:public|private|protected|static)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]*>)?)?\s*\{/,
      /^\s*def\s+\w+/,
      /^\s*func\s+\w+\s*\(/,
    ];

    let inFunction = false;
    let braceDepth = 0;
    let funcStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (!inFunction) {
        for (const pat of functionPatterns) {
          if (pat.test(line)) {
            inFunction = true;
            funcStart = i + 1;
            braceDepth = 0;
            break;
          }
        }
      }

      if (inFunction) {
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }

        // For Python-style (colon + indent): use indentation change as boundary
        const pythonStyle = trimmed.endsWith(':') && trimmed.match(/^\s*(def|class|if|for|while|with|try)/);

        if (braceDepth <= 0 && inFunction && i > funcStart - 1 && !pythonStyle) {
          boundaries.push({ startLine: funcStart, endLine: i + 1 });
          inFunction = false;
        }
      }
    }

    // Handle function at end of file
    if (inFunction) {
      boundaries.push({ startLine: funcStart, endLine: lines.length });
    }

    return boundaries;
  }

  /** Heuristic nesting depth computation. */
  private computeMaxNestingDepth(source: string): number {
    const lines = source.split('\n');
    const indentPattern = /^(\s*)/;
    let maxDepth = 0;

    for (const line of lines) {
      if (line.trim() === '') continue;
      const match = indentPattern.exec(line);
      if (match) {
        const spaces = match[1]!.length;
        const depth = Math.floor(spaces / 2); // Assume 2-space indent
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    // Also check for brace nesting
    let braceDepth = 0;
    let maxBraceDepth = 0;
    for (const ch of source) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      maxBraceDepth = Math.max(maxBraceDepth, braceDepth);
    }

    return Math.max(maxDepth, maxBraceDepth);
  }

  /** Compute compliance score from a set of rule results. */
  computeComplianceScore(results: RuleCheckResult[]): number {
    if (results.length === 0) return 100;
    const passed = results.filter((r) => r.passed).length;
    return Math.round((passed / results.length) * 10000) / 100;
  }

  /** Compute severity-weighted score (critical=5, high=4, medium=3, low=2, info=1). */
  computeSeverityWeightedScore(results: RuleCheckResult[]): number {
    const weights: Record<Severity, number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    };

    const maxPossible = results.reduce((sum, r) => sum + (weights[r.severity] ?? 0), 0);
    if (maxPossible === 0) return 100;

    const passedWeight = results
      .filter((r) => r.passed)
      .reduce((sum, r) => sum + (weights[r.severity] ?? 0), 0);

    return Math.round((passedWeight / maxPossible) * 10000) / 100;
  }
}
