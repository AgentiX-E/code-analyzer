// @code-analyzer/mcp — Agent Skills Installer
// Detects AI coding agents and installs project-specific skills.

import type { DetectedAgent, AgentSkill } from '@code-analyzer/shared';

export interface InstallResult {
  agent: string;
  skill: string;
  success: boolean;
  path: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Skill Templates
// ---------------------------------------------------------------------------

const SKILL_TEMPLATES: Record<string, string> = {
  exploration: 'code-analyzer-exploration.md',
  debugging: 'code-analyzer-debugging.md',
  impact: 'code-analyzer-impact.md',
  refactoring: 'code-analyzer-refactoring.md',
  review: 'code-analyzer-review.md',
  'pr-review': 'code-analyzer-pr-review.md',
  architecture: 'code-analyzer-architecture.md',
  'cross-repo': 'code-analyzer-cross-repo.md',
  security: 'code-analyzer-security.md',
  'tool-reference': 'code-analyzer-tool-reference.md',
};

// ---------------------------------------------------------------------------
// Skill Content Templates
// ---------------------------------------------------------------------------

function getSkillContent(skillName: string, projectId: string): string {
  const templates: Record<string, string> = {
    exploration: `# Code Analyzer - Exploration Skill

Use the Code Analyzer MCP tools to explore and understand the codebase.

## Primary Tools
- \`get_architecture\` - Get architectural overview
- \`explore_symbol\` - Explore a symbol's relationships
- \`search_graph\` - Search the knowledge graph
- \`get_graph_schema\` - View graph schema

## Workflow
1. Start with \`get_architecture\` to understand the overall structure
2. Use \`search_graph\` to find relevant code
3. Use \`explore_symbol\` to understand specific components
4. Use \`trace_call_path\` to follow execution paths

Project ID: ${projectId}
`,
    debugging: `# Code Analyzer - Debugging Skill

Use the Code Analyzer MCP tools for debugging and issue investigation.

## Primary Tools
- \`trace_call_path\` - Trace execution paths
- \`explore_symbol\` - Examine symbol details
- \`query_graph\` - Run Cypher queries
- \`search_code\` - Search source code

## Workflow
1. Identify the entry point and use \`trace_call_path\`
2. Use \`query_graph\` to find data flow paths
3. Check for circular dependencies with \`check_cycles\`
4. Review related areas with \`search_graph\`

Project ID: ${projectId}
`,
    impact: `# Code Analyzer - Impact Analysis Skill

Use the Code Analyzer MCP tools for change impact analysis.

## Primary Tools
- \`impact_analysis\` - Analyze impact of changes
- \`detect_changes\` - Detect code changes
- \`check_cycles\` - Check circular dependencies
- \`cross_repo_impact\` - Cross-repo impact analysis

## Workflow
1. Run \`detect_changes\` to identify modified files
2. Use \`impact_analysis\` on changed symbols
3. Check \`route_map\` for affected endpoints
4. Use \`get_recommendations\` for remediation

Project ID: ${projectId}
`,
    refactoring: `# Code Analyzer - Refactoring Skill

Use the Code Analyzer MCP tools for safe code refactoring.

## Primary Tools
- \`impact_analysis\` - Assess refactoring impact
- \`find_implementations\` - Find all implementations
- \`check_cycles\` - Prevent circular dependencies
- \`review_file\` - Review refactored code

## Workflow
1. Analyze target with \`impact_analysis\`
2. Find all consumers with \`find_implementations\`
3. Check for cycles with \`check_cycles\`
4. Review changes with \`review_file\`
5. Validate standards with \`check_standards\`

Project ID: ${projectId}
`,
    review: `# Code Analyzer - Code Review Skill

Use the Code Analyzer MCP tools for thorough code review.

## Primary Tools
- \`review_diff\` - Review git diffs
- \`review_file\` - Review individual files
- \`check_standards\` - Check compliance
- \`explore_symbol\` - Examine changed symbols

## Workflow
1. Use \`review_diff\` or \`review_file\` for initial review
2. Check standards with \`check_standards\`
3. Analyze impact of changes
4. Generate report with \`generate_report\`

Project ID: ${projectId}
`,
    'pr-review': `# Code Analyzer - PR Review Skill

Use the Code Analyzer MCP tools for pull request reviews.

## Primary Tools
- \`review_pr\` - Full PR review
- \`review_diff\` - Review specific diffs
- \`check_standards\` - Standards compliance
- \`generate_report\` - Generate PR review report

## Workflow
1. Start with \`review_pr\` for comprehensive review
2. Use \`impact_analysis\` for risky changes
3. Check \`check_standards\` for compliance
4. Generate final \`generate_report\`

Project ID: ${projectId}
`,
    architecture: `# Code Analyzer - Architecture Review Skill

Use the Code Analyzer MCP tools for architecture analysis.

## Primary Tools
- \`get_architecture\` - Architecture overview
- \`route_map\` - API route analysis
- \`check_cycles\` - Detect circular dependencies
- \`manage_adr\` - Manage Architecture Decision Records

## Workflow
1. Start with \`get_architecture\` for overview
2. Check \`route_map\` for API structure
3. Verify no cycles with \`check_cycles\`
4. Document decisions with \`manage_adr\`

Project ID: ${projectId}
`,
    'cross-repo': `# Code Analyzer - Cross-Repo Analysis Skill

Use the Code Analyzer MCP tools for cross-repository analysis.

## Primary Tools
- \`cross_repo_search\` - Search across repos
- \`cross_repo_trace\` - Trace across repos
- \`cross_repo_impact\` - Cross-repo impact
- \`manage_repo_group\` - Manage repo groups

## Workflow
1. Set up repo groups with \`manage_repo_group\`
2. Use \`discover_related_repos\` to find dependencies
3. Trace with \`cross_repo_trace\`
4. Analyze impact with \`cross_repo_impact\`

Project ID: ${projectId}
`,
    security: `# Code Analyzer - Security Analysis Skill

Use the Code Analyzer MCP tools for security analysis.

## Primary Tools
- \`taint_analysis\` - Taint analysis
- \`pdg_query\` - Program dependence graph
- \`review_file\` - Security-focused review
- \`check_standards\` - Security standards

## Workflow
1. Run \`taint_analysis\` for data flow vulnerabilities
2. Query \`pdg_query\` for control flow analysis
3. Review critical files with \`review_file\`
4. Check against security standards

Project ID: ${projectId}
`,
    'tool-reference': `# Code Analyzer - Tool Reference

Complete reference of all Code Analyzer MCP tools.

## Indexing & Lifecycle
- \`analyze_repository\` - Index a repository
- \`list_projects\` - List indexed projects
- \`delete_project\` - Delete a project
- \`index_status\` - Check indexing status

## Querying & Exploration
- \`search_graph\` - Search knowledge graph
- \`search_code\` - Search source code
- \`semantic_search\` - Semantic search
- \`trace_call_path\` - Trace execution paths
- \`query_graph\` - Cypher queries
- \`get_code_snippet\` - Get code snippets
- \`get_architecture\` - Architecture overview
- \`get_graph_schema\` - Graph schema
- \`explore_symbol\` - Explore symbols
- \`find_implementations\` - Find implementations

## Change & Impact
- \`detect_changes\` - Detect changes
- \`impact_analysis\` - Impact analysis
- \`route_map\` - Route mapping
- \`check_cycles\` - Cycle detection

## Review
- \`review_diff\` - Review diffs
- \`review_file\` - Review files
- \`review_pr\` - PR review
- \`check_standards\` - Standards check

## Reports
- \`generate_report\` - Generate reports
- \`export_report\` - Export reports
- \`get_recommendations\` - Get recommendations

## Cross-Repo
- \`cross_repo_search\` - Cross-repo search
- \`cross_repo_trace\` - Cross-repo trace
- \`cross_repo_impact\` - Cross-repo impact
- \`manage_repo_group\` - Manage groups
- \`sync_contracts\` - Sync contracts
- \`discover_related_repos\` - Discover repos

## PDG
- \`pdg_query\` - PDG queries
- \`taint_analysis\` - Taint analysis
- \`explain_taint\` - Explain taint paths

## Additional
- \`list_standards\` - List standards
- \`create_standard\` - Create standards
- \`manage_adr\` - Manage ADRs

Project ID: ${projectId}
`,
  };

  return templates[skillName] ?? `# Code Analyzer - ${skillName}\n\nSkill template for ${skillName}.\nProject ID: ${projectId}`;
}

// ---------------------------------------------------------------------------
// Agent Detection & Configuration
// ---------------------------------------------------------------------------

interface AgentConfig {
  format: 'markdown' | 'yaml';
  installPath: string;
  alias: string;
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  'claude-code': { format: 'markdown', installPath: '.claude/skills/', alias: 'claude' },
  'cursor': { format: 'markdown', installPath: '.cursor/skills/', alias: 'cursor' },
  'codex': { format: 'markdown', installPath: '.openai/skills/', alias: 'codex' },
  'windsurf': { format: 'markdown', installPath: '.windsurf/skills/', alias: 'windsurf' },
  'codebuddy': { format: 'markdown', installPath: '.codebuddy/skills/', alias: 'codebuddy' },
  'aider': { format: 'markdown', installPath: '.aider/skills/', alias: 'aider' },
  'continue': { format: 'yaml', installPath: '.continue/rules/', alias: 'continue' },
  'custom': { format: 'markdown', installPath: '.ai/skills/', alias: 'custom' },
};

// ---------------------------------------------------------------------------
// SkillInstaller
// ---------------------------------------------------------------------------

export class SkillInstaller {
  /** Detect available AI coding agents. */
  detectAgents(): DetectedAgent[] {
    const agents: DetectedAgent[] = [];

    for (const [name, config] of Object.entries(AGENT_CONFIGS)) {
      if (name === 'custom') continue;

      agents.push({
        name,
        type: name as DetectedAgent['type'],
        installPath: config.installPath,
        skillFormat: config.format,
      });
    }

    return agents;
  }

