// @code-analyzer/analyzer — Pipeline Phase: TypeResolution
// Enhanced type resolution phase supporting TypeScript, Python, Go, and Java.
// Uses language-specific advanced resolvers to extract type information
// from parsed ASTs and build a cross-file type registry.

import type {
  PipelinePhaseId,
  PipelineContext,
  ParsedFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { TypeRegistry } from '../../resolution/type-registry.js';
import { TypeScriptAdvancedResolver } from '../../resolution/typescript-resolver-advanced.js';
import { PythonAdvancedResolver } from '../../resolution/python-resolver-advanced.js';
import { GoResolver } from '../../resolution/go-resolver.js';
import { JavaResolver } from '../../resolution/java-resolver.js';

// ---------------------------------------------------------------------------
// TypeResolutionPhase — Multi-language type extraction
// ---------------------------------------------------------------------------

/**
 * Language-to-resolver mapping supporting:
 *   - TypeScript / JavaScript (via TypeScriptAdvancedResolver)
 *   - Python (via PythonAdvancedResolver)
 *   - Go (via GoResolver)
 *   - Java (via JavaResolver)
 */
const LANGUAGE_RESOLVERS: Record<string, () => {
  extractTypes: (source: string, filePath: string) => import('../../resolution/type-registry.js').TypeInfo[];
}> = {
  typescript: () => new TypeScriptAdvancedResolver(),
  tsx: () => new TypeScriptAdvancedResolver(),
  javascript: () => new TypeScriptAdvancedResolver(),
  jsx: () => new TypeScriptAdvancedResolver(),
  python: () => new PythonAdvancedResolver(),
  go: () => new GoResolver(),
  java: () => new JavaResolver(),
};

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

      // Resolver instances — created lazily per language
      const resolverInstances = new Map<string, { extractTypes: (source: string, filePath: string) => import('../../resolution/type-registry.js').TypeInfo[] }>();

      const registry = new TypeRegistry();
      let typesRegistered = 0;
      const typesByLanguage: Record<string, number> = {};

      // Pre-fetch scan data for content lookup
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: Array<{ filePath: string; content: string }> }
        | undefined;

      for (const file of parseData.parsedFiles) {
        const lang = file.language as string;

        // Skip unsupported languages
        if (!LANGUAGE_RESOLVERS[lang]) {
          continue;
        }

        // Get or create resolver for this language
        if (!resolverInstances.has(lang)) {
          resolverInstances.set(lang, LANGUAGE_RESOLVERS[lang]!());
        }
        const resolver = resolverInstances.get(lang)!;

        // Get file content from scan phase
        const content = scanData?.discoveredFiles?.find(
          (f) => f.filePath === file.filePath,
        )?.content;

        if (!content) continue;

        // Extract types using the language-appropriate resolver
        const typeInfos = resolver.extractTypes(content, file.filePath);

        // Register extracted types
        for (const typeInfo of typeInfos) {
          registry.registerType(typeInfo);
          typesRegistered++;
          typesByLanguage[lang] = (typesByLanguage[lang] ?? 0) + 1;
        }

        // Register module paths for import resolution
        /* v8 ignore next -- @preserve -- filePath always has a final path segment */
        const moduleName = file.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
        registry.registerModule(moduleName, file.filePath);
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
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
