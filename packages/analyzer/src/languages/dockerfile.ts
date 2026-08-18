// @code-analyzer/analyzer — Dockerfile Provider (regex-based parser)
//
// Infrastructure-as-Code: detects Dockerfile instructions (FROM, RUN, COPY,
// ENV, ARG, EXPOSE, WORKDIR, LABEL, VOLUME, USER, CMD, ENTRYPOINT).
//
// A pure regex provider (no tree-sitter): `tree-sitter-dockerfile` is not a
// real published grammar — the npm package of that name is the `0.0.1-security`
// placeholder — so a tree-sitter path would be unreachable dead code. The regex
// parser below is the complete, tested implementation.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const DOCKERFILE_EXTENSIONS: string[] = [];
const DOCKERFILE_GLOBS = ['**/Dockerfile', '**/*.dockerfile'];

export class DockerfileProvider implements LanguageProvider {
  readonly language = 'dockerfile';
  readonly displayName = 'Dockerfile';
  readonly extensions = DOCKERFILE_EXTENSIONS;
  readonly globs = DOCKERFILE_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    const lines = sanitized.split('\n');

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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
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
          startByte: sanitized.indexOf(line),
          endByte: sanitized.indexOf(line) + line.length,
          name: 'USER',
          properties: { instruction: 'USER', isIaC: 'true', filePath },
        });
        continue;
      }
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const sanitized = sanitizeSource(source);
    const imports: ParsedImport[] = [];
    const lines = sanitized.split('\n');
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

  isExported(_source: string, _symbolName: string): boolean {
    return true;
  }
}

/** Normalize input: strip BOM + zero-width chars, normalize line endings to LF. */
function sanitizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B\u200C\u200D]/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
