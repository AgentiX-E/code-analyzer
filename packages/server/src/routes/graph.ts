// @code-analyzer/server — Graph Visualization Routes
// Serves an interactive D3.js force-directed graph visualization
// and a JSON data API backed by InMemoryGraphStore.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../server-config.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { NodeLabel, GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphDataQuery {
  projectId?: string;
  limit?: number;
  label?: string;
  search?: string;
}

interface GraphNodeDTO {
  id: string;
  name: string;
  label: NodeLabel;
  projectId: string;
  filePath: string | null;
  complexity: number | null;
}

interface GraphEdgeDTO {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
}

interface GraphDataResponse {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    filteredNodes: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNodeDTO(node: GraphNode): GraphNodeDTO {
  return {
    id: `n${node.id}`,
    name: node.name,
    label: node.label,
    projectId: node.projectId,
    filePath: node.filePath,
    complexity: node.complexity,
  };
}

function isCrossRepoEdge(edge: GraphEdge): boolean {
  return edge.type.startsWith('CROSS_REPO_');
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register graph visualization and data API routes.
 *
 * GET /graph      — serves the interactive D3.js visualization HTML page
 * GET /graph/data — returns graph nodes and edges as JSON with filtering
 */
export function registerGraphRoutes(
  app: FastifyInstance,
  _config: ServerConfig,
  getStore: () => InMemoryGraphStore,
): void {
  // --- HTML page endpoint ---
  app.get('/graph', async (_req, reply) => {
    return reply.type('text/html; charset=utf-8').send(buildGraphHtml());
  });

  // --- JSON data endpoint ---
  app.get('/graph/data', async (request: FastifyRequest, reply) => {
    const query = request.query as GraphDataQuery;
    const store = getStore();

    const limit = Math.min(Math.max(1, parseInt(String(query.limit ?? '500'), 10) || 500), 5000);

    const totalNodes = store.getNodeCount();
    const totalEdges = store.getEdgeCount();

    // If no projectId is provided, return empty results with stats
    if (!query.projectId) {
      return reply.status(200).send({
        nodes: [],
        edges: [],
        stats: { totalNodes, totalEdges, filteredNodes: 0 },
      });
    }

    // Collect all nodes matching the projectId
    const allNodesForProject: GraphNode[] = [];
    for (const node of store.nodes.values()) {
      const gNode = store.getNode(node.id);
      if (gNode && gNode.projectId === query.projectId) {
        allNodesForProject.push(gNode);
      }
    }

    // Apply label filter
    let filteredNodes = allNodesForProject;
    if (query.label) {
      const labels = query.label
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      if (labels.length > 0) {
        filteredNodes = filteredNodes.filter((n) => labels.includes(n.label));
      }
    }

    // Apply search filter
    if (query.search) {
      const term = query.search.toLowerCase();
      filteredNodes = filteredNodes.filter(
        (n) => n.name.toLowerCase().includes(term) || n.qualifiedName.toLowerCase().includes(term),
      );
    }

    // Limit results
    const nodes = filteredNodes.slice(0, limit);
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Collect edges where both source and target are in the filtered node set
    const edges: GraphEdgeDTO[] = [];
    for (const edge of store.edges.values()) {
      const gEdge: GraphEdge = {
        id: edge.id,
        projectId: edge.projectId,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        properties: { ...edge.properties },
        weight: edge.weight,
        createdAt: edge.createdAt,
      };
      if (nodeIds.has(gEdge.sourceId) && nodeIds.has(gEdge.targetId)) {
        edges.push({
          id: `e${gEdge.id}`,
          sourceId: `n${gEdge.sourceId}`,
          targetId: `n${gEdge.targetId}`,
          type: isCrossRepoEdge(gEdge) ? 'CROSS_REPO' : gEdge.type,
        });
      }
    }

    const response: GraphDataResponse = {
      nodes: nodes.map(toNodeDTO),
      edges,
      stats: {
        totalNodes,
        totalEdges,
        filteredNodes: nodes.length,
      },
    };

    return reply.status(200).send(response);
  });
}

// ---------------------------------------------------------------------------
// HTML Template — Self-contained D3.js force-directed graph visualization
// ---------------------------------------------------------------------------

function buildGraphHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Analyzer — Graph Visualization</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  #toolbar {
    background: #161b22;
    border-bottom: 1px solid #30363d;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  #toolbar label { font-size: 12px; color: #8b949e; }
  #toolbar input, #toolbar select {
    background: #0d1117;
    border: 1px solid #30363d;
    color: #c9d1d9;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  #toolbar input:focus, #toolbar select:focus {
    outline: none;
    border-color: #58a6ff;
  }
  #search { width: 200px; }
  #projectId { width: 180px; }
  #stats {
    margin-left: auto;
    font-size: 12px;
    color: #8b949e;
    display: flex;
    gap: 16px;
  }
  #main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  #graph-container {
    flex: 1;
    position: relative;
  }
  #graph-container svg { width: 100%; height: 100%; }
  #panel {
    width: 300px;
    background: #161b22;
    border-left: 1px solid #30363d;
    overflow-y: auto;
    padding: 16px;
    flex-shrink: 0;
    display: none;
  }
  #panel.visible { display: block; }
  #panel h3 { font-size: 14px; margin-bottom: 12px; color: #58a6ff; }
  #panel .field { margin-bottom: 8px; font-size: 12px; }
  #panel .field .key { color: #8b949e; }
  #panel .field .value { color: #c9d1d9; word-break: break-all; }
  #panel .field .value.path { font-family: monospace; font-size: 11px; }
  #filter-panel {
    position: absolute;
    top: 12px;
    left: 12px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 12px;
    max-height: 60vh;
    overflow-y: auto;
    font-size: 12px;
    z-index: 10;
    min-width: 180px;
  }
  #filter-panel h4 { margin-bottom: 8px; color: #8b949e; }
  #filter-panel label { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; cursor: pointer; }
  #filter-panel label input { cursor: pointer; }
  #legend {
    position: absolute;
    top: 12px;
    right: 12px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 12px;
    font-size: 11px;
    z-index: 10;
  }
  #legend h4 { margin-bottom: 6px; color: #8b949e; }
  #legend .legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  #legend .legend-swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .tooltip {
    position: absolute;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    pointer-events: none;
    z-index: 20;
    display: none;
    max-width: 250px;
    word-break: break-all;
  }
  .node { cursor: pointer; }
  .node.highlighted { stroke: #f0f6fc; stroke-width: 3px; }
  .node.dimmed { opacity: 0.15; }
  .edge { stroke-opacity: 0.3; }
  .edge.dimmed { opacity: 0.05; }
  .edge.highlighted { stroke-opacity: 0.8; }
  .edge.cross-repo { stroke-dasharray: 6 3; stroke: #ff7b72; stroke-opacity: 0.7; }
  @media (max-width: 768px) {
    #panel { width: 100%; position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; }
    #filter-panel { max-height: 40vh; }
    #legend { max-height: 30vh; overflow-y: auto; }
    #toolbar { padding: 6px 8px; gap: 6px; }
    #search, #projectId { width: 130px; }
  }
</style>
</head>
<body>
<div id="toolbar">
  <label>Project ID</label>
  <input type="text" id="projectId" placeholder="e.g. org/repo" />
  <label>Search</label>
  <input type="text" id="search" placeholder="Node name..." />
  <label>Limit</label>
  <select id="limit">
    <option value="100">100</option>
    <option value="500" selected>500</option>
    <option value="1000">1000</option>
    <option value="5000">5000</option>
  </select>
  <button id="loadBtn" style="background:#238636;border:none;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:13px;">Load</button>
  <div id="stats">
    <span>Nodes: <strong id="statNodes">0</strong></span>
    <span>Edges: <strong id="statEdges">0</strong></span>
    <span>Total: <strong id="statTotal">0</strong></span>
  </div>
</div>
<div id="main">
  <div id="graph-container">
    <svg></svg>
    <div class="tooltip" id="tooltip"></div>
    <div id="filter-panel">
      <h4>Node Types</h4>
      <div id="typeFilters"></div>
    </div>
    <div id="legend">
      <h4>Legend</h4>
      <div id="legendItems"></div>
      <div style="margin-top:6px;font-size:10px;color:#8b949e;">
        <span style="border-left:2px dashed #ff7b72;padding-left:4px;">Cross-repo</span>
      </div>
    </div>
  </div>
  <div id="panel">
    <h3 id="panelName"></h3>
    <div class="field"><span class="key">Type:</span> <span class="value" id="panelType"></span></div>
    <div class="field"><span class="key">Project:</span> <span class="value" id="panelProject"></span></div>
    <div class="field"><span class="key">Path:</span> <span class="value path" id="panelPath"></span></div>
    <div class="field"><span class="key">Complexity:</span> <span class="value" id="panelComplexity"></span></div>
    <div class="field"><span class="key">Connected Edges:</span> <span class="value" id="panelEdges"></span></div>
    <hr style="border-color:#30363d;margin:12px 0;" />
    <div class="field"><span class="key">Edge List:</span></div>
    <div id="panelEdgeList" style="font-size:11px;max-height:200px;overflow-y:auto;"></div>
    <button id="closePanel" style="margin-top:12px;background:#30363d;border:none;color:#c9d1d9;padding:4px 12px;border-radius:6px;cursor:pointer;">Close</button>
  </div>
</div>

<script>
// ── Color palette for node labels ──
const COLOR_MAP = {
  Class: '#58a6ff', Interface: '#a371f7', Function: '#3fb950',
  Method: '#56d364', Constructor: '#7ee787', Property: '#d2a8ff',
  Enum: '#f97316', TypeAlias: '#e879f9', Struct: '#f0c421',
  Trait: '#db6d28', Variable: '#79c0ff', Module: '#a5d6ff',
  File: '#8b949e', Folder: '#6e7681', Package: '#c9d1d9',
  Project: '#f0f6fc', Component: '#ffa198', Route: '#ff7b72',
  Tool: '#d2a8ff', Test: '#7ee787', Config: '#e3b341',
  Process: '#56d364', Community: '#a371f7', ADR: '#f0c421',
  BasicBlock: '#8b949e', Event: '#f97316',
  DataSource: '#79c0ff', Sink: '#ff7b72',
  Contract: '#e879f9', CrossRepoFunction: '#f0c421',
  CrossRepoInterface: '#db6d28', CrossRepoModule: '#a371f7',
  InfraResource: '#8b949e', DockerImage: '#58a6ff',
  K8sResource: '#3fb950', TerraformResource: '#7ee787'
};

const LABEL_ORDER = Object.keys(COLOR_MAP);

// Build legend
const legendEl = document.getElementById('legendItems');
LABEL_ORDER.forEach(label => {
  const div = document.createElement('div');
  div.className = 'legend-item';
  div.innerHTML = '<span class="legend-swatch" style="background:' + COLOR_MAP[label] + '"></span>' + label;
  legendEl.appendChild(div);
});

// ── State ──
let currentData = { nodes: [], edges: [], stats: { totalNodes: 0, totalEdges: 0, filteredNodes: 0 } };
let hiddenTypes = new Set();
let searchTerm = '';

// ── SVG setup ──
const container = document.getElementById('graph-container');
const svg = d3.select('#graph-container svg');
const width = () => container.clientWidth;
const height = () => container.clientHeight;

// Defs for arrow markers
const defs = svg.append('defs');
defs.append('marker')
  .attr('id', 'arrowhead')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 18)
  .attr('refY', 0)
  .attr('markerWidth', 6)
  .attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#8b949e');

defs.append('marker')
  .attr('id', 'arrowhead-cross')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 18)
  .attr('refY', 0)
  .attr('markerWidth', 6)
  .attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#ff7b72');

