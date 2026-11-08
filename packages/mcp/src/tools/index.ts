// @code-analyzer/mcp — Tools Index
// Registers all 50 MCP tools into the ToolRegistry.

// **The question-answering surface**, first in the local group because that is where its path sorts.
import { askCodebaseSchema, askCodebaseTool } from './ask.js';
import { deadCodeDetectionTool } from './dead-code-detection.js';
import { ToolRegistry } from './registry.js';

export { ToolRegistry };
export type { ToolHandler, RegisteredTool, ToolResult } from './registry.js';
export { ToolContextImpl } from './tool-context.js';
export type { ToolContext, GraphStats, DependencyTreeNode } from './tool-context.js'; // Indexing & Lifecycle
import {
  analyzeRepository,
  analyzeRepositorySchema,
  listProjects,
  listProjectsSchema,
  deleteProject,
  deleteProjectSchema,
  indexStatus,
  indexStatusSchema,
} from './indexing-lifecycle.js';

// Querying & Exploration
import {
  searchGraph,
  searchGraphSchema,
  searchCode,
  searchCodeSchema,
  semanticSearch,
  semanticSearchSchema,
  traceCallPath,
  traceCallPathSchema,
  queryGraph,
  queryGraphSchema,
  getCodeSnippet,
  getCodeSnippetSchema,
  getArchitecture,
  getArchitectureSchema,
  getGraphSchema as getGraphSchemaHandler,
  getGraphSchemaSchema,
  exploreSymbol,
  exploreSymbolSchema,
  findImplementations,
  findImplementationsSchema,
} from './querying-exploration.js';

// Change & Impact
import {
  detectChanges,
  detectChangesSchema,
  impactAnalysis,
  impactAnalysisSchema,
  routeMap,
  routeMapSchema,
  checkCycles,
  checkCyclesSchema,
  testsFor,
  testsForSchema,
} from './change-impact.js';

// Code Review
import { reviewDiff, reviewDiffSchema, reviewFile, reviewFileSchema } from './code-review.js';

// PR Review
import { reviewPR, reviewPRSchema, checkStandards, checkStandardsSchema } from './pr-review.js';

// Reports
import { reportGenerationTool } from './report-generation.js';
import {
  generateReport,
  generateReportSchema,
  exportReport,
  exportReportSchema,
  getRecommendations,
  getRecommendationsSchema,
} from './reports.js';

// Cross-Repo
import {
  crossRepoSearch,
  crossRepoSearchSchema,
  crossRepoTrace,
  crossRepoTraceSchema,
  crossRepoImpact,
  crossRepoImpactSchema,
  manageRepoGroup,
  manageRepoGroupSchema,
  syncContracts,
  syncContractsSchema,
  discoverRelatedRepos,
  discoverRelatedReposSchema,
  crossRepoReviewPR,
  crossRepoReviewPRSchema,
} from './cross-repo.js';

// PDG
import {
  pdgQuery,
  pdgQuerySchema,
  taintAnalysis,
  taintAnalysisSchema,
  explainTaint,
  explainTaintSchema,
} from './pdg.js';

// Standards, ADR, Agent
import {
  listStandards,
  listStandardsSchema,
  createStandard,
  createStandardSchema,
  manageADR,
  manageADRSchema,
  installSkills,
  installSkillsSchema,
} from './standards-adr-agent.js';

// Benchmark
import { runBenchmark, runBenchmarkSchema } from './benchmark.js';

// Intelligence Tools (Iteration 15)
import { testGenerationTool } from './test-generation.js';
import { trendAnalysisTool } from './trend-analysis.js';
import { hotspotDetectionTool } from './hotspot-detection.js';
import { refactorSuggestionTool } from './refactor-suggestion.js';
import { docGenerationTool } from './doc-generation.js';
import { codeSuggestionTool } from './code-suggestion.js';
import { hallucinationDetectionTool } from './hallucination-detection.js';

// ---------------------------------------------------------------------------
// Register All Tools
// ---------------------------------------------------------------------------

