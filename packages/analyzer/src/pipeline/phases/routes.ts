// @code-analyzer/analyzer — Pipeline Phase: Routes

import { basename } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_BELONGS_TO,
  EDGE_HANDLES,
  EDGE_HANDLES_ROUTE,
} from '@code-analyzer/shared';

import { detectRoutes, ROUTE_LANGUAGES } from './route-patterns.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Routes helpers
// ---------------------------------------------------------------------------

/**
 * **The detector lives in `route-patterns.ts` and is exported**, because a table of regular expressions that only a
 * pipeline run can reach is a table no unit test can disagree with — and this one was wrong in three ways at once
 * (four matches for one Express endpoint, `ALL` for every Spring verb, and a framework label guessed from syntax that
 * four libraries share). The phase keeps the graph work; the syntax work is a pure function of the file.
 */
export { detectRoutes, ROUTE_LANGUAGES } from './route-patterns.js';

// ---------------------------------------------------------------------------
// Phase 8: routes — Detect route handlers
// ---------------------------------------------------------------------------

export class RoutesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'routes';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect and catalog API route handlers';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { routesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let routesFound = 0;

      for (const file of scanData.discoveredFiles) {
        if (!file.language || !ROUTE_LANGUAGES.has(file.language)) continue;
        const fileName = basename(file.filePath);
        const routes = detectRoutes(file.filePath, file.content, fileName, file.language);
        if (routes.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const route of routes) {
          const qname = `route:${file.filePath}:${route.method}:${route.path}`;
          const node = builder.addNode(
            ctx.graph,
            'Route',
            `${route.method} ${route.path}`,
            {
              name: `${route.method} ${route.path}`,
              filePath: file.filePath,
              startLine: route.line,
              endLine: route.line,
              routePath: route.path,
              routeMethod: route.method,
              framework: route.framework,
            },
            qname,
          );

          builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_HANDLES_ROUTE, ctx.projectId);

          // Also create BELONGS_TO edges from any functions defined near the route
          const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;

          if (parseData?.parsedFiles) {
            const parsedFile = parseData.parsedFiles.find((pf) => pf.filePath === file.filePath);
            if (parsedFile) {
              for (const symbol of parsedFile.symbols) {
                if (symbol.startLine <= route.line + 2 && symbol.endLine >= route.line - 2) {
                  const symQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const symNodeId = ctx.graph.qnameIndex.get(symQname);
                  if (symNodeId) {
                    builder.addEdge(ctx.graph, symNodeId, node.id, EDGE_BELONGS_TO, ctx.projectId);
                    builder.addEdge(ctx.graph, symNodeId, node.id, EDGE_HANDLES, ctx.projectId);
                  }
                }
              }
            }
          }

          routesFound++;
        }
      }

      ctx.phaseData.set('routes', { routesFound });
      return { phaseId: this.id, status: 'success', output: { routesFound } };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