const g = svg.append('g');

// Zoom behavior
const zoom = d3.zoom()
  .scaleExtent([0.1, 4])
  .on('zoom', (event) => { g.attr('transform', event.transform); });
svg.call(zoom);

// ── Simulation ──
let simulation;

function initSimulation() {
  simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width() / 2, height() / 2))
    .force('collision', d3.forceCollide().radius(20))
    .alphaDecay(0.02);
}

// ── Render ──
function render(data) {
  currentData = data;
  updateStats();

  // Filter by type visibility
  let visibleNodes = data.nodes.filter(n => !hiddenTypes.has(n.label));
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

  // Apply search highlight
  if (searchTerm) {
    visibleNodes = visibleNodes.filter(n => n.name.toLowerCase().includes(searchTerm));
  }

  const visibleEdges = data.edges.filter(
    e => visibleNodeIds.has(e.sourceId) && visibleNodeIds.has(e.targetId)
  );

  svg.attr('viewBox', null);

  // Update simulation
  if (!simulation) initSimulation();

  // Edges
  const edgeGroup = g.selectAll('.edge-group').data([1]);
  edgeGroup.enter().append('g').attr('class', 'edge-group');

  const edgeSel = g.select('.edge-group').selectAll('line.edge')
    .data(visibleEdges, d => d.id);

  edgeSel.exit().remove();

  const edgeEnter = edgeSel.enter().append('line')
    .attr('class', d => d.type === 'CROSS_REPO' ? 'edge cross-repo' : 'edge')
    .attr('marker-end', d => d.type === 'CROSS_REPO' ? 'url(#arrowhead-cross)' : 'url(#arrowhead)');

  const edgeMerge = edgeEnter.merge(edgeSel);

  // Nodes
  const nodeSel = g.selectAll('g.node')
    .data(visibleNodes, d => d.id);

  nodeSel.exit().remove();

  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
    );

  nodeEnter.append('circle')
    .attr('r', 6)
    .attr('fill', d => COLOR_MAP[d.label] || '#8b949e')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 1);

  nodeEnter.append('text')
    .attr('dx', 10)
    .attr('dy', 4)
    .attr('fill', '#c9d1d9')
    .attr('font-size', '10px')
    .attr('font-family', 'monospace')
    .text(d => d.name.length > 25 ? d.name.slice(0, 25) + '...' : d.name);

  const nodeMerge = nodeEnter.merge(nodeSel);

  // Click handler
  nodeMerge.on('click', (event, d) => {
    event.stopPropagation();
    showDetail(d);
  });

  // Hover tooltip
  nodeMerge.on('mouseenter', (event, d) => {
    const tip = document.getElementById('tooltip');
    tip.style.display = 'block';
    tip.innerHTML = '<strong>' + d.name + '</strong><br/>' + d.label + ' | ' + d.projectId;
    const rect = container.getBoundingClientRect();
    tip.style.left = (event.clientX - rect.left + 12) + 'px';
    tip.style.top = (event.clientY - rect.top - 10) + 'px';
  });

  nodeMerge.on('mouseleave', () => {
    document.getElementById('tooltip').style.display = 'none';
  });

  // Update simulation
  simulation.nodes(visibleNodes);
  simulation.force('link').links(visibleEdges);

  simulation.on('tick', () => {
    edgeMerge
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeMerge.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });

  simulation.alpha(0.5).restart();
}

