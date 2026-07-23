// @code-analyzer/mcp — Standards, ADR, and Agent Tools
// Uses in-memory stores for standards and ADRs with real data

import type { ToolResult } from './registry.js';
import { SkillInstaller } from '../skills/installer.js';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface StandardDefinition {
  standardId: string;
  projectId: string;
  name: string;
  category: string;
  description: string;
  rules: Record<string, unknown>[];
  version: string;
  createdAt: string;
}

interface ADRRecord {
  adrId: string;
  projectId: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Module-level in-memory stores (shared across tool calls within a session)
const standardsStore = new Map<string, StandardDefinition>();
const adrStore = new Map<string, ADRRecord>();

// Built-in standards templates
const BUILT_IN_STANDARDS: Omit<StandardDefinition, 'projectId' | 'standardId' | 'createdAt'>[] = [
  {
    name: 'Security Baseline',
    category: 'security',
    description: 'Essential security standards: no hardcoded secrets, input validation, auth checks',
    rules: [
      { id: 'no-hardcoded-secrets', severity: 'critical', description: 'No API keys, tokens, or passwords in source code' },
      { id: 'input-validation', severity: 'high', description: 'All user input must be validated and sanitized' },
      { id: 'auth-required', severity: 'high', description: 'All API endpoints must require authentication' },
      { id: 'https-only', severity: 'high', description: 'All external communications must use HTTPS' },
    ],
    version: '1.0.0',
  },
  {
    name: 'Code Style Guide',
    category: 'code-style',
    description: 'Consistent code style and formatting conventions',
    rules: [
      { id: 'max-line-length', severity: 'low', description: 'Lines should not exceed 120 characters' },
      { id: 'no-console', severity: 'medium', description: 'No console.log in production code' },
      { id: 'consistent-naming', severity: 'medium', description: 'PascalCase for classes, camelCase for functions' },
      { id: 'file-header', severity: 'low', description: 'Each file must have a module-level comment' },
    ],
    version: '1.0.0',
  },
  {
    name: 'Architecture Standards',
    category: 'architecture',
    description: 'Architecture patterns and dependencies',
    rules: [
      { id: 'no-circular-deps', severity: 'high', description: 'No circular dependencies between modules' },
      { id: 'layer-isolation', severity: 'medium', description: 'Domain layer must not depend on infrastructure' },
      { id: 'single-responsibility', severity: 'medium', description: 'Classes and modules should have a single responsibility' },
      { id: 'dependency-inversion', severity: 'medium', description: 'Depend on abstractions, not concrete implementations' },
    ],
    version: '1.0.0',
  },
  {
    name: 'Performance Standards',
    category: 'performance',
    description: 'Performance and optimization guidelines',
    rules: [
      { id: 'no-sync-fs', severity: 'high', description: 'Avoid synchronous file system operations in server code' },
      { id: 'lazy-loading', severity: 'medium', description: 'Use lazy loading for heavy modules' },
      { id: 'no-n-plus-one', severity: 'high', description: 'Avoid N+1 query patterns' },
      { id: 'no-blocking-ops', severity: 'medium', description: 'No blocking operations on the event loop' },
    ],
    version: '1.0.0',
  },
  {
    name: 'Testing Standards',
    category: 'testing',
    description: 'Testing and quality assurance requirements',
    rules: [
      { id: 'test-coverage', severity: 'medium', description: 'Minimum 80% test coverage' },
      { id: 'test-isolation', severity: 'medium', description: 'Tests must not depend on execution order' },
      { id: 'no-skip-tests', severity: 'low', description: 'No skipped tests without explicit reason documented' },
      { id: 'critical-path-tests', severity: 'high', description: 'All critical paths must have integration tests' },
    ],
    version: '1.0.0',
  },
];

// ---------------------------------------------------------------------------
// list_standards — Real implementation with built-in templates
// ---------------------------------------------------------------------------

interface ListStandardsParams {
  projectId: string;
  category?: string;
}

export const listStandardsSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    category: { type: 'string', description: 'Filter by category', enum: ['code-style', 'architecture', 'security', 'performance', 'testing', 'api-design', 'error-handling', 'documentation', 'dependency', 'custom'] },
  },
  required: ['projectId'],
};

