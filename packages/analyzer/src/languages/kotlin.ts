// @code-analyzer/analyzer — Kotlin Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

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
      /* v8 ignore next -- @preserve -- native grammar module load failure is untestable */
      return null;
    }
  }

  // When tree-sitter grammar is available, use AST walking
  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // Only used when grammar is loaded — fallback handles otherwise
    const nodeType = node.type;

    if (nodeType === 'class_declaration' || nodeType === 'object_declaration') {
      // tree-sitter-kotlin uses 'type_identifier' for class/object names
      const nameNode = this.findChild(node, 'type_identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries a name child */
      if (nameNode) {
        // Check if this is an enum class (has enum_class_body child)
        let isEnum = false;
        for (let c = 0; c < node.namedChildCount; c++) {
          if (node.namedChild(c).type === 'enum_class_body') {
            isEnum = true;
            break;
          }
        }
        // tree-sitter-kotlin represents interfaces as class_declaration with an
        // 'interface' keyword; distinguish them so they are not mislabeled CLASS_DEF
        let isInterface = false;
        for (let c = 0; c < node.childCount; c++) {
          if (node.child(c).type === 'interface') {
            isInterface = true;
            break;
          }
        }
        const isObject = nodeType === 'object_declaration';
        const tag = isEnum
          ? CAPTURE_TAGS.ENUM_DEF
          : isInterface
            ? CAPTURE_TAGS.INTERFACE_DEF
            : CAPTURE_TAGS.CLASS_DEF;
        captures.push({
          tag,
          text: isEnum
            ? `enum class ${nameNode.text}`
            : `${isInterface ? 'interface' : isObject ? 'object' : 'class'} ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath, ...(isObject ? { isObject: 'true' } : {}) },
        });
      }
    } else if (nodeType === 'function_declaration') {
      // tree-sitter-kotlin uses 'simple_identifier' for function names
      const nameNode = this.findChild(node, 'simple_identifier');
      /* v8 ignore next -- @preserve -- a declaration node always carries a name child */
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
      /* v8 ignore next -- @preserve -- an import_header always carries a path */
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

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nodeType = node.type;
    if (
      nodeType === 'class_declaration' ||
      nodeType === 'object_declaration' ||
      nodeType === 'function_declaration' ||
      nodeType === 'property_declaration'
    ) {
      const nameNode =
        this.findChild(node, 'type_identifier') ??
        this.findChild(node, 'simple_identifier') ??
        this.findChild(node, 'identifier');
      if (nameNode && nameNode.text === symbolName) return true;
    }
    // Also check children for other exportable nodes
    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  /** Public wrapper for checkExported used by direct tests. */
  kotlinCheckExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.checkExported(node, symbolName);
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

    // Tree-sitter: import_alias holds the alias name as a type_identifier child
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'import_alias') {
        const aliasNode = this.findChild(child, 'type_identifier');
        /* v8 ignore next -- @preserve -- an import_alias always carries a type_identifier */
        if (aliasNode) {
          aliasName = aliasNode.text;
        }
        break;
      }
    }

    const sourcePath = parts.join('.');
    /* v8 ignore next -- @preserve -- an import_header always carries an identifier path */
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
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Classes
    const clRegex = /(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+)*class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
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

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Objects
    const objRegex = /(?:companion\s+)?object\s+(\w+)/g;
    while ((m = objRegex.exec(source)) !== null) {
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

    // Enum classes
    const enumRegex = /enum\s+class\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Functions (including extension functions: fun Type.name)
    const funcRegex =
      /(?:(?:private|internal|protected|public|override|open|abstract|suspend|inline|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)/g;
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

    // Properties (val/var)
    const propRegex =
      /(?:const\s+)?(?:lateinit\s+)?(?:private\s+|internal\s+|protected\s+)?(?:override\s+)?(?:open\s+)?(?:abstract\s+)?(val|var)\s+(\w+)/g;
    while ((m = propRegex.exec(source)) !== null) {
      const tag = m[1] === 'val' ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF;
      captures.push({
        tag,
        text: m[2]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!,
        properties: { filePath },
      });
    }

    // Annotations
    const annRegex = /@(\w+)(?:\([\s\S]*?\))?/g;
    while ((m = annRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: m[0],
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { decorator: m[1]!, filePath },
      });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
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

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
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
        names: alias ? [alias] : isWildcard ? [] : [parts[parts.length - 1]!],
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:class|interface|object|fun|val|var)\\s+${s}\\b`).test(source);
  }

  // ---- Utility helpers ----

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
