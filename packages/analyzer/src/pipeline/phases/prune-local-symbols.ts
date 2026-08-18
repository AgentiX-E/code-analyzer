// @code-analyzer/analyzer — Pipeline Phase: PruneLocalSymbols

import type {
  PipelinePhaseId,
  PipelineContext,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';

// ---------------------------------------------------------------------------
// Phase 11: pruneLocalSymbols — Prune local-only symbols from the graph
// ---------------------------------------------------------------------------

export class PruneLocalSymbolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'pruneLocalSymbols';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Prune local-only symbols from the knowledge graph';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { symbolsPruned: 0 } };
      }

      // Build adjacency — nodes that are referenced by edges (incoming or outgoing)
      const referencedNodeIds = new Set<number>();
      for (const [, edge] of ctx.graph.edges) {
        referencedNodeIds.add(edge.sourceId);
        referencedNodeIds.add(edge.targetId);
      }

      // Identify nodes to prune: local variables and parameters with no edges
      const nodesToPrune: number[] = [];
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Variable' && !referencedNodeIds.has(nodeId)) {
          // Only prune variables that aren't referenced in any edge
          nodesToPrune.push(nodeId);
        }
      }

      // Also prune file-scope symbols with no adjacent edges
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (!referencedNodeIds.has(nodeId)) {
          // Skip File/Folder/Project nodes and already-marked nodes
          if (
            node.label !== 'File' &&
            node.label !== 'Folder' &&
            node.label !== 'Project' &&
            !nodesToPrune.includes(nodeId)
          ) {
            nodesToPrune.push(nodeId);
          }
        }
      }

      // Remove nodes
      for (const nodeId of nodesToPrune) {
        // Remove node from indexes
        const node = ctx.graph.nodes.get(nodeId);
        /* v8 ignore next -- @preserve -- nodeId came from a nodes iteration, so get() is always defined */
        if (node) {
          ctx.graph.qnameIndex.delete(node.qualifiedName);
          if (node.properties?.filePath) {
            ctx.graph.fileIndex.delete(node.properties.filePath);
          }
          ctx.graph.nodes.delete(nodeId);
        }
      }

      ctx.phaseData.set('pruneLocalSymbols', { symbolsPruned: nodesToPrune.length });
      return { phaseId: this.id, status: 'success', output: { symbolsPruned: nodesToPrune.length } };
    } catch (err) {
      /* v8 ignore next -- @preserve -- thrown values are always Error instances in this codebase */
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      /* v8 ignore next -- @preserve -- thrown values are always Error instances in this codebase */
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
