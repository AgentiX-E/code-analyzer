// @code-analyzer/intelligence — Public API
// Search, Embeddings, Similarity, Review, and Impact Analysis

// Search
export { HybridSearchEngine, tokenize, cosineSimilarity } from './search/hybrid-search.js';
export type { RankedResult, HybridSearchResult } from './search/hybrid-search.js';

// Dataflow Search (5th Search Dimension)
export { DataflowSearchEngine } from './search/dataflow-search.js';
export type {
  DataflowNode,
  DataflowPath,
  ReachableSink,
  TaintReport,
} from './search/dataflow-search.js';

// Embeddings
export { EmbeddingEngine } from './embeddings/embedder.js';
export type { EmbeddingConfig, EmbeddingBackend } from './embeddings/embedder.js';
export {
  EmbeddingWorkerPool,
  getEmbeddingWorkerPool,
  shutdownEmbeddingPool,
} from './embeddings/worker-pool.js';
export type {
  EmbeddingTask,
  EmbeddingResult,
  EmbeddingError,
  WorkerPoolStats,
} from './embeddings/worker-pool.js';

// Similarity
export { MinHashSimilarity } from './similarity/minhash.js';
export { LSHSearcher } from './similarity/lsh.js';
export type { SimilarityEdge } from './similarity/lsh.js';

// Review Engine
export { CodeReviewEngine } from './review/review-engine.js';
export type { ReviewConfig, ReviewContext } from './review/review-engine.js';

// PR Review
export { PRReviewEngine } from './review/pr-review.js';
export type { PRReviewResult, PRReviewSummary, EnrichedDiff } from './review/pr-review.js';

// Review Swarm (8-Lens Multi-Agent Review)
export { ReviewSwarm } from './review/review-swarm.js';
export type {
  SwarmConfig,
  SwarmResult,
  SwarmSummary,
  SwarmDecision,
  ActionItem,
} from './review/review-swarm.js';

// Review Lenses
export {
  LENS_PROFILES,
  getLensProfiles,
  getLensProfile,
  SECURITY_PATTERNS,
  PERFORMANCE_PATTERNS,
  TESTING_PATTERNS,
  KNOWN_CVE_ADVISORIES,
  createLensFinding,
  lensFindingToReviewComment,
  reviewDependencyHealth,
  reviewApiContract,
} from './review/review-lenses.js';
export type {
  LensId,
  LensProfile,
  LensFinding,
  LensReport,
  EvidenceAnchor,
  CveAdvisory,
  ApiContractFinding,
} from './review/review-lenses.js';

// Session Store
export { SessionStore, computeFileFingerprint, generateSessionId } from './review/session-store.js';
export type {
  SessionMetadata,
  ReviewItemResult,
  ReviewItemError,
  ResumeState,
  SessionSummary,
} from './review/session-store.js';

// Review Dashboard Aggregator
export { ReviewDashboardAggregator } from './review/dashboard-aggregator.js';
export type {
  ReviewEntry,
  DashboardMetrics,
  CodeHealthScore,
  TeamInsights,
  DashboardReport,
  DashboardOptions,
} from './review/dashboard-aggregator.js';

// Heuristics
export { analyzeFileHeuristics, toReviewComment } from './review/heuristics.js';
export type {
  HeuristicRuleResult,
  HeuristicResult,
  GraphAnalysisData,
} from './review/heuristics.js';

// File Bundler
export { FileBundler } from './review/file-bundler.js';
export type { FileBundle, BundleCategory } from './review/file-bundler.js';

// Memory Compression
export { MemoryCompressor, countTokens } from './compression/memory-compressor.js';
export type { CompressionConfig } from './compression/memory-compressor.js';

// Standards Engine
export { StandardsEngine } from './standards/engine.js';
export type { AutoFix, CheckViolation, ComplianceReport } from './standards/engine.js';
export { STANDARD_TEMPLATES, getTemplate, listTemplates } from './standards/templates.js';
export type { StandardTemplate } from './standards/templates.js';

export { CustomRuleEditor } from './standards/rule-editor.js';
export type {
  CreateRuleInput,
  UpdateRuleInput,
  RuleValidationResult,
  RuleTemplate,
} from './standards/rule-editor.js';

// Report Generator
export { ReportGenerator } from './report/generator.js';
export type {
  PRReportOptions,
  AuditReportOptions,
  StandardsReportOptions,
  ArchitectureReportOptions,
} from './report/generator.js';

// Recommendation Engine
export { RecommendationEngine } from './report/recommend.js';
export type { RecommendationOptions } from './report/recommend.js';

// Report Formatters
export { MarkdownFormatter, JsonFormatter, HtmlFormatter } from './report/formatters.js';
export type { ReportFormatter } from './report/formatters.js';

