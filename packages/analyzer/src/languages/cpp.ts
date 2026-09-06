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
    } catch {
      /* v8 ignore next -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declarator') {
      const nameNode = this.extractFunctionNameNode(node);
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
      const nameNode = this.extractTypeNameNode(node);
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
      const nameNode = this.extractTypeNameNode(node);
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
      const nameNode = this.extractTypeNameNode(node);
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
    if (
      node.type === 'function_definition' ||
      node.type === 'class_specifier' ||
      node.type === 'struct_specifier' ||
      node.type === 'enum_specifier'
    ) {
      // For functions the name lives inside the (mandatory) function_declarator;
      // for class/struct/enum it is a direct type/qualified/template name child.
      let nameNode: TreeSitterSyntaxNode | null;
      if (node.type === 'function_definition') {
        nameNode = this.extractFunctionNameNode(this.findNamedChild(node, 'function_declarator')!);
      } else {
        nameNode = this.extractTypeNameNode(node);
      }

      if (nameNode && nameNode.text === symbolName) {
        // C++ file-scope declarations have external linkage (exported) unless
        // they carry internal linkage (`static`) or sit in an anonymous namespace.
        if (/^\s*static\b/.test(node.text)) return false;
        if (this.isInAnonymousNamespace(node)) return false;
        return true;
      }
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
    const funcRegex =
      /(?:(?:static|inline|virtual|explicit|constexpr|const)\s+)*(?:\w+(?:<[^>]*>)?(?:::|\s+)+)?(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:\{|;)/g;
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
    // In C++, everything not in an anonymous namespace is exported at file level.
    // Check for 'static' keyword before the symbol.
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const staticRegex = new RegExp(`static\\s+\\w+\\s+${s}\\s*\\(`);
    if (staticRegex.test(source)) return false;

    // Check if symbol exists as a top-level declaration
    return new RegExp(`\\b(?:class|struct|enum|\\w+)\\s+${s}\\b`, 'g').test(source);
  }

  // Helpers
  private findNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /**
   * Resolve the function name node of a `function_declarator`. The name is one
   * of identifier (free function / constructor), field_identifier (in-class
   * member), qualified_identifier (out-of-class `Foo::bar`), destructor_name,
   * or operator_name. Function pointers (`int (*fp)(int)`) nest the name too
   * deep to reach and return null.
   */
  private extractFunctionNameNode(declarator: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    const id = this.findNamedChild(declarator, 'identifier');
    if (id) return id;
    const field = this.findNamedChild(declarator, 'field_identifier');
    if (field) return field;
    const qualified = this.findNamedChild(declarator, 'qualified_identifier');
    if (qualified) return this.trailingName(qualified);
    const dtor = this.findNamedChild(declarator, 'destructor_name');
    if (dtor) return dtor;
    const op = this.findNamedChild(declarator, 'operator_name');
    if (op) return op;
    return null;
  }

  /**
   * Resolve the name node of a class/struct/enum specifier. The grammar emits
   * type_identifier (plain), qualified_identifier (`class ns::Foo`), or
   * template_type (`class Foo<T>` specialization); anonymous specifiers have
   * no name and return null.
   */
  private extractTypeNameNode(specifier: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    const typeId = this.findNamedChild(specifier, 'type_identifier');
    if (typeId) return typeId;
    const qualified = this.findNamedChild(specifier, 'qualified_identifier');
    if (qualified) return this.trailingName(qualified);
    const templateType = this.findNamedChild(specifier, 'template_type');
    if (templateType) return this.findNamedChild(templateType, 'type_identifier');
    return null;
  }

  /**
   * Return the trailing (unqualified) name node of a qualified_identifier. In
   * tree-sitter-cpp the trailing name is always the last named child, possibly
   * nested one level deeper (`a::b::foo`).
   */
  private trailingName(qualified: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    const last = qualified.namedChild(qualified.namedChildCount - 1);
    if (last.type === 'qualified_identifier') return this.trailingName(last);
    return last;
  }

  /** Extract the literal path of a `preproc_include`, or '' for a macro include. */
  private extractIncludePath(node: TreeSitterSyntaxNode): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'string_literal' || child.type === 'system_lib_string') {
        return child.text.replace(/^["'<]|["'>]$/g, '');
      }
    }
    return '';
  }

  /** Whether the node is nested inside an anonymous namespace. */
  private isInAnonymousNamespace(node: TreeSitterSyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'namespace_definition') {
        const hasName =
          this.findNamedChild(parent, 'namespace_identifier') !== null ||
          this.findNamedChild(parent, 'nested_namespace_specifier') !== null;
        if (!hasName) return true;
      }
      parent = parent.parent;
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
      'catch',
      'try',
      'return',
      'break',
      'continue',
      'goto',
      'throw',
      'new',
      'delete',
      'sizeof',
      'typedef',
      'using',
      'namespace',
      'template',
      'auto',
      'register',
      'volatile',
      'typeof',
      'const',
    ].includes(name);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