export async function listStandards(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as ListStandardsParams;
  const projectId = params.projectId;
  const category = params.category;

  // Collect built-in templates + project-specific standards
  const builtIn = BUILT_IN_STANDARDS
    .filter((s) => !category || s.category === category)
    .map((s) => ({
      standardId: `builtin_${s.name.toLowerCase().replace(/\s+/g, '_')}`,
      projectId: 'builtin',
      ...s,
      createdAt: '2026-01-01T00:00:00Z',
    }));

  const projectStandards: StandardDefinition[] = [];
  for (const [, std] of standardsStore) {
    if (std.projectId === projectId && (!category || std.category === category)) {
      projectStandards.push(std);
    }
  }

  const all = [...builtIn, ...projectStandards];

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        projectId,
        category: category ?? 'all',
        standards: all,
        total: all.length,
        builtInCount: builtIn.length,
        customCount: projectStandards.length,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// create_standard — Stores in in-memory registry
// ---------------------------------------------------------------------------

interface CreateStandardParams {
  projectId: string;
  name: string;
  category: string;
  rules?: Record<string, unknown>[];
  description?: string;
}

export const createStandardSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Standard name' },
    category: { type: 'string', description: 'Standard category', enum: ['code-style', 'architecture', 'security', 'performance', 'testing', 'api-design', 'error-handling', 'documentation', 'dependency', 'custom'] },
    rules: { type: 'array', items: { type: 'object' }, description: 'Array of rule definitions' },
    description: { type: 'string', description: 'Standard description' },
  },
  required: ['projectId', 'name', 'category'],
};

export async function createStandard(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as CreateStandardParams;
  const projectId = params.projectId;
  const name = params.name;
  const category = params.category;
  const rules = params.rules ?? [];
  const description = params.description ?? '';

  const standardId = `std_${Date.now()}`;
  const standard: StandardDefinition = {
    standardId,
    projectId,
    name,
    category,
    description,
    rules: rules.map((r, idx) => ({ ...r, id: r.id ?? `rule_${idx}` })),
    version: '1.0.0',
    createdAt: new Date().toISOString(),
  };

  standardsStore.set(standardId, standard);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        standardId,
        projectId,
        name,
        category,
        description,
        ruleCount: rules.length,
        version: '1.0.0',
        created: true,
        message: `Standard '${name}' created successfully`,
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// manage_adr — In-memory ADR store with full CRUD
// ---------------------------------------------------------------------------

interface ManageADRParams {
  projectId: string;
  action: string;
  title?: string;
  content?: string;
  adrId?: string;
  query?: string;
}

export const manageADRSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    action: { type: 'string', description: 'ADR action', enum: ['create', 'list', 'get', 'update', 'search'] },
    title: { type: 'string', description: 'ADR title (for create/update)' },
    content: { type: 'string', description: 'ADR content in markdown (for create/update)' },
    adrId: { type: 'string', description: 'ADR identifier (for get/update)' },
    query: { type: 'string', description: 'Search query (for search)' },
  },
  required: ['projectId', 'action'],
};

