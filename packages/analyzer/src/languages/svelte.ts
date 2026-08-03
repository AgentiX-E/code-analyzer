// @code-analyzer/analyzer — Svelte Provider (regex-based parser)
// Regex-based parsing for .svelte files. Extracts imports, exports,
// reactive declarations ($:), component props (export let), and functions
// from <script> blocks. Template and <style> blocks are recognized but
// not deeply parsed.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

export class SvelteProvider implements LanguageProvider {
  readonly language = 'svelte';
  readonly displayName = 'Svelte';
  readonly extensions = ['.svelte'];
  readonly globs = ['**/*.svelte'];
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lineFromOffset = (off: number) => source.slice(0, off).split('\n').length;

    // Extract all <script> blocks (including context="module" variants)
    const scriptBlocks = this.extractScriptBlocks(source);
    for (const block of scriptBlocks) {
      const blockOffset = block.offset;
      const blockContent = block.content;

      // Extract imports
      this.parseImports(blockContent, blockOffset, lineFromOffset, captures, filePath);

      // Extract reactive declarations: $: name = ...
      this.parseReactiveDeclarations(blockContent, blockOffset, lineFromOffset, captures, filePath);

      // Extract export let (component props)
      this.parseExportLet(blockContent, blockOffset, lineFromOffset, captures, filePath);

      // Extract export function / export const / export class
      this.parseExportedDefinitions(blockContent, blockOffset, lineFromOffset, captures, filePath);

      // Extract function definitions (not already captured as exports)
      this.parseFunctions(blockContent, blockOffset, lineFromOffset, captures, filePath);

      // Extract variable declarations (let/const/var that are not exports or reactive)
      this.parseVariables(blockContent, blockOffset, lineFromOffset, captures, filePath);
    }

    // Extract component names from HTML-like template (top-level elements)
    this.parseTemplateElements(source, lineFromOffset, captures, filePath);

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const lineFromOffset = (off: number) => source.slice(0, off).split('\n').length;

    const scriptBlocks = this.extractScriptBlocks(source);
    for (const block of scriptBlocks) {
      const blockContent = block.content;
      const blockOffset = block.offset;

      // ES module imports: import X from 'module'
      const importRegex = /import\s+(?:type\s+)?(?:(\*)\s+as\s+(\w+)|(\{[\s\S]*?\})|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(blockContent)) !== null) {
        const path = match[5]!;
        const absOffset = blockOffset + match.index;
        const line = lineFromOffset(absOffset);

        if (match[2]) {
          // import * as Name from 'module'
          imports.push({ source: path, names: [match[2]], type: 'namespace', lineNumber: line });
        } else if (match[3]) {
          // import { a, b } from 'module'
          const names = this.parseNamedSpecifiers(match[3]);
          imports.push({ source: path, names, type: 'named', lineNumber: line });
        } else if (match[4]) {
          // import Name from 'module'
          imports.push({ source: path, names: [match[4]], type: 'default', lineNumber: line });
        }
      }

