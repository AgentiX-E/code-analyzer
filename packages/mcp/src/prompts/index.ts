// @code-analyzer/mcp — MCP Prompts
// 5 reusable prompts for the MCP server.

import type { PromptDefinition } from '@code-analyzer/shared';

/** Register all 5 MCP prompts. */
export function registerPrompts(): PromptDefinition[] {
  return [
    {
      name: 'explore-codebase',
      description: 'Explore and understand an unknown codebase',
      arguments: [
        { name: 'projectId', description: 'Project ID to explore', required: true },
        { name: 'focus', description: 'Specific area to focus on (e.g., auth, api, database)' },
        { name: 'depth', description: 'Exploration depth (shallow/deep)', required: false },
      ],
    },
    {
      name: 'review-changes',
      description: 'Review code changes for quality, security, and best practices',
      arguments: [
        { name: 'projectId', description: 'Project ID', required: true },
        { name: 'fromRef', description: 'Base reference (branch/commit)', required: true },
        { name: 'toRef', description: 'Target reference (branch/commit)' },
        { name: 'focus', description: 'Review focus area (security/performance/style/all)' },
      ],
    },
    {
      name: 'debug-issue',
      description: 'Debug a code issue by tracing execution paths and analyzing state',
      arguments: [
        { name: 'projectId', description: 'Project ID', required: true },
        { name: 'entryPoint', description: 'Entry point function/method', required: true },
        { name: 'symptom', description: 'Description of the bug or unexpected behavior', required: true },
      ],
    },
    {
      name: 'refactor-plan',
      description: 'Plan a code refactoring with impact analysis and migration steps',
      arguments: [
        { name: 'projectId', description: 'Project ID', required: true },
        { name: 'target', description: 'Code element to refactor (class, module, function)', required: true },
        { name: 'goal', description: 'Refactoring goal (extract, simplify, decouple, etc.)', required: true },
      ],
    },
    {
      name: 'architecture-review',
      description: 'Review the architecture of a project for patterns, anti-patterns, and improvements',
      arguments: [
        { name: 'projectId', description: 'Project ID', required: true },
        { name: 'aspect', description: 'Architectural aspect to focus on (layers, dependencies, patterns)' },
        { name: 'generateADR', description: 'Generate an ADR for proposed changes (true/false)' },
      ],
    },
  ];
}
