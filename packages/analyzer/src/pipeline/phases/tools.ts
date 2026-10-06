// @code-analyzer/analyzer — Pipeline Phase: Tools

import { PhaseLogger, createNoopPhaseLogger, EDGE_HANDLES_TOOL } from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type { PipelinePhaseId, PipelineContext, DiscoveredFile } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Tools helpers
// ---------------------------------------------------------------------------

const TOOL_PATTERNS: Array<{ regex: RegExp; toolType: string }> = [
  // MCP tool definitions (TypeScript)
  {
    regex:
      /name\s*:\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`][\s\S]{0,200}description\s*:\s*['"`]([^'"`]+)['"`]/g,
    toolType: 'mcp-tool',
  },
  // CLI command definitions (commander/yargs)
  { regex: /(?:\.command|\.addCommand)\s*\(\s*['"`]([^'"`]+)['"`]/g, toolType: 'cli-command' },
  // Slack slash commands
  { regex: /\/[a-z][a-z0-9_-]*\s+.+/g, toolType: 'slash-command' },
  // VSCode extension contributes.commands
  {
    regex:
      /"command"\s*:\s*['"`]([^'"`]+)['"`](?:[\s\S]{0,100}"title"\s*:\s*['"`]([^'"`]+)['"`])?/g,
    toolType: 'vscode-command',
  },
  // Cursor / Claude Code / Codex slash commands
  {
    regex: /(?:registerCommand|registerTool)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    toolType: 'agent-command',
  },
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
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { toolsFound: 0 } };
      }

      const builder = // **No store, and the type now says so.** This phase builds nodes and never dumps, so an optional
        // parameter describes it exactly - where a cast to a non-null store described the opposite.
        new GraphBuilder();
      let toolsFound = 0;

      for (const file of scanData.discoveredFiles) {
        for (const pattern of TOOL_PATTERNS) {
          const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(file.content)) !== null) {
            // **The name is the first group where the pattern has one, and the whole match where it does not.** The
            // comment here used to say the first group "is not optional, so a match always carries it" - and the Slack
            // slash-command matcher is `/\/[a-z][a-z0-9_-]*\s+.+/g`, which captures nothing at all. So `match[1]` was
            // `undefined`, the `!` told the compiler to stop asking, and `toolName.length` threw on **every corpus
            // this phase has ever run on**: `tools` has been returning `failed` since it was written, while the run
            // reported `partial` and carried on. **A comment asserted a property of the patterns and nothing checked
            // the comment.**
            //
            // The fallback is the whole match's first word, which for a slash command is the command itself - the
            // thing the pattern was written to find.
            const toolName = (match[1] ?? match[0].split(/\s+/)[0] ?? '').trim();
            const description = match[2] ?? '';
            const lineNum = file.content.slice(0, match.index).split('\n').length;

            // Skip noise — too generic tool names
            if (toolName.length < 3 || /^(if|for|the|and|not|but|this|that)$/i.test(toolName))
              continue;

            const qname = `tool:${file.filePath}:${toolName}`;
            const node = builder.addNode(
              ctx.graph,
              'Tool',
              toolName,
              {
                name: toolName,
                filePath: file.filePath,
                startLine: lineNum,
                endLine: lineNum,
                toolType: pattern.toolType,
                description: description.slice(0, 500),
              },
              qname,
            );

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
