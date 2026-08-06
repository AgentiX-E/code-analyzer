// @code-analyzer/analyzer — Pipeline Phase: Processes

import type {
  PipelinePhaseId,
  PipelineContext,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 13: processes — Detect business processes from call chains
// ---------------------------------------------------------------------------

export class ProcessesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'processes';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution', 'routes'];
  readonly description = 'Detect and catalog business process steps';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { processesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let processesFound = 0;

      // Find route nodes as process entry points
      const routeNodes = new Map<number, string>();
      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Route') {
          routeNodes.set(nodeId, node.name);
        }
      }

      for (const [routeNodeId, routeName] of routeNodes) {
        // BFS from route to discover process steps
        const visited = new Set<number>();
        const steps: number[] = [routeNodeId];
        const queue = [routeNodeId];
        visited.add(routeNodeId);

        let iteration = 0;
        while (queue.length > 0 && iteration < 50) {
          const current = queue.shift()!;

          for (const [, edge] of ctx.graph.edges) {
            if (edge.sourceId === current && !visited.has(edge.targetId)) {
              if (
                edge.type === 'CALLS' ||
                edge.type === 'BELONGS_TO' ||
                edge.type === 'IMPORTS'
              ) {
                visited.add(edge.targetId);
                queue.push(edge.targetId);
                steps.push(edge.targetId);
              }
            }
          }
          iteration++;
        }

        if (steps.length > 1) {
          const processName = `process_${routeName.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const qname = `process:${ctx.projectId}:${processName}`;

          const processNode = builder.addNode(ctx.graph, 'Process', processName, {
            name: processName,
            stepCount: steps.length,
          }, qname);

          // Create STEP_IN_PROCESS edges
          for (let i = 0; i < steps.length; i++) {
            builder.addEdge(ctx.graph, steps[i], processNode.id, 'STEP_IN_PROCESS', ctx.projectId);
          }

          processesFound++;
        }
      }

      ctx.phaseData.set('processes', { processesFound });
      return { phaseId: this.id, status: 'success', output: { processesFound } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
