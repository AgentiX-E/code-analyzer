// @code-analyzer/intelligence — TypeScript LSP Resolver
// Per-language type resolver for TypeScript/JavaScript/TSX/JSX.
// Implements expression type evaluation, generic inference, Promise
// unwrapping, JSX component resolution, and JSDoc type inference.
//
// Architecture:
//   Context (TSResolverContext):
//     - TypeRegistry (overlay + base fallback)
//     - Import map (localName → moduleQN)
//     - Lexical scope stack (variable → type bindings)
//     - Generic parameter stack (type param → concrete type)
//   Expression evaluator:
//     - Literals → literal types
//     - Variables → resolve from scope + imports
//     - Call expressions → resolve callee, infer generics, evaluate return
//     - Member access → resolve receiver, look up property/method
//     - Property access expressions → evaluate on receiver type

import type { TypeRep } from '../lsp/type-rep.js';
import { t, BUILTINS, typeToString } from '../lsp/type-rep.js';
import type { TypeRegistry, RegisteredType, RegisteredFunction } from '../lsp/type-registry.js';

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** A variable binding in a lexical scope. */
interface VarBinding {
  name: string;
  type: TypeRep;
  isConst: boolean;
  isExported: boolean;
}

/** Lexical scope (stack of variable bindings). */
class Scope {
  private bindings = new Map<string, VarBinding>();
  private parent: Scope | null;

  constructor(parent?: Scope) {
    this.parent = parent ?? null;
  }

  declare(name: string, type: TypeRep, isConst = false, isExported = false): void {
    this.bindings.set(name, { name, type, isConst, isExported });
  }

  lookup(name: string): VarBinding | null {
    const b = this.bindings.get(name);
    if (b) return b;
    return this.parent?.lookup(name) ?? null;
  }

  /** Push a new child scope (e.g., for function body, block). */
  push(): Scope {
    return new Scope(this);
  }
}

// ---------------------------------------------------------------------------
// Solver Context
// ---------------------------------------------------------------------------

/** Context for the TypeScript LSP resolver. */
export class TSResolverContext {
  /** Type registry (overlay + fallback to project base). */
  readonly registry: TypeRegistry;
  /** Import map: localName → moduleQN. */
  readonly importMap: Map<string, string>;
  /** Current lexical scope. */
  private scope: Scope;
  /** Generic parameter → concrete type mapping. */
  private genericBindings = new Map<string, TypeRep>();
  /** JS mode flag (for .js/.jsx files — enables JSDoc inference). */
  readonly jsMode: boolean;
  /** Source file path. */
  readonly sourceFile: string;

  constructor(
    registry: TypeRegistry,
    importMap: Map<string, string>,
    jsMode = false,
    sourceFile = '',
  ) {
    this.registry = registry;
    this.importMap = importMap;
    this.scope = new Scope();
    this.jsMode = jsMode;
    this.sourceFile = sourceFile;
  }

  // ---------------------------------------------------------------------------
  // Scope management
  // ---------------------------------------------------------------------------

  /** Enter a new lexical scope (e.g., function body, block statement). */
  enterScope(): void {
    this.scope = this.scope.push();
  }

  /** Exit the current lexical scope. */
  exitScope(): void {
    if (this.scope['parent']) {
      this.scope = this.scope['parent']!;
    }
  }

  /** Declare a variable in the current scope. */
  declare(name: string, type: TypeRep, isConst = false, isExported = false): void {
    this.scope.declare(name, type, isConst, isExported);
  }

  // ---------------------------------------------------------------------------
  // Generic inference
  // ---------------------------------------------------------------------------

  /** Bind a generic type parameter to a concrete type. */
  bindGeneric(paramName: string, type: TypeRep): void {
    this.genericBindings.set(paramName, type);
  }

