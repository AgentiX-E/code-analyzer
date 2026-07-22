// @code-analyzer/analyzer — Scope Resolution Engine

import type {
  ParsedFile,
  SymbolDefinition,
  ReferenceSite,
  SemanticModel,
  ScopeTree,
  NodeLabel,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// ScopeTree Implementation
// ---------------------------------------------------------------------------

class ScopeTreeNode implements ScopeTree {
  name: string;
  kind: NodeLabel;
  startLine: number;
  endLine: number;
  parent?: ScopeTree;
  children: ScopeTree[];
  symbols: string[];

  constructor(
    name: string,
    kind: NodeLabel,
    startLine: number,
    endLine: number,
    parent?: ScopeTree,
  ) {
    this.name = name;
    this.kind = kind;
    this.startLine = startLine;
    this.endLine = endLine;
    this.parent = parent;
    this.children = [];
    this.symbols = [];
  }

  addChild(child: ScopeTreeNode): ScopeTreeNode {
    this.children.push(child);
    return child;
  }

  addSymbol(symbolName: string): void {
    if (!this.symbols.includes(symbolName)) {
      this.symbols.push(symbolName);
    }
  }
}

// ---------------------------------------------------------------------------
// Resolved Result Types
// ---------------------------------------------------------------------------

export interface ResolvedReference {
  sourceFile: string;
  sourceLine: number;
  sourceSymbol: string;
  targetFile: string | null;
  targetSymbol: string | null;
  isResolved: boolean;
  resolutionType: 'same-file' | 'import' | 'global' | 'unresolved';
}

export interface ResolvedCall {
  sourceFile: string;
  sourceLine: number;
  callerName: string;
  calleeFile: string | null;
  calleeName: string | null;
  isResolved: boolean;
}

export interface ResolvedImport {
  sourceFile: string;
  importPath: string;
  importedNames: string[];
  resolvedModule: string | null;
  isResolved: boolean;
}

// ---------------------------------------------------------------------------
// ScopeResolver
// ---------------------------------------------------------------------------

export class ScopeResolver {
  /** Build scope trees from parsed files */
  buildScopeTrees(files: ParsedFile[]): ScopeTree[] {
    const trees: ScopeTree[] = [];

    for (const file of files) {
      const fileScope = new ScopeTreeNode(
        file.filePath,
        'File',
        1,
        Number.MAX_SAFE_INTEGER,
      );

      // Build scope hierarchy from symbols
      const symbolMap = new Map<string, SymbolDefinition[]>();
      for (const sym of file.symbols) {
        const key = sym.containerName ?? '__top__';
        const list = symbolMap.get(key) ?? [];
        list.push(sym);
        symbolMap.set(key, list);
      }

      // Add top-level symbols
      const topSymbols = symbolMap.get('__top__') ?? [];
      for (const sym of topSymbols) {
        fileScope.addSymbol(sym.qualifiedName);
        const childScope = new ScopeTreeNode(
          sym.name,
          sym.kind,
          sym.startLine,
          sym.endLine,
          fileScope,
        );

        // Add member symbols
        const members = symbolMap.get(sym.name) ?? [];
        for (const member of members) {
          childScope.addSymbol(member.qualifiedName);
        }

        fileScope.addChild(childScope);
      }

      trees.push(fileScope);
    }

    return trees;
  }

  /** Resolve all references to their definitions */
  resolveReferences(
    files: ParsedFile[],
    _scopeTrees: ScopeTree[],
    model: SemanticModel,
  ): ResolvedReference[] {
    const resolved: ResolvedReference[] = [];

    // Build name-to-file index
    const nameToFile = new Map<string, string[]>();
    for (const file of files) {
      for (const sym of file.symbols) {
        const files = nameToFile.get(sym.name) ?? [];
        if (!files.includes(file.filePath)) {
          files.push(file.filePath);
        }
        nameToFile.set(sym.name, files);
      }
    }

    // Resolve each reference site
    for (const file of files) {
      for (const ref of file.references) {
        const resolution = this.resolveSingleReference(
          ref,
          file.filePath,
          files,
          nameToFile,
          model,
        );
        resolved.push(resolution);
      }
    }

    return resolved;
  }

  /** Resolve function/method calls */
  resolveCalls(
    references: ResolvedReference[],
    _model: SemanticModel,
  ): ResolvedCall[] {
    const calls: ResolvedCall[] = [];

    for (const ref of references) {
      calls.push({
        sourceFile: ref.sourceFile,
        sourceLine: ref.sourceLine,
        callerName: ref.sourceSymbol,
        calleeFile: ref.targetFile,
        calleeName: ref.targetSymbol,
        isResolved: ref.isResolved,
      });
    }

    return calls;
  }

  /** Resolve imports to target symbols */
  resolveImports(
    files: ParsedFile[],
    _model: SemanticModel,
  ): ResolvedImport[] {
    const resolvedImports: ResolvedImport[] = [];

    // Build file path index
    const fileIndex = new Map<string, string>();
    for (const file of files) {
      /* v8 ignore next */
      const fileName = file.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      fileIndex.set(fileName, file.filePath);
      fileIndex.set(file.filePath, file.filePath);
    }

    for (const file of files) {
      for (const ref of file.references) {
        if (ref.referenceKind === 'import') {
          const importPath = ref.targetName;
          let resolvedModule: string | null = null;

          // Try to resolve the import path
          for (const [name, fp] of fileIndex) {
            if (importPath.endsWith(name) || importPath.includes(name)) {
              resolvedModule = fp;
              break;
            }
          }

          resolvedImports.push({
            sourceFile: file.filePath,
            importPath,
            importedNames: [ref.targetName],
            resolvedModule,
            isResolved: resolvedModule !== null,
          });
        }
      }
    }

    return resolvedImports;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private resolveSingleReference(
    ref: ReferenceSite,
    sourceFile: string,
    allFiles: ParsedFile[],
    nameToFile: Map<string, string[]>,
    _model: SemanticModel,
  ): ResolvedReference {
    // Try same-file resolution
    const sameFile = allFiles.find((f) => f.filePath === sourceFile);
    if (sameFile) {
      const found = sameFile.symbols.find(
        (s) => s.name === ref.targetName || s.qualifiedName === ref.targetQname,
      );
      if (found) {
        return {
          sourceFile,
          sourceLine: ref.sourceLine,
          sourceSymbol: ref.targetName,
          targetFile: sourceFile,
          targetSymbol: found.qualifiedName,
          isResolved: true,
          resolutionType: 'same-file',
        };
      }
    }

    // Try cross-file resolution via import
    const candidateFiles = nameToFile.get(ref.targetName);
    if (candidateFiles && candidateFiles.length === 1) {
      const file = candidateFiles[0]!;
      return {
        sourceFile,
        sourceLine: ref.sourceLine,
        sourceSymbol: ref.targetName,
        targetFile: file,
        targetSymbol: ref.targetName,
        isResolved: true,
        /* v8 ignore next */
        resolutionType: file === sourceFile ? 'same-file' : 'import',
      };
    }

    // Unresolved
    return {
      sourceFile,
      sourceLine: ref.sourceLine,
      sourceSymbol: ref.targetName,
      targetFile: null,
      targetSymbol: null,
      isResolved: false,
      resolutionType: 'unresolved',
    };
  }
}
