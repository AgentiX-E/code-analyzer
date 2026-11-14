// @code-analyzer/intelligence — Public API
// Search, Embeddings, Similarity, Review, and Impact Analysis

// Search
export { HybridSearchEngine, tokenize, cosineSimilarity } from './search/hybrid-search.js';
export {
  deriveVectorWeight,
  // **The two-sided candidate**, exported because a measurement has to be able to run it: the corpora publish its
  // column beside the one-sided rule's (`EVAL-CONTRACT.md` §39), and a rule that only its own test could call would be
  // a rule nobody measured.
  evidenceRatioWeight,
  channelEvidence,
  selfEvidence,
  EVIDENCE_DEPTH,
  EVIDENCE_SMOOTHING,
  FUSION_WEIGHT_BOUNDS,
  SELF_EVIDENCE_CONFIDENT,
  SELF_EVIDENCE_GUESSING,
} from './search/fusion-weight.js';
export type { RankedResult, HybridSearchResult } from './search/hybrid-search.js';
// **The fusion mechanisms, so a surface can offer them rather than only a harness being able to run them.** §40
// measured eight and retired four; the four that remain are a product option now, and the names are exported so a CLI
// can refuse a name it does not have instead of silently fusing with the default.
export { FUSION_RULE_NAMES, fuseByRule } from './search/fusion-rules.js';
export type { FusionRuleName } from './search/fusion-rules.js';
// **The engine belongs to the store.** Every surface that answers a question — the CLI, the MCP tools, the GraphQL
// resolver — asks this for the ranking, so they are one retrieval rather than four similar ones.
export { searchEngineFor } from './search/engine-for-store.js';
// **Whether two rank lists differ by more than the questions they were measured on.** Every comparison before this
// module subtracted two averages, which is a description of the instrument; these are the paired tests.
export {
  compareArms,
  decodeRanks,
  encodeRanks,
  foundWithin,
  mcnemarExact,
  reciprocalRank,
  MRR_CUT,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
} from './search/paired-stats.js';
export type { PairedComparison, RankList } from './search/paired-stats.js';
export { FILE_AGGREGATION, FILE_AGGREGATIONS, rankFiles } from './search/file-ranking.js';
export type { FileAggregation, PoolEntry, RankedFile } from './search/file-ranking.js';
export {
  MAX_SOURCE_FILES,
  SKIPPED_DIRECTORIES,
  SOURCE_EXTENSIONS,
  walkSourceFiles,
} from './search/file-tree.js';
export type { FileTree, FileTreeOptions } from './search/file-tree.js';
export { locateFiles, FUSION_DEPTH } from './search/locate.js';
export type { LocateOptions, LocateResult } from './search/locate.js';
export { RRF_K, reciprocalRankFusion } from './search/fusion.js';
export type { FusedRanking, FusedScore, FusionOptions, RankedArm } from './search/fusion.js';
export {
  buildPathImportsIndex,
  extractImports,
  pathImportsRanking,
  rankByPathImports,
} from './search/path-imports.js';
export type {
  PathDocument,
  PathImportsIndex,
  PathImportsOptions,
  PathImportsResult,
} from './search/path-imports.js';
export {
  compareCodeUnits,
  compareNodeIdentity,
  sortByScoreThenIdentity,
  sortByScoreThenKey,
} from './search/ranking.js';
// **Query expansion is a public capability of the semantic half**, not a detail of one measurement: `search_code` will
// use it behind a flag, and a caller that supplies its own provider gets the same prompt and the same mean.
export {
  createLLMProvider,
  isLLMProviderName,
  knownLLMProviders,
} from './review/llm/provider-factory.js';
export type { LLMProviderName } from './review/llm/provider-factory.js';
export {
  MIN_HYPOTHESIS_CHARS,
  cleanHypothesis,
  expandQuestion,
  expandToVector,
  hydePrompt,
  meanVector,
} from './search/query-expansion.js';
export type { ExpandedQuery, ExpansionOptions } from './search/query-expansion.js';
// **Listwise reranking**: the stage that can fix the order a fused list arrives in - the same reason every
// codebase-QA competitor ships one.
export {
  applyOrder,
  describeFailure,
  parseRerankAnswer,
  rerankCandidates,
  rerankPrompt,
} from './search/rerank.js';
export type { RerankCandidate, RerankResult } from './search/rerank.js';

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
// **The default rule set is public**, because `code-analyzer init` writes it into a project and `standards check`
// judges that project against it: a private constant here and a copy there would be two answers to "what are our
// defaults".
export { DEFAULT_STANDARDS } from './review/standards-defaults.js';
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
// **Story 10: whether a symbol can ever run.** Exported here rather than kept internal because two surfaces ask it —
// the `find_dead_code` tool and the dead-code benchmark — and a second copy of the rule in either would be a second
// answer to the same question.
export { computeReachability, publishedRoots } from './impact/reachability.js';
export type {
  DeadSymbol,
  Liveness,
  ReachabilityOptions,
  ReachabilityReport,
  ReachRoot,
  RootKind,
} from './impact/reachability.js';
export type { CommentRegion } from './impact/iou-overlap.js';

