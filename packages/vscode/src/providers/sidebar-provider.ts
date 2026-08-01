// @code-analyzer/vscode — Sidebar Provider
// WebviewView provider that renders a message-based tabbed sidebar UI.
// VS Code integration is handled by extension.ts through DI.

import type { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// SidebarLogic — testable pure logic
// ---------------------------------------------------------------------------

export interface SidebarMessage {
  command: string;
  [key: string]: unknown;
}

export interface SidebarResponse {
  command: string;
  [key: string]: unknown;
}

export class SidebarLogic {
  constructor(private engine: EngineBridge) {}

  /**
   * Handle a message from the webview and return the response.
   */
  async handleMessage(message: SidebarMessage): Promise<SidebarResponse> {
    switch (message.command) {
      case 'search': {
        const query = (message['query'] as string) ?? '';
        const results = await this.engine.search(query);
        return { command: 'searchResults', results };
      }
      case 'review': {
        const comments = await this.engine.reviewWorkspace();
        return { command: 'reviewResults', comments };
      }
      case 'checkStandards': {
        const filePath = (message['filePath'] as string) ?? '';
        const results = await this.engine.checkStandards(filePath);
        return { command: 'standardsResults', results };
      }
      case 'getChangedFiles': {
        const files = await this.engine.getChangedFiles();
        return { command: 'changedFilesResults', files };
      }
      case 'getProjectInfo': {
        const state = this.engine.getIndexingState();
        return {
          command: 'projectInfo',
          projectId: this.engine.getProjectId(),
          symbolCount: state.symbolCount,
          status: state.status,
          progress: state.progress,
        };
      }
      case 'getGraphData': {
        const rootSymbol = (message['rootSymbol'] as string) ?? undefined;
        // Query store for nodes and edges
        const projectId = this.engine.getProjectId();
        if (!projectId) {
          return { command: 'graphData', nodes: [], edges: [] };
        }
        try {
          const related = rootSymbol
            ? await this.engine.traceCallPath(rootSymbol)
            : [];
          return {
            command: 'graphData',
            nodes: related.map((r, i) => ({
              id: i + 1,
              name: r.name,
              label: 'Function',
              filePath: r.filePath,
            })),
            edges: related.length > 1
              ? related.slice(1).map((_, i) => ({
                  sourceId: i + 1,
                  targetId: i + 2,
                  type: 'CALLS',
                }))
              : [],
          };
        } catch {
          return { command: 'graphData', nodes: [], edges: [] };
        }
      }
      case 'navigate': {
        const filePath = (message['filePath'] as string) ?? '';
        return { command: 'navigate', filePath };
      }
      default:
        return { command: 'error', message: `Unknown command: ${message.command}` };
    }
  }
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

/**
 * Generate the HTML for the sidebar webview.
 * Uses a message-based architecture with tabbed UI (no React dependency).
 */
export function generateSidebarHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Analyzer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-sideBar-background, #252526);
      padding: 0;
      overflow: hidden;
      height: 100vh;
    }
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-sideBar-border, #333);
      background: var(--vscode-sideBar-background, #252526);
    }
    .tab-btn {
      flex: 1;
      padding: 8px 6px;
      background: none;
      border: none;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      font-size: 12px;
      border-bottom: 2px solid transparent;
      transition: border-color 0.15s;
    }
    .tab-btn:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .tab-btn.active {
      border-bottom-color: var(--vscode-focusBorder, #007acc);
      font-weight: 600;
    }
    .tab-content {
      display: none;
      padding: 12px;
      overflow-y: auto;
      height: calc(100vh - 41px);
    }
    .tab-content.active {
      display: block;
    }
    input[type="text"] {
      width: 100%;
      padding: 6px 8px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      margin-bottom: 8px;
      font-size: 13px;
    }
    input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
    }
    button {
      padding: 6px 12px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .results {
      margin-top: 8px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }
    .result-item {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-sideBar-border, #333);
      cursor: pointer;
    }
    .result-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .result-name {
      font-weight: 600;
    }
    .result-detail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-top: 2px;
    }
    .result-icon {
      display: inline-block;
      width: 14px;
      margin-right: 4px;
      text-align: center;
    }
    .button-row {
      margin-bottom: 12px;
    }
    .status {
      margin-top: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
    }
    .status.error {
      color: var(--vscode-errorForeground, #f48771);
    }
    .status.success {
      color: var(--vscode-terminal-ansiGreen, #4ec9b0);
    }
    .loading {
      display: none;
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground, #999);
    }
    .loading.visible {
      display: block;
    }
    .empty-state {
      display: none;
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground, #999);
      font-size: 12px;
    }
    .empty-state.visible {
      display: block;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--vscode-descriptionForeground, #999);
      border-top-color: var(--vscode-focusBorder, #007acc);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .severity-critical { color: #f44747; }
    .severity-high { color: #e2a23b; }
    .severity-medium { color: #4ec9b0; }
    .severity-low { color: #569cd6; }
    .severity-info { color: #808080; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
    }
    .info-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
    }
    .info-value {
      font-size: 13px;
      font-weight: 600;
    }
    .graph-controls {
      margin-bottom: 8px;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .graph-controls button {
      font-size: 11px;
      padding: 4px 8px;
    }
    .graph-canvas-wrap {
      position: relative;
      border: 1px solid var(--vscode-sideBar-border, #333);
      border-radius: 4px;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    canvas {
      display: block;
      cursor: grab;
    }
    canvas:active {
      cursor: grabbing;
    }
    .detail-panel {
      display: none;
      position: absolute;
      top: 8px;
      right: 8px;
      max-width: 220px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-sideBar-border, #333);
      border-radius: 4px;
      padding: 10px;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 10;
    }
    .detail-panel.visible {
      display: block;
    }
    .detail-panel .close-btn {
      position: absolute;
      top: 4px;
      right: 8px;
      background: none;
      border: none;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      font-size: 16px;
      padding: 0;
      margin: 0;
    }
    .graph-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="search" onclick="switchTab('search')">Search</button>
    <button class="tab-btn" data-tab="review" onclick="switchTab('review')">Review</button>
    <button class="tab-btn" data-tab="graph" onclick="switchTab('graph')">Graph</button>
    <button class="tab-btn" data-tab="info" onclick="switchTab('info')">Info</button>
  </div>

  <!-- Search Tab -->
  <div id="tab-search" class="tab-content active">
    <input id="q" type="text" placeholder="Search symbols... (Ctrl+F)" onkeydown="if(event.key==='Enter')runSearch()" />
    <div class="button-row">
      <button onclick="runSearch()">Search</button>
    </div>
    <div id="search-loading" class="loading"><span class="spinner"></span>Searching...</div>
    <div id="search-empty" class="empty-state">No results found. Try a different query.</div>
    <div id="search-error" class="status error" style="display:none"></div>
    <div class="status" id="search-status"></div>
    <div class="results" id="search-results"></div>
  </div>

  <!-- Review Tab -->
  <div id="tab-review" class="tab-content">
    <div class="button-row">
      <button id="btn-review" onclick="runReview()">Review Changes</button>
      <button id="btn-review-files" onclick="getChangedFiles()" class="secondary">Changed Files</button>
    </div>
    <div id="review-loading" class="loading"><span class="spinner"></span>Reviewing...</div>
    <div id="review-empty" class="empty-state">No issues found. Your code looks good!</div>
    <div id="review-error" class="status error" style="display:none"></div>
    <div class="status" id="review-status"></div>
    <div class="results" id="review-results"></div>
  </div>

  <!-- Graph Explorer Tab -->
  <div id="tab-graph" class="tab-content">
    <div class="graph-hint">Scroll to zoom, drag to pan, click a node for details</div>
    <div class="graph-controls">
      <button onclick="graphZoomIn()" title="Zoom In">+</button>
      <button onclick="graphZoomOut()" title="Zoom Out">−</button>
      <button onclick="graphReset()" title="Reset View">Reset</button>
    </div>
    <div class="graph-canvas-wrap" id="graph-wrap">
      <canvas id="graph-canvas"></canvas>
      <div class="detail-panel" id="graph-detail">
        <button class="close-btn" onclick="closeDetail()">×</button>
        <div id="graph-detail-content"></div>
      </div>
    </div>
    <div id="graph-loading" class="loading"><span class="spinner"></span>Loading graph...</div>
    <div id="graph-empty" class="empty-state">No graph data available. Run analysis first.</div>
  </div>

  <!-- Project Info Tab -->
  <div id="tab-info" class="tab-content">
    <h3 style="margin-bottom:12px">Project Info</h3>
    <div id="info-loading" class="loading"><span class="spinner"></span>Loading...</div>
    <div id="info-content" style="display:none">
      <div class="info-grid">
        <div class="info-label">Project ID</div>
        <div class="info-value" id="info-project-id">-</div>
        <div class="info-label">Status</div>
        <div class="info-value" id="info-status">-</div>
        <div class="info-label">Symbols</div>
        <div class="info-value" id="info-symbols">-</div>
        <div class="info-label">Progress</div>
        <div class="info-value" id="info-progress">-</div>
      </div>
      <button onclick="getProjectInfo()" class="secondary" style="margin-top:16px">Refresh</button>
    </div>
  </div>

  <script>
    (function() {
      var vscode = acquireVsCodeApi();

      // ---- Tab Switching ----
      window.switchTab = function(name) {
        var tabs = document.querySelectorAll('.tab-content');
        var btns = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabs.length; i++) {
          tabs[i].classList.remove('active');
        }
        for (var j = 0; j < btns.length; j++) {
          btns[j].classList.remove('active');
        }
        var target = document.getElementById('tab-' + name);
        var targetBtn = document.querySelector('[data-tab="' + name + '"]');
        if (target) target.classList.add('active');
        if (targetBtn) targetBtn.classList.add('active');

        // Load data when switching tabs
        if (name === 'graph') loadGraph();
        if (name === 'info') getProjectInfo();
      };

      // ---- Keyboard Shortcuts ----
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          switchTab('search');
          document.getElementById('q').focus();
        }
      });

      // ---- Search ----
      window.runSearch = function() {
        var q = document.getElementById('q').value;
        if (!q) return;
        showLoading('search');
        hideEmpty('search');
        hideError('search');
        document.getElementById('search-results').innerHTML = '';
        vscode.postMessage({ command: 'search', query: q });
      };

      // ---- Review ----
      window.runReview = function() {
        document.getElementById('btn-review').disabled = true;
        showLoading('review');
        hideEmpty('review');
        hideError('review');
        document.getElementById('review-results').innerHTML = '';
        vscode.postMessage({ command: 'review' });
      };

      window.getChangedFiles = function() {
        showLoading('review');
        hideEmpty('review');
        document.getElementById('review-results').innerHTML = '';
        vscode.postMessage({ command: 'getChangedFiles' });
      };

      // ---- Project Info ----
      window.getProjectInfo = function() {
        showLoading('info');
        document.getElementById('info-content').style.display = 'none';
        vscode.postMessage({ command: 'getProjectInfo' });
      };

      // ---- Graph ----
      var graphState = {
        nodes: [],
        edges: [],
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        selectedNode: null,
      };

      function loadGraph() {
        var canvas = document.getElementById('graph-canvas');
        if (!canvas || canvas.width > 0 && graphState.nodes.length > 0) return;
        showLoading('graph');
        hideEmpty('graph');
        vscode.postMessage({ command: 'getGraphData' });
      }

      window.graphZoomIn = function() {
        graphState.scale = Math.min(3, graphState.scale * 1.2);
        drawGraph();
      };

      window.graphZoomOut = function() {
        graphState.scale = Math.max(0.2, graphState.scale * 0.8);
        drawGraph();
      };

      window.graphReset = function() {
        graphState.scale = 1;
        graphState.offsetX = 0;
        graphState.offsetY = 0;
        initLayout();
        drawGraph();
      };

      window.closeDetail = function() {
        graphState.selectedNode = null;
        document.getElementById('graph-detail').classList.remove('visible');
        drawGraph();
      };

      function initLayout() {
        var nodes = graphState.nodes;
        var cx = 150, cy = 150, radius = 120;
        for (var i = 0; i < nodes.length; i++) {
          var angle = (2 * Math.PI * i) / Math.max(1, nodes.length);
          nodes[i].x = cx + radius * Math.cos(angle);
          nodes[i].y = cy + radius * Math.sin(angle);
        }
        // Run simple force simulation
        for (var iter = 0; iter < 100; iter++) {
          forceStep();
        }
      }

      function forceStep() {
        var nodes = graphState.nodes;
        var edges = graphState.edges;
        var repulsion = 5000;
        var attraction = 0.01;
        var damping = 0.9;

        // Repulsion between all node pairs
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].vx = 0;
          nodes[i].vy = 0;
        }
        for (var i = 0; i < nodes.length; i++) {
          for (var j = i + 1; j < nodes.length; j++) {
            var dx = nodes[j].x - nodes[i].x;
            var dy = nodes[j].y - nodes[i].y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            var force = repulsion / (dist * dist);
            var fx = (dx / dist) * force;
            var fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }
        // Attraction along edges
        for (var e = 0; e < edges.length; e++) {
          var src = nodes[edges[e].sourceId - 1];
          var tgt = nodes[edges[e].targetId - 1];
          if (!src || !tgt) continue;
          var dx2 = tgt.x - src.x;
          var dy2 = tgt.y - src.y;
          var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
          var fx2 = dx2 * attraction;
          var fy2 = dy2 * attraction;
          src.vx += fx2;
          src.vy += fy2;
          tgt.vx -= fx2;
          tgt.vy -= fy2;
        }
        // Apply velocities with damping
        for (var k = 0; k < nodes.length; k++) {
          nodes[k].x += nodes[k].vx * damping;
          nodes[k].y += nodes[k].vy * damping;
        }
      }

      function getNodeColor(label) {
        var colors = {
          'Project': '#c586c0', 'Package': '#c586c0', 'Folder': '#c586c0',
          'File': '#c586c0', 'Module': '#c586c0',
          'Class': '#4ec9b0', 'Interface': '#9cdcfe', 'Function': '#569cd6',
          'Method': '#dcdcaa', 'Constructor': '#dcdcaa', 'Property': '#dcdcaa',
          'Enum': '#ce9178', 'TypeAlias': '#ce9178', 'Struct': '#ce9178',
          'Trait': '#ce9178', 'Variable': '#6a9955',
          'Route': '#d16969', 'Tool': '#d16969', 'Component': '#d16969',
          'Test': '#4fc1ff', 'Community': '#b5cea8', 'Process': '#b5cea8',
          'Config': '#808080', 'ADR': '#808080',
          'BasicBlock': '#e0e0e0', 'InfraResource': '#e0e0e0',
          'CrossRepoFunction': '#c586c0', 'CrossRepoInterface': '#c586c0',
          'CrossRepoModule': '#c586c0', 'Contract': '#e2a23b',
          'Event': '#e2a23b', 'DataSource': '#f44747', 'Sink': '#f44747'
        };
        return colors[label] || '#808080';
      }

      function drawGraph() {
        var canvas = document.getElementById('graph-canvas');
        if (!canvas) return;
        var wrap = document.getElementById('graph-wrap');
        var w = wrap.clientWidth;
        var h = Math.max(300, wrap.clientHeight);
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        var nodes = graphState.nodes;
        var edges = graphState.edges;
        var s = graphState.scale;
        var ox = graphState.offsetX;
        var oy = graphState.offsetY;
        var selected = graphState.selectedNode;

        ctx.save();
        ctx.translate(w / 2 + ox, h / 2 + oy);
        ctx.scale(s, s);

        // Draw edges
        ctx.strokeStyle = 'rgba(150, 150, 150, 0.4)';
        ctx.lineWidth = 1;
        for (var i = 0; i < edges.length; i++) {
          var src = nodes[edges[i].sourceId - 1];
          var tgt = nodes[edges[i].targetId - 1];
          if (!src || !tgt) continue;
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.stroke();
        }

        // Draw nodes
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          var r = selected && selected.id === n.id ? 10 : 7;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = getNodeColor(n.label);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Label
          ctx.fillStyle = 'var(--vscode-foreground, #ccc)';
          ctx.font = '10px sans-serif';
          ctx.fillStyle = '#ccc';
          ctx.textAlign = 'center';
          ctx.fillText(n.name.substring(0, 15), n.x, n.y + r + 12);
        }

        ctx.restore();
      }

      // Graph canvas mouse events
      function setupGraphCanvas() {
        var canvas = document.getElementById('graph-canvas');
        if (!canvas) return;

        canvas.addEventListener('mousedown', function(e) {
          graphState.dragging = true;
          graphState.dragStartX = e.clientX - graphState.offsetX;
          graphState.dragStartY = e.clientY - graphState.offsetY;
        });

        canvas.addEventListener('mousemove', function(e) {
          if (!graphState.dragging) return;
          graphState.offsetX = e.clientX - graphState.dragStartX;
          graphState.offsetY = e.clientY - graphState.dragStartY;
          drawGraph();
        });

        canvas.addEventListener('mouseup', function(e) {
          if (!graphState.dragging) return;
          graphState.dragging = false;
          // If minimal drag, treat as click
          var dx = e.clientX - graphState.dragStartX - graphState.offsetX;
          var dy = e.clientY - graphState.dragStartY - graphState.offsetY;
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            handleGraphClick(e);
          }
        });

        canvas.addEventListener('wheel', function(e) {
          e.preventDefault();
          var delta = e.deltaY > 0 ? 0.9 : 1.1;
          graphState.scale = Math.max(0.2, Math.min(3, graphState.scale * delta));
          drawGraph();
        });
      }

      function handleGraphClick(e) {
        var canvas = document.getElementById('graph-canvas');
        var w = canvas.width, h = canvas.height;
        var s = graphState.scale;
        var ox = graphState.offsetX;
        var oy = graphState.offsetY;
        var mx = (e.offsetX - w / 2 - ox) / s;
        var my = (e.offsetY - h / 2 - oy) / s;

        var nodes = graphState.nodes;
        var hitRadius = 10;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var dx = mx - n.x;
          var dy = my - n.y;
          if (dx * dx + dy * dy < hitRadius * hitRadius) {
            graphState.selectedNode = n;
            showNodeDetail(n);
            drawGraph();
            return;
          }
        }
        closeDetail();
      }

      function showNodeDetail(node) {
        var panel = document.getElementById('graph-detail');
        var content = document.getElementById('graph-detail-content');
        content.innerHTML =
          '<div style="font-weight:600;margin-bottom:4px">' + escapeHtml(node.name) + '</div>' +
          '<div style="color:var(--vscode-descriptionForeground,#999);font-size:11px">Type: ' + escapeHtml(node.label) + '</div>' +
          '<div style="color:var(--vscode-descriptionForeground,#999);font-size:11px;margin-top:4px">' + escapeHtml(node.filePath || '') + '</div>';
        panel.classList.add('visible');
      }

      // ---- Message Handler ----
      window.addEventListener('message', function(e) {
        var data = e.data;
        document.getElementById('btn-review').disabled = false;

        switch (data.command) {
          case 'searchResults':
            hideLoading('search');
            renderSearchResults(data.results || []);
            break;

          case 'reviewResults':
            hideLoading('review');
            renderReviewResults(data.comments || []);
            break;

          case 'changedFilesResults':
            hideLoading('review');
            renderChangedFiles(data.files || []);
            break;

          case 'projectInfo':
            hideLoading('info');
            document.getElementById('info-content').style.display = 'block';
            document.getElementById('info-project-id').textContent = data.projectId || 'Not set';
            document.getElementById('info-status').textContent = data.status || 'unknown';
            document.getElementById('info-symbols').textContent = data.symbolCount || '0';
            document.getElementById('info-progress').textContent = (data.progress || 0) + '%';
            break;

          case 'graphData':
            hideLoading('graph');
            graphState.nodes = data.nodes || [];
            graphState.edges = data.edges || [];
            if (graphState.nodes.length === 0) {
              showEmpty('graph');
            } else {
              hideEmpty('graph');
              initLayout();
              drawGraph();
            }
            break;

          case 'navigate':
            // File path navigation is handled by the host
            break;

          case 'error':
            break;
        }
      });

      // ---- Render Helpers ----
      function renderSearchResults(results) {
        var html = '';
        if (results.length > 0) {
          for (var i = 0; i < results.length; i++) {
            var r = results[i];
            html += '<div class="result-item" onclick="navigateTo(\'' + escapeAttr(r.filePath) + '\')">' +
              '<div class="result-name"><span class="result-icon">' + typeIcon(r.label) + '</span>' + escapeHtml(r.name) + '</div>' +
              '<div class="result-detail">' + escapeHtml(r.filePath) + ' (' + escapeHtml(r.label) + ')</div></div>';
          }
        } else {
          showEmpty('search');
        }
        document.getElementById('search-results').innerHTML = html;
        document.getElementById('search-status').textContent = 'Found ' + results.length + ' result(s)';
      }

      function renderReviewResults(comments) {
        var html = '';
        if (comments.length > 0) {
          html = '<h4 style="margin-bottom:8px">Findings (' + comments.length + ')</h4>';
          for (var i = 0; i < comments.length; i++) {
            var c = comments[i];
            var sevClass = 'severity-' + (c.severity || 'info');
            html += '<div class="result-item" onclick="navigateTo(\'' + escapeAttr(c.path) + '\')">' +
              '<div class="result-name"><span class="' + sevClass + '">' + escapeHtml(c.severity || 'info') + '</span></div>' +
              '<div class="result-detail">' + escapeHtml(c.title || c.message) + '<br/>' +
              escapeHtml(c.path) + ':' + (c.startLine || 0) + '</div></div>';
          }
        } else {
          showEmpty('review');
        }
        document.getElementById('review-results').innerHTML = html;
        document.getElementById('review-status').textContent = 'Found ' + comments.length + ' issue(s)';
      }

      function renderChangedFiles(files) {
        var html = '';
        if (files.length > 0) {
          html = '<h4 style="margin-bottom:8px">Changed Files (' + files.length + ')</h4>';
          for (var i = 0; i < files.length; i++) {
            var f = files[i];
            html += '<div class="result-item" onclick="navigateTo(\'' + escapeAttr(f.path) + '\')">' +
              '<div class="result-name">' + escapeHtml(f.path) + '</div>' +
              '<div class="result-detail">' + escapeHtml(f.status) + '</div></div>';
          }
        } else {
          showEmpty('review');
        }
        document.getElementById('review-results').innerHTML = html;
        document.getElementById('review-status').textContent = '';
      }

      // ---- Utilities ----
      window.navigateTo = function(filePath) {
        vscode.postMessage({ command: 'navigate', filePath: filePath });
      };

      function showLoading(tab) {
        var el = document.getElementById(tab + '-loading');
        if (el) el.classList.add('visible');
      }

      function hideLoading(tab) {
        var el = document.getElementById(tab + '-loading');
        if (el) el.classList.remove('visible');
      }

      function showEmpty(tab) {
        var el = document.getElementById(tab + '-empty');
        if (el) el.classList.add('visible');
      }

      function hideEmpty(tab) {
        var el = document.getElementById(tab + '-empty');
        if (el) el.classList.remove('visible');
      }

      function showError(tab, msg) {
        var el = document.getElementById(tab + '-error');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
      }

      function hideError(tab) {
        var el = document.getElementById(tab + '-error');
        if (el) el.style.display = 'none';
      }

      function typeIcon(label) {
        var icons = {
          'Function': 'ƒ', 'Class': 'C', 'Interface': 'I', 'Method': 'M',
          'Module': '□', 'Variable': 'v', 'Enum': 'E', 'TypeAlias': 'T',
          'Property': 'p', 'Constructor': '⊕', 'File': '📄', 'Route': '↗',
          'Test': '✓', 'Struct': 'S', 'Trait': 'τ', 'Component': '⬡'
        };
        return icons[label] || '●';
      }

      function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
      }

      function escapeAttr(text) {
        if (!text) return '';
        return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"');
      }

      // Initialize graph canvas on load
      setupGraphCanvas();

      // Load project info on start
      getProjectInfo();
    })();
  </script>
</body>
</html>`;
}
