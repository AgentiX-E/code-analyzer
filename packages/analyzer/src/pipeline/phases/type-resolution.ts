// @code-analyzer/analyzer — Pipeline Phase: TypeResolution

import type {
  PipelinePhaseId,
  PipelineContext,
  ParsedFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { TypeRegistry } from '../../resolution/type-registry.js';
import { TypeScriptTypeResolver } from '../../resolution/typescript-resolver.js';
import { PythonTypeResolver } from '../../resolution/python-resolver.js';

// ---------------------------------------------------------------------------
// TypeResolutionPhase — Hybrid LSP type extraction (TS/JS + Python)
// ---------------------------------------------------------------------------

export class TypeResolutionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'typeResolution';
  readonly dependencies: PipelinePhaseId[] = ['parse', 'scopeResolution'];
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();
  readonly description =
    'Extract type information from parsed ASTs and build cross-file type registry';

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const parseData = ctx.phaseData.get('parse') as
        | { parsedFiles: ParsedFile[] }
        | undefined;

      if (!parseData || !parseData.parsedFiles || parseData.parsedFiles.length === 0) {
        ctx.phaseData.set('typeResolution', { typesRegistered: 0, typesByLanguage: {} });
        return { phaseId: this.id, status: 'success', output: { typesRegistered: 0 } };
      }

      const registry = new TypeRegistry();
      const tsResolver = new TypeScriptTypeResolver();
      const pyResolver = new PythonTypeResolver();

      let typesRegistered = 0;
      const typesByLanguage: Record<string, number> = {};

      for (const file of parseData.parsedFiles) {
        const lang = file.language as string;
        let typeInfos: import('../../resolution/type-registry.js').TypeInfo[] = [];

        // Extract types using the appropriate resolver
        if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript' || lang === 'jsx') {
          // Get file content from the scan phase data
          const scanData = ctx.phaseData.get('scan') as
            | { discoveredFiles: Array<{ filePath: string; content: string }> }
            | undefined;
          const content = scanData?.discoveredFiles?.find(
            (f) => f.filePath === file.filePath,
          )?.content;

          if (content) {
            typeInfos = tsResolver.extractTypes(content, file.filePath);
          }
        } else if (lang === 'python') {
          const scanData = ctx.phaseData.get('scan') as
            | { discoveredFiles: Array<{ filePath: string; content: string }> }
            | undefined;
          const content = scanData?.discoveredFiles?.find(
            (f) => f.filePath === file.filePath,
          )?.content;

          if (content) {
            typeInfos = pyResolver.extractTypes(content, file.filePath);
          }
        }

        // Register extracted types
        for (const typeInfo of typeInfos) {
          registry.registerType(typeInfo);
          typesRegistered++;
          typesByLanguage[lang] = (typesByLanguage[lang] ?? 0) + 1;
        }

        // Register module path for import resolution
        registry.registerModule(
          file.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '',
          file.filePath,
        );
        registry.registerModule(file.filePath, file.filePath);
      }

      // Store the registry in the pipeline context
      ctx.typeRegistry = registry;
      ctx.phaseData.set('typeResolution', { typesRegistered, typesByLanguage, registry });

      return {
        phaseId: this.id,
        status: 'success',
        output: { typesRegistered, typesByLanguage },
      };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
