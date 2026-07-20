// @code-analyzer/vscode — Code Analyzer Chat Participant
// The @code-analyzer Copilot Chat participant. Classifies user intent,
// invokes analyzer tools to gather context, and enriches the chat stream.

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
// Intent Classification
// ---------------------------------------------------------------------------

export type IntentType = 'explore' | 'search' | 'review' | 'impact' | 'debug' | 'refactor';

export interface ClassifiedIntent {
  type: IntentType;
  entity?: string;
  query?: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Analysis Context
// ---------------------------------------------------------------------------

export interface AnalysisContext {
  searchResults?: Array<{ name: string; filePath: string; label: string }>;
  changedFiles?: Array<{ path: string; status: string }>;
  reviewComments?: Array<{
    severity: string;
    title: string;
    path: string;
    startLine: number;
  }>;
  changedSymbols?: Array<{ name: string; riskLevel: string }>;
  impact?: { riskLevel: string; affectedSymbols: number };
  traceResults?: Array<{ name: string; filePath: string }>;
  implementations?: Array<{ name: string; filePath: string }>;
  callers?: Array<{ name: string; filePath: string }>;
  relatedCode?: Array<{ name: string; filePath: string }>;
  symbols?: Array<{ name: string; filePath: string }>;
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
   * Classifies intent, invokes analyzer tools, enriches context.
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
          impact: await this.engine.analyzeImpact(entity),
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
