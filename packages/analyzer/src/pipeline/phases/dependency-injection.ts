// @code-analyzer/analyzer — Pipeline Phase: DependencyInjection

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger, EDGE_INJECTS } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// DI helpers
// ---------------------------------------------------------------------------

const DI_PATTERNS: Array<{ regex: RegExp; framework: string }> = [
  // Angular @Injectable + constructor injection
  {
    regex: /@Injectable\s*\(\s*\)[\s\S]{0,300}constructor\s*\(\s*([^)]+)\)/g,
    framework: 'angular',
  },
  // NestJS @Injectable + constructor
  {
    regex:
      /@Injectable\s*\(\s*\)[\s\S]{0,300}constructor\s*\(\s*(?:\s*(?:@Inject\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*)?\w+\s*(?::\s*\w+)?,?\s*)+\)/g,
    framework: 'nestjs',
  },
  // Spring @Autowired
  { regex: /@Autowired\s+(?:private|public|protected)?\s*(?:\w+)\s+(\w+)/g, framework: 'spring' },
  // Constructor injection (Angular/NestJS simplified)
  {
    regex:
      /constructor\s*\(\s*(?:\s*(?:private|public|protected|readonly)\s+\w+\s*(?::\s*\w+)?,?\s*)+\)/g,
    framework: 'constructor-injection',
  },
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

      for (const file of scanData.discoveredFiles) {
        for (const pattern of DI_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            const injectedType = match[1] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            // Find the containing class/function in parsed data
            const parseData = ctx.phaseData.get('parse') as
              { parsedFiles: ParsedFile[] } | undefined;

            if (parseData?.parsedFiles) {
              const parsedFile = parseData.parsedFiles.find((pf) => pf.filePath === file.filePath);
              if (parsedFile) {
                for (const symbol of parsedFile.symbols) {
                  if (symbol.startLine <= lineNum && symbol.endLine >= lineNum) {
                    const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
                    const symQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                    const sourceNodeId = ctx.graph.qnameIndex.get(symQname);

                    // Find target by injected type name
                    if (sourceNodeId && injectedType) {
                      for (const [, targetNode] of ctx.graph.nodes) {
                        if (targetNode.name === injectedType && targetNode.label === 'Class') {
                          builder.addEdge(
                            ctx.graph,
                            sourceNodeId,
                            targetNode.id,
                            EDGE_INJECTS,
                            ctx.projectId,
                          );
                          injectionsFound++;
                          break;
                        }
                      }
                    }
                    break;
                  }
                }
              }
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
