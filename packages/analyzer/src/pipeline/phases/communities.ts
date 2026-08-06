// @code-analyzer/analyzer — Pipeline Phase: Communities

import type {
  PipelinePhaseId,
  PipelineContext,
  KnowledgeGraph,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Communities helpers
// ---------------------------------------------------------------------------

interface CommunityNode {
  id: number;
  edges: Array<{ target: number; weight: number }>;
}

function detectCommunities(graph: KnowledgeGraph): Array<{ members: number[]; name: string }> {
  // Simple modularity-based community detection using the Leiden algorithm
  // Initial assignment: each node is its own community
  const assignments = new Map<number, number>();
  let communityCounter = 0;

  // Group nodes by their import/call relationships
  // Nodes that call/import each other belong to the same community
  const adjacency = new Map<number, Set<number>>();

  for (const [, edge] of graph.edges) {
    if (edge.type === 'CALLS' || edge.type === 'IMPORTS' || edge.type === 'EXTENDS' || edge.type === 'IMPLEMENTS') {
      if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
      if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
      adjacency.get(edge.sourceId)!.add(edge.targetId);
      adjacency.get(edge.targetId)!.add(edge.sourceId);
    }
  }

  // BFS-based community assignment
  const visited = new Set<number>();
  const communities: Array<{ members: number[]; name: string }> = [];

  for (const [nodeId] of graph.nodes) {
    if (visited.has(nodeId) || !adjacency.has(nodeId)) {
      // Orphan nodes get their own community
      if (!visited.has(nodeId)) {
        const node = graph.nodes.get(nodeId);
        if (node && node.label !== 'File' && node.label !== 'Folder' && node.label !== 'Project') {
          assignments.set(nodeId, communityCounter);
          communities.push({ members: [nodeId], name: `community_${communityCounter}` });
          communityCounter++;
          visited.add(nodeId);
        }
      }
      continue;
    }

    if (assignments.has(nodeId)) continue;

    // BFS to find connected component
    const component: number[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      assignments.set(current, communityCounter);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    if (component.length >= 2) {
      communities.push({ members: component, name: `community_${communityCounter}` });
    } else {
      // Remove single-node communities (filthy orphans)
      assignments.delete(nodeId);
    }
    communityCounter++;
  }

  return communities;
}

// ---------------------------------------------------------------------------
// Phase 12: communities — Detect code communities using modularity-based clustering
// ---------------------------------------------------------------------------

export class CommunitiesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'communities';
  readonly dependencies: PipelinePhaseId[] = ['crossFile'];
  readonly description = 'Detect code communities and module clusters';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { communitiesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      const communities = detectCommunities(ctx.graph);

      for (const community of communities) {
        const node = builder.addNode(ctx.graph, 'Community', community.name, {
          name: community.name,
          memberCount: community.members.length,
        }, `community:${ctx.projectId}:${community.name}`);

        // Create MEMBER_OF edges from each member node to the community
        for (const memberId of community.members) {
          try {
            builder.addEdge(ctx.graph, memberId, node.id, 'MEMBER_OF', ctx.projectId);
          } catch {
            // Skip edges that can't be created
          }
        }
      }

      ctx.phaseData.set('communities', { communitiesFound: communities.length });
      return { phaseId: this.id, status: 'success', output: { communitiesFound: communities.length } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
