// @code-analyzer/analyzer — Pipeline Phase: DependencyInjection

import { PhaseLogger, createNoopPhaseLogger, EDGE_INJECTS } from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// DI helpers
// ---------------------------------------------------------------------------

const DI_PATTERNS: Array<{ regex: RegExp; framework: string }> = [
  // Angular / NestJS `@Injectable()` with a constructor. **Bounded and lazy**, and the capture is the `@Inject` token
  // when there is one: the previous pattern carried a `(?:\s*(?:…)?\w+…,?\s*)+` group, which backtracks
  // exponentially on a constructor with many parameters. Measured on `nestjs/core` (249 files): **24 of the phase's 34
  // seconds were spent here**, and on `nestjs/nest` (1 614 files) the job was still running after forty minutes.
  {
    regex:
      /@Injectable\s*\(\s*\)[\s\S]{0,300}?constructor\s*\([^)]*@Inject\s*\(\s*['"`]([^'"`]+)['"`]/g,
    framework: 'nestjs',
  },
  // Spring @Autowired
  { regex: /@Autowired\s+(?:private|public|protected)?\s*(?:\w+)\s+(\w+)/g, framework: 'spring' },
  // Python dependency_injector
  { regex: /@(?:inject|provide)\s*$/gm, framework: 'python-di' },
  // .NET dependency injection
  {
    regex: /services\.(?:AddScoped|AddSingleton|AddTransient)\s*<\s*(\w+)\s*>/g,
    framework: 'dotnet',
  },
  // NestJS module providers
  { regex: /providers\s*:\s*\[([^\]]+)\]/g, framework: 'nestjs-module' },
];

// ---------------------------------------------------------------------------
// Phase 10: di — Detect dependency injection patterns
// ---------------------------------------------------------------------------

export class DependencyInjectionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'di';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect dependency injection patterns';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { injectionsFound: 0 } };
      }

      let injectionsFound = 0;

      // **Three indexes, built once.** The loop used to call `parsedFiles.find(...)` for every match and then walk
      // *every node in the graph* to find the injected class by name - O(matches x files) and O(matches x nodes). On
      // `nestjs/core` that was most of the phase's remaining ten seconds; on a repository ten times larger it is the
      // difference between an index that finishes and one that does not.
      const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;
      const parsedByPath = new Map<string, ParsedFile>();
      for (const parsedFile of parseData?.parsedFiles ?? []) {
        parsedByPath.set(parsedFile.filePath, parsedFile);
      }
      const classByName = new Map<string, number>();
      for (const [, node] of ctx.graph.nodes) {
        if (node.label === 'Class' && !classByName.has(node.name))
          classByName.set(node.name, node.id);
      }
      const builder = new GraphBuilder();

      for (const file of scanData.discoveredFiles) {
        // **A file with no DI token at all costs one regex test**, not seven scans of its text.
        if (
          !/(?:@Injectable|@Autowired|@inject|@provide|AddScoped|AddSingleton|AddTransient|providers\s*:)/.test(
            file.content,
          )
        ) {
          continue;
        }

        for (const pattern of DI_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            const injectedType = match[1] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            const parsedFile = parsedByPath.get(file.filePath);
            const symbol = parsedFile?.symbols.find(
              (candidate) => candidate.startLine <= lineNum && candidate.endLine >= lineNum,
            );
            const sourceNodeId = symbol
              ? ctx.graph.qnameIndex.get(`project:${ctx.projectId}:${symbol.qualifiedName}`)
              : undefined;
            const targetNodeId = injectedType ? classByName.get(injectedType) : undefined;

            if (sourceNodeId && targetNodeId !== undefined) {
              builder.addEdge(ctx.graph, sourceNodeId, targetNodeId, EDGE_INJECTS, ctx.projectId);
              injectionsFound++;
            }
          }
        }
      }

      ctx.phaseData.set('di', { injectionsFound });
      return { phaseId: this.id, status: 'success', output: { injectionsFound } };
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
