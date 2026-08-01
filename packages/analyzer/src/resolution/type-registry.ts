// @code-analyzer/analyzer — Hybrid Type Registry
// Cross-file type resolution engine. Tracks type definitions, resolves
// qualified member access, and builds import-aware resolution maps.
// Implements a Hybrid LSP approach — structural type resolution without
// external language server processes.

import type { NodeLabel } from '@code-analyzer/shared';
import type { ParsedImport } from '../languages/provider.js';

// ---------------------------------------------------------------------------
// Type Info
// ---------------------------------------------------------------------------

/** Visibility modifier as used in OOP languages */
export type TypeVisibility = 'public' | 'protected' | 'private';

/** A member of a class, interface, or struct (method, property, field) */
export interface TypeMember {
  name: string;
  type: string;
  visibility: TypeVisibility;
  isStatic: boolean;
  isOptional: boolean;
  /** True when this member is an async function / coroutine */
  isAsync: boolean;
  /** Parameter types for methods / callable members */
  parameterTypes: string[];
  /** Return type for methods / callable members */
  returnType: string;
}

/** Complete type information for a single definition site */
export interface TypeInfo {
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: 'class' | 'interface' | 'type' | 'enum' | 'function' | 'variable';
  members: Map<string, TypeMember>;
  baseTypes: string[];
  implementedInterfaces: string[];
  typeParameters: string[];
  returnType: string | null;
  parameterTypes: string[];
  isExported: boolean;
  isAbstract: boolean;
  isAsync?: boolean;
  decorators: string[];
  location: { startLine: number; endLine: number };
}

// ---------------------------------------------------------------------------
// Resolved Types
// ---------------------------------------------------------------------------

/** Result of a type-resolution query */
export interface ResolvedType {
  typeInfo: TypeInfo | null;
  isResolved: boolean;
  resolutionPath: string[]; // file → import → type path for debugging
}

/** Resolved member access (e.g. "Foo.bar") */
export interface ResolvedMember {
  member: TypeMember | null;
  ownerType: TypeInfo | null;
  isResolved: boolean;
}

// ---------------------------------------------------------------------------
// Import Resolution
// ---------------------------------------------------------------------------

/** Persistent record of an import → file mapping for later resolution */
interface ImportRecord {
  sourceFile: string;
  importPath: string;
  importedNames: string[];
  resolvedFile: string | null;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Type Registry
// ---------------------------------------------------------------------------

export class TypeRegistry {
  /** All registered types keyed by qualified name */
  private readonly types: Map<string, TypeInfo> = new Map();

  /** File-level indexes: filePath → set of qualified names defined in that file */
  private readonly fileIndex: Map<string, Set<string>> = new Map();

  /** Import records pending resolution */
  private readonly imports: Map<string, ImportRecord[]> = new Map();

  /** Module name → filePath resolution (populated by scan phase) */
  private readonly moduleIndex: Map<string, string> = new Map();

  /** Resolved import map: sourceFile → (importedName → targetQualifiedName) */
  private readonly importResolutionMap: Map<string, Map<string, string>> = new Map();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register a type definition from a parsed file */
  registerType(info: TypeInfo): void {
    const qname = info.qualifiedName || info.name;

    // Register
    this.types.set(qname, info);

    // File index
    let fileTypes = this.fileIndex.get(info.filePath);
    if (!fileTypes) {
      fileTypes = new Set();
      this.fileIndex.set(info.filePath, fileTypes);
    }
    fileTypes.add(qname);
  }

  /** Build import-aware resolution for a file */
  buildImportMap(filePath: string, imports: ParsedImport[]): void {
    // Store raw imports for later resolution
    const records: ImportRecord[] = imports.map((imp: ParsedImport) => ({
      sourceFile: filePath,
      importPath: imp.source,
      importedNames: imp.names,
      resolvedFile: null as string | null,
      resolved: false,
    }));

    this.imports.set(filePath, records);

    // Resolve imports we can now
    for (const record of records) {
      const resolvedFile = this.resolveModulePath(record.importPath, filePath);
      if (resolvedFile) {
        record.resolvedFile = resolvedFile;
        record.resolved = true;
      }
    }

    // Build resolution map for this file
    this.buildResolutionMap(filePath);
  }

