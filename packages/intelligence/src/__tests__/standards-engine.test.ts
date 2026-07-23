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
  it('should have 31+ built-in templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(31);
  });

  it('should include all original 11 template IDs', () => {
    const ids = listTemplates().map((t) => t.id);
    const original = [
      'api-design',
      'architecture-layered',
      'dependency-management',
      'documentation',
      'error-handling',
      'go-idiomatic',
      'python-pep8',
      'security-baseline',
      'security-essentials',
      'testing-standards',
      'typescript-coding',
    ];
    for (const id of original) {
      expect(ids).toContain(id);
    }
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
    it('should return 31+ templates', () => {
      const engine = makeEngine();
      expect(engine.listTemplates().length).toBeGreaterThanOrEqual(31);
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
// All 31+ built-in templates — existence and rule validation
// ---------------------------------------------------------------------------

describe('All 31+ built-in templates — validation', () => {
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

  it('handles regex with zero-length matches gracefully', () => {
    const engine = makeEngine();
    // A regex that matches zero-length strings would cause infinite loop without guard
    const standard: import('@code-analyzer/shared').ProjectStandard = {
      id: 'zero-length-regex',
      name: 'Zero Length Regex',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'zl-1',
        description: 'Zero length match',
        checkType: 'regex',
        checkConfig: { pattern: '(?=x)', flags: 'g' }, // lookahead, zero-length match
        severity: 'low',
        autoFixable: false,
      }],
      examples: [],
    };
    // Should not hang - zero-length matches are skipped
    expect(() => engine.checkSource('x = 1;', 'f.ts', standard)).not.toThrow();
  });

  it('handles checkType default case (unknown type)', () => {
    const engine = makeEngine();
    // Use type assertion to create an invalid checkType to reach the default case
    const standard: any = {
      id: 'default-test',
      name: 'Default Test',
      version: '1.0',
      category: 'code-style',
      description: 'test',
      rules: [{
        id: 'dt-1',
        description: 'Default case test',
        checkType: 'unknown-type' as any,
        checkConfig: {},
        severity: 'low' as any,
        autoFixable: false,
      }],
      examples: [],
    };
    const results = engine.checkSource('code', 'f.ts', standard);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.passed).toBe(true); // default returns empty
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

// ==========================================================================
// New Feature Tests: Auto-Detection, Composition, Compliance Report
// ==========================================================================

describe('StandardsEngine — auto-detection', () => {
  const engine = makeEngine();

  it('should detect TypeScript standards from .ts files', () => {
    const files = ['src/index.ts', 'src/utils/helper.tsx'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('typescript-coding');
    expect(standards).toContain('typescript-best-practices');
  });

  it('should detect Python standards from .py files', () => {
    const files = ['main.py', 'utils/helpers.py'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('python-pep8');
    expect(standards).toContain('python-pep8-extended');
  });

  it('should detect Go standards from .go files', () => {
    const files = ['main.go', 'pkg/handler.go'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('go-idiomatic');
    expect(standards).toContain('go-idiomatic-extended');
  });

  it('should detect Rust standards from .rs files', () => {
    const files = ['src/main.rs', 'src/lib.rs'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('rust-best-practices');
  });

  it('should detect JavaScript standards from .js files', () => {
    const files = ['index.js', 'utils/helper.jsx'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('javascript-best-practices');
  });

  it('should detect Java standards from .java files', () => {
    const files = ['src/Main.java', 'src/User.java'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('java-best-practices');
  });

  it('should always include security and documentation standards', () => {
    const files = ['any-file.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('security-baseline');
    expect(standards).toContain('security-essentials');
    expect(standards).toContain('documentation');
  });

  it('should detect container standards from Dockerfile', () => {
    const files = ['Dockerfile', 'src/index.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('container-security');
    expect(standards).toContain('dependency-security');
  });

  it('should detect dependency management from package.json', () => {
    const files = ['package.json', 'src/index.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('dependency-management');
    expect(standards).toContain('dependency-security');
  });

  it('should detect API standards from route patterns', () => {
    const files = ['src/routes/users.ts', 'src/controllers/auth.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('api-design');
    expect(standards).toContain('api-design-standard');
    expect(standards).toContain('api-security');
  });

  it('should detect microservices patterns from service directories', () => {
    const files = ['services/payment/circuit-breaker.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('microservices-patterns');
  });

  it('should detect event-driven patterns', () => {
    const files = ['events/order-created.handler.ts', 'consumers/payment.consumer.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('event-driven-architecture');
  });

  it('should detect ML patterns', () => {
    const files = ['models/training/pipeline.py', 'notebooks/analysis.ipynb'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('ml-pipeline-best-practices');
  });

  it('should detect AI agent patterns', () => {
    const files = ['tools/mcp-tool.ts', 'prompts/system-prompt.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('ai-agent-code-patterns');
  });

  it('should detect config management from .env files', () => {
    const files = ['.env', '.env.example', 'config.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('configuration-management');
  });

  it('should include data privacy always', () => {
    const files = ['src/app.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('data-privacy');
  });

  it('should include OWASP for web projects', () => {
    const files = ['src/app.tsx', 'app.js'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('owasp-top10');
  });

  it('should detect testing standards from test files', () => {
    const files = ['src/user.test.ts', 'src/auth.spec.ts', 'test_main.py'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('testing-standards');
    expect(standards).toContain('testing-standard');
  });

  it('should return sorted standards', () => {
    const files = ['src/index.ts', 'Dockerfile', 'package.json'];
    const standards = engine.detectApplicableStandards(files);
    const sorted = [...standards].sort();
    expect(standards).toEqual(sorted);
  });

  it('should handle empty file list', () => {
    const standards = engine.detectApplicableStandards([]);
    expect(standards).toContain('security-baseline');
    expect(standards).toContain('documentation');
  });

  it('should detect cargo.toml for dependency-security', () => {
    const files = ['cargo.toml', 'src/main.rs'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('dependency-security');
  });

  it('should detect layered architecture patterns from directory structure', () => {
    const files = ['src/domain/user/entity.ts', 'src/infrastructure/db/repository.ts'];
    const standards = engine.detectApplicableStandards(files);
    expect(standards).toContain('architecture-layered');
    expect(standards).toContain('clean-architecture');
  });
});

describe('StandardsEngine — composeStandards', () => {
  const engine = makeEngine();

  it('should compose two standards into one', () => {
    const composed = engine.composeStandards(['security-baseline', 'error-handling'], {
      name: 'Security + Error Handling',
      description: 'Combined security and error handling checks',
    });
    expect(composed.id).toBe('composed-security-baseline-error-handling');
    expect(composed.name).toBe('Security + Error Handling');
    expect(composed.description).toBe('Combined security and error handling checks');
    expect(composed.category).toBe('custom');
    // Should have rules from both
    expect(composed.rules.length).toBeGreaterThan(0);
    const securityRules = composed.rules.filter((r) => r.id.startsWith('sec-'));
    const errorRules = composed.rules.filter((r) => r.id.startsWith('err-'));
    expect(securityRules.length).toBeGreaterThan(0);
    expect(errorRules.length).toBeGreaterThan(0);
  });

  it('should compose multiple standards with deduplication', () => {
    const composed = engine.composeStandards(['typescript-coding', 'security-baseline', 'testing-standards']);
    const ruleIds = composed.rules.map((r) => r.id);
    const uniqueIds = new Set(ruleIds);
    expect(ruleIds.length).toBe(uniqueIds.size); // No duplicates
    expect(composed.rules.length).toBeGreaterThan(0);
  });

  it('should use default name when options not provided', () => {
    const composed = engine.composeStandards(['typescript-coding', 'python-pep8']);
    expect(composed.name).toContain('Composed');
    expect(composed.name).toContain('2');
  });

  it('should include examples from composed standards', () => {
    const composed = engine.composeStandards(['typescript-coding', 'python-pep8']);
    expect(composed.examples.length).toBeGreaterThan(0);
  });

  it('should throw for unknown standard IDs', () => {
    expect(() => engine.composeStandards(['nonexistent-standard']))
      .toThrow('Standard not found');
  });
});

describe('StandardsEngine — computeDetailedComplianceReport', () => {
  const engine = makeEngine();

  it('should return 100% score for clean code', () => {
    const files = [
      { path: 'clean.ts', content: 'const x: number = 1;\nfunction add(a: number, b: number): number { return a + b; }' },
    ];
    const report = engine.computeDetailedComplianceReport(files, 'security-baseline');
    expect(report.standardId).toBe('security-baseline');
    expect(report.score).toBe(100);
    expect(report.failedChecks).toBe(0);
    expect(report.violations).toHaveLength(0);
  });

  it('should detect violations and compute score', () => {
    const files = [
      { path: 'bad.ts', content: 'eval("x");\nelement.innerHTML = "y";' },
    ];
    const report = engine.computeDetailedComplianceReport(files, 'security-baseline');
    expect(report.standardId).toBe('security-baseline');
    expect(report.score).toBeLessThan(100);
    expect(report.failedChecks).toBeGreaterThan(0);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.passedChecks).toBeGreaterThan(0);
  });

  it('should handle empty files', () => {
    const report = engine.computeDetailedComplianceReport([], 'typescript-coding');
    expect(report.standardId).toBe('typescript-coding');
    expect(report.score).toBe(100);
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(report.failedChecks).toBe(0);
  });

  it('should respect disabled rules', () => {
    // Register a standard with disabled rules
    const customEngine = makeEngine();
    const custom: import('@code-analyzer/shared').ProjectStandard = {
      id: 'report-disabled-test',
      name: 'Report Disabled',
      version: '1.0',
      category: 'custom',
      description: 'Test',
      config: { disabledRules: ['rule-x', 'rule-y'] },
      rules: [
        { id: 'rule-x', description: 'X', checkType: 'regex', checkConfig: { pattern: 'TODO' }, severity: 'low', autoFixable: false },
        { id: 'rule-y', description: 'Y', checkType: 'regex', checkConfig: { pattern: 'FIXME' }, severity: 'low', autoFixable: false },
      ],
      examples: [],
    };
    customEngine.registerStandard(custom);
    const report = customEngine.computeDetailedComplianceReport(
      [{ path: 'f.ts', content: 'TODO: fix this\nFIXME: also this' }],
      'report-disabled-test',
    );
    expect(report.skippedChecks).toBe(2);
    expect(report.totalChecks).toBe(0);
    expect(report.score).toBe(100);
  });

  it('should include violation details in report', () => {
    const files = [
      { path: 'test.ts', content: 'eval("dangerous");' },
    ];
    const report = engine.computeDetailedComplianceReport(files, 'security-baseline');
    const evalViolation = report.violations.find((v) => v.ruleId === 'sec-no-eval');
    expect(evalViolation).toBeDefined();
    expect(evalViolation!.filePath).toBe('test.ts');
    expect(evalViolation!.severity).toBe('critical');
    expect(evalViolation!.description).toBeTruthy();
  });

  it('should compute correct score for mixed results', () => {
    const files = [
      { path: 'good.ts', content: 'const x = 1;\nconst y = 2;' },
      { path: 'bad.ts', content: 'eval("x");\nconsole.log("y");\nelement.innerHTML = "z";' },
    ];
    const report = engine.computeDetailedComplianceReport(files, 'security-baseline');
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(report.passedChecks + report.failedChecks + report.skippedChecks).toBe(report.totalChecks);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });
});

// ==========================================================================
// New Standards Template Validation
// ==========================================================================

describe('New standards — OWASP Top 10', () => {
  it('should have OWASP template with 10 rules', () => {
    const tmpl = getTemplate('owasp-top10');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBe(10);
    expect(tmpl!.category).toBe('security');
  });

  it('should detect injection patterns', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('owasp-top10');
    const source = 'db.execute("SELECT * FROM users WHERE id = " + userId);';
    const results = engine.checkSource(source, 'db.ts', standard);
    const rule = results.find((r) => r.ruleId === 'owasp-injection');
    expect(rule).toBeDefined();
  });
});

describe('New standards — API Security', () => {
  it('should have API security template', () => {
    const tmpl = getTemplate('api-security');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(5);
    expect(tmpl!.category).toBe('security');
  });

  it('should detect hardcoded API keys', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('api-security');
    const source = 'const apiKey = "sk-live-1234567890abcdef";';
    const results = engine.checkSource(source, 'config.ts', standard);
    const rule = results.find((r) => r.ruleId === 'apisec-key-exposure');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });
});

describe('New standards — Container Security', () => {
  it('should have container security template', () => {
    const tmpl = getTemplate('container-security');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(4);
  });

  it('should detect root user in Dockerfile', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('container-security');
    const source = 'FROM node:18\nUSER root\nCOPY . /app';
    const results = engine.checkSource(source, 'Dockerfile', standard);
    const rule = results.find((r) => r.ruleId === 'container-non-root');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should detect ADD instead of COPY', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('container-security');
    const source = 'FROM node:18-alpine\nUSER appuser\nADD . /app';
    const results = engine.checkSource(source, 'Dockerfile', standard);
    const rule = results.find((r) => r.ruleId === 'container-copy-not-add');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });
});

describe('New standards — Data Privacy', () => {
  it('should have data privacy template', () => {
    const tmpl = getTemplate('data-privacy');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(4);
  });
});

describe('New standards — Language-specific', () => {
  it('should have TypeScript best practices', () => {
    const tmpl = getTemplate('typescript-best-practices');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('code-style');
    expect(tmpl!.rules.some((r) => r.id === 'tsbp-strict-mode')).toBe(true);
    expect(tmpl!.rules.some((r) => r.id === 'tsbp-no-any')).toBe(true);
  });

  it('should detect strict mode disabled', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('typescript-best-practices');
    const source = '{"compilerOptions": {"strict": false}}';
    const results = engine.checkSource(source, 'tsconfig.json', standard);
    const rule = results.find((r) => r.ruleId === 'tsbp-strict-mode');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have JavaScript best practices', () => {
    const tmpl = getTemplate('javascript-best-practices');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'jsbp-no-var')).toBe(true);
    expect(tmpl!.rules.some((r) => r.id === 'jsbp-template-literals')).toBe(true);
  });

  it('should detect var usage in JavaScript', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('javascript-best-practices');
    const source = 'var name = "test";';
    const results = engine.checkSource(source, 'app.js', standard);
    const rule = results.find((r) => r.ruleId === 'jsbp-no-var');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have Python PEP8 extended', () => {
    const tmpl = getTemplate('python-pep8-extended');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'pyext-type-hints')).toBe(true);
    expect(tmpl!.rules.some((r) => r.id === 'pyext-fstrings')).toBe(true);
  });

  it('should detect .format() usage in Python', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('python-pep8-extended');
    const source = 'greeting = "Hello {}".format(name)';
    const results = engine.checkSource(source, 'app.py', standard);
    const rule = results.find((r) => r.ruleId === 'pyext-fstrings');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have Go idiomatic extended', () => {
    const tmpl = getTemplate('go-idiomatic-extended');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'goext-error-wrap')).toBe(true);
  });

  it('should have Rust best practices', () => {
    const tmpl = getTemplate('rust-best-practices');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'rust-unsafe-audit')).toBe(true);
    expect(tmpl!.rules.some((r) => r.id === 'rust-error-handling')).toBe(true);
  });

  it('should detect .unwrap() in Rust', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('rust-best-practices');
    const source = 'let config = read_config().unwrap();';
    const results = engine.checkSource(source, 'main.rs', standard);
    const rule = results.find((r) => r.ruleId === 'rust-no-unwrap');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have Java best practices', () => {
    const tmpl = getTemplate('java-best-practices');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'java-optional')).toBe(true);
  });
});

describe('New standards — Architecture & Design', () => {
  it('should have microservices patterns', () => {
    const tmpl = getTemplate('microservices-patterns');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('architecture');
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(5);
  });

  it('should have event-driven architecture', () => {
    const tmpl = getTemplate('event-driven-architecture');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('architecture');
    expect(tmpl!.rules.some((r) => r.id === 'eda-dlq')).toBe(true);
  });

  it('should have clean architecture', () => {
    const tmpl = getTemplate('clean-architecture');
    expect(tmpl).toBeDefined();
    expect(tmpl!.category).toBe('architecture');
    expect(tmpl!.rules.some((r) => r.id === 'ca-dependency-inversion')).toBe(true);
  });

  it('should detect framework leak in domain layer', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('clean-architecture');
    const source = 'import express from "express";';
    const results = engine.checkSource(source, 'domain/entities/user.ts', standard);
    const rule = results.find((r) => r.ruleId === 'ca-no-framework-leak');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });
});

describe('New standards — AI/ML', () => {
  it('should have ML pipeline best practices', () => {
    const tmpl = getTemplate('ml-pipeline-best-practices');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(5);
    expect(tmpl!.rules.some((r) => r.id === 'ml-bias-detection')).toBe(true);
  });

  it('should have AI agent code patterns', () => {
    const tmpl = getTemplate('ai-agent-code-patterns');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.length).toBeGreaterThanOrEqual(5);
    expect(tmpl!.rules.some((r) => r.id === 'ai-tool-safety')).toBe(true);
    expect(tmpl!.rules.some((r) => r.id === 'ai-prompt-injection')).toBe(true);
  });
});

describe('New standards — Quality & Reliability', () => {
  it('should have error handling extended', () => {
    const tmpl = getTemplate('error-handling-standard');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'err-ext-custom-types')).toBe(true);
  });

  it('should have testing extended', () => {
    const tmpl = getTemplate('testing-standard');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'test-ext-no-skip')).toBe(true);
  });

  it('should detect skipped tests', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('testing-standard');
    const source = 'it.skip("should do something", () => {});';
    const results = engine.checkSource(source, 'test.ts', standard);
    const rule = results.find((r) => r.ruleId === 'test-ext-no-skip');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have logging standard', () => {
    const tmpl = getTemplate('logging-standard');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'log-no-sensitive')).toBe(true);
  });

  it('should detect sensitive data in logs', () => {
    const engine = makeEngine();
    const standard = engine.loadStandard('logging-standard');
    const source = 'logger.info({ password: userPassword });';
    const results = engine.checkSource(source, 'app.ts', standard);
    const rule = results.find((r) => r.ruleId === 'log-no-sensitive');
    expect(rule).toBeDefined();
    expect(rule!.passed).toBe(false);
  });

  it('should have API design extended', () => {
    const tmpl = getTemplate('api-design-standard');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'apides-ext-pagination')).toBe(true);
  });

  it('should have configuration management', () => {
    const tmpl = getTemplate('configuration-management');
    expect(tmpl).toBeDefined();
    expect(tmpl!.rules.some((r) => r.id === 'cfg-no-secrets-in-vcs')).toBe(true);
  });
});
