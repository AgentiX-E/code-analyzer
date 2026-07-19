// @code-analyzer/analyzer — JavaScript Provider (JSX aware)

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

type CaptureTag = (typeof CAPTURE_TAGS)[keyof typeof CAPTURE_TAGS];

const jsExtensions = ['.js', '.jsx', '.mjs', '.cjs'];
const jsGlobs = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

const JS_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'throw',
  'try', 'catch', 'finally', 'new', 'delete', 'typeof', 'instanceof',
  'import', 'export', 'default', 'break', 'continue', 'yield', 'await',
  'async', 'const', 'let', 'var', 'function', 'class',
  'extends', 'super', 'this', 'static', 'in', 'of', 'from',
]);

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

export class JavaScriptProvider implements LanguageProvider {
  readonly language = 'javascript';
  readonly displayName = 'JavaScript';
  readonly extensions = jsExtensions;
  readonly globs = jsGlobs;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    this.extractFunctions(source, filePath, captures);
    this.extractClasses(source, filePath, captures);
    this.extractVariables(source, filePath, captures);
    this.extractImportsAsCaptures(source, filePath, captures);
    this.extractDocstrings(source, filePath, captures);
    this.extractJSXComponents(source, filePath, captures);
    this.extractRoutes(source, filePath, captures);

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // Same as TypeScript import extraction
    const importRegex = /import\s+(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[5]!;
      const line = lineNumberAt(source, match.index);
      const starImport = match[1] === '*';

      if (starImport) {
        const namespace = match[2]!;
        imports.push({
          source: importPath,
          names: [namespace],
          type: 'namespace',
          lineNumber: line,
        });
      } else if (match[3]) {
        const names = this.parseNamedImports(match[3]);
        imports.push({
          source: importPath,
          names,
          type: 'named',
          lineNumber: line,
        });
      } else if (match[4]) {
        imports.push({
          source: importPath,
          names: [match[4]],
          type: 'default',
          lineNumber: line,
        });
      }
    }

    // require() calls
    const requireRegex = /(?:const|let|var)\s+(?:\{([\s\S]*?)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(source)) !== null) {
      const importPath = match[3]!;
      if (match[1]) {
        const names = this.parseNamedImports(`{${match[1]}}`);
        imports.push({
          source: importPath,
          names,
          type: 'named',
          lineNumber: lineNumberAt(source, match.index),
        });
      } else if (match[2]) {
        imports.push({
          source: importPath,
          names: [match[2]],
          type: 'default',
          lineNumber: lineNumberAt(source, match.index),
        });
      }
    }

    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    // module.exports = name
    if (new RegExp(`module\\.exports\\s*=\\s*${escapeRegex(symbolName)}\\b`).test(source)) return true;

    // exports.name = ...
    if (new RegExp(`exports\\.${escapeRegex(symbolName)}\\s*=`).test(source)) return true;

    // export { name }
    if (new RegExp(`export\\s*\\{[^}]*\\b${escapeRegex(symbolName)}\\b[^}]*\\}`).test(source)) return true;

    // export default function/class name
    if (new RegExp(`export\\s+default\\s+(?:function|class)\\s+${escapeRegex(symbolName)}\\b`).test(source)) return true;

    // export const/let/var name
    if (new RegExp(`export\\s+(?:const|let|var)\\s+${escapeRegex(symbolName)}\\b`).test(source)) return true;

    // export function/class name
    if (new RegExp(`export\\s+(?:function|class)\\s+${escapeRegex(symbolName)}\\b`).test(source)) return true;

