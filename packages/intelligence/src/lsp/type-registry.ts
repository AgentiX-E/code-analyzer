// @code-analyzer/intelligence — Cross-File Type Registry
// Flat hash-table registry for O(1) type and function lookup across project files.
// Implements CBM's Tier-2 overlay pattern: per-file overlays chain to a shared
// project-wide base registry via the `fallback` pointer.
//
// Architecture:
//   Shared base registry (built once per project, read-only)
//     → Per-file overlay (chains lookups to base on miss)
//       → Processing context (import map + overlay registry)
//
// The import map connects local names to module-qualified names:
//   import { Foo } from './bar' → { localName: "Foo", moduleQN: "proj.bar" }
// Resolving: Foo → proj.bar.Foo → lookup in base registry

import type { TypeRep, LspLanguage } from './type-rep.js';
import { typeToString } from './type-rep.js';

// ---------------------------------------------------------------------------
// Registered Type
// ---------------------------------------------------------------------------

/** A type registered in the cross-file registry. */
export interface RegisteredType {
  /** Fully qualified name (e.g., "proj.src.models.User"). */
  readonly qn: string;
  /** Short name (e.g., "User"). */
  readonly shortName: string;
  /** Label: "Class", "Interface", "TypeAlias", "Enum", etc. */
  readonly label: string;
  /** Module where this type is defined (for module-scoped resolution). */
  readonly moduleQn: string;
  /** Resolved type representation. */
  readonly type: TypeRep;
  /** Language of the source file. */
  readonly language: LspLanguage;
  /** For interfaces/classes: pipe-separated method names on this type. */
  readonly methodNames?: string;
  /** For interfaces/classes: pipe-separated "name:type" field pairs. */
  readonly fieldDefs?: string;
  /** For generics: pipe-separated embedded type names. */
  readonly embeddedTypes?: string;
  /** Source file path. */
  readonly sourceFile: string;
  /** Source line number (1-based). */
  readonly sourceLine: number;
}

/** A function/method registered in the registry. */
export interface RegisteredFunction {
  /** Fully qualified name (e.g., "proj.src.services.login"). */
  readonly qn: string;
  /** Short name (e.g., "login"). */
  readonly shortName: string;
  /** Label: "Function" or "Method". */
  readonly label: string;
  /** For methods: receiver type QN ("MyClass" → matches RegisteredType.qn suffix). */
  readonly receiverType?: string;
  /** Module where this function is defined. */
  readonly moduleQn: string;
  /** Pipe-separated return type QNs. */
  readonly returnTypes: string;
  /** Number of signature parameters. */
  readonly paramCount: number;
  /** Pipe-separated parameter type names. */
  readonly paramTypes: string;
  /** Whether this is an async function. */
  readonly isAsync: boolean;
  /** Language of the source file. */
  readonly language: LspLanguage;
  /** Source file path. */
  readonly sourceFile: string;
  /** Source line number. */
  readonly sourceLine: number;
}

