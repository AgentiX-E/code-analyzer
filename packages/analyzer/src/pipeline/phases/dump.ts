// @code-analyzer/analyzer — Pipeline Phase: Dump

import type {
  PipelinePhaseId,
  PipelineContext,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 15: dump — Dump knowledge graph to storage
// ---------------------------------------------------------------------------

export class DumpPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'dump';
  readonly dependencies: PipelinePhaseId[] = [
    'scopeResolution', 'routes', 'tools', 'di',
    'communities', 'processes', 'tests',
  ];
  readonly description = 'Serialize and dump the knowledge graph to storage';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return {
          phaseId: this.id,
          status: 'failed',
          error: 'No knowledge graph available to dump',
        };
      }

      // Create a store and dump the graph
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);

      builder.dumpToStore(ctx.graph, ctx.projectId);

      const nodeCount = ctx.graph.nodes.size;
      const edgeCount = ctx.graph.edges.size;

      return {
        phaseId: this.id,
        status: 'success',
        output: {
          dumpedToStore: true,
          nodeCount,
          edgeCount,
        },
      };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
