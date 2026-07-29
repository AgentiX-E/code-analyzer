// @code-analyzer/core — Plugin Interface Tests
import { describe, it, expect } from 'vitest';

import type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginLens,
  PluginLensFinding,
  PluginStandard,
  PluginStandardViolation,
  PluginMCPTool,
  PluginRuleResult,
} from '../plugins/plugin-interface.js';

// ---------------------------------------------------------------------------
// Helpers for constructing type-checked fixtures
// ---------------------------------------------------------------------------

function makeRule(overrides?: Partial<PluginRule>): PluginRule {
  return {
    id: 'test-rule-1',
    name: 'Test Rule',
    category: 'security',
    severity: 'high',
    check: () => null,
    ...overrides,
  };
}

function makeLens(overrides?: Partial<PluginLens>): PluginLens {
  return {
    id: 'test-lens-1',
    name: 'Test Lens',
    description: 'A test review lens',
    scan: () => [],
    ...overrides,
  };
}

function makeStandard(overrides?: Partial<PluginStandard>): PluginStandard {
  return {
    id: 'test-standard-1',
    name: 'Test Standard',
    description: 'A test standard check',
    severity: 'medium',
    check: () => [],
    ...overrides,
  };
}

function makeMCPTool(overrides?: Partial<PluginMCPTool>): PluginMCPTool {
  return {
    name: 'test-tool',
    description: 'A test MCP tool',
    schema: { type: 'object', properties: {} },
    handler: async () => ({ result: 'ok' }),
    ...overrides,
  };
}

function makePlugin(overrides?: Partial<CodeAnalyzerPlugin>): CodeAnalyzerPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PluginRule type conformance
// ---------------------------------------------------------------------------

describe('PluginRule', () => {
  it('should allow creating a minimal rule', () => {
    const rule = makeRule();
    expect(rule.id).toBe('test-rule-1');
    expect(rule.name).toBe('Test Rule');
    expect(rule.category).toBe('security');
    expect(rule.severity).toBe('high');
    expect(typeof rule.check).toBe('function');
  });

  it('should allow null return from check', () => {
    const rule = makeRule({
      check: () => null,
    });
    expect(rule.check({}, {})).toBeNull();
  });

  it('should allow a PluginRuleResult return from check', () => {
    const result: PluginRuleResult = {
      filePath: '/test/file.ts',
      line: 42,
      message: 'Something is wrong',
      suggestion: 'Fix it',
    };
    const rule = makeRule({
      check: () => result,
    });
    const out = rule.check({}, {});
    expect(out).toEqual(result);
    expect(out?.filePath).toBe('/test/file.ts');
    expect(out?.line).toBe(42);
    expect(out?.message).toBe('Something is wrong');
    expect(out?.suggestion).toBe('Fix it');
  });

  it('should support all severity levels', () => {
    const severities: Array<PluginRule['severity']> = ['critical', 'high', 'medium', 'low', 'info'];
    for (const severity of severities) {
      const rule = makeRule({ severity });
      expect(rule.severity).toBe(severity);
    }
  });
});

// ---------------------------------------------------------------------------
// PluginLensFinding type conformance
// ---------------------------------------------------------------------------

