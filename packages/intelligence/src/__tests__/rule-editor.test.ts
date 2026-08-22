// @ts-nocheck — test file assertion patterns may access possibly-undefined
import { describe, it, expect, beforeEach } from 'vitest';
import { CustomRuleEditor } from '../standards/rule-editor.js';
import type {
  CreateRuleInput,
  UpdateRuleInput,
  RuleValidationResult,
  RuleTemplate,
} from '../standards/rule-editor.js';
import type { StandardRule, ProjectStandard } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditor(): CustomRuleEditor {
  return new CustomRuleEditor();
}

function makeValidRegexInput(overrides?: Partial<CreateRuleInput>): CreateRuleInput {
  return {
    description: 'No console.log allowed',
    checkType: 'regex',
    checkConfig: { pattern: 'console\\.log' },
    severity: 'medium',
    autoFixable: false,
    ...overrides,
  };
}

function makeValidMetricInput(overrides?: Partial<CreateRuleInput>): CreateRuleInput {
  return {
    description: 'Max function size',
    checkType: 'metric',
    checkConfig: { metric: 'function-lines', threshold: 50 },
    severity: 'medium',
    autoFixable: false,
    ...overrides,
  };
}

const SAMPLE_CODE = `function doStuff() {
  console.log("debug message");
  console.log("another one");
  for (const item of items) {
    if (item.ok) {
      doWork(item);
    }
  }
}`;

const baseStandard: ProjectStandard = {
  id: 'test-standard',
  name: 'Test Standard',
  version: '1.0.0',
  category: 'custom' as const,
  description: 'Test',
  rules: [
    {
      id: 'existing-rule',
      description: 'Existing',
      checkType: 'regex' as const,
      checkConfig: { pattern: 'test' },
      severity: 'medium' as const,
      autoFixable: false,
    },
  ],
  examples: [],
};

// ---------------------------------------------------------------------------
// createCustomRule
// ---------------------------------------------------------------------------

