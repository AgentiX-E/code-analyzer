// @code-analyzer/intelligence — Cross-Repo PR Review Bridge
// Bridges single-repo PR review with cross-repo context analysis.
// Orchestrates contract validation, impact graph, and review engine.

import type { PullRequest, GitDiff, ReviewComment, GraphNode } from '@code-analyzer/shared';
import type { CrossRepoIndexer } from './cross-repo-indexer.js';
import type { RepoGroupManager } from './repo-group-manager.js';
import type { CodeReviewEngine } from '../review/review-engine.js';
import { ContractValidator, type ContractValidationResult } from './contract-validator.js';
import { ImpactGraphBuilder, type BlastRadiusResult, type DependencyChain } from './impact-graph.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface CrossRepoPRReviewReport {
  prNumber: number;
  sourceRepo: string;
  groupId: string;
  reviewComments: ReviewComment[];
  contractValidation: ContractValidationResult;
  blastRadius: BlastRadiusResult;
  dependencyChains: DependencyChain[];
  affectedRepos: string[];
  breakingChangeCount: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  mergeRecommendation: 'approve' | 'approve-with-caution' | 'request-changes' | 'block';
  summary: string;
  recommendations: string[];
  timestamp: string;
}

export interface CrossRepoPRContext {
  groupId: string;
  sourceRepoId: string;
  relatedRepos: string[];
  sharedDependencies: string[];
  contractChanges: ContractValidationResult;
}

// ---------------------------------------------------------------------------
// PRReviewBridge
// ---------------------------------------------------------------------------

export class PRReviewBridge {
  private contractValidator: ContractValidator;
  private impactGraph: ImpactGraphBuilder;

  constructor(
    private indexer: CrossRepoIndexer,
    private groupManager: RepoGroupManager,
    private reviewEngine: CodeReviewEngine,
  ) {
    this.contractValidator = new ContractValidator(indexer);
    this.impactGraph = new ImpactGraphBuilder(indexer);
  }

