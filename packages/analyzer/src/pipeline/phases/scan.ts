// @code-analyzer/analyzer — Pipeline Phase: Scan

import { existsSync } from 'node:fs';
import { basename, dirname, relative, join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { PhaseLogger, createNoopPhaseLogger, EDGE_CONTAINS } from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';
import { parseGitignore, toPhaseFailure, walkDirectory } from '../phase-helpers.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type { PipelinePhaseId, PipelineContext, DiscoveredFile } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Phase 1: scan — Discover source files in the project
// ---------------------------------------------------------------------------

export class ScanPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scan';
  readonly dependencies: PipelinePhaseId[] = [];
  readonly description = 'Discover source files in the project directory';
  readonly parallelizable = false;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const discoveredFiles: DiscoveredFile[] = [];

      // Handle non-existent directories gracefully
      if (!existsSync(ctx.rootPath)) {
        ctx.phaseData.set('scan', { files: [], discoveredFiles: [] });
        return { phaseId: this.id, status: 'success', output: { filesDiscovered: 0 } };
      }

      const gitignorePatterns = parseGitignore(ctx.rootPath);

      await walkDirectory(
        ctx.rootPath,
        ctx.rootPath,
        discoveredFiles,
        gitignorePatterns,
        ctx.config.maxFileSize,
        ctx.config.maxFiles,
      );

      // Store in phaseData
      ctx.phaseData.set('scan', {
        files: discoveredFiles,
        discoveredFiles,
      });

      // Populate ctx.graph with Folder and File nodes if graph is present
      if (ctx.graph) {
        const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);

        for (const file of discoveredFiles) {
          const relPath = relative(ctx.rootPath, file.filePath);
          const dirs = dirname(relPath)
            .split('/')
            .filter((d) => d.length > 0 && d !== '.' && d !== '..');

          // Ensure folder hierarchy exists
          let folderPath = ctx.rootPath;
          for (const dir of dirs) {
            folderPath = join(folderPath, dir);
            if (!ctx.graph.fileIndex.has(folderPath)) {
              // **A folder's name is the folder's, not the path to it.** The node's identity is the absolute path in
              // `qualifiedName`; the `name` field is what a search index weighs, and passing the path there put the
              // checkout's directory names into the vocabulary of every analysis.
              builder.addNode(
                ctx.graph,
                'Folder',
                dir,
                {
                  name: dir,
                  filePath: folderPath,
                },
                `folder:${folderPath}`,
              );
              // Edge from parent will be created during parse/crossFile phases
            }
          }

          // Create CONTAINS edges from folder to parent
          const currentPath = dirs.length > 0 ? join(ctx.rootPath, ...dirs) : ctx.rootPath;
          const currentFolderId = ctx.graph.fileIndex.get(currentPath);
          if (currentFolderId) {
            const parentPath = dirname(folderPath);
            const parentNodeId = ctx.graph.fileIndex.get(parentPath);
            if (parentNodeId) {
              builder.addEdge(
                ctx.graph,
                parentNodeId,
                currentFolderId,
                EDGE_CONTAINS,
                ctx.projectId,
              );
            }
          }

          // Create File node
          //
          // **The name is the file's, and it used to be the machine's.** `addNode` takes the name as its own argument
          // and this call passed `file.filePath` for it while the properties carried `basename(...)`, so a File node
          // held `/home/runner/work/<repo>/...` in the field the search index weighs most. The same mistake was in
          // `parallel-phases.ts`; both are fixed, and the end-to-end case in `tests/e2e/issue-to-ranked-files.test.ts`
          // asserts that moving a checkout does not change a ranking.
          const fileNode = builder.addNode(
            ctx.graph,
            'File',
            basename(file.filePath),
            {
              name: basename(file.filePath),
              filePath: file.filePath,
              // walkDirectory filters out null-language files, so `language`
              // is always a valid language here.
              language: file.language as string,
            },
            `file:${file.filePath}`,
          );

          // Create CONTAINS edge from parent folder to file
          if (currentFolderId) {
            builder.addEdge(ctx.graph, currentFolderId, fileNode.id, EDGE_CONTAINS, ctx.projectId);
          }
        }
      }

      return {
        phaseId: this.id,
        status: 'success',
        output: { filesDiscovered: discoveredFiles.length },
      };
    } catch (err) {
      return toPhaseFailure(err, this.id, this.logger, ctx?.rootPath);
    }
  }
}