// Trend Analyzer
export { TrendAnalyzer } from './report/trends.js';
export type { TrendData, ReportComparison } from './report/trends.js';

// Change Detection
export { ChangeDetector } from './impact/change-detector.js';
export type {
  ChangeDetectionResult,
  ChangedSymbol,
  SymbolWithChanges,
} from './impact/change-detector.js';

// Impact Analysis
export { ImpactAnalyzer } from './impact/impact-analyzer.js';
export type {
  ImpactAnalysisOptions,
  ImpactNode,
  TestImpact,
  RouteImpact,
  ProcessImpact,
} from './impact/impact-analyzer.js';

// IoU Overlap Detection
export { IoUOverlapDetector } from './impact/iou-overlap.js';
export type { CommentRegion } from './impact/iou-overlap.js';

// GitHub PR Webhook
export { GitHubPRWebhook } from './review/github-webhook.js';
export type {
  GitHubPREvent,
  WebhookResult,
  PRFile,
  InlineComment,
} from './review/github-webhook.js';

// Diff Parser
export { DiffParser } from './review/diff-parser.js';
export type {
  ParsedLine,
  FileAddition,
  FileDeletion,
  DiffStats,
  FileRename,
} from './review/diff-parser.js';

// Review Pipeline
export { ReviewPipeline } from './review/review-pipeline.js';
export type { PipelineReviewConfig } from './review/review-pipeline.js';

// LLM Provider & Review Engine
export {
  DeepSeekProvider,
  LLMError,
  LLMAuthError,
  LLMTimeoutError,
  LLMRateLimitError,
} from './review/llm/provider.js';
export type {
  LLMProvider,
  CompletionOptions,
  CompletionResult,
  ToolDefinition,
} from './review/llm/provider.js';

export {
  LANE_PROMPTS,
  LANE_LABELS,
  LANE_PRIORITIES,
  parseLLMResponse,
  SECURITY_REVIEW_PROMPT,
  PERFORMANCE_REVIEW_PROMPT,
  MAINTAINABILITY_REVIEW_PROMPT,
  TESTING_REVIEW_PROMPT,
  ARCHITECTURE_REVIEW_PROMPT,
} from './review/llm/prompts.js';
export type { LLMFinding, PromptContext, ReviewLane } from './review/llm/prompts.js';

export { LLMReviewEngine } from './review/llm/llm-review-engine.js';
export type { LLMReviewOptions, LLMReviewResult } from './review/llm/llm-review-engine.js';

// Comment Positioner
export { CommentPositioner } from './review/comment-positioner.js';
export type { PositionedComment, PositionResult } from './review/comment-positioner.js';

// Delegation Mode
export { DelegationManager } from './review/delegation-mode.js';
export type { DelegatePreview, ResolvedRule } from './review/delegation-mode.js';

// Rules Engine
export { RulesEngine, getFileLanguage, runRules, DEFAULT_RULES } from './rules/rule-runner.js';
export type {
  CodeRule,
  RuleContext,
  RuleViolation,
  AnalyzeOptions,
  RulesResult,
} from './rules/rule-runner.js';
export { EMPTY_GRAPH_DATA } from './rules/rule-runner.js';

// Rule Definitions
export type { RuleDefinition, RuleCategory, RuleSeverity } from './rules/rule-definitions.js';
export {
  ALL_RULE_DEFINITIONS,
  NO_UNDEF,
  NO_DUPLICATE_IMPORTS,
  NO_UNREACHABLE_CODE,
  NO_CONSTANT_CONDITION,
  NO_EMPTY_CATCH,
  NO_UNUSED_VARS,
  NO_UNSAFE_OPTIONAL_CHAINING,
  NO_ARRAY_INDEX_KEY,
  NO_EVAL,
  NO_SQL_INJECTION,
  NO_XSS,
  NO_HARDCODED_SECRETS,
  NO_COMMAND_INJECTION,
  NO_PATH_TRAVERSAL,
  NO_OPEN_REDIRECT,
  NO_UNSAFE_DESERIALIZATION,
  NO_WEAK_CRYPTO,
  NO_INSECURE_RANDOM,
  NO_HTTP_URL,
  NO_DEBUG_STATEMENT,
  NO_SYNC_FS,
  NO_LARGE_ARRAY_COPY,
  NO_INEFFICIENT_REGEX,
  NO_LOOP_AWAIT,
  NO_REDUNDANT_COMPUTATION,
  AVOID_BLOCKING_OPERATIONS,
  PREFER_LAZY_LOADING,
  NO_N_PLUS_ONE,
  MAX_FUNCTION_LINES,
  MAX_PARAMS,
  MAX_NESTING_DEPTH,
  MAX_CYCLOMATIC_COMPLEXITY,
  NO_MAGIC_NUMBERS,
  NO_TODO_FIXME,
  CONSISTENT_NAMING,
  NO_DEAD_CODE,
  NO_GOD_CLASS,
  PREFER_EARLY_RETURN,
  TRAILING_WHITESPACE,
  NO_CONSOLE,
  CONSISTENT_QUOTES,
  NO_LONG_LINES,
  SPACING_CONSISTENCY,
  FILE_HEADER,
  NO_CIRCULAR_DEPS,
  NO_LAYER_VIOLATION,
  NO_BARREL_EXPORT,
  MAX_MODULE_SIZE,
  NO_CROSS_BOUNDARY_ACCESS,
  MISSING_ABSTRACTION,
} from './rules/rule-definitions.js';