  /** Substitute generics in a type. */
  substituteGenerics(type: TypeRep): TypeRep {
    if (type.kind === 'named') return type;
    if (
      type.kind === 'void' ||
      type.kind === 'any' ||
      type.kind === 'unknown' ||
      type.kind === 'never'
    )
      return type;
    if (type.kind === 'literal') return type;

    if (type.kind === 'typeParam') {
      const bound = this.genericBindings.get(type.name);
      return bound ?? type.constraint ?? BUILTINS.unknown;
    }

    if (type.kind === 'template') {
      return t.template(
        this.substituteGenerics(type.base),
        ...type.typeArgs.map((a) => this.substituteGenerics(a)),
      );
    }

    if (type.kind === 'union') {
      return t.union(...type.members.map((m) => this.substituteGenerics(m)));
    }

    if (type.kind === 'func') {
      return t.func(
        type.params.map((p) => ({
          ...p,
          type: this.substituteGenerics(p.type),
        })),
        this.substituteGenerics(type.returnType),
        { isAsync: type.isAsync, typeParams: [...type.typeParams] },
      );
    }

    if (type.kind === 'array') {
      return t.array(this.substituteGenerics(type.elementType));
    }

    if (type.kind === 'promise') {
      return t.promise(this.substituteGenerics(type.valueType));
    }

    if (type.kind === 'intersection') {
      return t.intersection(...type.members.map((m) => this.substituteGenerics(m)));
    }

    return type;
  }

  /** Reset generic bindings (called between function evaluations). */
  resetGenerics(): void {
    this.genericBindings.clear();
  }

  // ---------------------------------------------------------------------------
  // Expression type evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate the type of a literal expression.
   */
  evalLiteral(value: string | number | boolean | null | undefined): TypeRep {
    if (value === null) return BUILTINS.null;
    if (value === undefined) return BUILTINS.undefined;
    if (typeof value === 'string') return BUILTINS.string;
    if (typeof value === 'number') return BUILTINS.number;
    // The only remaining member of the parameter union is `boolean`, so this
    // return is exhaustive — no other runtime value can reach it.
    return BUILTINS.boolean;
  }

  /**
   * Evaluate the type of a variable reference.
   * Resolves through scope chain first, then import map, then registry.
   */
  evalVariable(name: string): TypeRep {
    // 1. Lexical scope
    const binding = this.scope.lookup(name);
    if (binding) return binding.type;

    // 2. Import map (imported from another module)
    const moduleQn = this.importMap.get(name);
    if (moduleQn) {
      const importedQn = `${moduleQn}.${name}`;
      const regType = this.registry.lookupType(importedQn);
      if (regType) return regType.type;

      const regFunc = this.registry.lookupFunction(importedQn);
      if (regFunc) return BUILTINS.function;
    }

    // 3. Registry (same module or global)
    const regType = this.registry.lookupType(name);
    if (regType) return regType.type;

    const regFunc = this.registry.lookupFunction(name);
    if (regFunc) return BUILTINS.function;

    // 4. Fallback: any (we couldn't resolve)
    return BUILTINS.any;
  }

  /**
   * Evaluate the type of a function/method call.
   *
   * Steps:
   *   1. Resolve callee to a RegisteredFunction in the registry
   *   2. If generic, infer type params from argument types
   *   3. Substitute generics in the return type
   *   4. Unwrap Promise if async
   *   5. Return the resolved return type
   */
  evalCall(calleeName: string, argTypes: TypeRep[], receiverType?: TypeRep): TypeRep {
    // Try method dispatch first (receiver.methodName)
    if (receiverType && receiverType.kind === 'named') {
      const receiverShort = extractLastName(receiverType.name);
      const methods = this.registry.lookupMethod(receiverShort, calleeName);
      if (methods.length > 0) {
        const func = methods[0]!;
        return this.evalRegisteredFunction(func, argTypes);
      }
    }

    // Try import-resolved callee
    const funcs = this.registry.lookupFunctionByName(calleeName);
    if (funcs.length > 0) {
      const func = funcs[0]!;
      return this.evalRegisteredFunction(func, argTypes);
    }

    // Fallback: unknown
    return BUILTINS.unknown;
  }

