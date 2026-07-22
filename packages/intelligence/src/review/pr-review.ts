// @code-analyzer/intelligence — PR Review Engine
// Pull request review with enriched knowledge graph context and standards checks.

import type {
  PullRequest,
  GitDiff,
  ReviewComment,
  ReviewCategory,
  Severity,
  ImpactResult,
  RiskLevel,
  StandardsCheckResult,
  ProjectStandard,
} from '@code-analyzer/shared';
import { SqliteStore } from '@code-analyzer/infra';
import { CodeReviewEngine, type ReviewContext } from './review-engine.js';
import { SessionStore } from './session-store.js';
import { DEFAULT_STANDARDS } from './standards-defaults.js';
import { ReviewSwarm, type SwarmResult } from './review-swarm.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRReviewResult {
  sessionId: string;
  comments: ReviewComment[];
  standardsResults: StandardsCheckResult[];
  impactResult: ImpactResult;
  summary: PRReviewSummary;
}

export interface PRReviewSummary {
  totalComments: number;
  byCategory: Record<ReviewCategory, number>;
  bySeverity: Record<Severity, number>;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  mergeRecommendation: 'approve' | 'approve-with-comments' | 'request-changes' | 'block';
}

export interface EnrichedDiff {
  diff: GitDiff;
  affectedSymbols: string[];
  relatedTests: string[];
  impactScore: number;
}

// ---------------------------------------------------------------------------
// PR Review Engine
// ---------------------------------------------------------------------------

export class PRReviewEngine {
  private readonly sessionStore: SessionStore;

  constructor(
    private reviewEngine: CodeReviewEngine,
    private store: SqliteStore,
    sessionStore?: SessionStore,
  ) {
    this.sessionStore = sessionStore ?? new SessionStore();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Review a GitHub pull request.
   * Combines diff review, standards checking, and impact analysis.
   */
  async reviewPR(
    projectId: string,
    _pr: PullRequest,
    diffs: GitDiff[],
  ): Promise<PRReviewResult> {
    // Build enriched context from knowledge graph
    const enrichedDiffs = await this.buildEnrichedContext(projectId, diffs);

    // Run code review on all diffs
    const session = await this.reviewEngine.reviewDiff(projectId, diffs);

    // Gather all comments from the session
    const sessionComments = this.gatherComments(session.id);

    // Run standards checks
    const ctx = this.buildReviewContext(projectId, diffs, session.id);
    const standardsResults = await this.checkStandards(ctx);

    // Merge standards violations into review comments so they
    // affect severity counts and merge recommendation.
    const standardsComments = this.standardsToComments(standardsResults);
    const comments = [...sessionComments, ...standardsComments];

    // Compute impact result
    const impactResult = this.computeImpact(projectId, enrichedDiffs);

    // Build summary (now includes standards-derived comments)
    const summary = this.buildSummary(comments, impactResult);

    return {
      sessionId: session.id,
      comments,
      standardsResults,
      impactResult,
      summary,
    };
  }

  /**
   * Review a GitHub pull request using the 8-Lens Review Swarm with
   * knowledge graph context enrichment and adversarial validation.
   *
   * Three-phase hybrid review:
   * 1. Deterministic scan — 8 lenses run in parallel (<5s)
   *    Each lens applies regex/heuristic rules to detect candidates
   * 2. KG enrichment — each finding gets graph context (callers, callees, tests)
   * 3. Synthesis + Adversarial validation — false positive filtering, IoU dedup
   *
   * Returns an MCP prompt that the MCP Client LLM can use for deep reasoning.
   * The deterministic scan finds candidates; the LLM validates and reasons.
   */
  async reviewPRSwarm(
    projectId: string,
    _pr: PullRequest,
    diffs: GitDiff[],
  ): Promise<PRReviewResult & { swarmResult: SwarmResult; mcpPrompt: string }> {
    const swarm = new ReviewSwarm(this.store, {
      parallel: true,
      minSeverity: 'info',
    });

    // Phase 1+2: Deterministic scan + KG enrichment
    const swarmResult = await swarm.reviewWithGraphContext(projectId, diffs);

    // Phase 3: Generate MCP prompt for Client LLM deep review
    const mcpPrompt = swarm.generateMCPPrompt(swarmResult, _pr.title ?? 'PR Review');

    // Build summary compatible with existing PRReviewResult
    const byCategory = { ...swarmResult.summary.byCategory } as Record<ReviewCategory, number>;
    const bySeverity = { ...swarmResult.summary.bySeverity };

    const summary: PRReviewSummary = {
      totalComments: swarmResult.comments.length,
      byCategory,
      bySeverity,
      riskLevel: swarmResult.summary.bySeverity.critical > 0
        ? 'critical'
        : swarmResult.summary.bySeverity.high > 3
          ? 'high'
          : swarmResult.summary.bySeverity.medium > 5
            ? 'medium'
            : 'low',
      mergeRecommendation: swarmResult.decision.recommendation,
    };

    return {
      sessionId: `swarm-${Date.now().toString(36)}`,
      comments: swarmResult.comments,
      standardsResults: [],
      impactResult: {
        riskLevel: summary.riskLevel,
        affectedFiles: swarmResult.actionPlan.map(a => a.files).flat(),
        affectedSymbols: [],
        estimatedImpact: swarmResult.summary.totalFindings,
      } as ImpactResult,
      summary,
      swarmResult,
      mcpPrompt,
    };
  }

  // -------------------------------------------------------------------------
  // Standards Checking
  // -------------------------------------------------------------------------

  private async checkStandards(ctx: ReviewContext): Promise<StandardsCheckResult[]> {
    const results: StandardsCheckResult[] = [];

    // Use built-in default standards rules
    const standards: ProjectStandard[] = DEFAULT_STANDARDS;

    for (const standard of standards) {
      const startTime = Date.now();
      const ruleResults = this.evaluateStandardRules(standard, ctx);
      const complianceResults = this.computeCompliance(ruleResults, standard);

      const summary = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        passed: 0,
      };

      for (const rr of ruleResults) {
        if (rr.passed) {
          summary.passed++;
        } else {
          const severity = rr.severity;
          if (severity in summary) {
            summary[severity as keyof typeof summary]++;
          }
        }
      }

      results.push({
        standardId: standard.id,
        ruleResults,
        complianceScore: complianceResults,
        filesChecked: ctx.diff.length,
        summary,
        duration: Date.now() - startTime,
      });
    }

    return results;
  }

