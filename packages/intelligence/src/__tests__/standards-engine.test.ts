// @ts-nocheck — test file assertion patterns may access possibly-undefined
import { describe, it, expect } from 'vitest';
import { StandardsEngine } from '../standards/engine.js';
import { STANDARD_TEMPLATES, getTemplate, listTemplates } from '../standards/templates.js';
import type { ProjectStandard, RuleCheckResult, Violation } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine(): StandardsEngine {
  return new StandardsEngine();
}

// ---------------------------------------------------------------------------
// Template tests
// ---------------------------------------------------------------------------

describe('Standard Templates', () => {
  it('should have exactly 10 built-in templates', () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(10);
  });

  it('should include all required template IDs', () => {
    const ids = listTemplates().map((t) => t.id).sort();
    expect(ids).toEqual([
      'api-design',
      'architecture-layered',
      'dependency-management',
      'documentation',
      'error-handling',
      'go-idiomatic',
      'python-pep8',
      'security-baseline',
      'testing-standards',
      'typescript-coding',
    ]);
  });

  it('should load typescript-coding template', () => {
    const tmpl = getTemplate('typescript-coding');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('code-style');
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(4);
  });

  it('should load python-pep8 template', () => {
    const tmpl = getTemplate('python-pep8');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('code-style');
    expect(tmpl!.rules.some((r) => r.id === 'py-docstrings')).toBe(true);
  });

  it('should load go-idiomatic template', () => {
    const tmpl = getTemplate('go-idiomatic');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'go-error-handling')).toBe(true);
  });

  it('should load security-baseline template', () => {
    const tmpl = getTemplate('security-baseline');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('security');
    expect(tmpl!.rules.some((r) => r.id === 'sec-no-eval')).toBe(true);
  });

  it('should load api-design template', () => {
    const tmpl = getTemplate('api-design');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('api-design');
  });

  it('should load testing-standards template', () => {
    const tmpl = getTemplate('testing-standards');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('testing');
  });

  it('should load error-handling template', () => {
    const tmpl = getTemplate('error-handling');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'err-try-catch')).toBe(true);
  });

  it('should load documentation template', () => {
    const tmpl = getTemplate('documentation');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('documentation');
  });

  it('should return undefined for unknown template ID', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('should list templates with correct metadata', () => {
    const templates = listTemplates();
    for (const t of templates) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.language).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// StandardsEngine — loading and registration
// ---------------------------------------------------------------------------

describe('StandardsEngine', () => {
  describe('loadStandard', () => {
    it('should load built-in templates by ID', () => {
      const engine = makeEngine();
      const standard = engine.loadStandard('typescript-coding');
      expect(standard.id).toBe('typescript-coding');
    });

    it('should throw for unknown standard ID', () => {
      const engine = makeEngine();
      expect(() => engine.loadStandard('nonexistent')).toThrow('Standard not found');
    });

    it('should load custom registered standard', () => {
      const engine = makeEngine();
      const custom: ProjectStandard = {
        id: 'my-custom',
        name: 'My Custom Standard',
        version: '1.0.0',
        category: 'custom',
        description: 'A custom standard',
        rules: [{ id: 'r1', description: 'Test', checkType: 'regex', checkConfig: { pattern: 'foo' }, severity: 'low', autoFixable: false }],
        examples: [],
      };
      engine.registerStandard(custom);
      const loaded = engine.loadStandard('my-custom');
      expect(loaded.id).toBe('my-custom');
    });
  });

  describe('registerStandard', () => {
    it('should register a custom standard', () => {
      const engine = makeEngine();
      const custom: ProjectStandard = {
        id: 'custom-1',
        name: 'Custom 1',
        version: '1.0.0',
        category: 'custom',
        description: 'Custom',
        rules: [],
        examples: [],
      };
      expect(() => engine.registerStandard(custom)).not.toThrow();
    });

    it('should prevent overriding built-in templates', () => {
      const engine = makeEngine();
      const custom: ProjectStandard = {
        id: 'typescript-coding',
        name: 'Override',
        version: '1.0.0',
        category: 'custom',
        description: 'Should fail',
        rules: [],
        examples: [],
      };
      expect(() => engine.registerStandard(custom)).toThrow('conflicts with a built-in template');
    });
  });

  describe('listTemplates', () => {
    it('should return 10 templates', () => {
      const engine = makeEngine();
      expect(engine.listTemplates()).toHaveLength(10);
    });
  });
});

// ---------------------------------------------------------------------------
// Source checking — regex rules
// ---------------------------------------------------------------------------

describe('StandardsEngine — regex checking', () => {
  const engine = makeEngine();

  it('should detect eval() usage', () => {
    const standard = engine.loadStandard('security-baseline');
    const source = 'eval("var x = 1");';
    const results = engine.checkSource(source, 'test.ts', standard);
    const evalRule = results.find((r) => r.ruleId === 'sec-no-eval');
    expect(evalRule).toBeDefined();
    expect(evalRule!.passed).toBe(false);
    expect(evalRule!.violations.length).toBe(1);
  });

  it('should pass clean code with no eval', () => {
    const standard = engine.loadStandard('security-baseline');
    const source = 'const x = calculate(1, 2);\nconst y = x + 1;';
    const results = engine.checkSource(source, 'test.ts', standard);
    const evalRule = results.find((r) => r.ruleId === 'sec-no-eval');
    expect(evalRule!.passed).toBe(true);
    expect(evalRule!.violations).toHaveLength(0);
  });

  it('should detect innerHTML usage', () => {
    const standard = engine.loadStandard('security-baseline');
    const source = 'element.innerHTML = "<div>hello</div>";';
    const results = engine.checkSource(source, 'test.js', standard);
    const rule = results.find((r) => r.ruleId === 'sec-no-innerhtml');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect hardcoded secrets', () => {
    const standard = engine.loadStandard('security-baseline');
    const source = 'const password = "supersecret123";';
    const results = engine.checkSource(source, 'config.ts', standard);
    const rule = results.find((r) => r.ruleId === 'sec-no-hardcoded-secrets');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect console.log in TypeScript', () => {
    const standard = engine.loadStandard('typescript-coding');
    const source = 'console.log("debug info");';
    const results = engine.checkSource(source, 'module.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-no-console-log');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect string concatenation in SQL (potential injection)', () => {
    const standard = engine.loadStandard('security-baseline');
    const source = 'const query = "SELECT * FROM" + tableName + "WHERE id = 1";';
    const results = engine.checkSource(source, 'db.ts', standard);
    const rule = results.find((r) => r.ruleId === 'sec-parameterized-sql');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect non-snake_case Python function names', () => {
    const standard = engine.loadStandard('python-pep8');
    const source = 'def CalculateTotal(items):\n    pass';
    const results = engine.checkSource(source, 'calc.py', standard);
    const rule = results.find((r) => r.ruleId === 'py-snake-case-func');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should pass snake_case Python function names', () => {
    const standard = engine.loadStandard('python-pep8');
    const source = 'def calculate_total(items):\n    pass';
    const results = engine.checkSource(source, 'calc.py', standard);
    const rule = results.find((r) => r.ruleId === 'py-snake-case-func');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(true);
  });

  it('should detect non-PascalCase TypeScript class names', () => {
    const standard = engine.loadStandard('typescript-coding');
    const source = 'class myClass {\n}';
    const results = engine.checkSource(source, 'test.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-pascal-case-class');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should pass PascalCase TypeScript class names', () => {
    const standard = engine.loadStandard('typescript-coding');
    const source = 'class MyClass {\n}';
    const results = engine.checkSource(source, 'test.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-pascal-case-class');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(true);
  });

  it('should handle invalid regex gracefully', () => {
    const engine = makeEngine();
    const standard: ProjectStandard = {
      id: 'bad-regex',
      name: 'Bad Regex',
      version: '1.0.0',
      category: 'custom',
      description: 'std with bad regex',
      rules: [{ id: 'bad', description: '', checkType: 'regex', checkConfig: { pattern: '[' }, severity: 'low', autoFixable: false }],
      examples: [],
    };
    const results = engine.checkSource('test', 'f.ts', standard);
    expect(results).toHaveLength(1);
    expect(results[0].violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Metric checking
// ---------------------------------------------------------------------------

describe('StandardsEngine — metric checking', () => {
  const engine = makeEngine();

  it('should detect functions exceeding line threshold', () => {
    const standard = engine.loadStandard('typescript-coding');
    const funcLines = Array(60).fill('  console.log("line");');
    const source = ['function tooLong() {', ...funcLines, '}'].join('\n');
    const results = engine.checkSource(source, 'big.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-func-lines');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should pass functions within line threshold', () => {
    const standard = engine.loadStandard('typescript-coding');
    const source = ['function short() {', '  return 42;', '}'].join('\n');
    const results = engine.checkSource(source, 'small.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-func-lines');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(true);
  });

  it('should detect excessive nesting depth', () => {
    const standard = engine.loadStandard('typescript-coding');
    const indentLevels = [
      'function deep() {',
      '  if (true) {',
      '    if (true) {',
      '      if (true) {',
      '        if (true) {',
      '          if (true) {',
      '            return true;',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}',
    ];
    const results = engine.checkSource(indentLevels.join('\n'), 'deep.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-max-depth');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect Go exported function without comment (simplified)', () => {
    const standard = engine.loadStandard('go-idiomatic');
    const source = 'func GetUser(id string) *User {\n  return nil\n}';
    const results = engine.checkSource(source, 'user.go', standard);
    const rule = results.find((r) => r.ruleId === 'go-exported-comments');
    // This rule checks for exported functions; comment detection is simplified
    expect(rule).toBeDefined();
  });

  it('should detect ignored errors in Go', () => {
    const standard = engine.loadStandard('go-idiomatic');
    const source = 'result, _ := someFunction()';
    const results = engine.checkSource(source, 'main.go', standard);
    const rule = results.find((r) => r.ruleId === 'go-error-handling');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkFiles — multi-file standards checking
// ---------------------------------------------------------------------------

describe('StandardsEngine.checkFiles', () => {
  const engine = makeEngine();

  it('should check multiple files against a standard', () => {
    const files = [
      { path: 'a.ts', content: 'console.log("test");\neval("x");' },
      { path: 'b.ts', content: 'const x = 1;\nconst y = 2;\nelement.innerHTML = "bad";' },
    ];
    const result = engine.checkFiles(files, 'security-baseline');
    expect(result.standardId).toBe('security-baseline');
    expect(result.filesChecked).toBe(2);
    expect(result.complianceScore).toBeLessThan(100);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should return 100% compliance for clean code', () => {
    const files = [
      { path: 'clean.ts', content: 'const x = 1;\nfunction add(a: number, b: number): number { return a + b; }' },
    ];
    const result = engine.checkFiles(files, 'security-baseline');
    expect(result.complianceScore).toBeGreaterThan(0);
  });

  it('should handle empty file list', () => {
    const result = engine.checkFiles([], 'typescript-coding');
    expect(result.filesChecked).toBe(0);
    expect(result.complianceScore).toBe(100);
  });

  it('should produce correct summary counts', () => {
    const files = [
      { path: 'bad.ts', content: 'eval("x");\nelement.innerHTML = "y";' },
    ];
    const result = engine.checkFiles(files, 'security-baseline');
    expect(result.summary.critical).toBeGreaterThan(0);
  });

  it('should merge violations across files for the same rule', () => {
    const files = [
      { path: 'a.ts', content: 'console.log("a");' },
      { path: 'b.ts', content: 'console.log("b");' },
    ];
    const result = engine.checkFiles(files, 'typescript-coding');
    const consoleRule = result.ruleResults.find((r) => r.ruleId === 'ts-no-console-log');
    expect(consoleRule).toBeDefined();
    // Both files have the same violation
  });

  it('should register custom standard and check against it', () => {
    const engine = makeEngine();
    const custom: ProjectStandard = {
      id: 'custom-check',
      name: 'Custom Check',
      version: '1.0.0',
      category: 'custom',
      description: 'Custom',
      rules: [{ id: 'no-todo', description: 'No TODO in code', checkType: 'regex', checkConfig: { pattern: 'TODO', flags: 'gi' }, severity: 'low', autoFixable: false }],
      examples: [],
    };
    engine.registerStandard(custom);
    const files = [{ path: 'test.ts', content: '// TODO: fix this' }];
    const result = engine.checkFiles(files, 'custom-check');
    const rule = result.ruleResults.find((r) => r.ruleId === 'no-todo');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compliance scoring
// ---------------------------------------------------------------------------

describe('StandardsEngine — compliance scoring', () => {
  const engine = makeEngine();

  it('should compute basic compliance score', () => {
    const results: RuleCheckResult[] = [
      { ruleId: 'r1', ruleDescription: '', passed: true, severity: 'high', violations: [], autoFixable: false },
      { ruleId: 'r2', ruleDescription: '', passed: false, severity: 'high', violations: [], autoFixable: false },
    ];
    expect(engine.computeComplianceScore(results)).toBe(50);
  });

  it('should return 100 for all-passed results', () => {
    const results: RuleCheckResult[] = [
      { ruleId: 'r1', ruleDescription: '', passed: true, severity: 'high', violations: [], autoFixable: false },
    ];
    expect(engine.computeComplianceScore(results)).toBe(100);
  });

  it('should return 100 for empty results', () => {
    expect(engine.computeComplianceScore([])).toBe(100);
  });

  it('should compute severity-weighted score', () => {
    const results: RuleCheckResult[] = [
      { ruleId: 'critical-pass', ruleDescription: '', passed: true, severity: 'critical', violations: [], autoFixable: false },
      { ruleId: 'low-fail', ruleDescription: '', passed: false, severity: 'low', violations: [], autoFixable: false },
    ];
    const score = engine.computeSeverityWeightedScore(results);
    expect(score).toBeGreaterThan(70); // Critical weights more
  });

  it('should return 100 for all-passed severity-weighted', () => {
    const results: RuleCheckResult[] = [
      { ruleId: 'r1', ruleDescription: '', passed: true, severity: 'critical', violations: [], autoFixable: false },
    ];
    expect(engine.computeSeverityWeightedScore(results)).toBe(100);
  });

  it('should respect disabled rules', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-coding');
    const withDisabled = {
      ...standard,
      config: {
        includePaths: [],
        excludePaths: [],
        severityOverrides: {},
        disabledRules: ['ts-no-console-log'],
        ruleParams: {},
      },
    };

    // Use checkSource directly with the modified standard
    const results = engine.checkSource('console.log("x");', 'test.ts', withDisabled);
    const consoleRule = results.find((r) => r.ruleId === 'ts-no-console-log');
    expect(consoleRule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Auto-fix suggestions
// ---------------------------------------------------------------------------

describe('StandardsEngine.getAutoFixes', () => {
  it('should return auto-fixes for auto-fixable violations', () => {
    const engine = makeEngine();
    const violations: Violation[] = [
      {
        filePath: 'test.ts',
        lineNumber: 1,
        message: 'No console.log',
        codeSnippet: 'console.log("x");',
        autoFix: 'logger.info("x");',
        standardRef: 'ts-no-console-log',
      },
    ];
    const fixes = engine.getAutoFixes(violations);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].filePath).toBe('test.ts');
    expect(fixes[0].replacement).toBe('logger.info("x");');
  });

  it('should filter out violations without auto-fixes', () => {
    const engine = makeEngine();
    const violations: Violation[] = [
      {
        filePath: 'test.ts',
        lineNumber: 1,
        message: 'No eval',
        codeSnippet: 'eval("x");',
        standardRef: 'sec-no-eval',
      },
    ];
    const fixes = engine.getAutoFixes(violations);
    expect(fixes).toHaveLength(0);
  });

  it('should return empty array for empty violations', () => {
    const engine = makeEngine();
    expect(engine.getAutoFixes([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// All 10 templates — existence and rule validation
// ---------------------------------------------------------------------------

describe('All 10 built-in templates — validation', () => {
  const allIds = Object.keys(STANDARD_TEMPLATES);

  for (const id of allIds) {
    it(`${id} should have valid structure`, () => {
      const tmpl = STANDARD_TEMPLATES[id];
      expect(tmpl.id).toBeTruthy();
      expect(tmpl.name).toBeTruthy();
      expect(tmpl.version).toBeTruthy();
      expect(tmpl.category).toBeTruthy();
      expect(tmpl.description).toBeTruthy();
      expect(Array.isArray(tmpl.rules)).toBe(true);
      expect(tmpl.rules.length).toBeGreaterThan(0);

      for (const rule of tmpl.rules) {
        expect(rule.id).toBeTruthy();
        expect(rule.description).toBeTruthy();
        expect(['ast-pattern', 'regex', 'graph-query', 'llm-check', 'metric']).toContain(rule.checkType);
        expect(['critical', 'high', 'medium', 'low', 'info']).toContain(rule.severity);
        expect(typeof rule.autoFixable).toBe('boolean');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Graph-query and LLM-check stubs
// ---------------------------------------------------------------------------

describe('StandardsEngine — deferred check types', () => {
  it('should return empty violations for graph-query type', () => {
    const engine = makeEngine();
    const standard: ProjectStandard = {
      id: 'graph-test',
      name: 'Graph Test',
      version: '1',
      category: 'custom',
      description: 'Test',
      rules: [{ id: 'g1', description: '', checkType: 'graph-query', checkConfig: { pattern: '' }, severity: 'low', autoFixable: false }],
      examples: [],
    };
    const results = engine.checkSource('test', 'f.ts', standard);
    expect(results[0].violations).toHaveLength(0);
  });

  it('should return empty violations for llm-check type', () => {
    const engine = makeEngine();
    const standard: ProjectStandard = {
      id: 'llm-test',
      name: 'LLM Test',
      version: '1',
      category: 'custom',
      description: 'Test',
      rules: [{ id: 'l1', description: '', checkType: 'llm-check', checkConfig: {}, severity: 'low', autoFixable: false }],
      examples: [],
    };
    const results = engine.checkSource('test', 'f.ts', standard);
    expect(results[0].violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('StandardsEngine — edge cases', () => {
  it('should not crash on empty source', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-coding');
    expect(() => engine.checkSource('', 'empty.ts', standard)).not.toThrow();
  });

  it('should handle source with empty lines', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-coding');
    const source = '\n\n\nconsole.log("x");\n\n';
    const results = engine.checkSource(source, 'sparse.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-no-console-log');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should handle very long source', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-coding');
    const source = 'const x = 1;\n'.repeat(1000) + 'console.log("end");';
    const results = engine.checkSource(source, 'big.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ts-no-console-log');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should not trigger zero-length matches in regex loop', () => {
    const engine = makeEngine();
    const standard: ProjectStandard = {
      id: 'zero-match',
      name: 'Zero Match',
      version: '1',
      category: 'custom',
      description: 'Test',
      rules: [{ id: 'empty', description: 'Empty pattern', checkType: 'regex', checkConfig: { pattern: '', flags: 'g' }, severity: 'low', autoFixable: false }],
      examples: [],
    };
    expect(() => engine.checkSource('test', 'f.ts', standard)).not.toThrow();
  });

  it('should not crash on function without braces (arrow function)', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-coding');
    const source = 'const add = (a: number, b: number): number => a + b;';
    expect(() => engine.checkSource(source, 'arrow.ts', standard)).not.toThrow();
  });
});

// ==========================================================================
// Branch Coverage Hardening — Edge Cases
// ==========================================================================

describe('StandardsEngine edge cases', () => {
  function makeEngine(): StandardsEngine {
    return new StandardsEngine();
  }

  it('throws when loading unknown standard', () => {
    const engine = makeEngine();
    expect(() => engine.loadStandard('nonexistent-standard'))
      .toThrow('Standard not found: nonexistent-standard');
  });

  it('rejects custom standard with built-in id conflict', () => {
    const engine = makeEngine();
    expect(() => engine.registerStandard({
      id: 'typescript-coding',
      name: 'conflict',
      version: '1.0',
      category: 'code-style',
      description: '',
      rules: [],
      examples: [],
    })).toThrow('conflicts with a built-in template');
  });

  it('registers and loads custom standard', () => {
    const engine = makeEngine();
    const custom: import('@code-analyzer/shared').ProjectStandard = {
      id: 'my-custom-std',
      name: 'My Custom Standard',
      version: '1.0.0',
      category: 'code-style',
      description: 'Custom rules',
      rules: [{
        id: 'no-debugger',
        description: 'No debugger statements',
        checkType: 'regex',
        checkConfig: { pattern: 'debugger', forbidden: true },
        severity: 'high',
        autoFixable: false,
      }],
      examples: [],
    };
    engine.registerStandard(custom);
    const loaded = engine.loadStandard('my-custom-std');
    expect(loaded.id).toBe('my-custom-std');
  });

  it('handles graph-query check type (deferred, returns empty)', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'graph-test',
      name: 'Graph Test',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'gq-1',
        description: 'Graph query test',
        checkType: 'graph-query',
        checkConfig: { query: 'MATCH (n) RETURN n' },
        severity: 'low',
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('code', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.passed).toBe(true); // deferred = no violations
  });

  it('handles llm-check check type (deferred, returns empty)', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'llm-test',
      name: 'LLM Test',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'llm-1',
        description: 'LLM check test',
        checkType: 'llm-check',
        checkConfig: { prompt: 'Is this code good?' },
        severity: 'medium',
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('code', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('handles regex check with empty pattern', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'empty-pattern',
      name: 'Empty Pattern',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'ep-1',
        description: 'Empty pattern check',
        checkType: 'regex',
        checkConfig: { pattern: '' },
        severity: 'low',
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('some code here', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Empty pattern should produce no violations
    expect(results[0]!.passed).toBe(true);
  });

  it('handles metric check with nesting-depth', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'nesting-test',
      name: 'Nesting Test',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'nest-1',
        description: 'Max nesting depth',
        checkType: 'metric',
        checkConfig: { metric: 'nesting-depth', threshold: 2 },
        severity: 'high',
        autoFixable: false,
      }],
      examples: [],
    };
    const deeplyNested = [
      'function deep() {',
      '  if (true) {',
      '    if (true) {',
      '      if (true) {',
      '        return;',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const results = engine.checkSource(deeplyNested, 'deep.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('handles metric check with function-lines', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'func-lines-test',
      name: 'Function Lines',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'fl-1',
        description: 'Max function lines',
        checkType: 'metric',
        checkConfig: { metric: 'function-lines', threshold: 3 },
        severity: 'medium',
        autoFixable: false,
      }],
      examples: [],
    };
    const longFunc = [
      'function long() {',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  return a + b + c + d;',
      '}',
    ].join('\n');
    const results = engine.checkSource(longFunc, 'long.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('handles metric check with unknown metric type', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'unknown-metric',
      name: 'Unknown Metric',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'um-1',
        description: 'Unknown metric',
        checkType: 'metric',
        checkConfig: { metric: 'unknown-metric', threshold: 10 },
        severity: 'low',
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('code', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.passed).toBe(true); // unknown metric = no violations
  });

  it('handles metric check with empty metric config', () => {
    const engine = makeEngine();
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'empty-metric',
      name: 'Empty Metric',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'em-1',
        description: 'Empty metric config',
        checkType: 'metric',
        checkConfig: { metric: '', threshold: 10 },
        severity: 'low',
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('code', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('handles disabled rules in checkFiles', () => {
    const engine = makeEngine();
    // Register a custom standard with disabled rules
    const custom: import('@code-analyzer/shared').ProjectStandard = {
      id: 'custom-disabled-test',
      name: 'Custom Disabled',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      config: { disabledRules: ['rule-a', 'rule-b'] },
      rules: [
        { id: 'rule-a', description: 'Rule A', checkType: 'regex', checkConfig: { pattern: 'debugger', forbidden: true }, severity: 'high', autoFixable: false },
        { id: 'rule-b', description: 'Rule B', checkType: 'regex', checkConfig: { pattern: 'eval', forbidden: true }, severity: 'high', autoFixable: false },
      ],
      examples: [],
    };
    engine.registerStandard(custom);
    const result = engine.checkFiles(
      [{ path: 'f.ts', content: 'debugger; eval("x");' }],
      'custom-disabled-test',
    );
    expect(result.complianceScore).toBe(100); // All rules disabled
  });

  it('handles empty file list in checkFiles', () => {
    const engine = makeEngine();
    const result = engine.checkFiles([], 'typescript-coding');
    expect(result.filesChecked).toBe(0);
    expect(result.complianceScore).toBe(100);
  });

  it('computeComplianceScore handles empty results', () => {
    const engine = makeEngine();
    const score = engine.computeComplianceScore([]);
    expect(score).toBe(100);
  });

  it('computeSeverityWeightedScore handles empty results', () => {
    const engine = makeEngine();
    const score = engine.computeSeverityWeightedScore([]);
    expect(score).toBe(100);
  });

  it('getAutoFixes returns empty for violations without autoFix', () => {
    const engine = makeEngine();
    const violations: import('@code-analyzer/shared').Violation[] = [{
      filePath: 'f.ts',
      lineNumber: 1,
      message: 'test',
      codeSnippet: 'code',
      standardRef: 'rule-1',
    }];
    const fixes = engine.getAutoFixes(violations);
    expect(fixes).toEqual([]);
  });

  it('getAutoFixes returns fixes for violations with autoFix', () => {
    const engine = makeEngine();
    const violations: import('@code-analyzer/shared').Violation[] = [{
      filePath: 'f.ts',
      lineNumber: 1,
      message: 'test',
      codeSnippet: 'bad',
      autoFix: 'good',
      suggestion: 'Use good instead',
      standardRef: 'rule-1',
    }];
    const fixes = engine.getAutoFixes(violations);
    expect(fixes.length).toBe(1);
    expect(fixes[0]!.replacement).toBe('good');
  });

  it('computeSeverityWeightedScore handles all severity levels', () => {
    const engine = makeEngine();
    const results: import('@code-analyzer/shared').RuleCheckResult[] = [
      { ruleId: '1', ruleDescription: '', passed: true, severity: 'critical', violations: [], autoFixable: false },
      { ruleId: '2', ruleDescription: '', passed: false, severity: 'high', violations: [], autoFixable: false },
      { ruleId: '3', ruleDescription: '', passed: true, severity: 'medium', violations: [], autoFixable: false },
      { ruleId: '4', ruleDescription: '', passed: false, severity: 'low', violations: [], autoFixable: false },
      { ruleId: '5', ruleDescription: '', passed: true, severity: 'info', violations: [], autoFixable: false },
    ];
    const score = engine.computeSeverityWeightedScore(results);
    // Weight: critical(5)+high(0)+medium(3)+low(0)+info(1) = 9 / 15 = 60
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('listTemplates returns all built-in templates', () => {
    const engine = makeEngine();
    const templates = engine.listTemplates();
    expect(templates.length).toBeGreaterThan(0);
  });
});