// GitHub PR Webhook
export { GitHubPRWebhook } from './review/github-webhook.js';
export type {
  GitHubPREvent,
  WebhookResult,
  PRFile,
  InlineComment,
} from './review/github-webhook.js';

// The review agent — a review that can read the code it is reviewing
export {
  AGENT_ARM_DIVERGENCE,
  BASELINE_AGENT_OPTIONS,
  ReviewAgent,
  SHIPPED_AGENT_OPTIONS,
  groupChangedFiles,
} from './review/agent/review-agent.js';
export type {
  AgentReviewOutcome,
  DropRecord,
  FileAccount,
  FileStatus,
  ReviewAgentOptions,
} from './review/agent/review-agent.js';
export { DirectoryRepository, MappedRepository } from './review/agent/repository.js';
export { splitPatchByPath } from './review/agent/patch.js';
export type {
  RepositoryFile,
  RepositoryLimits,
  ReviewRepository,
  SearchHit,
  SearchOptions,
} from './review/agent/repository.js';
export { locateInDiff, locateInFile, locateSnippetLines } from './review/agent/grounding.js';
export type { LocatedSpan, LocationQuality } from './review/agent/grounding.js';
export { AgentBudget, DEFAULT_AGENT_LIMITS } from './review/agent/budget.js';
export type { AgentLedger, AgentLimits } from './review/agent/budget.js';
export {
  AGENT_TOOLS,
  dispatchTool,
  parseDeclaration,
  parseDraftComments,
} from './review/agent/tools.js';
export type { DraftComment, ReviewDeclaration, ToolOutcome } from './review/agent/tools.js';

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

// **The cost instrument is public**, because the figure a run spent has to be readable by the harness that publishes it,
// by the CLI that reports it, and by a test that has to hold a ceiling - and **a figure only one package can read is a
// figure the other packages re-derive, differently.**
export {
  CostBudget,
  CostLedger,
  LLMBudgetError,
  LLM_PRICE_TABLE,
  OFF_PEAK_FACTOR,
  costUsdOf,
  isPeakHour,
  priceFor,
} from './review/llm/cost.js';
export type { CostEntry, CostTotals, LLMPriceRow, LLMTokenUsage } from './review/llm/cost.js';

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
export { describeTarget, selectionContract } from './review/llm/prompts.js';
// **The checklist and its selection rules are public**, because a caller that wants to know which language rules a
// review was given should be able to ask rather than read the prompt - and because the benchmark's artifact records
// the selection it paid for.
export {
  defectChecklist,
  languageOf,
  languagesOf,
  extensionOf,
  LANGUAGES,
  MAX_LANGUAGES_PER_CALL,
} from './review/llm/language-rules.js';
export type {
  LanguageDefinition,
  LanguageRule,
  RuleLanguage,
} from './review/llm/language-rules.js';
export type { LLMFinding, PromptContext, PromptOrder, ReviewLane } from './review/llm/prompts.js';
export { composeLanePrompt, sharedPrefix } from './review/llm/prompts.js';

export { LLMReviewEngine, planLaneWaves } from './review/llm/llm-review-engine.js';
export type {
  DiffSection,
  LLMReviewOptions,
  LLMReviewResult,
  PullRequestReviewOptions,
} from './review/llm/llm-review-engine.js';

