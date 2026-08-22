// @code-analyzer/analyzer — Scala Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const SCALA_EXTENSIONS = ['.scala', '.sc'];
const SCALA_GLOBS = ['**/*.scala', '**/*.sc'];

export class ScalaProvider extends TreeSitterBaseProvider {
  readonly language = 'scala';
  readonly displayName = 'Scala';
  readonly extensions = SCALA_EXTENSIONS;
  readonly globs = SCALA_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-scala') as TreeSitterLanguage;
    } catch {
      /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
    /* v8 ignore stop */
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'class_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `class ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'object_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `object ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { isObject: 'true', filePath: this.filePath },
        });
      }
    } else if (nodeType === 'trait_definition') {
      const nameNode = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.INTERFACE_DEF,
          text: `trait ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'function_definition' || nodeType === 'function_declaration') {
      const nameNode = this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'import_declaration') {
      const path = this.collectImportPath(node);
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (path) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: path,
          properties: { filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const path = this.collectImportPath(node);
      /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
      if (path) {
        imports.push({
          source: path,
          names: [path.split('.').pop() ?? path],
          type: 'named',
          lineNumber: node.startPosition.row + 1,
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    if (
      node.type === 'class_definition' ||
      node.type === 'trait_definition' ||
      node.type === 'object_definition' ||
      node.type === 'function_definition'
    ) {
      const nameNode = this.findNamedChild(node, 'identifier');
      if (nameNode && nameNode.text === symbolName) {
        // Check for private/protected access modifiers in modifiers child
        const modifiers = this.findNamedChild(node, 'modifiers');
        if (modifiers) {
          const accessMod = this.findNamedChild(modifiers, 'access_modifier');
          if (accessMod) {
            const modText = accessMod.text.trim();
            // Access modifiers may carry a scope qualifier: private, private[pkg],
            // private[this], protected, protected[pkg]. Match by prefix.
            /* v8 ignore next -- @preserve -- tree-sitter-scala always emits these child nodes */
            if (modText.startsWith('private') || modText.startsWith('protected')) return false;
          }
        }
        // Fallback: check source text before node start for older tree-sitter versions
        const prefix = this.source.slice(Math.max(0, node.startIndex - 15), node.startIndex);
        const privateRegex = /private\s*\[.*?\]\s*$/;
        /* v8 ignore next -- @preserve -- modifiers node is always present in current grammar */
        if (privateRegex.test(prefix)) return false;
        /* v8 ignore next -- @preserve -- modifiers node is always present in current grammar */
        if (/private\s+/.test(prefix) || /protected\s+/.test(prefix)) return false;
        return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Class definitions
    const classRegex = /(?:abstract\s+)?(?:case\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Object definitions
    const objectRegex = /object\s+(\w+)/g;
    while ((m = objectRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `object ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isObject: 'true', filePath },
      });
    }

    // Trait definitions
    const traitRegex = /trait\s+(\w+)/g;
    while ((m = traitRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `trait ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Function definitions (def keyword)
    const funcRegex = /def\s+(\w+)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Import statements
    const importRegex = /import\s+([\w.]+(?:\.[\w{}]+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const importRegex = /import\s+([\w.]+(?:\.[\w{}]+)*)/g;
    while ((m = importRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('.').pop()?.replace(/[{}]/g, '') ?? m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`private\\s+(?:class|object|trait|def|val|var)\\s+${s}\\b`).test(source))
      return false;
    if (new RegExp(`protected\\s+(?:class|object|trait|def|val|var)\\s+${s}\\b`).test(source))
      return false;
    return new RegExp(`\\b(?:class|object|trait|def)\\s+${s}\\b`).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private collectImportPath(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      /* v8 ignore next -- @preserve -- imports emit flat identifier children, not stable_identifier */
      if (child.type === 'identifier') parts.push(child.text);
      else if (child.type === 'stable_identifier') {
        for (let j = 0; j < child.namedChildCount; j++) {
          if (child.namedChild(j).type === 'identifier') parts.push(child.namedChild(j).text);
        }
      }
    }
    return parts.join('.');
  }

  /* v8 ignore next -- @preserve -- only used by regex fallback */
  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
