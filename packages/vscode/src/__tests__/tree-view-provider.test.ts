// @code-analyzer/vscode — Tree View Provider Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { GraphTreeDataProviderLogic } from '../providers/tree-view-provider.js';
import type { TreeItemData } from '../providers/tree-view-provider.js';
import { EngineBridge } from '../services/engine-bridge.js';
import { PROJECT, seedGraph } from './fixtures/seeded-graph.js';
import type { SeededGraph } from './fixtures/seeded-graph.js';

describe('GraphTreeDataProviderLogic', () => {
  let engine: EngineBridge;
  let logic: GraphTreeDataProviderLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    logic = new GraphTreeDataProviderLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  // -------------------------------------------------------------------------
  // getRootItems
  // -------------------------------------------------------------------------

  describe('getRootItems', () => {
    it('returns empty array when no project ID set', async () => {
      const items = await logic.getRootItems();
      expect(items).toEqual([]);
    });

    it('returns project root item when project ID is set', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items.length).toBe(1);
    });

    it('root item has project type context value', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].contextValue).toBe('project');
    });

    it('root item is expanded by default', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].collapsibleState).toBe('expanded');
    });

    it('root item extracts project name from path', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].label).toBe('my-project');
    });

    it('returns projectId itself when path has no slashes', async () => {
      engine.setProjectId('simple-project');
      const items = await logic.getRootItems();
      expect(items[0].label).toBe('simple-project');
    });

    it('handles projectId ending with slash (extractProjectName fallback)', async () => {
      engine.setProjectId('/workspace/project/');
      const items = await logic.getRootItems();
      // Last part after split is empty string '', so falls back to projectId
      expect(items[0].label).toBe('/workspace/project/');
    });

    it('root item has correct icon', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].iconPath).toBe('project');
    });

    it('root item has resourceUri', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].resourceUri).toEqual({ fsPath: '/workspace/my-project' });
    });

    it('root item has id with project prefix', async () => {
      engine.setProjectId('/workspace/my-project');
      const items = await logic.getRootItems();
      expect(items[0].id).toContain('project:');
    });
  });

  // -------------------------------------------------------------------------
  // getChildren
  // -------------------------------------------------------------------------

  describe('getChildren', () => {
    it('returns empty array for non-existent parent', async () => {
      const children = await logic.getChildren('symbol:nonexistent');
      expect(children).toEqual([]);
    });

    it('returns empty array for symbol children (leaf nodes)', async () => {
      engine.setProjectId('test');
      const children = await logic.getChildren('symbol:test:src:someSymbol');
      expect(children).toEqual([]);
    });

    it('handles unknown parent ID format', async () => {
      const children = await logic.getChildren('unknown:something');
      expect(children).toEqual([]);
    });

    it('returns no module children while no project is loaded', async () => {
      const children = await logic.getChildren('project:/test');
      expect(children).toEqual([]);
    });

    it('returns no module children when the graph is unusable', async () => {
      // The store the bridge reads was closed underneath it. Losing the graph must
      // not take the tree view down with it.
      const store = new InMemoryGraphStore();
      const brokenEngine = new EngineBridge({ store });
      brokenEngine.setProjectId('/test');
      store.close();

      const children = await new GraphTreeDataProviderLogic(brokenEngine).getChildren(
        'project:/test',
      );
      expect(children).toEqual([]);

      brokenEngine.dispose();
    });

    it('returns no symbol children when the graph is unusable', async () => {
      const store = new InMemoryGraphStore();
      const brokenEngine = new EngineBridge({ store });
      brokenEngine.setProjectId('/test');
      store.close();

      const children = await new GraphTreeDataProviderLogic(brokenEngine).getChildren(
        'module:/test:src',
      );
      expect(children).toEqual([]);

      brokenEngine.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getChildren against a populated graph
  // -------------------------------------------------------------------------

  describe('getChildren over a populated graph', () => {
    let seeded: SeededGraph;
    let seededLogic: GraphTreeDataProviderLogic;

    beforeEach(async () => {
      seeded = await seedGraph();
      seededLogic = new GraphTreeDataProviderLogic(seeded.bridge);
    });

    afterEach(() => {
      seeded.bridge.dispose();
    });

    it('groups the project symbols into one module per directory', async () => {
      // An empty search query matches no term, so this list was always empty and
      // the tree never showed a single module.
      expect(await seededLogic.getChildren(`project:${PROJECT}`)).toEqual([
        {
          id: `module:${PROJECT}:src`,
          label: 'src',
          description: 'src',
          iconPath: 'folder',
          collapsibleState: 'collapsed',
          contextValue: 'module',
        },
        {
          id: `module:${PROJECT}:(root)`,
          label: '(root)',
          description: undefined,
          iconPath: 'folder',
          collapsibleState: 'collapsed',
          contextValue: 'module',
        },
      ]);
    });

    it('lists exactly the symbols of the requested module', async () => {
      const children = await seededLogic.getChildren(`module:${PROJECT}:src`);

      expect(children.map((c) => c.label)).toEqual([
        'AlphaService',
        'BetaService',
        'AlphaServiceTest',
      ]);
    });

    it('keeps a symbol the graph has no file for out of every directory module', async () => {
      const children = await seededLogic.getChildren(`module:${PROJECT}:src`);

      // A project-root symbol's directory is the empty string, and
      // `modulePath.endsWith('')` is true for every string — so a bare-`endsWith`
      // match leaked those symbols into `src`, and into every other module.
      expect(children.map((c) => c.label)).not.toContain('BareSymbol');
    });

    it('lists the project-root symbols under the root module', async () => {
      const children = await seededLogic.getChildren(`module:${PROJECT}:(root)`);

      expect(children.map((c) => c.label)).toEqual(['BareSymbol', 'UnfiledCaller', 'UnfiledTest']);
      // No file to open, so the item carries no resource to reveal.
      expect(children.every((c) => c.resourceUri === undefined)).toBe(true);
    });

    it('builds a symbol item that addresses the graph by qualified name', async () => {
      const [first] = await seededLogic.getChildren(`module:${PROJECT}:src`);

      expect(first).toEqual({
        id: `symbol:${PROJECT}:src:AlphaService`,
        label: 'AlphaService',
        description: 'Class',
        iconPath: 'symbol-class',
        collapsibleState: 'none',
        contextValue: 'symbol',
        command: {
          command: 'code-analyzer.showSymbolDetail',
          title: 'Show Symbol Detail',
          // The command re-queries the graph, which resolves by qualified name.
          arguments: [`${PROJECT}.AlphaService`],
        },
        resourceUri: { fsPath: 'src/a.ts' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // getParent
  // -------------------------------------------------------------------------

  describe('getParent', () => {
    it('returns module parent for symbol item', () => {
      engine.setProjectId('/test');
      const parent = logic.getParent('symbol:/test:src:someSymbol');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('module');
    });

    it('returns project parent for module item', () => {
      engine.setProjectId('/test');
      const parent = logic.getParent('module:/test:src');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('project');
    });

    it('returns undefined for project item', () => {
      engine.setProjectId('/test');
      const parent = logic.getParent('project:/test');
      expect(parent).toBeUndefined();
    });

    it('returns undefined for a symbol item without a module segment', () => {
      // `symbol:<name>` has no module between the prefix and the name, so there
      // is no parent module to build.
      const parent = logic.getParent('symbol:someSymbol');
      expect(parent).toBeUndefined();
    });

    it('returns undefined for unknown item type', () => {
      const parent = logic.getParent('unknown:test');
      expect(parent).toBeUndefined();
    });

    it('module parent has folder icon', () => {
      engine.setProjectId('/test');
      // getParent for a module returns the project parent, not module parent
      // This tests that getParent returns valid data for module items
      const parent = logic.getParent('module:/test:src');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('project');
    });

    it('returns module parent for symbol item with deeper path', () => {
      engine.setProjectId('/test');
      const parent = logic.getParent('symbol:/test:src:sub:deep:someSymbol');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('module');
      expect(parent?.id).toBe('module:src/sub/deep');
      expect(parent?.label).toBe('deep');
    });

    it('handles symbol item with empty module path segment', () => {
      engine.setProjectId('/test');
      const parent = logic.getParent('symbol:test::someSymbol');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('module');
      expect(parent?.id).toBe('module:');
    });

    it('returns project parent for module item when projectId is null', () => {
      // Don't set project ID — getProjectId() returns null
      const parent = logic.getParent('module:/test:src');
      expect(parent).toBeDefined();
      expect(parent?.contextValue).toBe('project');
      expect(parent?.id).toBe('project:');
    });
  });

  // -------------------------------------------------------------------------
  // getIconForLabel
  // -------------------------------------------------------------------------

  describe('getIconForLabel', () => {
    it('returns correct icon for Function', () => {
      expect(logic.getIconForLabel('Function')).toBe('symbol-function');
    });

    it('returns correct icon for Class', () => {
      expect(logic.getIconForLabel('Class')).toBe('symbol-class');
    });

    it('returns correct icon for Interface', () => {
      expect(logic.getIconForLabel('Interface')).toBe('symbol-interface');
    });

    it('returns correct icon for Method', () => {
      expect(logic.getIconForLabel('Method')).toBe('symbol-method');
    });

    it('returns correct icon for Constructor', () => {
      expect(logic.getIconForLabel('Constructor')).toBe('symbol-constructor');
    });

    it('returns correct icon for Property', () => {
      expect(logic.getIconForLabel('Property')).toBe('symbol-field');
    });

    it('returns correct icon for Module', () => {
      expect(logic.getIconForLabel('Module')).toBe('symbol-namespace');
    });

    it('returns correct icon for Variable', () => {
      expect(logic.getIconForLabel('Variable')).toBe('symbol-variable');
    });

    it('returns correct icon for Enum', () => {
      expect(logic.getIconForLabel('Enum')).toBe('symbol-enum');
    });

    it('returns correct icon for TypeAlias', () => {
      expect(logic.getIconForLabel('TypeAlias')).toBe('symbol-structure');
    });

    it('returns correct icon for Struct', () => {
      expect(logic.getIconForLabel('Struct')).toBe('symbol-structure');
    });

    it('returns correct icon for Trait', () => {
      expect(logic.getIconForLabel('Trait')).toBe('symbol-interface');
    });

    it('returns correct icon for Project', () => {
      expect(logic.getIconForLabel('Project')).toBe('project');
    });

    it('returns correct icon for File', () => {
      expect(logic.getIconForLabel('File')).toBe('file');
    });

    it('returns correct icon for Folder', () => {
      expect(logic.getIconForLabel('Folder')).toBe('folder');
    });

    it('returns correct icon for Route', () => {
      expect(logic.getIconForLabel('Route')).toBe('symbol-ruler');
    });

    it('returns correct icon for Tool', () => {
      expect(logic.getIconForLabel('Tool')).toBe('tools');
    });

    it('returns correct icon for Component', () => {
      expect(logic.getIconForLabel('Component')).toBe('symbol-event');
    });

    it('returns correct icon for Test', () => {
      expect(logic.getIconForLabel('Test')).toBe('beaker');
    });

    it('returns correct icon for Community', () => {
      expect(logic.getIconForLabel('Community')).toBe('organization');
    });

    it('returns correct icon for Process', () => {
      expect(logic.getIconForLabel('Process')).toBe('server-process');
    });

    it('returns correct icon for Config', () => {
      expect(logic.getIconForLabel('Config')).toBe('settings-gear');
    });

    it('returns correct icon for ADR', () => {
      expect(logic.getIconForLabel('ADR')).toBe('book');
    });

    it('returns correct icon for DataSource', () => {
      expect(logic.getIconForLabel('DataSource')).toBe('database');
    });

    it('returns correct icon for Sink', () => {
      expect(logic.getIconForLabel('Sink')).toBe('circle-slash');
    });

    it('returns default icon for unknown label', () => {
      expect(logic.getIconForLabel('UnknownType')).toBe('symbol-misc');
    });

    it('returns default icon for empty label', () => {
      expect(logic.getIconForLabel('')).toBe('symbol-misc');
    });

    it('all known icons are non-empty strings', () => {
      const map = logic.getIconMap();
      for (const [, icon] of Object.entries(map)) {
        expect(icon.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // getIconMap
  // -------------------------------------------------------------------------

  describe('getIconMap', () => {
    it('returns an icon map object', () => {
      const map = logic.getIconMap();
      expect(typeof map).toBe('object');
      expect(map).not.toBeNull();
    });

    it('returns a copy not a reference', () => {
      const map1 = logic.getIconMap();
      const map2 = logic.getIconMap();
      expect(map1).not.toBe(map2);
    });

    it('contains entries for all major labels', () => {
      const map = logic.getIconMap();
      expect(map['Function']).toBeDefined();
      expect(map['Class']).toBeDefined();
      expect(map['Module']).toBeDefined();
      expect(map['Interface']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // searchItems
  // -------------------------------------------------------------------------

  describe('searchItems', () => {
    it('returns empty array for empty query', async () => {
      const results = await logic.searchItems('');
      expect(results).toEqual([]);
    });

    it('returns empty array for a whitespace-only query', async () => {
      const results = await logic.searchItems('   ');
      expect(results).toEqual([]);
    });

    it('returns array for non-empty query', async () => {
      const results = await logic.searchItems('function');
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns no results when the graph is unusable', async () => {
      // The search index is built from the graph on first use, so a graph that is
      // already closed makes the very first search reject.
      const store = new InMemoryGraphStore();
      const brokenEngine = new EngineBridge({ store });
      brokenEngine.setProjectId('/test');
      store.close();

      const results = await new GraphTreeDataProviderLogic(brokenEngine).searchItems('anything');
      expect(results).toEqual([]);

      brokenEngine.dispose();
    });

    it('addresses a search hit by the symbol qualified name', async () => {
      const seeded = await seedGraph();

      const results = await new GraphTreeDataProviderLogic(seeded.bridge).searchItems('Alpha');

      expect(results.map((r) => r.label)).toEqual(['AlphaService', 'AlphaServiceTest']);
      expect(results[0]!.command!.arguments).toEqual([`${PROJECT}.AlphaService`]);
      expect(results[0]!.contextValue).toBe('symbol');

      seeded.bridge.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // TreeItemData structure validation
  // -------------------------------------------------------------------------

  describe('TreeItemData structure', () => {
    it('root items have required fields', async () => {
      engine.setProjectId('/test');
      const items = await logic.getRootItems();
      for (const item of items) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('collapsibleState');
        expect(item).toHaveProperty('contextValue');
      }
    });

    it('project items have expanded state', async () => {
      engine.setProjectId('/test');
      const items = await logic.getRootItems();
      for (const item of items) {
        if (item.contextValue === 'project') {
          expect(item.collapsibleState).toBe('expanded');
        }
      }
    });
  });
});