describe('PluginLensFinding', () => {
  it('should allow a full finding object', () => {
    const finding: PluginLensFinding = {
      id: 'finding-1',
      filePath: '/test/file.ts',
      startLine: 10,
      endLine: 20,
      title: 'Issue found',
      description: 'Detailed description',
      severity: 'high',
      suggestion: 'Suggested fix',
      codeSnippet: 'const x = 1;',
    };
    expect(finding.id).toBe('finding-1');
    expect(finding.filePath).toBe('/test/file.ts');
    expect(finding.startLine).toBe(10);
    expect(finding.endLine).toBe(20);
    expect(finding.severity).toBe('high');
    expect(finding.suggestion).toBe('Suggested fix');
    expect(finding.codeSnippet).toBe('const x = 1;');
  });

  it('should allow omitting optional fields', () => {
    const finding: PluginLensFinding = {
      id: 'finding-2',
      filePath: '/test/file2.ts',
      startLine: 1,
      endLine: 2,
      title: 'Simple',
      description: 'Simple finding',
      severity: 'info',
    };
    expect(finding.suggestion).toBeUndefined();
    expect(finding.codeSnippet).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PluginLens type conformance
// ---------------------------------------------------------------------------

describe('PluginLens', () => {
  it('should produce findings from scan', () => {
    const findings: PluginLensFinding[] = [
      {
        id: 'lens-1',
        filePath: '/test/a.ts',
        startLine: 1,
        endLine: 5,
        title: 'Lens Issue',
        description: 'Found by lens',
        severity: 'medium',
      },
    ];
    const lens = makeLens({
      scan: () => findings,
    });
    const result = lens.scan({}, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lens-1');
  });

  it('should work with empty scan results', () => {
    const lens = makeLens({
      scan: () => [],
    });
    expect(lens.scan({}, {})).toEqual([]);
  });

  it('should have correct properties', () => {
    const lens = makeLens();
    expect(lens.id).toBe('test-lens-1');
    expect(lens.name).toBe('Test Lens');
    expect(lens.description).toBe('A test review lens');
    expect(typeof lens.scan).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// PluginStandard & PluginStandardViolation
// ---------------------------------------------------------------------------

describe('PluginStandard', () => {
  it('should produce violations from check', () => {
    const violations: PluginStandardViolation[] = [
      {
        filePath: '/test/file.ts',
        line: 10,
        message: 'Violation found',
        ruleId: 'std-1',
        suggestion: 'Fix suggestion',
      },
    ];
    const standard = makeStandard({
      check: () => violations,
    });
    const result = standard.check({}, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.filePath).toBe('/test/file.ts');
    expect(result[0]!.line).toBe(10);
    expect(result[0]!.ruleId).toBe('std-1');
  });

  it('should support optional languages field', () => {
    const standard = makeStandard({
      languages: ['typescript', 'javascript'],
    });
    expect(standard.languages).toEqual(['typescript', 'javascript']);
  });

  it('should support undefined languages', () => {
    const standard = makeStandard();
    expect(standard.languages).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PluginMCPTool
// ---------------------------------------------------------------------------

describe('PluginMCPTool', () => {
  it('should execute handler and return result', async () => {
    const tool = makeMCPTool({
      handler: async (args) => ({ result: args }),
    });
    const result = await tool.handler({ key: 'value' });
    expect(result).toEqual({ result: { key: 'value' } });
  });

  it('should have required properties', () => {
    const tool = makeMCPTool();
    expect(tool.name).toBe('test-tool');
    expect(tool.description).toBe('A test MCP tool');
    expect(tool.schema).toEqual({ type: 'object', properties: {} });
    expect(typeof tool.handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// CodeAnalyzerPlugin
// ---------------------------------------------------------------------------

describe('CodeAnalyzerPlugin', () => {
  it('should create a minimal plugin', () => {
    const plugin = makePlugin();
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.description).toBe('A test plugin');
    expect(plugin.rules).toBeUndefined();
    expect(plugin.lenses).toBeUndefined();
    expect(plugin.standards).toBeUndefined();
    expect(plugin.mcpTools).toBeUndefined();
    expect(plugin.onLoad).toBeUndefined();
    expect(plugin.onUnload).toBeUndefined();
  });

  it('should support onLoad and onUnload hooks', () => {
    let loaded = false;
    let unloaded = false;
    const plugin = makePlugin({
      onLoad: () => { loaded = true; },
      onUnload: () => { unloaded = true; },
    });
    plugin.onLoad?.();
    expect(loaded).toBe(true);
    plugin.onUnload?.();
    expect(unloaded).toBe(true);
  });

  it('should support async onLoad and onUnload hooks', async () => {
    let loaded = false;
    let unloaded = false;
    const plugin = makePlugin({
      onLoad: async () => { loaded = true; },
      onUnload: async () => { unloaded = true; },
    });
    await plugin.onLoad?.();
    expect(loaded).toBe(true);
    await plugin.onUnload?.();
    expect(unloaded).toBe(true);
  });

  it('should include rules when provided', () => {
    const rule = makeRule();
    const plugin = makePlugin({ rules: [rule] });
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.rules![0]!.id).toBe('test-rule-1');
  });

  it('should include lenses when provided', () => {
    const lens = makeLens();
    const plugin = makePlugin({ lenses: [lens] });
    expect(plugin.lenses).toHaveLength(1);
    expect(plugin.lenses![0]!.id).toBe('test-lens-1');
  });

  it('should include standards when provided', () => {
    const standard = makeStandard();
    const plugin = makePlugin({ standards: [standard] });
    expect(plugin.standards).toHaveLength(1);
    expect(plugin.standards![0]!.id).toBe('test-standard-1');
  });

  it('should include MCP tools when provided', () => {
    const tool = makeMCPTool();
    const plugin = makePlugin({ mcpTools: [tool] });
    expect(plugin.mcpTools).toHaveLength(1);
    expect(plugin.mcpTools![0]!.name).toBe('test-tool');
  });

  it('should support a fully-featured plugin with all capabilities', () => {
    const rule = makeRule();
    const lens = makeLens();
    const standard = makeStandard();
    const tool = makeMCPTool();
    const plugin = makePlugin({
      rules: [rule],
      lenses: [lens],
      standards: [standard],
      mcpTools: [tool],
    });
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.lenses).toHaveLength(1);
    expect(plugin.standards).toHaveLength(1);
    expect(plugin.mcpTools).toHaveLength(1);
  });
});
