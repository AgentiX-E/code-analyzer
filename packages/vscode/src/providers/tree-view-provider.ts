// @code-analyzer/vscode — Tree View Provider
// Pure logic class for the knowledge graph tree view in the sidebar.
// Provides hierarchical Project → Modules → Symbols navigation.
// No VS Code dependency — all VS Code integration lives in extension.ts.

import type { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Tree Item Types
// ---------------------------------------------------------------------------

export interface TreeItemData {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  iconPath?: string;
  collapsibleState: 'none' | 'collapsed' | 'expanded';
  contextValue: string;
  command?: {
    command: string;
    title: string;
    arguments: unknown[];
  };
  children?: TreeItemData[];
  resourceUri?: { fsPath: string };
}

export interface GraphTreeItem {
  type: 'project' | 'module' | 'symbol';
  data: TreeItemData;
}

// ---------------------------------------------------------------------------
// Icon mapping — NodeLabel → VS Code Product Icon ID
// ---------------------------------------------------------------------------

const LABEL_ICONS: Record<string, string> = {
  Project: 'project',
  Package: 'package',
  Folder: 'folder',
  File: 'file',
  Module: 'symbol-namespace',
  Class: 'symbol-class',
  Interface: 'symbol-interface',
  Function: 'symbol-function',
  Method: 'symbol-method',
  Constructor: 'symbol-constructor',
  Property: 'symbol-field',
  Enum: 'symbol-enum',
  TypeAlias: 'symbol-structure',
  Struct: 'symbol-structure',
  Trait: 'symbol-interface',
  Variable: 'symbol-variable',
  Route: 'symbol-ruler',
  Tool: 'tools',
  Component: 'symbol-event',
  Test: 'beaker',
  Community: 'organization',
  Process: 'server-process',
  Config: 'settings-gear',
  ADR: 'book',
  BasicBlock: 'symbol-misc',
  InfraResource: 'server',
  CrossRepoFunction: 'symbol-function',
  CrossRepoInterface: 'symbol-interface',
  CrossRepoModule: 'symbol-namespace',
  Contract: 'symbol-key',
  Event: 'symbol-event',
  DataSource: 'database',
  Sink: 'circle-slash',
};

// ---------------------------------------------------------------------------
// GraphTreeDataProviderLogic
// ---------------------------------------------------------------------------

export class GraphTreeDataProviderLogic {
  constructor(private engine: EngineBridge) {}

  /**
   * Get top-level tree items (project root).
   */
  async getRootItems(): Promise<TreeItemData[]> {
    const projectId = this.engine.getProjectId();
    if (!projectId) {
      return [];
    }

    // Return project root item
    const projectName = this.extractProjectName(projectId);
    return [
      {
        id: `project:${projectId}`,
        label: projectName,
        description: 'Project',
        iconPath: 'project',
        collapsibleState: 'expanded',
        contextValue: 'project',
        resourceUri: { fsPath: projectId },
      },
    ];
  }

  /**
   * Get children of a tree item by parent ID.
   * Supports lazy loading for modules and symbols.
   */
  async getChildren(parentId: string): Promise<TreeItemData[]> {
    // Parse parent ID to determine type
    if (parentId.startsWith('project:')) {
      return this.getModuleChildren(parentId);
    }
    if (parentId.startsWith('module:')) {
      return this.getSymbolChildren(parentId);
    }
    // Leaf nodes have no children
    return [];
  }

  /**
   * Get the parent of a tree item (for reveal support).
   */
  getParent(itemId: string): TreeItemData | undefined {
    // Symbol items belong to module parents
    if (itemId.startsWith('symbol:')) {
      const parts = itemId.split(':');
      if (parts.length >= 3) {
        const modulePath = parts.slice(2, -1).join('/');
        return {
          id: `module:${modulePath}`,
          label: modulePath.split('/').pop() || modulePath,
          collapsibleState: 'expanded',
          contextValue: 'module',
          iconPath: 'folder',
        };
      }
    }
    // Module items belong to project parent
    if (itemId.startsWith('module:')) {
      const projectId = this.engine.getProjectId() || '';
      const projectName = this.extractProjectName(projectId);
      return {
        id: `project:${projectId}`,
        label: projectName,
        collapsibleState: 'expanded',
        contextValue: 'project',
        iconPath: 'project',
      };
    }
    return undefined;
  }

  /**
   * Map a NodeLabel to a VS Code product icon ID.
   */
  getIconForLabel(label: string): string {
    return LABEL_ICONS[label] ?? 'symbol-misc';
  }

  /**
   * Get the full icon mapping.
   */
  getIconMap(): Record<string, string> {
    return { ...LABEL_ICONS };
  }

  /**
   * Search tree items by name (case-insensitive).
   */
  async searchItems(query: string): Promise<TreeItemData[]> {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    try {
      const results = await this.engine.search(lowerQuery);
      if (results.length === 0) return [];

      return results.map((r) => ({
        id: `symbol:${r.filePath}:${r.name}`,
        label: r.name,
        description: r.filePath,
        // `label` is a required field of SearchResultItem, so there is no
        // unlabelled-symbol case to fall back to.
        iconPath: this.getIconForLabel(r.label),
        collapsibleState: 'none' as const,
        contextValue: 'symbol',
        command: {
          command: 'code-analyzer.showSymbolDetail',
          title: 'Show Symbol Detail',
          // The handler re-queries the graph, which resolves by qualified name —
          // a bare identifier came back as "symbol not found".
          arguments: [r.qualifiedName],
        },
        resourceUri: { fsPath: r.filePath },
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getModuleChildren(projectId: string): Promise<TreeItemData[]> {
    // Extract the project path
    const projectPath = projectId.replace('project:', '');
    // In a real implementation, this would query the store for modules.
    // For now, group the project's symbols by file path as modules.
    try {
      // Listing the graph, not searching it: an empty query matches no term, so
      // the tree had no modules whenever it asked the search engine for "all".
      const results = await this.engine.listProjectSymbols();
      // Group results by directory
      const moduleMap = new Map<string, string[]>();
      for (const r of results) {
        const dir = r.filePath.split('/').slice(0, -1).join('/') || '(root)';
        const existing = moduleMap.get(dir) || [];
        existing.push(r.name);
        moduleMap.set(dir, existing);
      }

      const items: TreeItemData[] = [];
      for (const [dir] of moduleMap) {
        // Invariant: the map key is either the '(root)' literal or the
        // join of the file path's parent segments, so it never ends in a
        // separator and the final segment is never empty.
        const dirName = dir.split('/').pop()!;
        items.push({
          id: `module:${projectPath}:${dir}`,
          label: dirName,
          description: dir !== '(root)' ? dir : undefined,
          iconPath: 'folder',
          collapsibleState: 'collapsed',
          contextValue: 'module',
        });
      }
      return items;
    } catch {
      return [];
    }
  }

  private async getSymbolChildren(moduleId: string): Promise<TreeItemData[]> {
    const modulePath = moduleId.replace('module:', '');
    try {
      // Listing the graph, not searching it — see getModuleChildren().
      const results = await this.engine.listProjectSymbols();
      const symbols = results
        .filter((r) => {
          // Symbols are grouped by the same directory key getModuleChildren() used
          // to build the module id, so a module id is `<projectPath>:<dir>`. A bare
          // `endsWith(dir)` let a project-root symbol — whose dir is the empty
          // string — match every module, and let `src` match `src/utils` as well.
          // Anchoring on the separator keeps the comparison exact.
          const dir = r.filePath.split('/').slice(0, -1).join('/') || '(root)';
          return modulePath === dir || modulePath.endsWith(`:${dir}`);
        })
        .map((r) => ({
          id: `symbol:${modulePath}:${r.name}`,
          label: r.name,
          description: r.label,
          iconPath: this.getIconForLabel(r.label),
          collapsibleState: 'none' as const,
          contextValue: 'symbol',
          command: {
            // `code-analyzer.showSidebar` takes no argument, so the symbol this
            // item carries was dropped on the floor. showSymbolDetail is the
            // handler that consumes one.
            command: 'code-analyzer.showSymbolDetail',
            title: 'Show Symbol Detail',
            arguments: [r.qualifiedName],
          },
          resourceUri: r.filePath ? { fsPath: r.filePath } : undefined,
        }));
      return symbols;
    } catch {
      return [];
    }
  }

  private extractProjectName(projectId: string): string {
    const parts = projectId.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || projectId;
  }
}
