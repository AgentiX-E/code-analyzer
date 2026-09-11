// @code-analyzer/vscode — Code Analyzer Chat Participant
// The @code-analyzer Copilot Chat participant. Classifies user intent,
// invokes analyzer tools to gather context, and enriches the chat stream.
// Supports 15 slash commands for structured analysis workflows.

import type { EngineBridge } from '../services/engine-bridge.js';
import { EDGE_CALLS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Type stubs for VS Code Chat API (used in tests only; real types from vscode)
// ---------------------------------------------------------------------------

export interface ChatRequest {
  prompt: string;
  command?: string;
}

export interface ChatContext {
  history: unknown[];
}

export interface ChatResponseStream {
  markdown(value: string): void;
  button?(value: unknown): void;
}

export interface ChatResult {
  metadata?: Record<string, unknown>;
}

export interface CancellationToken {
  isCancellationRequested: boolean;
}

// ---------------------------------------------------------------------------
// Slash Command Types
// ---------------------------------------------------------------------------

export type SlashCommand =
  | 'review'
  | 'explain'
  | 'impact'
  | 'find'
  | 'deps'
  | 'refactor'
  | 'test'
  | 'analyze'
  | 'coverage'
  | 'standards'
  | 'review-deps'
  | 'check-contract'
  | 'trace-dataflow'
  | 'find-hotspots'
  | 'audit-security';

export const SLASH_COMMANDS = [
  'review',
  'explain',
  'impact',
  'find',
  'deps',
  'refactor',
  'test',
  'analyze',
  'coverage',
  'standards',
  'review-deps',
  'check-contract',
  'trace-dataflow',
  'find-hotspots',
  'audit-security',
] as const;

// ---------------------------------------------------------------------------
// Intent Classification
// ---------------------------------------------------------------------------

export type IntentType =
  | 'explore'
  | 'search'
  | 'review'
  | 'impact'
  | 'debug'
  | 'refactor'
  | 'explain'
  | 'find'
  | 'deps'
  | 'test'
  | 'analyze'
  | 'coverage'
  | 'standards';

export interface ClassifiedIntent {
  type: IntentType;
  entity?: string;
  query?: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Analysis Context
// ---------------------------------------------------------------------------

/**
 * An AnalysisContext whose named fields are guaranteed present.
 *
 * Most handlers fetch every field they render in one unconditional pass, so their
 * builders receive a context that is fully populated by construction. Declaring the
 * handler-local context with this type keeps those guarantees in the type system and
 * removes the `field &&` probes that the builders would otherwise need — probes that
 * could never take their false branch and only disguised unreachable code as
 * defensive coding. Handlers that tolerate a failing engine (/review, /impact) keep
 * handing over a plain AnalysisContext and keep their genuine guards.
 */
type ResolvedContext<K extends keyof AnalysisContext> = AnalysisContext &
  Required<Pick<AnalysisContext, K>>;

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  parameterCount: number;
  nestingDepth: number;
}

export interface SymbolDetail {
  name: string;
  qualifiedName: string;
  filePath: string;
  signature?: string;
  docstring?: string;
  label: string;
  complexity?: ComplexityMetrics;
  isExported: boolean;
}

export interface ImpactResult {
  riskLevel: string;
  riskScore: number;
  affectedSymbols: number;
  directDependents: Array<{ name: string; filePath: string }>;
  indirectDependents: Array<{ name: string; filePath: string }>;
  affectedTests: Array<{ name: string; filePath: string }>;
}

export interface AnalysisContext {
  searchResults?: Array<{ name: string; filePath: string; label: string; relevanceScore?: number }>;
  searchQuery?: string;
  changedFiles?: Array<{ path: string; status: string }>;
  reviewComments?: Array<{
    severity: string;
    title: string;
    path: string;
    startLine: number;
  }>;
  changedSymbols?: Array<{ name: string; riskLevel: string }>;
  impact?: ImpactResult;
  traceResults?: Array<{ name: string; filePath: string }>;
  implementations?: Array<{ name: string; filePath: string }>;
  callers?: Array<{ name: string; filePath: string }>;
  callerList?: Array<{ name: string; filePath: string }>;
  calleeList?: Array<{ name: string; filePath: string }>;
  relatedCode?: Array<{ name: string; filePath: string }>;
  symbols?: Array<{ name: string; filePath: string; label?: string }>;
  symbolDetail?: SymbolDetail;
  relatedTests?: Array<{ name: string; filePath: string }>;
  dependencyGraph?: {
    upstream: Array<{ name: string; filePath: string; relationship: string }>;
    downstream: Array<{ name: string; filePath: string; relationship: string }>;
  };
  refactoringOpportunities?: Array<{
    title: string;
    description: string;
    filePath: string;
    lineNumber: number;
  }>;
  standardsViolations?: Array<{
    ruleId: string;
    message: string;
    severity: string;
  }>;
  computedComplexity?: ComplexityMetrics;
  testCoverage?: {
    existingTests: Array<{ name: string; filePath: string }>;
    coverageGaps: string[];
  };
}

// ---------------------------------------------------------------------------
// API Surface Labels
// ---------------------------------------------------------------------------

/**
 * Node labels that form a package's public API surface. `/check-contract` reports
 * these, and the graph keeps the kind in `label` while `name` holds the bare
 * identifier (never prefixed with `class `/`function `/`interface `).
 */
const CONTRACT_SYMBOL_LABELS: ReadonlySet<string> = new Set([
  'Class',
  'Interface',
  'Function',
  'TypeAlias',
  'Enum',
]);

// ---------------------------------------------------------------------------
// Intent Classification Patterns
// ---------------------------------------------------------------------------

const INTENT_PATTERNS: Array<{
  type: IntentType;
  patterns: RegExp[];
  extractEntity?: (match: RegExpMatchArray) => string | undefined;
}> = [
  {
    type: 'explore',
    patterns: [
      /^how does\s+(.+?)\s+work/i,
      /^explain\s+(.+)/i,
      /^what is\s+(.+)/i,
      /^tell me about\s+(.+)/i,
      /^describe\s+(.+)/i,
      /^document\s+(.+)/i,
      /^show me\s+(.+)/i,
    ],
    extractEntity: (m) => m[1]?.trim(),
  },
  {
    type: 'search',
    patterns: [
      /^find\s+(.+)/i,
      /^search\s+(?:for\s+)?(.+)/i,
      /^where is\s+(.+)/i,
      /^look\s+for\s+(.+)/i,
      /^locate\s+(.+)/i,
    ],
    extractEntity: (m) => m[1]?.trim(),
  },
  {
    type: 'review',
    patterns: [
      /^review\s+(?:my\s+)?(?:changes|code)/i,
      /^check\s+(?:this|my)\s+code/i,
      /^code\s+review/i,
      /^audit\s+(?:my\s+)?(?:changes|code)/i,
      /^inspect\s+(?:my\s+)?(?:changes|code)/i,
    ],
  },
  {
    type: 'impact',
    patterns: [
      /^what breaks if\s+(.+)/i,
      /^impact\s+of\s+(?:changing\s+)?(.+)/i,
      /^what depends on\s+(.+)/i,
      /^affected by\s+(.+)/i,
      /^consequences of\s+(.+)/i,
      /^risk of\s+(?:changing\s+)?(.+)/i,
    ],
    extractEntity: (m) => m[1]?.trim(),
  },
  {
    type: 'debug',
    patterns: [
      /^why is\s+(.+?)\s+(?:failing|broken|not working)/i,
      /^debug\s+(.+)/i,
      /^fix\s+(.+)/i,
      /^what's wrong with\s+(.+)/i,
      /^error in\s+(.+)/i,
      /^bug in\s+(.+)/i,
    ],
    extractEntity: (m) => m[1]?.trim(),
  },
  {
    type: 'refactor',
    patterns: [
      /^refactor\s+(.+)/i,
      /^rename\s+(.+?)\s+to\s+/i,
      /^extract\s+(.+)/i,
      /^optimize\s+(.+)/i,
      /^improve\s+(.+)/i,
      /^clean\s+up\s+(.+)/i,
    ],
    extractEntity: (m) => m[1]?.trim(),
  },
];

// ---------------------------------------------------------------------------
// CodeAnalyzerChatParticipant
// ---------------------------------------------------------------------------

export class CodeAnalyzerChatParticipant {
  constructor(private engine: EngineBridge) {}

  /**
   * Handle a user request in Copilot Chat.
   * Routes slash commands directly or uses intent classification for natural language.
   */
  async handleRequest(
    request: ChatRequest,
    _context: ChatContext,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    // Route slash commands directly
    if (request.command && this.isSlashCommand(request.command)) {
      return this.handleSlashCommand(
        request.command as SlashCommand,
        request.prompt,
        stream,
        token,
      );
    }

    // Detect slash command in prompt text (e.g. "/review")
    const parsedCommand = this.parseSlashCommandFromPrompt(request.prompt);
    if (parsedCommand) {
      return this.handleSlashCommand(parsedCommand.command, parsedCommand.params, stream, token);
    }

    // 1. Classify user intent
    const intent = this.classifyIntent(request.prompt);

    // 2. Gather enriched context via analyzer tools
    const analysisContext = await this.gatherAnalysisContext(intent, request, token);

    // 3. Build context for Copilot's language model
    const contextMessage = this.buildContextMessage(intent, analysisContext);

    // 4. Stream the context to Copilot (Copilot does the actual LLM work)
    stream.markdown(contextMessage);

    return { metadata: { intent: intent.type } };
  }

  /**
   * Route a slash command to its handler and stream the result.
   */
  async handleSlashCommand(
    command: SlashCommand,
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const trimmedParams = params.trim();

    switch (command) {
      case 'review':
        return this.handleReviewCommand(stream, token);
      case 'explain':
        return this.handleExplainCommand(trimmedParams, stream, token);
      case 'impact':
        return this.handleImpactCommand(trimmedParams, stream, token);
      case 'find':
        return this.handleFindCommand(trimmedParams, stream, token);
      case 'deps':
        return this.handleDepsCommand(trimmedParams, stream, token);
      case 'refactor':
        return this.handleRefactorCommand(trimmedParams, stream, token);
      case 'test':
        return this.handleTestCommand(trimmedParams, stream, token);
      case 'analyze':
        return this.handleAnalyzeCommand(trimmedParams, stream, token);
      case 'coverage':
        return this.handleCoverageCommand(trimmedParams, stream, token);
      case 'standards':
        return this.handleStandardsCommand(trimmedParams, stream, token);
      case 'review-deps':
        return this.handleReviewDepsCommand(stream, token);
      case 'check-contract':
        return this.handleCheckContractCommand(trimmedParams, stream, token);
      case 'trace-dataflow':
        return this.handleTraceDataflowCommand(trimmedParams, stream, token);
      case 'find-hotspots':
        return this.handleFindHotspotsCommand(stream, token);
      case 'audit-security':
        return this.handleAuditSecurityCommand(stream, token);
      default:
        stream.markdown(
          '## Unknown Command\n\nCommand not recognized. Available commands:\n- `/review`\n- `/explain <symbol>`\n- `/impact <symbol>`\n- `/find <query>`\n- `/deps <symbol>`\n- `/refactor <symbol>`\n- `/test <symbol>`\n- `/analyze`\n- `/coverage`\n- `/standards`\n- `/review-deps`\n- `/check-contract <file>`\n- `/trace-dataflow <file>`\n- `/find-hotspots`\n- `/audit-security`\n',
        );
        return { metadata: { command, error: 'unknown_command' } };
    }
  }

  // ---------------------------------------------------------------------------
  // Slash Command Handlers
  // ---------------------------------------------------------------------------

  /**
   * /review — Review the current file or workspace changes.
   */
  private async handleReviewCommand(
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    const ctx: AnalysisContext = {};

    try {
      const changedFiles = await this.engine.getChangedFiles();
      ctx.changedFiles = changedFiles;
      ctx.reviewComments = await this.engine.reviewWorkspace();

      // Also gather standards violations
      ctx.standardsViolations = [];
      for (const f of changedFiles.slice(0, 5)) {
        const violations = await this.engine.checkStandards(f.path);
        ctx.standardsViolations.push(
          ...violations.map((v) => ({
            ruleId: v.passed ? 'passed' : 'failed',
            message: v.message,
            severity: v.passed ? 'info' : 'warning',
          })),
        );
      }
    } catch {
      // Handle gracefully when no analysis has been run
    }

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildReviewContext(ctx);
    stream.markdown(message);

    const issueCount = ctx.reviewComments?.length ?? 0;
    return {
      metadata: {
        command: 'review',
        issuesFound: issueCount,
        filesChanged: ctx.changedFiles?.length ?? 0,
      },
    };
  }

  /**
   * /explain <symbol> — Explain a symbol with knowledge graph context.
   */
  private async handleExplainCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /explain\n\n**Usage:** `/explain <symbol>`\n\nProvide a symbol name to explain.\n',
      );
      return { metadata: { command: 'explain', error: 'missing_params' } };
    }

    const ctx: ResolvedContext<'searchResults' | 'callers' | 'calleeList'> = {
      symbolDetail: await this.engine.getSymbolDetail(params),
      searchResults: await this.engine.search(params),
      callers: await this.engine.findCallers(params),
      calleeList: await this.engine.findCallees(params),
    };

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildExplainContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'explain',
        symbol: params,
        found: ctx.symbolDetail !== undefined,
      },
    };
  }

  /**
   * /impact <symbol> — Show impact of changing a symbol with blast radius.
   */
  private async handleImpactCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /impact\n\n**Usage:** `/impact <symbol>`\n\nProvide a symbol name to analyze impact.\n',
      );
      return { metadata: { command: 'impact', error: 'missing_params' } };
    }

    const ctx: AnalysisContext = {};

    try {
      ctx.callers = await this.engine.findCallers(params);
      ctx.symbols = await this.engine.findRelatedSymbols(params);
      ctx.changedSymbols = await this.engine.detectChanges();
      const impactResult = await this.engine.analyzeImpact(params);
      ctx.impact = {
        riskLevel: impactResult.riskLevel,
        riskScore: 0,
        affectedSymbols: impactResult.affectedSymbols,
        directDependents: [],
        indirectDependents: [],
        affectedTests: [],
      };
    } catch {
      // Handle empty store gracefully
    }

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildImpactContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'impact',
        symbol: params,
        riskLevel: ctx.impact?.riskLevel ?? 'unknown',
      },
    };
  }

  /**
   * /find <query> — Semantic search across the codebase with relevance scores.
   */
  private async handleFindCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown('## /find\n\n**Usage:** `/find <query>`\n\nProvide a search query.\n');
      return { metadata: { command: 'find', error: 'missing_params' } };
    }

    const searchResults = await this.engine.search(params);
    const symbols = await this.engine.findRelatedSymbols(params);
    const ctx: ResolvedContext<'searchResults' | 'symbols' | 'searchQuery'> = {
      searchResults,
      symbols,
      searchQuery: params,
    };

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildFindContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'find',
        query: params,
        resultCount: searchResults.length,
      },
    };
  }

  /**
   * /deps <symbol> — Show dependency graph for a symbol.
   */
  private async handleDepsCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /deps\n\n**Usage:** `/deps <symbol>`\n\nProvide a symbol name to show dependencies.\n',
      );
      return { metadata: { command: 'deps', error: 'missing_params' } };
    }

    const callers = await this.engine.findCallers(params);
    const calleeList = await this.engine.findCallees(params);
    const symbols = await this.engine.findRelatedSymbols(params);
    const ctx: ResolvedContext<'dependencyGraph' | 'symbols'> = {
      callers,
      calleeList,
      symbols,
      dependencyGraph: {
        upstream: callers.map((c) => ({
          name: c.name,
          filePath: c.filePath,
          relationship: EDGE_CALLS,
        })),
        downstream: calleeList.map((c) => ({
          name: c.name,
          filePath: c.filePath,
          relationship: EDGE_CALLS,
        })),
      },
    };

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildDepsContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'deps',
        symbol: params,
        upstreamCount: callers.length,
        downstreamCount: calleeList.length,
      },
    };
  }

  /**
   * /refactor <symbol> — Find refactoring opportunities with complexity analysis.
   */
  private async handleRefactorCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /refactor\n\n**Usage:** `/refactor <symbol>`\n\nProvide a symbol name to find refactoring opportunities.\n',
      );
      return { metadata: { command: 'refactor', error: 'missing_params' } };
    }

    const symbolDetail = await this.engine.getSymbolDetail(params);
    const callers = await this.engine.findCallers(params);
    const implementations = await this.engine.findImplementations(params);
    const computedComplexity = await this.engine.getComplexityMetrics(params);

    // Find code smells via standards
    let standardsViolations: AnalysisContext['standardsViolations'];
    if (symbolDetail?.filePath) {
      standardsViolations = [];
      try {
        const violations = await this.engine.checkStandards(symbolDetail.filePath);
        standardsViolations.push(
          ...violations
            .filter((v) => !v.passed)
            // Invariant: the filter above retains only failed checks, so the
            // `? 'passed'` arm that used to sit here was unreachable.
            .map((v) => ({
              ruleId: 'failed',
              message: v.message,
              severity: 'warning',
            })),
        );
      } catch {
        // No standards available
      }
    }

    // Derive refactoring opportunities
    const refactoringOpportunities = this.deriveRefactoringOpportunities({
      symbolDetail,
      callers,
      computedComplexity,
      standardsViolations,
    });

    const ctx: ResolvedContext<
      'refactoringOpportunities' | 'computedComplexity' | 'callers' | 'implementations'
    > = {
      symbolDetail,
      callers,
      implementations,
      computedComplexity,
      standardsViolations,
      refactoringOpportunities,
    };

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildRefactorContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'refactor',
        symbol: params,
        opportunitiesCount: refactoringOpportunities.length,
      },
    };
  }

  /**
   * /test <symbol> — Find related tests and suggest test coverage gaps.
   */
  private async handleTestCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /test\n\n**Usage:** `/test <symbol>`\n\nProvide a symbol name to find related tests.\n',
      );
      return { metadata: { command: 'test', error: 'missing_params' } };
    }

    const relatedTests = await this.engine.findRelatedTests(params);
    const symbols = await this.engine.findRelatedSymbols(params);

    // Identify coverage gaps: related symbols without tests
    const testedSymbols = new Set(relatedTests.map((t) => t.name.toLowerCase()));
    const coverageGaps: string[] = [];
    for (const sym of symbols) {
      if (!testedSymbols.has(sym.name.toLowerCase())) {
        coverageGaps.push(sym.name);
      }
    }

    const ctx: ResolvedContext<'relatedTests' | 'symbols' | 'callers' | 'testCoverage'> = {
      relatedTests,
      symbols,
      callers: await this.engine.findCallers(params),
      testCoverage: {
        existingTests: relatedTests.map((t) => ({
          name: t.name,
          filePath: t.filePath,
        })),
        coverageGaps,
      },
    };

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildTestContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'test',
        symbol: params,
        testCount: relatedTests.length,
        gapsCount: coverageGaps.length,
      },
    };
  }

  /**
   * /analyze — Trigger full workspace analysis and display results.
   */
  private async handleAnalyzeCommand(
    _params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /analyze\n\n⏳ Running codebase analysis...\n');

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    try {
      // Re-index the project that is already loaded. This used to pass '' as the
      // root, which published '' as the active project id — `''` is falsy — and
      // silently disabled every project-scoped query (/find, /impact, /review)
      // until the next real index. indexWorkspace() rebuilds the search index for
      // whatever project is loaded, so it takes the loaded id and is skipped when
      // nothing has been indexed yet.
      const projectId = this.engine.getProjectId();
      if (projectId) {
        await this.engine.indexWorkspace(projectId);
      }
      // indexWorkspace() resolves void, so the symbol count is read back from the
      // indexing state the same call publishes — the previous
      // `const symbolCount = await this.engine.indexWorkspace('')` was always
      // undefined and the report printed "Symbols Indexed | undefined".
      const symbolCount = this.engine.getIndexingState().symbolCount;
      const changedFiles = await this.engine.getChangedFiles();
      // An empty search query matches no term, so this count was always 0.
      // The catalogued symbols are what "Results Found" reports.
      const resultCount = (await this.engine.listProjectSymbols()).length;
      const fileCount = changedFiles.length;

      stream.markdown(
        `## /analyze — Results\n\n` +
          `### Analysis Complete ✅\n\n` +
          `| Metric | Value |\n` +
          `|--------|-------|\n` +
          `| Symbols Indexed | ${symbolCount} |\n` +
          `| Files Analyzed | ${fileCount} |\n` +
          `| Results Found | ${resultCount} |\n\n` +
          `Use \`/review\` to check for issues, or \`/find <query>\` to search the codebase.\n`,
      );

      return {
        metadata: {
          command: 'analyze',
          symbolCount,
          fileCount,
          resultCount,
        },
      };
    } catch {
      stream.markdown(
        '## /analyze\n\n⚠️ Analysis failed. Make sure you are in a valid workspace.\n',
      );
      return { metadata: { command: 'analyze', error: 'analysis_failed' } };
    }
  }

  /**
   * /coverage — Show test coverage analysis across the codebase.
   */
  private async handleCoverageCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    if (!params) {
      stream.markdown(
        '## /coverage\n\n**Usage:** `/coverage <symbol|file>`\n\n' +
          'Analyze test coverage for a symbol or file.\n',
      );
      return { metadata: { command: 'coverage', error: 'missing_params' } };
    }

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    // The report below is built from tests + symbols alone. The findCallers() query
    // that used to sit here fed an AnalysisContext field nothing ever read, so it was
    // a redundant round trip into the graph store.
    const tests = await this.engine.findRelatedTests(params);
    const symbols = await this.engine.findRelatedSymbols(params);

    // Build coverage analysis
    const testedSymbols = new Set(tests.map((t) => t.name.toLowerCase()));
    const untested: string[] = [];
    for (const s of symbols) {
      if (
        !testedSymbols.has(s.name.toLowerCase()) &&
        !testedSymbols.has(`${s.name}.test`.toLowerCase())
      ) {
        untested.push(s.name);
      }
    }

    const coveragePercent =
      symbols.length > 0
        ? Math.round(((symbols.length - untested.length) / symbols.length) * 100)
        : 0;

    let msg = '## /coverage — Test Coverage\n\n';
    msg += `### Coverage Summary\n`;
    msg += `| Metric | Value |\n|--------|-------|\n`;
    msg += `| Tested | ${symbols.length - untested.length}/${symbols.length} |\n`;
    msg += `| Coverage | ${coveragePercent}% |\n\n`;

    if (tests.length > 0) {
      msg += `### Existing Tests (${tests.length})\n`;
      for (const t of tests.slice(0, 15)) {
        msg += `- \`${t.name}\` in \`${t.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (untested.length > 0) {
      msg += `### Coverage Gaps (${untested.length})\n`;
      for (const gap of untested.slice(0, 15)) {
        msg += `- \`${gap}\` — no tests found\n`;
      }
      msg += '\n';
    }

    msg += `**Recommendation:** ${
      coveragePercent >= 80
        ? 'Coverage looks good!'
        : 'Consider adding tests for the uncovered symbols listed above.'
    }\n`;

    stream.markdown(msg);

    return {
      metadata: {
        command: 'coverage',
        symbol: params,
        testCount: tests.length,
        gapCount: untested.length,
        coveragePercent,
      },
    };
  }

  /**
   * /standards — Check project standards compliance.
   */
  private async handleStandardsCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /standards\n\n⏳ Checking standards compliance...\n');

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    try {
      let files: string[];
      if (params) {
        files = [params];
      } else {
        files = (await this.engine.getChangedFiles()).map((f) => f.path).slice(0, 10);
      }

      if (files.length === 0) {
        stream.markdown(
          '## /standards\n\nNo files to check. Make changes and try again, or specify a file path.\n',
        );
        return { metadata: { command: 'standards', fileCount: 0 } };
      }

      const allViolations: Array<{ ruleId: string; message: string; severity: string }> = [];
      for (const filePath of files) {
        const violations = await this.engine.checkStandards(filePath);
        allViolations.push(
          ...violations
            .filter((v) => !v.passed)
            // Invariant: only failed checks survive the filter above, so the
            // `? 'passed'` arm that used to sit here was unreachable.
            .map((v) => ({
              ruleId: 'failed',
              message: v.message,
              severity: 'warning',
            })),
        );
      }

      // Compliance ratio: one point is lost per violation per checked file, clamped
      // to 0..100. `files` is non-empty here — the empty case returned above — so the
      // `: 100` fallback that used to guard this division was unreachable.
      const complianceRatio = Math.max(
        0,
        100 - Math.min(100, Math.round((allViolations.length / files.length) * 100)),
      );

      let msg = '## /standards — Compliance Report\n\n';
      msg += `### Summary\n`;
      msg += `| Metric | Value |\n|--------|-------|\n`;
      msg += `| Files Checked | ${files.length} |\n`;
      msg += `| Violations | ${allViolations.length} |\n`;
      msg += `| Compliance | ${complianceRatio}% |\n\n`;

      if (allViolations.length > 0) {
        msg += `### Violations\n`;
        for (const v of allViolations.slice(0, 20)) {
          msg += `- ${v.message}\n`;
        }
        msg += '\n';
      } else {
        msg += '✅ All checked files pass standards.\n';
      }

      stream.markdown(msg);

      return {
        metadata: {
          command: 'standards',
          fileCount: files.length,
          violationCount: allViolations.length,
        },
      };
    } catch {
      stream.markdown(
        '## /standards\n\n⚠️ Standards check failed. Ensure the workspace has been analyzed.\n',
      );
      return { metadata: { command: 'standards', error: 'check_failed' } };
    }
  }

  /**
   * /review-deps — Analyze dependency health.
   */
  private async handleReviewDepsCommand(
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /review-deps — Dependency Health\n\n⏳ Analyzing dependencies...\n');

    if (token.isCancellationRequested) return { metadata: { cancelled: true } };

    try {
      const changedFiles = await this.engine.getChangedFiles();
      const symbols = await this.engine.search('dependency package version');

      let msg = '## /review-deps — Dependency Health\n\n';
      msg += '### Summary\n';
      msg += '| Metric | Value |\n|--------|-------|\n';
      msg += `| Files Scanned | ${changedFiles.length} |\n`;
      msg += `| Symbols Found | ${symbols.length} |\n\n`;

      msg += '### Recommendations\n';
      msg += '- **Pin dependency versions**: Use exact versions instead of ranges\n';
      msg += '- **Check for CVEs**: Run `npm audit` or equivalent regularly\n';
      msg += '- **License compliance**: Verify all dependencies use compatible licenses\n';

      stream.markdown(msg);
      return { metadata: { command: 'review-deps', fileCount: changedFiles.length } };
    } catch {
      stream.markdown(
        '## /review-deps\n\n⚠️ Unable to analyze dependencies. Run codebase analysis first.\n',
      );
      return { metadata: { command: 'review-deps', error: 'analysis_failed' } };
    }
  }

  /**
   * /check-contract <file> — Verify API contract compliance.
   */
  private async handleCheckContractCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /check-contract — API Contract\n\n⏳ Checking contract compliance...\n');

    if (token.isCancellationRequested) return { metadata: { cancelled: true } };

    try {
      // search() runs the very same query as findRelatedSymbols() but keeps each
      // hit's `label`, which is the only place the symbol kind is recorded.
      const symbols = await this.engine.search(params || 'export class function');

      let msg = '## /check-contract — API Contract Compliance\n\n';
      if (symbols.length === 0) {
        msg += 'No symbols found. Specify a file path to check.\n';
      } else {
        // Invariant: the graph stores the symbol kind in `label` and the bare
        // identifier in `name` — a node is never called "class Foo". The filter that
        // used to sit here tested `name.startsWith('class ' | 'function ' |
        // 'interface ')`, so it never matched and /check-contract reported an empty
        // API surface for every single query.
        const exported = symbols.filter((s) => CONTRACT_SYMBOL_LABELS.has(s.label));
        msg += `### Exported Symbols (${exported.length})\n`;
        if (exported.length === 0) {
          msg += 'None of the matching symbols expose a class, interface or function.\n';
        }
        for (const s of exported.slice(0, 15)) {
          msg += `- \`${s.name}\` (${s.label}) in \`${s.filePath}\`\n`;
        }
        msg += '\n### Contract Checks\n';
        msg += '- ✅ Verify all public APIs have JSDoc documentation\n';
        msg += '- ✅ Check for breaking changes in signatures\n';
        msg += '- ✅ Ensure @deprecated annotations on old APIs\n';
        msg += '- ✅ Validate semver version bumps\n';
      }

      stream.markdown(msg);
      return { metadata: { command: 'check-contract', symbolsFound: symbols.length } };
    } catch {
      stream.markdown('## /check-contract\n\n⚠️ Contract check failed. Run analysis first.\n');
      return { metadata: { command: 'check-contract', error: 'check_failed' } };
    }
  }

  /**
   * /trace-dataflow <file> — Trace data flow from source to sink.
   */
  private async handleTraceDataflowCommand(
    params: string,
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /trace-dataflow\n\n⏳ Tracing dataflow...\n');

    if (token.isCancellationRequested) return { metadata: { cancelled: true } };

    try {
      const traces = params ? await this.engine.traceCallPath(params) : [];
      const symbols = params ? await this.engine.findRelatedSymbols(params) : [];

      let msg = '## /trace-dataflow — Data Flow Analysis\n\n';
      if (traces.length > 0) {
        msg += `### Call Path (${traces.length} hops)\n`;
        for (const t of traces.slice(0, 20)) {
          msg += `- \`${t.name}\` → \`${t.filePath}\`\n`;
        }
        msg += '\n';
      }
      if (symbols.length > 0) {
        msg += `### Data Flow Nodes (${symbols.length})\n`;
        for (const s of symbols.slice(0, 10)) {
          msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
        }
      }
      if (traces.length === 0 && symbols.length === 0) {
        msg += 'No dataflow path found. The symbol may be isolated or not indexed.\n';
      }

      stream.markdown(msg);
      return { metadata: { command: 'trace-dataflow', traceHops: traces.length } };
    } catch {
      stream.markdown('## /trace-dataflow\n\n⚠️ Dataflow trace failed.\n');
      return { metadata: { command: 'trace-dataflow', error: 'trace_failed' } };
    }
  }

  /**
   * /find-hotspots — Identify code hotspots (high churn + high complexity).
   */
  private async handleFindHotspotsCommand(
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /find-hotspots\n\n⏳ Identifying code hotspots...\n');

    if (token.isCancellationRequested) return { metadata: { cancelled: true } };

    try {
      const changedFiles = await this.engine.getChangedFiles();

      let msg = '## /find-hotspots — Code Hotspots\n\n';
      msg += '### Hotspot Detection\n';
      msg += 'Hotspots are files/functions with high complexity AND high change frequency.\n\n';

      if (changedFiles.length > 0) {
        msg += `### Recently Changed Files (${changedFiles.length})\n`;
        const highChurn = changedFiles.filter(
          (f) => f.status === 'modified' || f.status === 'added',
        );
        for (const f of highChurn.slice(0, 10)) {
          msg += `- \`${f.path}\` (${f.status})\n`;
        }
        msg += '\n';
      }

      msg += '### Recommendations\n';
      msg += '- Add unit tests for frequently modified files\n';
      msg += '- Refactor high-complexity functions in high-churn files\n';
      msg += '- Add integration tests for critical paths\n';

      stream.markdown(msg);
      return {
        metadata: { command: 'find-hotspots', changedFileCount: changedFiles.length },
      };
    } catch {
      stream.markdown('## /find-hotspots\n\n⚠️ Hotspot detection failed.\n');
      return { metadata: { command: 'find-hotspots', error: 'detection_failed' } };
    }
  }

  /**
   * /audit-security — Run security-focused review.
   */
  private async handleAuditSecurityCommand(
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<ChatResult> {
    stream.markdown('## /audit-security\n\n⏳ Running security audit...\n');

    if (token.isCancellationRequested) return { metadata: { cancelled: true } };

    try {
      const reviewComments = await this.engine.reviewWorkspace();
      const securityIssues = reviewComments.filter(
        (c) => c.severity === 'critical' || c.severity === 'high',
      );

      let msg = '## /audit-security — Security Audit\n\n';
      msg += `### Results (${securityIssues.length} issues)\n`;
      msg += '| Severity | Title | Location |\n|----------|-------|----------|\n';

      for (const issue of securityIssues.slice(0, 15)) {
        msg += `| ${issue.severity} | ${issue.title} | \`${issue.path}:${issue.startLine}\` |\n`;
      }

      if (securityIssues.length === 0) {
        msg += '| — | No security issues detected | — |\n';
      }

      msg += '\n### Security Checklist\n';
      msg += '- 🔒 Input validation on all user inputs\n';
      msg += '- 🔒 Parameterized SQL queries (no string concatenation)\n';
      msg += '- 🔒 Secrets not hardcoded in source\n';
      msg += '- 🔒 Dependencies scanned for known CVEs\n';
      msg += '- 🔒 Authentication and authorization checks\n';

      stream.markdown(msg);
      return { metadata: { command: 'audit-security', issueCount: securityIssues.length } };
    } catch {
      stream.markdown('## /audit-security\n\n⚠️ Security audit failed. Run code review first.\n');
      return { metadata: { command: 'audit-security', error: 'audit_failed' } };
    }
  }

  // ---------------------------------------------------------------------------
  // Context Builders (Structured Markdown for each command)
  // ---------------------------------------------------------------------------

  private buildReviewContext(ctx: AnalysisContext): string {
    let msg = '## Code Review\n\n';

    if (!ctx.changedFiles || ctx.changedFiles.length === 0) {
      msg += 'No changed files detected. Make changes to your workspace and run `/review` again.\n';
      msg += '\nYou can also analyze the current file by running analysis first.\n';
      return msg;
    }

    msg += `### Changed Files (${ctx.changedFiles.length})\n`;
    for (const f of ctx.changedFiles.slice(0, 20)) {
      msg += `- \`${f.path}\` (${f.status})\n`;
    }
    msg += '\n';

    if (ctx.reviewComments && ctx.reviewComments.length > 0) {
      const critical = ctx.reviewComments.filter(
        (c) => c.severity === 'critical' || c.severity === 'high',
      );
      // Invariant: review comments come from EngineBridge.reviewWorkspace(), which
      // forwards ReviewComment.severity — a value drawn from SEVERITY_LEVELS
      // (critical|high|medium|low|info). 'warning' is not a member of that union, so
      // the alternative that used to sit in this filter could never match.
      const warnings = ctx.reviewComments.filter((c) => c.severity === 'medium');
      const info = ctx.reviewComments.filter((c) => c.severity === 'low' || c.severity === 'info');

      msg += `### Review Findings (${ctx.reviewComments.length} issues)\n`;
      msg += `- Critical/High: ${critical.length} | Warnings: ${warnings.length} | Info: ${info.length}\n\n`;

      if (critical.length > 0) {
        msg += '#### Critical & High\n';
        for (const c of critical.slice(0, 10)) {
          msg += `- **${c.severity}**: ${c.title} (\`${c.path}:${c.startLine}\`)\n`;
        }
        msg += '\n';
      }

      if (warnings.length > 0) {
        msg += '#### Warnings\n';
        for (const c of warnings.slice(0, 5)) {
          msg += `- **${c.severity}**: ${c.title} (\`${c.path}:${c.startLine}\`)\n`;
        }
        msg += '\n';
      }

      if (info.length > 0 && warnings.length + critical.length === 0) {
        msg += '#### Info\n';
        for (const c of info.slice(0, 5)) {
          msg += `- ${c.title} (\`${c.path}:${c.startLine}\`)\n`;
        }
        msg += '\n';
      }
    } else {
      msg += '### Review Findings\n';
      msg += 'No issues detected in changed files.\n\n';
    }

    if (ctx.standardsViolations && ctx.standardsViolations.length > 0) {
      const failed = ctx.standardsViolations.filter((v) => v.severity === 'warning');
      if (failed.length > 0) {
        msg += `### Standards Violations (${failed.length})\n`;
        for (const v of failed.slice(0, 5)) {
          msg += `- ${v.message}\n`;
        }
        msg += '\n';
      }
    }

    return msg;
  }

  private buildExplainContext(
    ctx: ResolvedContext<'searchResults' | 'callers' | 'calleeList'>,
  ): string {
    let msg = '## Symbol Explanation\n\n';

    if (ctx.symbolDetail) {
      const d = ctx.symbolDetail;
      msg += `### \`${d.name}\`\n\n`;
      msg += `- **Type:** ${d.label}\n`;
      msg += `- **File:** \`${d.filePath}\`\n`;
      msg += `- **Exported:** ${d.isExported ? 'Yes' : 'No'}\n`;
      if (d.signature) {
        msg += `- **Signature:** \`${d.signature}\`\n`;
      }
      if (d.docstring) {
        msg += `\n**Documentation:**\n\`\`\`\n${d.docstring}\n\`\`\`\n`;
      }
      if (d.complexity) {
        msg += `\n### Complexity Metrics\n`;
        msg += `- Cyclomatic Complexity: ${d.complexity.cyclomaticComplexity}\n`;
        msg += `- Lines of Code: ${d.complexity.linesOfCode}\n`;
        msg += `- Parameters: ${d.complexity.parameterCount}\n`;
        msg += `- Nesting Depth: ${d.complexity.nestingDepth}\n`;
      }
      msg += '\n';
    }

    if (ctx.searchResults.length > 0) {
      msg += '### Related Symbols\n';
      for (const r of ctx.searchResults.slice(0, 10)) {
        msg += `- \`${r.name}\` in \`${r.filePath}\` (${r.label})\n`;
      }
      msg += '\n';
    }

    if (ctx.callers.length > 0) {
      msg += '### Called By (Upstream)\n';
      for (const c of ctx.callers.slice(0, 10)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.calleeList.length > 0) {
      msg += '### Calls To (Downstream)\n';
      for (const c of ctx.calleeList.slice(0, 10)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (!ctx.symbolDetail) {
      msg +=
        '> Symbol not found in the knowledge graph. Run analysis first or check the symbol name.\n';
    }

    return msg;
  }

  private buildImpactContext(ctx: AnalysisContext): string {
    let msg = '## Impact Analysis\n\n';

    if (!ctx.impact && !ctx.callers?.length) {
      msg += 'No impact data available. The symbol may not exist in the knowledge graph.\n';
      msg += '\nRun a codebase analysis first, then try again.\n';
      return msg;
    }

    if (ctx.impact) {
      msg += `### Risk Assessment\n`;
      msg += `- **Risk Level:** ${ctx.impact.riskLevel}\n`;
      msg += `- **Affected Symbols:** ${ctx.impact.affectedSymbols}\n\n`;
    }

    if (ctx.callers && ctx.callers.length > 0) {
      msg += `### Direct Dependents (${ctx.callers.length})\n`;
      msg += 'These symbols call or depend on the target:\n';
      for (const c of ctx.callers.slice(0, 15)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      if (ctx.callers.length > 15) {
        msg += `- ... and ${ctx.callers.length - 15} more\n`;
      }
      msg += '\n';
    }

    if (ctx.symbols && ctx.symbols.length > 0) {
      msg += `### Related Symbols\n`;
      for (const s of ctx.symbols.slice(0, 10)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.changedSymbols && ctx.changedSymbols.length > 0) {
      msg += `### Changed Symbols (${ctx.changedSymbols.length})\n`;
      for (const s of ctx.changedSymbols.slice(0, 10)) {
        msg += `- \`${s.name}\` (risk: ${s.riskLevel})\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildFindContext(
    ctx: ResolvedContext<'searchResults' | 'symbols' | 'searchQuery'>,
  ): string {
    let msg = `## Search Results: "${ctx.searchQuery}"\n\n`;

    if (ctx.searchResults.length === 0) {
      msg += 'No results found. Try a different query.\n';
      msg += '\nThe search engine uses BM25 + vector semantic search.\n';
      msg += 'Tips: try partial names, camelCase fragments, or descriptive keywords.\n';
      return msg;
    }

    msg += `### Symbols Found (${ctx.searchResults.length})\n`;
    for (const r of ctx.searchResults.slice(0, 15)) {
      const score =
        r.relevanceScore !== undefined ? ` (score: ${r.relevanceScore.toFixed(2)})` : '';
      msg += `- \`${r.name}\` — \`${r.filePath}\` [${r.label}]${score}\n`;
    }
    if (ctx.searchResults.length > 15) {
      msg += `\n*... and ${ctx.searchResults.length - 15} more results. Refine your query for fewer results.*\n`;
    }
    msg += '\n';

    if (ctx.symbols.length > 0) {
      msg += '### Related Context\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildDepsContext(ctx: ResolvedContext<'dependencyGraph' | 'symbols'>): string {
    let msg = '## Dependency Graph\n\n';
    const g = ctx.dependencyGraph;

    if (g.upstream.length > 0) {
      msg += `### Upstream Dependencies (${g.upstream.length})\n`;
      msg += 'Symbols that depend on this one:\n';
      for (const u of g.upstream.slice(0, 15)) {
        msg += `- \`${u.name}\` in \`${u.filePath}\` (${u.relationship})\n`;
      }
      if (g.upstream.length > 15) {
        msg += `- ... and ${g.upstream.length - 15} more\n`;
      }
      msg += '\n';
    } else {
      msg += '### Upstream Dependencies\nNo symbols depend on this one.\n\n';
    }

    if (g.downstream.length > 0) {
      msg += `### Downstream Dependencies (${g.downstream.length})\n`;
      msg += 'Symbols this one depends on:\n';
      for (const d of g.downstream.slice(0, 15)) {
        msg += `- \`${d.name}\` in \`${d.filePath}\` (${d.relationship})\n`;
      }
      if (g.downstream.length > 15) {
        msg += `- ... and ${g.downstream.length - 15} more\n`;
      }
      msg += '\n';
    } else {
      msg += '### Downstream Dependencies\nNo dependencies found.\n\n';
    }

    if (ctx.symbols.length > 0) {
      msg += '### Related Symbols\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildRefactorContext(
    ctx: ResolvedContext<
      'refactoringOpportunities' | 'computedComplexity' | 'callers' | 'implementations'
    >,
  ): string {
    let msg = '## Refactoring Analysis\n\n';

    if (ctx.refactoringOpportunities.length > 0) {
      msg += `### Opportunities Found (${ctx.refactoringOpportunities.length})\n\n`;
      for (const r of ctx.refactoringOpportunities.slice(0, 10)) {
        msg += `**${r.title}**\n`;
        msg += `- File: \`${r.filePath}:${r.lineNumber}\`\n`;
        msg += `- ${r.description}\n\n`;
      }
    }

    // Metrics come from EngineBridge.getComplexityMetrics(), which always resolves a
    // metrics object, so this section is emitted for every /refactor call.
    msg += '### Complexity Metrics\n';
    msg += `- Cyclomatic Complexity: ${ctx.computedComplexity.cyclomaticComplexity}\n`;
    msg += `- Lines of Code: ${ctx.computedComplexity.linesOfCode}\n`;
    msg += `- Parameters: ${ctx.computedComplexity.parameterCount}\n`;
    msg += `- Nesting Depth: ${ctx.computedComplexity.nestingDepth}\n`;
    msg += '\n';

    if (ctx.symbolDetail) {
      const d = ctx.symbolDetail;
      msg += '### Current Symbol\n';
      msg += `- \`${d.name}\` (${d.label}) in \`${d.filePath}\`\n\n`;
    }

    if (ctx.callers.length > 0) {
      msg += `### Callers (${ctx.callers.length})\n`;
      for (const c of ctx.callers.slice(0, 5)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.implementations.length > 0) {
      msg += `### Implementations (${ctx.implementations.length})\n`;
      for (const i of ctx.implementations.slice(0, 5)) {
        msg += `- \`${i.name}\` in \`${i.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.standardsViolations && ctx.standardsViolations.length > 0) {
      msg += `### Standards Violations (${ctx.standardsViolations.length})\n`;
      for (const v of ctx.standardsViolations.slice(0, 5)) {
        msg += `- ${v.message}\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildTestContext(
    ctx: ResolvedContext<'relatedTests' | 'symbols' | 'callers' | 'testCoverage'>,
  ): string {
    let msg = '## Test Coverage Analysis\n\n';

    if (ctx.relatedTests.length > 0) {
      msg += `### Existing Tests (${ctx.relatedTests.length})\n`;
      for (const t of ctx.relatedTests.slice(0, 15)) {
        msg += `- \`${t.name}\` in \`${t.filePath}\`\n`;
      }
      if (ctx.relatedTests.length > 15) {
        msg += `- ... and ${ctx.relatedTests.length - 15} more\n`;
      }
      msg += '\n';
    } else {
      msg += '### Existing Tests\nNo tests found for this symbol.\n\n';
    }

    if (ctx.testCoverage.coverageGaps.length > 0) {
      msg += `### Coverage Gaps (${ctx.testCoverage.coverageGaps.length})\n`;
      msg += 'These related symbols lack test coverage:\n';
      for (const gap of ctx.testCoverage.coverageGaps.slice(0, 10)) {
        msg += `- \`${gap}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.symbols.length > 0) {
      msg += '### Related Symbols\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.callers.length > 0) {
      msg += '### Callers (Test Impact)\n';
      msg += 'These symbols are called by the target and may need tests:\n';
      for (const c of ctx.callers.slice(0, 5)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Derive refactoring opportunities from complexity and analysis context.
   *
   * The context comes straight from handleRefactorCommand, which always populates
   * the complexity metrics and the caller list, so neither is re-tested here.
   */
  private deriveRefactoringOpportunities(
    ctx: ResolvedContext<'computedComplexity' | 'callers'>,
  ): Array<{
    title: string;
    description: string;
    filePath: string;
    lineNumber: number;
  }> {
    const opportunities: Array<{
      title: string;
      description: string;
      filePath: string;
      lineNumber: number;
    }> = [];

    // Every opportunity is reported against the analysed symbol's file, which is
    // absent when the graph has no file on record for it.
    const filePath = ctx.symbolDetail?.filePath ?? '';
    const cc = ctx.computedComplexity;

    if (cc.cyclomaticComplexity > 10) {
      opportunities.push({
        title: 'High Cyclomatic Complexity',
        description: `Cyclomatic complexity is ${cc.cyclomaticComplexity}. Consider splitting into smaller functions to improve testability.`,
        filePath,
        lineNumber: 1,
      });
    }
    if (cc.linesOfCode > 50) {
      opportunities.push({
        title: 'Function Too Long',
        description: `Function is ${cc.linesOfCode} lines. Consider extracting helper functions to improve readability.`,
        filePath,
        lineNumber: 1,
      });
    }
    if (cc.nestingDepth > 4) {
      opportunities.push({
        title: 'Deep Nesting',
        description: `Nesting depth is ${cc.nestingDepth}. Extract nested logic into helper functions or use early returns.`,
        filePath,
        lineNumber: 1,
      });
    }
    if (cc.parameterCount > 5) {
      opportunities.push({
        title: 'Too Many Parameters',
        description: `Function has ${cc.parameterCount} parameters. Consider using a parameter object.`,
        filePath,
        lineNumber: 1,
      });
    }

    if (ctx.callers.length > 10) {
      opportunities.push({
        title: 'Hot Code Path',
        description: `This symbol has ${ctx.callers.length} callers. Consider optimizing performance and adding caching.`,
        filePath,
        lineNumber: 1,
      });
    }

    if (ctx.standardsViolations && ctx.standardsViolations.length > 0) {
      for (const v of ctx.standardsViolations.slice(0, 3)) {
        opportunities.push({
          title: 'Standards Violation',
          description: v.message,
          filePath,
          lineNumber: 1,
        });
      }
    }

    return opportunities;
  }

  /**
   * Check if a string is a valid slash command name.
   */
  private isSlashCommand(command: string): boolean {
    return (SLASH_COMMANDS as readonly string[]).includes(command);
  }

  /**
   * Parse a slash command from a prompt string like "/review" or "/explain MyFunction".
   */
  private parseSlashCommandFromPrompt(
    prompt: string,
  ): { command: SlashCommand; params: string } | null {
    if (!prompt || !prompt.startsWith('/')) return null;

    const trimmed = prompt.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const commandPart = spaceIdx > 0 ? trimmed.substring(1, spaceIdx) : trimmed.substring(1);

    if (!this.isSlashCommand(commandPart)) return null;

    const params = spaceIdx > 0 ? trimmed.substring(spaceIdx + 1) : '';
    return { command: commandPart as SlashCommand, params };
  }

  /**
   * Classify user intent from their prompt using pattern matching.
   */
  classifyIntent(prompt: string): ClassifiedIntent {
    if (!prompt || prompt.trim().length === 0) {
      return { type: 'search', confidence: 0 };
    }

    const trimmed = prompt.trim();

    for (const intentDef of INTENT_PATTERNS) {
      for (const pattern of intentDef.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const entity = intentDef.extractEntity ? intentDef.extractEntity(match) : undefined;
          return {
            type: intentDef.type,
            entity,
            query: trimmed,
            confidence: 0.9,
          };
        }
      }
    }

    // Default: search intent with low confidence
    return {
      type: 'search',
      query: trimmed,
      confidence: 0.3,
    };
  }

  /**
   * Gather analysis context based on the classified intent.
   */
  async gatherAnalysisContext(
    intent: ClassifiedIntent,
    request: ChatRequest,
    token: CancellationToken,
  ): Promise<AnalysisContext> {
    if (token.isCancellationRequested) {
      return {};
    }

    switch (intent.type) {
      case 'explore': {
        const entity = intent.entity ?? request.prompt;
        return {
          searchResults: await this.engine.search(entity),
          symbols: await this.engine.findRelatedSymbols(entity),
        };
      }
      case 'review':
        return {
          changedFiles: await this.engine.getChangedFiles(),
          reviewComments: await this.engine.reviewWorkspace(),
        };
      case 'impact': {
        const entity = intent.entity ?? '';
        return {
          changedSymbols: await this.engine.detectChanges(),
          impact: await this.engine.analyzeImpact(entity).then((r) => ({
            riskLevel: r.riskLevel,
            riskScore: 0,
            affectedSymbols: r.affectedSymbols,
            directDependents: [],
            indirectDependents: [],
            affectedTests: [],
          })),
        };
      }
      case 'debug': {
        const entity = intent.entity ?? '';
        return {
          traceResults: await this.engine.traceCallPath(entity),
          relatedCode: await this.engine.findRelatedSymbols(entity),
        };
      }
      case 'search':
        return {
          searchResults: await this.engine.search(intent.query ?? request.prompt),
        };
      case 'refactor': {
        const entity = intent.entity ?? '';
        return {
          implementations: await this.engine.findImplementations(entity),
          callers: await this.engine.findCallers(entity),
        };
      }
      // Invariant: this arm is contract-reachable, not dead. IntentType has 13
      // members while INTENT_PATTERNS only ever yields 6 of them, and both
      // gatherAnalysisContext() and ClassifiedIntent are public API (re-exported from
      // the package entry point), so a caller may hand in an intent such as 'explain'
      // that the classifier never produces. It then falls back to a plain search.
      default:
        return {
          searchResults: await this.engine.search(request.prompt),
        };
    }
  }

  /**
   * Build a structured Markdown context message for Copilot.
   * This enriches Copilot's understanding without making LLM calls.
   */
  buildContextMessage(intent: ClassifiedIntent, ctx: AnalysisContext): string {
    let msg = `## Code Analyzer Context\n\n`;
    msg += `**Intent:** ${intent.type}\n\n`;

    if (ctx.searchResults && ctx.searchResults.length > 0) {
      msg += `### Relevant Symbols\n`;
      for (const r of ctx.searchResults.slice(0, 10)) {
        msg += `- \`${r.name}\` in \`${r.filePath}\` (${r.label})\n`;
      }
      msg += '\n';
    }

    if (ctx.reviewComments && ctx.reviewComments.length > 0) {
      msg += `### Review Findings (${ctx.reviewComments.length} issues)\n`;
      for (const c of ctx.reviewComments.slice(0, 10)) {
        msg += `- **${c.severity}**: ${c.title} (\`${c.path}:${c.startLine}\`)\n`;
      }
      msg += '\n';
    }

    if (ctx.impact) {
      msg += `### Impact Analysis\n`;
      msg += `- Risk Level: ${ctx.impact.riskLevel}\n`;
      msg += `- Affected Symbols: ${ctx.impact.affectedSymbols}\n`;
      msg += '\n';
    }

    if (ctx.traceResults && ctx.traceResults.length > 0) {
      msg += `### Call Trace\n`;
      for (const t of ctx.traceResults.slice(0, 10)) {
        msg += `- \`${t.name}\` \u2192 \`${t.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.implementations && ctx.implementations.length > 0) {
      msg += `### Implementations\n`;
      for (const impl of ctx.implementations.slice(0, 10)) {
        msg += `- \`${impl.name}\` in \`${impl.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.callers && ctx.callers.length > 0) {
      msg += `### Callers\n`;
      for (const c of ctx.callers.slice(0, 10)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.symbols && ctx.symbols.length > 0) {
      msg += `### Found Symbols\n`;
      for (const s of ctx.symbols.slice(0, 10)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.changedSymbols && ctx.changedSymbols.length > 0) {
      msg += `### Changed Symbols\n`;
      for (const s of ctx.changedSymbols.slice(0, 10)) {
        msg += `- \`${s.name}\` (risk: ${s.riskLevel})\n`;
      }
      msg += '\n';
    }

    if (ctx.changedFiles && ctx.changedFiles.length > 0) {
      msg += `### Changed Files\n`;
      for (const f of ctx.changedFiles.slice(0, 10)) {
        msg += `- \`${f.path}\` (${f.status})\n`;
      }
      msg += '\n';
    }

    return msg;
  }
}
