// @code-analyzer/intelligence — Custom Rule Editor
// Programmatic API for creating, editing, validating, and managing
// custom project rules. Integrates with the StandardsEngine.

import type { StandardRule, Severity, ProjectStandard } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** Input for creating a new custom rule (id is generated if not provided). */
export interface CreateRuleInput {
  id?: string;
  description: string;
  checkType: StandardRule['checkType'];
  checkConfig: Record<string, unknown>;
  severity: Severity;
  autoFixable?: boolean;
  fixSuggestion?: string;
}

/** Partial update for an existing rule. */
export interface UpdateRuleInput {
  description?: string;
  checkType?: StandardRule['checkType'];
  checkConfig?: Record<string, unknown>;
  severity?: Severity;
  autoFixable?: boolean;
  fixSuggestion?: string;
}

/** Result of validating a rule against sample code. */
export interface RuleValidationResult {
  /** Whether the rule configuration is syntactically valid. */
  valid: boolean;
  /** Lines in the sample that matched the rule pattern. */
  matches: Array<{ lineNumber: number; matchedText: string }>;
  /** Error messages for invalid configurations. */
  errors: string[];
}

/** A pre-built rule template. */
export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultConfig: {
    checkType: StandardRule['checkType'];
    checkConfig: Record<string, unknown>;
    severity: Severity;
    autoFixable: boolean;
  };
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const VALID_CHECK_TYPES = new Set<StandardRule['checkType']>([
  'regex', 'metric', 'ast-pattern', 'graph-query', 'llm-check',
]);

const VALID_SEVERITIES = new Set<Severity>([
  'critical', 'high', 'medium', 'low', 'info',
]);

/** Built-in rule templates for quick creation. */
const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'template-naming-convention',
    name: 'Naming Convention',
    description: 'Enforce consistent naming patterns (camelCase, PascalCase, snake_case)',
    category: 'style',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: '\\b(?:const|let|var)\\s+([a-z][a-zA-Z0-9]*)\\b' },
      severity: 'low',
      autoFixable: false,
    },
  },
  {
    id: 'template-no-banned-imports',
    name: 'No Banned Imports',
    description: 'Prevent importing from forbidden packages or modules',
    category: 'architecture',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: 'from\\s+[\'"]lodash[\'"]', flags: 'g' },
      severity: 'high',
      autoFixable: false,
    },
  },
  {
    id: 'template-max-function-size',
    name: 'Maximum Function Size',
    description: 'Limit function length to prevent large, unwieldy functions',
    category: 'maintainability',
    defaultConfig: {
      checkType: 'metric',
      checkConfig: { metric: 'function-lines', threshold: 50 },
      severity: 'medium',
      autoFixable: false,
    },
  },
  {
    id: 'template-max-nesting-depth',
    name: 'Maximum Nesting Depth',
    description: 'Limit code nesting to improve readability',
    category: 'maintainability',
    defaultConfig: {
      checkType: 'metric',
      checkConfig: { metric: 'nesting-depth', threshold: 4 },
      severity: 'medium',
      autoFixable: false,
    },
  },
  {
    id: 'template-no-console-in-production',
    name: 'No console.log in Production',
    description: 'Flag console.log statements that should not be in production code',
    category: 'style',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: '\\bconsole\\.(log|debug|info)\\b', flags: 'g' },
      severity: 'low',
      autoFixable: false,
    },
  },
  {
    id: 'template-require-jsdoc',
    name: 'Require JSDoc on Exports',
    description: 'Ensure exported functions, classes, and interfaces have JSDoc documentation',
    category: 'documentation',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: '^export\\s+(?:async\\s+)?(?:function|class|interface|type)\\s+\\w+', flags: 'gm' },
      severity: 'low',
      autoFixable: false,
    },
  },
  {
    id: 'template-no-todo-merge',
    name: 'No TODO Before Merge',
    description: 'Flag TODO comments that should be resolved before merging',
    category: 'maintainability',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: '\\/\\/\\s*TODO', flags: 'g' },
      severity: 'low',
      autoFixable: false,
    },
  },
  {
    id: 'template-require-error-handling',
    name: 'Require Error Handling',
    description: 'Ensure async operations have proper error handling',
    category: 'bug',
    defaultConfig: {
      checkType: 'regex',
      checkConfig: { pattern: 'await\\s+\\w+\\s*\\([^)]*\\)(?!\\s*\\.\\s*catch)', flags: 'g' },
      severity: 'high',
      autoFixable: false,
    },
  },
  {
    id: 'template-max-file-lines',
    name: 'Maximum File Lines',
    description: 'Limit the number of lines in a single source file',
    category: 'maintainability',
    defaultConfig: {
      checkType: 'metric',
      checkConfig: { metric: 'function-lines', threshold: 500 },
      severity: 'medium',
      autoFixable: false,
    },
  },
];

