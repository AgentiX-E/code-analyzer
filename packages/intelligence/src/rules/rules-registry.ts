// @code-analyzer/intelligence — Rules Registry
// Manages registration and execution of rule definitions and their checkers.
// Provides filtering by category, severity, and language.

import type { RuleDefinition, RuleCategory, RuleSeverity } from './rule-definitions.js';
import { ALL_RULE_DEFINITIONS } from './rule-definitions.js';
import type { RuleCheckResult, RuleChecker } from './rule-executor.js';
import { CHECKER_MAP } from './rule-executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredRule {
  definition: RuleDefinition;
  checker: RuleChecker;
}

// ---------------------------------------------------------------------------
// Rules Registry
// ---------------------------------------------------------------------------

export class RulesRegistry {
  private rules: Map<string, RegisteredRule> = new Map();

  /**
   * Register a rule definition with its checker function.
   * If a rule with the same ID already exists, it is overwritten.
   */
  register(definition: RuleDefinition, checker: RuleChecker): void {
    this.rules.set(definition.id, { definition, checker });
  }

  /**
   * Unregister a rule by ID. Returns true if the rule was removed.
   */
  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all registered rules.
   */
  getAll(): RegisteredRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get all rules filtered by category.
   */
  getByCategory(category: RuleCategory): RegisteredRule[] {
    return this.getAll().filter((r) => r.definition.category === category);
  }

  /**
   * Get all rules filtered by severity.
   */
  getBySeverity(severity: RuleSeverity): RegisteredRule[] {
    return this.getAll().filter((r) => r.definition.severity === severity);
  }

  /**
   * Get all rules applicable to the given language.
   * Rules without a languageFilter apply to all languages.
   */
  getByLanguage(language: string): RegisteredRule[] {
    return this.getAll().filter((r) => {
      if (!r.definition.languageFilter || r.definition.languageFilter.length === 0) {
        return true;
      }
      return r.definition.languageFilter.includes(language);
    });
  }

  /**
   * Get a specific rule by ID.
   */
  get(ruleId: string): RegisteredRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Check if a rule is registered.
   */
  has(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  /**
   * Get the total number of registered rules.
   */
  get size(): number {
    return this.rules.size;
  }

  /**
   * Run all registered rules against the given source lines.
   * Rules are filtered by language before execution.
   */
  runAll(
    lines: string[],
    filePath: string,
    language: string,
  ): RuleCheckResult[] {
    if (!lines) return [];

    const results: RuleCheckResult[] = [];
    const applicableRules = this.getByLanguage(language);

    for (const { definition, checker } of applicableRules) {
      try {
        const violations = checker(lines, filePath, language);
        results.push(...violations);
      } catch {
        // Skip rules that throw errors to avoid failing the entire analysis
      }
    }

    return results;
  }

  /**
   * Run only rules from the specified category.
   */
  runByCategory(
    category: RuleCategory,
    lines: string[],
    filePath: string,
    language: string,
  ): RuleCheckResult[] {
    if (!lines) return [];

    const results: RuleCheckResult[] = [];
    const applicableRules = this.getByCategory(category).filter((r) => {
      if (!r.definition.languageFilter || r.definition.languageFilter.length === 0) {
        return true;
      }
      return r.definition.languageFilter.includes(language);
    });

    for (const { definition, checker } of applicableRules) {
      try {
        const violations = checker(lines, filePath, language);
        results.push(...violations);
      } catch {
        // Skip rules that throw errors
      }
    }

    return results;
  }

  /**
   * Create a default registry with all 50 built-in rules pre-registered.
   */
  static createDefault(): RulesRegistry {
    const registry = new RulesRegistry();

    for (const definition of ALL_RULE_DEFINITIONS) {
      const checker = CHECKER_MAP[definition.id];
      if (checker) {
        registry.register(definition, checker);
      }
    }

    return registry;
  }
}
