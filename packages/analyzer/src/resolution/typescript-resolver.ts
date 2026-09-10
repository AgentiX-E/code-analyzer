// @code-analyzer/analyzer — TypeScript / JavaScript Type Resolver
// Hybrid LSP approach: extracts type information directly from tree-sitter AST
// without spawning an external language server process.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo, TypeMember, TypeVisibility } from './type-registry.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

// Lazy import to avoid crashing when tree-sitter-typescript is not installed
let TSLanguage: unknown;

/**
 * Lazily load the tree-sitter-typescript tsx grammar. The grammar is a direct dependency
 * of the analyzer, so the require never throws and this always returns
 * a truthy grammar object. A falsy result is only reachable through the
 * injectable grammar loader (test seam).
 */
function loadTSLanguage(): unknown {
  if (TSLanguage) return TSLanguage;
  // tree-sitter-typescript is a direct dependency of the analyzer, so this
  // require never throws in the bundled runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TSLanguage = require('tree-sitter-typescript').tsx;
  return TSLanguage;
}

// ---------------------------------------------------------------------------
// TypeScriptTypeResolver
// ---------------------------------------------------------------------------

export class TypeScriptTypeResolver {
  private filePath = '';
  private readonly loadGrammar: () => unknown;

  /**
   * @param loadGrammar Injectable grammar loader (test seam). Defaults to the
   *   lazy tree-sitter-typescript loader; returning null triggers regex fallback.
   */
  constructor(loadGrammar: () => unknown = loadTSLanguage) {
    this.loadGrammar = loadGrammar;
  }

  /**
   * Extract all type definitions from a TypeScript/TSX source file.
   * Returns a list of TypeInfo objects ready for registration.
   */
  extractTypes(source: string, filePath: string): TypeInfo[] {
    this.filePath = filePath;

    const language = this.loadGrammar();
    if (!language) {
      // Fallback: use regex-based type extraction
      return this.fallbackExtractTypes(source, filePath);
    }

    const parser = new Parser();
    parser.setLanguage(language as Parser.Language);
    const tree = parser.parse(source);
    const types: TypeInfo[] = [];

    this.walkForTypes(tree.rootNode, source, types);

    return types;
  }

  // -------------------------------------------------------------------------
  // AST Walking
  // -------------------------------------------------------------------------

  private walkForTypes(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    const nt = node.type;

    // Class / Abstract Class
    if (nt === 'class_declaration' || nt === 'abstract_class_declaration') {
      types.push(this.extractClassDeclaration(node, source));
    }

    // Interface
    if (nt === 'interface_declaration') {
      types.push(this.extractInterfaceDeclaration(node, source));
    }

    // Type Alias
    if (nt === 'type_alias_declaration') {
      types.push(this.extractTypeAlias(node, source));
    }

    // Enum
    if (nt === 'enum_declaration') {
      types.push(this.extractEnumDeclaration(node, source));
    }

    // Function Declaration (standalone) — only capture top-level functions;
    // exported functions are handled by walkExportStatement below.
    if (nt === 'function_declaration' || nt === 'generator_function_declaration') {
      if (node.parent!.type === 'program') {
        types.push(this.extractFunctionDeclaration(node, source));
      }
    }

    // Variable Declaration (const / let / var)
    if (nt === 'variable_declaration' || nt === 'lexical_declaration') {
      types.push(...this.extractVariableDeclarations(node, source));
    }

    // Named export directly
    if (nt === 'export_statement') {
      this.walkExportStatement(node, source, types);
      return; // Don't double-walk children — export_statement contents are handled
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForTypes(node.child(i), source, types);
    }
  }

  // -------------------------------------------------------------------------
  // Extractors
  // -------------------------------------------------------------------------

  private extractClassDeclaration(node: SyntaxNode, source: string): TypeInfo {
    const name = this.findChildText(node, 'type_identifier')!;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);
    const isAbstract = node.type === 'abstract_class_declaration';
    const decorators = this.extractDecorators(node, source);

