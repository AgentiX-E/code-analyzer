import { describe, it, expect } from 'vitest';

import {
  PipelineOrchestrator,
  createAllPhases,
  ScanPhase,
} from '../pipeline/index.js';

import type { PipelinePhaseId, PipelineContext } from '@code-analyzer/shared';

function createMockContext(): PipelineContext {
  return {
    projectId: 'test-project',
    rootPath: '/test/project',
    phaseData: new Map(),
    config: {
      projectId: 'test-project',
      rootPath: '/test/project',
      excludePatterns: [],
      includePatterns: ['**/*'],
      maxFileSize: 1048576,
      maxFiles: 10000,
      parseWorkers: 4,
      ignorePaths: [],
    },
  };
}

describe('PipelineOrchestrator', () => {
  describe('validatePipeline', () => {
    it('should validate an empty pipeline', () => {
      const orchestrator = new PipelineOrchestrator([]);
      const result = orchestrator.validatePipeline();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate phase IDs', () => {
      expect(() => {
        new PipelineOrchestrator([
          new ScanPhase(),
          new ScanPhase(),
        ]);
      }).toThrow('Duplicate phase ID: scan');
    });

    it('should detect missing dependencies', () => {
      const phase = {
        id: 'test-phase' as PipelinePhaseId,
        dependencies: ['nonexistent' as PipelinePhaseId],
        description: 'Test phase',
        parallelizable: false,
        execute: async () => ({ phaseId: 'test-phase' as PipelinePhaseId, status: 'success' as const }),
      };
      const orchestrator = new PipelineOrchestrator([phase]);
      const result = orchestrator.validatePipeline();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'missing_dependency')).toBe(true);
    });

    it('should validate a correct pipeline configuration', () => {
      const orchestrator = new PipelineOrchestrator(createAllPhases());
      const result = orchestrator.validatePipeline();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect cycles in the pipeline DAG', () => {
      const phaseA = {
        id: 'a' as PipelinePhaseId,
        dependencies: ['b' as PipelinePhaseId],
        description: 'Phase A',
        parallelizable: false,
        execute: async () => ({ phaseId: 'a' as PipelinePhaseId, status: 'success' as const }),
      };
      const phaseB = {
        id: 'b' as PipelinePhaseId,
        dependencies: ['a' as PipelinePhaseId],
        description: 'Phase B',
        parallelizable: false,
        execute: async () => ({ phaseId: 'b' as PipelinePhaseId, status: 'success' as const }),
      };
      const orchestrator = new PipelineOrchestrator([phaseA, phaseB]);
      const result = orchestrator.validatePipeline();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'cycle')).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute all phases in topological order', async () => {
      const orchestrator = new PipelineOrchestrator(createAllPhases());
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('complete');
      expect(result.phases.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      const scanIdx = result.phases.findIndex((p) => p.phaseId === 'scan');
      const structureIdx = result.phases.findIndex((p) => p.phaseId === 'structure');
      expect(scanIdx).toBeLessThan(structureIdx);
    });

    it('should fail if DAG has a cycle', async () => {
      const phaseA = {
        id: 'a' as PipelinePhaseId,
        dependencies: ['b' as PipelinePhaseId],
        description: 'Phase A',
        parallelizable: false,
        execute: async () => ({ phaseId: 'a' as PipelinePhaseId, status: 'success' as const }),
      };

      const phaseB = {
        id: 'b' as PipelinePhaseId,
        dependencies: ['a' as PipelinePhaseId],
        description: 'Phase B',
        parallelizable: false,
        execute: async () => ({ phaseId: 'b' as PipelinePhaseId, status: 'success' as const }),
      };

      const orchestrator = new PipelineOrchestrator([phaseA, phaseB]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should skip phases with failed dependencies', async () => {
      const failPhase = {
        id: 'fail-1' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Failing phase',
        parallelizable: false,
        execute: async () => ({ phaseId: 'fail-1' as PipelinePhaseId, status: 'failed' as const, error: 'Test error' }),
      };

      const dependentPhase = {
        id: 'dependent' as PipelinePhaseId,
        dependencies: ['fail-1' as PipelinePhaseId],
        description: 'Dependent',
        parallelizable: false,
        execute: async () => ({ phaseId: 'dependent' as PipelinePhaseId, status: 'success' as const }),
      };

      const orchestrator = new PipelineOrchestrator([failPhase, dependentPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('partial');
      const skipped = result.phases.find((p) => (p.phaseId as string) === 'dependent');
      expect(skipped?.status).toBe('skipped');
    });

    it('should handle phase execution errors', async () => {
      const throwingPhase = {
        id: 'throws' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Throwing phase',
        parallelizable: false,
        execute: async () => { throw new Error('Test execution error'); },
      };

      const orchestrator = new PipelineOrchestrator([throwingPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toContain('Test execution error');
    });

    it('should return partial status when some phases fail', async () => {
      const failingPhase = {
        id: 'scan' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Failing scan',
        parallelizable: false,
        execute: async () => ({ phaseId: 'scan' as PipelinePhaseId, status: 'failed' as const, error: 'Scan failed' }),
      };

      const successPhase = {
        id: 'markdown' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Markdown',
        parallelizable: true,
        execute: async () => ({ phaseId: 'markdown' as PipelinePhaseId, status: 'success' as const }),
      };

      const orchestrator = new PipelineOrchestrator([failingPhase, successPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('partial');
    });
  });

  describe('topological order', () => {
    it('should execute phases respecting dependency graph', async () => {
      const executionOrder: string[] = [];

      const phase1 = {
        id: '1' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Phase 1',
        parallelizable: false,
        execute: async () => { executionOrder.push('1'); return { phaseId: '1' as PipelinePhaseId, status: 'success' as const }; },
      };
      const phase2 = {
        id: '2' as PipelinePhaseId,
        dependencies: ['1' as PipelinePhaseId],
        description: 'Phase 2',
        parallelizable: false,
        execute: async () => { executionOrder.push('2'); return { phaseId: '2' as PipelinePhaseId, status: 'success' as const }; },
      };
      const phase3 = {
        id: '3' as PipelinePhaseId,
        dependencies: ['1' as PipelinePhaseId],
        description: 'Phase 3',
        parallelizable: false,
        execute: async () => { executionOrder.push('3'); return { phaseId: '3' as PipelinePhaseId, status: 'success' as const }; },
      };
      const phase4 = {
        id: '4' as PipelinePhaseId,
        dependencies: ['2' as PipelinePhaseId, '3' as PipelinePhaseId],
        description: 'Phase 4',
        parallelizable: false,
        execute: async () => { executionOrder.push('4'); return { phaseId: '4' as PipelinePhaseId, status: 'success' as const }; },
      };

      const orchestrator = new PipelineOrchestrator([phase1, phase2, phase3, phase4]);
      const ctx = createMockContext();
      await orchestrator.execute(ctx);

      expect(executionOrder[0]).toBe('1');
      expect(['2', '3']).toContain(executionOrder[1]);
      expect(['2', '3']).toContain(executionOrder[2]);
      expect(executionOrder[3]).toBe('4');
    });
  });

  describe('Error handling — edge cases', () => {
    it('should handle phase throwing non-Error objects', async () => {
      const throwingPhase = {
        id: 'bad-throw' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Throws non-Error',
        parallelizable: false,
        execute: async () => { throw 'string error'; },
      };

      const orchestrator = new PipelineOrchestrator([throwingPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toContain('string error');
    });

    it('should handle phase throwing number', async () => {
      const throwingPhase = {
        id: 'bad-throw' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Throws number',
        parallelizable: false,
        execute: async () => { throw 42; },
      };

      const orchestrator = new PipelineOrchestrator([throwingPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle single phase pipeline', async () => {
      const singlePhase = {
        id: 'only' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Single phase',
        parallelizable: false,
        execute: async () => ({ phaseId: 'only' as PipelinePhaseId, status: 'success' as const }),
      };

      const orchestrator = new PipelineOrchestrator([singlePhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('complete');
      expect(result.phases.length).toBe(1);
    });

    it('should skip dependents when dependency fails and continue independent phases', async () => {
      const failPhase = {
        id: 'fails' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Will fail',
        parallelizable: false,
        execute: async () => ({ phaseId: 'fails' as PipelinePhaseId, status: 'failed' as const, error: 'failed on purpose' }),
      };

      const dependentPhase = {
        id: 'depends' as PipelinePhaseId,
        dependencies: ['fails' as PipelinePhaseId],
        description: 'Depends on fail',
        parallelizable: false,
        execute: async () => ({ phaseId: 'depends' as PipelinePhaseId, status: 'success' as const }),
      };

      const independentPhase = {
        id: 'independent' as PipelinePhaseId,
        dependencies: [] as PipelinePhaseId[],
        description: 'Independent',
        parallelizable: true,
        execute: async () => ({ phaseId: 'independent' as PipelinePhaseId, status: 'success' as const }),
      };

      const orchestrator = new PipelineOrchestrator([failPhase, dependentPhase, independentPhase]);
      const ctx = createMockContext();
      const result = await orchestrator.execute(ctx);

      expect(result.status).toBe('partial');
      const skipped = result.phases.find((p) => p.phaseId === 'depends');
      expect(skipped?.status).toBe('skipped');
      const independent = result.phases.find((p) => p.phaseId === 'independent');
      expect(independent?.status).toBe('success');
    });
  });

  describe('Custom phase ordering', () => {
    it('should handle chain dependency: A -> B -> C -> D', async () => {
      const order: string[] = [];
      const mkPhase = (id: string, deps: string[]) => ({
        id: id as PipelinePhaseId,
        dependencies: deps as PipelinePhaseId[],
        description: id,
        parallelizable: false,
        execute: async () => { order.push(id); return { phaseId: id as PipelinePhaseId, status: 'success' as const }; },
      });

      const orchestrator = new PipelineOrchestrator([
        mkPhase('a', []),
        mkPhase('b', ['a']),
        mkPhase('c', ['b']),
        mkPhase('d', ['c']),
      ]);

      const ctx = createMockContext();
      await orchestrator.execute(ctx);

      expect(order).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should handle diamond dependency: A -> {B,C} -> D', async () => {
      const order: string[] = [];
      const mkPhase = (id: string, deps: string[]) => ({
        id: id as PipelinePhaseId,
        dependencies: deps as PipelinePhaseId[],
        description: id,
        parallelizable: false,
        execute: async () => { order.push(id); return { phaseId: id as PipelinePhaseId, status: 'success' as const }; },
      });

      const orchestrator = new PipelineOrchestrator([
        mkPhase('x', []),
        mkPhase('y', ['x']),
        mkPhase('z', ['x']),
        mkPhase('w', ['y', 'z']),
      ]);

      const ctx = createMockContext();
      await orchestrator.execute(ctx);

      expect(order[0]).toBe('x');
      expect(order[3]).toBe('w');
    });
  });
});
