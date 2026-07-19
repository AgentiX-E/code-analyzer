// @ts-nocheck
// @code-analyzer/mcp — Tools Index
// Registers all 38 MCP tools into the ToolRegistry.

import { ToolRegistry } from './registry.js';

// Indexing & Lifecycle
import {
  analyzeRepository, analyzeRepositorySchema,
  listProjects, listProjectsSchema,
  deleteProject, deleteProjectSchema,
  indexStatus, indexStatusSchema,
} from './indexing-lifecycle.js';

// Querying & Exploration
import {
  searchGraph, searchGraphSchema,
  searchCode, searchCodeSchema,
  semanticSearch, semanticSearchSchema,
  traceCallPath, traceCallPathSchema,
  queryGraph, queryGraphSchema,
  getCodeSnippet, getCodeSnippetSchema,
  getArchitecture, getArchitectureSchema,
  getGraphSchema as getGraphSchemaHandler, getGraphSchemaSchema,
  exploreSymbol, exploreSymbolSchema,
  findImplementations, findImplementationsSchema,
} from './querying-exploration.js';

// Change & Impact
import {
  detectChanges, detectChangesSchema,
  impactAnalysis, impactAnalysisSchema,
  routeMap, routeMapSchema,
  checkCycles, checkCyclesSchema,
} from './change-impact.js';

// Code Review
import {
  reviewDiff, reviewDiffSchema,
  reviewFile, reviewFileSchema,
} from './code-review.js';

// PR Review
import {
  reviewPR, reviewPRSchema,
  checkStandards, checkStandardsSchema,
} from './pr-review.js';

// Reports
import {
  generateReport, generateReportSchema,
  exportReport, exportReportSchema,
  getRecommendations, getRecommendationsSchema,
} from './reports.js';

// Cross-Repo
import {
  crossRepoSearch, crossRepoSearchSchema,
  crossRepoTrace, crossRepoTraceSchema,
  crossRepoImpact, crossRepoImpactSchema,
  manageRepoGroup, manageRepoGroupSchema,
  syncContracts, syncContractsSchema,
  discoverRelatedRepos, discoverRelatedReposSchema,
} from './cross-repo.js';

// PDG
import {
  pdgQuery, pdgQuerySchema,
  taintAnalysis, taintAnalysisSchema,
  explainTaint, explainTaintSchema,
} from './pdg.js';

// Standards, ADR, Agent
import {
  listStandards, listStandardsSchema,
  createStandard, createStandardSchema,
  manageADR, manageADRSchema,
  installSkills, installSkillsSchema,
} from './standards-adr-agent.js';

// ---------------------------------------------------------------------------
// Register All Tools
// ---------------------------------------------------------------------------

/** Create and configure a ToolRegistry with all 38 tools. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Indexing & Lifecycle (4)
  registry.register('analyze_repository', 'Analyze and index a code repository', analyzeRepositorySchema, analyzeRepository, 'all');
  registry.register('list_projects', 'List all indexed projects', listProjectsSchema, listProjects, 'all');
  registry.register('delete_project', 'Delete an indexed project and its data', deleteProjectSchema, deleteProject, 'all');
  registry.register('index_status', 'Get indexing status for a project', indexStatusSchema, indexStatus, 'all');

  // Querying & Exploration (10)
  registry.register('search_graph', 'Search the knowledge graph by keyword', searchGraphSchema, searchGraph, 'analysis');
  registry.register('search_code', 'Search source code using full-text search', searchCodeSchema, searchCode, 'analysis');
  registry.register('semantic_search', 'Semantic search using embeddings', semanticSearchSchema, semanticSearch, 'analysis');
  registry.register('trace_call_path', 'Trace call paths between symbols', traceCallPathSchema, traceCallPath, 'analysis');
  registry.register('query_graph', 'Execute a Cypher query against the graph', queryGraphSchema, queryGraph, 'analysis');
  registry.register('get_code_snippet', 'Retrieve a code snippet by file and line range', getCodeSnippetSchema, getCodeSnippet, 'analysis');
  registry.register('get_architecture', 'Get architectural overview of a project', getArchitectureSchema, getArchitecture, 'analysis');
  registry.register('get_graph_schema', 'Get graph schema information', getGraphSchemaSchema, getGraphSchemaHandler, 'analysis');
  registry.register('explore_symbol', 'Explore a symbol and its relationships', exploreSymbolSchema, exploreSymbol, 'analysis');
  registry.register('find_implementations', 'Find implementations of an interface', findImplementationsSchema, findImplementations, 'analysis');

  // Change & Impact (4)
  registry.register('detect_changes', 'Detect code changes between references', detectChangesSchema, detectChanges, 'analysis');
  registry.register('impact_analysis', 'Analyze impact of code changes', impactAnalysisSchema, impactAnalysis, 'analysis');
  registry.register('route_map', 'Get route map for a project', routeMapSchema, routeMap, 'analysis');
  registry.register('check_cycles', 'Check for circular dependencies', checkCyclesSchema, checkCycles, 'analysis');

  // Code Review (2)
  registry.register('review_diff', 'Review a git diff for issues', reviewDiffSchema, reviewDiff, 'analysis');
  registry.register('review_file', 'Review a single file for issues', reviewFileSchema, reviewFile, 'analysis');

  // PR Review (2)
  registry.register('review_pr', 'Review a pull request', reviewPRSchema, reviewPR, 'analysis');
  registry.register('check_standards', 'Check code against project standards', checkStandardsSchema, checkStandards, 'analysis');

  // Reports (3)
  registry.register('generate_report', 'Generate an analysis report', generateReportSchema, generateReport, 'analysis');
  registry.register('export_report', 'Export a report in specified format', exportReportSchema, exportReport, 'analysis');
  registry.register('get_recommendations', 'Get code improvement recommendations', getRecommendationsSchema, getRecommendations, 'analysis');

  // Cross-Repo (6)
  registry.register('cross_repo_search', 'Search across multiple repositories', crossRepoSearchSchema, crossRepoSearch, 'analysis');
  registry.register('cross_repo_trace', 'Trace call paths across repositories', crossRepoTraceSchema, crossRepoTrace, 'analysis');
  registry.register('cross_repo_impact', 'Analyze cross-repo impact of changes', crossRepoImpactSchema, crossRepoImpact, 'analysis');
  registry.register('manage_repo_group', 'Manage repository groups', manageRepoGroupSchema, manageRepoGroup, 'all');
  registry.register('sync_contracts', 'Synchronize contracts across repos', syncContractsSchema, syncContracts, 'analysis');
  registry.register('discover_related_repos', 'Discover related repositories', discoverRelatedReposSchema, discoverRelatedRepos, 'scout');

  // PDG (3)
  registry.register('pdg_query', 'Query the program dependence graph', pdgQuerySchema, pdgQuery, 'analysis');
  registry.register('taint_analysis', 'Perform taint analysis for security', taintAnalysisSchema, taintAnalysis, 'analysis');
  registry.register('explain_taint', 'Explain a taint analysis path', explainTaintSchema, explainTaint, 'analysis');

  // Standards (2)
  registry.register('list_standards', 'List project standards', listStandardsSchema, listStandards, 'all');
  registry.register('create_standard', 'Create a new project standard', createStandardSchema, createStandard, 'all');

  // ADR (1)
  registry.register('manage_adr', 'Manage Architecture Decision Records', manageADRSchema, manageADR, 'all');

  // Agent (1)
  registry.register('install_skills', 'Install agent skills for the project', installSkillsSchema, installSkills, 'all');

  return registry;
}
