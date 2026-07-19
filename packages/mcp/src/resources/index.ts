// @code-analyzer/mcp — MCP Resources
// 15 resource definitions for the MCP server.

import type { ResourceDefinition } from '@code-analyzer/shared';

/** Register all 15 MCP resources. */
export function registerResources(): ResourceDefinition[] {
  return [
    { uri: 'code-analyzer://resources/projects', name: 'Projects', description: 'List of all indexed projects' },
    { uri: 'code-analyzer://resources/project-schema', name: 'Project Schema', description: 'Schema definition for project data' },
    { uri: 'code-analyzer://resources/clusters', name: 'Clusters', description: 'Community clusters detected in the codebase' },
    { uri: 'code-analyzer://resources/processes', name: 'Processes', description: 'Business processes modeled in the codebase' },
    { uri: 'code-analyzer://resources/routes', name: 'Routes', description: 'HTTP routes and API endpoints' },
    { uri: 'code-analyzer://resources/entrypoints', name: 'Entry Points', description: 'Application entry points' },
    { uri: 'code-analyzer://resources/hotspots', name: 'Hotspots', description: 'Code hotspots with high complexity or churn' },
    { uri: 'code-analyzer://resources/adrs', name: 'ADRs', description: 'Architecture Decision Records' },
    { uri: 'code-analyzer://resources/stats', name: 'Stats', description: 'Project statistics and metrics' },
    { uri: 'code-analyzer://resources/graph', name: 'Graph', description: 'Complete knowledge graph for a project' },
    { uri: 'code-analyzer://resources/groups', name: 'Groups', description: 'Repository groups' },
    { uri: 'code-analyzer://resources/contracts', name: 'Contracts', description: 'Cross-repo contracts' },
    { uri: 'code-analyzer://resources/config', name: 'Config', description: 'Server configuration' },
    { uri: 'code-analyzer://resources/health', name: 'Health', description: 'Server health and status' },
    { uri: 'code-analyzer://resources/reports', name: 'Reports', description: 'Generated analysis reports' },
  ];
}