  /**
   * Evaluate the return type of a registered function, inferring generics.
   */
  private evalRegisteredFunction(func: RegisteredFunction, argTypes: TypeRep[]): TypeRep {
    this.resetGenerics();

    // Build generic parameter bindings from argument types
    // For now: simple positional matching
    const paramTypes = func.paramTypes ? func.paramTypes.split('|') : [];

    for (let i = 0; i < Math.min(argTypes.length, paramTypes.length); i++) {
      const paramName = paramTypes[i]!;
      const argType = argTypes[i]!;

      // If the parameter is a type parameter name, bind it
      if (paramName.length === 1 && paramName === paramName.toUpperCase()) {
        this.bindGeneric(paramName, argType);
      }
    }

    // Resolve return type with generic substitution
    const returnTypeName = func.returnTypes;
    const returnType = this.resolveTypeName(returnTypeName);

    // Unwrap Promise for async functions
    if (func.isAsync) {
      return t.promise(this.substituteGenerics(returnType));
    }

    return this.substituteGenerics(returnType);
  }

  /**
   * Evaluate the type of a member access (e.g., `obj.prop`).
   */
  evalMemberAccess(receiverType: TypeRep, memberName: string): TypeRep {
    // Named type: look up in registry
    if (receiverType.kind === 'named') {
      const regType = this.registry.lookupType(receiverType.name);
      if (regType?.fieldDefs) {
        // Parse field definitions (pipe-separated "name:type")
        const fields = regType.fieldDefs.split('|');
        for (const field of fields) {
          const [fName, fType] = field.split(':');
          if (fName?.trim() === memberName) {
            return this.resolveTypeName(fType?.trim() ?? 'any');
          }
        }
      }

      // Check for methods on this type
      const methods = this.registry.lookupMethod(extractLastName(receiverType.name), memberName);
      if (methods.length > 0) {
        // Return the function type
        return BUILTINS.function;
      }
    }

    // Object literal: look up property
    if (receiverType.kind === 'objectLiteral') {
      const prop = receiverType.properties.find((p) => p.name === memberName);
      if (prop) return prop.type;
    }

    // Promise: unwrap and look up on value type
    if (receiverType.kind === 'promise') {
      return this.evalMemberAccess(receiverType.valueType, memberName);
    }

    return BUILTINS.unknown;
  }

  /**
   * Evaluate JSX component type (for React/Vue JSX).
   */
  evalJSXComponent(
    componentName: string,
    _props: Array<{ name: string; value: TypeRep }>,
  ): TypeRep {
    // Resolve component type from registry
    const regType = this.registry.lookupType(componentName);
    if (regType) return regType.type;

    // Try import map
    const moduleQn = this.importMap.get(componentName);
    if (moduleQn) {
      const importedQn = `${moduleQn}.${componentName}`;
      const importedType = this.registry.lookupType(importedQn);
      if (importedType) return importedType.type;
    }

    return t.named('JSX.Element');
  }

  /**
   * Evaluate JSDoc `@param` and `@returns` type annotations.
   * Parses TypeScript-like type syntax from JSDoc comments.
   * Only used in jsMode=true (JavaScript files).
   */
  evalJSDocType(typeAnnotation: string): TypeRep {
    if (!this.jsMode) return BUILTINS.unknown;
    return this.parseTypeAnnotation(typeAnnotation);
  }

  // ---------------------------------------------------------------------------
  // Type resolution helpers
  // ---------------------------------------------------------------------------

  /** Resolve a type name string to a TypeRep. */
  resolveTypeName(name: string): TypeRep {
    if (!name || name === 'unknown') return BUILTINS.unknown;
    if (name === 'void') return BUILTINS.void;
    if (name === 'any') return BUILTINS.any;
    if (name === 'never') return BUILTINS.never;
    if (name === 'string') return BUILTINS.string;
    if (name === 'number') return BUILTINS.number;
    if (name === 'boolean') return BUILTINS.boolean;
    if (name === 'object') return BUILTINS.object;
    if (name === 'undefined') return BUILTINS.undefined;
    if (name === 'null') return BUILTINS.null;

    // Type parameter (single uppercase letter)
    if (name.length === 1 && name === name.toUpperCase()) {
      return t.typeParam(name);
    }

    // Check for generic: Array<T>, Promise<T>, Map<K,V>
    const genericMatch = name.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const baseName = genericMatch[1]!;
      const argsStr = genericMatch[2]!;
      const args = this.splitGenericArgs(argsStr);
      return t.template(
        this.resolveTypeName(baseName),
        ...args.map((a) => this.resolveTypeName(a.trim())),
      );
    }

