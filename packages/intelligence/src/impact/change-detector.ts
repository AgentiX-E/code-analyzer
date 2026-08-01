// @code-analyzer/intelligence — Change Detector
// Detects changed symbols from git diffs and classifies risk per change.

import type {
  GitDiff,
  RiskLevel,
  GraphNode,
  RelationshipType,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface ChangeDetectionResult {
  changedSymbols: ChangedSymbol[];
  addedSymbols: string[];
  removedSymbols: string[];
  modifiedSymbols: string[];
  riskByFile: Map<string, RiskLevel>;
  overallRisk: RiskLevel;
}

export interface ChangedSymbol {
  name: string;
  qualifiedName: string;
  filePath: string;
  changeType: 'added' | 'modified' | 'removed';
  lineRange: [number, number];
  riskLevel: RiskLevel;
  reason: string;
}

export interface SymbolWithChanges {
  symbol: ChangedSymbol;
  callers: string[];
  callees: string[];
  tests: string[];
  routes: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

const DEPENDENT_RELATIONSHIPS: RelationshipType[] = [
  'CALLS',
  'IMPLEMENTS',
  'EXTENDS',
  'MEMBER_OF',
];

// ---------------------------------------------------------------------------
// ChangeDetector
// ---------------------------------------------------------------------------

export class ChangeDetector {
  constructor(private store: InMemoryGraphStore) {}

  /**
   * Detect changed symbols from a set of git diffs.
   * For each diff, maps changed line ranges to symbols and classifies risk.
   */
  async detectChanges(
    projectId: string,
    diffs: GitDiff[],
  ): Promise<ChangeDetectionResult> {
    const allChangedSymbols: ChangedSymbol[] = [];
    const riskByFile = new Map<string, RiskLevel>();

    for (const diff of diffs) {
      const symbolsWithChanges = await this.mapDiffToSymbols(projectId, diff);

      for (const swc of symbolsWithChanges) {
        allChangedSymbols.push(swc.symbol);
      }

      const fileSymbols = allChangedSymbols.filter(
        (s) => s.filePath === diff.filePath,
      );
      const maxRisk = this.maxRisk(fileSymbols.map((s) => s.riskLevel));
      riskByFile.set(diff.filePath, maxRisk);
    }

    const addedSymbols = allChangedSymbols
      .filter((s) => s.changeType === 'added')
      .map((s) => s.qualifiedName);

    const removedSymbols = allChangedSymbols
      .filter((s) => s.changeType === 'removed')
      .map((s) => s.qualifiedName);

    const modifiedSymbols = allChangedSymbols
      .filter((s) => s.changeType === 'modified')
      .map((s) => s.qualifiedName);

    const overallRisk = this.maxRisk(
      allChangedSymbols.map((s) => s.riskLevel),
    );

    return {
      changedSymbols: allChangedSymbols,
      addedSymbols,
      removedSymbols,
      modifiedSymbols,
      riskByFile,
      overallRisk,
    };
  }

  /**
   * Map a single git diff to affected symbols with dependency context.
   * For each diff range, finds overlapping symbols and resolves callers,
   * callees, tests, and routes.
   */
  async mapDiffToSymbols(
    projectId: string,
    diff: GitDiff,
  ): Promise<SymbolWithChanges[]> {
    const results: SymbolWithChanges[] = [];
    const symbolChangeType = this.mapChangeType(diff.changeType);

    for (const range of diff.ranges) {
      const startLine =
        diff.changeType === 'added' ? range.newStart : range.oldStart;
      const endLine =
        diff.changeType === 'added' ? range.newEnd : range.oldEnd;

      const symbols = this.getSymbolsInRange(
        projectId,
        diff.filePath,
        startLine,
        endLine,
      );

      for (const symbol of symbols) {
        symbol.changeType = symbolChangeType;

        const node = this.store.getNodeByQualifiedName(symbol.qualifiedName);
        if (!node) continue;

        const nodeId = node.id;

        // Callers: incoming CALLS edges
        const incomingCalls = this.store.queryEdges({
          projectId,
          targetId: nodeId,
          type: 'CALLS',
          limit: 100000,
        });
        const callers = incomingCalls.items.map(
          (e) =>
            this.store.getNode(e.sourceId)?.qualifiedName ??
            `node-${e.sourceId}`,
        );

        // Callees: outgoing CALLS edges
        const outgoingCalls = this.store.queryEdges({
          projectId,
          sourceId: nodeId,
          type: 'CALLS',
          limit: 100000,
        });
        const callees = outgoingCalls.items.map(
          (e) =>
            this.store.getNode(e.targetId)?.qualifiedName ??
            `node-${e.targetId}`,
        );

        // Tests: incoming TESTS edges
        const testEdges = this.store.queryEdges({
          projectId,
          targetId: nodeId,
          type: 'TESTS',
          limit: 100000,
        });
        const tests = testEdges.items.map(
          (e) =>
            this.store.getNode(e.sourceId)?.qualifiedName ??
            `node-${e.sourceId}`,
        );

        // Routes: check if node handles route or is a route
        const routeEdges = this.store.queryEdges({
          projectId,
          sourceId: nodeId,
          type: 'HANDLES_ROUTE',
          limit: 100000,
        });
        const routes = routeEdges.items.map(
          (e) =>
            this.store.getNode(e.targetId)?.qualifiedName ??
            `node-${e.targetId}`,
        );

        const context = {
          isExported: node.isExported,
          degree: this.computeDependentDegree(projectId, nodeId),
          isRoute:
            node.label === 'Route' ||
            (node.properties.routePath !== undefined &&
              node.properties.routePath !== null),
          isInterface: node.label === 'Interface',
        };
        symbol.riskLevel = this.classifyRisk(symbol, context);

        results.push({
          symbol,
          callers,
          callees,
          tests,
          routes,
        });
      }
    }

    return results;
  }

  /**
   * Classify risk level for a changed symbol based on its context.
   *
   * Rules:
   * - **Critical**: exported interface, API route, or public API with >10 dependents
   * - **High**: exported function/class, core module, or >5 dependents
   * - **Medium**: internal function with 1-5 dependents
   * - **Low**: private function, no dependents, or test-only
   */
  classifyRisk(
    _symbol: ChangedSymbol,
    context: {
      isExported: boolean;
      degree: number;
      isRoute: boolean;
      isInterface: boolean;
    },
  ): RiskLevel {
    // Critical: exported interface with any dependents
    if (context.isInterface && context.isExported && context.degree > 0) {
      return 'critical';
    }

    // Critical: API route with >10 dependents
    if (context.isRoute && context.degree > 10) {
      return 'critical';
    }

    // Critical: public API with >10 dependents
    if (context.isExported && context.degree > 10) {
      return 'critical';
    }

    // High: exported function/class with >5 dependents
    if (context.isExported && context.degree > 5) {
      return 'high';
    }

    // High: non-exported but heavily depended on (>5 dependents)
    if (context.degree > 5) {
      return 'high';
    }

    // Medium: internal function with 1-5 dependents
    if (context.degree >= 1 && context.degree <= 5) {
      return 'medium';
    }

    // Low: private function, no dependents, test-only
    return 'low';
  }

  /**
   * Get all symbols whose line ranges overlap with [startLine, endLine].
   */
  getSymbolsInRange(
    projectId: string,
    filePath: string,
    startLine: number,
    endLine: number,
  ): ChangedSymbol[] {
    const allNodes = this.store.getAllNodes();

    return allNodes
      .filter(
        (n: GraphNode) =>
          n.projectId === projectId &&
          n.filePath === filePath &&
          n.startLine !== null &&
          n.endLine !== null,
      )
      .filter(
        (n: GraphNode) => n.startLine! <= endLine && n.endLine! >= startLine,
      )
      .map(
        (n: GraphNode): ChangedSymbol => ({
          name: n.name,
          qualifiedName: n.qualifiedName,
          filePath: n.filePath ?? filePath,
          changeType: 'modified',
          lineRange: [n.startLine!, n.endLine!],
          riskLevel: 'low',
          reason: `Symbol overlaps change range [${startLine}, ${endLine}]`,
        }),
      );
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private mapChangeType(
    diffChangeType: GitDiff['changeType'],
  ): ChangedSymbol['changeType'] {
    switch (diffChangeType) {
      case 'added':
        return 'added';
      case 'deleted':
        return 'removed';
      case 'modified':
      case 'renamed':
        return 'modified';
    }
  }

  private computeDependentDegree(
    projectId: string,
    nodeId: number,
  ): number {
    let degree = 0;
    for (const relType of DEPENDENT_RELATIONSHIPS) {
      const incoming = this.store.queryEdges({
        projectId,
        targetId: nodeId,
        type: relType,
        limit: 100000,
      });
      degree += incoming.items.length;
    }
    return degree;
  }

  private maxRisk(risks: RiskLevel[]): RiskLevel {
    if (risks.length === 0) return 'low';
    let maxIdx = 0;
    for (const r of risks) {
      const idx = RISK_ORDER.indexOf(r);
      if (idx > maxIdx) maxIdx = idx;
    }
    return RISK_ORDER[maxIdx]!;
  }
}