// ── Detail panel ──
function showDetail(node) {
  document.getElementById('panel').classList.add('visible');
  document.getElementById('panelName').textContent = node.name;
  document.getElementById('panelType').textContent = node.label;
  document.getElementById('panelProject').textContent = node.projectId;
  document.getElementById('panelPath').textContent = node.filePath || 'N/A';
  document.getElementById('panelComplexity').textContent = node.complexity !== null ? node.complexity : 'N/A';

  const connectedEdges = currentData.edges.filter(
    e => e.sourceId === node.id || e.targetId === node.id
  );
  document.getElementById('panelEdges').textContent = connectedEdges.length;

  const edgeList = document.getElementById('panelEdgeList');
  edgeList.innerHTML = connectedEdges.slice(0, 50).map(e => {
    const dir = e.sourceId === node.id ? '→' : '←';
    const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
    const otherNode = currentData.nodes.find(n => n.id === otherId);
    const otherName = otherNode ? otherNode.name : otherId;
    return '<div style="margin-bottom:2px;">' + dir + ' <span style="color:#58a6ff">' + otherName + '</span> <span style="color:#8b949e">[' + e.type + ']</span></div>';
  }).join('');

  // Highlight connected
  const connectedIds = new Set(connectedEdges.flatMap(e => [e.sourceId, e.targetId]));
  d3.selectAll('g.node').classed('dimmed', d => d.id !== node.id && !connectedIds.has(d.id));
  d3.selectAll('g.node').classed('highlighted', d => d.id === node.id);
  d3.selectAll('line.edge').classed('dimmed', d => d.source.id !== node.id && d.target.id !== node.id);
  d3.selectAll('line.edge').classed('highlighted', d => d.source.id === node.id || d.target.id === node.id);
}

