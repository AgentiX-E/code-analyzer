// @code-analyzer/analyzer — Pipeline Phase: ScopeResolution

import type {
  PipelinePhaseId,
  PipelineContext,
  ParsedFile,
  ResolvedImport,
  NodeLabel,
} from '@code-analyzer/shared';
import {
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_CALLS,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 7: scopeResolution — Resolve scopes and references
// ---------------------------------------------------------------------------

export class ScopeResolutionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scopeResolution';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Resolve scope trees and symbol references';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;

      if (!parseData || !parseData.parsedFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { referencesResolved: 0 } };
      }

      // Read crossFile phase data for import resolution
      const crossFileData = ctx.phaseData.get('crossFile') as
        { resolvedImports: ResolvedImport[]; importEdgesCreated: number } | undefined;

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let referencesResolved = 0;

      // Build a file-level import resolution map: sourceFile -> targetFile -> importedSymbols
      const importMap = new Map<string, Map<string, Set<string>>>();
      if (crossFileData?.resolvedImports) {
        for (const imp of crossFileData.resolvedImports) {
          for (const resolvedFile of imp.resolvedFiles) {
            let fileMap = importMap.get(imp.sourceFile);
            if (!fileMap) {
              fileMap = new Map();
              importMap.set(imp.sourceFile, fileMap);
            }
            let symbols = fileMap.get(resolvedFile);
            if (!symbols) {
              symbols = new Set();
              fileMap.set(resolvedFile, symbols);
            }
            for (const sym of imp.importedSymbols) {
              symbols.add(sym);
            }
          }
        }
      }

      // Build an index of all known symbols across files
      // qualifiedName -> GraphNode, plus name+file -> GraphNode for precise matching
      const qnameIndex = new Map<string, { nodeId: number; label: NodeLabel }>();
      // file+name -> GraphNode for cross-file resolution
      const fileSymbolIndex = new Map<string, Map<string, { nodeId: number; label: NodeLabel }>>();

      for (const [, node] of ctx.graph.nodes) {
        if (
          node.label === 'Function' ||
          node.label === 'Class' ||
          node.label === 'Method' ||
          node.label === 'Interface' ||
          node.label === 'Enum' ||
          node.label === 'TypeAlias' ||
          node.label === 'Constructor'
        ) {
          // Store by qualified name (precise)
          qnameIndex.set(node.qualifiedName, { nodeId: node.id, label: node.label });

          // Store in per-file index for cross-file resolution
          if (node.properties?.filePath) {
            const filePath = String(node.properties.filePath);
            let fileMap = fileSymbolIndex.get(filePath);
            if (!fileMap) {
              fileMap = new Map();
              fileSymbolIndex.set(filePath, fileMap);
            }
            // Store by simple name (in context of this file)
            if (node.name && !fileMap.has(node.name)) {
              fileMap.set(node.name, { nodeId: node.id, label: node.label });
            }
            // Also store by qualifiedName for full path matching
            fileMap.set(node.qualifiedName, { nodeId: node.id, label: node.label });
          }
        }
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
        if (!fileNodeId) continue;

        // Resolve imports for this file
        const fileImports = importMap.get(parsedFile.filePath);

        // Process references — try to resolve CALLS edges
        for (const ref of parsedFile.references) {
          if (ref.referenceKind === 'call') {
            let target: { nodeId: number; label: NodeLabel } | undefined;

            // First, try cross-file resolution via imports
            if (fileImports) {
              for (const [resolvedFile, importedSymbols] of fileImports) {
                if (importedSymbols.has(ref.targetName)) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                    if (target) break;
                  }
                }
                // Also try wildcard matching (import * as X from 'y')
                if (importedSymbols.has('*')) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                    if (target) break;
                  }
                }
              }
            }

            // Fallback: global name matching (only if unambiguous)
            if (!target) {
              // Try qualified name index first
              target = qnameIndex.get(ref.targetName);
              // If ambiguous (simple name matches multiple), don't resolve
              // This prevents incorrect CALLS edges
              if (target) {
                // Verify it's in a different file than the reference
                const targetFilePath = ctx.graph.nodes.get(target.nodeId)?.properties?.filePath;
                if (targetFilePath === parsedFile.filePath) {
                  // Same-file reference — skip, this is handled elsewhere
                  target = undefined;
                }
              }
            }

            if (target) {
              // Find the source function/method node containing this reference
              for (const symbol of parsedFile.symbols) {
                if (
                  symbol.startLine <= ref.sourceLine &&
                  symbol.endLine >= ref.sourceLine &&
                  (symbol.kind === 'Function' || symbol.kind === 'Method')
                ) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNode = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNode && sourceNode !== target.nodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNode,
                        target.nodeId,
                        EDGE_CALLS,
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                  break;
                }
              }
            }
          }
        }

        // Process class inheritance (EXTENDS edges)
        for (const symbol of parsedFile.symbols) {
          if (symbol.kind === 'Class') {
            const baseClasses = symbol.properties.baseClasses as string | undefined;
            if (baseClasses) {
              for (const baseClass of baseClasses
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)) {
                let target = qnameIndex.get(baseClass);
                // Try cross-file resolution for extends
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(baseClass);
                      if (target) break;
                    }
                  }
                }
                // Third fallback: same-file lookup — resolve by searching the same file's symbols
                if (!target) {
                  const sameFileNodes = fileSymbolIndex.get(parsedFile.filePath);
                  if (sameFileNodes) {
                    target = sameFileNodes.get(baseClass);
                  }
                }
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        EDGE_EXTENDS,
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }

            // IMPLEMENTS edges for interfaces
            const interfaces = symbol.properties.interfaces as string | undefined;
            if (interfaces) {
              for (const iface of interfaces
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)) {
                let target = qnameIndex.get(iface);
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(iface);
                      if (target) break;
                    }
                  }
                }
                // Third fallback: same-file lookup — resolve by searching the same file's symbols
                if (!target) {
                  const sameFileNodes = fileSymbolIndex.get(parsedFile.filePath);
                  if (sameFileNodes) {
                    target = sameFileNodes.get(iface);
                  }
                }
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        EDGE_IMPLEMENTS,
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('scopeResolution', { referencesResolved });

      return {
        phaseId: this.id,
        status: 'success',
        output: { referencesResolved },
      };
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