/** Create and configure a ToolRegistry with all 50 tools. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Indexing & Lifecycle (4)
  registry.register(
    'analyze_repository',
    'Analyze and index a code repository',
    analyzeRepositorySchema,
    analyzeRepository,
    'analysis',
    'write',
  );
  registry.register(
    'list_projects',
    'List all indexed projects',
    listProjectsSchema,
    listProjects,
    'all',
    'read',
  );
  registry.register(
    'delete_project',
    'Delete an indexed project and its data',
    deleteProjectSchema,
    deleteProject,
    'analysis',
    'destroy',
  );
  registry.register(
    'index_status',
    'Get indexing status for a project',
    indexStatusSchema,
    indexStatus,
    'all',
    'read',
  );

  // Querying & Exploration (10)
  registry.register(
    'search_graph',
    'Search the knowledge graph by keyword',
    searchGraphSchema,
    searchGraph,
    'all',
    'read',
  );
  registry.register(
    'search_code',
    'Search source code using full-text search',
    searchCodeSchema,
    searchCode,
    'all',
    'read',
  );
  registry.register(
    'semantic_search',
    'Semantic search using embeddings',
    semanticSearchSchema,
    semanticSearch,
    'analysis',
    'read',
  );
  registry.register(
    'trace_call_path',
    'Trace call paths between symbols',
    traceCallPathSchema,
    traceCallPath,
    'analysis',
    'read',
  );
  registry.register(
    'query_graph',
    'Execute a Cypher query against the graph',
    queryGraphSchema,
    queryGraph,
    'analysis',
    'read',
  );
  registry.register(
    'get_code_snippet',
    'Retrieve a code snippet by file and line range',
    getCodeSnippetSchema,
    getCodeSnippet,
    'all',
    'read',
  );
  registry.register(
    'get_architecture',
    'Get architectural overview of a project',
    getArchitectureSchema,
    getArchitecture,
    'analysis',
    'read',
  );
  registry.register(
    'get_graph_schema',
    'Get graph schema information',
    getGraphSchemaSchema,
    getGraphSchemaHandler,
    'all',
    'read',
  );
  registry.register(
    'explore_symbol',
    'Explore a symbol and its relationships',
    exploreSymbolSchema,
    exploreSymbol,
    'all',
    'read',
  );
  registry.register(
    'find_implementations',
    'Find implementations of an interface',
    findImplementationsSchema,
    findImplementations,
    'analysis',
    'read',
  );

  // Change & Impact (4)
  registry.register(
    'detect_changes',
    'Detect code changes between references',
    detectChangesSchema,
    detectChanges,
    'analysis',
    'read',
  );
  // **The surface the arena ships as `tests_for`.** Its `EDGE_TESTS` edges have been produced and read all along -
  // by `structure-lens` and `impact-analyzer` - **and there was no way for an agent to ask**, which is the fifth
  // time this stretch has found a fact that existed and was one surface short of being usable.
  registry.register(
    'tests_for',
    'Find the tests that cover a symbol',
    testsForSchema,
    testsFor,
    'analysis',
    'read',
  );
  registry.register(
    'impact_analysis',
    'Analyze impact of code changes',
    impactAnalysisSchema,
    impactAnalysis,
    'analysis',
    'read',
  );
  registry.register(
    'route_map',
    'Get route map for a project',
    routeMapSchema,
    routeMap,
    'analysis',
    'read',
  );
  registry.register(
    'check_cycles',
    'Check for circular dependencies',
    checkCyclesSchema,
    checkCycles,
    'analysis',
    'read',
  );

  // Code Review (2)
  registry.register(
    'review_diff',
    'Review a git diff for issues',
    reviewDiffSchema,
    reviewDiff,
    'analysis',
    'read',
  );
  registry.register(
    'review_file',
    'Review a single file for issues',
    reviewFileSchema,
    reviewFile,
    'analysis',
    'read',
  );

  // PR Review (2)
  registry.register(
    'review_pr',
    'Review a pull request',
    reviewPRSchema,
    reviewPR,
    'analysis',
    'read',
  );
  registry.register(
    'check_standards',
    'Check code against project standards',
    checkStandardsSchema,
    checkStandards,
    'analysis',
    'read',
  );

  // Reports (3)
  registry.register(
    'generate_report',
    'Generate an analysis report',
    generateReportSchema,
    generateReport,
    'analysis',
    'read',
  );
  registry.register(
    'export_report',
    'Export a report in specified format',
    exportReportSchema,
    exportReport,
    'analysis',
    'write',
  );
  registry.register(
    'get_recommendations',
    'Get code improvement recommendations',
    getRecommendationsSchema,
    getRecommendations,
    'analysis',
    'read',
  );

  // Cross-Repo (7)
  registry.register(
    'cross_repo_search',
    'Search across multiple repositories',
    crossRepoSearchSchema,
    crossRepoSearch,
    'analysis',
    'read',
  );
  registry.register(
    'cross_repo_trace',
    'Trace call paths across repositories',
    crossRepoTraceSchema,
    crossRepoTrace,
    'analysis',
    'read',
  );
  registry.register(
    'cross_repo_impact',
    'Analyze cross-repo impact of changes',
    crossRepoImpactSchema,
    crossRepoImpact,
    'analysis',
    'read',
  );
  registry.register(
    'manage_repo_group',
    'Manage repository groups',
    manageRepoGroupSchema,
    manageRepoGroup,
    'analysis',
    'write',
  );
  registry.register(
    'sync_contracts',
    'Synchronize contracts across repos',
    syncContractsSchema,
    syncContracts,
    'analysis',
    'read',
  );
  registry.register(
    'discover_related_repos',
    'Discover related repositories',
    discoverRelatedReposSchema,
    discoverRelatedRepos,
    'scout',
    'read',
  );
  registry.register(
    'cross_repo_review_pr',
    'Review a pull request with cross-repo context',
    crossRepoReviewPRSchema,
    crossRepoReviewPR,
    'analysis',
    'read',
  );

  // PDG (3)
  registry.register(
    'pdg_query',
    'Query the program dependence graph',
    pdgQuerySchema,
    pdgQuery,
    'analysis',
    'read',
  );
  registry.register(
    'taint_analysis',
    'Perform taint analysis for security',
    taintAnalysisSchema,
    taintAnalysis,
    'analysis',
    'read',
  );
  registry.register(
    'explain_taint',
    'Explain a taint analysis path',
    explainTaintSchema,
    explainTaint,
    'analysis',
    'read',
  );

  // Standards (2)
  registry.register(
    'list_standards',
    'List project standards',
    listStandardsSchema,
    listStandards,
    'all',
    'read',
  );
  registry.register(
    'create_standard',
    'Create a new project standard',
    createStandardSchema,
    createStandard,
    'analysis',
    'write',
  );

  // ADR (1)
  registry.register(
    'manage_adr',
    'Manage Architecture Decision Records',
    manageADRSchema,
    manageADR,
    'analysis',
    'write',
  );

  // Agent (1)
  registry.register(
    'install_skills',
    'Install agent skills for the project',
    installSkillsSchema,
    installSkills,
    'analysis',
    'write',
  );

  // Benchmark (1)
  registry.register(
    'run_benchmark',
    'Run the review quality benchmark suite to measure precision, recall, and F1 score',
    runBenchmarkSchema,
    runBenchmark,
    'analysis',
    'read',
  );

  // Intelligence Tools (5) — Iteration 15
  registry.register(
    'trend_analysis',
    trendAnalysisTool.description,
    trendAnalysisTool.inputSchema,
    trendAnalysisTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    'hotspot_detection',
    hotspotDetectionTool.description,
    hotspotDetectionTool.inputSchema,
    hotspotDetectionTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    'refactor_suggestion',
    refactorSuggestionTool.description,
    refactorSuggestionTool.inputSchema,
    refactorSuggestionTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    'test_generation',
    testGenerationTool.description,
    testGenerationTool.inputSchema,
    testGenerationTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    'doc_generation',
    docGenerationTool.description,
    docGenerationTool.inputSchema,
    docGenerationTool.handler,
    'analysis',
    'read',
  );

  // These three were implemented and covered by their own suites but never
  // imported here, so the registry never saw them and no client could invoke
  // them. Their definitions are the source of truth for the registered name --
  // `register()` takes the name as a separate argument, so reading it off the
  // definition is what keeps the two from drifting apart.
  registry.register(
    codeSuggestionTool.name,
    codeSuggestionTool.description,
    codeSuggestionTool.inputSchema,
    codeSuggestionTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    hallucinationDetectionTool.name,
    hallucinationDetectionTool.description,
    hallucinationDetectionTool.inputSchema,
    hallucinationDetectionTool.handler,
    'analysis',
    'read',
  );
  registry.register(
    reportGenerationTool.name,
    reportGenerationTool.description,
    reportGenerationTool.inputSchema,
    reportGenerationTool.handler,
    'analysis',
    'read',
  );

  // **The question-answering surface, registered last because it composes the others.**
  registry.register(
    'ask_codebase',
    'Ask a natural-language question about the indexed code and get an answer with the code blocks each claim came from',
    askCodebaseSchema,
    askCodebaseTool,
    'analysis',
    'read',
  );

  // **Story 10: what can never run.** Registered after the answering surface because it reads the graph the same way,
  // and it is the only tool whose findings are a statement about absence — so its input carries the two escape hatches
  // (`entryPoints`, `ignoreNames`) that make an absence claim checkable.
  registry.register(
    deadCodeDetectionTool.name,
    deadCodeDetectionTool.description,
    deadCodeDetectionTool.inputSchema,
    deadCodeDetectionTool.handler,
    'analysis',
    'read',
  );

  return registry;
}
