// @code-analyzer/intelligence — Delegation Mode Tests

import { describe, it, expect } from 'vitest';
import { DelegationManager } from '../review/delegation-mode.js';
import type {
  DelegatePreview,
  ResolvedRule,
} from '../review/delegation-mode.js';
import type { ProjectStandard } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function manager(): DelegationManager {
  return new DelegationManager();
}

function makeStandard(overrides: Partial<ProjectStandard> = {}): ProjectStandard {
  return {
    id: 'std-1',
    name: 'TypeScript Style Guide',
    version: '1.0.0',
    category: 'code-style',
    description: 'Standard TypeScript code style rules',
    rules: [
      {
        id: 'no-var',
        description: 'Use const or let instead of var',
        checkType: 'regex',
        checkConfig: { pattern: '\\bvar\\b' },
        severity: 'low',
        autoFixable: true,
        fixSuggestion: 'Replace var with const or let',
      },
      {
        id: 'no-console',
        description: 'Avoid console.log in production code',
        checkType: 'regex',
        checkConfig: { pattern: 'console\\.(log|warn|error)' },
        severity: 'medium',
        autoFixable: false,
      },
    ],
    examples: [
      {
        description: 'Use const for immutable variables',
        compliant: true,
        code: 'const x = 1;',
      },
    ],
    ...overrides,
  };
}

function makeSecurityStandard(): ProjectStandard {
  return {
    id: 'std-security',
    name: 'Security Rules',
    version: '1.0.0',
    category: 'security',
    description: 'Security-focused rules',
    rules: [
      {
        id: 'no-eval',
        description: 'Do not use eval()',
        checkType: 'regex',
        checkConfig: { pattern: '\\beval\\(' },
        severity: 'critical',
        autoFixable: false,
      },
    ],
    examples: [],
  };
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

describe('preview', () => {
  it('creates a scan mode preview with file bundles', () => {
    const files = [
      '/project/src/a.ts',
      '/project/src/b.ts',
      '/project/src/c.ts',
    ];

    const result = manager().preview(files, '/project');

    expect(result.mode).toBe('scan');
    expect(result.totalFiles).toBe(3);
    expect(result.totalBundles).toBe(1);
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]!.files).toEqual(files);
  });

  it('creates a diff mode preview with ref metadata', () => {
    const files = ['/project/src/a.ts'];
    const ref = { from: 'main', to: 'feature/branch' };

    const result = manager().preview(files, '/project', 'diff', ref);

    expect(result.mode).toBe('diff');
    expect(result.ref).toEqual(ref);
    expect(result.totalFiles).toBe(1);
  });

  it('splits files into multiple bundles based on bundleSize', () => {
    const files = Array.from(
      { length: 25 },
      (_, i) => `/project/src/file${i}.ts`,
    );

    const result = manager().preview(files, '/project', 'scan', undefined, 10);

    expect(result.totalBundles).toBe(3);
    expect(result.bundles).toHaveLength(3);
    expect(result.bundles[0]!.files).toHaveLength(10);
    expect(result.bundles[1]!.files).toHaveLength(10);
    expect(result.bundles[2]!.files).toHaveLength(5);
  });

  it('filters files outside the project root', () => {
    const files = [
      '/project/src/a.ts',
      '/other/b.ts',
      '/project/src/c.ts',
    ];

    const result = manager().preview(files, '/project');

    expect(result.totalFiles).toBe(2);
    expect(result.bundles[0]!.files).toEqual([
      '/project/src/a.ts',
      '/project/src/c.ts',
    ]);
  });

  it('handles empty file list', () => {
    const result = manager().preview([], '/project');

    expect(result.totalFiles).toBe(0);
    expect(result.totalBundles).toBe(0);
    expect(result.bundles).toEqual([]);
  });

  it('handles single file', () => {
    const result = manager().preview(['/project/src/a.ts'], '/project');

    expect(result.totalFiles).toBe(1);
    expect(result.totalBundles).toBe(1);
    expect(result.bundles[0]!.files).toEqual(['/project/src/a.ts']);
  });

  it('uses default bundleSize of 10 when not specified', () => {
    const files = Array.from(
      { length: 15 },
      (_, i) => `/project/src/file${i}.ts`,
    );

    const result = manager().preview(files, '/project');

    expect(result.totalBundles).toBe(2);
    expect(result.bundles[0]!.files).toHaveLength(10);
    expect(result.bundles[1]!.files).toHaveLength(5);
  });

  it('initializes bundle ruleIds as empty arrays', () => {
    const files = ['/project/src/a.ts'];

    const result = manager().preview(files, '/project');

    expect(result.bundles[0]!.ruleIds).toEqual([]);
  });

  it('handles ref as undefined for scan mode', () => {
    const files = ['/project/src/a.ts'];

    const result = manager().preview(files, '/project', 'scan');

    expect(result.ref).toBeUndefined();
  });

  it('includes ref when provided for diff mode', () => {
    const files = ['/project/src/a.ts'];
    const ref = { from: 'v1.0', to: 'v2.0' };

    const result = manager().preview(files, '/project', 'diff', ref);

    expect(result.ref).toEqual({ from: 'v1.0', to: 'v2.0' });
  });
});

