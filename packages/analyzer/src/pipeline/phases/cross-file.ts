// @code-analyzer/analyzer — Pipeline Phase: CrossFile

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  ResolvedImport,
  UnifiedCapture,
} from '@code-analyzer/shared';
import { CAPTURE_TAGS, PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { ParsedImport } from '../../languages/provider.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { getOrLoadProvider, resolveImportPath } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Phase 6: crossFile — Cross-file dependency analysis
// ---------------------------------------------------------------------------

export class CrossFilePhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'crossFile';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Analyze cross-file dependencies and imports';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;
      const parseData = ctx.phaseData.get('parse') as
        | { parsedFiles: ParsedFile[] }
        | undefined;

      if (!parseData || !parseData.parsedFiles) {
        return { phaseId: this.id, status: 'success', output: { crossFileDeps: 0 } };
      }

      const resolvedImports: ResolvedImport[] = [];
      let importEdgesCreated = 0;

      // Build a content cache from scan data for re-parsing imports
      const contentCache = new Map<string, string>();
      if (scanData?.discoveredFiles) {
        for (const file of scanData.discoveredFiles) {
          contentCache.set(file.filePath, file.content);
        }
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileContent = contentCache.get(parsedFile.filePath);
        if (!fileContent) continue;

        const lang = parsedFile.language;
        if (!lang) continue;

        // Use the language provider's extractImports for accurate AST-based import parsing
        let fileImports: ParsedImport[] = [];
        try {
          const provider = await getOrLoadProvider(lang);
          if (provider) {
            fileImports = provider.extractImports(fileContent);
          }
        } catch {
          // Fall back to capture-based imports below
        }

        // Also extract imports from AST captures (for languages where provider may not be available)
        const ast = parsedFile.ast as UnifiedCapture[];
        if (Array.isArray(ast)) {
          const importCaptures = ast.filter(
            (c) =>
              c.tag === CAPTURE_TAGS.IMPORT ||
              c.tag === CAPTURE_TAGS.IMPORT_NAMED ||
              c.tag === CAPTURE_TAGS.IMPORT_DEFAULT ||
              c.tag === CAPTURE_TAGS.IMPORT_WILDCARD,
          );

          // Merge capture-based imports with provider-based imports (deduplicate)
          const seenSources = new Set(fileImports.map((i) => i.source));
          for (const imp of importCaptures) {
            const importPath = imp.name ?? imp.text;
            if (!importPath || seenSources.has(importPath)) continue;
            seenSources.add(importPath);

            const importedNames = imp.properties?.names
              ? imp.properties.names.split(',').filter(Boolean)
              : [];

            fileImports.push({
              source: importPath,
              names: importedNames,
              type: imp.properties?.importType === 'namespace'
                ? 'namespace'
                : imp.properties?.importType === 'default'
                  ? 'default'
                  : 'named',
              lineNumber: imp.startLine,
            });
          }
        }

        // Resolve each import to a file path
        for (const imp of fileImports) {
          const resolvedFile = resolveImportPath(
            imp.source,
            parsedFile.filePath,
            ctx.rootPath,
          );

          resolvedImports.push({
            sourceFile: parsedFile.filePath,
            importPath: imp.source,
            importedSymbols: imp.names,
            resolvedFiles: resolvedFile ? [resolvedFile] : [],
            semantics: imp.type === 'namespace' || imp.type === 'wildcard'
              ? 'namespace'
              : 'named',
          });

          // Create IMPORTS edge if resolved
          if (resolvedFile && ctx.graph) {
            const sourceFileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
            const targetFileNodeId = ctx.graph.fileIndex.get(resolvedFile);

            if (sourceFileNodeId && targetFileNodeId) {
              const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
              try {
                builder.addEdge(
                  ctx.graph,
                  sourceFileNodeId,
                  targetFileNodeId,
                  'IMPORTS',
                  ctx.projectId,
                );
                importEdgesCreated++;
              } catch {
                // Edge may already exist or node missing
              }
            }
          }
        }
      }

      ctx.phaseData.set('crossFile', { resolvedImports, importEdgesCreated });

      return {
        phaseId: this.id,
        status: 'success',
        output: { crossFileDeps: importEdgesCreated },
      };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
