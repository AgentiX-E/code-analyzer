// @code-analyzer/intelligence — Public API
// Search, Embeddings, Similarity, Review, and Impact Analysis

// Search
export {
  HybridSearchEngine,
  tokenize,
  cosineSimilarity,
} from './search/hybrid-search.js';
export type { RankedResult, HybridSearchResult } from './search/hybrid-search.js';

// Embeddings
export { EmbeddingEngine } from './embeddings/embedder.js';
export type { EmbeddingConfig, EmbeddingBackend } from './embeddings/embedder.js';

// Similarity
export { MinHashSimilarity } from './similarity/minhash.js';
export { LSHSearcher } from './similarity/lsh.js';
export type { SimilarityEdge } from './similarity/lsh.js';

// Review Engine
export { CodeReviewEngine } from './review/review-engine.js';
export type {
  ReviewConfig,
  ReviewContext,
  ReviewPlan,
} from './review/review-engine.js';

// PR Review
export { PRReviewEngine } from './review/pr-review.js';
export type {
  PRReviewResult,
  PRReviewSummary,
  EnrichedDiff,
} from './review/pr-review.js';

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
  createLensFinding,
  lensFindingToReviewComment,
} from './review/review-lenses.js';
export type {
  LensId,
  LensProfile,
  LensFinding,
  LensReport,
  EvidenceAnchor,
} from './review/review-lenses.js';

// Session Store
export {
  SessionStore,
  computeFileFingerprint,
  generateSessionId,
} from './review/session-store.js';
export type {
  SessionMetadata,
  ReviewItemResult,
  ReviewItemError,
  ResumeState,
  SessionSummary,
} from './review/session-store.js';

// Heuristics
export {
  analyzeFileHeuristics,
  toReviewComment,
} from './review/heuristics.js';
export type {
  HeuristicRuleResult,
  HeuristicResult,
  GraphAnalysisData,
} from './review/heuristics.js';

// Memory Compression
export { MemoryCompressor, countTokens } from './compression/memory-compressor.js';
export type { CompressionConfig } from './compression/memory-compressor.js';

// Standards Engine
export { StandardsEngine } from './standards/engine.js';
export type { AutoFix } from './standards/engine.js';
export {
  STANDARD_TEMPLATES,
  getTemplate,
  listTemplates,
} from './standards/templates.js';
export type { StandardTemplate } from './standards/templates.js';

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
export {
  MarkdownFormatter,
  JsonFormatter,
  HtmlFormatter,
} from './report/formatters.js';
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

// Rules Engine
export {
  RulesEngine,
  getFileLanguage,
  runRules,
  DEFAULT_RULES,
} from './rules/rules-engine.js';
export type {
  RuleCategory,
  CodeRule,
  RuleContext,
  RuleViolation,
  GraphAnalysisData,
  AnalyzeOptions,
  RulesResult,
} from './rules/rules-engine.js';
export { EMPTY_GRAPH_DATA } from './rules/rules-engine.js';

// Rule Definitions
export type { RuleDefinition, RuleSeverity } from './rules/rules-engine.js';
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
} from './rules/rules-engine.js';

// Rule Executor
export type { RuleCheckResult, RuleChecker } from './rules/rules-engine.js';
export { CHECKER_MAP } from './rules/rules-engine.js';

// Rules Registry
export { RulesRegistry } from './rules/rules-engine.js';
export type { RegisteredRule } from './rules/rules-engine.js';
