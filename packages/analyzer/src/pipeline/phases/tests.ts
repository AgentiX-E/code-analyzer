// @code-analyzer/analyzer — Pipeline Phase: Tests

import { basename, extname } from 'node:path';

import type {
  PipelinePhaseId,
  PipelineContext,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_IMPORTS, EDGE_TESTS } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Tests helpers
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /\.test\.(py)$/i,
  /_test\.(go)$/i,
  /_test\.(rs)$/i,
  /Test\.(java|kt)$/i,
  /__tests__\//,
  /tests\//,
  /test\//,
];

const TEST_FUNCTION_PATTERNS = [
  // Jest/Vitest
  /\b(describe|it|test|beforeEach|afterEach|beforeAll|afterAll)\s*\(/g,
  // Python unittest/pytest
  /\bdef\s+test_\w+/g,
  // Go test
  /\bfunc\s+Test\w+/g,
  // Rust test
  /#\[test\]/g,
  // Java/Kotlin JUnit
  /@Test\b/g,
];

function isTestFile(filePath: string): boolean {
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 14: tests — Detect test files and relationships
// ---------------------------------------------------------------------------

export class TestsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tests';
  readonly dependencies: PipelinePhaseId[] = ['scopeResolution'];
  readonly description = 'Detect test files and their code relationships';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { testsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let testsFound = 0;

      // Build a mapping of source file paths to their graph node IDs
      const filePathToNodeId = new Map<string, number>();
      for (const [nodeId, node] of ctx.graph.nodes) {
        const filePath = node.properties?.filePath as string | undefined;
        if (filePath && (node.label === 'File' || node.label === 'Function' || node.label === 'Class')) {
          filePathToNodeId.set(filePath, nodeId);
        }
      }

      for (const [filePath, fileNodeId] of filePathToNodeId) {
        if (!isTestFile(filePath)) continue;

        const node = ctx.graph.nodes.get(fileNodeId);
        if (!node) continue;

        // Find what this test file imports
        const importedFiles = new Set<string>();
        for (const [, edge] of ctx.graph.edges) {
          if (edge.sourceId === fileNodeId && edge.type === EDGE_IMPORTS) {
            const targetNode = ctx.graph.nodes.get(edge.targetId);
            if (targetNode?.properties?.filePath) {
              importedFiles.add(targetNode.properties.filePath as string);
            }
          }
        }

        // Create TESTS edges to imported files
        for (const importedFile of importedFiles) {
          const targetNodeId = filePathToNodeId.get(importedFile);
          if (targetNodeId && targetNodeId !== fileNodeId) {
            try {
              builder.addEdge(ctx.graph, fileNodeId, targetNodeId, EDGE_TESTS, ctx.projectId);
              testsFound++;
            } catch {
              // Edge may already exist
            }
          }
        }

        // If no import-based relationships found, check by filename convention
        if (importedFiles.size === 0) {
          const fileName = basename(filePath).replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java|kt)/i, '');
          for (const [srcPath, srcNodeId] of filePathToNodeId) {
            if (srcPath.includes(fileName) && srcNodeId !== fileNodeId) {
              const srcFileName = basename(srcPath, extname(srcPath));
              if (fileName.includes(srcFileName) || srcFileName.includes(fileName)) {
                try {
                  builder.addEdge(ctx.graph, fileNodeId, srcNodeId, EDGE_TESTS, ctx.projectId);
                  testsFound++;
                  break;
                } catch {
                  // Skip
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('tests', { testsFound });
      return { phaseId: this.id, status: 'success', output: { testsFound } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}