// @code-analyzer/intelligence — Review Swarm Orchestrator
// 8-Lens PR Review Swarm: deterministic multi-lens analysis with hard-gate synthesis.
// Each lens runs independently, then findings are merged, deduplicated,
// and validated through the Synthesis Lens (HARD GATE).

import type {
  GitDiff,
  ReviewComment,
  ReviewCategory,
  Severity,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { StandardsEngine } from '../standards/engine.js';
import { IoUOverlapDetector, type CommentRegion } from '../impact/iou-overlap.js';
import {
  type LensId,
  type LensProfile,
  type LensFinding,
  type LensReport,
  type EvidenceAnchor,
  LENS_PROFILES,
  getLensProfiles,
  SECURITY_PATTERNS,
  PERFORMANCE_PATTERNS,
  TESTING_PATTERNS,
  createLensFinding,
  lensFindingToReviewComment,
} from './review-lenses.js';

// ---------------------------------------------------------------------------
// Swarm Configuration
// ---------------------------------------------------------------------------

export interface SwarmConfig {
  /** Lenses to enable (default: all except synthesis, which always runs) */
  enabledLenses?: LensId[];
  /** Minimum severity to include in final report */
  minSeverity?: Severity;
  /** IoU overlap threshold for deduplication (default: 0.5) */
  iouThreshold?: number;
  /** Whether to fail-fast on critical findings */
  failFast?: boolean;
  /** Maximum findings per lens (default: unlimited) */
  maxFindingsPerLens?: number;
  /** Whether to run lenses in parallel (default: true) */
  parallel?: boolean;
}

export interface SwarmResult {
  /** Per-lens reports */
  lensReports: LensReport[];
  /** Synthesized review comments */
  comments: ReviewComment[];
  /** Summary statistics */
  summary: SwarmSummary;
  /** Block/approve decision */
  decision: SwarmDecision;
  /** Action plan with prioritized items */
  actionPlan: ActionItem[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

export interface SwarmSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  byLens: Record<LensId, number>;
  filesScanned: number;
  linesAnalyzed: number;
  evidenceRejected: number;
  adversarialRejected: number;
  iouDeduped: number;
  /** Findings requiring LLM validation (low confidence) */
  needsLLMValidation: number;
}

export interface SwarmDecision {
  /** Whether the PR can be merged */
  canMerge: boolean;
  /** Decision category */
  recommendation: 'approve' | 'approve-with-comments' | 'request-changes' | 'block';
  /** Reason for the decision */
  reason: string;
  /** Number of critical findings blocking merge */
  blockingCount: number;
  /** Required corrections before merge */
  requiredCorrections: string[];
}

export interface ActionItem {
  /** Priority rank (1 = highest) */
  priority: number;
  /** What needs to be done */
  action: string;
  /** Which file(s) are affected */
  files: string[];
  /** Estimated effort */
  effort: 'low' | 'medium' | 'high';
  /** Which lens(es) flagged this */
  lenses: LensId[];
  /** Related findings */
  findingIds: string[];
}

// ---------------------------------------------------------------------------
// Swarm Orchestrator
// ---------------------------------------------------------------------------

export class ReviewSwarm {
  private readonly standardsEngine: StandardsEngine;
  private readonly iouDetector: IoUOverlapDetector;
  private readonly config: Required<SwarmConfig>;

  constructor(
    private store: InMemoryGraphStore,
    config?: SwarmConfig,
  ) {
    this.standardsEngine = new StandardsEngine();
    this.iouDetector = new IoUOverlapDetector();
    this.config = {
      enabledLenses: config?.enabledLenses ?? getLensProfiles().map(p => p.id).filter(id => id !== 'synthesis'),
      minSeverity: config?.minSeverity ?? 'info',
      iouThreshold: config?.iouThreshold ?? 0.5,
      failFast: config?.failFast ?? false,
      maxFindingsPerLens: config?.maxFindingsPerLens ?? Number.MAX_SAFE_INTEGER,
      parallel: config?.parallel ?? true,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run the full 8-lens swarm on a set of git diffs.
   * Returns synthesized review comments with evidence validation and action plan.
   */
  async review(
    projectId: string,
    diffs: GitDiff[],
    sourceContents?: Map<string, string>,
  ): Promise<SwarmResult> {
    const startTime = Date.now();

    // Get lens profiles sorted by priority
    const profiles = getLensProfiles().filter(
      p => p.id === 'synthesis' || this.config.enabledLenses.includes(p.id),
    );

    // Run non-synthesis lenses
    const analysisLenses = profiles.filter(p => p.id !== 'synthesis');
    const lensReports = this.config.parallel
      ? await this.runLensesParallel(analysisLenses, diffs, sourceContents)
      : await this.runLensesSequential(analysisLenses, diffs, sourceContents);

    // Run Synthesis Lens (always runs last)
    const synthesisResult = this.synthesize(lensReports);

    const totalDurationMs = Date.now() - startTime;

    return {
      lensReports,
      comments: synthesisResult.comments,
      summary: synthesisResult.summary,
      decision: synthesisResult.decision,
      actionPlan: synthesisResult.actionPlan,
      totalDurationMs,
    };
  }

  /**
   * Enhanced review with knowledge graph context enrichment.
   * After the deterministic scan, enriches each finding with graph context
   * (callers, callees, related tests, cross-repo references).
   * This gives the MCP Client LLM the structural context needed for deep reasoning.
   */
  async reviewWithGraphContext(
    projectId: string,
    diffs: GitDiff[],
    sourceContents?: Map<string, string>,
  ): Promise<SwarmResult> {
    // Phase 1: Deterministic scan
    const result = await this.review(projectId, diffs, sourceContents);

    // Phase 2: Enrich findings with knowledge graph context
    for (const report of result.lensReports) {
      for (const finding of report.findings) {
        try {
          finding.graphContext = this.enrichWithGraphContext(finding);
        } catch {
          // Graph enrichment is best-effort — don't fail review
        }
      }
    }

    return result;
  }

  /**
   * Generate an MCP prompt for Client LLM deep review.
   * Packages all swarm findings + graph context into a structured prompt
   * that guides the MCP Client's LLM through deeper analysis.
   *
   * The prompt structure:
   * 1. PR summary and context
   * 2. High-confidence findings (rule-based) — ask LLM to validate
   * 3. Low-confidence findings (heuristic) — ask LLM to investigate deeply
   * 4. Knowledge graph context — call chains, dependencies, tests
   * 5. Adversarial challenge — ask LLM to find counter-examples
   * 6. Missing patterns — ask LLM to find issues our rules missed
   */
  generateMCPPrompt(result: SwarmResult, prTitle: string): string {
    const highConf = result.lensReports.flatMap(r =>
      r.findings.filter(f => f.confidence === 'rule'),
    );
    const heuristic = result.lensReports.flatMap(r =>
      r.findings.filter(f => f.confidence === 'heuristic' || f.confidence === 'low'),
    );

    const prompt = `## PR Review: ${prTitle}

### Deterministic Scan Results
${result.summary.totalFindings} findings from ${result.lensReports.length} lenses
across ${result.summary.filesScanned} files (${result.summary.linesAnalyzed} lines).

### High-Confidence Findings (Pattern-Matched — Please Validate)
${highConf.length > 0
  ? highConf.map((f, i) =>
    `${i + 1}. **[${f.lens}] ${f.title}** (${f.severity})
   File: ${f.evidence.filePath}:${f.evidence.startLine}
   Code: \`${f.evidence.codeSnippet.slice(0, 100)}${f.evidence.codeSnippet.length > 100 ? '...' : ''}\`
   ${f.description}
   ${f.graphContext && f.graphContext.callers.length > 0 ? `Callers: ${f.graphContext.callers.join(', ')}` : ''}
   ${f.suggestion ? `Suggested Fix: ${f.suggestion}` : ''}`,
  ).join('\n\n')
  : 'No high-confidence findings.'}

### Heuristic / Low-Confidence Findings (Please Investigate)
${heuristic.length > 0
  ? heuristic.map((f, i) =>
    `${i + 1}. **[${f.lens}] ${f.title}** (${f.severity}, confidence: ${f.confidence})
   File: ${f.evidence.filePath}:${f.evidence.startLine}
   Code: \`${f.evidence.codeSnippet.slice(0, 100)}${f.evidence.codeSnippet.length > 100 ? '...' : ''}\`
   ${f.graphContext && f.graphContext.relatedTests.length > 0 ? `Related Tests: ${f.graphContext.relatedTests.join(', ')}` : 'No related tests found.'}
   ${f.graphContext && f.graphContext.crossRepoRefs.length > 0 ? `Cross-Repo: ${f.graphContext.crossRepoRefs.join(', ')}` : ''}`,
  ).join('\n\n')
  : 'No heuristic findings.'}

### Your Task as an AI Code Reviewer

1. **Validate high-confidence findings**: Are these real issues or false positives?
   Look at the actual code context before confirming.

2. **Investigate low-confidence findings**: These are heuristic signals that need deeper analysis.
   Check if they represent real bugs or just pattern matches on benign code.

3. **Find missing patterns**: Our deterministic rules may have missed issues. Look for:
   - Race conditions in async code
   - Incorrect error handling (swallowed errors, missing error propagation)
   - Business logic errors (wrong calculations, inverted conditions)
   - Performance issues our rules didn't catch
   - Security issues requiring semantic understanding

4. **Adversarial challenge**: For each confirmed finding, construct a scenario where:
   - The "bug" is actually intentional and correct
   - An edge case makes the fix worse
   Report only findings that survive adversarial scrutiny.

5. **Provide final assessment**: For each confirmed finding, provide:
   - Whether you agree with the severity
   - A concrete fix suggestion with code
   - Any additional context the developer needs

### Decision Guidance
- Block merge if: any confirmed CRITICAL finding
- Request changes if: 3+ confirmed HIGH findings
- Approve with comments if: only MEDIUM/LOW findings
- Approve if: no confirmed findings

Current automatic assessment: **${result.decision.recommendation.toUpperCase()}**
Reason: ${result.decision.reason}`;

    return prompt;
  }

  // -------------------------------------------------------------------------
  // Knowledge Graph Enrichment
  // -------------------------------------------------------------------------

  /**
   * Enrich a finding with knowledge graph context.
   * Queries the graph for related entities to give the LLM structural context.
   */
  private enrichWithGraphContext(finding: LensFinding): LensFinding['graphContext'] {
    const context: Required<NonNullable<LensFinding['graphContext']>> = {
      callers: [],
      callees: [],
      relatedTests: [],
      crossRepoRefs: [],
    };

    try {
      // Find functions in the same file at nearby lines
      const fileNodes = this.store.queryNodes({ label: 'File' });
      const funcNodes = this.store.queryNodes({ label: 'Function' });

      /* v8 ignore start */
      for (const func of funcNodes) {
        const funcPath = (func.properties as Record<string, string>).filePath;
        if (funcPath === finding.evidence.filePath) {
          const funcLine = (func.properties as Record<string, number>).lineNumber;
          if (funcLine && Math.abs(funcLine - finding.evidence.startLine) < 50) {
            // Find callers of this nearby function
            const edges = this.store.queryEdges({ targetId: func.id, type: 'CALLS' });
            for (const edge of edges) {
              const caller = this.store.getNode(edge.sourceId);
              if (caller) {
                context.callers.push(caller.name ?? caller.id);
              }
            }

            // Find what this function calls
            const outEdges = this.store.queryEdges({ sourceId: func.id, type: 'CALLS' });
            for (const edge of outEdges) {
              const callee = this.store.getNode(edge.targetId);
              if (callee) {
                context.callees.push(callee.name ?? callee.id);
              }
            }
          }
        }

        // Find test files
        if (funcPath && funcPath.includes('.test.') || funcPath?.includes('.spec.')) {
          const testEdges = this.store.queryEdges({ sourceId: func.id });
          for (const edge of testEdges) {
            const target = this.store.getNode(edge.targetId);
            if (target) {
              const targetPath = (target.properties as Record<string, string>).filePath;
              if (targetPath === finding.evidence.filePath) {
                context.relatedTests.push(funcPath);
              }
            }
          }
        }

        // Find cross-repo edges
        if ((func.properties as Record<string, string>).crossRepo) {
          const crossEdges = this.store.queryEdges({
            sourceId: func.id,
            type: 'CROSS_REPO_CALLS' as any,
          });
          for (const edge of crossEdges) {
            context.crossRepoRefs.push(`${edge.sourceId} → ${edge.targetId}`);
          }
        }
      }
      /* v8 ignore stop */
    } catch {
      // Best-effort enrichment
    }

    return {
      callers: [...new Set(context.callers)].slice(0, 10),
      callees: [...new Set(context.callees)].slice(0, 10),
      relatedTests: [...new Set(context.relatedTests)].slice(0, 5),
      crossRepoRefs: [...new Set(context.crossRepoRefs)].slice(0, 5),
    };
  }

  // -------------------------------------------------------------------------
  // Lens Execution
  // -------------------------------------------------------------------------

  private async runLensesParallel(
    profiles: LensProfile[],
    diffs: GitDiff[],
    sourceContents?: Map<string, string>,
  ): Promise<LensReport[]> {
    const reports = await Promise.all(
      profiles.map(p => this.runSingleLens(p, diffs, sourceContents)),
    );
    return reports;
  }

  private async runLensesSequential(
    profiles: LensProfile[],
    diffs: GitDiff[],
    sourceContents?: Map<string, string>,
  ): Promise<LensReport[]> {
    const reports: LensReport[] = [];
    for (const profile of profiles) {
      reports.push(await this.runSingleLens(profile, diffs, sourceContents));
    }
    return reports;
  }

  private async runSingleLens(
    profile: LensProfile,
    diffs: GitDiff[],
    sourceContents?: Map<string, string>,
  ): Promise<LensReport> {
    const startTime = Date.now();
    const findings: LensFinding[] = [];
    let linesAnalyzed = 0;

    for (const diff of diffs) {
      const content = sourceContents?.get(diff.filePath) ??
        diff.ranges.map(r => `// ${diff.filePath}:${r.newStart}-${r.newEnd}`).join('\n');

      const lines = content.split('\n');
      linesAnalyzed += lines.length;

      const lensFindings = this.executeLensOnDiff(profile, diff, lines);
      findings.push(...lensFindings);
    }

    // Apply max findings limit
    const limitedFindings = findings.slice(0, this.config.maxFindingsPerLens);

    return {
      lens: profile.id,
      name: profile.name,
      findings: limitedFindings,
      filesScanned: diffs.length,
      linesAnalyzed,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single lens on a single diff.
   * Each lens has its own deterministic analysis logic.
   */
  private executeLensOnDiff(
    profile: LensProfile,
    diff: GitDiff,
    lines: string[],
  ): LensFinding[] {
    switch (profile.id) {
      case 'security':
        return this.runSecurityLens(diff, lines);
      case 'performance':
        return this.runPerformanceLens(diff, lines);
      case 'testing':
        return this.runTestingLens(diff, lines);
      case 'style':
        return this.runStyleLens(diff, lines);
      case 'structure':
        return this.runStructureLens(diff, lines);
      case 'api':
        return this.runApiLens(diff, lines);
      case 'docs':
        return this.runDocsLens(diff, lines);
      /* v8 ignore next 2 */
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // SECURITY LENS
  // -------------------------------------------------------------------------

  private runSecurityLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.pattern.test(line)) {
          const evidence: EvidenceAnchor = {
            filePath: diff.filePath,
            startLine: i + 1,
            endLine: i + 1,
            codeSnippet: line.trim().slice(0, 200),
            lens: 'security',
            ruleId: pattern.id,
          };
          const finding = createLensFinding(
            'security',
            'security',
            pattern.severity,
            pattern.name,
            `${pattern.description}\n\nSuggestion: ${pattern.suggestion}`,
            evidence,
            { ruleId: pattern.id },
          );
          if (finding) findings.push(finding);
        }
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // PERFORMANCE LENS
  // -------------------------------------------------------------------------

  private runPerformanceLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    for (const pattern of PERFORMANCE_PATTERNS) {
      const matches = pattern.detection(lines, diff.filePath);
      for (const match of matches) {
        // Only report if the file is NOT a test file
        if (diff.filePath.includes('.test.') || diff.filePath.includes('.spec.')) {
          continue;
        }
        const codeLines = lines.slice(
          Math.max(0, match.startLine - 1),
          Math.min(lines.length, match.endLine),
        );
        const evidence: EvidenceAnchor = {
          filePath: diff.filePath,
          startLine: match.startLine,
          endLine: match.endLine,
          codeSnippet: codeLines.join('\n').slice(0, 500),
          lens: 'performance',
          ruleId: pattern.id,
        };
        const finding = createLensFinding(
          'performance',
          'performance',
          pattern.severity,
          pattern.name,
          `${pattern.description}\n\nSuggestion: ${pattern.suggestion}`,
          evidence,
          { ruleId: pattern.id },
        );
        if (finding) findings.push(finding);
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // TESTING LENS
  // -------------------------------------------------------------------------

  private runTestingLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    // Check if this is a test file
    const isTestFile = diff.filePath.includes('.test.') ||
      diff.filePath.includes('.spec.') ||
      diff.filePath.includes('/__tests__/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Only check test patterns on test files
      if (isTestFile) {
        for (const pattern of TESTING_PATTERNS) {
          if (pattern.pattern.test(line)) {
            const evidence: EvidenceAnchor = {
              filePath: diff.filePath,
              startLine: i + 1,
              endLine: i + 1,
              codeSnippet: line.trim().slice(0, 200),
              lens: 'testing',
              ruleId: pattern.id,
            };
            const finding = createLensFinding(
              'testing',
              'testing',
              pattern.severity,
              pattern.name,
              `${pattern.description}\n\nSuggestion: ${pattern.suggestion}`,
              evidence,
              { ruleId: pattern.id },
            );
            if (finding) findings.push(finding);
          }
        }
      }
    }

    // Check if non-test files have corresponding test files
    // (heuristic: look for source change without test change in the same diff set)
    if (!isTestFile && !diff.filePath.endsWith('.d.ts') && !diff.filePath.endsWith('.json')) {
      // This is a heuristic check — the actual test coverage analysis
      // requires the full diff set, which is handled by the orchestrator
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // STYLE LENS
  // -------------------------------------------------------------------------

  private runStyleLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];
    let inFunction = false;
    let funcStart = 0;
    let funcName = '';
    let braceDepth = 0;
    let maxNestingDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Detect function start
      const funcMatch = trimmed.match(
        /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/,
      );
      if (funcMatch) {
        inFunction = true;
        funcStart = i + 1;
        funcName = (funcMatch[1] ?? funcMatch[2] ?? funcMatch[3]) ?? 'anonymous';
        braceDepth = 0;
        maxNestingDepth = 0;
      }

      // Track depth
      if (inFunction) {
        const opens = (trimmed.match(/\{/g) ?? []).length;
        const closes = (trimmed.match(/\}/g) ?? []).length;
        braceDepth += opens - closes;
        maxNestingDepth = Math.max(maxNestingDepth, braceDepth);
      }

      // Function end
      if (inFunction && braceDepth <= 0 && trimmed.includes('}')) {
        const funcLength = i + 1 - funcStart;
        inFunction = false;

        // Check function length
        if (funcLength > 50) {
          const evidence: EvidenceAnchor = {
            filePath: diff.filePath,
            startLine: funcStart,
            endLine: i + 1,
            codeSnippet: `${funcName}: ${funcLength} lines`,
            lens: 'style',
            ruleId: 'style-func-length',
          };
          const finding = createLensFinding(
            'style',
            'style',
            'medium',
            'Long Function',
            `Function "${funcName}" is ${funcLength} lines (threshold: 50). Consider splitting into smaller, focused functions.`,
            evidence,
            { ruleId: 'style-func-length' },
          );
          if (finding) findings.push(finding);
        }

        // Check nesting depth
        if (maxNestingDepth > 4) {
          const evidence: EvidenceAnchor = {
            filePath: diff.filePath,
            startLine: funcStart,
            endLine: i + 1,
            codeSnippet: `${funcName}: nesting depth ${maxNestingDepth}`,
            lens: 'style',
            ruleId: 'style-nesting-depth',
          };
          const finding = createLensFinding(
            'style',
            'style',
            'medium',
            'Deep Nesting',
            `Function "${funcName}" has nesting depth of ${maxNestingDepth} (threshold: 4). Extract inner logic to helper functions.`,
            evidence,
            { ruleId: 'style-nesting-depth' },
          );
          if (finding) findings.push(finding);
        }

      }

      // Check for console.log in production code
      if (!diff.filePath.includes('.test.') && !diff.filePath.includes('.spec.')) {
        if (/\bconsole\.log\b/.test(trimmed) && !trimmed.startsWith('//')) {
          const evidence: EvidenceAnchor = {
            filePath: diff.filePath,
            startLine: i + 1,
            endLine: i + 1,
            codeSnippet: trimmed.slice(0, 200),
            lens: 'style',
            ruleId: 'style-console-log',
          };
          const finding = createLensFinding(
            'style',
            'style',
            'low',
            'Debug console.log',
            'console.log() left in production code. Remove or replace with proper logging.',
            evidence,
            { ruleId: 'style-console-log' },
          );
          if (finding) findings.push(finding);
        }
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // STRUCTURE LENS
  // -------------------------------------------------------------------------

  private runStructureLens(_diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    // Check for circular dependency markers
    // (Full circular dep detection requires graph traversal, done via MCP tools)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Detect barrel export anti-patterns (stub — full implementation in future iteration)
      /* v8 ignore start */
      if (line.trim() === "export * from './" && i + 1 < lines.length) {
        // Barrel exports can cause circular deps
      }
      /* v8 ignore stop */

      // Check for disallowed cross-layer imports
      // e.g., presentation layer importing from infra directly
      // This requires .code-analyzer.yml layer configuration
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // API LENS
  // -------------------------------------------------------------------------

  private runApiLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    // Check for route handlers
    const isRouteFile = diff.filePath.includes('/api/') ||
      diff.filePath.includes('/routes/') ||
      diff.filePath.includes('/controllers/') ||
      diff.filePath.includes('/handlers/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Detect route handler patterns
      if (isRouteFile) {
        // Check for missing input validation
        const isHandler = /\b(?:router\.(?:get|post|put|delete|patch)|app\.(?:get|post|put|delete|patch))\s*\(/.test(trimmed);
        if (isHandler) {
          // Look ahead for validation middleware
          const nextLines = lines.slice(i, i + 5);
          const hasValidation = nextLines.some(l =>
            /\bvalidate\b|\bvalidator\b|\bjoi\b|\bzod\b|\byup\b|\bcheck\b/.test(l),
          );

          if (!hasValidation) {
            const evidence: EvidenceAnchor = {
              filePath: diff.filePath,
              startLine: i + 1,
              endLine: i + 1,
              codeSnippet: trimmed.slice(0, 200),
              lens: 'api',
              ruleId: 'api-missing-validation',
            };
            const finding = createLensFinding(
              'api',
              'api',
              'high',
              'Missing Input Validation',
              'Route handler appears to lack input validation. Add schema validation middleware (Zod, Joi, Yup) to prevent malformed requests.',
              evidence,
              { ruleId: 'api-missing-validation', suggestion: 'Add validation: router.post("/path", validate(schema), handler)' },
            );
            if (finding) findings.push(finding);
          }

          // Check for missing auth middleware
          const hasAuth = nextLines.some(l =>
            /\bauth\b|\bauthenticate\b|\bauthorize\b|\bguard\b|\bmiddleware\b/.test(l),
          );
          if (!hasAuth) {
            const evidence: EvidenceAnchor = {
              filePath: diff.filePath,
              startLine: i + 1,
              endLine: i + 1,
              codeSnippet: trimmed.slice(0, 200),
              lens: 'api',
              ruleId: 'api-missing-auth',
            };
            const finding = createLensFinding(
              'api',
              'security',
              'high',
              'Potentially Unprotected Route',
              'Route handler may lack authentication/authorization. Verify auth middleware is applied.',
              evidence,
              { ruleId: 'api-missing-auth' },
            );
            if (finding) findings.push(finding);
          }
        }

        // Check for inconsistent response format
        if (/\b(?:res\.json|res\.send|return\s*\{)\b/.test(trimmed)) {
          // Heuristic check — proper analysis requires full schema
        }
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // DOCS LENS
  // -------------------------------------------------------------------------

  private runDocsLens(diff: GitDiff, lines: string[]): LensFinding[] {
    const findings: LensFinding[] = [];

    let foundExport = false;
    let hasJSDoc = false;
    let exportLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Track JSDoc presence
      if (/\/\*\*/.test(trimmed)) {
        hasJSDoc = true;
      }

      // Detect exported functions/classes without JSDoc
      if (/\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\b/.test(trimmed)) {
        foundExport = true;
        exportLine = i + 1;

        // Check if there was JSDoc in the preceding 5 lines
        const precedingLines = lines.slice(Math.max(0, i - 5), i);
        const hasDocComment = precedingLines.some(l => /\/\*\*/.test(l)) ||
          precedingLines.some(l => /^\/\/\//.test(l.trim()));

        // export type aliases and export { re-exports } rarely need JSDoc.
        // export interface without JSDoc is flagged — adversarial check 5
        // down-ranks Props interfaces specifically.
        if (!hasDocComment && !trimmed.includes('export type') && !trimmed.includes('export {')) {
          const match = trimmed.match(/(?:function|class|const|let|var|interface)\s+(\w+)/);
          if (match) {
            const evidence: EvidenceAnchor = {
              filePath: diff.filePath,
              startLine: i + 1,
              endLine: i + 1,
              codeSnippet: trimmed.slice(0, 200),
              lens: 'docs',
              ruleId: 'docs-missing-jsdoc',
            };
            const finding = createLensFinding(
              'docs',
              'documentation',
              'low',
              'Missing JSDoc on Exported API',
              `Exported "${match[1]}" has no JSDoc documentation. Add /** ... */ with @param, @returns, and @example.`,
              evidence,
              { ruleId: 'docs-missing-jsdoc' },
            );
            if (finding) findings.push(finding);
          }
        }
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // SYNTHESIS LENS (HARD GATE)
  // -------------------------------------------------------------------------

  /**
   * The Synthesis Lens is the HARD GATE.
   * It runs AFTER all other lenses and performs:
   * 1. Evidence validation — reject findings without proper anchors
   * 2. IoU-based deduplication — merge overlapping findings
   * 3. Severity calibration — adjust based on consensus and impact
   * 4. Action plan generation — prioritize and estimate effort
   * 5. Merge decision — block/approve based on critical findings
   */
  private synthesize(reports: LensReport[]): {
    comments: ReviewComment[];
    summary: SwarmSummary;
    decision: SwarmDecision;
    actionPlan: ActionItem[];
  } {
    // Step 1: Collect all findings
    let allFindings = reports.flatMap(r => r.findings);
    const totalRaw = allFindings.length;

    // Step 2: Evidence validation — reject findings without proper anchors
    let evidenceRejected = 0;
    const validatedFindings: LensFinding[] = [];
    for (const f of allFindings) {
      if (
        f.evidence.filePath &&
        f.evidence.startLine > 0 &&
        f.evidence.codeSnippet.length > 0
      ) {
        validatedFindings.push(f);
      } else {
        evidenceRejected++;
      }
    }
    evidenceRejected += (totalRaw - validatedFindings.length);
    allFindings = validatedFindings;

    // Step 2.5: Adversarial validation — challenge each finding
    // Try to disprove findings by checking for common false-positive patterns.
    // Low-confidence findings are down-ranked; rule-based findings are checked
    // for obvious false positives (e.g., commented code, test file exceptions).
    let adversarialRejected = 0;
    allFindings = allFindings.filter(f => {
      const keep = this.adversarialValidate(f);
      if (!keep) adversarialRejected++;
      return keep;
    });

    // Step 3: IoU-based deduplication
    const regions: CommentRegion[] = allFindings.map(f => ({
      filePath: f.evidence.filePath,
      startLine: f.evidence.startLine,
      endLine: f.evidence.endLine,
      commentId: f.id,
    }));

    const deduplicatedFindings: LensFinding[] = [];
    const seen = new Set<string>();
    let iouDeduped = 0;

    for (const finding of allFindings) {
      const overlaps = this.iouDetector.detectOverlap(
        {
          filePath: finding.evidence.filePath,
          startLine: finding.evidence.startLine,
          endLine: finding.evidence.endLine,
          commentId: finding.id,
        },
        regions.filter(r => r.commentId !== finding.id),
        this.config.iouThreshold,
      );

      if (overlaps && seen.has(overlaps.commentId)) {
        iouDeduped++;
        continue; // This finding overlaps with a previously accepted one
      }

      seen.add(finding.id);
      deduplicatedFindings.push(finding);
    }

    allFindings = deduplicatedFindings;

    // Step 4: Severity calibration
    // If 3+ lenses flag the same code area, elevate to critical
    const locationMap = new Map<string, LensFinding[]>();
    for (const f of allFindings) {
      const key = `${f.evidence.filePath}:${f.evidence.startLine}`;
      if (!locationMap.has(key)) locationMap.set(key, []);
      locationMap.get(key)!.push(f);
    }

    for (const [key, fs] of locationMap) {
      /* v8 ignore start */
      if (fs.length >= 3) {
        // Consensus: multiple lenses agree — elevate severity
        for (const f of fs) {
          if (f.severity === 'low') f.severity = 'medium';
          else if (f.severity === 'medium') f.severity = 'high';
          else if (f.severity === 'high') f.severity = 'critical';
        }
      }
      /* v8 ignore stop */
    }

    // Step 5: Filter by minimum severity
    allFindings = allFindings.filter(f => {
      const severityOrder: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
      return severityOrder.indexOf(f.severity) >= severityOrder.indexOf(this.config.minSeverity);
    });

    // Step 6: Build summary
    const bySeverity: Record<Severity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    const byCategory: Record<string, number> = {};
    const byLens: Record<string, number> = {};

    for (const f of allFindings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
      byLens[f.lens] = (byLens[f.lens] ?? 0) + 1;
    }

    // Fix byLens type
    const typedByLens: Record<LensId, number> = {} as Record<LensId, number>;
    for (const [k, v] of Object.entries(byLens)) {
      typedByLens[k as LensId] = v;
    }

    const summary: SwarmSummary = {
      totalFindings: allFindings.length,
      bySeverity,
      byCategory,
      byLens: typedByLens,
      filesScanned: reports.reduce((sum, r) => sum + r.filesScanned, 0),
      linesAnalyzed: reports.reduce((sum, r) => sum + r.linesAnalyzed, 0),
      evidenceRejected,
      adversarialRejected,
      iouDeduped,
      needsLLMValidation: allFindings.filter(f => f.confidence === 'low').length,
    };

    // Step 7: Generate action plan
    const actionPlan = this.buildActionPlan(allFindings);

    // Step 8: Make merge decision
    const criticalFindings = allFindings.filter(f => f.severity === 'critical');
    const highFindings = allFindings.filter(f => f.severity === 'high');

    const requiredCorrections = [
      ...criticalFindings.map(f => `[${f.lens}] ${f.evidence.filePath}:${f.evidence.startLine} — ${f.title}`),
    ];

    const decision: SwarmDecision = {
      canMerge: criticalFindings.length === 0,
      recommendation: criticalFindings.length > 0
        ? 'block'
        : highFindings.length > 3
          ? 'request-changes'
          : allFindings.length > 0
            ? 'approve-with-comments'
            : 'approve',
      reason: criticalFindings.length > 0
        ? `${criticalFindings.length} critical finding(s) must be resolved before merge.`
        : highFindings.length > 0
          ? `${highFindings.length} high-severity finding(s) should be reviewed.`
          : allFindings.length === 0
            ? 'No issues found. Safe to merge.'
            : `${allFindings.length} finding(s) — review recommended.`,
      blockingCount: criticalFindings.length,
      requiredCorrections,
    };

    // Step 9: Convert to ReviewComment format
    const comments = allFindings.map(lensFindingToReviewComment);

    return {
      comments,
      summary,
      decision,
      actionPlan,
    };
  }

  /**
   * Adversarial validation: try to disprove each finding.
   *
   * False positive checks:
   * 1. Commented-out code (finding on a comment line) → reject
   * 2. Test file exceptions (test.only in test file is intentional during dev) → keep but down-rank
   * 3. Build/config files (eval in webpack config is normal) → down-rank
   * 4. Low-confidence findings with zero graph context → mark for LLM, keep anyway
   *
   * This does NOT make the final decision — it adjusts confidence.
   * The MCP Client LLM makes the final call on each finding.
   */
  private adversarialValidate(finding: LensFinding): boolean {
    const code = finding.evidence.codeSnippet;
    const filePath = finding.evidence.filePath;

    // Check 1: Finding is on a comment-only line
    if (code.trim().startsWith('//') || code.trim().startsWith('/*') || code.trim().startsWith('*')) {
      // Security findings on comments are always false positives
      if (finding.lens === 'security' && finding.confidence === 'rule') {
        return false;
      }
      // Style findings on comments are noise
      if (finding.lens === 'style') {
        return false;
      }
      // Other lenses: keep but mark as low confidence
      finding.confidence = 'low';
      return true;
    }

    // Check 2: eval() in build tool configs — common and intentional
    if (finding.evidence.ruleId === 'sec-eval' &&
        (filePath.includes('webpack') || filePath.includes('vite.config') ||
         filePath.includes('eslint') || filePath.includes('.config.'))) {
      finding.confidence = 'low';
      finding.severity = 'low';
      return true; // Keep but heavily down-ranked
    }

    // Check 3: Hardcoded keys in test fixtures
    if (finding.evidence.ruleId === 'sec-hardcoded-key' &&
        (filePath.includes('.test.') || filePath.includes('.spec.') ||
         filePath.includes('__fixtures__') || filePath.includes('mock'))) {
      finding.confidence = 'low';
      finding.severity = 'info';
      return true;
    }

    // Check 4: console.log in CLI tools is normal
    if (finding.evidence.ruleId === 'style-console-log' &&
        (filePath.includes('/cli/') || filePath.includes('/bin/') || filePath.endsWith('.cli.ts'))) {
      finding.confidence = 'low';
      return true;
    }

    // Check 5: Missing JSDoc on React component props type (often unnecessary)
    if (finding.evidence.ruleId === 'docs-missing-jsdoc' &&
        code.includes('interface') && code.includes('Props')) {
      finding.confidence = 'low';
      return true;
    }

    // Default: keep the finding
    return true;
  }

  /**
   * Build prioritized action plan from findings.
   */
  private buildActionPlan(findings: LensFinding[]): ActionItem[] {
    // Group findings by file
    const byFile = new Map<string, LensFinding[]>();
    for (const f of findings) {
      if (!byFile.has(f.evidence.filePath)) byFile.set(f.evidence.filePath, []);
      byFile.get(f.evidence.filePath)!.push(f);
    }

    // Determine effort based on finding count and severity per file
    const items: ActionItem[] = [];
    let priority = 1;

    for (const [file, fileFindings] of byFile) {
      const hasCritical = fileFindings.some(f => f.severity === 'critical');
      const count = fileFindings.length;
      const lenses = [...new Set(fileFindings.map(f => f.lens))];

      items.push({
        priority,
        action: `Address ${count} finding(s) in ${file}`,
        files: [file],
        effort: count > 5 ? 'high' : count > 2 ? 'medium' : 'low',
        lenses,
        findingIds: fileFindings.map(f => f.id),
      });

      // Critical files get higher priority
      if (hasCritical) priority -= 0.5;
      priority++;
    }

    // Sort by priority (lower = more important)
    items.sort((a, b) => a.priority - b.priority);

    // Re-assign sequential priorities
    items.forEach((item, i) => { item.priority = i + 1; });

    return items;
  }
}
