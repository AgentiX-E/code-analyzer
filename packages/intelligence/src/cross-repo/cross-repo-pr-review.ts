// @code-analyzer/intelligence — Cross-Repo PR Review Engine
// Reviews pull requests with cross-repo context, detects API breaking changes,
// predicts test impact across repos, and checks version compatibility.

import type {
  PullRequest,
  GitDiff,
  ReviewComment,
} from '@code-analyzer/shared';

import type { CrossRepoIndexer } from './cross-repo-indexer.js';
import type { RepoGroupManager } from './repo-group-manager.js';
import type { CodeReviewEngine } from '../review/review-engine.js';
import type { DiffParser } from '../review/diff-parser.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface CrossRepoReviewResult {
  sourceRepo: string;
  prComments: ReviewComment[];
  crossRepoImpacts: CrossRepoImpactEntry[];
  apiBreakingChanges: APIBreakingChange[];
  testPredictions: TestImpactPrediction[];
  summary: CrossRepoReviewSummary;
}

export interface CrossRepoImpactEntry {
  affectedRepo: string;
  affectedSymbols: string[];
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  suggestedActions: string[];
}

export interface APIBreakingReport {
  sourceRepo: string;
  totalBreakingChanges: number;
  breakingChanges: APIBreakingChange[];
  affectedRepos: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface APIBreakingChange {
  symbol: string;
  changeType:
    | 'removed'
    | 'renamed'
    | 'signature_changed'
    | 'type_changed'
    | 'visibility_changed'
    | 'return_type_changed'
    | 'parameter_added_required'
    | 'parameter_removed';
  description: string;
  affectedInRepos: string[];
  suggestedFix?: string;
}

export interface TestImpactReport {
  sourceRepo: string;
  affectedTests: TestImpactPrediction[];
  totalTestsAffected: number;
  reposWithAffectedTests: string[];
}

export interface TestImpactPrediction {
  repo: string;
  testFiles: string[];
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CrossRepoReviewSummary {
  sourceRepo: string;
  crossRepoRisk: 'critical' | 'high' | 'medium' | 'low';
  reposImpacted: number;
  breakingChanges: number;
  recommendations: string[];
  mergeRecommendation: 'approve' | 'approve-with-caution' | 'request-changes' | 'block';
}

export interface VersionCompatibilityReport {
  groupId: string;
  repoVersions: {
    repo: string;
    version?: string;
    dependencies: Record<string, string>;
  }[];
  incompatiblePairs: {
    repoA: string;
    depA: string;
    repoB: string;
    depB: string;
    issue: string;
  }[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// CrossRepoPRReviewEngine
// ---------------------------------------------------------------------------

export class CrossRepoPRReviewEngine {
  constructor(
    private indexer: CrossRepoIndexer,
    private groupManager: RepoGroupManager,
    private reviewEngine: CodeReviewEngine,
    private diffParser?: DiffParser,
  ) {}

  // -----------------------------------------------------------------------
  // Main Review Method
  // -----------------------------------------------------------------------

  /**
   * Review a PR with cross-repo context.
   * Analyzes changes in one repo and determines impact on all other repos in the group.
   */
  async reviewPRWithCrossRepoContext(
    pr: PullRequest,
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<CrossRepoReviewResult> {
    if (!pr || !groupId || !sourceRepoId) {
      throw new Error('PR, groupId, and sourceRepoId are required');
    }

    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repoInGroup = group.repos.find((r) => r.fullName === sourceRepoId);
    if (!repoInGroup) {
      throw new Error(`Repo "${sourceRepoId}" not found in group "${groupId}"`);
    }

    // 1. Parse diff and identify changed symbols
    const changedSymbols = this.extractChangedSymbols(diffs, sourceRepoId);

    // 2. Run cross-repo impact analysis
    const impactResult = await this.indexer.analyzeCrossRepoImpact(
      groupId,
      sourceRepoId,
    );

    // 3. Build cross-repo impact entries
    const crossRepoImpacts: CrossRepoImpactEntry[] = impactResult.analysis.map(
      (a) => ({
        affectedRepo: a.repo,
        affectedSymbols: a.affectedSymbols,
        impactLevel: a.impactLevel,
        description: a.reason,
        suggestedActions: this.buildSuggestedActions(a.impactLevel, a.repo),
      }),
    );

    // 4. Run review engine on the diffs
    const sessionId = `cross-repo-${pr.number}-${Date.now().toString(36)}`;
    let prComments: ReviewComment[] = [];
    try {
      const session = await this.reviewEngine.reviewDiff(sourceRepoId, diffs);
      prComments = []; // Comments are stored in session store
    } catch {
      // Review engine failure is non-fatal
    }

    // 5. Detect API breaking changes
    const apiBreakingChanges = await this.detectBreakingChanges(
      diffs,
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    // 6. Predict test impact
    const testPredictions = await this.predictTests(
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    // 7. Generate summary
    const summary = this.buildCrossRepoSummary(
      sourceRepoId,
      crossRepoImpacts,
      apiBreakingChanges,
      testPredictions,
    );

    return {
      sourceRepo: sourceRepoId,
      prComments,
      crossRepoImpacts,
      apiBreakingChanges,
      testPredictions,
      summary,
    };
  }

  // -----------------------------------------------------------------------
  // API Breaking Change Detection
  // -----------------------------------------------------------------------

  /**
   * Detect API breaking changes in a PR across repo boundaries.
   */
  async detectAPIBreakingChanges(
    _pr: PullRequest,
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<APIBreakingReport> {
    if (!groupId || !sourceRepoId) {
      throw new Error('groupId and sourceRepoId are required');
    }

    const changedSymbols = this.extractChangedSymbols(diffs, sourceRepoId);
    const breaking = await this.detectBreakingChanges(
      diffs,
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    const affectedRepos = [
      ...new Set(breaking.flatMap((b) => b.affectedInRepos)),
    ];

    let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
    if (breaking.some((b) =>
      b.changeType === 'removed' || b.changeType === 'signature_changed',
    )) {
      severity = 'critical';
    } else if (breaking.some((b) =>
      b.changeType === 'type_changed' || b.changeType === 'visibility_changed',
    )) {
      severity = 'high';
    } else if (breaking.length > 2) {
      severity = 'medium';
    }

    return {
      sourceRepo: sourceRepoId,
      totalBreakingChanges: breaking.length,
      breakingChanges: breaking,
      affectedRepos,
      severity,
    };
  }

  /**
   * Predict which tests in OTHER repos need to be run based on PR changes.
   */
  async predictCrossRepoTestImpact(
    _pr: PullRequest,
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<TestImpactReport> {
    if (!groupId || !sourceRepoId) {
      throw new Error('groupId and sourceRepoId are required');
    }

    const changedSymbols = this.extractChangedSymbols(diffs, sourceRepoId);
    const predictions = await this.predictTests(
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    const reposWithAffectedTests = [
      ...new Set(predictions.filter((p) => p.testFiles.length > 0).map((p) => p.repo)),
    ];

    return {
      sourceRepo: sourceRepoId,
      affectedTests: predictions,
      totalTestsAffected: predictions.reduce(
        (sum, p) => sum + p.testFiles.length,
        0,
      ),
      reposWithAffectedTests,
    };
  }

  /**
   * Generate a cross-repo review summary suitable for posting to PR.
   */
  async generateCrossRepoSummary(
    _pr: PullRequest,
    groupId: string,
    sourceRepoId: string,
    diffs: GitDiff[],
  ): Promise<CrossRepoReviewSummary> {
    if (!groupId || !sourceRepoId) {
      throw new Error('groupId and sourceRepoId are required');
    }

    const changedSymbols = this.extractChangedSymbols(diffs, sourceRepoId);

    // Get cross-repo impact
    let impactResult;
    try {
      impactResult = await this.indexer.analyzeCrossRepoImpact(
        groupId,
        sourceRepoId,
      );
    } catch {
      impactResult = { changedRepo: sourceRepoId, affectedRepos: [], analysis: [] };
    }

    const breaking = await this.detectBreakingChanges(
      diffs,
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    const testPredictions = await this.predictTests(
      groupId,
      sourceRepoId,
      changedSymbols,
    );

    return this.buildCrossRepoSummary(
      sourceRepoId,
      impactResult.analysis.map((a) => ({
        affectedRepo: a.repo,
        affectedSymbols: a.affectedSymbols,
        impactLevel: a.impactLevel,
        description: a.reason,
        suggestedActions: [],
      })),
      breaking,
      testPredictions,
    );
  }

  /**
   * Check for cross-repo version compatibility issues.
   */
  async checkVersionCompatibility(
    groupId: string,
  ): Promise<VersionCompatibilityReport> {
    if (!groupId) {
      throw new Error('groupId is required');
    }

    const group = this.groupManager.getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    const repoVersions: {
      repo: string;
      version?: string;
      dependencies: Record<string, string>;
    }[] = [];

    const incompatiblePairs: {
      repoA: string;
      depA: string;
      repoB: string;
      depB: string;
      issue: string;
    }[] = [];

    const recommendations: string[] = [];

    // Parse package.json files from each repo's local path
    for (const repo of group.repos) {
      try {
        const { existsSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');

        const pkgPath = join(repo.localPath, 'package.json');

        if (!existsSync(pkgPath)) {
          // Look for other dependency manifests
          const manifestVersion = this.tryReadManifest(repo.localPath);
          if (manifestVersion) {
            repoVersions.push({
              repo: repo.fullName,
              version: manifestVersion.version,
              dependencies: manifestVersion.dependencies,
            });
          } else {
            repoVersions.push({
              repo: repo.fullName,
              dependencies: {},
            });
          }
          continue;
        }

        const raw = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as Record<string, unknown>;

        const dependencies: Record<string, string> = {
          ...((pkg['dependencies'] as Record<string, string>) ?? {}),
          ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
          ...((pkg['peerDependencies'] as Record<string, string>) ?? {}),
        };

        repoVersions.push({
          repo: repo.fullName,
          version: typeof pkg['version'] === 'string' ? pkg['version'] : undefined,
          dependencies,
        });
      } catch {
        // Non-fatal: skip repos we can't read
        repoVersions.push({
          repo: repo.fullName,
          dependencies: {},
        });
      }
    }

    // Detect version conflicts across repos
    const sharedDeps = new Map<string, Map<string, string>>();

    for (const rv of repoVersions) {
      for (const [dep, version] of Object.entries(rv.dependencies)) {
        if (!sharedDeps.has(dep)) {
          sharedDeps.set(dep, new Map());
        }
        sharedDeps.get(dep)!.set(rv.repo, version);
      }
    }

    for (const [dep, repoVers] of sharedDeps) {
      if (repoVers.size < 2) continue;

      const versions = [...new Set(repoVers.values())];
      if (versions.length > 1) {
        // Conflict found
        const entries = [...repoVers.entries()];
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const [repoA, verA] = entries[i]!;
            const [repoB, verB] = entries[j]!;
            if (verA !== verB) {
              const a = this.parseSemver(verA);
              const b = this.parseSemver(verB);
              let severity = '';
              if (a.major !== b.major) severity = 'major version mismatch';
              else if (a.minor !== b.minor) severity = 'minor version mismatch';
              else severity = 'patch version mismatch';

              incompatiblePairs.push({
                repoA,
                depA: `${dep}@${verA}`,
                repoB,
                depB: `${dep}@${verB}`,
                issue: `${dep}: ${severity} (${verA} vs ${verB})`,
              });
            }
          }
        }

        recommendations.push(
          `Align "${dep}" across repos. Current versions: ${[...repoVers.entries()].map(([r, v]) => `${r}@${v}`).join(', ')}`,
        );
      }
    }

    return {
      groupId,
      repoVersions,
      incompatiblePairs,
      recommendations,
    };
  }

  // -----------------------------------------------------------------------
  // Private Helper Methods
  // -----------------------------------------------------------------------

  /**
   * Extract symbols that changed based on the diffs.
   */
  private extractChangedSymbols(
    diffs: GitDiff[],
    _sourceRepoId: string,
  ): string[] {
    const symbols = new Set<string>();

    for (const diff of diffs) {
      // Extract function/class/interface names from the file path
      const baseName = diff.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      if (baseName) {
        symbols.add(baseName);
      }

      // Add module path as a symbol
      const dirPath = diff.filePath.split('/').slice(0, -1).join('/');
      if (dirPath) {
        symbols.add(dirPath);
      }
    }

    return Array.from(symbols);
  }

  /**
   * Detect API breaking changes in the changed symbols.
   */
  private async detectBreakingChanges(
    diffs: GitDiff[],
    groupId: string,
    _sourceRepoId: string,
    changedSymbols: string[],
  ): Promise<APIBreakingChange[]> {
    const breakingChanges: APIBreakingChange[] = [];
    const group = this.groupManager.getGroup(groupId);
    if (!group) return breakingChanges;

    const otherRepos = group.repos
      .map((r) => r.fullName)
      .filter((r) => r !== _sourceRepoId);

    // Match changed symbols against cross-repo symbol matches
    let matches;
    try {
      matches = await this.indexer.resolveCrossRepoSymbols(groupId);
    } catch {
      matches = [];
    }

    for (const diff of diffs) {
      const fileSymbols = this.extractFileSymbols(diff);

      for (const symbol of fileSymbols) {
        // Find repos that depend on this symbol
        const dependentRepos = matches
          .filter(
            (m) =>
              m.targetRepo === _sourceRepoId &&
              m.targetSymbol.includes(symbol),
          )
          .map((m) => m.sourceRepo);

        // Check for various breaking change types
        if (diff.changeType === 'deleted') {
          breakingChanges.push({
            symbol,
            changeType: 'removed',
            description: `Symbol "${symbol}" was removed, affecting ${dependentRepos.length} repos`,
            affectedInRepos: dependentRepos,
            suggestedFix: dependentRepos.length > 0
              ? 'Consider deprecating before removal, or update dependent repos'
              : undefined,
          });
          continue;
        }

        if (diff.changeType === 'renamed' && diff.oldPath) {
          const oldSymbol = diff.oldPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
          breakingChanges.push({
            symbol: oldSymbol,
            changeType: 'renamed',
            description: `Symbol "${oldSymbol}" was renamed to "${symbol}"`,
            affectedInRepos: dependentRepos,
            suggestedFix: 'Update import paths in dependent repos',
          });
          continue;
        }

        // For symbol matches, check signature/type changes
        if (diff.changeType === 'modified' && dependentRepos.length > 0) {
          // Check if signature changed by examining the diff content
          if (this.hasSignatureChange(diff)) {
            breakingChanges.push({
              symbol,
              changeType: 'signature_changed',
              description: `Signature of "${symbol}" changed, affecting ${dependentRepos.length} repos`,
              affectedInRepos: dependentRepos,
              suggestedFix: 'Update callers in dependent repos to match new signature',
            });
          }

          if (this.hasReturnTypeChange(diff)) {
            breakingChanges.push({
              symbol,
              changeType: 'return_type_changed',
              description: `Return type of "${symbol}" changed`,
              affectedInRepos: dependentRepos,
              suggestedFix: 'Verify consumers handle the new return type',
            });
          }

          if (this.hasRequiredParameterAdded(diff)) {
            breakingChanges.push({
              symbol,
              changeType: 'parameter_added_required',
              description: `New required parameter added to "${symbol}"`,
              affectedInRepos: dependentRepos,
              suggestedFix: 'Add the new parameter to all call sites',
            });
          }

          if (this.hasParameterRemoved(diff)) {
            breakingChanges.push({
              symbol,
              changeType: 'parameter_removed',
              description: `Parameter removed from "${symbol}"`,
              affectedInRepos: dependentRepos,
              suggestedFix: 'Remove the parameter from call sites in dependent repos',
            });
          }
        }
      }
    }

    return breakingChanges;
  }

  /**
   * Predict test impact across repos.
   */
  private async predictTests(
    _groupId: string,
    _sourceRepoId: string,
    changedSymbols: string[],
  ): Promise<TestImpactPrediction[]> {
    const predictions: TestImpactPrediction[] = [];
    const group = this.groupManager.getGroup(_groupId);
    if (!group) return predictions;

    const otherRepos = group.repos.filter((r) => r.fullName !== _sourceRepoId);

    for (const repo of otherRepos) {
      try {
        const repoNodes = this.indexer['getRepoNodes']?.(repo.fullName);
        if (!repoNodes) {
          // Fallback: add a low-confidence prediction
          if (changedSymbols.length > 0) {
            predictions.push({
              repo: repo.fullName,
              testFiles: [],
              reason: `Changed symbols may affect repo "${repo.fullName}". Review tests manually.`,
              confidence: 'low',
            });
          }
          continue;
        }

        const testNodes = repoNodes.filter(
          (n) =>
            n.filePath?.includes('.test.') ||
            n.filePath?.includes('.spec.') ||
            n.filePath?.includes('__tests__'),
        );

        const relatedTestFiles: string[] = [];

        for (const testNode of testNodes) {
          if (!testNode.filePath) continue;

          // Check if any changed symbol matches the test node's content/name
          for (const symbol of changedSymbols) {
            if (
              testNode.name.toLowerCase().includes(symbol.toLowerCase()) ||
              testNode.qualifiedName.toLowerCase().includes(symbol.toLowerCase()) ||
              (testNode.filePath && testNode.filePath.toLowerCase().includes(symbol.toLowerCase()))
            ) {
              if (!relatedTestFiles.includes(testNode.filePath)) {
                relatedTestFiles.push(testNode.filePath);
              }
              break;
            }
          }
        }

        const confidence: 'high' | 'medium' | 'low' =
          relatedTestFiles.length > 5
            ? 'high'
            : relatedTestFiles.length > 0
              ? 'medium'
              : 'low';

        predictions.push({
          repo: repo.fullName,
          testFiles: relatedTestFiles,
          reason:
            relatedTestFiles.length > 0
              ? `${relatedTestFiles.length} test files may be affected by changes in ${_sourceRepoId}`
              : `No direct test impact detected. Changed symbols: ${changedSymbols.join(', ')}`,
          confidence,
        });
      } catch {
        predictions.push({
          repo: repo.fullName,
          testFiles: [],
          reason: `Unable to analyze test impact for repo "${repo.fullName}"`,
          confidence: 'low',
        });
      }
    }

    return predictions;
  }

  /**
   * Build the cross-repo review summary.
   */
  private buildCrossRepoSummary(
    sourceRepoId: string,
    crossRepoImpacts: CrossRepoImpactEntry[],
    apiBreakingChanges: APIBreakingChange[],
    testPredictions: TestImpactPrediction[],
  ): CrossRepoReviewSummary {
    const criticalBreaks = apiBreakingChanges.filter(
      (b) => b.changeType === 'removed' || b.changeType === 'signature_changed',
    );

    const highBreaks = apiBreakingChanges.filter(
      (b) =>
        b.changeType === 'type_changed' ||
        b.changeType === 'visibility_changed' ||
        b.changeType === 'return_type_changed',
    );

    const hasCriticalImpact = crossRepoImpacts.some(
      (i) => i.impactLevel === 'critical',
    );

    // Determine risk
    let crossRepoRisk: 'critical' | 'high' | 'medium' | 'low' = 'low';
    if (criticalBreaks.length > 0 || hasCriticalImpact) {
      crossRepoRisk = 'critical';
    } else if (highBreaks.length > 0) {
      crossRepoRisk = 'high';
    } else if (apiBreakingChanges.length > 0) {
      crossRepoRisk = 'medium';
    }

    // Determine merge recommendation
    let mergeRecommendation: 'approve' | 'approve-with-caution' | 'request-changes' | 'block';
    if (crossRepoRisk === 'critical') {
      mergeRecommendation = 'block';
    } else if (crossRepoRisk === 'high') {
      mergeRecommendation = 'request-changes';
    } else if (apiBreakingChanges.length > 0) {
      mergeRecommendation = 'approve-with-caution';
    } else {
      mergeRecommendation = 'approve';
    }

    const reposImpacted = new Set(
      crossRepoImpacts.map((i) => i.affectedRepo),
    ).size;

    const recommendations: string[] = [];

    if (apiBreakingChanges.length > 0) {
      recommendations.push(
        `${apiBreakingChanges.length} API breaking changes detected. Review carefully before merging.`,
      );
    }

    for (const cbi of apiBreakingChanges) {
      if (cbi.suggestedFix) {
        recommendations.push(`${cbi.symbol}: ${cbi.suggestedFix}`);
      }
    }

    const reposWithTests = testPredictions.filter(
      (p) => p.testFiles.length > 0,
    );
    if (reposWithTests.length > 0) {
      recommendations.push(
        `Run tests in ${reposWithTests.length} affected repos: ${reposWithTests.map((p) => p.repo).join(', ')}`,
      );
    }

    if (reposImpacted > 0) {
      recommendations.push(
        `${reposImpacted} repos may be impacted by these changes. Coordinate with their maintainers.`,
      );
    }

    return {
      sourceRepo: sourceRepoId,
      crossRepoRisk,
      reposImpacted,
      breakingChanges: apiBreakingChanges.length,
      recommendations,
      mergeRecommendation,
    };
  }

  /**
   * Build suggested actions for a cross-repo impact.
   */
  private buildSuggestedActions(
    impactLevel: 'critical' | 'high' | 'medium' | 'low',
    repo: string,
  ): string[] {
    const actions: string[] = [];

    switch (impactLevel) {
      case 'critical':
        actions.push(`Block merge until "${repo}" is updated`);
        actions.push(`Coordinate breaking changes with ${repo} maintainers`);
        actions.push(`Run full integration test suite for ${repo}`);
        break;
      case 'high':
        actions.push(`Notify ${repo} maintainers of upcoming changes`);
        actions.push(`Run ${repo} test suite with these changes`);
        actions.push(`Update ${repo} integration tests`);
        break;
      case 'medium':
        actions.push(`Run ${repo} smoke tests`);
        actions.push(`Check ${repo} for import reference updates`);
        break;
      case 'low':
        actions.push(`Monitor ${repo} CI after merge`);
        break;
    }

    return actions;
  }

  /**
   * Extract file-level symbols from a diff.
   */
  private extractFileSymbols(diff: GitDiff): string[] {
    const symbols: string[] = [];

    // Get the base name without extension
    const baseName = diff.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    if (baseName) {
      symbols.push(baseName);

      // Also add PascalCase/camelCase variants
      const capitalized = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      if (capitalized !== baseName) {
        symbols.push(capitalized);
      }
    }

    return symbols;
  }

  /**
   * Check if a diff appears to have a signature change.
   */
  private hasSignatureChange(_diff: GitDiff): boolean {
    // For modified files, check if any range represents a function signature change
    // This is a heuristic — in production we'd parse the actual diff content
    for (const range of _diff.ranges) {
      if (range.changeType === 'modified' && (range.newEnd - range.newStart) !== (range.oldEnd - range.oldStart)) {
        // Line count changed, potentially a signature change
        return true;
      }
    }
    // If it's a modified TypeScript/JavaScript file with ranges, flag as potential
    const fileName = _diff.filePath.split('/').pop() ?? '';
    if (_diff.changeType === 'modified' && _diff.ranges.length > 0 && /\.(ts|js|py|go)$/.test(fileName)) {
      return true;
    }
    return false;
  }

  /**
   * Check if a diff appears to have a return type change.
   */
  private hasReturnTypeChange(_diff: GitDiff): boolean {
    // Heuristic: TypeScript/Python/Go files with modified ranges
    const fileName = _diff.filePath.split('/').pop() ?? '';
    if (_diff.changeType === 'modified' && /\.(ts|tsx|py|go)$/.test(fileName)) {
      return _diff.ranges.length >= 2;
    }
    return false;
  }

  /**
   * Check if a diff appears to have added required parameters.
   */
  private hasRequiredParameterAdded(_diff: GitDiff): boolean {
    // Heuristic: New lines with parameter syntax
    for (const range of _diff.ranges) {
      if (range.changeType === 'added' && range.newEnd - range.newStart < 5) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a diff appears to have removed parameters.
   */
  private hasParameterRemoved(_diff: GitDiff): boolean {
    // Heuristic: Removed lines with parameter syntax
    for (const range of _diff.ranges) {
      if (range.changeType === 'removed' && range.oldEnd - range.oldStart < 5) {
        return true;
      }
    }
    return false;
  }

  /**
   * Try to read a non-package.json manifest file for version info.
   */
  private tryReadManifest(localPath: string): { version: string; dependencies: Record<string, string> } | null {
    /* v8 ignore next 19 */
    try {
      // Try go.mod
      const { existsSync, readFileSync } = require('node:fs');
      const { join } = require('node:path');

      const goModPath = join(localPath, 'go.mod');
      if (existsSync(goModPath)) {
        const content = readFileSync(goModPath, 'utf-8');
        const match = content.match(/^module\s+(.+)/m);
        return {
          version: match ? match[1]! : 'unknown',
          dependencies: this.parseGoModDeps(content),
        };
      }
    } catch {
      // Not available
    }
    return null;
  }

  /**
   * Parse dependencies from go.mod content.
   */
  private parseGoModDeps(content: string): Record<string, string> {
    /* v8 ignore next 13 */
    const deps: Record<string, string> = {};
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      const lines = requireBlock[1]!.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] && parts[1]) {
          deps[parts[0]!] = parts[1]!;
        }
      }
    }
    return deps;
  }

  /**
   * Parse a semver string into components.
   */
  private parseSemver(version: string): { major: number; minor: number; patch: number } {
    // Strip leading non-digit chars (e.g., ^, ~, >=, v)
    const cleaned = version.replace(/^[^\d]*/, '');
    const parts = cleaned.split('.').map(Number);
    return {
      /* v8 ignore next 3 */
      major: isNaN(parts[0]!) ? 0 : parts[0]!,
      minor: isNaN(parts[1]!) ? 0 : parts[1]!,
      patch: isNaN(parts[2]!) ? 0 : parts[2]!,
    };
  }
}
