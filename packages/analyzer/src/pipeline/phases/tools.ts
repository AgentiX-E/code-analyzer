// @code-analyzer/analyzer — Pipeline Phase: Tools

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_HANDLES_TOOL } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Tools helpers
// ---------------------------------------------------------------------------

const TOOL_PATTERNS: Array<{ regex: RegExp; toolType: string }> = [
  // MCP tool definitions (TypeScript)
  { regex: /name\s*:\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`][\s\S]{0,200}description\s*:\s*['"`]([^'"`]+)['"`]/g, toolType: 'mcp-tool' },
  // CLI command definitions (commander/yargs)
  { regex: /(?:\.command|\.addCommand)\s*\(\s*['"`]([^'"`]+)['"`]/g, toolType: 'cli-command' },
  // Slack slash commands
  { regex: /\/[a-z][a-z0-9_-]*\s+.+/g, toolType: 'slash-command' },
  // VSCode extension contributes.commands
  { regex: /"command"\s*:\s*['"`]([^'"`]+)['"`](?:[\s\S]{0,100}"title"\s*:\s*['"`]([^'"`]+)['"`])?/g, toolType: 'vscode-command' },
  // Cursor / Claude Code / Codex slash commands
  { regex: /(?:registerCommand|registerTool)\s*\(\s*['"`]([^'"`]+)['"`]/g, toolType: 'agent-command' },
];

// ---------------------------------------------------------------------------
// Phase 9: tools — Detect AI agent tool/command definitions
// ---------------------------------------------------------------------------

export class ToolsPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'tools';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect AI agent tool definitions';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { toolsFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let toolsFound = 0;

      for (const file of scanData.discoveredFiles) {
        for (const pattern of TOOL_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            const toolName = match[1];
            const description = match[2] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            // Skip noise — too generic tool names
            if (toolName.length < 3 || /^(if|for|the|and|not|but|this|that)$/i.test(toolName)) continue;

            const qname = `tool:${file.filePath}:${toolName}`;
            const node = builder.addNode(ctx.graph, 'Tool', toolName, {
              name: toolName,
              filePath: file.filePath,
              startLine: lineNum,
              endLine: lineNum,
              toolType: pattern.toolType,
              description: description.slice(0, 500),
            }, qname);

            const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
            if (fileNodeId) {
              builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_HANDLES_TOOL, ctx.projectId);
            }

            toolsFound++;
          }
        }
      }

      ctx.phaseData.set('tools', { toolsFound });
      return { phaseId: this.id, status: 'success', output: { toolsFound } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}