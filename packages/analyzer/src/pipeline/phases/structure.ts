// @code-analyzer/analyzer — Pipeline Phase: Structure

import { dirname } from 'node:path';

import type { PipelinePhaseId, PipelineContext, DiscoveredFile } from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';

// ---------------------------------------------------------------------------
// Phase 2: structure — Build directory and module structure
// ---------------------------------------------------------------------------

export class StructurePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'structure';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Build directory hierarchy and module structure';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData || !scanData.discoveredFiles) {
        return { phaseId: this.id, status: 'success', output: { directories: 0, modules: 0 } };
      }

      // Group files by directory to count modules
      const dirs = new Set<string>();
      const modules = new Map<string, DiscoveredFile[]>();

      for (const file of scanData.discoveredFiles) {
        const dir = dirname(file.filePath);
        dirs.add(dir);
        const existing = modules.get(dir) ?? [];
        existing.push(file);
        modules.set(dir, existing);
      }

      ctx.phaseData.set('structure', { directories: dirs.size, modules: modules.size });

      return {
        phaseId: this.id,
        status: 'success',
        output: { directories: dirs.size, modules: modules.size },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