// Rule Executor Types & Checker Map
export type { RuleCheckResult, RuleChecker } from './rules/rule-runner.js';
export { CHECKER_MAP } from './rules/rule-runner.js';

// Rules Registry
export { RulesRegistry } from './rules/rules-registry.js';
export type { RegisteredRule } from './rules/rules-registry.js';

// Cross-Repo Analysis
export { RepoGroupManager } from './cross-repo/repo-group-manager.js';

export { CrossRepoIndexer, levenshteinDistance } from './cross-repo/cross-repo-indexer.js';
export type {
  IndexOptions,
  IndexResult,
  CrossRepoSymbolMatch,
  CrossRepoGraphReport,
  TypeCompatResult,
  CrossRepoImpactResult,
  SymbolDependencyTrace,
} from './cross-repo/cross-repo-indexer.js';

export { FederatedSearchEngine } from './cross-repo/federated-search.js';
export type {
  FederatedSearchOptions,
  FederatedSearchResult,
  FederatedSearchItem,
  FederatedSymbolResult,
  DuplicateReport,
  DuplicateGroup,
  UsageReport,
} from './cross-repo/federated-search.js';

export { CrossRepoPRReviewEngine } from './cross-repo/cross-repo-pr-review.js';
export type {
  CrossRepoReviewResult,
  CrossRepoImpactEntry,
  APIBreakingReport,
  APIBreakingChange,
  TestImpactReport,
  TestImpactPrediction,
  CrossRepoReviewSummary,
  VersionCompatibilityReport,
} from './cross-repo/cross-repo-pr-review.js';

export { VersionCompatibilityMatrix } from './cross-repo/version-matrix.js';
export type {
  CompatibilityMatrix,
  VersionConflict,
  VersionAlignment,
  UpgradeSafetyReport,
} from './cross-repo/version-matrix.js';

export { CrossRepoGraphVisualizer } from './cross-repo/graph-visualizer.js';
export type {
  CrossRepoEdgeRecord,
  JsonGraphRepoNode,
  JsonGraphEdge,
  JsonGraph,
  RepoMetrics,
} from './cross-repo/graph-visualizer.js';

export { IncrementalCrossRepoIndexer } from './cross-repo/incremental-indexer.js';
export type { ChangeSet, IncrementalIndexResult } from './cross-repo/incremental-indexer.js';

export { IncrementalReindexer } from './cross-repo/incremental-reindexer.js';
export type { ChangedFiles, ReindexResult } from './cross-repo/incremental-reindexer.js';

export { GraphCompressor } from './cross-repo/graph-compressor.js';
export type { ArtifactMetadata } from './cross-repo/graph-compressor.js';

// GitHub Integration
export {
  GitHubApiClient,
  GitHubApiError,
  GitHubRateLimitError,
  GitHubRepoSync,
  GitHubCheckRunManager,
  CrossRepoWebhookBridge,
} from './github/index.js';
export type {
  GitHubAuth,
  GitHubRepo,
  GitHubPR,
  GitHubPRFile,
  GitHubCheckRun,
  GitHubAnnotation,
  GitHubBranch,
  GitHubWebhook,
  RateLimitInfo,
  GraphQLResponse,
  RepoSearchResult,
  CreateCheckRunParams,
  UpdateCheckRunParams,
  SyncOptions,
  SyncResult,
  SyncError,
  CheckRunOptions,
  CheckRunResult,
  WebhookPayload,
  BridgeResult,
} from './github/index.js';

// Benchmark
export { BenchmarkRunner } from './benchmark/benchmark-runner.js';
export type {
  SingleCaseResult,
  AggregateMetrics,
  BenchmarkResult,
} from './benchmark/benchmark-runner.js';
export { ALL_BENCHMARK_CASES, lines } from './benchmark/benchmark-data.js';
export type { BenchmarkCase, FileContent, GroundTruthIssue } from './benchmark/benchmark-data.js';

// Community Rule Registry
export { RuleRegistry } from './rules/rule-registry.js';
export type {
  RegistryTemplate,
  TemplateRule,
  RegistryImportResult,
} from './rules/rule-registry.js';