    return false;
  }

  // --- Private extraction helpers ---

  private extractFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Named function declarations
    const namedFuncRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = namedFuncRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (JS_RESERVED_KEYWORDS.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { async: String(match[0].includes('async')), filePath },
      });
    }

    // Arrow functions assigned to variables
    const arrowFuncRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((match = arrowFuncRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (JS_RESERVED_KEYWORDS.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { arrow: 'true', filePath },
      });
    }

    // Class methods
    const classBodyMatches = this.extractClassBodies(source);
    const methodRegex = /(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
    for (const { startLine: clsStart, name: clsName, bodyStart } of classBodyMatches) {
      let m: RegExpExecArray | null;
      methodRegex.lastIndex = 0;
      while ((m = methodRegex.exec(source.slice(bodyStart))) !== null) {
        const methodName = m[1]!;
        if (JS_RESERVED_KEYWORDS.has(methodName)) continue;
        if (methodName === 'constructor') {
          captures.push({
            tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
            text: methodName,
            startLine: clsStart + lineNumberAt(source.slice(bodyStart), m.index) - 1,
            endLine: clsStart + 1,
            startByte: bodyStart + m.index,
            endByte: bodyStart + m.index + m[0].length,
            name: methodName,
            containerName: clsName,
            properties: { filePath },
          });
        } else {
          captures.push({
            tag: CAPTURE_TAGS.METHOD_DEF,
            text: methodName,
            startLine: clsStart + lineNumberAt(source.slice(bodyStart), m.index) - 1,
            endLine: clsStart + 1,
            startByte: bodyStart + m.index,
            endByte: bodyStart + m.index + m[0].length,
            name: methodName,
            containerName: clsName,
            properties: { filePath },
          });
        }
      }
    }
  }

  private extractClasses(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const classRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      const fullLine = source.slice(match.index, source.indexOf('\n', match.index) === -1 ? source.length : source.indexOf('\n', match.index));
      const extendsMatch = fullLine.match(/extends\s+(\w+)/);

      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: {
          baseClasses: extendsMatch ? extendsMatch[1]! : '',
          filePath,
        },
      });
    }
  }

  private extractVariables(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const varRegex = /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*=\s*(?![\s\S]*?(?:=>|function))/g;
    let match: RegExpExecArray | null;
    while ((match = varRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (JS_RESERVED_KEYWORDS.has(name)) continue;
      const line = lineNumberAt(source, match.index);
      captures.push({
        tag: match[0].includes('const') ? (CAPTURE_TAGS.CONSTANT_DEF) : (CAPTURE_TAGS.VARIABLE_DEF),
        text: name,
        startLine: line,
        endLine: line,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractJSXComponents(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // JSX component detection: function/const returning JSX
    // Look for function patterns where the body contains JSX-like syntax
    const componentRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:\s*=\s*(?:\([^)]*\)|[\w\s,]*)\s*=>\s*|\([^)]*\)\s*\{)[\s\S]*?return\s*[\s\S]*?</g;
    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (JS_RESERVED_KEYWORDS.has(name)) continue;
      if (name[0] !== name[0]!.toUpperCase()) continue; // Components start with uppercase
      const startLine = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.COMPONENT_PROPS,
        text: name,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { isComponent: 'true', filePath },
      });
    }
  }

  private extractRoutes(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Express router patterns
    const routeRegex = /(?:app|router|this)\s*\.\s*(get|post|put|delete|patch|use)\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(source)) !== null) {
      const method = match[1]!;
      const routePath = match[2]!;
      const startLine = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.ROUTE_PATH,
        text: routePath,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: routePath,
        properties: { routeMethod: method.toUpperCase(), filePath },
      });
    }
  }

  private extractDocstrings(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const jsdocRegex = /\/\*\*([\s\S]*?)\*\//g;
    let match: RegExpExecArray | null;
    while ((match = jsdocRegex.exec(source)) !== null) {
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

  private extractClassBodies(source: string): Array<{ startLine: number; name: string; bodyStart: number }> {
    const results: Array<{ startLine: number; name: string; bodyStart: number }> = [];
    const classRegex = /class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(source)) !== null) {
      const slice = source.slice(match.index);
      const openPos = slice.indexOf('{');
      if (openPos !== -1) {
        results.push({
          startLine: lineNumberAt(source, match.index),
          name: match[1]!,
          bodyStart: match.index + openPos + 1,
        });
      }
    }
    return results;
  }

  private findBlockEnd(source: string, startOffset: number): number {
    const slice = source.slice(startOffset);
    const openPos = slice.indexOf('{');
    if (openPos === -1) return lineNumberAt(source, startOffset);

    let depth = 0;
    let inString: string | null = null;
    let inComment = false;
    let inLineComment = false;

    for (let i = openPos; i < slice.length; i++) {
      const ch = slice[i]!;
      const prev = i > 0 ? slice[i - 1] : '';

      if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
      if (inComment) { if (prev === '*' && ch === '/') inComment = false; continue; }
      if (inString) { if (ch === inString && prev !== '\\') inString = null; continue; }

      if (prev === '/' && ch === '*') { inComment = true; continue; }
      if (prev === '/' && ch === '/') { inLineComment = true; continue; }

      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }

      if (ch === '{') depth++;
      else if (ch === '}') { if (depth === 0) return lineNumberAt(source, startOffset + i); depth--; }
    }

    return lineNumberAt(source, source.length);
  }

  private parseNamedImports(braceContent: string): string[] {
    const names: string[] = [];
    const nameRegex = /(\w+)(?:\s+as\s+(\w+))?/g;
    let match: RegExpExecArray | null;
    while ((match = nameRegex.exec(braceContent)) !== null) {
      names.push(match[2] ?? match[1]!);
    }
    return names;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
