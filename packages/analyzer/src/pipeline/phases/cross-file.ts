// @code-analyzer/analyzer — Pipeline Phase: CrossFile

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  CAPTURE_TAGS,
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_IMPORTS,
} from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';
import { buildPackageRoots } from '../../resolution/package-roots.js';
import { getOrLoadProvider, resolveImportPath } from '../phase-helpers.js';

import type { ParsedImport } from '../../languages/provider.js';
import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  ResolvedImport,
  UnifiedCapture,
} from '@code-analyzer/shared';

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
        { discoveredFiles: DiscoveredFile[] } | undefined;
      const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;

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

      // **Built once, from the files the scan already listed.** A repository may hold more than one program - a library
      // and the examples that run it - and an absolute import is written from the program's root, not the repository's.
      // Indexing the roots from the file list costs one pass and turns `flaskr.db` in `examples/tutorial/tests/` into a
      // file, which is a caller the graph could not name before.
      const packageRoots = buildPackageRoots(contentCache.keys(), ctx.rootPath);

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

            const importedNames = imp.properties?.['names']
              ? imp.properties['names'].split(',').filter(Boolean)
              : [];

            fileImports.push({
              source: importPath,
              names: importedNames,
              type:
                imp.properties?.['importType'] === 'namespace'
                  ? 'namespace'
                  : imp.properties?.['importType'] === 'default'
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
            packageRoots,
          );

          resolvedImports.push({
            sourceFile: parsedFile.filePath,
            importPath: imp.source,
            importedSymbols: imp.names,
            resolvedFiles: resolvedFile ? [resolvedFile] : [],
            semantics: imp.type === 'namespace' || imp.type === 'wildcard' ? 'namespace' : 'named',
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
                  EDGE_IMPORTS,
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

      // **Call edges used to be built here, and the way they were built was wrong by 88 %.**
      //
      // `FUNCTION_CALL` and `METHOD_CALL` captures have been produced by the language providers since they were
      // written, and no phase consumed them - so `CALLS` was in the relationship vocabulary with zero references. The
      // repair took the shape the data suggested: collect every name the file calls, collect every function the file
      // declares, and join them. **That join is a cartesian product, and it is not a call graph.** Measured on
      // `src/flask/ctx.py` from `pallets/flask` 3.0.3: 20 declarations x 35 called names = 700 candidate edges from a
      // 700-line file, including `__getattr__ -> pop`, `__getattr__ -> setdefault` and `__getattr__ -> __repr__` for a
      // five-line function whose entire body is `return self.__dict__[name]`. Across the repository the pass wrote
      // **5 439** edges and only **1 280** references resolved at all, and **88.4 %** of the same-file edges pointed at
      // a callee the caller never names as a call (122 of 138 in that file).
      //
      // **Nothing is lost by deleting it, because the resolution lives in `ScopeResolutionPhase`, per call site.**
      // That phase reads every reference with its name, its line **and its receiver**, resolves it through an explicit
      // import first, then in its own file, then across the graph - and refuses a name that is declared twice because
      // a wrong edge is worse than a missing one. A per-site resolution through the same `resolvedImports` this phase
      // publishes is strictly better than a per-pair join, and having two producers of one relation meant the graph
      // carried both answers with no way to tell which was which.
      //
      // The sentence that made this a defect rather than a trade-off is the product's own: a call graph that wrong
      // cannot be the basis of a reachability pass.
      ctx.phaseData.set('crossFile', { resolvedImports, importEdgesCreated });

      return {
        phaseId: this.id,
        status: 'success',
        output: { crossFileDeps: importEdgesCreated },
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