  /** Install skills for the given agents. */
  installSkills(agents: DetectedAgent[], skillNames?: string[]): InstallResult[] {
    const results: InstallResult[] = [];
    const skills = skillNames ?? Object.keys(SKILL_TEMPLATES);

    for (const agent of agents) {
      const config = AGENT_CONFIGS[agent.name];
      if (!config) {
        results.push({
          agent: agent.name,
          skill: 'all',
          success: false,
          path: '',
          error: `Unknown agent: ${agent.name}`,
        });
        continue;
      }

      for (const skillName of skills) {
        const templateName = SKILL_TEMPLATES[skillName];
        if (!templateName) {
          results.push({
            agent: agent.name,
            skill: skillName,
            success: false,
            path: '',
            error: `Unknown skill: ${skillName}`,
          });
          continue;
        }

        const path = `${config.installPath}${templateName}`;
        results.push({
          agent: agent.name,
          skill: skillName,
          success: true,
          path,
        });
      }
    }

    return results;
  }

  /** Generate repository-specific skill content. */
  generateRepoSKills(projectId: string): AgentSkill[] {
    const skillNames = Object.keys(SKILL_TEMPLATES);

    return skillNames.map((name) => {
      const content = getSkillContent(name, projectId);
      const toolMap: Record<string, string[]> = {
        exploration: ['get_architecture', 'explore_symbol', 'search_graph', 'trace_call_path', 'get_graph_schema'],
        debugging: ['trace_call_path', 'explore_symbol', 'query_graph', 'search_code'],
        impact: ['impact_analysis', 'detect_changes', 'check_cycles', 'cross_repo_impact'],
        refactoring: ['impact_analysis', 'find_implementations', 'check_cycles', 'review_file'],
        review: ['review_diff', 'review_file', 'check_standards'],
        'pr-review': ['review_pr', 'review_diff', 'check_standards', 'generate_report'],
        architecture: ['get_architecture', 'route_map', 'check_cycles', 'manage_adr'],
        'cross-repo': ['cross_repo_search', 'cross_repo_trace', 'cross_repo_impact', 'manage_repo_group'],
        security: ['taint_analysis', 'pdg_query', 'review_file', 'check_standards'],
        'tool-reference': ['search_graph', 'search_code', 'query_graph', 'explore_symbol', 'get_architecture', 'impact_analysis', 'review_diff', 'generate_report'],
      };

      const categoryMap: Record<string, AgentSkill['category']> = {
        exploration: 'exploration',
        debugging: 'debugging',
        impact: 'impact',
        refactoring: 'refactoring',
        review: 'review',
        'pr-review': 'review',
        architecture: 'architecture',
        'cross-repo': 'architecture',
        security: 'security',
        'tool-reference': 'reference',
      };

      return {
        name: `code-analyzer-${name}`,
        description: `Code Analyzer skill for ${name}`,
        category: categoryMap[name] ?? 'reference',
        content,
        tools: toolMap[name] ?? [],
      };
    });
  }

  /** Get all available skill names. */
  getSkillNames(): string[] {
    return Object.keys(SKILL_TEMPLATES);
  }

  /** Get skill content for a specific skill. */
  getSkillContent(name: string, projectId: string): string {
    return getSkillContent(name, projectId);
  }
}