// ---------------------------------------------------------------------------
// CustomRuleEditor
// ---------------------------------------------------------------------------

export class CustomRuleEditor {
  private customRules = new Map<string, Map<string, StandardRule>>();

  constructor() {}

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new custom rule for a standard.
   *
   * Validates the rule structure, generates a unique ID if not provided,
   * and stores it under the given standard ID.
   */
  createCustomRule(standardId: string, input: CreateRuleInput): StandardRule {
    if (!standardId) {
      throw new Error('standardId is required');
    }
    if (!input.description) {
      throw new Error('Rule description is required');
    }
    if (!input.checkType) {
      throw new Error('Rule checkType is required');
    }
    if (!VALID_CHECK_TYPES.has(input.checkType)) {
      throw new Error(
        `Invalid checkType "${input.checkType}". Must be one of: ${[...VALID_CHECK_TYPES].join(', ')}`,
      );
    }
    if (!input.severity) {
      throw new Error('Rule severity is required');
    }
    if (!VALID_SEVERITIES.has(input.severity)) {
      throw new Error(
        `Invalid severity "${input.severity}". Must be one of: ${[...VALID_SEVERITIES].join(', ')}`,
      );
    }

    // Validate checkConfig based on checkType
    this.validateCheckConfig(input.checkType, input.checkConfig);

    const ruleId = input.id ?? this.generateRuleId(standardId);
    const rules = this.getOrCreateRuleMap(standardId);

    if (rules.has(ruleId)) {
      throw new Error(`Rule "${ruleId}" already exists in standard "${standardId}"`);
    }

    const rule: StandardRule = {
      id: ruleId,
      description: input.description,
      checkType: input.checkType,
      checkConfig: input.checkConfig,
      severity: input.severity,
      autoFixable: input.autoFixable ?? false,
      fixSuggestion: input.fixSuggestion,
    };

    rules.set(ruleId, rule);
    return { ...rule, checkConfig: { ...rule.checkConfig } };
  }

  /**
   * Update an existing custom rule with partial data.
   * Only specified fields are changed; unspecified fields remain unchanged.
   */
  updateCustomRule(
    standardId: string,
    ruleId: string,
    updates: UpdateRuleInput,
  ): StandardRule {
    if (!standardId) throw new Error('standardId is required');
    if (!ruleId) throw new Error('ruleId is required');

    const rules = this.customRules.get(standardId);
    if (!rules || !rules.has(ruleId)) {
      throw new Error(`Rule "${ruleId}" not found in standard "${standardId}"`);
    }

    const existing = rules.get(ruleId)!;

    if (updates.checkType !== undefined && !VALID_CHECK_TYPES.has(updates.checkType)) {
      throw new Error(
        `Invalid checkType "${updates.checkType}". Must be one of: ${[...VALID_CHECK_TYPES].join(', ')}`,
      );
    }
    if (updates.severity !== undefined && !VALID_SEVERITIES.has(updates.severity)) {
      throw new Error(
        `Invalid severity "${updates.severity}". Must be one of: ${[...VALID_SEVERITIES].join(', ')}`,
      );
    }

    if (updates.checkConfig !== undefined) {
      const checkType = updates.checkType ?? existing.checkType;
      this.validateCheckConfig(checkType, updates.checkConfig);
    }

    const updated: StandardRule = {
      id: existing.id,
      description: updates.description ?? existing.description,
      checkType: updates.checkType ?? existing.checkType,
      checkConfig: updates.checkConfig ?? { ...existing.checkConfig },
      severity: updates.severity ?? existing.severity,
      autoFixable: updates.autoFixable ?? existing.autoFixable,
      fixSuggestion: updates.fixSuggestion !== undefined
        ? updates.fixSuggestion
        : existing.fixSuggestion,
    };

    rules.set(ruleId, updated);
    return { ...updated, checkConfig: { ...updated.checkConfig } };
  }

  /**
   * Delete a custom rule from a standard.
   * Returns true if the rule was found and deleted, false otherwise.
   */
  deleteCustomRule(standardId: string, ruleId: string): boolean {
    if (!standardId || !ruleId) return false;
    const rules = this.customRules.get(standardId);
    if (!rules) return false;
    return rules.delete(ruleId);
  }

  /**
   * List all custom rules for a standard.
   * Returns only custom (non-template) rules.
   */
  listCustomRules(standardId: string): StandardRule[] {
    const rules = this.customRules.get(standardId);
    if (!rules) return [];
    return [...rules.values()].map((r) => ({
      ...r,
      checkConfig: { ...r.checkConfig },
    }));
  }

