// @ts-nocheck
// @code-analyzer/mcp — Standards, ADR, and Agent Tools Tests
// Tests for listStandards, createStandard, manageADR, installSkills

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { createToolRegistry } from '../tools/index.js';

// ---------------------------------------------------------------------------
// listStandards Tests
// ---------------------------------------------------------------------------

describe('listStandards', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('should list all built-in standards without category filter', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('test-project');
    expect(data.standards).toBeDefined();
    expect(data.standards.length).toBe(5);
    expect(data.builtInCount).toBe(5);
    expect(data.customCount).toBe(0);
    expect(data.total).toBe(5);
  });

  it('should filter standards by security category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'security',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.category).toBe('security');
    expect(data.standards.length).toBe(1);
    expect(data.standards[0].name).toBe('Security Baseline');
    expect(data.standards[0].category).toBe('security');
  });

  it('should filter standards by architecture category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'architecture',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.category).toBe('architecture');
    expect(data.standards.length).toBe(1);
    expect(data.standards[0].name).toBe('Architecture Standards');
  });

  it('should filter standards by code-style category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'code-style',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.category).toBe('code-style');
    expect(data.standards.length).toBe(1);
    expect(data.standards[0].name).toBe('Code Style Guide');
  });

  it('should filter standards by performance category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'performance',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.category).toBe('performance');
    expect(data.standards.length).toBe(1);
    expect(data.standards[0].name).toBe('Performance Standards');
  });

  it('should filter standards by testing category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'testing',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.category).toBe('testing');
    expect(data.standards.length).toBe(1);
    expect(data.standards[0].name).toBe('Testing Standards');
  });

  it('should include custom standards after creation', async () => {
    // First create a custom standard
    await registry.execute('create_standard', {
      projectId: 'test-project',
      name: 'My Custom Rules',
      category: 'custom',
      description: 'Custom project rules',
      rules: [{ id: 'rule-1', severity: 'high', description: 'Do X' }],
    });

    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.customCount).toBe(1);
    expect(data.total).toBe(6);
  });

  it('should return all standard categories', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
    });

    const data = JSON.parse(result.content[0].text);
    const categories = data.standards.map((s: any) => s.category);
    expect(categories).toContain('security');
    expect(categories).toContain('architecture');
    expect(categories).toContain('code-style');
    expect(categories).toContain('performance');
    expect(categories).toContain('testing');
  });

  it('should return empty list for non-matching category', async () => {
    const result = await registry.execute('list_standards', {
      projectId: 'test-project',
      category: 'api-design',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.standards.length).toBe(0);
    expect(data.total).toBe(0);
    expect(data.builtInCount).toBe(0);
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('list_standards', {}, undefined as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// createStandard Tests
// ---------------------------------------------------------------------------

describe('createStandard', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('should create a security standard', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Enhanced Security',
      category: 'security',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.standardId).toMatch(/^std_/);
    expect(data.name).toBe('Enhanced Security');
    expect(data.category).toBe('security');
    expect(data.created).toBe(true);
    expect(data.ruleCount).toBe(0);
    expect(data.version).toBe('1.0.0');
  });

  it('should create a standard with rules', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Custom Ruleset',
      category: 'custom',
      rules: [
        { severity: 'high', description: 'Rule A' },
        { severity: 'medium', description: 'Rule B' },
        { severity: 'low', description: 'Rule C' },
      ],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.created).toBe(true);
    expect(data.ruleCount).toBe(3);
    expect(data.message).toContain('Custom Ruleset');
  });

  it('should create an architecture standard', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Microservices Architecture',
      category: 'architecture',
      description: 'Rules for microservices',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.created).toBe(true);
    expect(data.category).toBe('architecture');
    expect(data.description).toBe('Rules for microservices');
  });

  it('should create a code-style standard', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Team Style Guide',
      category: 'code-style',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.created).toBe(true);
    expect(data.category).toBe('code-style');
  });

  it('should create a standard with description', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'API Standards',
      category: 'api-design',
      description: 'API design guidelines for the team',
      rules: [{ id: 'versioning', severity: 'medium', description: 'Use versioned endpoints' }],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.description).toBe('API design guidelines for the team');
    expect(data.ruleCount).toBe(1);
  });

  it('should auto-generate rule IDs when not provided', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Auto ID Rules',
      category: 'custom',
      rules: [
        { severity: 'high', description: 'No ID provided' },
      ],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.created).toBe(true);
    // The rule should have been given an auto-generated ID
    // We verify by creating and then listing standards
    const listResult = await registry.execute('list_standards', {
      projectId: 'test-proj',
      category: 'custom',
    });
    const listData = JSON.parse(listResult.content[0].text);
    const created = listData.standards.find((s: any) => s.name === 'Auto ID Rules');
    expect(created).toBeDefined();
    expect(created.rules[0].id).toBeDefined();
  });

  it('should return success message with standard name', async () => {
    const result = await registry.execute('create_standard', {
      projectId: 'test-proj',
      name: 'Testing Rules',
      category: 'testing',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.message).toBe("Standard 'Testing Rules' created successfully");
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('create_standard', {}, undefined as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// manageADR Tests
// ---------------------------------------------------------------------------

describe('manageADR', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('should create an ADR', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'create',
      title: 'Use TypeScript for frontend',
      content: '# Decision\n\nWe will use TypeScript for all frontend code.',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.action).toBe('create');
    expect(data.created).toBe(true);
    expect(data.title).toBe('Use TypeScript for frontend');
    expect(data.status).toBe('proposed');
    expect(data.adrId).toMatch(/^adr_/);
    expect(data.message).toBe('ADR created successfully');
  });

  it('should list ADRs for a project', async () => {
    // Create two ADRs with explicit IDs to avoid Date.now() collision
    await registry.execute('manage_adr', {
      projectId: 'adr-list-test',
      action: 'create',
      adrId: 'adr-list-1',
      title: 'ADR 1',
    });
    await registry.execute('manage_adr', {
      projectId: 'adr-list-test',
      action: 'create',
      adrId: 'adr-list-2',
      title: 'ADR 2',
    });

    const result = await registry.execute('manage_adr', {
      projectId: 'adr-list-test',
      action: 'list',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.action).toBe('list');
    expect(data.adrs).toBeDefined();
    expect(data.adrs.length).toBe(2);
    expect(data.total).toBe(2);
  });

  it('should get an ADR by ID', async () => {
    // Create an ADR first
    const createResult = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'create',
      title: 'Get Test ADR',
      content: '# Some content',
    });
    const createData = JSON.parse(createResult.content[0].text);
    const adrId = createData.adrId;

    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'get',
      adrId,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(true);
    expect(data.title).toBe('Get Test ADR');
    expect(data.content).toBe('# Some content');
    expect(data.status).toBe('proposed');
    expect(data.adrId).toBe(adrId);
  });

  it('should return not found for non-existent ADR', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'get',
      adrId: 'adr_nonexistent',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(false);
    expect(data.title).toBe('N/A');
    expect(data.content).toBe('');
  });

  it('should return error when get action missing adrId', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'get',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.found).toBe(false);
    expect(data.error).toBe('adrId is required for get action');
  });

  it('should update an ADR', async () => {
    const createResult = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'create',
      title: 'Original Title',
      content: 'Original content',
    });
    const createData = JSON.parse(createResult.content[0].text);
    const adrId = createData.adrId;

    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'update',
      adrId,
      title: 'Updated Title',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(true);
    expect(data.title).toBe('Updated Title');
    expect(data.message).toBe('ADR updated successfully');
  });

  it('should return false when updating non-existent ADR', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'update',
      adrId: 'adr_ghost',
      title: 'Ghost',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(false);
    expect(data.message).toBe('ADR not found');
  });

  it('should return error when update missing adrId', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'update',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(false);
    expect(data.error).toBe('adrId is required for update action');
  });

  it('should search ADRs by title', async () => {
    await registry.execute('manage_adr', {
      projectId: 'adr-search-by-title',
      action: 'create',
      adrId: 'adr-search-target',
      title: 'Search Target',
      content: 'Content with searchable text',
    });
    await registry.execute('manage_adr', {
      projectId: 'adr-search-by-title',
      action: 'create',
      adrId: 'adr-other',
      title: 'Other ADR',
      content: 'Different stuff',
    });

    const result = await registry.execute('manage_adr', {
      projectId: 'adr-search-by-title',
      action: 'search',
      query: 'Search',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.action).toBe('search');
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results[0].title).toBe('Search Target');
    expect(data.results[0].excerpt).toBeDefined();
    expect(data.results[0].relevance).toBe(1);
  });

  it('should search ADRs by content', async () => {
    await registry.execute('manage_adr', {
      projectId: 'adr-content-search',
      action: 'create',
      title: 'Content ADR',
      content: 'This contains the unique keyword ZZZ_FINDME_ZZZ',
    });

    const result = await registry.execute('manage_adr', {
      projectId: 'adr-content-search',
      action: 'search',
      query: 'ZZZ_FINDME_ZZZ',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.results.length).toBe(1);
    expect(data.results[0].title).toBe('Content ADR');
  });

  it('should return empty search results for no match', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'adr-empty-search',
      action: 'search',
      query: 'nonexistent_term',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.results).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should create ADR with generated ID when not provided', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'create',
      title: 'Auto ID ADR',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.adrId).toMatch(/^adr_\d+$/);
  });

  it('should create ADR with custom ID', async () => {
    const result = await registry.execute('manage_adr', {
      projectId: 'test-adr',
      action: 'create',
      adrId: 'custom-adr-001',
      title: 'Custom ID ADR',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.adrId).toBe('custom-adr-001');
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('manage_adr', {}, undefined as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });
});

