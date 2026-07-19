// @code-analyzer/analyzer — TypeScript/JavaScript Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';


const tsExtensions = ['.ts', '.tsx', '.mts', '.cts'];
const tsGlobs = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.d.ts'];

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

const TS_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'throw',
  'try', 'catch', 'finally', 'new', 'delete', 'typeof', 'instanceof',
  'import', 'export', 'default', 'break', 'continue', 'yield', 'await',
  'async', 'const', 'let', 'var', 'function', 'class', 'interface',
  'type', 'enum', 'namespace', 'module', 'declare', 'abstract', 'implements',
  'extends', 'super', 'this', 'static', 'public', 'private', 'protected',
  'readonly', 'in', 'of', 'from',
]);

export class TypeScriptProvider implements LanguageProvider {
  readonly language = 'typescript';
  readonly displayName = 'TypeScript';
  readonly extensions = tsExtensions;
  readonly globs = tsGlobs;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    this.extractFunctions(source, filePath, captures);
    this.extractClasses(source, filePath, captures);
    this.extractInterfaces(source, filePath, captures);
    this.extractTypeAliases(source, filePath, captures);
    this.extractEnums(source, filePath, captures);
    this.extractVariables(source, filePath, captures);
    this.extractDecorators(source, filePath, captures);
    this.extractRoutes(source, filePath, captures);
    this.extractDocstrings(source, filePath, captures);
    this.extractImportsAsCaptures(source, filePath, captures);

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const importRegex = /import\s+(?:(type|typeof)\s+)?(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[6]!;
      const line = lineNumberAt(source, match.index);
      const isType = match[1] === 'type';
      const starImport = match[2] === '*';

      if (starImport) {
        const namespace = match[3]!;
        imports.push({
          source: importPath,
          names: [namespace],
          type: 'namespace',
          lineNumber: line,
        });
      } else if (match[4]) {
        const names = this.parseNamedImports(match[4]);
        imports.push({
          source: importPath,
          names,
          type: isType ? 'named' : 'named',
          lineNumber: line,
        });
      } else if (match[5]) {
        const defaultName = match[5];
        imports.push({
          source: importPath,
          names: [defaultName],
          type: 'default',
          lineNumber: line,
        });
      }
    }