// Claim adjudication — the pass that decides whether a finding's sentence is true of the code before it is filed.
// **Exported rather than private to the engine** because the pieces are the parts that can be argued with: the narration
// rules are a measurement table, the verdict parser is what stands between a refutation and a filed invention, and the
// patch walk is the only coordinate system in this exchange that cannot be off by a constant. A caller that wants to
// score the adjudicator's decisions without filing anything needs all three.
export { ClaimAdjudicator, oneLine } from './review/adjudication/adjudicator.js';
export type {
  AdjudicationCandidate,
  AdjudicationReport,
  RefusedClaim,
} from './review/adjudication/adjudicator.js';
export {
  ADJUDICATION_LINE_WINDOW,
  buildAdjudicationPrompt,
  clipCode,
  renderAddedLines,
} from './review/adjudication/prompt.js';
export type { AdjudicationRequest } from './review/adjudication/prompt.js';
export { applyVerdict, readAdjudication, resolveAnchor } from './review/adjudication/verdict.js';
export type {
  AdjudicationVerdict,
  AdjudicationVerdictName,
  Anchor,
  AppliedVerdict,
} from './review/adjudication/verdict.js';
export { applyNarrationVeto, readNarration } from './review/adjudication/narration.js';
export type {
  DescribedFinding,
  NarrationReason,
  NarrationVetoReport,
} from './review/adjudication/narration.js';
export { addedLinesOf, numberedAddedLines } from './review/adjudication/patch-lines.js';
export type { NumberedAddedLine } from './review/adjudication/patch-lines.js';

// Actionability ranking — the order a reader should meet the findings in.
export {
  ACTIONABILITY_WEIGHTS,
  collectDiffFacts,
  matchedGoldenIndices,
  maximumMatchingCount,
  point,
  rankFindings,
  scoreSubset,
  topKCurve,
  weighFinding,
} from './review/actionability.js';
export type {
  ActionabilityFeatures,
  ActionabilityScore,
  DiffFacts,
  LocatedFinding,
  RankedFinding,
  TopKPoint,
} from './review/actionability.js';

// Category prior — what a category of finding is worth, measured rather than assumed
export {
  applyEmissionProfile,
  CATEGORY_ACCEPTANCE,
  categoryVerdict,
  DEFECT_FLOOR,
} from './review/category-prior.js';
export type {
  CategoryAcceptance,
  CategoryVerdict,
  EmissionProfile,
  ProfileOutcome,
} from './review/category-prior.js';

// Idiom rules — the remarks a reviewer makes that are not about a defect, each derived from a golden
export { detectIdioms, IDIOM_RULES } from './review/idiom-rules.js';
export type { IdiomInput } from './review/idiom-rules.js';

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

export { mergePipelineGraph, toRepoPath } from './cross-repo/group-graph.js';
export type { MergeDrops, MergeScope, MergedEdge, MergedGraph } from './cross-repo/group-graph.js';

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
// **The two conversions a public corpus needs**, exported because the measurement and the acceptance test have to make
// them the same way: the product reports absolute paths and every corpus records repository-relative ones, and a
// conversion written twice is a conversion that disagrees with itself once.
export {
  CONFIG_EXTENSION,
  LCA_CONFIGS,
  corpusFiles,
  isTestPath,
  lcaQualityMetrics,
  outsideUniverse,
  restrictToUniverse,
  toCorpusPath,
} from './benchmark/lca-instrument.js';
export type { LcaConfigName } from './benchmark/lca-instrument.js';

// Community Rule Registry
export { RuleRegistry } from './rules/rule-registry.js';
export type {
  RegistryTemplate,
  TemplateRule,
  RegistryImportResult,
} from './rules/rule-registry.js';

// Taint analysis, from the analyser's output to a result. `mcp` calls these after a pipeline run.
export { analyzeInterproceduralTaint, resolveCallSites } from './security/interprocedural-entry.js';
export type { InterprocTaintFinding, InterprocTaintResult } from './security/interproc-solver.js';

// Question answering — retrieval, a bounded graph-aware context, a provider-agnostic answer, and a citation check.
// **The composition is the feature**: every stage existed and nothing asked a question end to end.
export {
  ABSTAIN_REASONS,
  DEFAULT_CONTEXT_OPTIONS,
  DEFAULT_EXPANSION_RELATIONS,
  GENERIC_REPOSITORY_NAMES,
  LANGUAGE_SUFFIXES,
  askCodebase,
  answerPrompt,
  assembleContext,
  blockCost,
  contextChars,
  excerpt,
  filesOf,
  hasGroundedClaim,
  headWord,
  indexOfWords,
  isDistinctiveName,
  namedProjects,
  neighboursOf,
  nodeBody,
  nodesForFiles,
  parseCitationIds,
  projectName,
  rankCandidates,
  renderBlock,
  resolveScope,
  retrieveContext,
  sentences,
  verifyCitations,
} from './qa/index.js';
export type {
  AbstainReason,
  AnswerResult,
  AskInput,
  AskOptions,
  Citation,
  ContextBlock,
  ContextOptions,
  GroundingReport,
  NamedProject,
  RetrievedCandidate,
  ScopeReport,
} from './qa/index.js';
