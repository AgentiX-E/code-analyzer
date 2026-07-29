// @code-analyzer/analyzer — Dockerfile Tree-sitter Provider
// Infrastructure-as-Code: detects Dockerfile instructions (FROM, RUN, COPY, etc.)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const DOCKERFILE_EXTENSIONS: string[] = [];
const DOCKERFILE_GLOBS = ['**/Dockerfile', '**/*.dockerfile'];

export class DockerfileProvider extends TreeSitterBaseProvider {
  readonly language = 'dockerfile';
  readonly displayName = 'Dockerfile';
  readonly extensions = DOCKERFILE_EXTENSIONS;
  readonly globs = DOCKERFILE_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-dockerfile') as TreeSitterLanguage;
    } /* v8 ignore next */
    catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'from_instruction', captureTag: 'decorator' as any, nameChildType: 'image_spec' },
      { nodeType: 'instruction', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'from_instruction') {
      let image = '';
      let tag = '';
      let stage: string | undefined;

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'image_spec') {
          // Parse image name
          let nameParts: string[] = [];
          for (let j = 0; j < child.namedChildCount; j++) {
            const sub = child.namedChild(j);
            if (sub.type === 'image_name') nameParts.push(sub.text);
          }
          image = nameParts.join(':');
          if (!image) image = child.text;
        } else if (child.type === 'image_tag') {
          tag = child.text.replace(/^:/, '');
        } else if (child.type === 'identifier' && !stage) {
          stage = child.text;
        }
      }

      const fullImage = tag ? `${image}:${tag}` : image;
      if (fullImage) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: `FROM ${fullImage}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: fullImage,
          properties: {
            baseImage: fullImage,
            stage: stage ?? '',
            iaCType: 'DockerImage',
            isIaC: 'true',
            filePath: this.filePath,
          },
        });
      }
    } else if (nodeType === 'run_instruction' || nodeType === 'cmd_instruction' ||
               nodeType === 'entrypoint_instruction' || nodeType === 'copy_instruction' ||
               nodeType === 'add_instruction') {
      const instrType = nodeType.replace('_instruction', '').toUpperCase();
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: `${instrType} ${this.extractInstructionText(node)}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: instrType,
        properties: {
          instruction: instrType,
          isIaC: 'true',
          filePath: this.filePath,
        },
      });
    } else if (nodeType === 'expose_instruction') {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: node.text.trim(),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: 'EXPOSE',
        properties: { instruction: 'EXPOSE', isIaC: 'true', filePath: this.filePath },
      });
    } else if (nodeType === 'env_instruction') {
      let varName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'env_key') {
          varName = child.text;
          break;
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: varName || node.text.trim(),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: varName || 'ENV',
        properties: { instruction: 'ENV', isIaC: 'true', filePath: this.filePath },
      });
    } else if (nodeType === 'arg_instruction') {
      let varName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'identifier') {
          varName = child.text;
          break;
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: varName || node.text.trim(),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: varName || 'ARG',
        properties: { instruction: 'ARG', isIaC: 'true', filePath: this.filePath },
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(_node: TreeSitterSyntaxNode, _imports: ParsedImport[]): void {
    // Dockerfile has no traditional imports — FROM is handled in parsing
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true;
  }

  // Fallbacks
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('#')) continue;

      const lineNum = i + 1;

      // FROM instruction
      const fromMatch = line.match(/^FROM\s+(.+)$/i);
      if (fromMatch) {
        const imagePart = fromMatch[1]!.trim();
        let image = imagePart;
        let stage: string | undefined;

        // Handle: FROM image:tag AS stage
        const asMatch = imagePart.match(/^([^\s]+(?::\S+)?)(?:\s+AS\s+(\w+))?$/i);
        if (asMatch) {
          image = asMatch[1]!;
          stage = asMatch[2];
        }

        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: `FROM ${image}`,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: image,
          properties: {
            baseImage: image,
            stage: stage ?? '',
            iaCType: 'DockerImage',
            isIaC: 'true',
            filePath,
          },
        });
        continue;
      }

      // RUN instruction
      if (line.match(/^RUN\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'RUN',
          properties: { instruction: 'RUN', isIaC: 'true', filePath },
        });
        continue;
      }

      // COPY instruction
      if (line.match(/^COPY\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'COPY',
          properties: { instruction: 'COPY', isIaC: 'true', filePath },
        });
        continue;
      }

      // ADD instruction
      if (line.match(/^ADD\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'ADD',
          properties: { instruction: 'ADD', isIaC: 'true', filePath },
        });
        continue;
      }

      // CMD instruction
      if (line.match(/^CMD\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'CMD',
          properties: { instruction: 'CMD', isIaC: 'true', filePath },
        });
        continue;
      }

      // ENTRYPOINT instruction
      if (line.match(/^ENTRYPOINT\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'ENTRYPOINT',
          properties: { instruction: 'ENTRYPOINT', isIaC: 'true', filePath },
        });
        continue;
      }

      // ENV instruction
      const envMatch = line.match(/^ENV\s+(\w+)/i);
      if (envMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: envMatch[1]!,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: envMatch[1]!,
          properties: { instruction: 'ENV', isIaC: 'true', filePath },
        });
        continue;
      }

      // ARG instruction
      const argMatch = line.match(/^ARG\s+(\w+)/i);
      if (argMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: argMatch[1]!,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: argMatch[1]!,
          properties: { instruction: 'ARG', isIaC: 'true', filePath },
        });
        continue;
      }

      // EXPOSE instruction
      if (line.match(/^EXPOSE\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'EXPOSE',
          properties: { instruction: 'EXPOSE', isIaC: 'true', filePath },
        });
        continue;
      }

      // WORKDIR instruction
      if (line.match(/^WORKDIR\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'WORKDIR',
          properties: { instruction: 'WORKDIR', isIaC: 'true', filePath },
        });
        continue;
      }

      // LABEL instruction
      const labelMatch = line.match(/^LABEL\s+([\w.]+)/i);
      if (labelMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: labelMatch[1]!,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: labelMatch[1]!,
          properties: { instruction: 'LABEL', isIaC: 'true', filePath },
        });
        continue;
      }

      // VOLUME instruction
      if (line.match(/^VOLUME\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'VOLUME',
          properties: { instruction: 'VOLUME', isIaC: 'true', filePath },
        });
        continue;
      }

      // USER instruction
      if (line.match(/^USER\s/i)) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: line,
          startLine: lineNum,
          endLine: lineNum,
          startByte: source.indexOf(line),
          endByte: source.indexOf(line) + line.length,
          name: 'USER',
          properties: { instruction: 'USER', isIaC: 'true', filePath },
        });
        continue;
      }
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const fromMatch = line.match(/^FROM\s+([^\s]+)/i);
      if (fromMatch) {
        imports.push({
          source: fromMatch[1]!,
          names: [fromMatch[1]!],
          type: 'named',
          lineNumber: i + 1,
        });
      }
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }

  // Helpers
  private extractInstructionText(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== 'identifier' && child.text.trim()) {
        parts.push(child.text.trim());
      }
    }
    return parts.join(' ').substring(0, 50);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