    // Heritage: extends + implements
    const heritage = this.findChild(node, 'class_heritage');
    const baseTypes: string[] = [];
    const implementedInterfaces: string[] = [];

    if (heritage) {
      const extendsClause = this.findChild(heritage, 'extends_clause');
      if (extendsClause) {
        baseTypes.push(...this.heritageTypeNames(extendsClause));
      }
      const implementsClause = this.findChild(heritage, 'implements_clause');
      if (implementsClause) {
        implementedInterfaces.push(...this.heritageTypeNames(implementsClause));
      }
    }

    // Type parameters
    const typeParams = this.extractTypeParameters(node);

    // Members
    const members = new Map<string, TypeMember>();
    this.extractClassMembers(this.findChild(node, 'class_body')!, source, members);

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'class',
      members,
      baseTypes,
      implementedInterfaces,
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported,
      isAbstract,
      decorators,
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractInterfaceDeclaration(node: SyntaxNode, source: string): TypeInfo {
    const name = this.findChildText(node, 'type_identifier')!;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);

    // Heritage: interface `extends` is an `extends_type_clause` (no
    // `interface_heritage` wrapper exists in tree-sitter-typescript).
    const baseTypes: string[] = [];
    const extendsClause = this.findChild(node, 'extends_type_clause');
    if (extendsClause) {
      baseTypes.push(...this.heritageTypeNames(extendsClause));
    }

    const typeParams = this.extractTypeParameters(node);

    // Body members
    const members = new Map<string, TypeMember>();
    this.extractInterfaceMembers(this.findChild(node, 'interface_body')!, source, members);

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'interface',
      members,
      baseTypes,
      implementedInterfaces: [],
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported,
      isAbstract: false,
      decorators: [],
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractTypeAlias(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.findChildText(node, 'type_identifier')!;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);
    const typeParams = this.extractTypeParameters(node);

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'type',
      members: new Map(),
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: typeParams,
      returnType: null,
      parameterTypes: [],
      isExported,
      isAbstract: false,
      decorators: [],
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractEnumDeclaration(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.findChildText(node, 'identifier')!;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);

    // Enum members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'enum_body')!;
    for (let i = 0; i < body.childCount; i++) {
      const prop = body.child(i);
      if (prop.type === 'property_identifier' || prop.type === 'enum_assignment') {
        const propName =
          prop.type === 'enum_assignment'
            ? this.findChildText(prop, 'property_identifier')
            : prop.text;
        if (propName) {
          members.set(propName, {
            name: propName,
            type: 'number',
            visibility: 'public',
            isStatic: true,
            isOptional: false,
            isAsync: false,
            parameterTypes: [],
            returnType: 'number',
          });
        }
      }
    }

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'enum',
      members,
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: [],
      returnType: null,
      parameterTypes: [],
      isExported,
      isAbstract: false,
      decorators: [],
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractFunctionDeclaration(node: SyntaxNode, _source: string): TypeInfo {
    const name = this.findChildText(node, 'identifier')!;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName
      ? `${containerName}.${name}`
      : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);
    const isAsync = this.hasModifier(node, 'async');

