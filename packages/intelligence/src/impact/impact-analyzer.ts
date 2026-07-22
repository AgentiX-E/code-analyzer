// @code-analyzer/intelligence — Impact Analyzer
// BFS-based impact analysis that tracks how changes cascade through
// the dependency graph to tests, routes, and execution processes.

import type {
  ImpactResult,
  RiskLevel,
  GraphEdge,
  RelationshipType,
  NodeLabel,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ChangedSymbol } from './change-detector.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface ImpactAnalysisOptions {
  /** BFS traversal depth, default: 3 */
  maxDepth?: number;
  /** Whether to include affected tests, default: true */
  includeTests?: boolean;
  /** Whether to include affected API routes, default: true */
  includeRoutes?: boolean;
  /** Whether to include affected execution processes, default: true */
  includeProcesses?: boolean;
}

export interface ImpactNode {
  nodeId: number;
  name: string;
  qualifiedName: string;
  filePath: string;
  label: string;
  /** Distance from the nearest changed symbol (1 = direct) */
  depth: number;
  /** Edge type that connects to the changed symbol */
  relationship: string;
}

export interface TestImpact {
  testName: string;
  testFile: string;
  testedSymbol: string;
  impactType: 'direct' | 'indirect';
}

export interface RouteImpact {
  routePath: string;
  routeMethod: string;
  handlerFunction: string;
  consumers: string[];
}

export interface ProcessImpact {
  processName: string;
  entryPoint: string;
  affectedSteps: string[];
  severity: 'blocked' | 'degraded' | 'unaffected';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

const TRAVERSAL_RELATIONSHIPS: RelationshipType[] = [
  'CALLS',
  'IMPLEMENTS',
  'EXTENDS',
  'MEMBER_OF',
];

const DEFAULT_MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// ImpactAnalyzer
// ---------------------------------------------------------------------------

export class ImpactAnalyzer {
  constructor(private store: InMemoryGraphStore) {}

  /**
   * Full impact analysis for a set of changed symbols.
   * Finds direct and indirect dependents, affected tests, routes,
   * and processes, then computes the overall risk score.
   */
  async analyze(
    projectId: string,
    changedSymbols: ChangedSymbol[],
    options?: ImpactAnalysisOptions,
  ): Promise<ImpactResult> {
    const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const includeTests = options?.includeTests ?? true;
    const includeRoutes = options?.includeRoutes ?? true;
    const includeProcesses = options?.includeProcesses ?? true;

    // Resolve changed symbols to node IDs
    const symbolIds = this.resolveSymbolIds(changedSymbols);

    if (symbolIds.length === 0) {
      return {
        changedFiles: [],
        changedSymbols: [],
        impactTree: [],
        riskLevel: 'low',
        processesAffected: [],
        estimatedEffort: 'low',
      };
    }

    // Direct dependents (1 hop)
    const directNodes = this.findDirectDependents(projectId, symbolIds);

    // Indirect dependents (BFS up to maxDepth, excluding depth 1 which is direct)
    const allIndirect = this.findIndirectDependents(
      projectId,
      symbolIds,
      maxDepth,
    );
    const indirectNodes = allIndirect.filter((n) => n.depth > 1);

    // Build impact tree
    const impactTree = [...directNodes, ...indirectNodes];

    // Find affected tests
    let testImpacts: TestImpact[] = [];
    if (includeTests) {
      testImpacts = this.findAffectedTests(projectId, [
        ...symbolIds,
        ...impactTree.map((n) => n.nodeId),
      ]);
    }

    // Find affected routes
    if (includeRoutes) {
      this.findAffectedRoutes(projectId, [
        ...symbolIds,
        ...impactTree.map((n) => n.nodeId),
      ]);
    }

    // Find affected processes
    let processImpacts: ProcessImpact[] = [];
    if (includeProcesses) {
      processImpacts = this.findAffectedProcesses(projectId, [
        ...symbolIds,
        ...impactTree.map((n) => n.nodeId),
      ]);
    }

    // Build shared-compatible ChangedSymbol array
    const sharedChangedSymbols = changedSymbols.map(
      (cs) => ({
        symbolQname: cs.qualifiedName,
        filePath: cs.filePath,
        changeType:
          cs.changeType === 'removed'
            ? ('deleted' as const)
            : cs.changeType === 'added'
              ? ('added' as const)
              : ('modified' as const),
        startLine: cs.lineRange[0],
        endLine: cs.lineRange[1],
      }),
    );

    // Build shared-compatible ImpactNode tree
    const sharedImpactTree = this.toSharedImpactNodes(impactTree);

    // Determine risk level
    const riskLevel = this.determineRiskLevel(
      changedSymbols,
      impactTree.length,
      processImpacts,
    );

    // Compute risk score
    const riskScore = this.computeRiskScore({
      changedFiles: [...new Set(changedSymbols.map((s) => s.filePath))],
      changedSymbols: sharedChangedSymbols,
      impactTree: sharedImpactTree,
      riskLevel,
      processesAffected: this.toSharedProcessImpacts(processImpacts),
      estimatedEffort: 'low',
    });

    const estimatedEffort = this.estimateEffort(
      riskScore,
      impactTree.length,
      testImpacts.length,
    );

    // Build final shared ProcessImpact array
    const sharedProcessImpacts = processImpacts.map((pi) => ({
      processName: pi.processName,
      processId: 0,
      severity: this.severityToRiskLevel(pi.severity),
      affectedSteps: pi.affectedSteps.map((_s, i) => i),
      description: `Affected steps: ${pi.affectedSteps.join(', ')}`,
    }));

    return {
      changedFiles: [...new Set(changedSymbols.map((s) => s.filePath))],
      changedSymbols: sharedChangedSymbols,
      impactTree: sharedImpactTree,
      riskLevel,
      processesAffected: sharedProcessImpacts,
      estimatedEffort,
    };
  }

