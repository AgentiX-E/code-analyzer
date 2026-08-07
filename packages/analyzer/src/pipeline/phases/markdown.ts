// @code-analyzer/analyzer — Pipeline Phase: Markdown

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_CONTAINS } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst']);
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

interface MarkdownSection {
  level: number;
  title: string;
  startLine: number;
  endLine: number;
}

function extractMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  const headingLines: { level: number; title: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_REGEX.exec(lines[i]);
    if (match) {
      headingLines.push({ level: match[1].length, title: match[2].trim(), line: i + 1 });
    }
  }

  for (let i = 0; i < headingLines.length; i++) {
    const current = headingLines[i];
    const next = headingLines[i + 1];
    sections.push({
      level: current.level,
      title: current.title,
      startLine: current.line,
      endLine: next ? next.line - 1 : lines.length,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Phase 4: markdown — Process markdown documentation files
// ---------------------------------------------------------------------------

export class MarkdownPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'markdown';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process markdown and documentation files';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { markdownFiles: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let markdownFiles = 0;

      for (const file of scanData.discoveredFiles) {
        const ext = file.filePath.slice(file.filePath.lastIndexOf('.')).toLowerCase();
        if (!MARKDOWN_EXTENSIONS.has(ext)) continue;

        const sections = extractMarkdownSections(file.content);
        if (sections.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const section of sections) {
          const qname = `file:${file.filePath}:section:${section.title}`;
          const node = builder.addNode(ctx.graph, 'Module', section.title, {
            name: section.title,
            filePath: file.filePath,
            startLine: section.startLine,
            endLine: section.endLine,
            language: 'markdown',
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_CONTAINS, ctx.projectId);
        }

        markdownFiles++;
      }

      ctx.phaseData.set('markdown', { markdownFiles });
      return { phaseId: this.id, status: 'success', output: { markdownFiles } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}