document.getElementById('closePanel').addEventListener('click', () => {
  document.getElementById('panel').classList.remove('visible');
  d3.selectAll('g.node').classed('dimmed', false).classed('highlighted', false);
  d3.selectAll('line.edge').classed('dimmed', false).classed('highlighted', false);
});

// Click on background clears selection
svg.on('click', () => {
  document.getElementById('panel').classList.remove('visible');
  d3.selectAll('g.node').classed('dimmed', false).classed('highlighted', false);
  d3.selectAll('line.edge').classed('dimmed', false).classed('highlighted', false);
});

// ── Type filter checkboxes ──
function buildTypeFilters(data) {
  const typeCounts = {};
  data.nodes.forEach(n => {
    typeCounts[n.label] = (typeCounts[n.label] || 0) + 1;
  });
  const container = document.getElementById('typeFilters');
  container.innerHTML = '';
  LABEL_ORDER.forEach(label => {
    if (!typeCounts[label]) return;
    const labelEl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) hiddenTypes.delete(label);
      else hiddenTypes.add(label);
      render(currentData);
    });
    labelEl.appendChild(cb);
    labelEl.appendChild(document.createTextNode(label + ' (' + typeCounts[label] + ')'));
    container.appendChild(labelEl);
  });
}

// ── Stats ──
function updateStats() {
  document.getElementById('statNodes').textContent = currentData.nodes.length;
  document.getElementById('statEdges').textContent = currentData.edges.length;
  document.getElementById('statTotal').textContent = currentData.stats.totalNodes;
}

// ── Load data ──
async function loadData() {
  const projectId = document.getElementById('projectId').value.trim();
  if (!projectId) { alert('Please enter a Project ID'); return; }

  const limit = document.getElementById('limit').value;
  const search = document.getElementById('search').value.trim();
  const params = new URLSearchParams({ projectId, limit });
  if (search) params.set('search', search);

  try {
    const res = await fetch('/graph/data?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    hiddenTypes.clear();
    buildTypeFilters(data);
    render(data);
  } catch (err) {
    alert('Failed to load data: ' + err.message);
  }
}

document.getElementById('loadBtn').addEventListener('click', loadData);
document.getElementById('projectId').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadData();
});
document.getElementById('search').addEventListener('input', e => {
  searchTerm = e.target.value.trim().toLowerCase();
  if (currentData.nodes.length > 0) render(currentData);
});

// ── Resize handler ──
window.addEventListener('resize', () => {
  if (simulation) {
    simulation.force('center', d3.forceCenter(width() / 2, height() / 2));
    simulation.alpha(0.1).restart();
  }
});
</script>
</body>
</html>`;
}
