// @code-analyzer/vscode — Graph Explorer Tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphExplorerLogic } from '../providers/graph-explorer.js';
import type { GraphNodeData, GraphEdgeData, GraphData } from '../providers/graph-explorer.js';
import { EngineBridge } from '../services/engine-bridge.js';

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

    it('returns empty graph for uninitialized project', async () => {
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

    it('returns graph data with correct shape', async () => {
      engine.setProjectId('test-project');
      const data = await logic.getGraphData();
      expect(data).toHaveProperty('nodes');
      expect(data).toHaveProperty('edges');
      expect(Array.isArray(data.nodes)).toBe(true);
      expect(Array.isArray(data.edges)).toBe(true);
    });

    it('builds call graph when rootSymbol is provided', async () => {
      engine.setProjectId('test-project');
      const traceSpy = vi.spyOn(engine, 'traceCallPath').mockResolvedValue([
        { name: 'main', filePath: 'src/main.ts' },
        { name: 'helper', filePath: 'src/helper.ts' },
      ]);

      const data = await logic.getGraphData('main');

      expect(traceSpy).toHaveBeenCalledWith('main');
      expect(data.nodes).toHaveLength(2);
      expect(data.nodes[0].name).toBe('main');
      expect(data.nodes[0].label).toBe('Function');
      expect(data.nodes[0].filePath).toBe('src/main.ts');
      expect(data.nodes[1].name).toBe('helper');
      expect(data.nodes[1].label).toBe('Function');
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].type).toBe('CALLS');
      expect(data.edges[0].sourceId).toBe(1);
      expect(data.edges[0].targetId).toBe(2);

      traceSpy.mockRestore();
    });

    it('builds call graph with single node and no edges', async () => {
      engine.setProjectId('test-project');
      const traceSpy = vi.spyOn(engine, 'traceCallPath').mockResolvedValue([
        { name: 'singleFunc', filePath: 'src/single.ts' },
      ]);

      const data = await logic.getGraphData('singleFunc');

      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].name).toBe('singleFunc');
      expect(data.edges).toHaveLength(0);

      traceSpy.mockRestore();
    });

    it('handles search error in buildSummaryGraph gracefully', async () => {
      engine.setProjectId('test-project');
      const searchSpy = vi.spyOn(engine, 'search').mockRejectedValue(new Error('search failed'));

      const data = await logic.getGraphData();

      expect(data.nodes).toEqual([]);
      expect(data.edges).toEqual([]);

      searchSpy.mockRestore();
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
