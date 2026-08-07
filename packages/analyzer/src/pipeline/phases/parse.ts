// @code-analyzer/analyzer — Pipeline Phase: Parse

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  SupportedLanguage,
  NodeProperties,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_DEFINES, EDGE_HAS_METHOD } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { getOrLoadProvider, groupCaptures } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 3: parse — Parse source files with language providers
// ---------------------------------------------------------------------------

export class ParsePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'parse';
  readonly dependencies: PipelinePhaseId[] = ['scan', 'structure'];
  readonly description = 'Parse source files using language-specific parsers';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData || !scanData.discoveredFiles) {
        return { phaseId: this.id, status: 'success', output: { filesParsed: 0 } };
      }

      const parsedFiles: ParsedFile[] = [];
      let successCount = 0;
      let failCount = 0;

      for (const file of scanData.discoveredFiles) {
        const lang = file.language;
        if (!lang) continue;

        try {
          const provider = await getOrLoadProvider(lang);
          if (!provider) continue;

          const captures = provider.parse(file.content, file.filePath);

          // Determine if items are exported
          for (const capture of captures) {
            if (capture.name) {
              const isExported = provider.isExported(file.content, capture.name);
              if (capture.properties) {
                capture.properties.exported = String(isExported);
              }
            }
          }

          const { symbols, references, scopeTree } = groupCaptures(captures, file.filePath);

          parsedFiles.push({
            filePath: file.filePath,
            language: lang as SupportedLanguage,
            symbols,
            references,
            scopeTree,
            ast: captures, // Use capture array as AST representation
          });

          // Add symbol nodes to the graph
          if (ctx.graph) {
            const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
            const fileNodeId = ctx.graph.fileIndex.get(file.filePath);

            if (fileNodeId) {
              let currentClassNodeId: number | null = null;

              for (const symbol of symbols) {
                const label = symbol.kind;
                const qualifiedName = `project:${ctx.projectId}:${symbol.qualifiedName}`;

                const properties: NodeProperties = {
                  name: symbol.name,
                  filePath: file.filePath,
                  startLine: symbol.startLine,
                  endLine: symbol.endLine,
                  language: lang,
                  isExported: symbol.isExported,
                  signature: symbol.signature,
                  returnType: symbol.returnType,
                  docstring: symbol.docstring,
                  ...symbol.properties,
                };

                const node = builder.addNode(
                  ctx.graph,
                  label,
                  symbol.name,
                  properties,
                  qualifiedName,
                );

                // Create appropriate edges
                if (label === 'Method' || label === 'Constructor') {
                  // Method within its parent class
                  if (currentClassNodeId) {
                    builder.addEdge(
                      ctx.graph,
                      currentClassNodeId,
                      node.id,
                      EDGE_HAS_METHOD,
                      ctx.projectId,
                    );
                  } else {
                    builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
                  }
                } else if (label === 'Class') {
                  currentClassNodeId = node.id;
                  builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);

                  // EXTENDS edge for base classes
                  const baseClasses = symbol.properties.baseClasses as string | undefined;
                  if (baseClasses) {
                    // Will be resolved in scopeResolution phase — store for now
                    if (symbol.properties.interfaces) {
                      // Store implements info for later resolution
                    }
                  }
                } else if (label === 'Interface') {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
                } else if (label === 'Function') {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
                } else {
                  builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_DEFINES, ctx.projectId);
                }
              }
            }
          }

          successCount++;
        } catch {
          failCount++;
        }
      }

      ctx.phaseData.set('parse', { parsedFiles });

      return {
        phaseId: this.id,
        status: 'success',
        output: { filesParsed: successCount, filesFailed: failCount },
      };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}