    // Dynamic imports: import('./foo')
    const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicRegex.exec(source)) !== null) {
      imports.push({
        source: match[1]!,
        names: [],
        type: 'default',
        lineNumber: lineNumberAt(source, match.index),
      });
    }

    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const exportPatterns = [
      new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const|let|var|interface|type|enum|abstract\\s+class)\\s+${escapeRegex(symbolName)}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${escapeRegex(symbolName)}\\b[^}]*\\}`),
      new RegExp(`export\\s+\\*\\s+from`),
    ];

    return exportPatterns.some((p) => p.test(source));
  }

  // --- Private extraction helpers ---

  private extractFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Named function declarations: function name(...)
    const namedFuncRegex = /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = namedFuncRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (TS_RESERVED_KEYWORDS.has(name)) continue;
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

    // Arrow functions assigned to variables/constants: const name = (...) => ...
    const arrowFuncRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;
    while ((match = arrowFuncRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (TS_RESERVED_KEYWORDS.has(name)) continue;
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
        properties: { async: String(match[0].includes('async')), arrow: 'true', filePath },
      });
    }

    // Class methods: methodName(...) {
    const methodRegex = /(?:(?:public|private|protected|static|async|abstract|readonly)\s+)*(\w+)\s*(<[^>]*>)?\s*\([^)]*\)\s*(?::[\s\S]*?)?\s*\{/g;
    // Context: need to be inside a class body
    const classBodyMatches = this.extractClassBodies(source);
    for (const { startLine: clsStart, name: clsName } of classBodyMatches) {
      const classSource = source.slice(clsStart > 0 ? source.split('\n')[clsStart - 1]?.length ?? 0 : 0, source.length);
      let m: RegExpExecArray | null;
      methodRegex.lastIndex = 0;
      while ((m = methodRegex.exec(classSource)) !== null) {
        const methodName = m[1]!;
        if (TS_RESERVED_KEYWORDS.has(methodName)) continue;
        if (methodName === 'constructor') {
          captures.push({
            tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
            text: methodName,
            startLine: clsStart + lineNumberAt(classSource, m.index) - 1,
            endLine: clsStart + lineNumberAt(classSource, m.index + m[0].length) - 1,
            startByte: m.index,
            endByte: m.index + m[0].length,
            name: methodName,
            containerName: clsName,
            properties: { filePath },
          });
        } else {
          captures.push({
            tag: CAPTURE_TAGS.METHOD_DEF,
            text: methodName,
            startLine: clsStart + lineNumberAt(classSource, m.index) - 1,
            endLine: clsStart + lineNumberAt(classSource, m.index + m[0].length) - 1,
            startByte: m.index,
            endByte: m.index + m[0].length,
            name: methodName,
            containerName: clsName,
            properties: { filePath },
          });
        }
      }
    }
  }

  private extractClasses(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const classRegex = /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      const fullLine = source.slice(match.index, source.indexOf('\n', match.index)).match(/class\s+\w+[\s\S]*/) || source.slice(match.index);
      const extendsMatch = fullLine[0]?.match(/extends\s+(\w+)/);
      const implementsMatch = fullLine[0]?.match(/implements\s+([\w\s,]+)/);

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
          interfaces: implementsMatch ? implementsMatch[1]!.replace(/\s+/g, '') : '',
          abstract: String(match[0].includes('abstract')),
          filePath,
        },
      });
    }
  }

  private extractInterfaces(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const interfaceRegex = /(?:export\s+)?(?:abstract\s+)?interface\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = interfaceRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractTypeAliases(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*(<[^>]*>)?\s*=/g;
    let match: RegExpExecArray | null;
    while ((match = typeRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.TYPE_DEF,
        text: `type ${name}`,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractEnums(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = enumRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { filePath },
      });
    }
  }

  private extractVariables(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // const / let / var at top level or module scope
    const varRegex = /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n]+)?\s*=\s*(?![\s\S]*?=>)/g;
    let match: RegExpExecArray | null;
    while ((match = varRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (TS_RESERVED_KEYWORDS.has(name)) continue;
      if (name === 'constructor') continue;
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

  private extractDecorators(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const decoratorRegex = /@(\w+)(?:\([\s\S]*?\))?/g;
    let match: RegExpExecArray | null;
    while ((match = decoratorRegex.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = lineNumberAt(source, match.index);
      const fullText = match[0];
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: fullText,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + fullText.length,
        name,
        properties: { decorator: name, filePath },
      });
    }
  }

  private extractRoutes(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // @Get('/path'), @Post('/path'), etc.
    const routeDecoratorRegex = /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = routeDecoratorRegex.exec(source)) !== null) {
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
      captures.push({
        tag: CAPTURE_TAGS.ROUTE_METHOD,
        text: method,
        startLine,
        endLine: startLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: method,
        properties: { routePath, filePath },
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

  private extractClassBodies(source: string): Array<{ startLine: number; endLine: number; name: string }> {
    const results: Array<{ startLine: number; endLine: number; name: string }> = [];
    const classRegex = /class\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(source)) !== null) {
      const startLine = lineNumberAt(source, match.index);
      const endLine = this.findBlockEnd(source, match.index + match[0].length);
      results.push({ startLine, endLine, name: match[1]! });
    }
    return results;
  }

  private findBlockEnd(source: string, startOffset: number): number {
    // Find the matching closing brace
    const slice = source.slice(startOffset);
    const openPos = slice.indexOf('{');
    if (openPos === -1) return lineNumberAt(source, startOffset);

    let depth = 0;
    let inString: string | null = null;
    let inComment = false;
    let inLineComment = false;

    for (let i = openPos; i < slice.length; i++) {
      const ch = slice[i];
      const prev = i > 0 ? slice[i - 1] : '';

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }

      if (inComment) {
        if (prev === '*' && ch === '/') inComment = false;
        continue;
      }

      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }

      if (prev === '/' && ch === '*') { inComment = true; continue; }
      if (prev === '/' && ch === '/') { inLineComment = true; continue; }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0) {
          return lineNumberAt(source, startOffset + i);
        }
        depth--;
      }
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
    return names.filter((n) => !TS_RESERVED_KEYWORDS.has(n));
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
