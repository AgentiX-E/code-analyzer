// @code-analyzer/vscode — Code Analyzer Chat Participant
// The @code-analyzer Copilot Chat participant. Classifies user intent,
// invokes analyzer tools to gather context, and enriches the chat stream.
// Supports 7 slash commands for structured analysis workflows.

import type { EngineBridge } from '../services/engine-bridge.js';

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
  | 'test';

export const SLASH_COMMANDS = [
  'review',
  'explain',
  'impact',
  'find',
  'deps',
  'refactor',
  'test',
] as const;

// ---------------------------------------------------------------------------
// Intent Classification
// ---------------------------------------------------------------------------

export type IntentType = 'explore' | 'search' | 'review' | 'impact' | 'debug' | 'refactor'
  | 'explain' | 'find' | 'deps' | 'test';

export interface ClassifiedIntent {
  type: IntentType;
  entity?: string;
  query?: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Analysis Context
// ---------------------------------------------------------------------------

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
      return this.handleSlashCommand(
        parsedCommand.command,
        parsedCommand.params,
        stream,
        token,
      );
    }

    // 1. Classify user intent
    const intent = this.classifyIntent(request.prompt);

    // 2. Gather enriched context via analyzer tools
    const analysisContext = await this.gatherAnalysisContext(
      intent,
      request,
      token,
    );

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
      default:
        stream.markdown('## Unknown Command\n\nCommand not recognized. Available commands:\n- `/review`\n- `/explain <symbol>`\n- `/impact <symbol>`\n- `/find <query>`\n- `/deps <symbol>`\n- `/refactor <symbol>`\n- `/test <symbol>`\n');
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
      ctx.changedFiles = await this.engine.getChangedFiles();
      ctx.reviewComments = await this.engine.reviewWorkspace();

      // Also gather standards violations
      const files = ctx.changedFiles ?? [];
      ctx.standardsViolations = [];
      for (const f of files.slice(0, 5)) {
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
      stream.markdown('## /explain\n\n**Usage:** `/explain <symbol>`\n\nProvide a symbol name to explain.\n');
      return { metadata: { command: 'explain', error: 'missing_params' } };
    }

    const ctx: AnalysisContext = {};
    ctx.symbolDetail = await this.engine.getSymbolDetail(params);
    ctx.searchResults = await this.engine.search(params);
    ctx.callers = await this.engine.findCallers(params);
    ctx.calleeList = await this.engine.findCallees(params);

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
      stream.markdown('## /impact\n\n**Usage:** `/impact <symbol>`\n\nProvide a symbol name to analyze impact.\n');
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

    const ctx: AnalysisContext = {};
    ctx.searchResults = await this.engine.search(params);
    ctx.searchQuery = params;
    ctx.symbols = await this.engine.findRelatedSymbols(params);

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildFindContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'find',
        query: params,
        resultCount: ctx.searchResults?.length ?? 0,
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
      stream.markdown('## /deps\n\n**Usage:** `/deps <symbol>`\n\nProvide a symbol name to show dependencies.\n');
      return { metadata: { command: 'deps', error: 'missing_params' } };
    }

    const ctx: AnalysisContext = {};
    ctx.callers = await this.engine.findCallers(params);
    ctx.calleeList = await this.engine.findCallees(params);
    ctx.symbols = await this.engine.findRelatedSymbols(params);
    ctx.dependencyGraph = {
      upstream: (ctx.callers ?? []).map((c) => ({
        name: c.name,
        filePath: c.filePath,
        relationship: 'CALLS',
      })),
      downstream: (ctx.calleeList ?? []).map((c) => ({
        name: c.name,
        filePath: c.filePath,
        relationship: 'CALLS',
      })),
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
        upstreamCount: ctx.dependencyGraph.upstream.length,
        downstreamCount: ctx.dependencyGraph.downstream.length,
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
      stream.markdown('## /refactor\n\n**Usage:** `/refactor <symbol>`\n\nProvide a symbol name to find refactoring opportunities.\n');
      return { metadata: { command: 'refactor', error: 'missing_params' } };
    }

    const ctx: AnalysisContext = {};
    ctx.symbolDetail = await this.engine.getSymbolDetail(params);
    ctx.callers = await this.engine.findCallers(params);
    ctx.implementations = await this.engine.findImplementations(params);
    ctx.computedComplexity = await this.engine.getComplexityMetrics(params);

    // Find code smells via standards
    if (ctx.symbolDetail?.filePath) {
      ctx.standardsViolations = [];
      try {
        const violations = await this.engine.checkStandards(ctx.symbolDetail.filePath);
        ctx.standardsViolations = violations
          .filter((v) => !v.passed)
          .map((v) => ({ ruleId: v.passed ? 'passed' : 'failed', message: v.message, severity: 'warning' }));
      } catch {
        // No standards available
      }
    }

    // Derive refactoring opportunities
    ctx.refactoringOpportunities = this.deriveRefactoringOpportunities(ctx);

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildRefactorContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'refactor',
        symbol: params,
        opportunitiesCount: ctx.refactoringOpportunities?.length ?? 0,
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
      stream.markdown('## /test\n\n**Usage:** `/test <symbol>`\n\nProvide a symbol name to find related tests.\n');
      return { metadata: { command: 'test', error: 'missing_params' } };
    }

    const ctx: AnalysisContext = {};
    ctx.relatedTests = await this.engine.findRelatedTests(params);
    ctx.symbols = await this.engine.findRelatedSymbols(params);
    ctx.callers = await this.engine.findCallers(params);

    // Analyze test coverage gaps
    ctx.testCoverage = {
      existingTests: (ctx.relatedTests ?? []).map((t) => ({
        name: t.name,
        filePath: t.filePath,
      })),
      coverageGaps: [],
    };

    // Identify coverage gaps: related symbols without tests
    const testedSymbols = new Set(
      (ctx.relatedTests ?? []).map((t) => t.name.toLowerCase()),
    );
    for (const sym of ctx.symbols ?? []) {
      if (!testedSymbols.has(sym.name.toLowerCase())) {
        ctx.testCoverage.coverageGaps.push(sym.name);
      }
    }

    if (token.isCancellationRequested) {
      return { metadata: { cancelled: true } };
    }

    const message = this.buildTestContext(ctx);
    stream.markdown(message);

    return {
      metadata: {
        command: 'test',
        symbol: params,
        testCount: ctx.relatedTests?.length ?? 0,
        gapsCount: ctx.testCoverage.coverageGaps.length,
      },
    };
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
      const critical = ctx.reviewComments.filter((c) => c.severity === 'critical' || c.severity === 'high');
      const warnings = ctx.reviewComments.filter((c) => c.severity === 'medium' || c.severity === 'warning');
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

  private buildExplainContext(ctx: AnalysisContext): string {
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

    if (ctx.searchResults && ctx.searchResults.length > 0) {
      msg += '### Related Symbols\n';
      for (const r of ctx.searchResults.slice(0, 10)) {
        msg += `- \`${r.name}\` in \`${r.filePath}\` (${r.label})\n`;
      }
      msg += '\n';
    }

    if (ctx.callers && ctx.callers.length > 0) {
      msg += '### Called By (Upstream)\n';
      for (const c of ctx.callers.slice(0, 10)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.calleeList && ctx.calleeList.length > 0) {
      msg += '### Calls To (Downstream)\n';
      for (const c of ctx.calleeList.slice(0, 10)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (!ctx.symbolDetail) {
      msg += '> Symbol not found in the knowledge graph. Run analysis first or check the symbol name.\n';
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

  private buildFindContext(ctx: AnalysisContext): string {
    let msg = `## Search Results: "${ctx.searchQuery ?? ''}"\n\n`;

    if (!ctx.searchResults || ctx.searchResults.length === 0) {
      msg += 'No results found. Try a different query.\n';
      msg += '\nThe search engine uses BM25 + vector semantic search.\n';
      msg += 'Tips: try partial names, camelCase fragments, or descriptive keywords.\n';
      return msg;
    }

    msg += `### Symbols Found (${ctx.searchResults.length})\n`;
    for (const r of ctx.searchResults.slice(0, 15)) {
      const score = r.relevanceScore !== undefined
        ? ` (score: ${r.relevanceScore.toFixed(2)})`
        : '';
      msg += `- \`${r.name}\` — \`${r.filePath}\` [${r.label}]${score}\n`;
    }
    if (ctx.searchResults.length > 15) {
      msg += `\n*... and ${ctx.searchResults.length - 15} more results. Refine your query for fewer results.*\n`;
    }
    msg += '\n';

    if (ctx.symbols && ctx.symbols.length > 0) {
      msg += '### Related Context\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildDepsContext(ctx: AnalysisContext): string {
    let msg = '## Dependency Graph\n\n';

    if (ctx.dependencyGraph) {
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
    } else {
      msg += 'No dependency data available. The symbol may not exist in the knowledge graph.\n\n';
    }

    if (ctx.symbols && ctx.symbols.length > 0) {
      msg += '### Related Symbols\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private buildRefactorContext(ctx: AnalysisContext): string {
    let msg = '## Refactoring Analysis\n\n';

    if (ctx.refactoringOpportunities && ctx.refactoringOpportunities.length > 0) {
      msg += `### Opportunities Found (${ctx.refactoringOpportunities.length})\n\n`;
      for (const r of ctx.refactoringOpportunities.slice(0, 10)) {
        msg += `**${r.title}**\n`;
        msg += `- File: \`${r.filePath}:${r.lineNumber}\`\n`;
        msg += `- ${r.description}\n\n`;
      }
    }

    if (ctx.computedComplexity) {
      msg += '### Complexity Metrics\n';
      msg += `- Cyclomatic Complexity: ${ctx.computedComplexity.cyclomaticComplexity}\n`;
      msg += `- Lines of Code: ${ctx.computedComplexity.linesOfCode}\n`;
      msg += `- Parameters: ${ctx.computedComplexity.parameterCount}\n`;
      msg += `- Nesting Depth: ${ctx.computedComplexity.nestingDepth}\n`;
      msg += '\n';
    }

    if (ctx.symbolDetail) {
      const d = ctx.symbolDetail;
      msg += '### Current Symbol\n';
      msg += `- \`${d.name}\` (${d.label}) in \`${d.filePath}\`\n\n`;
    }

    if (ctx.callers && ctx.callers.length > 0) {
      msg += `### Callers (${ctx.callers.length})\n`;
      for (const c of ctx.callers.slice(0, 5)) {
        msg += `- \`${c.name}\` in \`${c.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.implementations && ctx.implementations.length > 0) {
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

    if (
      !ctx.refactoringOpportunities?.length &&
      !ctx.computedComplexity &&
      !ctx.symbolDetail
    ) {
      msg += 'No analysis data available. The symbol may not exist in the knowledge graph.\n';
    }

    return msg;
  }

  private buildTestContext(ctx: AnalysisContext): string {
    let msg = '## Test Coverage Analysis\n\n';

    if (ctx.relatedTests && ctx.relatedTests.length > 0) {
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

    if (ctx.testCoverage && ctx.testCoverage.coverageGaps.length > 0) {
      msg += `### Coverage Gaps (${ctx.testCoverage.coverageGaps.length})\n`;
      msg += 'These related symbols lack test coverage:\n';
      for (const gap of ctx.testCoverage.coverageGaps.slice(0, 10)) {
        msg += `- \`${gap}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.symbols && ctx.symbols.length > 0) {
      msg += '### Related Symbols\n';
      for (const s of ctx.symbols.slice(0, 5)) {
        msg += `- \`${s.name}\` in \`${s.filePath}\`\n`;
      }
      msg += '\n';
    }

    if (ctx.callers && ctx.callers.length > 0) {
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
   */
  private deriveRefactoringOpportunities(
    ctx: AnalysisContext,
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

    if (ctx.computedComplexity) {
      const cc = ctx.computedComplexity;
      if (cc.cyclomaticComplexity > 10) {
        opportunities.push({
          title: 'High Cyclomatic Complexity',
          description: `Cyclomatic complexity is ${cc.cyclomaticComplexity}. Consider splitting into smaller functions to improve testability.`,
          filePath: ctx.symbolDetail?.filePath ?? '',
          lineNumber: 1,
        });
      }
      if (cc.linesOfCode > 50) {
        opportunities.push({
          title: 'Function Too Long',
          description: `Function is ${cc.linesOfCode} lines. Consider extracting helper functions to improve readability.`,
          filePath: ctx.symbolDetail?.filePath ?? '',
          lineNumber: 1,
        });
      }
      if (cc.nestingDepth > 4) {
        opportunities.push({
          title: 'Deep Nesting',
          description: `Nesting depth is ${cc.nestingDepth}. Extract nested logic into helper functions or use early returns.`,
          filePath: ctx.symbolDetail?.filePath ?? '',
          lineNumber: 1,
        });
      }
      if (cc.parameterCount > 5) {
        opportunities.push({
          title: 'Too Many Parameters',
          description: `Function has ${cc.parameterCount} parameters. Consider using a parameter object.`,
          filePath: ctx.symbolDetail?.filePath ?? '',
          lineNumber: 1,
        });
      }
    }

    if (ctx.callers && ctx.callers.length > 10) {
      opportunities.push({
        title: 'Hot Code Path',
        description: `This symbol has ${ctx.callers.length} callers. Consider optimizing performance and adding caching.`,
        filePath: ctx.symbolDetail?.filePath ?? '',
        lineNumber: 1,
      });
    }

    if (ctx.standardsViolations && ctx.standardsViolations.length > 0) {
      for (const v of ctx.standardsViolations.slice(0, 3)) {
        opportunities.push({
          title: 'Standards Violation',
          description: v.message,
          filePath: ctx.symbolDetail?.filePath ?? '',
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
    const commandPart = spaceIdx > 0
      ? trimmed.substring(1, spaceIdx)
      : trimmed.substring(1);

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
          const entity = intentDef.extractEntity
            ? intentDef.extractEntity(match)
            : undefined;
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
          searchResults: await this.engine.search(
            intent.query ?? request.prompt,
          ),
        };
      case 'refactor': {
        const entity = intent.entity ?? '';
        return {
          implementations: await this.engine.findImplementations(entity),
          callers: await this.engine.findCallers(entity),
        };
      }
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
  buildContextMessage(
    intent: ClassifiedIntent,
    ctx: AnalysisContext,
  ): string {
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