// ---------------------------------------------------------------------------
// installSkills Tests
// ---------------------------------------------------------------------------

describe('installSkills', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('should install skills with dry run', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code'],
      projectId: 'test-proj',
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.dryRun).toBe(true);
    expect(data.agents).toEqual(['claude-code']);
    expect(data.message).toContain('Dry run');
    expect(data.installed).toBeDefined();
    expect(data.failed).toBeDefined();
  });

  it('should install skills for multiple agents with dry run', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code', 'cursor', 'codebuddy'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents.length).toBe(3);
    expect(data.dryRun).toBe(true);
  });

  it('should install skills with projectId', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['codebuddy'],
      projectId: 'my-special-project',
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toBe('my-special-project');
  });

  it('should install specific skills', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code'],
      skills: ['code-analyzer-exploration', 'code-analyzer-debugging'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.skills).toEqual(['code-analyzer-exploration', 'code-analyzer-debugging']);
    expect(data.dryRun).toBe(true);
  });

  it('should install all skills when skills not specified', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.skills.length).toBeGreaterThan(5);
  });

  it('should filter unknown skill names', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code'],
      skills: ['code-analyzer-exploration', 'nonexistent_skill'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.skills).toEqual(['code-analyzer-exploration']);
  });

  it('should handle agents array with single agent', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['windsurf'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toEqual(['windsurf']);
    expect(data.message).toContain('Dry run');
  });

  it('should handle aider agent', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['aider'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toContain('aider');
  });

  it('should handle continue agent', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['continue'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toContain('continue');
  });

  it('should handle codex agent', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['codex'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toContain('codex');
  });

  it('should handle custom agent', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['custom'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toContain('custom');
  });

  it('should handle missing required params', async () => {
    const result = await registry.execute('install_skills', {}, undefined as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
  });

  it('should return both installed and failed arrays', async () => {
    const result = await registry.execute('install_skills', {
      agents: ['claude-code'],
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.installed).toBeDefined();
    expect(Array.isArray(data.installed)).toBe(true);
    expect(data.failed).toBeDefined();
    expect(Array.isArray(data.failed)).toBe(true);
  });
});
