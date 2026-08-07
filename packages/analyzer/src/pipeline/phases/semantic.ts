// @code-analyzer/analyzer — Pipeline Phase: Semantic

import type {
  PipelinePhaseId,
  PipelineContext,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_CALLS, EDGE_HAS_METHOD, EDGE_SEMANTICALLY_RELATED } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 17: semantic — Semantic analysis and relationship detection
// ---------------------------------------------------------------------------

export class SemanticPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'semantic';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Perform semantic analysis on the knowledge graph';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { semanticRelations: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let semanticRelations = 0;

      // Group nodes by type for analysis
      const modules: Array<{ id: number; name: string }> = [];
      const classes: Array<{ id: number; name: string; parent: string | null }> = [];
      const functions: Array<{ id: number; name: string; params: string[] }> = [];

      for (const [nodeId, node] of ctx.graph.nodes) {
        if (node.label === 'Module') {
          modules.push({ id: nodeId, name: node.name });
        } else if (node.label === 'Class') {
          const sig = node.properties?.signature as string | undefined;
          classes.push({ id: nodeId, name: node.name, parent: null });
        } else if (node.label === 'Function' || node.label === 'Method') {
          const sig = node.properties?.signature as string | undefined;
          const params = sig ? sig.replace(/^.*?\(([^)]*)\).*$/, '$1').split(',').map((s: string) => s.trim()).filter(Boolean) : [];
          functions.push({ id: nodeId, name: node.name, params });
        }
      }

      // Semantic heuristic 1: Classes with similar method signatures are related
      const classMethods = new Map<number, string[]>();
      for (const [, edge] of ctx.graph.edges) {
        if (edge.type === EDGE_HAS_METHOD) {
          const target = ctx.graph.nodes.get(edge.targetId);
          if (target) {
            const methods = classMethods.get(edge.sourceId) ?? [];
            methods.push(target.name);
            classMethods.set(edge.sourceId, methods);
          }
        }
      }

      // Find classes with overlapping method names
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const methodsA = classMethods.get(classes[i]!.id) ?? [];
          const methodsB = classMethods.get(classes[j]!.id) ?? [];

          let overlap = 0;
          for (const m of methodsA) {
            if (methodsB.includes(m)) overlap++;
          }

          const overlapRatio = methodsA.length + methodsB.length > 0
            ? (2 * overlap) / (methodsA.length + methodsB.length)
            : 0;

          if (overlapRatio >= 0.3 && methodsA.length >= 2) {
            try {
              builder.addEdge(ctx.graph, classes[i]!.id, classes[j]!.id, EDGE_SEMANTICALLY_RELATED, ctx.projectId);
              semanticRelations++;
            } catch { /* Edge may exist */ }
          }
        }
      }

      // Semantic heuristic 2: Functions sharing caller patterns are related
      const functionCallers = new Map<number, Set<number>>();
      for (const [, edge] of ctx.graph.edges) {
        if (edge.type === EDGE_CALLS && ctx.graph.nodes.has(edge.targetId)) {
          const callers = functionCallers.get(edge.targetId) ?? new Set();
          callers.add(edge.sourceId);
          functionCallers.set(edge.targetId, callers);
        }
      }

      const funcArray = Array.from(functionCallers.entries()).filter(([id]) => {
        const node = ctx.graph!.nodes.get(id);
        return node?.label === 'Function' || node?.label === 'Method';
      });

      for (let i = 0; i < funcArray.length; i++) {
        for (let j = i + 1; j < funcArray.length; j++) {
          const [idA, callersA] = funcArray[i]!;
          const [idB, callersB] = funcArray[j]!;

          // Count shared callers
          let shared = 0;
          for (const caller of callersA) {
            if (callersB.has(caller)) shared++;
          }

          const unionSize = new Set([...callersA, ...callersB]).size;
          const similarity = unionSize > 0 ? shared / unionSize : 0;

          if (similarity >= 0.2 && shared >= 2) {
            try {
              builder.addEdge(ctx.graph, idA, idB, EDGE_SEMANTICALLY_RELATED, ctx.projectId);
              semanticRelations++;
            } catch { /* Edge may exist */ }
          }
        }
      }

      ctx.phaseData.set('semantic', { semanticRelations });
      return { phaseId: this.id, status: 'success', output: { semanticRelations } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}