    // Parameters
    const paramTypes: string[] = [];
    const formalParams = this.findChild(node, 'formal_parameters')!;
    for (let i = 0; i < formalParams.childCount; i++) {
      const param = formalParams.child(i);
      if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const typeNode = this.findChild(param, 'type_annotation');
        paramTypes.push(typeNode ? this.getTypeText(typeNode.lastChild) : 'any');
      }
    }

    // Return type: tree-sitter-typescript annotates the return with a
    // `type_annotation` node (there is no `return_type` node).
    let returnType: string | null = null;
    const returnAnnotation = this.findChild(node, 'type_annotation');
    if (returnAnnotation) {
      returnType = this.getTypeText(returnAnnotation);
    }

    return {
      name,
      qualifiedName,
      filePath: this.filePath,
      kind: 'function',
      members: new Map(),
      baseTypes: [],
      implementedInterfaces: [],
      typeParameters: [],
      returnType,
      parameterTypes: paramTypes,
      isExported,
      isAbstract: false,
      decorators: [],
      isAsync,
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
    };
  }

  private extractVariableDeclarations(node: SyntaxNode, _source: string): TypeInfo[] {
    const types: TypeInfo[] = [];

    for (const decl of node.namedChildren) {
      // The first named child is the binding pattern: a plain identifier for a
      // simple binding, or object_pattern/array_pattern for destructuring (which
      // we skip — those names live inside the pattern, not as a flat declaration).
      const binding = decl.namedChild(0);
      if (binding.type !== 'identifier') continue;
      const name = binding.text;

      // Type annotation
      const typeNode = this.findChild(decl, 'type_annotation');
      let varType = 'any';
      if (typeNode) {
        varType = this.getTypeText(typeNode);
      } else {
        // Try to infer from initializer
        const value =
          this.findChild(decl, 'string') ||
          this.findChild(decl, 'number') ||
          this.findChild(decl, 'object') ||
          this.findChild(decl, 'array');
        if (value) {
          varType = value.type;
        }
      }

      const isExported = this.isNodeExported(node);
      const isConst = node.type === 'lexical_declaration' && node.text.startsWith('const');

      const containerName = this.findContainerName(node);
      const qualifiedName = containerName
        ? `${containerName}.${name}`
        : `file:${this.filePath}:${name}`;

      types.push({
        name,
        qualifiedName,
        filePath: this.filePath,
        kind: 'variable',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: isConst ? varType : null,
        parameterTypes: [],
        isExported,
        isAbstract: false,
        decorators: [],
        location: {
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        },
      });
    }

    return types;
  }

  private walkExportStatement(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    // The expression inside the export is the actual declaration
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_declaration' || child.type === 'abstract_class_declaration') {
        types.push(this.extractClassDeclaration(child, source));
      } else if (child.type === 'interface_declaration') {
        types.push(this.extractInterfaceDeclaration(child, source));
      } else if (child.type === 'type_alias_declaration') {
        types.push(this.extractTypeAlias(child, source));
      } else if (child.type === 'enum_declaration') {
        types.push(this.extractEnumDeclaration(child, source));
      } else if (
        child.type === 'function_declaration' ||
        child.type === 'generator_function_declaration'
      ) {
        types.push(this.extractFunctionDeclaration(child, source));
      } else if (child.type === 'variable_declaration' || child.type === 'lexical_declaration') {
        types.push(...this.extractVariableDeclarations(child, source));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Class Member Extraction
  // -------------------------------------------------------------------------

  private extractClassMembers(
    body: SyntaxNode,
    source: string,
    members: Map<string, TypeMember>,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      // Method definition
      if (
        child.type === 'method_definition' ||
        child.type === 'public_field_definition' ||
        child.type === 'abstract_method_signature'
      ) {
        const name = this.findChildText(child, 'property_identifier');
        if (!name) continue;

        const isStatic = this.hasModifier(child, 'static');
        const isAsync = this.hasModifier(child, 'async');
        const visibility = this.getVisibility(child);
        const isOptional = child.text.includes('?:');

        // Parameter types
        const paramTypes: string[] = [];
        const params = this.findChild(child, 'formal_parameters');
        if (params) {
          for (let j = 0; j < params.childCount; j++) {
            const p = params.child(j);
            if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
              const typeNode = this.findChild(p, 'type_annotation');
              paramTypes.push(typeNode ? this.getTypeText(typeNode) : 'any');
            }
          }
        }

        // Return type (methods) / field type (public_field_definition) — both
        // use a `type_annotation` node in tree-sitter-typescript.
        const isField = child.type === 'public_field_definition';
        const typeNode = this.findChild(child, 'type_annotation');
        const annotatedType = typeNode ? this.getTypeText(typeNode) : null;
        const returnType = isField ? (annotatedType ?? 'any') : (annotatedType ?? 'void');
        const memberType = isField ? returnType : `(${paramTypes.join(', ')}) => ${returnType}`;

        members.set(name, {
          name,
          type: memberType,
          visibility,
          isStatic,
          isOptional,
          isAsync,
          parameterTypes: paramTypes,
          returnType,
        });
      }

      // Recurse into nested expressions (e.g., decorator-wrapped methods)
      this.extractClassMembers(child, source, members);
    }
  }

  private extractInterfaceMembers(
    body: SyntaxNode,
    _source: string,
    members: Map<string, TypeMember>,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      if (
        child.type === 'method_signature' ||
        child.type === 'method_definition' ||
        child.type === 'property_signature' ||
        child.type === 'call_signature'
      ) {
        const name = this.findChildText(child, 'property_identifier');
        if (!name) continue;

        const isOptional = child.text.includes('?:') || child.text.includes('?():');

        // Parameter types
        const paramTypes: string[] = [];
        const params = this.findChild(child, 'formal_parameters');
        if (params) {
          for (let j = 0; j < params.childCount; j++) {
            const p = params.child(j);
            if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
              const typeNode = this.findChild(p, 'type_annotation');
              paramTypes.push(typeNode ? this.getTypeText(typeNode) : 'any');
            }
          }
        }

        // Return type (method_signature) / property type (property_signature) —
        // both use a `type_annotation` node in tree-sitter-typescript.
        const isProperty = child.type === 'property_signature';
        const typeNode = this.findChild(child, 'type_annotation');
        const annotatedType = typeNode ? this.getTypeText(typeNode) : null;
        const returnType = isProperty ? (annotatedType ?? 'any') : (annotatedType ?? 'void');
        const memberType = isProperty ? returnType : `(${paramTypes.join(', ')}) => ${returnType}`;

        members.set(name, {
          name,
          type: memberType,
          visibility: 'public',
          isStatic: false,
          isOptional,
          isAsync: false,
          parameterTypes: paramTypes,
          returnType,
        });
      }

      this.extractInterfaceMembers(child, _source, members);
    }
  }

  // -------------------------------------------------------------------------
  // AST Helpers
  // -------------------------------------------------------------------------

  private findChildText(node: SyntaxNode, type: string): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === type && child.text) return child.text;
    }
    return null;
  }

  private findChild(node: SyntaxNode, type: string): SyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === type) return child;
    }
    return null;
  }

  /**
   * Extract the referenced type names from an `extends_clause`,
   * `implements_clause`, or `extends_type_clause`. Each named child is a type
   * expression (`identifier` / `type_identifier` / `member_expression`); a
   * trailing `type_arguments` child (e.g. `Foo<string>`) is merged back into
   * the preceding name so generic references are not truncated.
   */
  private heritageTypeNames(clause: SyntaxNode): string[] {
    const names: string[] = [];
    for (let i = 0; i < clause.namedChildCount; i++) {
      const child = clause.namedChild(i)!;
      if (child.type === 'type_arguments') continue;
      const next = clause.namedChild(i + 1);
      names.push(next && next.type === 'type_arguments' ? child.text + next.text : child.text);
    }
    return names;
  }

  private extractTypeParameters(node: SyntaxNode): string[] {
    const tparams = this.findChild(node, 'type_parameters');
    if (!tparams) return [];

    const params: string[] = [];
    for (let i = 0; i < tparams.childCount; i++) {
      const child = tparams.child(i);
      if (child.type === 'type_parameter') {
        params.push(this.findChildText(child, 'type_identifier')!);
      }
    }
    return params;
  }

  private extractDecorators(node: SyntaxNode, _source: string): string[] {
    // Decorators are direct children of a non-exported declaration, but for an
    // exported declaration the decorator is a sibling inside the wrapping
    // `export_statement`. Scan both scopes so exported decorators are not lost.
    const decorators: string[] = [];
    for (const scope of [node, node.parent!]) {
      for (let i = 0; i < scope.childCount; i++) {
        const child = scope.child(i);
        if (child.type === 'decorator') {
          decorators.push(child.text);
        }
      }
    }
    return decorators;
  }

  private findContainerName(node: SyntaxNode): string | null {
    let current: SyntaxNode | null = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'abstract_class_declaration') {
        const name = this.findChildText(current, 'type_identifier')!;
        const parentContainer = this.findContainerName(current);
        return parentContainer ? `${parentContainer}.${name}` : name;
      }
      if (current.type === 'module' || current.type === 'internal_module') {
        return this.findChildText(current, 'identifier')!;
      }
      current = current.parent;
    }
    return null;
  }

  private isNodeExported(node: SyntaxNode): boolean {
    // tree-sitter-typescript always wraps `export` declarations in an
    // `export_statement`; there is no bare sibling `export` token to scan for.
    return node.parent!.type === 'export_statement';
  }

  private hasModifier(node: SyntaxNode, modifier: string): boolean {
    // Modifiers (`static`, `async`, `abstract`) are anonymous direct children
    // of the member node itself.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === modifier) return true;
    }
    return false;
  }

  private getVisibility(node: SyntaxNode): TypeVisibility {
    // Accessibility is an `accessibility_modifier` child of the member itself
    // (tree-sitter-typescript); no keyword-token variant exists in this grammar.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'accessibility_modifier') {
        if (child.text === 'private') return 'private';
        if (child.text === 'protected') return 'protected';
        return 'public';
      }
    }
    return 'public';
  }

  private getTypeText(node: SyntaxNode): string {
    // Extract clean type text from a type_annotation, type node, or return_type node
    // Strip ':' and whitespace from the beginning
    let text = node.text.trim();
    if (text.startsWith(':')) {
      text = text.substring(1).trim();
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // Fallback: Regex-based type extraction (when tree-sitter-typescript not available)
  // -------------------------------------------------------------------------

  private fallbackExtractTypes(source: string, filePath: string): TypeInfo[] {
    const types: TypeInfo[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;

    // Class declarations
    const classRegex =
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+(?:<[^>]+>)?))?(?:\s+implements\s+(.+?))?\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = classRegex.exec(source)) !== null) {
      const name = m[1]!;
      const base = m[2] || null;
      const impls = m[3] ? m[3].split(/\s*,\s*/).map((s) => s.replace(/<[^>]+>/, '').trim()) : [];
      types.push({
        name,
        qualifiedName: `file:${filePath}:${name}`,
        filePath,
        kind: 'class',
        members: new Map(),
        baseTypes: base ? [base] : [],
        implementedInterfaces: impls,
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: source.includes('abstract class'),
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Interface declarations
    const ifaceRegex = /(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(.+?))?\s*\{/g;
    while ((m = ifaceRegex.exec(source)) !== null) {
      const name = m[1]!;
      const base = m[2] ? m[2].split(/\s*,\s*/).map((s) => s.replace(/<[^>]+>/, '').trim()) : [];
      types.push({
        name,
        qualifiedName: `file:${filePath}:${name}`,
        filePath,
        kind: 'interface',
        members: new Map(),
        baseTypes: base,
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Type aliases
    const typeRegex = /(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=\s*.+/g;
    while ((m = typeRegex.exec(source)) !== null) {
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'type',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    // Enum declarations
    const enumRegex = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g;
    while ((m = enumRegex.exec(source)) !== null) {
      types.push({
        name: m[1]!,
        qualifiedName: `file:${filePath}:${m[1]}`,
        filePath,
        kind: 'enum',
        members: new Map(),
        baseTypes: [],
        implementedInterfaces: [],
        typeParameters: [],
        returnType: null,
        parameterTypes: [],
        isExported: source.includes('export'),
        isAbstract: false,
        decorators: [],
        location: { startLine: ln(m.index), endLine: ln(m.index + m[0].length) },
      });
    }

    return types;
  }
}