describe('createCustomRule', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  // --- valid rules ---

  it('should create a valid regex rule with explicit ID', () => {
    const rule = editor.createCustomRule('std-1', makeValidRegexInput({ id: 'no-console' }));
    expect(rule.id).toBe('no-console');
    expect(rule.description).toBe('No console.log allowed');
    expect(rule.checkType).toBe('regex');
    expect(rule.checkConfig).toEqual({ pattern: 'console\\.log' });
    expect(rule.severity).toBe('medium');
    expect(rule.autoFixable).toBe(false);
  });

  it('should create a valid regex rule with flags', () => {
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'regex-with-flags',
        checkConfig: { pattern: 'TODO', flags: 'gi' },
      }),
    );
    expect(rule.checkConfig).toEqual({ pattern: 'TODO', flags: 'gi' });
  });

  it('should create a valid metric rule', () => {
    const rule = editor.createCustomRule('std-1', makeValidMetricInput({ id: 'max-func' }));
    expect(rule.checkType).toBe('metric');
    expect(rule.checkConfig).toEqual({ metric: 'function-lines', threshold: 50 });
  });

  it('should auto-generate ID when none provided', () => {
    const rule = editor.createCustomRule('std-1', makeValidRegexInput());
    expect(rule.id).toMatch(/^custom-std-1-\d+$/);
  });

  it('should generate sequential auto-IDs', () => {
    const r1 = editor.createCustomRule('std-1', makeValidRegexInput());
    const r2 = editor.createCustomRule('std-1', makeValidRegexInput());
    const r3 = editor.createCustomRule('std-1', makeValidRegexInput());
    expect(r1.id).toBe('custom-std-1-1');
    expect(r2.id).toBe('custom-std-1-2');
    expect(r3.id).toBe('custom-std-1-3');
  });

  it('should generate IDs scoped per standard', () => {
    const r1 = editor.createCustomRule('std-a', makeValidRegexInput());
    const r2 = editor.createCustomRule('std-b', makeValidRegexInput());
    expect(r1.id).toBe('custom-std-a-1');
    expect(r2.id).toBe('custom-std-b-1');
  });

  it('should default autoFixable to false', () => {
    const rule = editor.createCustomRule('std-1', {
      description: 'Test',
      checkType: 'regex',
      checkConfig: { pattern: 'test' },
      severity: 'low',
    });
    expect(rule.autoFixable).toBe(false);
  });

  it('should store and persist fixSuggestion', () => {
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'with-fix',
        fixSuggestion: 'Remove console.log calls',
      }),
    );
    expect(rule.fixSuggestion).toBe('Remove console.log calls');
  });

  it('should accept all valid severities', () => {
    const severities: Array<'critical' | 'high' | 'medium' | 'low' | 'info'> = [
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ];
    for (const sev of severities) {
      const rule = editor.createCustomRule('std-1', makeValidRegexInput({ severity: sev }));
      expect(rule.severity).toBe(sev);
    }
  });

  it('should accept all valid checkTypes', () => {
    const types: Array<StandardRule['checkType']> = [
      'regex',
      'metric',
      'ast-pattern',
      'graph-query',
      'llm-check',
    ];
    for (const ct of types) {
      const config =
        ct === 'metric'
          ? { metric: 'function-lines', threshold: 10 }
          : ct === 'regex'
            ? { pattern: 'test' }
            : {};
      const rule = editor.createCustomRule('std-1', {
        description: `Test ${ct}`,
        checkType: ct,
        checkConfig: config,
        severity: 'medium',
      });
      expect(rule.checkType).toBe(ct);
    }
  });

  // --- error cases ---

  it('should throw for empty standardId', () => {
    expect(() => editor.createCustomRule('', makeValidRegexInput())).toThrow(
      'standardId is required',
    );
  });

  it('should throw for missing description', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'medium',
      } as CreateRuleInput),
    ).toThrow('Rule description is required');
  });

  it('should throw for missing checkType', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkConfig: { pattern: 'test' },
        severity: 'medium',
      } as CreateRuleInput),
    ).toThrow('Rule checkType is required');
  });

  it('should throw for invalid checkType', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'invalid-type' as any,
        checkConfig: {},
        severity: 'medium',
      }),
    ).toThrow(/Invalid checkType/);
  });

  it('should throw for missing severity', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
      } as CreateRuleInput),
    ).toThrow('Rule severity is required');
  });

  it('should throw for invalid severity', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'extreme' as any,
      }),
    ).toThrow(/Invalid severity/);
  });

  it('should throw for regex rule without pattern', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'regex',
        checkConfig: {},
        severity: 'medium',
      }),
    ).toThrow('Regex rules require a "pattern" field in checkConfig');
  });

  it('should throw for invalid regex pattern', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'regex',
        checkConfig: { pattern: '[' },
        severity: 'medium',
      }),
    ).toThrow(/Invalid regex pattern/);
  });

  it('should throw for metric rule without metric field', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'metric',
        checkConfig: { threshold: 10 },
        severity: 'medium',
      }),
    ).toThrow('Metric rules require a "metric" field in checkConfig');
  });

  it('should throw for metric rule without threshold', () => {
    expect(() =>
      editor.createCustomRule('std-1', {
        description: 'Test',
        checkType: 'metric',
        checkConfig: { metric: 'function-lines' },
        severity: 'medium',
      }),
    ).toThrow('Metric rules require a "threshold" field in checkConfig');
  });

  it('should throw for duplicate rule ID', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'dup' }));
    expect(() => editor.createCustomRule('std-1', makeValidRegexInput({ id: 'dup' }))).toThrow(
      /already exists/,
    );
  });

  // --- isolation ---

  it('should allow same rule ID across different standards', () => {
    const r1 = editor.createCustomRule('std-a', makeValidRegexInput({ id: 'shared-id' }));
    const r2 = editor.createCustomRule('std-b', makeValidRegexInput({ id: 'shared-id' }));
    expect(r1.id).toBe(r2.id);
    expect(editor.listCustomRules('std-a')).toHaveLength(1);
    expect(editor.listCustomRules('std-b')).toHaveLength(1);
  });

  // --- return value immutability ---

  it('should return a new object (not the internal reference)', () => {
    const rule1 = editor.createCustomRule('std-1', makeValidRegexInput({ id: 'ref-test' }));
    const rule2 = editor.getCustomRule('std-1', 'ref-test');
    expect(rule1).not.toBe(rule2);
    expect(rule1).toEqual(rule2);
  });
});

// ---------------------------------------------------------------------------
// updateCustomRule
// ---------------------------------------------------------------------------

