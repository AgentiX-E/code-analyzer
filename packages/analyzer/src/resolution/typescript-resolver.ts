// @code-analyzer/analyzer — TypeScript / JavaScript Type Resolver
// Hybrid LSP approach: extracts type information directly from tree-sitter AST
// without spawning an external language server process.

import Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import type { TypeInfo, TypeMember, TypeVisibility } from './type-registry.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

// Lazy import to avoid crashing when tree-sitter-typescript is not installed
let TSLanguage: unknown;

function loadTSLanguage(): boolean {
  if (TSLanguage) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    TSLanguage = require('tree-sitter-typescript').tsx;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// TypeScriptTypeResolver
// ---------------------------------------------------------------------------

export class TypeScriptTypeResolver {
  private filePath = '';

  /**
   * Extract all type definitions from a TypeScript/TSX source file.
   * Returns a list of TypeInfo objects ready for registration.
   */
  extractTypes(source: string, filePath: string): TypeInfo[] {
    this.filePath = filePath;

    if (!loadTSLanguage()) {
      // Fallback: use regex-based type extraction
      return this.fallbackExtractTypes(source, filePath);
    }

    const parser = new Parser();
    parser.setLanguage(TSLanguage as Parser.Language);
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
      const info = this.extractClassDeclaration(node, source);
      if (info) types.push(info);
    }

    // Interface
    if (nt === 'interface_declaration') {
      const info = this.extractInterfaceDeclaration(node, source);
      if (info) types.push(info);
    }

    // Type Alias
    if (nt === 'type_alias_declaration') {
      const info = this.extractTypeAlias(node, source);
      if (info) types.push(info);
    }

    // Enum
    if (nt === 'enum_declaration') {
      const info = this.extractEnumDeclaration(node, source);
      if (info) types.push(info);
    }

    // Function Declaration (standalone)
    if (nt === 'function_declaration' || nt === 'generator_function_declaration') {
      // Only capture top-level or exported functions
      const parent = node.parent;
      if (
        parent &&
        (parent.type === 'program' ||
          parent.type === 'export_statement' ||
          parent.type === 'module' ||
          parent.type === 'source_file')
      ) {
        const info = this.extractFunctionDeclaration(node, source);
        if (info) types.push(info);
      }
    }

    // Variable Declaration (const with type annotation or arrow function)
    if (nt === 'variable_declaration' || nt === 'lexical_declaration') {
      const info = this.extractVariableDeclaration(node, source);
      if (info) types.push(info);
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

  private extractClassDeclaration(node: SyntaxNode, source: string): TypeInfo | null {
    const name = this.findChildText(node, 'type_identifier') || this.findChildText(node, 'identifier');
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);
    const isAbstract = node.type === 'abstract_class_declaration';
    const decorators = this.extractDecorators(node, source);

    // Heritage: extends + implements
    const heritage = this.findChild(node, 'class_heritage');
    const baseTypes: string[] = [];
    const implementedInterfaces: string[] = [];

    if (heritage) {
      // extends clause
      for (let i = 0; i < heritage.childCount; i++) {
        const child = heritage.child(i);
        if (child.type === 'extends_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const ext = child.child(j);
            if (ext.type === 'type_identifier' || ext.type === 'identifier') {
              baseTypes.push(ext.text);
            }
          }
        }
        if (child.type === 'implements_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const impl = child.child(j);
            if (impl.type === 'type_identifier' || impl.type === 'identifier') {
              implementedInterfaces.push(impl.text);
            }
          }
        }
      }
    }

    // Type parameters
    const typeParams = this.extractTypeParameters(node);

    // Members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'class_body');
    if (body) {
      this.extractClassMembers(body, source, members);
    }

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

  private extractInterfaceDeclaration(node: SyntaxNode, source: string): TypeInfo | null {
    const name = this.findChildText(node, 'type_identifier') || this.findChildText(node, 'identifier');
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);

    // Heritage
    const heritage = this.findChild(node, 'interface_heritage');
    const baseTypes: string[] = [];
    if (heritage) {
      for (let i = 0; i < heritage.childCount; i++) {
        const child = heritage.child(i);
        if (child.type === 'extends_clause') {
          // extends types
          for (let j = 0; j < child.childCount; j++) {
            const ext = child.child(j);
            if (ext.type === 'type_identifier' || ext.type === 'identifier') {
              baseTypes.push(ext.text);
            }
          }
        }
      }
    }

    const typeParams = this.extractTypeParameters(node);

    // Body members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'object_type') || this.findChild(node, 'interface_body');
    if (body) {
      this.extractInterfaceMembers(body, source, members);
    }

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

  private extractTypeAlias(node: SyntaxNode, source: string): TypeInfo | null {
    const name = this.findChildText(node, 'type_identifier') || this.findChildText(node, 'identifier');
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

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

  private extractEnumDeclaration(node: SyntaxNode, source: string): TypeInfo | null {
    const name = this.findChildText(node, 'type_identifier') || this.findChildText(node, 'identifier');
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);

    // Enum members
    const members = new Map<string, TypeMember>();
    const body = this.findChild(node, 'enum_body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const prop = body.child(i);
        if (prop.type === 'property_identifier' || prop.type === 'enum_assignment') {
          const propName = prop.type === 'enum_assignment'
            ? this.findChildText(prop, 'property_identifier')
            : prop.text;
          if (propName && propName !== ',' && propName !== '}') {
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

  private extractFunctionDeclaration(node: SyntaxNode, _source: string): TypeInfo | null {
    const name = this.findChildText(node, 'identifier') || this.findChildText(node, 'name');
    if (!name) return null;

    const containerName = this.findContainerName(node);
    const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

    const isExported = this.isNodeExported(node);
    const isAsync = this.findChild(node, 'async') !== null;

    // Parameters
    const paramTypes: string[] = [];
    const formalParams = this.findChild(node, 'formal_parameters');
    if (formalParams) {
      for (let i = 0; i < formalParams.childCount; i++) {
        const param = formalParams.child(i);
        if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
          const typeNode = this.findChild(param, 'type_annotation');
          paramTypes.push(typeNode ? this.getTypeText(typeNode.lastChild) : 'any');
        }
      }
    }

    // Return type
    let returnType: string | null = null;
    const returnAnnotation = this.findChild(node, 'return_type');
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

  private extractVariableDeclaration(node: SyntaxNode, _source: string): TypeInfo | null {
    // Look for declarations
    const declarations = this.findAllChildren(node, (n) =>
      n.type === 'variable_declarator' || n.type === 'assignment_expression',
    );

    for (const decl of declarations) {
      const name = this.findChildText(decl, 'identifier');
      if (!name) continue;

      // Type annotation
      const typeNode = this.findChild(decl, 'type_annotation');
      let varType = 'any';
      if (typeNode) {
        varType = this.getTypeText(typeNode);
      } else {
        // Try to infer from initializer
        const value = this.findChild(decl, 'string') || this.findChild(decl, 'number') ||
          this.findChild(decl, 'object') || this.findChild(decl, 'array');
        if (value) {
          varType = value.type;
        }
      }

      const isExported = this.isNodeExported(node);
      const isConst = node.type === 'lexical_declaration' &&
        (sourceForNode(node).includes('const ') || node.text.startsWith('const'));

      const containerName = this.findContainerName(node);
      const qualifiedName = containerName ? `${containerName}.${name}` : `file:${this.filePath}:${name}`;

      return {
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
      };
    }

    return null;
  }

  private walkExportStatement(node: SyntaxNode, source: string, types: TypeInfo[]): void {
    // The expression inside the export is the actual declaration
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_declaration' || child.type === 'abstract_class_declaration') {
        const info = this.extractClassDeclaration(child, source);
        if (info) types.push(info);
      } else if (child.type === 'interface_declaration') {
        const info = this.extractInterfaceDeclaration(child, source);
        if (info) types.push(info);
      } else if (child.type === 'type_alias_declaration') {
        const info = this.extractTypeAlias(child, source);
        if (info) types.push(info);
      } else if (child.type === 'enum_declaration') {
        const info = this.extractEnumDeclaration(child, source);
        if (info) types.push(info);
      } else if (child.type === 'function_declaration') {
        const info = this.extractFunctionDeclaration(child, source);
        if (info) types.push(info);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Class Member Extraction
  // -------------------------------------------------------------------------

  private extractClassMembers(body: SyntaxNode, source: string, members: Map<string, TypeMember>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      // Method definition
      if (child.type === 'method_definition' || child.type === 'public_field_definition' ||
          child.type === 'abstract_method_signature') {
        const name = this.findChildText(child, 'property_identifier') ||
          this.findChildText(child, 'identifier');
        if (!name) continue;

        const isStatic = this.hasModifier(child, 'static');
        const isAsync = this.hasModifier(child, 'async');
        const visibility = this.getVisibility(child);
        const isOptional = child.type === 'optional_parameter' || child.text.includes('?:');

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

        // Return type
        let returnType = 'void';
        const returnNode = this.findChild(child, 'return_type');
        if (returnNode) {
          returnType = this.getTypeText(returnNode);
        }

        const memberType = paramTypes.length > 0 || returnType !== 'void'
          ? `(${paramTypes.join(', ')}) => ${returnType}`
          : (child.type === 'public_field_definition' ? 'any' : '() => void');

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

      // Property (class field without value)
      if (child.type === 'property_definition' || child.type === 'field_definition') {
        const name = this.findChildText(child, 'property_identifier') ||
          this.findChildText(child, 'identifier');
        if (!name) continue;

        const isStatic = this.hasModifier(child, 'static');
        const visibility = this.getVisibility(child);

        let propType = 'any';
        const typeNode = this.findChild(child, 'type_annotation');
        if (typeNode) {
          propType = this.getTypeText(typeNode);
        }

        members.set(name, {
          name,
          type: propType,
          visibility,
          isStatic,
          isOptional: false,
          isAsync: false,
          parameterTypes: [],
          returnType: propType,
        });
      }

      // Recurse into nested expressions (e.g., decorator-wrapped methods)
      this.extractClassMembers(child, source, members);
    }
  }

  private extractInterfaceMembers(body: SyntaxNode, _source: string, members: Map<string, TypeMember>): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);

      if (child.type === 'method_signature' || child.type === 'method_definition' ||
          child.type === 'property_signature' || child.type === 'call_signature') {
        const name = this.findChildText(child, 'property_identifier') ||
          this.findChildText(child, 'identifier');
        if (!name) continue;

        const isOptional = child.type === 'optional_parameter' ||
          child.text.includes('?:') || child.text.includes('?():');

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

        let returnType = 'void';
        const returnNode = this.findChild(child, 'return_type');
        if (returnNode) {
          returnType = this.getTypeText(returnNode);
        }

        const memberType = `(${paramTypes.join(', ')}) => ${returnType}`;

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
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
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

  private findAllChildren(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode[] {
    const results: SyntaxNode[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (predicate(child)) results.push(child);
    }
    return results;
  }

  private extractTypeParameters(node: SyntaxNode): string[] {
    const tparams = this.findChild(node, 'type_parameters');
    if (!tparams) return [];

    const params: string[] = [];
    for (let i = 0; i < tparams.childCount; i++) {
      const child = tparams.child(i);
      if (child.type === 'type_parameter' || child.type === 'required_type_parameter') {
        const name = this.findChildText(child, 'type_identifier') || this.findChildText(child, 'identifier');
        if (name) params.push(name);
      }
    }
    return params;
  }

  private extractDecorators(node: SyntaxNode, _source: string): string[] {
    const decorators: string[] = [];
    const parent = node.parent;
    if (parent) {
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
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
        const name = this.findChildText(current, 'type_identifier');
        if (name) {
          const parentContainer = this.findContainerName(current);
          return parentContainer ? `${parentContainer}.${name}` : name;
        }
      }
      if (current.type === 'module' || current.type === 'namespace_declaration') {
        const name = this.findChildText(current, 'identifier') || this.findChildText(current, 'type_identifier');
        if (name) return name;
      }
      current = current.parent;
    }
    return null;
  }

  private isNodeExported(node: SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (parent.type === 'export_statement') return true;

    // Check for `export` keyword before the node
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (child === node) {
        // Check preceding sibling
        if (i > 0 && parent.child(i - 1).type === 'export') return true;
      }
      if (child.type === 'export') {
        // Check if this export wraps our node
        for (let j = 0; j < child.childCount; j++) {
          if (child.child(j) === node) return true;
        }
      }
    }
    return false;
  }

  private hasModifier(node: SyntaxNode, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === modifier) return true;
    }
    for (let i = 0; i < node.parent?.childCount ?? 0; i++) {
      if (node.parent?.child(i).type === modifier) return true;
    }
    return false;
  }

  private getVisibility(node: SyntaxNode): TypeVisibility {
    const parent = node.parent;
    if (!parent) return 'public';

    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (child.type === 'public' || child.type === 'public_keyword') return 'public';
      if (child.type === 'protected' || child.type === 'protected_keyword') return 'protected';
      if (child.type === 'private' || child.type === 'private_keyword') return 'private';
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
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+(?:<[^>]+>)?))?(?:\s+implements\s+(.+?))?\s*\{/g;
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sourceForNode(_node: SyntaxNode): string {
  return ''; // Placeholder — used for inferring const from lexical_declaration's source text
}
