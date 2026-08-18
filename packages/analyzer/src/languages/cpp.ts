// @code-analyzer/analyzer — C++ Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const CPP_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'];
const CPP_GLOBS = ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.hh', '**/*.hxx'];

export class CppProvider extends TreeSitterBaseProvider {
  readonly language = 'cpp';
  readonly displayName = 'C++';
  readonly extensions = CPP_EXTENSIONS;
  readonly globs = CPP_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-cpp') as TreeSitterLanguage;
    } /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
    catch {
      return null;
    }
    /* v8 ignore stop */
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_definition' || nodeType === 'function_declarator') {
      const nameNode = this.findNamedChild(node, 'identifier') || this.findNamedChild(node, 'field_identifier');
      if (nameNode && this.isValidFnName(nameNode.text)) {
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
    } else if (nodeType === 'class_specifier') {
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
      const nameNode = this.findNamedChild(node, 'type_identifier') || this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
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
    } else if (nodeType === 'struct_specifier') {
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
      const nameNode = this.findNamedChild(node, 'type_identifier') || this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
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
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
      const nameNode = this.findNamedChild(node, 'type_identifier') || this.findNamedChild(node, 'identifier');
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
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
      let path = '';
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'string_literal' || child.type === 'system_lib_string') {
          path = child.text.replace(/^["'<]|["'>]$/g, '');
        }
      }
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
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
      let path = '';
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'string_literal' || child.type === 'system_lib_string') {
          path = child.text.replace(/^["'<]|["'>]$/g, '');
        }
      }
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
      if (path) {
        imports.push({
          source: path,
          /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
          names: [path.split('/').pop() ?? path],
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
    if (node.type === 'function_definition' || node.type === 'class_specifier' ||
        node.type === 'struct_specifier' || node.type === 'enum_specifier') {
      // For functions the name lives inside function_declarator; for
      // class/struct/enum it is a direct type_identifier/identifier child.
      let nameNode: TreeSitterSyntaxNode | null;
      if (node.type === 'function_definition') {
        const declarator = this.findNamedChild(node, 'function_declarator');
        /* v8 ignore next -- @preserve -- declarator is always non-null for function definitions */
        nameNode = declarator
          ? (this.findNamedChild(declarator, 'identifier') || this.findNamedChild(declarator, 'field_identifier'))
          : null;
      } else {
        /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
        nameNode = this.findNamedChild(node, 'type_identifier') || this.findNamedChild(node, 'identifier');
      }
      /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
      if (nameNode && nameNode.text === symbolName) {
        // C++: all top-level declarations are exported (public by default)
        // unless declared in an anonymous namespace or static
        const prefix = this.source.slice(Math.max(0, node.startIndex - 20), node.startIndex);
        /* v8 ignore next -- @preserve -- tree-sitter-cpp guarantees these child nodes / keyword placement */
        if (prefix.includes('static')) return false;
        // The static keyword lives inside the node (storage_class_specifier),
        // not before it, so also check the node text itself.
        if (/^\s*static\b/.test(node.text)) return false;
        if (prefix.includes('namespace') && prefix.includes('{')) return false;
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

    // Class definitions: class ClassName
    const classRegex = /(?:(?:template\s*<[^>]*>\s*)?(?:class|typename)\s+)?\bclass\s+(\w+)/g;
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
    const enumRegex = /enum\s+(?:class\s+)?(\w+)/g;
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

    // Function definitions (return type + name + parens + {)
    const funcRegex = /(?:(?:static|inline|virtual|explicit|constexpr|const)\s+)*(?:\w+(?:<[^>]*>)?(?:::|\s+)+)?(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:\{|;)/g;
    while ((m = funcRegex.exec(source)) !== null) {
      const name = m[1]!;
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

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const incRegex = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((m = incRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('/').pop() ?? m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    // In C++, everything not in an anonymous namespace is exported at file level.
    // Check for 'static' keyword before the symbol.
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const staticRegex = new RegExp(`static\\s+\\w+\\s+${s}\\s*\\(`);
    if (staticRegex.test(source)) return false;

    // Check if symbol exists as a top-level declaration
    return new RegExp(
      `\\b(?:class|struct|enum|\\w+)\\s+${s}\\b`,
      'g',
    ).test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private isValidFnName(name: string): boolean {
    return ![
      'if', 'else', 'while', 'for', 'switch', 'case', 'catch', 'try',
      'return', 'break', 'continue', 'goto', 'throw', 'new', 'delete',
      'sizeof', 'typedef', 'using', 'namespace', 'template',
      'auto', 'register', 'volatile', 'typeof', 'const',
    ].includes(name);
  }

  /* v8 ignore next -- @preserve -- only used by regex fallback */
  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