  /** Register module name to file path mapping */
  registerModule(name: string, filePath: string): void {
    this.moduleIndex.set(name, filePath);
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /** Resolve a type name to its full definition (cross-file) */
  resolveType(name: string, contextFile: string): ResolvedType {
    // 1. Look up directly in the type registry
    const direct = this.types.get(name);
    if (direct && direct.filePath === contextFile) {
      return { typeInfo: direct, isResolved: true, resolutionPath: ['direct'] };
    }

    // 2. Check import resolution map for context file
    const fileImports = this.importResolutionMap.get(contextFile);
    if (fileImports) {
      const resolvedQname = fileImports.get(name);
      if (resolvedQname) {
        const resolved = this.types.get(resolvedQname);
        if (resolved) {
          return {
            typeInfo: resolved,
            isResolved: true,
            resolutionPath: ['import', resolvedQname],
          };
        }
      }
    }

    // 3. Look up by short name across all known types
    for (const [qname, info] of this.types) {
      if (info.name === name) {
        return {
          typeInfo: info,
          isResolved: true,
          resolutionPath: ['global', qname],
        };
      }
    }

    return { typeInfo: null, isResolved: false, resolutionPath: [] };
  }

  /** Resolve a qualified member access (e.g., "User.getName") */
  resolveMember(typeName: string, memberName: string, contextFile?: string): ResolvedMember {
    // Resolve the owning type
    const resolved = contextFile
      ? this.resolveType(typeName, contextFile)
      : { typeInfo: this.types.get(typeName) ?? null, isResolved: false, resolutionPath: [] as string[] };

    if (!resolved.typeInfo) {
      return { member: null, ownerType: null, isResolved: false };
    }

    // Look up member in type's member map
    const member = resolved.typeInfo.members.get(memberName);
    if (member) {
      return { member, ownerType: resolved.typeInfo, isResolved: true };
    }

    // If not found, walk base types (inheritance chain)
    for (const baseName of resolved.typeInfo.baseTypes) {
      const baseType = this.types.get(baseName);
      if (baseType) {
        const baseMember = baseType.members.get(memberName);
        if (baseMember) {
          return { member: baseMember, ownerType: baseType, isResolved: true };
        }
      }
    }

    return { member: null, ownerType: resolved.typeInfo, isResolved: false };
  }

  /** Check if source type is assignable to target type (structural subtyping) */
  isAssignableTo(sourceTypeName: string, targetTypeName: string): boolean {
    const source = this.types.get(sourceTypeName);
    const target = this.types.get(targetTypeName);

    if (!source || !target) return false;

    // Same type
    if (source.qualifiedName === target.qualifiedName) return true;

    // Direct inheritance check
    if (source.baseTypes.includes(target.qualifiedName)) return true;
    if (source.baseTypes.includes(target.name)) return true;

    // Interface implementation
    if (source.implementedInterfaces.includes(target.qualifiedName)) return true;
    if (source.implementedInterfaces.includes(target.name)) return true;

    // Walk base chain
    for (const base of source.baseTypes) {
      if (this.isAssignableTo(base, targetTypeName)) return true;
    }

    // Structural subtyping: source has all members of target
    if (target.kind === 'interface') {
      for (const [name, targetMember] of target.members) {
        const sourceMember = source.members.get(name);
        if (!sourceMember) return false;

        // Check visibility compatibility (public is always accessible)
        if (targetMember.visibility === 'public' && sourceMember.visibility !== 'public') {
          return false;
        }

        // Check member type compatibility (strict for interface conformance)
        if (targetMember.type !== 'any' && sourceMember.type !== targetMember.type) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  /** Get all types defined in a file */
  getTypesInFile(filePath: string): TypeInfo[] {
    const qnames = this.fileIndex.get(filePath);
    if (!qnames) return [];
    return Array.from(qnames)
      .map((qn) => this.types.get(qn))
      .filter((t): t is TypeInfo => t !== undefined);
  }

  /** Get all types of a specific kind */
  getTypesByKind(kind: TypeInfo['kind']): TypeInfo[] {
    const result: TypeInfo[] = [];
    for (const [, info] of this.types) {
      if (info.kind === kind) result.push(info);
    }
    return result;
  }

  /** Total number of registered types */
  get typeCount(): number {
    return this.types.size;
  }

  /** All registered types */
  getAllTypes(): TypeInfo[] {
    return Array.from(this.types.values());
  }

  /** Check if a type is registered */
  hasType(qualifiedName: string): boolean {
    return this.types.has(qualifiedName);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Clear all registered types and indexes (for re-indexing) */
  clear(): void {
    this.types.clear();
    this.fileIndex.clear();
    this.imports.clear();
    this.moduleIndex.clear();
    this.importResolutionMap.clear();
  }

  /** Export the registry state for debugging / serialization */
  export(): {
    types: Array<Omit<TypeInfo, 'members'> & { members: Array<[string, TypeMember]> }>;
    importMaps: Array<[string, Array<[string, string]>]>;
  } {
    return {
      types: Array.from(this.types.values()).map((t) => ({
        ...t,
        members: Array.from(t.members.entries()),
      })),
      importMaps: Array.from(this.importResolutionMap.entries()).map(
        ([file, map]) => [file, Array.from(map.entries())],
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Resolve a module path to a file path.
   * Handles: relative imports ('./foo'), bare specifiers ('lodash'),
   * and indexed modules ('./utils/index' → './utils/index.ts').
   */
  private resolveModulePath(importPath: string, contextFile: string): string | null {
    // Bare specifier → check module index
    if (!importPath.startsWith('.')) {
      // Try exact match in module index
      const direct = this.moduleIndex.get(importPath);
      if (direct) return direct;

      // Try with file extensions
      const exts = ['.ts', '.tsx', '.js', '.jsx', '.py'];
      for (const ext of exts) {
        const withExt = this.moduleIndex.get(`${importPath}${ext}`);
        if (withExt) return withExt;
      }

      return null;
    }

    // Relative import — resolve against context file directory
    const contextDir = contextFile.substring(0, contextFile.lastIndexOf('/'));
    const resolved = `${contextDir}/${importPath}`;

    // Check file index for exact path
    if (this.fileIndex.has(resolved)) return resolved;

    // Try with extensions
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '/index.ts', '/index.js'];
    for (const ext of exts) {
      const withExt = `${resolved}${ext}`;
      if (this.fileIndex.has(withExt)) return withExt;
    }

    // Try as directory with index
    for (const ext of ['.ts', '.js', '.py']) {
      const indexFile = `${resolved}/index${ext}`;
      if (this.fileIndex.has(indexFile)) return indexFile;
    }

    return null;
  }

  /** Build the per-file import → qualified-name resolution map */
  private buildResolutionMap(filePath: string): void {
    const records = this.imports.get(filePath);
    if (!records) return;

    const map = new Map<string, string>();

    for (const record of records) {
      if (!record.resolvedFile) continue;

      // Get all types defined in the resolved file
      const targetTypes = this.fileIndex.get(record.resolvedFile);
      if (!targetTypes) continue;

      for (const importedName of record.importedNames) {
        // Try to find the imported name in the target file's types
        for (const qname of targetTypes) {
          const type = this.types.get(qname);
          if (type && (type.name === importedName || type.qualifiedName === importedName)) {
            map.set(importedName, type.qualifiedName);
            break;
          }
        }
      }
    }

    this.importResolutionMap.set(filePath, map);
  }
}