  /**
   * Find direct dependents (1 hop) via CALLS, IMPLEMENTS, EXTENDS, MEMBER_OF.
   * These are nodes that directly depend on any of the changed symbols.
   */
  findDirectDependents(
    projectId: string,
    symbolIds: number[],
  ): ImpactNode[] {
    return this.findIndirectDependents(projectId, symbolIds, 1);
  }

  /**
   * Find indirect dependents via BFS up to maxDepth.
   * Traverses incoming CALLS/IMPLEMENTS/EXTENDS/MEMBER_OF edges
   * to find all transitive dependents.
   */
  findIndirectDependents(
    projectId: string,
    symbolIds: number[],
    maxDepth: number,
  ): ImpactNode[] {
    const visited = new Set<number>(symbolIds);
    const queue: Array<{
      nodeId: number;
      depth: number;
      relationship: string;
    }> = [];
    const result: ImpactNode[] = [];

    // Seed queue with direct dependents of changed symbols
    for (const symId of symbolIds) {
      for (const relType of TRAVERSAL_RELATIONSHIPS) {
        const incoming = this.store.queryEdges({
          projectId,
          targetId: symId,
          type: relType,
          limit: 100000,
        });
        for (const edge of incoming.items) {
          if (!visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            queue.push({
              nodeId: edge.sourceId,
              depth: 1,
              relationship: relType,
            });
          }
        }
      }
    }

    // BFS traversal
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.store.getNode(current.nodeId);

      if (node) {
        result.push({
          nodeId: node.id,
          name: node.name,
          qualifiedName: node.qualifiedName,
          filePath: node.filePath ?? '',
          label: node.label,
          depth: current.depth,
          relationship: current.relationship,
        });
      }

      if (current.depth >= maxDepth) continue;

      // Find transitive dependents for the current node
      for (const relType of TRAVERSAL_RELATIONSHIPS) {
        const incoming = this.store.queryEdges({
          projectId,
          targetId: current.nodeId,
          type: relType,
          limit: 100000,
        });
        for (const edge of incoming.items) {
          if (!visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            queue.push({
              nodeId: edge.sourceId,
              depth: current.depth + 1,
              relationship: relType,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Find tests that are affected by the changed symbols.
   * Looks for TESTS edges pointing to any of the given symbol IDs.
   */
  findAffectedTests(
    projectId: string,
    symbolIds: number[],
  ): TestImpact[] {
    const results: TestImpact[] = [];
    const seen = new Set<number>();

    for (const symId of symbolIds) {
      const testEdges = this.store.queryEdges({
        projectId,
        targetId: symId,
        type: 'TESTS',
        limit: 100000,
      });

      for (const edge of testEdges.items) {
        const testNode = this.store.getNode(edge.sourceId);
        if (!testNode) continue;

        // Deduplicate by test node, not edge (same test may have
        // TESTS edges to multiple symbols)
        if (seen.has(testNode.id)) continue;
        seen.add(testNode.id);

        const targetNode = this.store.getNode(edge.targetId);

        results.push({
          testName: testNode.name,
          testFile: testNode.filePath ?? '',
          testedSymbol: targetNode?.qualifiedName ?? `node-${edge.targetId}`,
          impactType: symbolIds.includes(edge.sourceId)
            ? 'direct'
            : 'indirect',
        });
      }
    }

    return results;
  }

  /**
   * Find API routes affected by the changed symbols.
   * Looks for Route nodes and HANDLES_ROUTE edges connected to
   * the given symbol IDs.
   */
  findAffectedRoutes(
    projectId: string,
    symbolIds: number[],
  ): RouteImpact[] {
    const results: RouteImpact[] = [];
    const seen = new Set<string>();

    // Direct route nodes among the affected symbols
    for (const symId of symbolIds) {
      const node = this.store.getNode(symId);
      if (!node) continue;

      if (
        node.label === 'Route' &&
        node.properties.routePath !== undefined
      ) {
        const routePath =
          typeof node.properties.routePath === 'string'
            ? node.properties.routePath
            : String(node.properties.routePath);

        const routeMethod =
          typeof node.properties.routeMethod === 'string'
            ? node.properties.routeMethod
            : 'GET';

        const key = `${routeMethod}:${routePath}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            routePath,
            routeMethod,
            handlerFunction: node.qualifiedName,
            consumers: [],
          });
        }
      }
    }

    // HANDLES_ROUTE edges from affected symbols
    for (const symId of symbolIds) {
      const routeEdges = this.store.queryEdges({
        projectId,
        sourceId: symId,
        type: 'HANDLES_ROUTE',
        limit: 100000,
      });

      for (const edge of routeEdges.items) {
        const routeNode = this.store.getNode(edge.targetId);
        if (!routeNode) continue;

        const routePath =
          typeof routeNode.properties.routePath === 'string'
            ? routeNode.properties.routePath
            : String(routeNode.properties.routePath ?? '');

        const routeMethod =
          typeof routeNode.properties.routeMethod === 'string'
            ? routeNode.properties.routeMethod
            : 'GET';

        const key = `${routeMethod}:${routePath}`;
        if (!seen.has(key)) {
          seen.add(key);

          // Find consumers of this route
          const consumerEdges = this.store.queryEdges({
            projectId,
            sourceId: routeNode.id,
            type: 'CALLS',
            limit: 100000,
          });
          const consumers = consumerEdges.items.map(
            (e: GraphEdge) =>
              this.store.getNode(e.targetId)?.qualifiedName ??
              `node-${e.targetId}`,
          );

          const handlerNode = this.store.getNode(edge.sourceId);

          results.push({
            routePath,
            routeMethod,
            handlerFunction:
              handlerNode?.qualifiedName ?? `node-${edge.sourceId}`,
            consumers,
          });
        }
      }
    }

    return results;
  }

  /**
   * Find execution processes affected by the changed symbols.
   * Looks for Process nodes and STEP_IN_PROCESS edges connected
   * to the given symbol IDs.
   */
  findAffectedProcesses(
    projectId: string,
    symbolIds: number[],
  ): ProcessImpact[] {
    const results: ProcessImpact[] = [];
    const seen = new Set<number>();

    // Process nodes among the affected symbols
    for (const symId of symbolIds) {
      const node = this.store.getNode(symId);
      if (node && node.label === 'Process') {
        results.push({
          processName: node.name,
          entryPoint: node.qualifiedName,
          affectedSteps: [],
          severity: 'blocked',
        });
      }
    }

    // STEP_IN_PROCESS edges from/to affected symbols
    for (const symId of symbolIds) {
      const processEdges = this.store.queryEdges({
        projectId,
        targetId: symId,
        type: 'STEP_IN_PROCESS',
        limit: 100000,
      });

      for (const edge of processEdges.items) {
        if (seen.has(edge.id)) continue;
        seen.add(edge.id);

        const processNode = this.store.getNode(edge.sourceId);
        const stepNode = this.store.getNode(edge.targetId);

        if (processNode) {
          const existing = results.find(
            (r) => r.processName === processNode.name,
          );

          if (existing) {
            if (stepNode) {
              existing.affectedSteps.push(stepNode.name);
            }
          } else {
            results.push({
              processName: processNode.name,
              entryPoint: processNode.qualifiedName,
              affectedSteps: stepNode ? [stepNode.name] : [],
              severity: 'degraded',
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Compute an overall risk score (0–100) from the impact analysis.
   * Weights: changed symbols (30%), impact breadth (25%), process impact (20%),
   * route impact (15%), test impact (10%).
   */
  computeRiskScore(impactResult: ImpactResult): number {
    let score = 0;

    // Symbol risk (0-30 points)
    const symbolRiskScores: Record<RiskLevel, number> = {
      low: 0,
      medium: 5,
      high: 15,
      critical: 30,
    };

    for (const _cs of impactResult.changedSymbols) {
      // Convert changeType to a proxy for risk if no explicit risk
      score += symbolRiskScores[impactResult.riskLevel] /
        Math.max(1, impactResult.changedSymbols.length);
    }

    // Impact breadth (0-25 points): number of impacted nodes
    const impactCount = impactResult.impactTree.length;
    if (impactCount >= 20) score += 25;
    else if (impactCount >= 10) score += 18;
    else if (impactCount >= 5) score += 12;
    else if (impactCount >= 1) score += 5;

    // Process impact (0-20 points)
    const processCount = impactResult.processesAffected.length;
    if (processCount >= 3) score += 20;
    else if (processCount >= 2) score += 13;
    else if (processCount >= 1) score += 7;

    // File count (0-15 points)
    const fileCount = impactResult.changedFiles.length;
    if (fileCount >= 10) score += 15;
    else if (fileCount >= 5) score += 10;
    else if (fileCount >= 2) score += 5;
    else if (fileCount >= 1) score += 2;

    // Changes magnitude (0-10 points)
    const symbolCount = impactResult.changedSymbols.length;
    if (symbolCount >= 20) score += 10;
    else if (symbolCount >= 10) score += 7;
    else if (symbolCount >= 5) score += 4;
    else if (symbolCount >= 1) score += 1;

    return Math.min(100, Math.round(score));
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private resolveSymbolIds(changedSymbols: ChangedSymbol[]): number[] {
    const ids: number[] = [];
    for (const cs of changedSymbols) {
      const node = this.store.getNodeByQualifiedName(cs.qualifiedName);
      if (node) {
        ids.push(node.id);
      }
    }
    return ids;
  }

  private toSharedImpactNodes(
    nodes: ImpactNode[],
  ): Array<{
    symbolQname: string;
    label: NodeLabel;
    filePath: string;
    impactType: 'direct' | 'indirect' | 'transitive';
    depth: number;
    children: Array<{
      symbolQname: string;
      label: NodeLabel;
      filePath: string;
      impactType: 'direct' | 'indirect' | 'transitive';
      depth: number;
      children: never[];
    }>;
  }> {
    return nodes.map((n) => ({
      symbolQname: n.qualifiedName,
      label: n.label as NodeLabel,
      filePath: n.filePath,
      impactType:
        n.depth === 1
          ? ('direct' as const)
          : n.depth === 2
            ? ('indirect' as const)
            : ('transitive' as const),
      depth: n.depth,
      children: [],
    }));
  }

  private toSharedProcessImpacts(
    impacts: ProcessImpact[],
  ): Array<{
    processName: string;
    processId: number;
    severity: RiskLevel;
    affectedSteps: number[];
    description: string;
  }> {
    return impacts.map((pi) => ({
      processName: pi.processName,
      processId: 0,
      severity: this.severityToRiskLevel(pi.severity),
      affectedSteps: pi.affectedSteps.map((_, i) => i),
      description: `Affected steps: ${pi.affectedSteps.join(', ') || 'none'}`,
    }));
  }

  private severityToRiskLevel(
    severity: ProcessImpact['severity'],
  ): RiskLevel {
    switch (severity) {
      case 'blocked':
        return 'critical';
      case 'degraded':
        return 'medium';
      case 'unaffected':
        return 'low';
    }
  }

  private determineRiskLevel(
    changedSymbols: ChangedSymbol[],
    impactCount: number,
    processImpacts: ProcessImpact[],
  ): RiskLevel {
    const hasBlocked = processImpacts.some((p) => p.severity === 'blocked');
    if (hasBlocked) return 'critical';

    if (impactCount >= 20) return 'critical';
    if (impactCount >= 10) return 'high';

    const symbolRisks = changedSymbols.map((s) => s.riskLevel);
    const maxSymbolRisk = this.maxRisk(symbolRisks);

    if (maxSymbolRisk === 'critical') return 'high';
    if (maxSymbolRisk === 'high') return 'medium';
    if (impactCount >= 5) return 'medium';
    if (impactCount >= 1) return 'low';

    return 'low';
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

  private estimateEffort(
    riskScore: number,
    impactCount: number,
    testCount: number,
  ): 'low' | 'medium' | 'high' {
    if (riskScore >= 70 || impactCount >= 20 || testCount >= 10) return 'high';
    if (riskScore >= 40 || impactCount >= 10) return 'medium';
    return 'low';
  }
}