// ---------------------------------------------------------------------------
// resolveRules
// ---------------------------------------------------------------------------

describe('resolveRules', () => {
  it('resolves rules for a TypeScript file with code-style standard', () => {
    const standard = makeStandard();
    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toHaveLength(2);
    expect(rules[0]!.ruleId).toBe('no-var');
    expect(rules[0]!.category).toBe('code-style');
    expect(rules[0]!.severity).toBe('low');
    expect(rules[0]!.appliesTo).toContain('*.ts');
  });

  it('resolves rules for a JavaScript file', () => {
    const standard = makeStandard();
    const rules = manager().resolveRules('/project/src/app.js', [standard]);

    expect(rules).toHaveLength(2);
    expect(rules[0]!.appliesTo).toContain('*.js');
  });

  it('returns empty array for unsupported file extensions', () => {
    const standard = makeStandard();
    const rules = manager().resolveRules('/project/src/image.png', [standard]);

    expect(rules).toEqual([]);
  });

  it('handles files without extension', () => {
    const standard = makeStandard();
    const rules = manager().resolveRules('/project/Dockerfile', [standard]);

    expect(rules).toEqual([]);
  });

  it('resolves rules from multiple standards', () => {
    const codeStyle = makeStandard();
    const security = makeSecurityStandard();

    const rules = manager().resolveRules('/project/src/app.ts', [
      codeStyle,
      security,
    ]);

    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.ruleId)).toEqual([
      'no-var',
      'no-console',
      'no-eval',
    ]);
  });

  it('includes security rules for ts files', () => {
    const security = makeSecurityStandard();
    const rules = manager().resolveRules('/project/src/app.ts', [security]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.severity).toBe('critical');
  });

  it('uses checkConfig pattern as the resolved pattern', () => {
    const standard = makeStandard();
    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules[0]!.pattern).toBe('\\bvar\\b');
  });

  it('stringifies non-string checkConfig patterns', () => {
    const standard: ProjectStandard = {
      id: 'std-custom',
      name: 'Custom Rules',
      version: '1.0.0',
      category: 'custom',
      description: 'Custom check rules',
      rules: [
        {
          id: 'custom-rule',
          description: 'A custom rule',
          checkType: 'ast-pattern',
          checkConfig: { nodeType: 'VariableDeclaration', kind: 'var' },
          severity: 'medium',
          autoFixable: false,
        },
      ],
      examples: [],
    };

    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.pattern).toContain('nodeType');
  });

  it('respects standard includePaths for filtering', () => {
    const standard: ProjectStandard = {
      id: 'std-ts-only',
      name: 'TS Only',
      version: '1.0.0',
      category: 'code-style',
      description: 'Only for TypeScript files',
      rules: [
        {
          id: 'ts-rule',
          description: 'TS-specific rule',
          checkType: 'regex',
          checkConfig: { pattern: 'test' },
          severity: 'low',
          autoFixable: false,
        },
      ],
      examples: [],
      config: {
        includePaths: ['src/*.ts'],
        excludePaths: [],
        severityOverrides: {},
        disabledRules: [],
        ruleParams: {},
      },
    };

    const tsRules = manager().resolveRules('/project/src/app.ts', [standard]);
    expect(tsRules).toHaveLength(1);

    const jsRules = manager().resolveRules('/project/src/app.js', [standard]);
    expect(jsRules).toHaveLength(0);
  });

  it('handles empty standards array', () => {
    const rules = manager().resolveRules('/project/src/app.ts', []);

    expect(rules).toEqual([]);
  });

  it('handles standard with no rules', () => {
    const standard: ProjectStandard = {
      id: 'std-empty',
      name: 'Empty Standard',
      version: '1.0.0',
      category: 'custom',
      description: 'No rules defined',
      rules: [],
      examples: [],
    };

    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toEqual([]);
  });

  it('handles wildcard includePaths', () => {
    const standard: ProjectStandard = {
      id: 'std-all',
      name: 'All Files',
      version: '1.0.0',
      category: 'code-style',
      description: 'Applies to everything',
      rules: [
        {
          id: 'all-rule',
          description: 'Applies to all files',
          checkType: 'regex',
          checkConfig: { pattern: 'test' },
          severity: 'low',
          autoFixable: false,
        },
      ],
      examples: [],
      config: {
        includePaths: ['**/*'],
        excludePaths: [],
        severityOverrides: {},
        disabledRules: [],
        ruleParams: {},
      },
    };

    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.appliesTo).toContain('*.ts');
  });

  it('handles category not in the known category-to-extensions map', () => {
    const standard: ProjectStandard = {
      id: 'std-unknown-cat',
      name: 'Unknown Category',
      version: '1.0.0',
      category: 'documentation',
      description: 'Documentation rules',
      rules: [
        {
          id: 'doc-rule',
          description: 'Doc rule',
          checkType: 'regex',
          checkConfig: { pattern: 'TODO' },
          severity: 'info',
          autoFixable: false,
        },
      ],
      examples: [],
    };

    // 'documentation' IS in the map, so test with a supported ext
    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.category).toBe('documentation');
  });

  it('handles wildcard includePath (*)', () => {
    const standard: ProjectStandard = {
      id: 'std-wildcard',
      name: 'Wildcard',
      version: '1.0.0',
      category: 'code-style',
      description: 'Wildcard include',
      rules: [
        {
          id: 'wild-rule',
          description: 'Wildcard rule',
          checkType: 'regex',
          checkConfig: { pattern: 'test' },
          severity: 'low',
          autoFixable: false,
        },
      ],
      examples: [],
      config: {
        includePaths: ['*'],
        excludePaths: [],
        severityOverrides: {},
        disabledRules: [],
        ruleParams: {},
      },
    };

    const rules = manager().resolveRules('/project/src/app.ts', [standard]);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.appliesTo).toContain('*.ts');
  });
});