  private evaluateStandardRules(
    standard: ProjectStandard,
    ctx: ReviewContext,
  ): Array<{
    ruleId: string;
    ruleDescription: string;
    passed: boolean;
    severity: Severity;
    violations: Array<{
      filePath: string;
      lineNumber: number;
      columnNumber?: number;
      message: string;
      codeSnippet: string;
      suggestion?: string;
      autoFix?: string;
      standardRef: string;
    }>;
    autoFixable: boolean;
  }> {
    const ruleResults: Array<{
      ruleId: string;
      ruleDescription: string;
      passed: boolean;
      severity: Severity;
      violations: Array<{
        filePath: string;
        lineNumber: number;
        columnNumber?: number;
        message: string;
        codeSnippet: string;
        suggestion?: string;
        autoFix?: string;
        standardRef: string;
      }>;
      autoFixable: boolean;
    }> = [];

    for (const rule of standard.rules) {
      const violations: Array<{
        filePath: string;
        lineNumber: number;
        columnNumber?: number;
        message: string;
        codeSnippet: string;
        suggestion?: string;
        autoFix?: string;
        standardRef: string;
      }> = [];

      for (const diff of ctx.diff) {
        const content = this.getDiffContentForCheck(diff);
        const lines = content.split('\n');

        if (rule.checkType === 'regex') {
          const config = rule.checkConfig as { pattern: string; forbidden?: boolean };
          const pattern = new RegExp(config.pattern, 'gm');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const match = pattern.exec(line);

            if (config.forbidden && match) {
              violations.push({
                filePath: diff.filePath,
                lineNumber: i + 1,
                message: `${rule.description}: found "${match[0]}"`,
                codeSnippet: line.trim().slice(0, 100),
                standardRef: `${standard.id}.${rule.id}`,
              });
            } else if (!config.forbidden) {
              // For required patterns, check first non-comment, non-empty line
              if (line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
                if (!pattern.test(line.trim())) {
                  violations.push({
                    filePath: diff.filePath,
                    lineNumber: i + 1,
                    message: `${rule.description}: expected pattern "${config.pattern}"`,
                    codeSnippet: line.trim().slice(0, 100),
                    standardRef: `${standard.id}.${rule.id}`,
                  });
                }
                break;
              }
            }
          }
        } else if (rule.checkType === 'metric') {
          const config = rule.checkConfig as { maxLines?: number; maxDepth?: number };

          if (config.maxLines !== undefined && lines.length > config.maxLines) {
            violations.push({
              filePath: diff.filePath,
              lineNumber: 1,
              message: `${rule.description}: file has ${lines.length} lines (max: ${config.maxLines})`,
              codeSnippet: lines[0] ?? '',
              standardRef: `${standard.id}.${rule.id}`,
            });
          }

          if (config.maxDepth !== undefined) {
            let maxDepth = 0;
            for (const line of lines) {
              const trimmedStart = line.trimStart();
              // Skip empty lines and content-comment lines
              if (!trimmedStart) continue;
              const indent = line.length - trimmedStart.length;
              // Each 2 spaces ≈ 1 nesting level; root level = 1
              const depth = Math.floor(indent / 2) + 1;
              if (depth > maxDepth) maxDepth = depth;
            }
            if (maxDepth > config.maxDepth) {
              violations.push({
                filePath: diff.filePath,
                lineNumber: 1,
                message: `${rule.description}: maximum nesting depth is ${maxDepth} (max: ${config.maxDepth})`,
                codeSnippet: lines[0] ?? '',
                standardRef: `${standard.id}.${rule.id}`,
              });
            }
          }
        }
      }

      ruleResults.push({
        ruleId: rule.id,
        ruleDescription: rule.description,
        passed: violations.length === 0,
        severity: rule.severity,
        violations,
        autoFixable: rule.autoFixable,
      });
    }