describe('updateCustomRule', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'rule-1' }));
    editor.createCustomRule('std-1', makeValidMetricInput({ id: 'rule-2' }));
  });

  it('should perform a partial update (description only)', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', {
      description: 'Updated description',
    });
    expect(updated.description).toBe('Updated description');
    expect(updated.checkType).toBe('regex');
    expect(updated.severity).toBe('medium');
    expect(updated.checkConfig).toEqual({ pattern: 'console\\.log' });
  });

  it('should perform a partial update (severity only)', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', { severity: 'critical' });
    expect(updated.severity).toBe('critical');
    expect(updated.description).toBe('No console.log allowed');
  });

  it('should perform a full update (all fields)', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', {
      description: 'Fully updated',
      checkType: 'metric',
      checkConfig: { metric: 'nesting-depth', threshold: 3 },
      severity: 'high',
      autoFixable: true,
      fixSuggestion: 'Refactor to reduce nesting',
    });
    expect(updated.description).toBe('Fully updated');
    expect(updated.checkType).toBe('metric');
    expect(updated.checkConfig).toEqual({ metric: 'nesting-depth', threshold: 3 });
    expect(updated.severity).toBe('high');
    expect(updated.autoFixable).toBe(true);
    expect(updated.fixSuggestion).toBe('Refactor to reduce nesting');
  });

  it('should update autoFixable', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', { autoFixable: true });
    expect(updated.autoFixable).toBe(true);
  });

  it('should update fixSuggestion', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', {
      fixSuggestion: 'Use a logger instead',
    });
    expect(updated.fixSuggestion).toBe('Use a logger instead');
  });

  it('should clear fixSuggestion when set to empty string', () => {
    const updated = editor.updateCustomRule('std-1', 'rule-1', { fixSuggestion: '' });
    expect(updated.fixSuggestion).toBe('');
  });

  it('should persist updates (getCustomRule returns updated data)', () => {
    editor.updateCustomRule('std-1', 'rule-1', { severity: 'critical' });
    const retrieved = editor.getCustomRule('std-1', 'rule-1');
    expect(retrieved?.severity).toBe('critical');
  });

  it('should throw for non-existent rule', () => {
    expect(() => editor.updateCustomRule('std-1', 'nonexistent', { description: 'X' })).toThrow(
      /not found/,
    );
  });

  it('should throw for non-existent standard', () => {
    expect(() => editor.updateCustomRule('no-std', 'rule-1', { description: 'X' })).toThrow(
      /not found/,
    );
  });

  it('should throw for empty standardId', () => {
    expect(() => editor.updateCustomRule('', 'rule-1', { description: 'X' })).toThrow(
      'standardId is required',
    );
  });

  it('should throw for empty ruleId', () => {
    expect(() => editor.updateCustomRule('std-1', '', { description: 'X' })).toThrow(
      'ruleId is required',
    );
  });

  it('should throw for invalid checkType in updates', () => {
    expect(() => editor.updateCustomRule('std-1', 'rule-1', { checkType: 'bogus' as any })).toThrow(
      /Invalid checkType/,
    );
  });

  it('should throw for invalid severity in updates', () => {
    expect(() =>
      editor.updateCustomRule('std-1', 'rule-1', { severity: 'catastrophic' as any }),
    ).toThrow(/Invalid severity/);
  });

  it('should throw when updated checkConfig is invalid for the new checkType', () => {
    // Change checkType to metric but don't provide valid checkConfig
    expect(() =>
      editor.updateCustomRule('std-1', 'rule-1', {
        checkType: 'metric',
        checkConfig: { pattern: 'test' }, // missing metric/threshold
      }),
    ).toThrow('Metric rules require a "metric" field in checkConfig');
  });

  it('should validate checkConfig against the original checkType when only checkConfig changes', () => {
    expect(() =>
      editor.updateCustomRule('std-1', 'rule-1', {
        checkConfig: { pattern: '[' }, // invalid regex
      }),
    ).toThrow(/Invalid regex pattern/);
  });

  it('should return a new object reference', () => {
    const a = editor.getCustomRule('std-1', 'rule-1')!;
    const b = editor.updateCustomRule('std-1', 'rule-1', { severity: 'low' });
    expect(a).not.toBe(b);
    expect(a.severity).toBe('medium'); // original unchanged
  });
});

// ---------------------------------------------------------------------------
// deleteCustomRule
// ---------------------------------------------------------------------------