// ---------------------------------------------------------------------------
// FNV-1a Hash
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash (matching CBM's hash function). */
function fnv1a(str: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (Math.imul(hash, 16777619) >>> 0);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Type Registry
// ---------------------------------------------------------------------------

/**
 * Cross-file type and function registry.
 * Supports Tier-2 overlay pattern: overlays chain to a read-only base.
 */
export class TypeRegistry {
  /** Map<shortName, TypeIndex[]> — for exact O(1) lookup by short name. */
  private typeNameIndex = new Map<string, number[]>();

  /** Map<qn, TypeIndex> — for full QN lookup. */
  private typeQnIndex = new Map<string, number>();

  /** Flat array of all registered types. */
  private types: RegisteredType[] = [];

  /** Map<shortName, FuncIndex[]> — for exact lookup by short name. */
  private funcNameIndex = new Map<string, number[]>();

  /** Map<qn, FuncIndex> — for full QN lookup. */
  private funcQnIndex = new Map<string, number>();

  /** Flat array of all registered functions. */
  private funcs: RegisteredFunction[] = [];

  /** Method index: fnv1a(receiver_shortName.methodName) → FuncIndex[]. */
  private methodIndex = new Map<number, number[]>();

  /** Whether the registry has been finalized (sealed for parallel workers). */
  private _finalized = false;

  /** Fallback base registry for Tier-2 overlay chaining. */
  readonly fallback: TypeRegistry | null;

  constructor(fallback?: TypeRegistry) {
    this.fallback = fallback ?? null;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Register a type. Fails if finalized (read-only). */
  registerType(type: RegisteredType): void {
    if (this._finalized) {
      throw new Error(`TypeRegistry is finalized (read-only). Cannot register "${type.qn}".`);
    }

    const idx = this.types.length;
    this.types.push(type);

    // Short name index
    let bucket = this.typeNameIndex.get(type.shortName);
    if (!bucket) { bucket = []; this.typeNameIndex.set(type.shortName, bucket); }
    bucket.push(idx);

    // Full QN index
    this.typeQnIndex.set(type.qn, idx);
  }

  /** Register a function. */
  registerFunction(func: RegisteredFunction): void {
    if (this._finalized) {
      throw new Error(`TypeRegistry is finalized (read-only). Cannot register "${func.qn}".`);
    }

    const idx = this.funcs.length;
    this.funcs.push(func);

    // Short name index
    let bucket = this.funcNameIndex.get(func.shortName);
    if (!bucket) { bucket = []; this.funcNameIndex.set(func.shortName, bucket); }
    bucket.push(idx);

    // Full QN index
    this.funcQnIndex.set(func.qn, idx);

    // Method index: fnv1a(receiverShortName.methodName)
    if (func.receiverType) {
      const receiverShort = extractLastName(func.receiverType);
      const methodKey = fnv1a(`${receiverShort}.${func.shortName}`);
      let mBucket = this.methodIndex.get(methodKey);
      if (!mBucket) { mBucket = []; this.methodIndex.set(methodKey, mBucket); }
      mBucket.push(idx);
    }
  }

  /** Bulk register types and functions. */
  registerAll(types: readonly RegisteredType[], funcs: readonly RegisteredFunction[]): void {
    for (const t of types) this.registerType(t);
    for (const f of funcs) this.registerFunction(f);
  }

  /** Seal the registry (make read-only). Called once after all project defs are loaded. */
  finalize(): void {
    this._finalized = true;
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /** Look up a type by fully qualified name, checking fallback if needed. */
  lookupType(qn: string): RegisteredType | null {
    const idx = this.typeQnIndex.get(qn);
    if (idx !== undefined) return this.types[idx]!;
    if (this.fallback) return this.fallback.lookupType(qn);
    return null;
  }

  /** Look up types by short name (may return multiple — e.g., from different modules). */
  lookupTypeByName(shortName: string): RegisteredType[] {
    const result: RegisteredType[] = [];
    const indices = this.typeNameIndex.get(shortName);
    if (indices) {
      for (const idx of indices) result.push(this.types[idx]!);
    }
    if (this.fallback) {
      result.push(...this.fallback.lookupTypeByName(shortName));
    }
    return result;
  }

  /** Look up a function by fully qualified name. */
  lookupFunction(qn: string): RegisteredFunction | null {
    const idx = this.funcQnIndex.get(qn);
    if (idx !== undefined) return this.funcs[idx]!;
    if (this.fallback) return this.fallback.lookupFunction(qn);
    return null;
  }

  /** Look up functions by short name. */
  lookupFunctionByName(shortName: string): RegisteredFunction[] {
    const result: RegisteredFunction[] = [];
    const indices = this.funcNameIndex.get(shortName);
    if (indices) {
      for (const idx of indices) result.push(this.funcs[idx]!);
    }
    if (this.fallback) {
      result.push(...this.fallback.lookupFunctionByName(shortName));
    }
    return result;
  }

  /**
   * Look up methods on a receiver type by method name.
   * Uses FNV-1a hash of "receiverShortName.methodName" for O(1) lookup.
   */
  lookupMethod(receiverShortName: string, methodName: string): RegisteredFunction[] {
    const result: RegisteredFunction[] = [];
    const key = fnv1a(`${receiverShortName}.${methodName}`);
    const indices = this.methodIndex.get(key);
    if (indices) {
      for (const idx of indices) {
        const func = this.funcs[idx]!;
        // Verify: method's receiver short name matches
        if (func.receiverType && extractLastName(func.receiverType) === receiverShortName) {
          result.push(func);
        }
      }
    }
    if (this.fallback) {
      result.push(...this.fallback.lookupMethod(receiverShortName, methodName));
    }
    return result;
  }

  /** Look up a type by QN, resolving through the import map if needed. */
  resolveTypeWithImports(
    localName: string,
    imports: ReadonlyMap<string, string>,
  ): RegisteredType | null {
    // Direct match: localName is already QN
    const direct = this.lookupType(localName);
    if (direct) return direct;

    // Resolve through imports
    const moduleQn = imports.get(localName);
    if (moduleQn) {
      const importedQn = `${moduleQn}.${localName}`;
      return this.lookupType(importedQn);
    }

    // Namespace import: `import * as Lib from './mod'` → `Lib.symbolName`
    for (const [importLocal, importModule] of imports) {
      if (localName.startsWith(importLocal + '.')) {
        const suffix = localName.slice(importLocal.length + 1);
        const qn = `${importModule}.${suffix}`;
        return this.lookupType(qn);
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /** Total number of registered types. */
  get typeCount(): number { return this.types.length; }

  /** Total number of registered functions. */
  get functionCount(): number { return this.funcs.length; }

  /** Whether the registry has been finalized. */
  get finalized(): boolean { return this._finalized; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the last component of a dot-separated QN. */
function extractLastName(qn: string): string {
  const idx = qn.lastIndexOf('.');
  return idx === -1 ? qn : qn.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// Cross-File Batch Processing
// ---------------------------------------------------------------------------

/** Per-file import entry. */
export interface FileImport {
  /** Local name in the importing file. */
  readonly localName: string;
  /** Module QN of the imported module. */
  readonly moduleQn: string;
  /** Whether this is a default import. */
  readonly isDefault: boolean;
  /** Whether this is a namespace import (`import * as`). */
  readonly isNamespace: boolean;
}

/** Per-file definition to register. */
export interface FileDefinition {
  /** Qualified name (project-unique). */
  readonly qn: string;
  /** Short name. */
  readonly shortName: string;
  /** Label: "Function", "Method", "Class", "Interface", etc. */
  readonly label: string;
  /** Module QN. */
  readonly moduleQn: string;
  /** Receiver type (for methods). */
  readonly receiverType?: string;
  /** Resolved type (for type defs). */
  readonly resolvedType?: TypeRep;
  /** Return type QNs (pipe-separated, for functions). */
  readonly returnTypes?: string;
  /** Parameter type QNs (pipe-separated, for functions). */
  readonly paramTypes?: string;
  /** Number of parameters (for functions). */
  readonly paramCount?: number;
  /** Whether this is an async function. */
  readonly isAsync?: boolean;
  /** Language of the source file. */
  readonly language: LspLanguage;
  /** Source file path. */
  readonly sourceFile: string;
  /** Source line number. */
  readonly sourceLine: number;
}

/** Result of cross-file resolution for one file. */
export interface CrossFileResult {
  /** File path. */
  readonly sourceFile: string;
  /** Number of imports resolved. */
  readonly importsResolved: number;
  /** Number of calls resolved to cross-file targets. */
  readonly callsResolved: number;
  /** Number of type lookups performed. */
  readonly typeLookups: number;
  /** Resolution strategy tags for debuggability. */
  readonly strategies: readonly string[];
}

/**
 * Build a project-wide shared type registry from all file definitions.
 */
export function buildProjectRegistry(
  allDefs: readonly FileDefinition[],
): TypeRegistry {
  const registry = new TypeRegistry();

  for (const def of allDefs) {
    if (def.label === 'Function' || def.label === 'Method') {
      registry.registerFunction({
        qn: def.qn,
        shortName: def.shortName,
        label: def.label,
        receiverType: def.receiverType,
        moduleQn: def.moduleQn,
        returnTypes: def.returnTypes ?? 'unknown',
        paramCount: def.paramCount ?? 0,
        paramTypes: def.paramTypes ?? '',
        isAsync: def.isAsync ?? false,
        language: def.language,
        sourceFile: def.sourceFile,
        sourceLine: def.sourceLine,
      });
    } else {
      registry.registerType({
        qn: def.qn,
        shortName: def.shortName,
        label: def.label,
        moduleQn: def.moduleQn,
        type: def.resolvedType ?? { kind: 'unknown' },
        language: def.language,
        sourceFile: def.sourceFile,
        sourceLine: def.sourceLine,
      });
    }
  }

  registry.finalize();
  return registry;
}

/**
 * Create a per-file overlay registry chained to the shared base.
 */
export function createPerFileOverlay(
  baseRegistry: TypeRegistry,
  ownDefs: readonly FileDefinition[],
  imports: readonly FileImport[],
): { overlay: TypeRegistry; importMap: Map<string, string> } {
  const overlay = new TypeRegistry(baseRegistry);

  // Register only own-module defs in the overlay
  for (const def of ownDefs) {
    if (def.label === 'Function' || def.label === 'Method') {
      overlay.registerFunction({
        qn: def.qn,
        shortName: def.shortName,
        label: def.label,
        receiverType: def.receiverType,
        moduleQn: def.moduleQn,
        returnTypes: def.returnTypes ?? 'unknown',
        paramCount: def.paramCount ?? 0,
        paramTypes: def.paramTypes ?? '',
        isAsync: def.isAsync ?? false,
        language: def.language,
        sourceFile: def.sourceFile,
        sourceLine: def.sourceLine,
      });
    } else {
      overlay.registerType({
        qn: def.qn,
        shortName: def.shortName,
        label: def.label,
        moduleQn: def.moduleQn,
        type: def.resolvedType ?? { kind: 'unknown' },
        language: def.language,
        sourceFile: def.sourceFile,
        sourceLine: def.sourceLine,
      });
    }
  }

  overlay.finalize();

  // Build import map: localName → moduleQN
  const importMap = new Map<string, string>();
  for (const imp of imports) {
    if (!imp.isNamespace) {
      importMap.set(imp.localName, imp.moduleQn);
    }
    // For namespace imports: `import * as Lib from './mod'`
    // The import map stores `Lib` → moduleQN
    if (imp.isNamespace) {
      importMap.set(imp.localName, imp.moduleQn);
    }
  }

  return { overlay, importMap };
}
