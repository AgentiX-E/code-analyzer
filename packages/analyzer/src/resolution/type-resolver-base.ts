// @code-analyzer/analyzer — Abstract Type Resolver Base
// Provides the foundation for all language-specific type resolvers.
// Each language resolver extends this base to implement language-specific
// type inference, generic resolution, structural subtyping, and more.

import type { ParsedImport } from '../languages/provider.js';

// ---------------------------------------------------------------------------
// ResolvedType — Portable type descriptor
// ---------------------------------------------------------------------------

/**
 * Platform-independent resolved type descriptor.
 * Used by all language resolvers to describe types in a uniform way.
 */
export interface ResolvedType {
  /** The short name of the type (e.g. "string", "Array", "User") */
  name: string;
  /** The kind of type — determines how it should be interpreted */
  kind: 'primitive' | 'object' | 'union' | 'intersection' | 'generic' | 'function' | 'unknown';
  /** Type arguments for generic types (e.g. Array<string> → [ResolvedType("string")]) */
  genericArgs?: ResolvedType[];
  /** Named members for object/interface/struct types */
  members?: Record<string, ResolvedType>;
  /** Whether the type can be null / undefined */
  isNullable?: boolean;
  /** The file where this type was originally defined */
  sourceFile?: string;
  /** Line number range in the source file */
  location?: { startLine: number; endLine: number };
  /** Documentation / comment associated with the type */
  documentation?: string;
  /** For function types: parameter types */
  parameterTypes?: ResolvedType[];
  /** For function types: return type */
  returnType?: ResolvedType;
}

// ---------------------------------------------------------------------------
// TypeContext — Resolution context
// ---------------------------------------------------------------------------

/**
 * Context passed to resolveType() calls.
 * Provides access to the current file, available imports,
 * and the type registry for cross-file lookups.
 */
export interface TypeContext {
  /** Absolute path of the file containing the type reference */
  filePath: string;
  /** Import statements parsed from this file */
  imports: ParsedImport[];
  /** External type resolver for cross-file lookups.
   *  Accepts a type name and returns a resolved type or null. */
  resolveExternal?: (typeName: string) => ResolvedType | null;
}

// ---------------------------------------------------------------------------
// TypeResolverBase — Abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all language-specific type resolvers.
 *
 * Concrete implementations MUST override:
 *   - resolveType(typeName, context): resolve a type name to its full descriptor
 *   - getAllTypes(): return all types extracted from the current source
 *
 * Concrete implementations MAY override:
 *   - extractImports(source, filePath): e.g. to parse import statements
 */
export abstract class TypeResolverBase {
  /**
   * Resolve a type name within a given context.
   *
   * @param typeName - The type name to resolve (e.g. "Array<string>", "Map<K, V>")
   * @param context - Resolution context (current file, imports, external resolver)
   * @returns A ResolvedType descriptor or null if unresolvable
   */
  abstract resolveType(typeName: string, context: TypeContext): Promise<ResolvedType | null>;

  /**
   * Get all types discovered in the currently loaded source file.
   *
   * @returns A map from type name to ResolvedType descriptor
   */
  abstract getAllTypes(): Map<string, ResolvedType>;

  /**
   * Check if the source text appears to be valid for this resolver's language.
   * Used by the pipeline to auto-detect which resolver to use.
   */
  abstract readonly language: string;

  // -----------------------------------------------------------------------
  // Shared helpers
  // -----------------------------------------------------------------------

  /** Create a simple primitive type descriptor */
  protected primitive(name: string, isNullable: boolean = false): ResolvedType {
    return { name, kind: 'primitive', isNullable };
  }

  /** Create an object type descriptor */
  protected objectType(
    name: string,
    members: Record<string, ResolvedType> = {},
    isNullable: boolean = false,
  ): ResolvedType {
    return { name, kind: 'object', members, isNullable };
  }

  /** Create a generic type descriptor */
  protected genericType(
    name: string,
    genericArgs: ResolvedType[],
    isNullable: boolean = false,
  ): ResolvedType {
    return { name, kind: 'generic', genericArgs, isNullable };
  }

  /** Create a union type descriptor */
  protected unionType(types: ResolvedType[], isNullable: boolean = false): ResolvedType {
    const names = types.map((t) => t.name);
    return {
      name: names.join(' | '),
      kind: 'union',
      genericArgs: types,
      isNullable,
    };
  }

  /** Create an intersection type descriptor */
  protected intersectionType(types: ResolvedType[], isNullable: boolean = false): ResolvedType {
    const names = types.map((t) => t.name);
    return {
      name: names.join(' & '),
      kind: 'intersection',
      genericArgs: types,
      isNullable,
    };
  }

  /** Create a function type descriptor */
  protected functionType(
    name: string,
    parameterTypes: ResolvedType[],
    returnType: ResolvedType,
    isNullable: boolean = false,
  ): ResolvedType {
    return { name, kind: 'function', parameterTypes, returnType, isNullable };
  }

  /** Create an unknown type descriptor */
  protected unknownType(name: string = 'unknown'): ResolvedType {
    return { name, kind: 'unknown' };
  }

  /** Create a nullable wrapper around a type */
  protected nullable(type: ResolvedType): ResolvedType {
    return { ...type, isNullable: true };
  }

  /**
   * Parse a generic type string like "Array<string>" into its base name and type arguments.
   * Returns null if the string is not a valid generic type reference.
   */
  protected parseGenericString(typeStr: string): { base: string; args: string[] } | null {
    const trimmed = typeStr.trim();
    const ltIndex = trimmed.indexOf('<');
    if (ltIndex === -1) return null;

    const base = trimmed.substring(0, ltIndex);
    const argsStr = trimmed.substring(ltIndex + 1, trimmed.lastIndexOf('>'));
    if (!argsStr) return null;

    // Split by commas not nested in angle brackets
    const args = this.splitTopLevelCommas(argsStr);
    return { base, args };
  }

  /**
   * Split a string by commas, respecting nested angle brackets.
   * "string, Array<number>" → ["string", "Array<number>"]
   */
  protected splitTopLevelCommas(input: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  /**
   * Normalize a type name by stripping whitespace and standardizing separators.
   */
  protected normalizeTypeName(typeName: string): string {
    return typeName
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*([&|<>])\s*/g, '$1');
  }

  /**
   * Detect whether a type name represents a primitive in common languages.
   */
  protected isPrimitive(typeName: string): boolean {
    const primitives = new Set([
      'string',
      'number',
      'boolean',
      'void',
      'undefined',
      'null',
      'int',
      'float',
      'double',
      'char',
      'byte',
      'short',
      'long',
      'bool',
      'str',
      'int8',
      'int16',
      'int32',
      'int64',
      'uint8',
      'uint16',
      'uint32',
      'uint64',
      'float32',
      'float64',
      'rune',
      'complex64',
      'complex128',
      'any',
      'never',
      'unknown',
      'bigint',
      'symbol',
    ]);
    return primitives.has(typeName.toLowerCase());
  }
}
