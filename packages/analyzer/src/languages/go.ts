// @code-analyzer/analyzer — Go Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const goExtensions = ['.go'];
const goGlobs = ['**/*.go'];

export class GoProvider extends TreeSitterBaseProvider {
  readonly language = 'go';
  readonly displayName = 'Go';
  readonly extensions = goExtensions;
  readonly globs = goGlobs;
  readonly importSemantics = 'wildcard-leaf' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('tree-sitter-go') as TreeSitterLanguage;
    } catch {
      /* v8 ignore start -- @preserve -- grammar is bundled, require never throws */
      return null;
    }
    /* v8 ignore stop */
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'function_declaration') {
      // function_declaration = `func identifier ...` — the name is a mandatory identifier.
      const nameNode = this.findChildType(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          exported: String(this.isExportedName(nameNode.text)),
          filePath: this.filePath,
        },
      });
    } else if (nodeType === 'type_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'type_spec') {
          // type_spec = `type_identifier type` — the name is a mandatory type_identifier.
          const nameNode = this.findChildType(child, 'type_identifier')!;
          const structType = this.findChildType(child, 'struct_type');
          const ifaceType = this.findChildType(child, 'interface_type');

          if (structType) {
            captures.push({
              tag: CAPTURE_TAGS.STRUCT_DEF,
              text: `struct ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else if (ifaceType) {
            captures.push({
              tag: CAPTURE_TAGS.INTERFACE_DEF,
              text: `interface ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          } else {
            captures.push({
              tag: CAPTURE_TAGS.TYPE_DEF,
              text: `type ${nameNode.text}`,
              startLine: child.startPosition.row + 1,
              endLine: child.endPosition.row + 1,
              startByte: nameNode.startIndex,
              endByte: nameNode.endIndex,
              name: nameNode.text,
              properties: { filePath: this.filePath },
            });
          }
        }
      }
    } else if (nodeType === 'method_declaration') {
      // method_declaration = `func receiver name ...` — the name is a mandatory
      // field_identifier and the receiver is the first parameter_list.
      const nameNode = this.findChildType(node, 'field_identifier')!;
      const receiverType = this.extractReceiverType(node);
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: receiverType,
        properties: { receiverType, filePath: this.filePath },
      });
    } else if (nodeType === 'import_declaration') {
      // import_declaration has a single named child: import_spec (single import) or
      // import_spec_list (grouped import).
      const child = node.namedChild(0);
      if (child.type === 'import_spec') {
        this.emitImportCapture(node, child, captures);
      } else {
        for (let j = 0; j < child.namedChildCount; j++) {
          this.emitImportCapture(node, child.namedChild(j), captures);
        }
      }
    } else if (nodeType === 'var_declaration' || nodeType === 'const_declaration') {
      const isConst = nodeType === 'const_declaration';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'var_spec' || child.type === 'const_spec') {
          this.emitVariableCapture(child, isConst, captures);
        }
        if (child.type === 'var_spec_list') {
          // Grouped `var (...)` declarations wrap their specs in a var_spec_list.
          for (let j = 0; j < child.namedChildCount; j++) {
            this.emitVariableCapture(child.namedChild(j), isConst, captures);
          }
        }
      }
    } else if (nodeType === 'package_clause') {
      // package_clause = `package identifier` — the name is a mandatory package_identifier.
      const nameNode = this.findChildType(node, 'package_identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `package ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_spec') {
      const { path, alias } = this.extractImportSpec(node);
      if (path) {
        const names = alias ? [alias] : [this.importLeaf(path)];
        imports.push({
          source: path,
          names,
          type: alias ? 'namespace' : 'named',
          lineNumber: node.startPosition.row + 1,
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, symbolName: string): boolean {
    return this.isExportedName(symbolName);
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const funcRegex = /func\s+(\w+)\s*\(/g;
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
    const methRegex = /func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/g;
    while ((m = methRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: m[3]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[3]!,
        containerName: m[2]!,
        properties: { receiver: m[1]!, receiverType: m[2]!, filePath },
      });
    }
    const structRegex = /type\s+(\w+)\s+struct/g;
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
    const ifaceRegex = /type\s+(\w+)\s+interface/g;
    while ((m = ifaceRegex.exec(source)) !== null) {
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
    const pkgRegex = /^package\s+(\w+)/m;
    m = pkgRegex.exec(source);
    if (m)
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `package ${m[1]!}`,
        startLine: 1,
        endLine: 1,
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
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

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const singleRegex = /import\s+"([^"]+)"/g;
    while ((m = singleRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [this.importLeaf(m[1]!)],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    const namedRegex = /import\s+(\w+)\s+"([^"]+)"/g;
    while ((m = namedRegex.exec(source)) !== null) {
      imports.push({
        source: m[2]!,
        names: [m[1]!],
        type: 'namespace',
        lineNumber: this.ln(source, m.index),
      });
    }
    const multiRegex = /import\s*\(([\s\S]*?)\)/g;
    while ((m = multiRegex.exec(source)) !== null) {
      const lineRegex = /(?:(\w+)\s+)?"([^"]+)"/g;
      let inner: RegExpExecArray | null;
      while ((inner = lineRegex.exec(m[1]!))) {
        imports.push({
          source: inner[2]!,
          names: [inner[1] ?? this.importLeaf(inner[2]!)],
          type: inner[1] ? 'namespace' : 'named',
          lineNumber: this.ln(source, m.index),
        });
      }
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, symbolName: string): boolean {
    return this.isExportedName(symbolName);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Extract the receiver type name, stripping pointer/package/argument wrappers. */
  private extractReceiverType(methodNode: TreeSitterSyntaxNode): string {
    let receiverType = '';
    for (let i = 0; i < methodNode.childCount; i++) {
      const child = methodNode.child(i);
      if (child.type === 'parameter_list') {
        for (let j = 0; j < child.childCount; j++) {
          const p = child.child(j);
          if (p.type === 'parameter_declaration') {
            // The receiver parameter's type is its last named child (the name, if
            // present, precedes the type).
            receiverType = this.extractTypeName(p.namedChild(p.namedChildCount - 1));
            break;
          }
        }
        break;
      }
    }
    return receiverType;
  }

  /**
   * Recursively unwrap transparent type wrappers — pointer_type (`*T`),
   * qualified_type (`pkg.T`), generic_type (`T[args]`) — to the base named type.
   */
  private extractTypeName(node: TreeSitterSyntaxNode): string {
    if (
      node.type === 'pointer_type' ||
      node.type === 'qualified_type' ||
      node.type === 'generic_type'
    ) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'type_identifier') return child.text;
        if (
          child.type === 'pointer_type' ||
          child.type === 'qualified_type' ||
          child.type === 'generic_type'
        ) {
          return this.extractTypeName(child);
        }
      }
    }
    return node.text;
  }

  /** Extract the path and optional alias from an import_spec node. */
  private extractImportSpec(spec: TreeSitterSyntaxNode): {
    path: string;
    alias: string | undefined;
  } {
    let path = '';
    let alias: string | undefined;
    for (let i = 0; i < spec.childCount; i++) {
      const child = spec.child(i);
      if (child.type === 'interpreted_string_literal' || child.type === 'raw_string_literal') {
        path = child.text.slice(1, -1);
      } else if (child.type === 'package_identifier') {
        alias = child.text;
      }
    }
    return { path, alias };
  }

  /** Emit an IMPORT capture for a single import_spec. */
  private emitImportCapture(
    node: TreeSitterSyntaxNode,
    spec: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
  ): void {
    const { path, alias } = this.extractImportSpec(spec);
    // An import path is always present in valid Go; guard against empty paths.
    if (path) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: path,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: path,
        properties: { alias: alias ?? '', filePath: this.filePath },
      });
    }
  }

  /** Emit a VARIABLE_DEF or CONSTANT_DEF capture for a var_spec/const_spec. */
  private emitVariableCapture(
    spec: TreeSitterSyntaxNode,
    isConst: boolean,
    captures: UnifiedCapture[],
  ): void {
    // var_spec/const_spec always carry at least one identifier (the declared name).
    const idNode = this.findChildType(spec, 'identifier')!;
    captures.push({
      tag: isConst ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
      text: idNode.text,
      startLine: spec.startPosition.row + 1,
      endLine: spec.endPosition.row + 1,
      startByte: idNode.startIndex,
      endByte: idNode.endIndex,
      name: idNode.text,
      properties: { filePath: this.filePath },
    });
  }

  /** The leaf (basename) of an import path, e.g. `os/exec` → `exec`. */
  private importLeaf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** Whether a Go identifier is exported (starts with a Unicode uppercase letter). */
  private isExportedName(symbolName: string): boolean {
    if (!symbolName) return false;
    const first = symbolName[0];
    return first === first.toUpperCase() && first !== first.toLowerCase();
  }

  private findChildType(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
