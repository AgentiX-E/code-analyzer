// @code-analyzer/intelligence — Cross-Repo Contract Validator
// Extracts and validates API contracts across repository boundaries.
// Detects breaking changes: removed exports, changed signatures, renamed symbols.

import type { GraphNode } from '@code-analyzer/shared';
import type { CrossRepoIndexer } from './cross-repo-indexer.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface ContractChange {
  type: 'added' | 'removed' | 'modified' | 'renamed' | 'signature_changed' | 'visibility_changed';
  symbol: string;
  oldSignature?: string;
  newSignature?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectedRepos: string[];
}

export interface ContractValidationResult {
  sourceRepo: string;
  targetRepos: string[];
  changes: ContractChange[];
  breakingCount: number;
  compatible: boolean;
  recommendations: string[];
}

export interface ExtractedContract {
  repo: string;
  symbols: {
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'module';
    signature?: string;
    visibility: 'public' | 'private' | 'protected';
    filePath: string;
  }[];
}

// ---------------------------------------------------------------------------
// ContractValidator
// ---------------------------------------------------------------------------

export class ContractValidator {
  constructor(private indexer: CrossRepoIndexer) {}

  /**
   * Validate contracts across repos by comparing symbol definitions.
   * Detects breaking changes that would affect consumers.
   */
  async validateCrossRepo(
    groupId: string,
    sourceRepoId: string,
    changedSymbols: string[],
  ): Promise<ContractValidationResult> {
    const result: ContractValidationResult = {
      sourceRepo: sourceRepoId,
      targetRepos: [],
      changes: [],
      breakingCount: 0,
      compatible: true,
      recommendations: [],
    };

    // Extract current contracts from source repo
    const sourceContracts = this.extractContracts(sourceRepoId);
    if (sourceContracts.symbols.length === 0) {
      return result;
    }

    // Find target repos that consume symbols from source repo
    const consumerRepos = await this.findConsumerRepos(groupId, sourceRepoId, changedSymbols);
    result.targetRepos = consumerRepos;

    // For each changed symbol, check if consumers would break
    for (const symbolName of changedSymbols) {
      const sourceSymbol = sourceContracts.symbols.find((s) => s.name === symbolName);
      if (!sourceSymbol) {
        // Symbol was removed from source repo
        const affectedRepos = await this.findReposConsumingSymbol(groupId, symbolName);
        result.changes.push({
          type: 'removed',
          symbol: symbolName,
          severity: 'critical',
          description: `Symbol "${symbolName}" was removed from "${sourceRepoId}"`,
          affectedRepos,
        });
        result.breakingCount++;
        result.compatible = false;
        result.recommendations.push(
          `Symbol "${symbolName}" removed from "${sourceRepoId}". Update ${affectedRepos.length} dependent repos.`,
        );
        continue;
      }

      // Check for visibility changes
      if (sourceSymbol.visibility === 'private') {
        const affectedRepos = await this.findReposConsumingSymbol(groupId, symbolName);
        if (affectedRepos.length > 0) {
          result.changes.push({
            type: 'visibility_changed',
            symbol: symbolName,
            severity: 'high',
            description: `Symbol "${symbolName}" was made private, affecting ${affectedRepos.length} external consumers`,
            affectedRepos,
          });
          result.breakingCount++;
          result.compatible = false;
          result.recommendations.push(
            `Symbol "${symbolName}" visibility reduced to private. External consumers in ${affectedRepos.join(', ')} will break.`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Extract API contracts (symbols) from a repo's indexed nodes.
   */
  extractContracts(repoId: string): ExtractedContract {
    const nodes = this.indexer.getRepoNodes(repoId);
    const symbols: ExtractedContract['symbols'] = [];

    for (const node of nodes) {
      if (!node.name) continue;

      const kind = this.inferSymbolKind(node);
      if (kind === 'module') continue; // Skip directory-level nodes

      symbols.push({
        name: node.name,
        kind,
        signature: node.qualifiedName ?? node.name,
        visibility: this.inferVisibility(node),
        filePath: node.filePath ?? '',
      });
    }

    return { repo: repoId, symbols };
  }

  /**
   * Compare two contract sets and identify changes.
   */
  compareContracts(before: ExtractedContract, after: ExtractedContract): ContractChange[] {
    const changes: ContractChange[] = [];
    const beforeMap = new Map(before.symbols.map((s) => [s.name, s]));
    const afterMap = new Map(after.symbols.map((s) => [s.name, s]));

    // Find removed symbols
    for (const [name, beforeSym] of beforeMap) {
      if (!afterMap.has(name)) {
        changes.push({
          type: 'removed',
          symbol: name,
          severity: 'critical',
          description: `Symbol "${name}" was removed`,
          affectedRepos: [],
        });
      }
    }

    // Find added and modified symbols
    for (const [name, afterSym] of afterMap) {
      const beforeSym = beforeMap.get(name);
      if (!beforeSym) {
        changes.push({
          type: 'added',
          symbol: name,
          severity: 'low',
          description: `Symbol "${name}" was added`,
          affectedRepos: [],
        });
        continue;
      }

      if (beforeSym.signature !== afterSym.signature) {
        changes.push({
          type: 'signature_changed',
          symbol: name,
          oldSignature: beforeSym.signature,
          newSignature: afterSym.signature,
          severity: 'high',
          description: `Signature of "${name}" changed`,
          affectedRepos: [],
        });
      }

      if (beforeSym.visibility !== afterSym.visibility) {
        const severity = afterSym.visibility === 'private' ? 'high' : 'medium';
        changes.push({
          type: 'visibility_changed',
          symbol: name,
          severity,
          description: `Visibility of "${name}" changed from "${beforeSym.visibility}" to "${afterSym.visibility}"`,
          affectedRepos: [],
        });
      }
    }

    return changes;
  }

  /**
   * Generate a human-readable contract compliance report.
   */
  generateReport(result: ContractValidationResult): string {
    const lines: string[] = [
      `# Contract Validation Report`,
      ``,
      `**Source Repo**: ${result.sourceRepo}`,
      `**Target Repos**: ${result.targetRepos.join(', ') || 'none'}`,
      `**Compatible**: ${result.compatible ? 'Yes ✅' : 'No ❌'}`,
      `**Breaking Changes**: ${result.breakingCount}`,
      ``,
    ];

    if (result.changes.length > 0) {
      lines.push(`## Changes`, ``);
      for (const change of result.changes) {
        lines.push(`- **${change.type.toUpperCase()}** — ${change.symbol} (${change.severity})`);
        lines.push(`  ${change.description}`);
        if (change.affectedRepos.length > 0) {
          lines.push(`  Affected: ${change.affectedRepos.join(', ')}`);
        }
      }
    }

    if (result.recommendations.length > 0) {
      lines.push(``, `## Recommendations`, ``);
      for (const rec of result.recommendations) {
        lines.push(`- ${rec}`);
      }
    }

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private inferSymbolKind(node: GraphNode): ExtractedContract['symbols'][number]['kind'] {
    const label = node.label;
    switch (label) {
      case 'Function':
        return 'function';
      case 'Class':
        return 'class';
      case 'Interface':
        return 'interface';
      case 'TypeAlias':
        return 'type';
      case 'Enum':
        return 'enum';
      case 'Variable':
        return 'variable';
      case 'Module':
        return 'module';
      default:
        return 'function';
    }
  }

  private inferVisibility(node: GraphNode): 'public' | 'private' | 'protected' {
    if (node.properties?.visibility === 'private') return 'private';
    if (node.properties?.visibility === 'protected') return 'protected';
    // In the knowledge graph, only explicitly marked private symbols are non-public
    if (node.properties?.['access'] === 'private') return 'private';
    if (node.properties?.['access'] === 'protected') return 'protected';
    return 'public';
  }

  private async findConsumerRepos(
    groupId: string,
    sourceRepoId: string,
    _changedSymbols: string[],
  ): Promise<string[]> {
    try {
      const impact = await this.indexer.analyzeCrossRepoImpact(groupId, sourceRepoId);
      return impact.affectedRepos;
    } catch {
      return [];
    }
  }

  private async findReposConsumingSymbol(groupId: string, symbolName: string): Promise<string[]> {
    try {
      const traces = await this.indexer.traceSymbolDependencies(
        groupId,
        '', // empty sourceRepo means search all repos
        symbolName,
      );
      return [...new Set(traces.map((t) => t.targetRepo))];
    } catch {
      return [];
    }
  }
}