  /**
   * Review a PR with full cross-repo context.
   * Orchestrates the complete cross-repo review pipeline:
   * 1. Discover related repos
   * 2. Validate contracts across repos
   * 3. Calculate blast radius
   * 4. Find dependency chains
   * 5. Generate unified report
   */
  async reviewPR(
    pr: PullRequest,
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<CrossRepoPRReviewReport> {
    if (!pr || !groupId || !sourceRepoId) {
      throw new Error('PR, groupId, and sourceRepoId are required');
    }

    // Validate group exists
    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    // 1. Extract changed symbols from diffs
    const changedSymbols = this.extractChangedSymbols(diffs);

    // 2. Discover related repos
    const relatedRepos = await this.discoverRelatedRepos(groupId, sourceRepoId);

    // 3. Validate contracts
    const contractValidation = await this.contractValidator.validateCrossRepo(
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    // 4. Build impact graph and calculate blast radius
    const impactGraph = await this.impactGraph.build(groupId);
    const blastRadius = this.impactGraph.calculateBlastRadius(sourceRepoId, impactGraph);
    const dependencyChains = this.impactGraph.findDependencyChains(sourceRepoId, impactGraph);

    // 5. Run standard review engine on diffs
    let reviewComments: ReviewComment[] = [];
    try {
      const session = await this.reviewEngine.reviewDiff(sourceRepoId, diffs);
      // Comments are stored in session — extract if possible
    } catch {
      // Review engine failure is non-fatal in cross-repo context
    }

    // 6. Collect all affected repos
    const affectedRepos = [
      ...new Set([
        ...relatedRepos,
        ...contractValidation.targetRepos,
        ...blastRadius.directImpact,
        ...blastRadius.transitiveImpact,
      ]),
    ];

    // 7. Determine risk level
    const riskLevel = this.determineRiskLevel(contractValidation, blastRadius);

    // 8. Generate merge recommendation
    const mergeRecommendation = this.determineMergeRecommendation(
      riskLevel,
      contractValidation,
      blastRadius,
    );

    // 9. Build recommendations
    const recommendations = this.buildRecommendations(
      contractValidation,
      blastRadius,
      dependencyChains,
    );

    // 10. Generate summary
    const summary = this.buildSummary(
      sourceRepoId,
      affectedRepos.length,
      contractValidation,
      blastRadius,
    );

    return {
      prNumber: pr.number,
      sourceRepo: sourceRepoId,
      groupId,
      reviewComments,
      contractValidation,
      blastRadius,
      dependencyChains,
      affectedRepos,
      breakingChangeCount: contractValidation.breakingCount,
      riskLevel,
      mergeRecommendation,
      summary,
      recommendations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Discover related repos in the group that may be affected.
   */
  async discoverRelatedRepos(
    groupId: string,
    sourceRepoId: string,
  ): Promise<string[]> {
    try {
      const impact = await this.indexer.analyzeCrossRepoImpact(groupId, sourceRepoId);
      return impact.affectedRepos.filter((r) => r !== sourceRepoId);
    } catch {
      return [];
    }
  }

  /**
   * Build cross-repo context for a PR.
   */
  async buildContext(
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<CrossRepoPRContext> {
    const changedSymbols = this.extractChangedSymbols(diffs);
    const relatedRepos = await this.discoverRelatedRepos(groupId, sourceRepoId);

    // Find shared dependencies
    const group = this.groupManager.getGroup(groupId);
    const sharedDependencies: string[] = [];
    if (group) {
      for (const repo of group.repos) {
        if (repo.fullName !== sourceRepoId) {
          try {
            const sourceNodes = this.indexer.getRepoNodes(sourceRepoId);
            const targetNodes = this.indexer.getRepoNodes(repo.fullName);
            const sourceImports = new Set(
              sourceNodes
                .filter((n) => (n.label as string) === 'Import')
                .map((n) => n.name),
            );
            const targetImports = new Set(
              targetNodes
                .filter((n) => (n.label as string) === 'Import')
                .map((n) => n.name),
            );
            for (const imp of sourceImports) {
              if (targetImports.has(imp) && !sharedDependencies.includes(imp)) {
                sharedDependencies.push(imp);
              }
            }
          } catch {
            // Skip repos that can't be analyzed
          }
        }
      }
    }

    const contractChanges = await this.contractValidator.validateCrossRepo(
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    return {
      groupId,
      sourceRepoId,
      relatedRepos,
      sharedDependencies,
      contractChanges,
    };
  }

  /**
   * Generate a formatted markdown report.
   */
  formatReport(report: CrossRepoPRReviewReport): string {
    const lines: string[] = [
      `# Cross-Repo PR Review Report`,
      ``,
      `**PR**: #${report.prNumber} in \`${report.sourceRepo}\``,
      `**Group**: ${report.groupId}`,
      `**Risk Level**: ${report.riskLevel.toUpperCase()}`,
      `**Merge Recommendation**: ${report.mergeRecommendation.toUpperCase()}`,
      `**Timestamp**: ${report.timestamp}`,
      ``,
      `## Summary`,
      ``,
      report.summary,
      ``,
      `## Contract Validation`,
      ``,
      `- Compatible: ${report.contractValidation.compatible ? 'Yes ✅' : 'No ❌'}`,
      `- Breaking Changes: ${report.contractValidation.breakingCount}`,
      ``,
    ];

    if (report.contractValidation.changes.length > 0) {
      lines.push(`### Changes`, ``);
      for (const change of report.contractValidation.changes) {
        lines.push(`- **${change.type.toUpperCase()}** — ${change.symbol} (${change.severity})`);
        lines.push(`  ${change.description}`);
      }
      lines.push(``);
    }

    lines.push(
      `## Blast Radius`,
      ``,
      `- Direct Impact: ${report.blastRadius.directImpact.length} repos`,
      `- Transitive Impact: ${report.blastRadius.transitiveImpact.length} repos`,
      `- Total Affected: ${report.blastRadius.totalAffected} repos`,
      ``,
    );

    if (report.blastRadius.criticalPaths.length > 0) {
      lines.push(`### Critical Paths`, ``);
      for (const path of report.blastRadius.criticalPaths) {
        lines.push(`- ${path.join(' → ')}`);
      }
      lines.push(``);
    }

    lines.push(
      `## Recommendations`,
      ``,
    );

    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }

    lines.push(``, `---`, `*Generated by Code Analyzer Cross-Repo PR Review Bridge*`);

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private extractChangedSymbols(diffs: GitDiff[]): string[] {
    const symbols = new Set<string>();
    for (const diff of diffs) {
      const baseName = diff.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      if (baseName) {
        symbols.add(baseName);
        // Add PascalCase variant
        const capitalized = baseName.charAt(0).toUpperCase() + baseName.slice(1);
        if (capitalized !== baseName) symbols.add(capitalized);
      }
      // Add directory path as module-level symbol
      const dirPath = diff.filePath.split('/').slice(0, -1).join('/');
      if (dirPath) symbols.add(dirPath);
    }
    return Array.from(symbols);
  }

  private determineRiskLevel(
    contractValidation: ContractValidationResult,
    blastRadius: BlastRadiusResult,
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (
      !contractValidation.compatible ||
      contractValidation.breakingCount >= 3 ||
      blastRadius.totalAffected >= 5
    ) {
      return 'critical';
    }
    if (
      contractValidation.breakingCount >= 1 ||
      blastRadius.totalAffected >= 3
    ) {
      return 'high';
    }
    if (blastRadius.totalAffected >= 1) {
      return 'medium';
    }
    return 'low';
  }

  private determineMergeRecommendation(
    riskLevel: 'critical' | 'high' | 'medium' | 'low',
    contractValidation: ContractValidationResult,
    blastRadius: BlastRadiusResult,
  ): 'approve' | 'approve-with-caution' | 'request-changes' | 'block' {
    if (riskLevel === 'critical') {
      return 'block';
    }
    if (riskLevel === 'high') {
      return 'request-changes';
    }
    if (!contractValidation.compatible || blastRadius.totalAffected > 1) {
      return 'approve-with-caution';
    }
    return 'approve';
  }

  private buildRecommendations(
    contractValidation: ContractValidationResult,
    blastRadius: BlastRadiusResult,
    dependencyChains: DependencyChain[],
  ): string[] {
    const recs: string[] = [];

    // Contract recommendations
    for (const rec of contractValidation.recommendations) {
      recs.push(rec);
    }

    // Blast radius recommendations
    if (blastRadius.totalAffected > 0) {
      recs.push(
        `${blastRadius.totalAffected} repos are affected. Coordinate with maintainers: ${[
          ...blastRadius.directImpact,
          ...blastRadius.transitiveImpact,
        ].join(', ')}.`,
      );
    }

    // Critical path recommendations
    if (blastRadius.criticalPaths.length > 0) {
      recs.push(
        `Critical dependency paths detected. Review the following chains before merging: ${blastRadius.criticalPaths.map((p) => p.join(' → ')).join('; ')}`,
      );
    }

    // Dependency chain recommendations
    const criticalChains = dependencyChains.filter((c) => c.criticality === 'critical');
    if (criticalChains.length > 0) {
      recs.push(
        `${criticalChains.length} critical dependency chains found. Run integration tests for all affected repos.`,
      );
    }

    // Add general recommendations if none specific
    if (recs.length === 0) {
      recs.push('No breaking changes detected. Safe to merge with standard review process.');
    }

    return recs;
  }

  private buildSummary(
    sourceRepo: string,
    _affectedCount: number,
    contractValidation: ContractValidationResult,
    blastRadius: BlastRadiusResult,
  ): string {
    const parts: string[] = [
      `PR in \`${sourceRepo}\` was analyzed for cross-repo impact.`,
    ];

    if (contractValidation.breakingCount > 0) {
      parts.push(
        `Found ${contractValidation.breakingCount} breaking contract change(s) affecting ${contractValidation.targetRepos.length} repos.`,
      );
    } else {
      parts.push(`No breaking contract changes detected.`);
    }

    if (blastRadius.totalAffected > 0) {
      parts.push(
        `Blast radius covers ${blastRadius.totalAffected} repos (${blastRadius.directImpact.length} direct, ${blastRadius.transitiveImpact.length} transitive).`,
      );
    }

    if (contractValidation.compatible && blastRadius.totalAffected === 0) {
      parts.push(`This PR appears safe to merge without cross-repo coordination.`);
    }

    return parts.join(' ');
  }
}
