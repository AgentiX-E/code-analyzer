// @code-analyzer/analyzer — Python Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';


function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

const pythonExtensions = ['.py', '.pyi', '.pyx', '.pxd'];
const pythonGlobs = ['**/*.py', '**/*.pyi', '**/*.pyx', '**/*.pxd'];

const PY_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield',
]);

export class PythonProvider implements LanguageProvider {
  readonly language = 'python';
  readonly displayName = 'Python';
  readonly extensions = pythonExtensions;
  readonly globs = pythonGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    this.extractFunctions(source, filePath, captures);
    this.extractClasses(source, filePath, captures);
    this.extractImportsAsCaptures(source, filePath, captures);
    this.extractDecorators(source, filePath, captures);
    this.extractDocstrings(source, filePath, captures);

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // from X import Y, Z
    const fromImportRegex = /from\s+([\w.]+)\s+import\s+([\w\s,]+)(?:\s+as\s+(\w+))?/g;
    let match: RegExpExecArray | null;
    while ((match = fromImportRegex.exec(source)) !== null) {
      const modulePath = match[1]!;
      const namesStr = match[2]!;
      const names = namesStr.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
      imports.push({
        source: modulePath,
        names,
        type: 'named',
        lineNumber: lineNumberAt(source, match.index),
      });
    }

    // import X, import X as Y
    const importRegex = /^import\s+([\w\s,.]+?)(?:\s+#.*)?$/gm;
    while ((match = importRegex.exec(source)) !== null) {
      const modules = match[1]!.split(',');
      for (const mod of modules) {
        const parts = mod.trim().split(/\s+as\s+/);
        const name = parts[0]!.trim();
        imports.push({
          source: name,
          names: [parts[1]?.trim() ?? name],
          type: parts.length > 1 ? 'namespace' : 'named',
          lineNumber: lineNumberAt(source, match.index),
        });
      }
    }

    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    // In Python, everything is effectively public except _prefixed names
    if (symbolName.startsWith('_') && !symbolName.startsWith('__')) {
      return false;
    }

    // Check __all__ array
    const allRegex = /__all__\s*=\s*\[([\s\S]*?)\]/;
    const allMatch = allRegex.exec(source);
    if (allMatch) {
      const items = allMatch[1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
      return items.includes(symbolName);
    }

    return true; // Default: public
  }

  // --- Private extraction helpers ---

  private extractFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const funcRegex = /(?:async\s+)?def\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (PY_RESERVED_KEYWORDS.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);

      // Find indentation to determine function end
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const indentMatch = source.slice(lineStart, match.index).match(/^(\s*)/);
      const baseIndent = indentMatch ? indentMatch[1]!.length : 0;

      let endLine = startLine;
      const afterFunc = source.slice(match.index + match[0].length);
      let bodyIdx: number | null = null;

      // Find the function body start (skip annotations/return type)
      let searchIdx = 0;
      let parens = 1;
      let inString: string | null = null;
      for (let i = 0; i < afterFunc.length && parens > 0; i++) {
        const ch = afterFunc[i]!;
        const prev = i > 0 ? afterFunc[i - 1] : '';
        if (inString) {
          if (ch === inString && prev !== '\\') inString = null;
          continue;
        }
        if (ch === '"' || ch === "'") { inString = ch; continue; }
        if (ch === '(') parens++;
        else if (ch === ')') { parens--; searchIdx = i + 1; }
      }

      if (parens === 0 && searchIdx > 0) {
        const slice = afterFunc.slice(searchIdx);
        const colonIdx = slice.indexOf(':');
        if (colonIdx !== -1) {
          bodyIdx = searchIdx + colonIdx + 1;
        }
      }

      if (bodyIdx !== null) {
        endLine = this.findBlockEndByIndent(source, match.index + match[0].length + bodyIdx, baseIndent);
      }

      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractClasses(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const classRegex = /class\s+(\w+)\s*(?:\(([\s\S]*?)\))?\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);

      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const indentMatch = source.slice(lineStart, match.index).match(/^(\s*)/);
      const baseIndent = indentMatch ? indentMatch[1]!.length : 0;
      const endLine = this.findBlockEndByIndent(source, match.index + match[0].length, baseIndent);

      const bases = match[2] ? match[2].split(',').map((s) => s.trim()) : [];

      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { baseClasses: bases.join(','), filePath },
      });
    }
  }

  private extractDecorators(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const decoratorRegex = /@(\w+(?:\.\w+)*(?:\([\s\S]*?\))?)/g;
    let match: RegExpExecArray | null;
    while ((match = decoratorRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const decoratorName = name.split('(')[0] ?? name;
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: name,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: decoratorName,
        properties: { decorator: decoratorName, filePath },
      });
    }
  }

  private extractDocstrings(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Triple-quoted docstrings
    const docstringRegex = /("""|''')[\s\S]*?\1/g;
    let match: RegExpExecArray | null;
    while ((match = docstringRegex.exec(source)) !== null) {
      const text = match[0];
      const startLine = lineNumberAt(source, match.index);
      const endLine = startLine + (text.match(/\n/g)?.length ?? 0);
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + text.length,
        properties: { filePath },
      });
    }
  }

  private extractImportsAsCaptures(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const parsedImports = this.extractImports(source);
    for (const imp of parsedImports) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }
  }

  private findBlockEndByIndent(source: string, startOffset: number, baseIndent: number): number {
    const lines = source.slice(startOffset).split('\n');
    let lineIdx = 0;

    // Skip the first line if it's empty
    if (lines[0] && lines[0].trim() === '') lineIdx = 1;

    let firstContentIndent: number | null = null;

    for (; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      // Skip empty lines and comments
      const trimmed = line.trimStart();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;

      if (firstContentIndent === null) {
        if (indent > baseIndent) {
          firstContentIndent = indent;
        } else if (indent <= baseIndent && indent === 0) {
          return lineNumberAt(source, startOffset) + lineIdx;
        }
      } else {
        if (indent <= baseIndent) {
          return lineNumberAt(source, startOffset) + lineIdx;
        }
      }
    }

    return lineNumberAt(source, source.length);
  }

  // Expose for tests
  _lineNumberAt(source: string, offset: number): number {
    return lineNumberAt(source, offset);
  }
}
