// @code-analyzer/vscode — Graph Explorer Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { GraphExplorerLogic } from '../providers/graph-explorer.js';
import type { GraphNodeData, GraphEdgeData, GraphData } from '../providers/graph-explorer.js';
import { EngineBridge } from '../services/engine-bridge.js';
import {
  OTHER_PROJECT,
  PROJECT,
  insertEdge,
  makeNode,
  seedGraph,
} from './fixtures/seeded-graph.js';
import type { SeededGraph } from './fixtures/seeded-graph.js';

describe('GraphExplorerLogic', () => {
  let engine: EngineBridge;
  let logic: GraphExplorerLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    logic = new GraphExplorerLogic(engine);
  });

  afterEach(() => {
    engine.dispose();
  });

  // -------------------------------------------------------------------------
  // getNodeColor
  // -------------------------------------------------------------------------

  describe('getNodeColor', () => {
    it('returns correct color for Function', () => {
      expect(logic.getNodeColor('Function')).toBe('#569cd6');
    });

    it('returns correct color for Class', () => {
      expect(logic.getNodeColor('Class')).toBe('#4ec9b0');
    });

    it('returns correct color for Module', () => {
      expect(logic.getNodeColor('Module')).toBe('#c586c0');
    });

    it('returns correct color for Interface', () => {
      expect(logic.getNodeColor('Interface')).toBe('#9cdcfe');
    });

    it('returns correct color for Method', () => {
      expect(logic.getNodeColor('Method')).toBe('#dcdcaa');
    });

    it('returns correct color for Property', () => {
      expect(logic.getNodeColor('Property')).toBe('#dcdcaa');
    });

    it('returns correct color for Constructor', () => {
      expect(logic.getNodeColor('Constructor')).toBe('#dcdcaa');
    });

    it('returns correct color for Enum', () => {
      expect(logic.getNodeColor('Enum')).toBe('#ce9178');
    });

    it('returns correct color for TypeAlias', () => {
      expect(logic.getNodeColor('TypeAlias')).toBe('#ce9178');
    });

    it('returns correct color for Struct', () => {
      expect(logic.getNodeColor('Struct')).toBe('#ce9178');
    });

    it('returns correct color for Trait', () => {
      expect(logic.getNodeColor('Trait')).toBe('#ce9178');
    });

    it('returns correct color for Variable', () => {
      expect(logic.getNodeColor('Variable')).toBe('#6a9955');
    });

    it('returns correct color for Project', () => {
      expect(logic.getNodeColor('Project')).toBe('#c586c0');
    });

    it('returns correct color for Package', () => {
      expect(logic.getNodeColor('Package')).toBe('#c586c0');
    });

    it('returns correct color for Folder', () => {
      expect(logic.getNodeColor('Folder')).toBe('#c586c0');
    });

    it('returns correct color for File', () => {
      expect(logic.getNodeColor('File')).toBe('#c586c0');
    });

    it('returns correct color for Route', () => {
      expect(logic.getNodeColor('Route')).toBe('#d16969');
    });

    it('returns correct color for Tool', () => {
      expect(logic.getNodeColor('Tool')).toBe('#d16969');
    });

    it('returns correct color for Component', () => {
      expect(logic.getNodeColor('Component')).toBe('#d16969');
    });

    it('returns correct color for Test', () => {
      expect(logic.getNodeColor('Test')).toBe('#4fc1ff');
    });

    it('returns correct color for Community', () => {
      expect(logic.getNodeColor('Community')).toBe('#b5cea8');
    });

    it('returns correct color for Process', () => {
      expect(logic.getNodeColor('Process')).toBe('#b5cea8');
    });

    it('returns correct color for Config', () => {
      expect(logic.getNodeColor('Config')).toBe('#808080');
    });

    it('returns correct color for ADR', () => {
      expect(logic.getNodeColor('ADR')).toBe('#808080');
    });

    it('returns correct color for BasicBlock', () => {
      expect(logic.getNodeColor('BasicBlock')).toBe('#e0e0e0');
    });

    it('returns correct color for InfraResource', () => {
      expect(logic.getNodeColor('InfraResource')).toBe('#e0e0e0');
    });

    it('returns correct color for CrossRepoFunction', () => {
      expect(logic.getNodeColor('CrossRepoFunction')).toBe('#c586c0');
    });

    it('returns correct color for CrossRepoInterface', () => {
      expect(logic.getNodeColor('CrossRepoInterface')).toBe('#c586c0');
    });

    it('returns correct color for CrossRepoModule', () => {
      expect(logic.getNodeColor('CrossRepoModule')).toBe('#c586c0');
    });

    it('returns correct color for Contract', () => {
      expect(logic.getNodeColor('Contract')).toBe('#e2a23b');
    });

    it('returns correct color for Event', () => {
      expect(logic.getNodeColor('Event')).toBe('#e2a23b');
    });

    it('returns correct color for DataSource', () => {
      expect(logic.getNodeColor('DataSource')).toBe('#f44747');
    });

    it('returns correct color for Sink', () => {
      expect(logic.getNodeColor('Sink')).toBe('#f44747');
    });

    it('returns default color for unknown label', () => {
      expect(logic.getNodeColor('UnknownType')).toBe('#808080');
    });

    it('returns default color for empty label', () => {
      expect(logic.getNodeColor('')).toBe('#808080');
    });
  });

  // -------------------------------------------------------------------------
  // getNodeColorMap
  // -------------------------------------------------------------------------

  describe('getNodeColorMap', () => {
    it('returns a color map object', () => {
      const map = logic.getNodeColorMap();
      expect(typeof map).toBe('object');
      expect(map).not.toBeNull();
    });

    it('contains all 33 node label colors', () => {
      const map = logic.getNodeColorMap();
      const labels = Object.keys(map);
      expect(labels.length).toBeGreaterThanOrEqual(33);
    });

    it('each entry is a valid hex color', () => {
      const map = logic.getNodeColorMap();
      for (const [, color] of Object.entries(map)) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it('returns a copy not a reference', () => {
      const map1 = logic.getNodeColorMap();
      const map2 = logic.getNodeColorMap();
      expect(map1).not.toBe(map2);
    });
  });

  // -------------------------------------------------------------------------
  // getGraphData
  // -------------------------------------------------------------------------

  describe('getGraphData', () => {
    it('returns empty graph when no project ID set', async () => {
      const data = await logic.getGraphData();
      expect(data.nodes).toEqual([]);
      expect(data.edges).toEqual([]);
    });

    it('returns an empty graph when the project has no symbols yet', async () => {
      engine.setProjectId('test-project');
      const data = await logic.getGraphData();
      expect(data.nodes).toEqual([]);
      expect(data.edges).toEqual([]);
    });

    it('returns empty graph when rootSymbol is empty string', async () => {
      engine.setProjectId('test-project');
      const data = await logic.getGraphData('');
      expect(data.nodes).toEqual([]);
      expect(data.edges).toEqual([]);
    });

    it('returns empty graph instead of throwing when the graph is unusable', async () => {
      // The store this bridge reads was closed underneath it, so the summary query
      // rejects. Losing the graph must not take the webview down with it.
      const store = new InMemoryGraphStore();
      const brokenEngine = new EngineBridge({ store });
      brokenEngine.setProjectId('test-project');
      store.close();

      const brokenLogic = new GraphExplorerLogic(brokenEngine);
      expect(await brokenLogic.getGraphData()).toEqual({ nodes: [], edges: [] });

      brokenEngine.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // getGraphData against a populated graph
  // -------------------------------------------------------------------------

  describe('getGraphData over a populated graph', () => {
    let seeded: SeededGraph;
    let seededLogic: GraphExplorerLogic;

    beforeEach(async () => {
      seeded = await seedGraph();
      seededLogic = new GraphExplorerLogic(seeded.bridge);
    });

    afterEach(() => {
      seeded.bridge.dispose();
    });

    it('draws every catalogued symbol and the call edges between them', async () => {
      const data = await seededLogic.getGraphData();

      expect(data.nodes).toEqual([
        {
          id: 0,
          name: 'AlphaService',
          qualifiedName: `${PROJECT}.AlphaService`,
          label: 'Class',
          filePath: 'src/a.ts',
        },
        {
          id: 1,
          name: 'BetaService',
          qualifiedName: `${PROJECT}.BetaService`,
          label: 'Class',
          filePath: 'src/b.ts',
        },
        {
          id: 2,
          name: 'AlphaServiceTest',
          qualifiedName: `${PROJECT}.AlphaServiceTest`,
          label: 'Function',
          filePath: 'src/a.test.ts',
        },
        {
          id: 3,
          name: 'BareSymbol',
          qualifiedName: `${PROJECT}.BareSymbol`,
          label: 'Class',
          filePath: '',
        },
        {
          id: 4,
          name: 'UnfiledCaller',
          qualifiedName: `${PROJECT}.UnfiledCaller`,
          label: 'Function',
          filePath: '',
        },
        {
          id: 5,
          name: 'UnfiledTest',
          qualifiedName: `${PROJECT}.UnfiledTest`,
          label: 'Function',
          filePath: '',
        },
      ]);
      // Both edges hang off a symbol that has a callee. The previous build passed
      // the bare name to findCallees(), which resolves through the graph-qualified
      // name, so no callee ever resolved and this list was always empty.
      expect(data.edges).toEqual([
        { sourceId: 0, targetId: 1, type: 'call' },
        { sourceId: 4, targetId: 3, type: 'call' },
      ]);
    });

    it('skips a callee that belongs to another project', async () => {
      const store = new InMemoryGraphStore();
      const home = store.insertNode(makeNode('Home', `${PROJECT}.Home`));
      const foreign = store.insertNode(
        makeNode('Foreign', `${OTHER_PROJECT}.Foreign`, { projectId: OTHER_PROJECT }),
      );
      // A store handed to the bridge can hold several indexed projects, so an edge
      // may point at a node this view does not draw.
      insertEdge(store, home, foreign, 'CALLS');

      const bridge = new EngineBridge({ store });
      await bridge.initialize();
      await bridge.indexWorkspace(PROJECT);

      const data = await new GraphExplorerLogic(bridge).getGraphData();

      expect(data.nodes).toEqual([
        {
          id: 0,
          name: 'Home',
          qualifiedName: `${PROJECT}.Home`,
          label: 'Class',
          filePath: 'src/a.ts',
        },
      ]);
      expect(data.edges).toEqual([]);

      bridge.dispose();
    });

    it('builds a call graph from the traced path of the requested symbol', async () => {
      const data = await seededLogic.getGraphData(`${PROJECT}.AlphaService`);

      expect(data.nodes).toEqual([
        {
          id: 1,
          name: 'AlphaService',
          qualifiedName: `${PROJECT}.AlphaService`,
          label: 'Function',
          filePath: 'src/a.ts',
        },
        {
          id: 2,
          name: 'BetaService',
          qualifiedName: `${PROJECT}.BetaService`,
          label: 'Function',
          filePath: 'src/b.ts',
        },
      ]);
      expect(data.edges).toEqual([{ sourceId: 1, targetId: 2, type: 'CALLS' }]);
    });

    it('builds a call graph with a single node and no edges', async () => {
      const data = await seededLogic.getGraphData(`${PROJECT}.BareSymbol`);

      expect(data.nodes).toEqual([
        {
          id: 1,
          name: 'BareSymbol',
          qualifiedName: `${PROJECT}.BareSymbol`,
          label: 'Function',
          filePath: '',
        },
      ]);
      expect(data.edges).toEqual([]);
    });

    it('returns no call graph for a symbol the graph does not know', async () => {
      expect(await seededLogic.getGraphData(`${PROJECT}.Missing`)).toEqual({
        nodes: [],
        edges: [],
      });
    });

    it('resolves a node detail through the symbol the summary graph drew', async () => {
      expect(await seededLogic.getNodeDetail(0)).toEqual({
        name: 'AlphaService',
        qualifiedName: `${PROJECT}.AlphaService`,
        filePath: 'src/a.ts',
        signature: 'function AlphaService()',
        docstring: 'Documentation for AlphaService',
        label: 'Class',
        isExported: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // getNodeDetail
  // -------------------------------------------------------------------------

  describe('getNodeDetail', () => {
    it('returns undefined when no project ID', async () => {
      const detail = await logic.getNodeDetail(1);
      expect(detail).toBeUndefined();
    });

    it('returns undefined for non-existent node', async () => {
      engine.setProjectId('test-project');
      const detail = await logic.getNodeDetail(999);
      expect(detail).toBeUndefined();
    });

    it('returns undefined for negative node ID', async () => {
      engine.setProjectId('test-project');
      const detail = await logic.getNodeDetail(-1);
      expect(detail).toBeUndefined();
    });
  });
});