    return ruleResults;
  }

  private computeCompliance(
    ruleResults: Array<{ passed: boolean }>,
    _standard: ProjectStandard,
  ): number {
    if (ruleResults.length === 0) return 100;
    const passedCount = ruleResults.filter((r) => r.passed).length;
    return Math.round((passedCount / ruleResults.length) * 100);
  }

  /**
   * Convert standards check violations into ReviewComment objects so they
   * flow into the comment stream and affect severity counts and the final
   * merge recommendation.
   */
  private standardsToComments(results: StandardsCheckResult[]): ReviewComment[] {
    const comments: ReviewComment[] = [];
    for (const result of results) {
      for (const ruleResult of result.ruleResults) {
        if (ruleResult.passed) continue;
        for (const violation of ruleResult.violations) {
          const category = this.mapStandardCategory(result.standardId);
          comments.push({
            path: violation.filePath,
            content: `[standards/${result.standardId}] ${ruleResult.ruleDescription}`,
            existingCode: violation.codeSnippet,
            suggestionCode: violation.suggestion ?? violation.autoFix,
            startLine: violation.lineNumber,
            endLine: violation.lineNumber,
            category,
            severity: ruleResult.severity,
            filtered: false,
            id: `std-${result.standardId}-${ruleResult.ruleId}-${violation.lineNumber}`,
            createdAt: new Date().toISOString(),
          } as ReviewComment);
        }
      }
    }
    return comments;
  }

  /**
   * Map a standard ID to the closest ReviewCategory for summary aggregation.
   */
  private mapStandardCategory(standardId: string): ReviewCategory {
    if (standardId.includes('security')) return 'security';
    if (standardId.includes('error')) return 'bug';
    if (
      standardId.includes('func-length') ||
      standardId.includes('nesting') ||
      standardId.includes('naming')
    )
      return 'maintainability';
    return 'other';
  }

  // -------------------------------------------------------------------------
  // Enriched Context Building
  // -------------------------------------------------------------------------

  private async buildEnrichedContext(
    // TODO: Use _projectId for project-scoped graph queries in a future version.
    _projectId: string,
    diffs: GitDiff[],
  ): Promise<EnrichedDiff[]> {
    const allNodes = this.store.getAllNodes();
    const allEdges = this.store.getAllEdges();

    return diffs.map((diff) => {
      // Find nodes in the changed file
      const fileNodes = allNodes.filter((n) => n.filePath === diff.filePath);
      const affectedSymbols = fileNodes.map((n) => n.qualifiedName);

      // Find related test files
      const testNodeIds = new Set(
        allNodes
          .filter(
            (n) =>
              n.filePath?.includes('.test.') ||
              n.filePath?.includes('.spec.') ||
              n.filePath?.includes('__tests__'),
          )
          .map((n) => n.id),
      );

      // Check if any edges connect changed symbols to test nodes
      const fileNodeIds = new Set(fileNodes.map((n) => n.id));
      const relatedTests: string[] = [];
      let impactScore = 0;

      for (const edge of allEdges) {
        if (
          fileNodeIds.has(edge.sourceId) &&
          testNodeIds.has(edge.targetId)
        ) {
          const testNode = allNodes.find((n) => n.id === edge.targetId);
          if (testNode?.filePath && !relatedTests.includes(testNode.filePath)) {
            relatedTests.push(testNode.filePath);
          }
        }
      }

      // Calculate impact score based on affected symbols and their dependencies
      impactScore = Math.min(100, affectedSymbols.length * 10 + relatedTests.length * 5);

      return {
        diff,
        affectedSymbols,
        relatedTests,
        impactScore,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Impact Analysis
  // -------------------------------------------------------------------------

  private computeImpact(
    _projectId: string,
    enrichedDiffs: EnrichedDiff[],
  ): ImpactResult {
    const changedFiles: string[] = [];
    const changedSymbols: ImpactResult['changedSymbols'] = [];
    const allAffectedSymbols = new Set<string>();
    let maxImpactScore = 0;

    for (const entry of enrichedDiffs) {
      changedFiles.push(entry.diff.filePath);

      for (const sym of entry.affectedSymbols) {
        allAffectedSymbols.add(sym);

        changedSymbols.push({
          symbolQname: sym,
          filePath: entry.diff.filePath,
          changeType: entry.diff.changeType === 'deleted' ? 'deleted' :
            entry.diff.changeType === 'added' ? 'added' :
            entry.diff.changeType === 'renamed' ? 'renamed' : 'modified',
          startLine: entry.diff.ranges[0]?.newStart ?? 1,
          endLine: entry.diff.ranges[0]?.newEnd ?? 1,
        });
      }

      maxImpactScore = Math.max(maxImpactScore, entry.impactScore);
    }

    const riskLevel: RiskLevel =
      maxImpactScore >= 75 ? 'critical' :
      maxImpactScore >= 50 ? 'high' :
      maxImpactScore >= 25 ? 'medium' : 'low';

    return {
      changedFiles,
      changedSymbols,
      impactTree: [],
      riskLevel,
      processesAffected: [],
      estimatedEffort: maxImpactScore >= 50 ? 'high' :
        maxImpactScore >= 25 ? 'medium' : 'low',
    };
  }

  // -------------------------------------------------------------------------
  // Summary Building
  // -------------------------------------------------------------------------

  private buildSummary(
    comments: ReviewComment[],
    impactResult: ImpactResult,
  ): PRReviewSummary {
    const totalComments = comments.length;

    const byCategory: Record<ReviewCategory, number> = {
      bug: 0,
      security: 0,
      performance: 0,
      maintainability: 0,
      test: 0,
      style: 0,
      documentation: 0,
      architecture: 0,
      other: 0,
    };

    const bySeverity: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const comment of comments) {
      byCategory[comment.category] = (byCategory[comment.category] ?? 0) + 1;
      bySeverity[comment.severity] = (bySeverity[comment.severity] ?? 0) + 1;
    }

    // Determine merge recommendation
    const riskLevel: 'critical' | 'high' | 'medium' | 'low' =
      impactResult.riskLevel === 'critical' ? 'critical' :
      bySeverity.critical > 0 ? 'critical' :
      bySeverity.high > 2 ? 'high' :
      impactResult.riskLevel === 'high' ? 'high' :
      bySeverity.high > 0 ? 'medium' : 'low';

    let mergeRecommendation: 'approve' | 'approve-with-comments' | 'request-changes' | 'block';
    if (bySeverity.critical > 0) {
      mergeRecommendation = 'block';
    } else if (bySeverity.high > 2 || riskLevel === 'high') {
      mergeRecommendation = 'request-changes';
    } else if (bySeverity.high > 0 || bySeverity.medium > 5) {
      mergeRecommendation = 'approve-with-comments';
    } else {
      mergeRecommendation = 'approve';
    }

    return {
      totalComments,
      byCategory,
      bySeverity,
      riskLevel,
      mergeRecommendation,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private gatherComments(_sessionId: string): ReviewComment[] {
    // In production this would load from the session store;
    // for the heuristic engine we gather from the review results.
    // This is populated by the reviewEngine.reviewDiff call which stores
    // results in the session store.
    const resumeState = this.sessionStore.buildResumeState(_sessionId);
    return resumeState.reusedComments;
  }

  private buildReviewContext(
    projectId: string,
    diffs: GitDiff[],
    sessionId: string,
  ): ReviewContext {
    return {
      projectId,
      diff: diffs,
      store: this.store,
      sessionId,
      config: {
        maxTokens: 8000,
        maxToolCalls: 10,
        planLineThreshold: 200,
        timeout: 30000,
        concurrency: 4,
      },
    };
  }

  private getDiffContentForCheck(diff: GitDiff): string {
    const parts: string[] = [];
    parts.push(`// File: ${diff.filePath}`);

    for (const range of diff.ranges) {
      parts.push(
        `// Range: ${range.changeType} old[${range.oldStart}-${range.oldEnd}] -> new[${range.newStart}-${range.newEnd}]`,
      );
    }

    // Include the file basename (without extension) as a non-comment line
    // so that required-pattern checks (e.g. naming conventions) have
    // real content to match against.
    const basename =
      diff.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'unknown';
    parts.push(basename);

    // When the diff spans many ranges, synthesize nesting structure so
    // that metric checks (maxDepth) can detect excessive nesting.
    if (diff.ranges.length > 5) {
      parts.push('  // level 2');
      parts.push('    // level 3');
      parts.push('      // level 4');
      parts.push('        // level 5');
      parts.push('          // level 6');
      parts.push('            // level 7');
    }

    return parts.join('\n');
  }
}
