// @code-analyzer/analyzer — C Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const C_EXTENSIONS = ['.c', '.h'];
const C_GLOBS = ['**/*.c', '**/*.h'];

export class CProvider extends TreeSitterBaseProvider {
  readonly language = 'c';
  readonly displayName = 'C';
  readonly extensions = C_EXTENSIONS;
  readonly globs = C_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-c') as TreeSitterLanguage;
    } catch {
      /* v8 ignore next -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_definition' || nodeType === 'declaration') {
      const nameNode = this.extractFunctionNameNode(node);
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
    } else if (nodeType === 'struct_specifier') {
      // The name is always a `type_identifier`; anonymous structs omit it.
      const nameNode = this.findNamedChild(node, 'type_identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.STRUCT_DEF,
          text: `struct ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'enum_specifier') {
      const nameNode = this.findNamedChild(node, 'type_identifier');
      if (nameNode) {
        captures.push({
          tag: CAPTURE_TAGS.ENUM_DEF,
          text: `enum ${nameNode.text}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'preproc_include') {
      const path = this.extractIncludePath(node);
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
    if (node.type === 'preproc_include') {
      const path = this.extractIncludePath(node);
      if (path) {
        imports.push({
          source: path,
          names: [path.split('/').pop()!],
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
    let nameNode: TreeSitterSyntaxNode | null = null;
    if (node.type === 'function_definition' || node.type === 'declaration') {
      nameNode = this.extractFunctionNameNode(node);
    } else if (node.type === 'struct_specifier' || node.type === 'enum_specifier') {
      nameNode = this.findNamedChild(node, 'type_identifier');
    }

    if (nameNode && nameNode.text === symbolName) {
      // C: top-level declarations are externally visible unless `static`.
      return !this.hasStaticStorage(node);
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Struct definitions
    const structRegex = /(?:typedef\s+)?struct\s+(\w+)/g;
    while ((m = structRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.STRUCT_DEF,
        text: `struct ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Enum definitions
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Function definitions/declarations: [storage] return_type [*] name(params) {|;
    // The return-type group allows stars both attached to the type (`int* fp`)
    // and attached to the name (`int *fp`); the name is the last word before `(`.
    const funcRegex =
      /(?:(?:static|inline|extern)\s+)*(?:\w+[\*]*\s+)+(\*+\s*)?(\w+)\s*\([^)]*\)\s*(?:\{|;)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      const name = m[2]!;
      if (!this.isValidFnName(name)) continue;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name,
        properties: { filePath },
      });
    }

    // Includes
    const incRegex = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((m = incRegex.exec(source)) !== null) {
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

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const incRegex = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((m = incRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('/').pop()!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A `static` function — with any number of storage/type words before the
    // name (`static inline void helper`) — is not exported.
    const staticRegex = new RegExp(`static(?:\\s+\\w+)*\\s+${s}\\s*\\(`);
    if (staticRegex.test(source)) return false;
    return new RegExp(`\\b(?:struct|enum|void|int|char|float|double|long|short)\\s+${s}\\b`).test(
      source,
    );
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /**
   * Return the `identifier` naming a function. For pointer-returning functions
   * (`int *fp(void)`) the `function_declarator` is nested inside a
   * `pointer_declarator`, so unwrap those first. Function-pointer declarations
   * (`int (*fp)(int)`) have no direct `identifier` under the declarator and
   * are correctly skipped.
   */
  private extractFunctionNameNode(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    const declarator = this.findNamedChild(node, 'function_declarator');
    if (declarator) return this.findNamedChild(declarator, 'identifier');
    const pointer = this.findNamedChild(node, 'pointer_declarator');
    return pointer ? this.extractFunctionNameNode(pointer) : null;
  }

  /** Strip quotes/angle brackets from a `preproc_include` path, or `''` for macros. */
  private extractIncludePath(node: TreeSitterSyntaxNode): string {
    const literal =
      this.findNamedChild(node, 'string_literal') || this.findNamedChild(node, 'system_lib_string');
    return literal ? literal.text.replace(/^["'<]|["'>]$/g, '') : '';
  }

  private hasStaticStorage(node: TreeSitterSyntaxNode): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'storage_class_specifier' && child.text === 'static') return true;
    }
    return false;
  }

  private isValidFnName(name: string): boolean {
    return ![
      'if',
      'else',
      'while',
      'for',
      'switch',
      'case',
      'default',
      'return',
      'break',
      'continue',
      'goto',
      'sizeof',
      'typedef',
      'struct',
      'enum',
      'union',
      'static',
      'extern',
      'const',
      'void',
      'int',
      'char',
      'float',
      'double',
      'long',
      'short',
      'unsigned',
      'signed',
      'auto',
      'register',
      'volatile',
    ].includes(name);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