describe('deleteCustomRule', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'rule-1' }));
  });

  it('should delete an existing rule and return true', () => {
    const result = editor.deleteCustomRule('std-1', 'rule-1');
    expect(result).toBe(true);
    expect(editor.hasCustomRules('std-1')).toBe(false);
  });

  it('should return false for a non-existent rule', () => {
    const result = editor.deleteCustomRule('std-1', 'no-such-rule');
    expect(result).toBe(false);
  });

  it('should return false for a non-existent standard', () => {
    const result = editor.deleteCustomRule('no-std', 'rule-1');
    expect(result).toBe(false);
  });

  it('should return false for an empty standardId', () => {
    const result = editor.deleteCustomRule('', 'rule-1');
    expect(result).toBe(false);
  });

  it('should return false for an empty ruleId', () => {
    const result = editor.deleteCustomRule('std-1', '');
    expect(result).toBe(false);
  });

  it('should only delete the specified rule, not others', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'rule-2' }));
    editor.deleteCustomRule('std-1', 'rule-1');
    expect(editor.getCustomRule('std-1', 'rule-1')).toBeNull();
    expect(editor.getCustomRule('std-1', 'rule-2')).not.toBeNull();
    expect(editor.listCustomRules('std-1')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// listCustomRules
// ---------------------------------------------------------------------------

describe('listCustomRules', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  it('should return an empty array when no rules exist', () => {
    expect(editor.listCustomRules('std-1')).toEqual([]);
  });

  it('should return an empty array for a non-existent standard', () => {
    expect(editor.listCustomRules('no-std')).toEqual([]);
  });

  it('should return all created rules', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.createCustomRule('std-1', makeValidMetricInput({ id: 'r2' }));
    const rules = editor.listCustomRules('std-1');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('should return copies, not internal references', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    const rules1 = editor.listCustomRules('std-1');
    const rules2 = editor.listCustomRules('std-1');
    expect(rules1).not.toBe(rules2);
    expect(rules1[0]).not.toBe(rules2[0]);
  });

  it('should be isolated between standards', () => {
    editor.createCustomRule('std-a', makeValidRegexInput({ id: 'a1' }));
    editor.createCustomRule('std-b', makeValidRegexInput({ id: 'b1' }));
    expect(editor.listCustomRules('std-a')).toHaveLength(1);
    expect(editor.listCustomRules('std-b')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getCustomRule
// ---------------------------------------------------------------------------

describe('getCustomRule', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'rule-1' }));
  });

  it('should return the rule when found', () => {
    const rule = editor.getCustomRule('std-1', 'rule-1');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('rule-1');
  });

  it('should return null for a non-existent rule', () => {
    expect(editor.getCustomRule('std-1', 'nonexistent')).toBeNull();
  });

  it('should return null for a non-existent standard', () => {
    expect(editor.getCustomRule('no-std', 'rule-1')).toBeNull();
  });

  it('should return a copy, not the internal reference', () => {
    const a = editor.getCustomRule('std-1', 'rule-1')!;
    const b = editor.getCustomRule('std-1', 'rule-1')!;
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// hasCustomRules
// ---------------------------------------------------------------------------

describe('hasCustomRules', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  it('should return false when no rules exist', () => {
    expect(editor.hasCustomRules('std-1')).toBe(false);
  });

  it('should return false for a non-existent standard', () => {
    expect(editor.hasCustomRules('no-std')).toBe(false);
  });

  it('should return true when rules exist', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    expect(editor.hasCustomRules('std-1')).toBe(true);
  });

  it('should return false after all rules are deleted', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.deleteCustomRule('std-1', 'r1');
    expect(editor.hasCustomRules('std-1')).toBe(false);
  });

  it('should return false after clearCustomRules', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.clearCustomRules('std-1');
    expect(editor.hasCustomRules('std-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRule
// ---------------------------------------------------------------------------

describe('validateRule', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  // --- regex matches ---

  it('should match regex rules against sample code', () => {
    const rule = editor.createCustomRule('std-1', makeValidRegexInput({ id: 'no-console' }));
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.valid).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.errors).toEqual([]);
    expect(result.matches.some((m) => m.matchedText.includes('console.log'))).toBe(true);
  });

  it('should return no matches when regex does not match sample', () => {
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'no-match',
        checkConfig: { pattern: 'nonexistent_pattern_xyz' },
      }),
    );
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('should respect regex flags', () => {
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'case-sensitive',
        checkConfig: { pattern: 'DO_STUFF', flags: '' }, // no flags = case-sensitive
      }),
    );
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.matches).toEqual([]);
  });

  it('should report line numbers', () => {
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'console',
        checkConfig: { pattern: 'console\\.log' },
      }),
    );
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    for (const m of result.matches) {
      expect(m.lineNumber).toBeGreaterThan(0);
    }
  });

  // --- metric: function-lines ---

  it('should match metric:function-lines when lines exceed threshold', () => {
    // The metric:function-lines check requires a function-like signature in the code
    const longCode = 'function test() {\n' + '  line;\n'.repeat(58) + '}\n';
    const rule = editor.createCustomRule(
      'std-1',
      makeValidMetricInput({
        id: 'max-lines',
        checkConfig: { metric: 'function-lines', threshold: 50 },
      }),
    );
    const result = editor.validateRule(rule, longCode);
    expect(result.valid).toBe(true);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchedText).toContain('threshold');
  });

  it('should not match metric:function-lines when under threshold', () => {
    const shortCode = 'function test() {\n  line;\n}\n';
    const rule = editor.createCustomRule(
      'std-1',
      makeValidMetricInput({
        id: 'max-lines',
        checkConfig: { metric: 'function-lines', threshold: 50 },
      }),
    );
    const result = editor.validateRule(rule, shortCode);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  // --- metric: nesting-depth ---

  it('should match metric:nesting-depth when depth exceeds threshold', () => {
    const nestedCode = `function test() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            doSomething();
          }
        }
      }
    }
  }
}`;
    const rule = editor.createCustomRule(
      'std-1',
      makeValidMetricInput({
        id: 'max-nesting',
        checkConfig: { metric: 'nesting-depth', threshold: 3 },
      }),
    );
    const result = editor.validateRule(rule, nestedCode);
    expect(result.valid).toBe(true);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].matchedText).toContain('nesting depth');
  });

  it('should not match metric:nesting-depth when under threshold', () => {
    const shallowCode = `function test() {
  doWork();
}`;
    const rule = editor.createCustomRule(
      'std-1',
      makeValidMetricInput({
        id: 'max-nesting',
        checkConfig: { metric: 'nesting-depth', threshold: 10 },
      }),
    );
    const result = editor.validateRule(rule, shallowCode);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  // --- structural validation errors ---

  it('should report missing rule ID', () => {
    const rule = {
      description: 'Test',
      checkType: 'regex' as const,
      checkConfig: { pattern: 'test' },
      severity: 'medium' as const,
      autoFixable: false,
      id: '',
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Rule ID is required');
  });

  it('should report missing description', () => {
    const rule = {
      id: 'r1',
      description: '',
      checkType: 'regex' as const,
      checkConfig: { pattern: 'test' },
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Rule description is required');
  });

  it('should report missing checkType', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: '' as any,
      checkConfig: { pattern: 'test' },
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Rule checkType is required');
  });

  it('should report invalid checkType', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'bogus' as any,
      checkConfig: {},
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid checkType'))).toBe(true);
  });

  it('should report missing severity', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'regex' as const,
      checkConfig: { pattern: 'test' },
      severity: '' as any,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Rule severity is required');
  });

  it('should report invalid severity', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'regex' as const,
      checkConfig: { pattern: 'test' },
      severity: 'extreme' as any,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid severity'))).toBe(true);
  });

  it('should report missing regex pattern', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'regex' as const,
      checkConfig: {} as any,
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Regex rule requires a "pattern" in checkConfig');
  });

  it('should catch invalid regex pattern at validation time', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'regex' as const,
      checkConfig: { pattern: '[', flags: 'g' },
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid regular expression'))).toBe(true);
  });

  it('should validate metric rule missing metric field', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'metric' as const,
      checkConfig: { threshold: 10 },
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Metric rule requires a "metric" in checkConfig');
  });

  it('should validate metric rule missing threshold', () => {
    const rule = {
      id: 'r1',
      description: 'Test',
      checkType: 'metric' as const,
      checkConfig: { metric: 'function-lines' },
      severity: 'medium' as const,
      autoFixable: false,
    };
    const result = editor.validateRule(rule, 'code');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Metric rule requires a "threshold" in checkConfig');
  });

  // --- non-regex/metric checkTypes pass structural validation ---

  it('should validate ast-pattern rules as structurally valid', () => {
    const rule = editor.createCustomRule('std-1', {
      description: 'AST pattern rule',
      checkType: 'ast-pattern',
      checkConfig: { nodeType: 'CallExpression' },
      severity: 'medium',
    });
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should validate graph-query rules as structurally valid', () => {
    const rule = editor.createCustomRule('std-1', {
      description: 'Graph query rule',
      checkType: 'graph-query',
      checkConfig: { query: 'SELECT * FROM nodes' },
      severity: 'medium',
    });
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should validate llm-check rules as structurally valid', () => {
    const rule = editor.createCustomRule('std-1', {
      description: 'LLM check rule',
      checkType: 'llm-check',
      checkConfig: { prompt: 'Check security' },
      severity: 'medium',
    });
    const result = editor.validateRule(rule, SAMPLE_CODE);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// exportCustomRules / importCustomRules
// ---------------------------------------------------------------------------

describe('exportCustomRules and importCustomRules', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  it('should export empty rules as empty JSON array', () => {
    const json = editor.exportCustomRules('std-1');
    expect(JSON.parse(json)).toEqual([]);
  });

  it('should export non-existent standard as empty JSON array', () => {
    const json = editor.exportCustomRules('no-std');
    expect(JSON.parse(json)).toEqual([]);
  });

  it('should export rules as valid JSON', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.createCustomRule('std-1', makeValidMetricInput({ id: 'r2' }));
    const json = editor.exportCustomRules('std-1');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('should round-trip rules through export and import', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1', description: 'Original' }));
    editor.createCustomRule('std-1', makeValidMetricInput({ id: 'r2' }));

    const exported = editor.exportCustomRules('std-1');

    const editor2 = makeEditor();
    const imported = editor2.importCustomRules('std-2', exported);

    expect(imported).toHaveLength(2);
    expect(imported.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('should round-trip with all fields preserved', () => {
    const input = makeValidRegexInput({
      id: 'full-rule',
      description: 'Full rule',
      fixSuggestion: 'Fix it',
      autoFixable: true,
      severity: 'critical',
    });
    editor.createCustomRule('std-1', input);
    const exported = editor.exportCustomRules('std-1');

    const editor2 = makeEditor();
    const imported = editor2.importCustomRules('std-2', exported);

    expect(imported[0].id).toBe('full-rule');
    expect(imported[0].description).toBe('Full rule');
    expect(imported[0].fixSuggestion).toBe('Fix it');
    expect(imported[0].autoFixable).toBe(true);
    expect(imported[0].severity).toBe('critical');
  });

  it('should import rules and replace existing ones in the target', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'old' }));
    expect(editor.listCustomRules('std-1')).toHaveLength(1);

    // Import different rules into the same standard
    const importJson = JSON.stringify([
      {
        id: 'new-rule',
        description: 'Imported',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'low',
      },
    ]);
    editor.importCustomRules('std-1', importJson);
    const rules = editor.listCustomRules('std-1');
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('new-rule');
  });

  it('should throw for invalid JSON', () => {
    expect(() => editor.importCustomRules('std-1', 'not json {{{')).toThrow('Invalid JSON');
  });

  it('should throw for non-array JSON', () => {
    expect(() => editor.importCustomRules('std-1', '{"key":"value"}')).toThrow(
      'Custom rules JSON must be an array',
    );
  });

  it('should throw for empty standardId', () => {
    expect(() => editor.importCustomRules('', '[]')).toThrow('standardId is required');
  });

  it('should handle an empty array import', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.importCustomRules('std-1', '[]');
    expect(editor.listCustomRules('std-1')).toEqual([]);
  });

  it('should skip non-object items in import array', () => {
    const json = JSON.stringify([
      null,
      'string',
      42,
      {
        id: 'valid-rule',
        description: 'OK',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'low',
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe('valid-rule');
  });

  it('should handle items with non-string id (use undefined)', () => {
    const json = JSON.stringify([
      {
        id: 123,
        description: 'test',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'medium',
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toMatch(/^custom-std-1-/);
  });

  it('should handle items with non-string description (use empty)', () => {
    const json = JSON.stringify([
      {
        id: 'r1',
        description: null,
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'low',
      },
    ]);
    expect(() => editor.importCustomRules('std-1', json)).toThrow('Rule description is required');
  });

  it('should handle items with null checkType (use default regex)', () => {
    const json = JSON.stringify([
      {
        id: 'r1',
        description: 'test',
        checkConfig: { pattern: 'test' },
        severity: 'low',
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].checkType).toBe('regex');
  });

  it('should handle items with null checkConfig (use empty)', () => {
    const json = JSON.stringify([
      {
        id: 'r1',
        description: 'test',
        checkType: 'ast-pattern',
        severity: 'low',
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].checkConfig).toEqual({});
  });

  it('should handle items with null severity (use default medium)', () => {
    const json = JSON.stringify([
      {
        id: 'r1',
        description: 'test',
        checkType: 'metric',
        checkConfig: { metric: 'nesting-depth', threshold: 4 },
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].severity).toBe('medium');
  });

  it('should handle non-string fixSuggestion', () => {
    const json = JSON.stringify([
      {
        id: 'r1',
        description: 'test',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'low',
        fixSuggestion: 42,
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].fixSuggestion).toBeUndefined();
  });

  it('should handle missing id field by auto-generating', () => {
    const json = JSON.stringify([
      {
        description: 'auto-id test',
        checkType: 'regex',
        checkConfig: { pattern: 'test' },
        severity: 'low',
      },
    ]);
    const imported = editor.importCustomRules('std-1', json);
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toMatch(/^custom-std-1-/);
  });
});

// ---------------------------------------------------------------------------
// clearCustomRules
// ---------------------------------------------------------------------------

describe('clearCustomRules', () => {
  it('should remove all rules for a standard', () => {
    const editor = makeEditor();
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r1' }));
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'r2' }));
    editor.clearCustomRules('std-1');
    expect(editor.listCustomRules('std-1')).toEqual([]);
    expect(editor.hasCustomRules('std-1')).toBe(false);
  });

  it('should not throw for a non-existent standard', () => {
    const editor = makeEditor();
    expect(() => editor.clearCustomRules('no-std')).not.toThrow();
  });

  it('should not affect other standards', () => {
    const editor = makeEditor();
    editor.createCustomRule('std-a', makeValidRegexInput({ id: 'a1' }));
    editor.createCustomRule('std-b', makeValidRegexInput({ id: 'b1' }));
    editor.clearCustomRules('std-a');
    expect(editor.listCustomRules('std-a')).toEqual([]);
    expect(editor.listCustomRules('std-b')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getRuleTemplates
// ---------------------------------------------------------------------------

describe('getRuleTemplates', () => {
  it('should return all 9 built-in templates', () => {
    const editor = makeEditor();
    const templates = editor.getRuleTemplates();
    expect(templates).toHaveLength(9);
  });

  it('should include expected template IDs', () => {
    const editor = makeEditor();
    const ids = editor
      .getRuleTemplates()
      .map((t) => t.id)
      .sort();
    expect(ids).toEqual([
      'template-max-file-lines',
      'template-max-function-size',
      'template-max-nesting-depth',
      'template-naming-convention',
      'template-no-banned-imports',
      'template-no-console-in-production',
      'template-no-todo-merge',
      'template-require-error-handling',
      'template-require-jsdoc',
    ]);
  });

  it('should return copies (not internal references)', () => {
    const editor = makeEditor();
    const a = editor.getRuleTemplates();
    const b = editor.getRuleTemplates();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('should have proper structure for each template', () => {
    const editor = makeEditor();
    const templates = editor.getRuleTemplates();
    for (const t of templates) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('category');
      expect(t).toHaveProperty('defaultConfig');
      expect(t.defaultConfig).toHaveProperty('checkType');
      expect(t.defaultConfig).toHaveProperty('checkConfig');
      expect(t.defaultConfig).toHaveProperty('severity');
      expect(t.defaultConfig).toHaveProperty('autoFixable');
    }
  });
});

// ---------------------------------------------------------------------------
// getRuleTemplate
// ---------------------------------------------------------------------------

describe('getRuleTemplate', () => {
  it('should return a template by ID', () => {
    const editor = makeEditor();
    const t = editor.getRuleTemplate('template-naming-convention');
    expect(t).not.toBeNull();
    expect(t!.name).toBe('Naming Convention');
    expect(t!.category).toBe('style');
  });

  it('should return null for a non-existent template', () => {
    const editor = makeEditor();
    expect(editor.getRuleTemplate('nonexistent-template')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createRuleFromTemplate
// ---------------------------------------------------------------------------

describe('createRuleFromTemplate', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  it('should create a rule from a template', () => {
    const rule = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production');
    expect(rule.checkType).toBe('regex');
    expect(rule.severity).toBe('low');
    expect(rule.description).toContain('console.log');
    expect(rule.checkConfig).toHaveProperty('pattern');
  });

  it('should create a metric rule from a template', () => {
    const rule = editor.createRuleFromTemplate('std-1', 'template-max-function-size');
    expect(rule.checkType).toBe('metric');
    expect(rule.checkConfig).toEqual({ metric: 'function-lines', threshold: 50 });
    expect(rule.severity).toBe('medium');
  });

  it('should apply overrides to a template-based rule', () => {
    const rule = editor.createRuleFromTemplate('std-1', 'template-max-function-size', {
      severity: 'critical',
      description: 'Custom max function size',
      checkConfig: { metric: 'function-lines', threshold: 100 },
    });
    expect(rule.severity).toBe('critical');
    expect(rule.description).toBe('Custom max function size');
    expect(rule.checkConfig.threshold).toBe(100);
  });

  it('should allow overriding checkType via overrides', () => {
    const rule = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production', {
      checkType: 'regex',
    });
    expect(rule.checkType).toBe('regex');
  });

  it('should allow overriding fixSuggestion via overrides', () => {
    const rule = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production', {
      fixSuggestion: 'Use structured logging',
    });
    expect(rule.fixSuggestion).toBe('Use structured logging');
  });

  it('should throw for a non-existent template', () => {
    expect(() => editor.createRuleFromTemplate('std-1', 'nonexistent-template')).toThrow(
      /not found/,
    );
  });

  it('should generate unique IDs for template-based rules', () => {
    const r1 = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production');
    const r2 = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production');
    expect(r1.id).not.toBe(r2.id);
    expect(r1.id).toMatch(/^custom-std-1-\d+$/);
  });

  it('should always auto-generate IDs (id in overrides is not forwarded)', () => {
    // createRuleFromTemplate does not forward id from overrides to createCustomRule
    const rule = editor.createRuleFromTemplate('std-1', 'template-no-console-in-production', {
      id: 'should-be-ignored',
    });
    expect(rule.id).toMatch(/^custom-std-1-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// mergeWithStandard
// ---------------------------------------------------------------------------

describe('mergeWithStandard', () => {
  let editor: CustomRuleEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  it('should return the base standard unchanged when no custom rules exist', () => {
    const merged = editor.mergeWithStandard('std-1', baseStandard);
    expect(merged.rules).toHaveLength(1);
    expect(merged.rules[0].id).toBe('existing-rule');
    expect(merged.id).toBe('test-standard');
    expect(merged.name).toBe('Test Standard');
  });

  it('should add custom rules that do not exist in the base', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'new-rule' }));
    const merged = editor.mergeWithStandard('std-1', baseStandard);
    expect(merged.rules).toHaveLength(2);
    expect(merged.rules.map((r) => r.id).sort()).toEqual(['existing-rule', 'new-rule']);
  });

  it('should replace existing rules with matching IDs', () => {
    editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'existing-rule',
        description: 'Replaced',
        severity: 'critical',
      }),
    );
    const merged = editor.mergeWithStandard('std-1', baseStandard);
    expect(merged.rules).toHaveLength(1);
    expect(merged.rules[0].id).toBe('existing-rule');
    expect(merged.rules[0].description).toBe('Replaced');
    expect(merged.rules[0].severity).toBe('critical');
  });

  it('should handle a mix of new and replacement rules', () => {
    // Replace existing-rule
    editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'existing-rule',
        description: 'Updated existing',
        severity: 'high',
      }),
    );
    // Add new
    editor.createCustomRule('std-1', makeValidMetricInput({ id: 'new-metric' }));

    const merged = editor.mergeWithStandard('std-1', baseStandard);
    expect(merged.rules).toHaveLength(2);

    const byId = Object.fromEntries(merged.rules.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(['existing-rule', 'new-metric']);
    expect(byId['existing-rule'].description).toBe('Updated existing');
    expect(byId['existing-rule'].severity).toBe('high');
    expect(byId['new-metric'].checkType).toBe('metric');
  });

  it('should not mutate the base standard', () => {
    const originalRules = [...baseStandard.rules];
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'new-rule' }));
    editor.mergeWithStandard('std-1', baseStandard);
    expect(baseStandard.rules).toHaveLength(1);
    expect(baseStandard.rules).toEqual(originalRules);
  });

  it('should preserve other base standard properties', () => {
    editor.createCustomRule('std-1', makeValidRegexInput({ id: 'added' }));
    const merged = editor.mergeWithStandard('std-1', baseStandard);
    expect(merged.id).toBe('test-standard');
    expect(merged.name).toBe('Test Standard');
    expect(merged.version).toBe('1.0.0');
    expect(merged.category).toBe('custom');
    expect(merged.examples).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle standard IDs with special characters', () => {
    const editor = makeEditor();
    const rule = editor.createCustomRule('std-with-dashes_123', makeValidRegexInput({ id: 'r1' }));
    expect(rule.id).toBe('r1');
    expect(editor.getCustomRule('std-with-dashes_123', 'r1')).not.toBeNull();
  });

  it('should handle rules with empty string fixSuggestion', () => {
    const editor = makeEditor();
    const rule = editor.createCustomRule(
      'std-1',
      makeValidRegexInput({
        id: 'empty-fix',
        fixSuggestion: '',
      }),
    );
    expect(rule.fixSuggestion).toBe('');
  });

  it('should handle multiple standards independently', () => {
    const editor = makeEditor();
    const ids = ['std-a', 'std-b', 'std-c', 'std-d', 'std-e'];

    for (const stdId of ids) {
      editor.createCustomRule(stdId, makeValidRegexInput({ id: `${stdId}-rule-1` }));
      editor.createCustomRule(stdId, makeValidRegexInput({ id: `${stdId}-rule-2` }));
    }

    for (const stdId of ids) {
      expect(editor.listCustomRules(stdId)).toHaveLength(2);
    }

    // Delete from one should not affect others
    editor.deleteCustomRule('std-c', 'std-c-rule-1');
    expect(editor.listCustomRules('std-c')).toHaveLength(1);
    expect(editor.listCustomRules('std-a')).toHaveLength(2);
  });

  it('should handle a large number of rules in one standard', () => {
    const editor = makeEditor();
    const count = 100;
    for (let i = 0; i < count; i++) {
      editor.createCustomRule('std-1', makeValidRegexInput({ id: `rule-${i}` }));
    }
    expect(editor.listCustomRules('std-1')).toHaveLength(count);
    expect(editor.getCustomRule('std-1', 'rule-50')).not.toBeNull();
    expect(editor.getCustomRule('std-1', 'rule-99')).not.toBeNull();
  });

  it('should handle creating a rule with all optional fields set', () => {
    const editor = makeEditor();
    const rule = editor.createCustomRule('std-1', {
      id: 'full-rule',
      description: 'A fully specified rule',
      checkType: 'regex',
      checkConfig: { pattern: 'test', flags: 'gim' },
      severity: 'critical',
      autoFixable: true,
      fixSuggestion: 'Refactor this code',
    });
    expect(rule.id).toBe('full-rule');
    expect(rule.autoFixable).toBe(true);
    expect(rule.fixSuggestion).toBe('Refactor this code');
    expect(rule.checkConfig).toEqual({ pattern: 'test', flags: 'gim' });
  });

  it('should allow creating rules for an empty string standardId (rejected)', () => {
    const editor = makeEditor();
    expect(() => editor.createCustomRule('', makeValidRegexInput())).toThrow(
      'standardId is required',
    );
  });

  it('should handle exporting and importing deeply nested checkConfig', () => {
    const editor = makeEditor();
    const deepConfig = {
      pattern: 'test',
      nested: { key: 'value', list: [1, 2, 3], deep: { inner: true } },
    };
    editor.createCustomRule('std-1', {
      id: 'deep-config',
      description: 'Deep config',
      checkType: 'regex',
      checkConfig: deepConfig,
      severity: 'low',
    });
    const exported = editor.exportCustomRules('std-1');
    const parsed = JSON.parse(exported);
    expect(parsed[0].checkConfig).toEqual(deepConfig);
  });

  it('should handle creating and then immediately deleting the only rule', () => {
    const editor = makeEditor();
    const rule = editor.createCustomRule('std-1', makeValidRegexInput({ id: 'temp' }));
    expect(editor.hasCustomRules('std-1')).toBe(true);
    editor.deleteCustomRule('std-1', 'temp');
    expect(editor.hasCustomRules('std-1')).toBe(false);
    expect(editor.listCustomRules('std-1')).toEqual([]);
  });
});