  /**
   * Check if a standard has any custom rules.
   */
  hasCustomRules(standardId: string): boolean {
    const rules = this.customRules.get(standardId);
    return !!rules && rules.size > 0;
  }

  /**
   * Get a specific custom rule by ID.
   */
  getCustomRule(standardId: string, ruleId: string): StandardRule | null {
    const rules = this.customRules.get(standardId);
    if (!rules) return null;
    const rule = rules.get(ruleId);
    if (!rule) return null;
    return { ...rule, checkConfig: { ...rule.checkConfig } };
  }

  // ---------------------------------------------------------------------------
  // Rule Validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a rule against sample source code.
   *
   * For regex rules, tests the pattern against the sample and returns
   * matched lines. For metric rules, computes the metric and indicates
   * whether the threshold is exceeded.
   */
  validateRule(rule: StandardRule, sampleCode: string): RuleValidationResult {
    const errors: string[] = [];
    const matches: Array<{ lineNumber: number; matchedText: string }> = [];

    // Structural validation
    if (!rule.id) errors.push('Rule ID is required');
    if (!rule.description) errors.push('Rule description is required');
    if (!rule.checkType) errors.push('Rule checkType is required');
    if (!VALID_CHECK_TYPES.has(rule.checkType)) {
      errors.push(`Invalid checkType "${rule.checkType}"`);
    }
    if (!rule.severity) errors.push('Rule severity is required');
    if (!VALID_SEVERITIES.has(rule.severity)) {
      errors.push(`Invalid severity "${rule.severity}"`);
    }

    if (errors.length > 0) {
      return { valid: false, matches, errors };
    }

    // Test the rule against sample code
    try {
      if (rule.checkType === 'regex') {
        const config = rule.checkConfig as { pattern: string; flags?: string };
        if (!config.pattern) {
          errors.push('Regex rule requires a "pattern" in checkConfig');
          return { valid: false, matches, errors };
        }

        const regex = new RegExp(config.pattern, config.flags ?? 'g');
        const lines = sampleCode.split('\n');
        const seenRanges = new Set<string>();

        let match: RegExpExecArray | null;
        while ((match = regex.exec(sampleCode)) !== null) {
          if (match[0].length === 0) { regex.lastIndex++; continue; }
          const lineNumber = this.getLineNumber(sampleCode, match.index);
          const rangeKey = `${lineNumber}:${match.index}`;
          if (!seenRanges.has(rangeKey)) {
            seenRanges.add(rangeKey);
            matches.push({
              lineNumber,
              matchedText: lines[lineNumber - 1]?.trim().slice(0, 100) ?? match[0],
            });
          }
        }
      } else if (rule.checkType === 'metric') {
        const config = rule.checkConfig as { metric?: string; threshold?: number };
        if (!config.metric) {
          errors.push('Metric rule requires a "metric" in checkConfig');
          return { valid: false, matches, errors };
        }
        if (config.threshold === undefined) {
          errors.push('Metric rule requires a "threshold" in checkConfig');
          return { valid: false, matches, errors };
        }

        const lines = sampleCode.split('\n');
        if (config.metric === 'function-lines') {
          // Estimate function boundary
          const funcMatch = sampleCode.match(/(?:function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>|class\s+\w+)/g);
          if (funcMatch && lines.length > config.threshold) {
            matches.push({
              lineNumber: 1,
              matchedText: `${lines.length} lines (threshold: ${config.threshold})`,
            });
          }
        } else if (config.metric === 'nesting-depth') {
          let maxDepth = 0;
          for (const line of lines) {
            if (line.trim() === '') continue;
            const indent = line.length - line.trimStart().length;
            const depth = Math.floor(indent / 2) + 1;
            if (depth > maxDepth) maxDepth = depth;
          }
          if (maxDepth > config.threshold) {
            matches.push({
              lineNumber: 1,
              matchedText: `Max nesting depth: ${maxDepth} (threshold: ${config.threshold})`,
            });
          }
        }
      }
      // ast-pattern, graph-query, llm-check don't produce sample matches
    } catch (err) {
      errors.push(
        `Rule validation error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { valid: false, matches, errors };
    }

    return {
      valid: errors.length === 0,
      matches,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------

  /**
   * Export all custom rules for a standard as JSON.
   */
  exportCustomRules(standardId: string): string {
    const rules = this.customRules.get(standardId);
    if (!rules) return JSON.stringify([]);
    return JSON.stringify([...rules.values()], null, 2);
  }

  /**
   * Import custom rules from a JSON string into a standard.
   * Replaces all existing custom rules for that standard.
   */
  importCustomRules(standardId: string, json: string): StandardRule[] {
    if (!standardId) {
      throw new Error('standardId is required');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid JSON: failed to parse custom rules');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Custom rules JSON must be an array');
    }

    const rules = this.getOrCreateRuleMap(standardId);
    rules.clear();

    const imported: StandardRule[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const ruleInput = item as Record<string, unknown>;

      const rule = this.createCustomRule(standardId, {
        id: typeof ruleInput['id'] === 'string' ? ruleInput['id'] : undefined,
        description: typeof ruleInput['description'] === 'string' ? ruleInput['description'] : '',
        checkType: (ruleInput['checkType'] as StandardRule['checkType']) ?? 'regex',
        checkConfig: (ruleInput['checkConfig'] as Record<string, unknown>) ?? {},
        severity: (ruleInput['severity'] as Severity) ?? 'medium',
        autoFixable: !!ruleInput['autoFixable'],
        fixSuggestion: typeof ruleInput['fixSuggestion'] === 'string'
          ? ruleInput['fixSuggestion']
          : undefined,
      });

      imported.push(rule);
    }

    return imported;
  }

  /**
   * Remove all custom rules for a standard.
   */
  clearCustomRules(standardId: string): void {
    this.customRules.delete(standardId);
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  /**
   * Get all built-in rule templates for quick rule creation.
   */
  getRuleTemplates(): RuleTemplate[] {
    return RULE_TEMPLATES.map((t) => ({ ...t, defaultConfig: { ...t.defaultConfig } }));
  }

  /**
   * Get a specific rule template by ID.
   */
  getRuleTemplate(templateId: string): RuleTemplate | null {
    return RULE_TEMPLATES.find((t) => t.id === templateId) ?? null;
  }

  /**
   * Create a rule from a template with optional overrides.
   */
  createRuleFromTemplate(
    standardId: string,
    templateId: string,
    overrides?: Partial<CreateRuleInput>,
  ): StandardRule {
    const template = this.getRuleTemplate(templateId);
    if (!template) {
      throw new Error(`Template "${templateId}" not found`);
    }

    return this.createCustomRule(standardId, {
      description: overrides?.description ?? template.description,
      checkType: overrides?.checkType ?? template.defaultConfig.checkType,
      checkConfig: overrides?.checkConfig ?? { ...template.defaultConfig.checkConfig },
      severity: overrides?.severity ?? template.defaultConfig.severity,
      autoFixable: overrides?.autoFixable ?? template.defaultConfig.autoFixable,
      fixSuggestion: overrides?.fixSuggestion,
    });
  }

  // ---------------------------------------------------------------------------
  // Integration: Merge custom rules into a ProjectStandard
  // ---------------------------------------------------------------------------

  /**
   * Merge custom rules into a ProjectStandard, producing a combined
   * standard with both built-in and custom rules.
   */
  mergeWithStandard(standardId: string, baseStandard: ProjectStandard): ProjectStandard {
    const customRules = this.listCustomRules(standardId);
    const mergedRules = [...baseStandard.rules];

    // Replace existing custom rules, add new ones
    for (const customRule of customRules) {
      const idx = mergedRules.findIndex((r) => r.id === customRule.id);
      if (idx >= 0) {
        mergedRules[idx] = customRule;
      } else {
        mergedRules.push(customRule);
      }
    }

    return {
      ...baseStandard,
      rules: mergedRules,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private getOrCreateRuleMap(standardId: string): Map<string, StandardRule> {
    let rules = this.customRules.get(standardId);
    if (!rules) {
      rules = new Map();
      this.customRules.set(standardId, rules);
    }
    return rules;
  }

  private generateRuleId(standardId: string): string {
    const existing = this.customRules.get(standardId);
    const count = existing ? existing.size : 0;
    return `custom-${standardId}-${count + 1}`;
  }

  private validateCheckConfig(
    checkType: StandardRule['checkType'],
    checkConfig: Record<string, unknown>,
  ): void {
    if (checkType === 'regex') {
      if (!checkConfig['pattern']) {
        throw new Error('Regex rules require a "pattern" field in checkConfig');
      }
      // Validate regex pattern compiles
      try {
        new RegExp(checkConfig['pattern'] as string, (checkConfig['flags'] as string) ?? 'g');
      } catch (err) {
        /* v8 ignore next 3 */ // new RegExp always throws SyntaxError (extends Error)
        throw new Error(
          `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (checkType === 'metric') {
      if (!checkConfig['metric']) {
        throw new Error('Metric rules require a "metric" field in checkConfig');
      }
      if (checkConfig['threshold'] === undefined) {
        throw new Error('Metric rules require a "threshold" field in checkConfig');
      }
    }
  }

  private getLineNumber(source: string, offset: number): number {
    return source.substring(0, offset).split('\n').length;
  }
}
