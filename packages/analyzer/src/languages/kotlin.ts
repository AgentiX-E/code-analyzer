// @code-analyzer/analyzer — Kotlin Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const KOTLIN_EXTENSIONS = ['.kt', '.kts'];
const KOTLIN_GLOBS = ['**/*.kt', '**/*.kts'];

export class KotlinProvider extends TreeSitterBaseProvider {
  readonly language = 'kotlin';
  readonly displayName = 'Kotlin';
  readonly extensions = KOTLIN_EXTENSIONS;
  readonly globs = KOTLIN_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-kotlin') as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'function_declaration', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
      { nodeType: 'interface_declaration', captureTag: CAPTURE_TAGS.INTERFACE_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_class', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
    ];
  }

  // When tree-sitter grammar is available, use AST walking
  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // Only used when grammar is loaded — fallback handles otherwise
    const nodeType = node.type;

    if (nodeType === 'class_declaration' || nodeType === 'object_declaration') {
      const nameNode = this.findChild(node, 'identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `${nodeType === 'object_declaration' ? 'object' : 'class'} ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'function_declaration') {
      const nameNode = this.findChild(node, 'identifier');
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
    }

    // Capture import statements in the unified capture stream
    if (nodeType === 'import_header') {
      const parts = this.collectImportPathParts(node);
      const sourcePath = parts.join('.');
      if (sourcePath) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: sourcePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: sourcePath,
          properties: { filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Import extraction via AST walking ----

  /**
   * Walk the AST to find and extract Kotlin import statements.
   * Kotlin imports are represented as `import_header` nodes in the tree-sitter AST.
   * 
   * Syntax handled:
   *   import kotlin.collections.List           // named import
   *   import kotlin.collections.*               // wildcard import
   *   import kotlin.collections.List as MyList  // aliased import
   */
  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_header') {
      this.extractKotlinImport(node, imports);
      return; // Don't recurse into import children
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  /**
   * Extract import details from a Kotlin `import_header` AST node.
   * Collects identifiers to build the package path, detects wildcard (*) imports,
   * and extracts alias names from `as` clauses.
   */
  private extractKotlinImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const line = node.startPosition.row + 1;
    const parts: string[] = [];
    let aliasName: string | undefined;
    let isWildcard = false;

    // Collect all identifier children to build the package path
    // and check for wildcard character
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);

      if (child.type === 'identifier') {
        parts.push(child.text);
      } else if (child.text === '*') {
        isWildcard = true;
        parts.push('*');
      }
    }

    // Search for 'as' keyword followed by an identifier to extract the alias
    for (let i = 0; i < node.childCount - 1; i++) {
      if (node.child(i).text === 'as' && node.child(i + 1).type === 'identifier') {
        aliasName = node.child(i + 1).text;
        break;
      }
    }

    const sourcePath = parts.join('.');
    if (!sourcePath) return;

    // Build the import name list:
    // - Aliased imports use the alias name
    // - Wildcard imports have an empty names array
    // - Named imports use the last segment of the path
    let names: string[];
    if (aliasName) {
      names = [aliasName];
    } else if (isWildcard) {
      names = [];
    } else {
      const lastName = parts[parts.length - 1]!;
      names = [lastName];
    }

    imports.push({
      source: sourcePath,
      names,
      type: isWildcard ? 'wildcard' : 'named',
      lineNumber: line,
    });
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Classes
    const clRegex = /(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)*class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.INTERFACE_DEF, text: `interface ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Objects
    const objRegex = /(?:companion\s+)?object\s+(\w+)/g;
    while ((m = objRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `object ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isObject: 'true', filePath } });
    }

    // Enum classes
    const enumRegex = /enum\s+class\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum class ${m[1]!}`, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Functions
    const funcRegex = /(?:(?:private|internal|protected|public|override|open|abstract|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }

    // Properties (val/var)
    const propRegex = /(?:const\s+)?(?:lateinit\s+)?(?:private\s+|internal\s+|protected\s+)?(?:override\s+)?(?:open\s+)?(?:abstract\s+)?(val|var)\s+(\w+)/g;
    while ((m = propRegex.exec(source)) !== null) {
      const tag = m[1] === 'val' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({ tag, text: m[2]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { filePath } });
    }

    // Annotations
    const annRegex = /@(\w+)(?:\([\s\S]*?\))?/g;
    while ((m = annRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.DECORATOR, text: m[0], startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { decorator: m[1]!, filePath } });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: imp.source, startLine: imp.lineNumber, endLine: imp.lineNumber, startByte: 0, endByte: 0, name: imp.source, properties: { names: imp.names.join(','), importType: imp.type, filePath } });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    // Matches:
    //   import kotlin.collections.List           -> named
    //   import kotlin.collections.*               -> wildcard
    //   import kotlin.collections.List as MyList  -> aliased (named, using alias)
    const regex = /import\s+([\w.*]+)(?:\s+as\s+(\w+))?/g;
    while ((m = regex.exec(source)) !== null) {
      const fullPath = m[1]!;
      const alias = m[2];
      const isWildcard = fullPath.endsWith('.*');
      const parts = fullPath.split('.');

      imports.push({
        source: fullPath,
        names: alias ? [alias] : (isWildcard ? [] : [parts[parts.length - 1]!]),
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:class|interface|object|fun|val|var)\\s+${s}\\b`).test(source);
  }

  // ---- Utility helpers ----

  /**
   * Find the first named child with the given type.
   */
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /**
   * Recursively search for a descendant node with the given type.
   */
  private findDeepChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    if (node.type === type) return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findDeepChild(node.namedChild(i), type);
      if (result) return result;
    }
    return null;
  }

  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /**
   * Collect all identifier/namespace segments from an import node
   * into an ordered array of path parts.
   */
  private collectImportPathParts(node: TreeSitterSyntaxNode): string[] {
    const parts: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'identifier') {
        parts.push(child.text);
      } else if (child.text === '*') {
        parts.push('*');
      }
    }
    return parts;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
