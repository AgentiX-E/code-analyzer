// @code-analyzer/mcp — MCP Prompts
// 5 reusable prompts with graph-backed context resolution for the MCP server.
// PromptProvider resolves arguments against the InMemoryGraphStore to produce
// structured LLM messages with relevant code context embedded.

import type { PromptDefinition } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Prompt Message Types
// ---------------------------------------------------------------------------

export interface PromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: {
    type: 'text';
    text: string;
  };
}

export interface PromptResult {
  messages: PromptMessage[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Prompt Definitions (static list)
// ---------------------------------------------------------------------------

const PROMPT_DEFINITIONS: PromptDefinition[] = [
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

/** Register all 5 MCP prompts (backward compatible static list). */
export function registerPrompts(): PromptDefinition[] {
  return [...PROMPT_DEFINITIONS];
}

// ---------------------------------------------------------------------------
// PromptProvider
// ---------------------------------------------------------------------------

export class PromptProvider {
  private store: InMemoryGraphStore;
  private promptHandlers: Map<string, (args: Record<string, unknown>) => Promise<PromptResult>>;

  constructor(store: InMemoryGraphStore) {
    this.store = store;
    this.promptHandlers = this.buildHandlerMap();
  }

  /** List all prompt definitions. */
  listPrompts(): PromptDefinition[] {
    return [...PROMPT_DEFINITIONS];
  }

  /** Get a single prompt definition by name. */
  getDefinition(name: string): PromptDefinition | undefined {
    return PROMPT_DEFINITIONS.find((p) => p.name === name);
  }

  /** Resolve a prompt by name with arguments, producing LLM messages. */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<PromptResult> {
    const handler = this.promptHandlers.get(name);
    if (!handler) {
      throw new Error(`Prompt not found: ${name}`);
    }

    return handler(args ?? {});
  }

  // -------------------------------------------------------------------------
  // Handler Registry
  // -------------------------------------------------------------------------

  private buildHandlerMap(): Map<string, (args: Record<string, unknown>) => Promise<PromptResult>> {
    const map = new Map<string, (args: Record<string, unknown>) => Promise<PromptResult>>();

    map.set('explore-codebase', (args) => this.exploreCodebase(args));
    map.set('review-changes', (args) => this.reviewChanges(args));
    map.set('debug-issue', (args) => this.debugIssue(args));
    map.set('refactor-plan', (args) => this.refactorPlan(args));
    map.set('architecture-review', (args) => this.architectureReview(args));

    return map;
  }

  // -------------------------------------------------------------------------
  // Prompt: explore-codebase
  // -------------------------------------------------------------------------

  private async exploreCodebase(args: Record<string, unknown>): Promise<PromptResult> {
    const projectId = args['projectId'] as string;
    const focus = (args['focus'] as string) ?? '';
    const depth = (args['depth'] as string) ?? 'shallow';

    // Gather context from graph
    const graphSummary = this.buildGraphSummary(projectId);
    const topLevelSymbols = this.getTopLevelSymbols(projectId, 20);
    const entrypoints = this.getEntrypointContext(projectId);

    const focusInstruction = focus
      ? `Focus specifically on the ${focus} area of the codebase.`
      : 'Provide a broad overview of the entire codebase.';

    const depthInstruction = depth === 'deep'
      ? 'Perform a deep analysis — trace dependencies, identify patterns, and understand the architecture in detail.'
      : 'Provide a high-level overview — identify the main components and their relationships.';

    const systemPrompt = `You are an expert software engineer analyzing an unfamiliar codebase.
Your task is to help a developer understand the codebase structure, patterns, and key components.
Be thorough, organized, and actionable. Use a structured format with sections.`;

    const userMessage = `## Codebase Exploration: ${projectId}

${focusInstruction}
${depthInstruction}

### Project Statistics
${graphSummary}

### Top-Level Symbols
${topLevelSymbols}

### Entry Points
${entrypoints}

Please provide:
1. A high-level architecture overview
2. Key components and their responsibilities
3. Important patterns and conventions observed
4. Potential areas that need attention or improvement
5. A recommended exploration path for new developers`;

    return {
      messages: [
        { role: 'system', content: { type: 'text', text: systemPrompt } },
        { role: 'user', content: { type: 'text', text: userMessage } },
      ],
      description: `Codebase exploration prompt for project "${projectId}"`,
    };
  }

  // -------------------------------------------------------------------------
  // Prompt: review-changes
  // -------------------------------------------------------------------------

  private async reviewChanges(args: Record<string, unknown>): Promise<PromptResult> {
    const projectId = args['projectId'] as string;
    const fromRef = args['fromRef'] as string;
    const toRef = (args['toRef'] as string) ?? 'HEAD';
    const focus = (args['focus'] as string) ?? 'all';

    const graphSummary = this.buildGraphSummary(projectId);

    const focusAreas: Record<string, string> = {
      security: 'Focus on security vulnerabilities: injection risks, authentication bypass, sensitive data exposure, insecure dependencies.',
      performance: 'Focus on performance: algorithmic complexity, memory leaks, unnecessary allocations, blocking operations.',
      style: 'Focus on code style and maintainability: naming conventions, code organization, DRY violations, readability.',
      all: 'Conduct a comprehensive review covering security, performance, style, and correctness.',
    };

    const focusInstruction = focusAreas[focus] ?? focusAreas['all'] ?? focusAreas['all'];

    const systemPrompt = `You are a senior code reviewer. Analyze code changes thoroughly and provide actionable feedback.
Categorize issues by severity (critical, high, medium, low). For each issue, explain:
1. What the problem is
2. Why it matters
3. How to fix it (with code examples if helpful)`;

    const userMessage = `## Code Review: ${projectId}

**Change Range**: ${fromRef} → ${toRef}
**Focus**: ${focus}

${focusInstruction}

### Project Context
${graphSummary}

Please review the changes and provide:
1. Summary of changes
2. Issues found (grouped by severity)
3. Suggestions for improvement
4. Overall assessment (approved / changes requested)`;

    return {
      messages: [
        { role: 'system', content: { type: 'text', text: systemPrompt } },
        { role: 'user', content: { type: 'text', text: userMessage } },
      ],
      description: `Code review prompt for project "${projectId}" (${fromRef} → ${toRef})`,
    };
  }

  // -------------------------------------------------------------------------
  // Prompt: debug-issue
  // -------------------------------------------------------------------------

  private async debugIssue(args: Record<string, unknown>): Promise<PromptResult> {
    const projectId = args['projectId'] as string;
    const entryPoint = args['entryPoint'] as string;
    const symptom = args['symptom'] as string;

    const graphSummary = this.buildGraphSummary(projectId);
    const callChain = this.traceCallChain(entryPoint);
    const relatedSymbols = this.findRelatedSymbols(entryPoint, 10);

    const systemPrompt = `You are an expert debugger. Follow a systematic debugging approach:
1. Understand the symptom
2. Trace the execution path from the entry point
3. Identify potential failure points
4. Propose targeted investigation steps
5. Suggest fixes with reasoning`;

    const userMessage = `## Debug Issue: ${projectId}

**Symptom**: ${symptom}
**Entry Point**: ${entryPoint}

### Call Chain from Entry Point
${callChain}

### Related Symbols
${relatedSymbols}

### Project Context
${graphSummary}

Please provide:
1. Analysis of potential root causes
2. Step-by-step investigation plan
3. Specific code locations to examine
4. Recommended fixes or mitigations`;

    return {
      messages: [
        { role: 'system', content: { type: 'text', text: systemPrompt } },
        { role: 'user', content: { type: 'text', text: userMessage } },
      ],
      description: `Debug prompt for project "${projectId}" — entry point: ${entryPoint}`,
    };
  }

  // -------------------------------------------------------------------------
  // Prompt: refactor-plan
  // -------------------------------------------------------------------------

  private async refactorPlan(args: Record<string, unknown>): Promise<PromptResult> {
    const projectId = args['projectId'] as string;
    const target = args['target'] as string;
    const goal = args['goal'] as string;

    const graphSummary = this.buildGraphSummary(projectId);
    const impactInfo = this.getImpactContext(target);

    const systemPrompt = `You are a refactoring expert. Plan refactorings that are:
1. Safe — minimize risk of breaking changes
2. Incremental — can be done in small, reviewable steps
3. Measurable — include success criteria
4. Well-tested — include testing strategy`;

    const userMessage = `## Refactoring Plan: ${projectId}

**Target**: ${target}
**Goal**: ${goal}

### Impact Analysis
${impactInfo}

### Project Context
${graphSummary}

Please provide:
1. A step-by-step refactoring plan
2. Risk assessment for each step
3. Testing strategy (what to test before/after each step)
4. Rollback plan
5. Estimated effort and timeline`;

    return {
      messages: [
        { role: 'system', content: { type: 'text', text: systemPrompt } },
        { role: 'user', content: { type: 'text', text: userMessage } },
      ],
      description: `Refactoring plan prompt for target "${target}" (goal: ${goal})`,
    };
  }

  // -------------------------------------------------------------------------
  // Prompt: architecture-review
  // -------------------------------------------------------------------------

  private async architectureReview(args: Record<string, unknown>): Promise<PromptResult> {
    const projectId = args['projectId'] as string;
    const aspect = (args['aspect'] as string) ?? 'layers';
    const generateADR = args['generateADR'] === 'true' || args['generateADR'] === true;

    const graphSummary = this.buildGraphSummary(projectId);
    const layerInfo = this.getLayerInfo(projectId);
    const dependencyInfo = this.getDependencyInfo(projectId);

    const adrInstruction = generateADR
      ? 'After the review, generate an Architecture Decision Record (ADR) documenting any proposed architectural changes.'
      : '';

    const systemPrompt = `You are a software architect. Review architectures systematically:
1. Identify the current architectural patterns
2. Evaluate strengths and weaknesses
3. Detect anti-patterns and technical debt
4. Propose improvements with rationale
5. Consider scalability, maintainability, and team structure (Conway's Law)`;

    const userMessage = `## Architecture Review: ${projectId}

**Focus Aspect**: ${aspect}
${generateADR ? '**ADR Generation**: Requested\n' : ''}

### Architecture Layers
${layerInfo}

### Dependency Analysis
${dependencyInfo}

### Project Context
${graphSummary}

Please provide:
1. Current architecture pattern identification
2. Strengths of the current architecture
3. Weaknesses and anti-patterns detected
4. Improvement recommendations with rationale
5. Migration strategy (if applicable)
${adrInstruction}`;

    return {
      messages: [
        { role: 'system', content: { type: 'text', text: systemPrompt } },
        { role: 'user', content: { type: 'text', text: userMessage } },
      ],
      description: `Architecture review prompt for project "${projectId}" (aspect: ${aspect})`,
    };
  }

  // -------------------------------------------------------------------------
  // Graph Context Helpers
  // -------------------------------------------------------------------------

  private buildGraphSummary(projectId: string): string {
    let nodeCount = 0;
    let edgeCount = 0;
    const languageSet = new Set<string>();
    const labelCounts: Record<string, number> = {};

    for (const node of this.store.nodes.values()) {
      if (node.projectId !== projectId && projectId !== '*') continue;
      nodeCount++;
      if (node.language) languageSet.add(node.language);
      labelCounts[node.label] = (labelCounts[node.label] ?? 0) + 1;
    }
    for (const edge of this.store.edges.values()) {
      if (edge.projectId !== projectId && projectId !== '*') continue;
      edgeCount++;
    }

    const lines: string[] = [];
    lines.push(`- Total Nodes: ${nodeCount}`);
    lines.push(`- Total Edges: ${edgeCount}`);
    lines.push(`- Languages: ${Array.from(languageSet).join(', ') || 'none'}`);
    lines.push(`- Node Types: ${Object.entries(labelCounts).map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}`);
    return lines.join('\n');
  }

  private getTopLevelSymbols(projectId: string, limit: number): string {
    const lines: string[] = [];
    let count = 0;

    for (const node of this.store.nodes.values()) {
      if (node.projectId !== projectId && projectId !== '*') continue;
      if (!node.isExported) continue;
      if (node.label === 'File' || node.label === 'Folder') continue;
      if (count >= limit) break;

      const lineInfo = node.startLine ? `:${node.startLine}` : '';
      const fileInfo = node.filePath ? ` (${node.filePath}${lineInfo})` : '';
      lines.push(`- **${node.label}**: \`${node.qualifiedName || node.name}\`${fileInfo}`);
      count++;
    }

    if (lines.length === 0) lines.push('(No exported symbols found)');
    return lines.join('\n');
  }

  private getEntrypointContext(projectId: string): string {
    const lines: string[] = [];
    for (const node of this.store.nodes.values()) {
      if (node.projectId !== projectId && projectId !== '*') continue;
      const isEntry = node.label === 'EntryPoint' || node.properties.isEntrypoint === 'true';
      if (!isEntry) continue;
      const fileInfo = node.filePath ?? 'unknown file';
      const lineInfo = node.startLine ? `:${node.startLine}` : '';
      lines.push(`- \`${node.qualifiedName || node.name}\` → ${fileInfo}${lineInfo}`);
    }
    if (lines.length === 0) lines.push('(No explicit entry points found)');
    return lines.join('\n');
  }

  private traceCallChain(entryPoint: string): string {
    const lines: string[] = [];
    const node = this.store.getNodeByQualifiedName(entryPoint) ??
      (() => {
        for (const n of this.store.nodes.values()) {
          if (n.name === entryPoint && n.isExported) return n;
        }
        return null;
      })();

    if (node) {
      lines.push(`- Found: \`${node.qualifiedName || node.name}\` (${node.label})`);
      const edges = this.store.getEdgesForNode(node.id, undefined, 'out');
      const calls = edges.filter((e) => e.type === 'CALLS' || e.type === 'DEPENDS_ON');
      if (calls.length > 0) {
        lines.push(`- Direct calls/dependencies: ${calls.length}`);
        for (const edge of calls.slice(0, 5)) {
          const target = this.store.getNode(edge.targetId);
          if (target) {
            lines.push(`  - → \`${target.qualifiedName || target.name}\` (${edge.type})`);
          }
        }
        if (calls.length > 5) lines.push(`  - ... and ${calls.length - 5} more`);
      }
    } else {
      lines.push(`- Symbol "${entryPoint}" not found in graph.`);
      lines.push(`- Try using the full qualified name (e.g., "src/file.ts::functionName")`);
    }

    return lines.join('\n');
  }

  private findRelatedSymbols(symbolName: string, limit: number): string {
    const lines: string[] = [];
    let count = 0;

    const searchLower = symbolName.toLowerCase();
    for (const node of this.store.nodes.values()) {
      if (node.name.toLowerCase().includes(searchLower) ||
          node.qualifiedName.toLowerCase().includes(searchLower)) {
        if (count >= limit) break;
        const fileInfo = node.filePath ? ` (${node.filePath})` : '';
        lines.push(`- **${node.label}**: \`${node.qualifiedName || node.name}\`${fileInfo}`);
        count++;
      }
    }

    if (lines.length === 0) lines.push('(No related symbols found)');
    return lines.join('\n');
  }

  private getImpactContext(symbolName: string): string {
    const lines: string[] = [];
    const searchLower = symbolName.toLowerCase();

    for (const node of this.store.nodes.values()) {
      if (node.name.toLowerCase().includes(searchLower) ||
          node.qualifiedName.toLowerCase().includes(searchLower)) {
        const degree = this.store.getDegree(node.id);
        const fileInfo = node.filePath ? ` (${node.filePath})` : '';
        lines.push(`- \`${node.qualifiedName || node.name}\` — degree=${degree}, complexity=${node.complexity ?? 'N/A'}${fileInfo}`);

        // Show direct dependents
        const inEdges = this.store.getEdgesForNode(node.id, undefined, 'in');
        if (inEdges.length > 0 && lines.length < 20) {
          const depCount = inEdges.length;
          const depNames = inEdges.slice(0, 3).map((e) => {
            const src = this.store.getNode(e.sourceId);
            return src ? `\`${src.qualifiedName || src.name}\`` : 'unknown';
          }).join(', ');
          lines.push(`  ← depended on by ${depCount} symbols: ${depNames}${depCount > 3 ? ` ... +${depCount - 3} more` : ''}`);
        }
      }
    }

    if (lines.length === 0) lines.push(`(No impact data found for "${symbolName}")`);
    return lines.join('\n');
  }

  private getLayerInfo(projectId: string): string {
    const lines: string[] = [];
    const fileMap = new Map<string, string[]>();

    for (const node of this.store.nodes.values()) {
      if (node.projectId !== projectId && projectId !== '*') continue;
      if (!node.filePath) continue;
      const dir = node.filePath.split('/').slice(0, -1).join('/') || '(root)';
      if (!fileMap.has(dir)) fileMap.set(dir, []);
      fileMap.get(dir)!.push(node.label);
    }

    for (const [dir, labels] of fileMap.entries()) {
      const labelSummary = [...new Set(labels)].join(', ');
      lines.push(`- ${dir}/ — ${labelSummary}`);
    }

    if (lines.length === 0) lines.push('(No layer information available)');
    return lines.join('\n');
  }

  private getDependencyInfo(projectId: string): string {
    const lines: string[] = [];
    const depMap = new Map<string, Set<string>>();

    for (const edge of this.store.edges.values()) {
      if (edge.projectId !== projectId && projectId !== '*') continue;
      if (edge.type === 'DEPENDS_ON' || edge.type === 'IMPORTS') {
        const src = this.store.getNode(edge.sourceId);
        const tgt = this.store.getNode(edge.targetId);
        if (src && tgt) {
          const srcFile = src.filePath?.split('/').slice(0, -1).join('/') || '(root)';
          const tgtFile = tgt.filePath?.split('/').slice(0, -1).join('/') || '(root)';
          if (srcFile !== tgtFile) {
            if (!depMap.has(srcFile)) depMap.set(srcFile, new Set());
            depMap.get(srcFile)!.add(tgtFile);
          }
        }
      }
    }

    if (depMap.size === 0) {
      lines.push('(No cross-module dependencies detected)');
    } else {
      for (const [src, targets] of depMap.entries()) {
        lines.push(`- ${src}/ depends on: ${[...targets].join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}