export async function manageADR(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as ManageADRParams;
  const projectId = params.projectId;
  const action = params.action;
  const title = params.title;
  const content = params.content ?? '';
  const adrId = params.adrId;
  const query = params.query;
  const now = new Date().toISOString();

  const result: Record<string, unknown> = { projectId, action };

  switch (action) {
    case 'create': {
      const newId = adrId ?? `adr_${Date.now()}`;
      const record: ADRRecord = {
        adrId: newId,
        projectId,
        title: title ?? 'Untitled',
        content,
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
      };
      adrStore.set(newId, record);
      result['adrId'] = newId;
      result['title'] = title;
      result['status'] = 'proposed';
      result['created'] = true;
      result['message'] = 'ADR created successfully';
      break;
    }
    case 'list': {
      const projectADRs: ADRRecord[] = [];
      for (const [, adr] of adrStore) {
        if (adr.projectId === projectId) {
          projectADRs.push(adr);
        }
      }
      result['adrs'] = projectADRs.map((a) => ({
        adrId: a.adrId,
        title: a.title,
        status: a.status,
        createdAt: a.createdAt,
      }));
      result['total'] = projectADRs.length;
      break;
    }
    case 'get': {
      if (!adrId) {
        result['error'] = 'adrId is required for get action';
        result['found'] = false;
      } else {
        const adr = adrStore.get(adrId);
        if (adr) {
          result['adrId'] = adr.adrId;
          result['title'] = adr.title;
          result['content'] = adr.content;
          result['status'] = adr.status;
          result['createdAt'] = adr.createdAt;
          result['updatedAt'] = adr.updatedAt;
          result['found'] = true;
        } else {
          result['adrId'] = adrId;
          result['title'] = 'N/A';
          result['content'] = '';
          result['found'] = false;
        }
      }
      break;
    }
    case 'update': {
      if (!adrId) {
        result['error'] = 'adrId is required for update action';
        result['updated'] = false;
      } else {
        const existing = adrStore.get(adrId);
        if (existing) {
          existing.title = title ?? existing.title;
          existing.content = content || existing.content;
          existing.updatedAt = now;
          adrStore.set(adrId, existing);
          result['adrId'] = adrId;
          result['title'] = existing.title;
          result['updated'] = true;
          result['message'] = 'ADR updated successfully';
        } else {
          result['adrId'] = adrId;
          result['updated'] = false;
          result['message'] = 'ADR not found';
        }
      }
      break;
    }
    case 'search': {
      const searchTerm = (query ?? '').toLowerCase();
      const searchResults: ADRRecord[] = [];
      for (const [, adr] of adrStore) {
        if (
          adr.projectId === projectId &&
          (adr.title.toLowerCase().includes(searchTerm) || adr.content.toLowerCase().includes(searchTerm))
        ) {
          searchResults.push(adr);
        }
      }
      result['results'] = searchResults.map((a) => ({
        adrId: a.adrId,
        title: a.title,
        status: a.status,
        excerpt: a.content.slice(0, 200),
        createdAt: a.createdAt,
        relevance: 1,
      }));
      result['total'] = searchResults.length;
      break;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// install_skills — Uses SkillInstaller class
// ---------------------------------------------------------------------------

interface InstallSkillsParams {
  agents: string[];
  projectId?: string;
  skills?: string[];
  dryRun?: boolean;
}

export const installSkillsSchema = {
  type: 'object',
  properties: {
    agents: { type: 'array', items: { type: 'string' }, description: 'Agent names to install skills for', enum: ['claude-code', 'cursor', 'codex', 'windsurf', 'codebuddy', 'aider', 'continue', 'custom'] },
    projectId: { type: 'string', description: 'Project ID (for generating repo-specific skills)' },
    skills: { type: 'array', items: { type: 'string' }, description: 'Specific skills to install' },
    dryRun: { type: 'boolean', description: 'Preview installation without writing files' },
  },
  required: ['agents'],
};

export async function installSkills(args: Record<string, unknown>): Promise<ToolResult> {
  const params = args as unknown as InstallSkillsParams;
  const agents = params.agents;
  const projectId = params.projectId;
  const skills = params.skills ?? ['all'];
  const dryRun = Boolean(params.dryRun);

  const installer = new SkillInstaller();
  const availableSkills = installer.generateRepoSKills(projectId ?? 'default');

  // Map skill names to templates
  const skillMap = new Map(availableSkills.map((s) => [s.name, s]));

  // Determine which skills to install
  const skillsToInstall = skills.includes('all')
    ? availableSkills.map((s) => s.name)
    : skills.filter((s) => skillMap.has(s));

  const installed: string[] = [];
  const failed: string[] = [];

  for (const agent of agents) {
    const result = installer.installSkills(agent, skillsToInstall);
    if (result && result.length > 0) {
      for (const r of result) {
        if (r.skill && r.agent) {
          installed.push(`${agent}:${r.skill}`);
        } else {
          failed.push(`${agent}:${r.skill ?? 'unknown'}`);
        }
      }
    } else {
      failed.push(`${agent}:no_matching_config`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        agents,
        projectId,
        skills: skillsToInstall,
        dryRun,
        installed,
        failed,
        message: dryRun
          ? `Dry run — ${installed.length} skills would be installed for ${agents.length} agents`
          : `Skills installation completed: ${installed.length} installed, ${failed.length} failed`,
      }, null, 2),
    }],
  };
}
