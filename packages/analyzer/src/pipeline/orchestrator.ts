// @code-analyzer/analyzer — Pipeline Orchestrator
// DAG-based execution engine using Kahn's algorithm for topological sort.

import type { ExecutablePhase } from './phases.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  KnowledgeGraph,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  type: 'cycle' | 'missing_dependency' | 'duplicate_id';
  message: string;
  phaseId?: PipelinePhaseId;
}

export interface PipelineResult {
  status: 'complete' | 'partial' | 'failed';
  phases: PhaseResult[];
  graph: KnowledgeGraph;
  duration: number;
  errors: PhaseError[];
}

export interface PhaseResult {
  phaseId: PipelinePhaseId;
  status: 'success' | 'failed' | 'skipped';
  duration: number;
  output?: unknown;
  error?: string;
}

export interface PhaseError {
  phaseId: PipelinePhaseId;
  file?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// PipelineOrchestrator
// ---------------------------------------------------------------------------

export class PipelineOrchestrator {
  private readonly phases: Map<PipelinePhaseId, ExecutablePhase>;

  constructor(phases: ExecutablePhase[]) {
    this.phases = new Map();
    for (const phase of phases) {
      if (this.phases.has(phase.id)) {
        throw new Error(`Duplicate phase ID: ${phase.id}`);
      }
      this.phases.set(phase.id, phase);
    }
  }

  /** Execute the pipeline with DAG-based dependency ordering */
  async execute(ctx: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: PhaseError[] = [];
    const phaseResults: PhaseResult[] = [];

    // Validate first
    const validation = this.validatePipeline();
    if (!validation.valid) {
      for (const err of validation.errors) {
        errors.push({ phaseId: 'scan', message: err.message });
      }
      return {
        status: 'failed',
        phases: [],
        graph: this.createEmptyGraph(ctx.projectId),
        duration: Date.now() - startTime,
        errors,
      };
    }

    // Topological sort using Kahn's algorithm
    const order = this.topologicalSort();
    if (!order) {
      errors.push({ phaseId: 'scan', message: 'Pipeline DAG contains a cycle — cannot execute' });
      return {
        status: 'failed',
        phases: [],
        graph: this.createEmptyGraph(ctx.projectId),
        duration: Date.now() - startTime,
        errors,
      };
    }

    // Execute phases in topological order
    const completedPhases = new Set<PipelinePhaseId>();
    let hasFailure = false;

    for (const phaseId of order) {
      const phase = this.phases.get(phaseId);
      if (!phase) continue;

      // Check if dependencies completed successfully
      let skipPhase = false;
      for (const dep of phase.dependencies) {
        const depResult = phaseResults.find((r) => r.phaseId === dep);
        if (depResult && depResult.status === 'failed') {
          skipPhase = true;
          break;
        }
      }

      if (skipPhase) {
        phaseResults.push({
          phaseId: phase.id,
          status: 'skipped',
          duration: 0,
          output: undefined,
          error: `Skipped due to failed dependency`,
        });
        continue;
      }

      // Execute the phase
      const phaseStart = Date.now();
      try {
        const result = await phase.execute(ctx);
        phaseResults.push({
          phaseId: phase.id,
          status: result.status,
          duration: Date.now() - phaseStart,
          output: result.output,
          error: result.error,
        });

        if (result.status === 'failed') {
          hasFailure = true;
          if (result.error) {
            errors.push({
              phaseId: phase.id,
              message: result.error,
            });
          }
        }

        completedPhases.add(phase.id);
      } catch (err) {
        hasFailure = true;
        const message = err instanceof Error ? err.message : String(err);
        phaseResults.push({
          phaseId: phase.id,
          status: 'failed',
          duration: Date.now() - phaseStart,
          error: message,
        });
        errors.push({
          phaseId: phase.id,
          message,
        });
      }
    }

    // Build or get knowledge graph from context
    const graph = ctx.graph ?? this.createEmptyGraph(ctx.projectId);

    let status: 'complete' | 'partial' | 'failed' = 'complete';
    if (hasFailure && completedPhases.size > 0) {
      status = 'partial';
    } else if (hasFailure && completedPhases.size === 0) {
      status = 'failed';
    }

    return {
      status,
      phases: phaseResults,
      graph,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /** Validate the DAG: check for duplicate IDs and missing dependencies.
   *  Cycle detection is deferred to execute() via topologicalSort. */
  validatePipeline(): ValidationResult {
    const errors: ValidationError[] = [];

    // Check for duplicate phase IDs (defense-in-depth; constructor also checks)
    const ids = new Set<PipelinePhaseId>();
    for (const phase of this.phases.values()) {
      /* v8 ignore start */
      if (ids.has(phase.id)) {
        errors.push({
          type: 'duplicate_id',
          message: `Duplicate phase ID: ${phase.id}`,
          phaseId: phase.id,
        });
      }
      /* v8 ignore stop */
      ids.add(phase.id);
    }

    // Check for missing dependencies
    for (const phase of this.phases.values()) {
      for (const dep of phase.dependencies) {
        if (!this.phases.has(dep)) {
          errors.push({
            type: 'missing_dependency',
            message: `Phase "${phase.id}" depends on "${dep}" which is not registered`,
            phaseId: phase.id,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // -------------------------------------------------------------------------
  // Kahn's algorithm for topological sort
  // -------------------------------------------------------------------------

  private topologicalSort(): PipelinePhaseId[] | null {
    const allPhases = Array.from(this.phases.keys());
    const inDegree = new Map<PipelinePhaseId, number>();
    const adjacency = new Map<PipelinePhaseId, PipelinePhaseId[]>();

    // Initialize
    for (const id of allPhases) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    // Build graph
    for (const phase of this.phases.values()) {
      for (const dep of phase.dependencies) {
        const deps = adjacency.get(dep);
        if (deps) {
          deps.push(phase.id);
        }
        inDegree.set(phase.id, (inDegree.get(phase.id) ?? 0) + 1);
      }
    }

    // Queue phases with no dependencies
    const queue: PipelinePhaseId[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const result: PipelinePhaseId[] = [];

    while (queue.length > 0) {
      // Sort queue for deterministic ordering
      queue.sort();

       
      const current = queue.shift()!;
      result.push(current);

      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If not all phases are in the result, there's a cycle
    if (result.length !== allPhases.length) {
      return null;
    }

    return result;
  }

  private createEmptyGraph(projectId: string): KnowledgeGraph {
    return {
      projectId,
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
  }
}
