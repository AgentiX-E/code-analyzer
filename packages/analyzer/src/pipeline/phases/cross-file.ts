// @code-analyzer/analyzer — Pipeline Phase: CrossFile

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  CAPTURE_TAGS,
  PhaseLogger,
  createNoopPhaseLogger,
  EDGE_IMPORTS,
} from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';
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
          const resolvedFile = resolveImportPath(imp.source, parsedFile.filePath, ctx.rootPath);

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

      // **Call edges, from captures the providers were already emitting and nothing was reading.**
      //
      // `FUNCTION_CALL` and `METHOD_CALL` captures have been produced by the language providers since they were
      // written, and **no phase consumed them** - so `CALLS` was in the relationship vocabulary with zero references
      // anywhere in this package. **The input was there and the edge was not**, which is why the reachability
      // question had no instrument but a regular expression to answer it.
      //
      // **Same-file first, then one hop through an explicit import.**
      //
      // The first version was same-file only, and deliberately: a name that is not declared where it is called has no
      // obvious target, and **a guessed target is worse than no edge.** What makes the second step safe is that it is
      // **not a guess** - it follows the `resolvedImports` built above, so a name reaches another file **only through
      // an import that names it.** That is the product's own sentence: *"a symbol that changed and is used at four
      // sites the author never opened"* - **and most of those sites are in other files.**
      //
      // **One hop, not a transitive closure.** A name imported from a file that re-exports it is not followed, because
      // following it needs a module graph rather than a file graph. **The narrower claim is the true one.**
      const importedFrom = new Map<string, Set<string>>();
      for (const resolved of resolvedImports) {
        if (resolved.resolvedFiles.length === 0) continue;
        const target = resolved.resolvedFiles[0]!;
        for (const symbol of resolved.importedSymbols) {
          const key = `${resolved.sourceFile}\u0000${symbol}`;
          const set = importedFrom.get(key) ?? new Set<string>();
          set.add(target);
          importedFrom.set(key, set);
        }
      }

      let callEdgesCreated = 0;
      for (const parsedFile of parseData.parsedFiles) {
        const ast = parsedFile.ast as UnifiedCapture[] | undefined;
        if (!Array.isArray(ast) || !ctx.graph) continue;

        // What this file calls, by name, deduplicated.
        const calledNames = new Set<string>();
        for (const c of ast) {
          if (c.tag !== CAPTURE_TAGS.FUNCTION_CALL && c.tag !== CAPTURE_TAGS.METHOD_CALL) continue;
          const name = c.name;
          if (typeof name === 'string' && name.length > 0) calledNames.add(name);
        }
        if (calledNames.size === 0) continue;

        // What this file declares, by name -> node id. Both ends of a call are in one place, which is what makes
        // this resolution safe to do without a scope model.
        const declaredHere = new Map<string, number[]>();
        for (const node of ctx.graph.nodes.values()) {
          if (node.filePath !== parsedFile.filePath) continue;
          if (!/Function|Method/i.test(String(node.label))) continue;
          if (typeof node.name !== 'string') continue;
          const list = declaredHere.get(node.name) ?? [];
          list.push(node.id);
          declaredHere.set(node.name, list);
        }

        // **Where a name this file calls could live if it is not here.** Only through an import that names it, and
        // only in the files that import resolved to.
        const declaredElsewhere = new Set<string>();
        for (const calleeName of calledNames) {
          if (declaredHere.has(calleeName)) continue;
          for (const target of importedFrom.get(`${parsedFile.filePath}\u0000${calleeName}`) ?? []) {
            declaredElsewhere.add(target);
          }
        }

        const builder = new GraphBuilder();
        for (const callerNodeIds of declaredHere.values()) {
          for (const callerId of callerNodeIds) {
            for (const calleeName of calledNames) {
              const targets = [
                ...(declaredHere.get(calleeName) ?? []),
                // The cross-file half: every function of that name in a file this one imports it from.
                ...[...declaredElsewhere]
                  .filter((file) => importedFrom.get(`${parsedFile.filePath}\u0000${calleeName}`)?.has(file))
                  .flatMap((file) =>
                    [...ctx.graph!.nodes.values()]
                      .filter((n) => n.filePath === file && n.name === calleeName)
                      .map((n) => n.id),
                  ),
              ];
              for (const calleeId of targets) {
                // **Not a self-edge.** A function calling itself is a recursion fact, not a call graph edge, and the
                // recursion markers elsewhere already record it.
                if (callerId === calleeId) continue;
                try {
                  builder.addEdge(ctx.graph, callerId, calleeId, 'CALLS', ctx.projectId);
                  callEdgesCreated++;
                } catch {
                  // Edge may already exist or node missing
                }
              }
            }
          }
        }
      }

      ctx.phaseData.set('crossFile', { resolvedImports, importEdgesCreated, callEdgesCreated });

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