    // Look up in registry
    const regType = this.registry.lookupType(name);
    if (regType) return regType.type;

    return t.named(name);
  }

  /** Parse a TypeScript type annotation string into TypeRep. */
  parseTypeAnnotation(annotation: string): TypeRep {
    const trimmed = annotation.trim();

    // Union types: A | B
    if (trimmed.includes(' | ')) {
      const members = trimmed.split(' | ').map((m) => this.parseTypeAnnotation(m.trim()));
      return t.union(...members);
    }

    // Intersection types: A & B
    if (trimmed.includes(' & ')) {
      const members = trimmed.split(' & ').map((m) => this.parseTypeAnnotation(m.trim()));
      return t.intersection(...members);
    }

    // Array types: T[]
    if (trimmed.endsWith('[]')) {
      return t.array(this.parseTypeAnnotation(trimmed.slice(0, -2)));
    }

    // Array generic: Array<T>
    const arrayMatch = trimmed.match(/^Array<(.+)>$/);
    if (arrayMatch) {
      return t.array(this.parseTypeAnnotation(arrayMatch[1]!));
    }

    // Promise: Promise<T>
    const promiseMatch = trimmed.match(/^Promise<(.+)>$/);
    if (promiseMatch) {
      return t.promise(this.parseTypeAnnotation(promiseMatch[1]!));
    }

    // Function type: (params) => returnType
    const funcMatch = trimmed.match(/^\(([^)]*)\)\s*=>\s*(.+)$/);
    if (funcMatch) {
      const paramsStr = funcMatch[1]!;
      const params = paramsStr
        ? paramsStr.split(',').map((p, i) => {
            const trimmedParam = p.trim();
            // Split on the FIRST colon only: the parameter type may itself
            // contain colons (e.g. `x: { a: number }`), which a naive
            // `split(':')` would truncate.
            const colonIdx = trimmedParam.indexOf(':');
            const pName = colonIdx === -1 ? trimmedParam : trimmedParam.slice(0, colonIdx).trim();
            const pType =
              colonIdx === -1
                ? BUILTINS.any
                : this.parseTypeAnnotation(trimmedParam.slice(colonIdx + 1).trim());
            // Unnamed parameters (e.g. `(: number) => void`) get a positional
            // fallback name rather than an empty string.
            return t.param(pName || `arg${i}`, pType);
          })
        : [];
      return t.func(params, this.parseTypeAnnotation(funcMatch[2]!.trim()));
    }

    // Object literal: { key: Type; ... }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return t.objectLiteral([]);
      const props = inner.split(';').map((p) => {
        const colonIdx = p.indexOf(':');
        if (colonIdx === -1) return t.prop(p.trim(), BUILTINS.any);
        const pName = p.slice(0, colonIdx).trim();
        const pType = this.parseTypeAnnotation(p.slice(colonIdx + 1).trim());
        return t.prop(pName, pType);
      });
      return t.objectLiteral(props);
    }

    return this.resolveTypeName(trimmed);
  }

  /** Split generic type arguments (respects nested angle brackets). */
  private splitGenericArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of argsStr) {
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }
}

// ---------------------------------------------------------------------------
// Resolver API
// ---------------------------------------------------------------------------

/** Resolve an import declaration to a module QN. */
export function resolveImport(
  importPath: string,
  currentModule: string,
  _isDefault: boolean,
): string {
  // Relative import: ./foo → currentModule.foo
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const parts = currentModule.split('.');
    const relParts = importPath.split('/');
    for (const part of relParts) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    return parts.join('.');
  }

  // Absolute import: convert path separators to dots
  return importPath.replace(/\//g, '.');
}

/** Determine if a type is a builtin (string, number, boolean, etc.). */
export function isBuiltinType(name: string): boolean {
  return [
    'string',
    'number',
    'boolean',
    'void',
    'any',
    'unknown',
    'never',
    'object',
    'undefined',
    'null',
    'symbol',
    'bigint',
  ].includes(name);
}

/** Extract the last component of a dot-separated QN. */
function extractLastName(qn: string): string {
  const idx = qn.lastIndexOf('.');
  return idx === -1 ? qn : qn.slice(idx + 1);
}