// ---------------------------------------------------------------------------
// buildDelegationPrompt
// ---------------------------------------------------------------------------

describe('buildDelegationPrompt', () => {
  it('builds a prompt for scan mode', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts', '/project/src/b.ts'], ruleIds: [] }],
      totalFiles: 2,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).toContain('Code Review Delegation Prompt');
    expect(prompt).toContain('**scan**');
    expect(prompt).toContain('Total files: 2');
    expect(prompt).toContain('Total bundles: 1');
    expect(prompt).toContain('/project/src/a.ts');
  });

  it('builds a prompt for diff mode with ref', () => {
    const preview: DelegatePreview = {
      mode: 'diff',
      ref: { from: 'main', to: 'feature/x' },
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).toContain('**diff**');
    expect(prompt).toContain('main');
    expect(prompt).toContain('feature/x');
  });

  it('includes rules grouped by category', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [
      {
        ruleId: 'no-var',
        category: 'code-style',
        severity: 'low',
        pattern: '\\bvar\\b',
        description: 'Use const or let',
        appliesTo: ['*.ts'],
      },
      {
        ruleId: 'no-eval',
        category: 'security',
        severity: 'critical',
        pattern: '\\beval\\(',
        description: 'Do not use eval',
        appliesTo: ['*.ts'],
      },
    ];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).toContain('### code-style');
    expect(prompt).toContain('### security');
    expect(prompt).toContain('no-var');
    expect(prompt).toContain('no-eval');
    expect(prompt).toContain('[critical]');
    expect(prompt).toContain('[low]');
  });

  it('includes file bundles section', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [
        { files: ['/project/src/a.ts', '/project/src/b.ts'], ruleIds: [] },
        { files: ['/project/src/c.ts'], ruleIds: [] },
      ],
      totalFiles: 3,
      totalBundles: 2,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).toContain('### Bundle 1');
    expect(prompt).toContain('### Bundle 2');
    expect(prompt).toContain('(2 files)');
    expect(prompt).toContain('(1 files)');
  });

  it('includes review instructions', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).toContain('## Instructions');
    expect(prompt).toContain('Review each file bundle');
    expect(prompt).toContain('actionable suggestions');
  });

  it('handles empty rules gracefully', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).not.toContain('## Applicable Review Rules');
  });

  it('handles preview without ref', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    expect(prompt).not.toContain('Git range');
  });

  it('builds prompt with multiple rules in same category', () => {
    const preview: DelegatePreview = {
      mode: 'scan',
      bundles: [{ files: ['/project/src/a.ts'], ruleIds: [] }],
      totalFiles: 1,
      totalBundles: 1,
    };
    const rules: ResolvedRule[] = [
      {
        ruleId: 'rule-a',
        category: 'code-style',
        severity: 'low',
        pattern: 'a',
        description: 'Rule A',
        appliesTo: ['*.ts'],
      },
      {
        ruleId: 'rule-b',
        category: 'code-style',
        severity: 'medium',
        pattern: 'b',
        description: 'Rule B',
        appliesTo: ['*.ts'],
      },
    ];

    const prompt = manager().buildDelegationPrompt(preview, rules);

    // Both rules should appear under the same category heading
    expect(prompt).toContain('rule-a');
    expect(prompt).toContain('rule-b');
    // Category heading should appear only once
    const codeStyleCount = (prompt.match(/### code-style/g) ?? []).length;
    expect(codeStyleCount).toBe(1);
  });
});