      // Dynamic imports: import('module')
      const dynRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynRegex.exec(blockContent)) !== null) {
        const absOffset = blockOffset + match.index;
        imports.push({
          source: match[1]!,
          names: [],
          type: 'default',
          lineNumber: lineFromOffset(absOffset),
        });
      }
    }

    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Check for export statements: export function/const/let/class name
    const exportDeclRegex = new RegExp(
      `export\\s+(?:default\\s+)?(?:function|const|let|var|class)\\s+${escaped}\\b`
    );
    if (exportDeclRegex.test(source)) return true;

    // Check for named export: export { name }
    const namedExportRegex = new RegExp(
      `export\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`
    );
    if (namedExportRegex.test(source)) return true;

    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract content of <script> and <script context="module"> blocks.
   * Returns an array of { content, offset } for each script block.
   */
  private extractScriptBlocks(source: string): Array<{ content: string; offset: number }> {
    const blocks: Array<{ content: string; offset: number }> = [];
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = scriptRegex.exec(source)) !== null) {
      const attrs = match[1] ?? '';
      const content = match[2] ?? '';
      const tagEnd = '<script' + attrs + '>';
      const offset = match.index + tagEnd.length;
      // Include context="module" blocks as well
      blocks.push({ content, offset });
    }

    return blocks;
  }

  /**
   * Parse import statements from script content and add import captures.
   */
  private parseImports(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    const importRegex = /import\s+(?:type\s+)?(?:(?:\*\s+as\s+\w+)|(?:\{[\s\S]*?\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(blockContent)) !== null) {
      const sourcePath = match[1]!;
      const absOffset = blockOffset + match.index;
      const startLine = lineFromOffset(absOffset);
      const endLine = lineFromOffset(absOffset + match[0].length);

      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: sourcePath,
        startLine,
        endLine,
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: sourcePath,
        properties: { filePath, importType: 'named' },
      });
    }
  }

  /**
   * Parse reactive declarations: $: name = expression
   */
  private parseReactiveDeclarations(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    // $: name = ... or $: { ... } or $: if (...)
    const reactiveRegex = /\$\s*:\s*(?:(\w+)\s*=|(\w+)\s*\()/gm;
    let match: RegExpExecArray | null;

    while ((match = reactiveRegex.exec(blockContent)) !== null) {
      const name = match[1] ?? match[2];
      if (!name) continue;

      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name,
        properties: { reactive: 'true', filePath },
      });
    }
  }

  /**
   * Parse export let (component props): export let propName
   */
  private parseExportLet(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    const exportLetRegex = /export\s+let\s+(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = exportLetRegex.exec(blockContent)) !== null) {
      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.COMPONENT_PROPS,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { componentProp: 'true', filePath },
      });
    }
  }

  /**
   * Parse exported definitions: export function/const/class name
   */
  private parseExportedDefinitions(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    // export function name (including async)
    const exportFuncRegex = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = exportFuncRegex.exec(blockContent)) !== null) {
      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { exported: 'true', filePath },
      });
    }

    // export const name = ... (arrow functions and values)
    const exportConstRegex = /export\s+(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n]+)?\s*=/g;
    while ((match = exportConstRegex.exec(blockContent)) !== null) {
      const absOffset = blockOffset + match.index;
      // Check if it's an arrow function (including async arrows)
      const afterEq = blockContent.slice(match.index + match[0].length).trimStart();
      const isArrow = afterEq.includes('=>');
      const tag = isArrow ? CAPTURE_TAGS.FUNCTION_DEF : CAPTURE_TAGS.CONSTANT_DEF;

      captures.push({
        tag,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { exported: 'true', ...(isArrow ? { arrow: 'true' } : {}), filePath },
      });
    }
  }

  /**
   * Parse regular (non-exported) function definitions.
   */
  private parseFunctions(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    // Match function declarations: function name( or async function name(
    let match: RegExpExecArray | null;
    const funcRegex = /\b(?:async\s+)?function\s+(\w+)\s*\(/g;

    while ((match = funcRegex.exec(blockContent)) !== null) {
      // Skip if preceded by 'export' keyword
      const beforeMatch = blockContent.slice(Math.max(0, match.index - 10), match.index);
      if (/\bexport\s*$/.test(beforeMatch)) continue;

      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Arrow functions assigned to variables: const name = () => ...
    // Only capture those not already matched as export const
    const arrowRegex = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\s*\([^)]*\)\s*=>/g;
    while ((match = arrowRegex.exec(blockContent)) !== null) {
      // Skip if preceded by 'export' keyword
      const beforeMatch = blockContent.slice(Math.max(0, match.index - 10), match.index);
      if (/\bexport\s*$/.test(beforeMatch)) continue;

      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { arrow: 'true', filePath },
      });
    }
  }

  /**
   * Parse variable declarations (let/const/var).
   */
  private parseVariables(
    blockContent: string,
    blockOffset: number,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    // Match variable declarations: let name = ..., const name = ..., var name = ...
    // Skip arrow functions (already captured as functions)
    // Skip declarations preceded by 'export' keyword
    const varRegex = /\b(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n]+)?\s*=(?![^=]*=>)/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(blockContent)) !== null) {
      // Skip if preceded by 'export' keyword
      const beforeMatch = blockContent.slice(Math.max(0, match.index - 10), match.index);
      if (/\bexport\s*$/.test(beforeMatch)) continue;

      const absOffset = blockOffset + match.index;
      const isConst = match[0].startsWith('const');
      const tag = isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;

      captures.push({
        tag,
        text: match[0],
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }

    // Capture let/const declarations without initializer: let name; const name;
    // Only match lines that are purely declarations (no assignment)
    const plainDeclRegex = /^\s*(?:let|const)\s+(\w+)\s*[;\n]/gm;
    while ((match = plainDeclRegex.exec(blockContent)) !== null) {
      // Skip if preceded by 'export' keyword on the same line context
      const absOffset = blockOffset + match.index;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: match[0].trim(),
        startLine: lineFromOffset(absOffset),
        endLine: lineFromOffset(absOffset + match[0].length),
        startByte: absOffset,
        endByte: absOffset + match[0].length,
        name: match[1]!,
        properties: { filePath },
      });
    }
  }

  /**
   * Parse top-level HTML elements in the template section as component/usages.
   */
  private parseTemplateElements(
    source: string,
    lineFromOffset: (off: number) => number,
    captures: UnifiedCapture[],
    filePath: string,
  ): void {
    // Match opening tags of custom components (PascalCase or kebab-case with dash)
    const tagRegex = /<(\w+(?:-\w+)+|[A-Z]\w*)(?:\s[^>]*)?(?:\/?>)/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(source)) !== null) {
      // Skip standard HTML tags; PascalCase tags are custom components
      const tagName = match[1]!;
      if (this.isStandardHtmlTag(tagName)) continue;

      // Skip if inside <script> or <style> blocks
      const beforeMatch = source.slice(0, match.index);
      const lastScriptOpen = beforeMatch.lastIndexOf('<script');
      const lastScriptClose = beforeMatch.lastIndexOf('</script>');
      const lastStyleOpen = beforeMatch.lastIndexOf('<style');
      const lastStyleClose = beforeMatch.lastIndexOf('</style>');

      // Calculate the effective end of the last closed script block
      // If we're inside a script block, skip
      const inScript = lastScriptOpen > lastScriptClose;
      const inStyle = lastStyleOpen > lastStyleClose;
      if (inScript || inStyle) continue;

      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: tagName,
        startLine: lineFromOffset(match.index),
        endLine: lineFromOffset(match.index + match[0].length),
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: tagName,
        properties: { component: 'true', filePath },
      });
    }
  }

  /**
   * Check if a tag name is a standard HTML element.
   * PascalCase names (e.g., Header) are always treated as custom components.
   */
  private isStandardHtmlTag(name: string): boolean {
    // PascalCase names are custom Svelte components, not HTML elements
    if (name.length > 0 && name[0] === name[0]!.toUpperCase() && name[0] !== name[0]!.toLowerCase()) {
      return false;
    }

    const htmlTags = new Set([
      'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
      'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
      'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
      'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
      'em', 'embed',
      'fieldset', 'figcaption', 'figure', 'footer', 'form',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html',
      'i', 'iframe', 'img', 'input', 'ins',
      'kbd',
      'label', 'legend', 'li', 'link',
      'main', 'map', 'mark', 'meta', 'meter',
      'nav', 'noscript',
      'object', 'ol', 'optgroup', 'option', 'output',
      'p', 'param', 'picture', 'pre', 'progress',
      'q',
      'rp', 'rt', 'ruby',
      's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong',
      'style', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'template',
      'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
      'u', 'ul',
      'var', 'video',
      'wbr',
    ]);
    return htmlTags.has(name.toLowerCase());
  }

  /**
   * Parse named import specifiers from `{ a, b as c }`.
   */
  private parseNamedSpecifiers(braceContent: string): string[] {
    const names: string[] = [];
    const regex = /(\w+)(?:\s+as\s+(\w+))?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(braceContent)) !== null) {
      names.push(match[2] ?? match[1]!);
    }
    return names;
  }
}
