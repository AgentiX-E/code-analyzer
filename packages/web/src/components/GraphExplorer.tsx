import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GraphNode {
  id: string;
  label: string;
  type: 'function' | 'class' | 'module' | 'interface';
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'import' | 'call' | 'extends' | 'implements';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface TooltipInfo {
  node: GraphNode;
  x: number;
  y: number;
  relatedEdges: GraphEdge[];
}

/* ------------------------------------------------------------------ */
/*  Colour helpers                                                     */
/* ------------------------------------------------------------------ */

const NODE_COLORS: Record<string, string> = {
  function: '#58a6ff',
  class: '#3fb950',
  module: '#a371f7',
  interface: '#d29922',
};

const EDGE_COLORS: Record<string, string> = {
  import: '#484f58',
  call: '#58a6ff',
  extends: '#3fb950',
  implements: '#a371f7',
};

/* ------------------------------------------------------------------ */
/*  Force‑directed layout                                              */
/* ------------------------------------------------------------------ */

const CENTER_FORCE = 0.002;
const REPULSION = 600;
const ATTRACTION = 0.005;
const DAMPING = 0.85;
const ITERATIONS = 200;

function simulate(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < ITERATIONS; i++) {
    // Repulsion between every pair of nodes
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a]!;
        const nb = nodes[b]!;
        let dx = nb.x - na.x;
        let dy = nb.y - na.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        na.vx -= fx;
        na.vy -= fy;
        nb.vx += fx;
        nb.vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const s = nodes.find((n) => n.id === edge.source);
      const t = nodes.find((n) => n.id === edge.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const fx = dx * ATTRACTION;
      const fy = dy * ATTRACTION;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Centering force
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER_FORCE;
      node.vy += (cy - node.y) * CENTER_FORCE;
    }

    // Apply velocity with damping
    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // Clamp to viewport
  const margin = 40;
  for (const node of nodes) {
    node.x = Math.max(margin, Math.min(width - margin, node.x));
    node.y = Math.max(margin, Math.min(height - margin, node.y));
  }
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

function buildGraphData(): GraphData {
  const nodes: GraphNode[] = [
    { id: '1', label: 'App', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '2', label: 'Router', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '3', label: 'Database', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '4', label: 'Logger', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '5', label: 'UserService', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '6', label: 'AuthService', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '7', label: 'CacheManager', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '8', label: 'utils', type: 'module', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '9', label: 'config', type: 'module', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '10', label: 'IMiddleware', type: 'interface', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '11', label: 'IRepository', type: 'interface', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '12', label: 'IValidator', type: 'interface', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '13', label: 'main', type: 'function', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '14', label: 'parseArgs', type: 'function', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '15', label: 'validate', type: 'function', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '16', label: 'formatDate', type: 'function', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '17', label: 'sanitize', type: 'function', x: 0, y: 0, vx: 0, vy: 0 },
    { id: '18', label: 'UserModel', type: 'class', x: 0, y: 0, vx: 0, vy: 0 },
  ];

  const edges: GraphEdge[] = [
    { source: '1', target: '2', type: 'import' },
    { source: '1', target: '3', type: 'import' },
    { source: '2', target: '5', type: 'import' },
    { source: '2', target: '6', type: 'import' },
    { source: '5', target: '3', type: 'import' },
    { source: '5', target: '11', type: 'implements' },
    { source: '6', target: '3', type: 'import' },
    { source: '6', target: '7', type: 'import' },
    { source: '1', target: '8', type: 'import' },
    { source: '1', target: '9', type: 'import' },
    { source: '2', target: '10', type: 'implements' },
    { source: '5', target: '12', type: 'implements' },
    { source: '13', target: '1', type: 'call' },
    { source: '13', target: '14', type: 'call' },
    { source: '14', target: '9', type: 'import' },
    { source: '15', target: '17', type: 'call' },
    { source: '16', target: '8', type: 'import' },
    { source: '5', target: '18', type: 'import' },
    { source: '1', target: '13', type: 'call' },
    { source: '6', target: '4', type: 'import' },
    { source: '3', target: '4', type: 'import' },
  ];

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const GraphExplorer: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<GraphData>(() => buildGraphData());
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Run force simulation when graph or dimensions change
  useEffect(() => {
    const nodes = graph.nodes.map((n) => ({
      ...n,
      x: Math.random() * dimensions.width,
      y: Math.random() * dimensions.height,
      vx: 0,
      vy: 0,
    }));
    simulate(nodes, graph.edges, dimensions.width, dimensions.height);
    setGraph((prev) => ({ ...prev, nodes }));
  }, [dimensions.width, dimensions.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Observe container size
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const handleNodeHover = useCallback(
    (node: GraphNode, e: React.MouseEvent) => {
      const related = graph.edges.filter(
        (ed) => ed.source === node.id || ed.target === node.id,
      );
      const rect = (e.target as SVGCircleElement).getBoundingClientRect();
      setTooltip({
        node,
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        relatedEdges: related,
      });
    },
    [graph.edges],
  );

  const handleNodeLeave = useCallback(() => setTooltip(null), []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [],
  );

  // Pan & zoom handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - zoom.x, y: e.clientY - zoom.y });
    }
  }, [zoom.x, zoom.y]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setZoom((prev) => ({
        ...prev,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      }));
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => {
      const newScale = Math.max(0.2, Math.min(5, prev.scale * delta));
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return prev;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        scale: newScale,
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom({ x: 0, y: 0, scale: 1 });
    setSelectedNode(null);
    setCollapsed(new Set());
  }, []);

  // Filter visible nodes
  const visibleNodes = graph.nodes.filter((n) => !collapsed.has(n.id));
  const visibleEdges = graph.edges.filter(
    (e) => !collapsed.has(e.source) && !collapsed.has(e.target),
  );

  const nodeRadius = 14;

  return (
    <div className="graph-explorer">
      <div className="graph-canvas-wrapper" ref={wrapperRef}>
        <div className="graph-toolbar">
          <button className="btn" onClick={resetView}>
            Reset View
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
            Scroll to zoom — Drag to pan
          </span>
        </div>

        <svg
          ref={svgRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.scale})`}>
            {/* Edges */}
            {visibleEdges.map((edge, i) => {
              const s = graph.nodes.find((n) => n.id === edge.source);
              const t = graph.nodes.find((n) => n.id === edge.target);
              if (!s || !t) return null;
              const isSelected =
                selectedNode === edge.source || selectedNode === edge.target;
              return (
                <g key={`edge-${i}`} className={`graph-edge ${edge.type}`}>
                  <line
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={isSelected ? EDGE_COLORS[edge.type] : '#30363d'}
                    strokeOpacity={isSelected ? 0.8 : 0.4}
                  />
                </g>
              );
            })}

            {/* Nodes */}
            {visibleNodes.map((node) => (
              <g
                key={node.id}
                className={`graph-node ${node.type}`}
                onClick={() => handleNodeClick(node.id)}
                onMouseEnter={(e) => handleNodeHover(node, e)}
                onMouseLeave={handleNodeLeave}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={selectedNode === node.id ? nodeRadius + 3 : nodeRadius}
                  fill={NODE_COLORS[node.type]}
                  stroke={selectedNode === node.id ? '#fff' : 'transparent'}
                  strokeWidth={2}
                  opacity={selectedNode ? (selectedNode === node.id ? 1 : 0.5) : 1}
                />
                <text x={node.x} y={node.y + nodeRadius + 10}>
                  {node.label}
                </text>
              </g>
            ))}
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="graph-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="tooltip-name">{tooltip.node.label}</div>
            <div className="tooltip-row">
              Type: <strong>{tooltip.node.type}</strong>
            </div>
            <div className="tooltip-row">
              Connections: <strong>{tooltip.relatedEdges.length}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="graph-legend">
        <h3>Legend</h3>
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 10 }}>
          Nodes
        </p>
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div className="legend-item" key={type}>
            <span className={`legend-dot ${type}`} style={{ background: color }} />
            {type}
          </div>
        ))}
        <p
          style={{
            fontSize: '0.6875rem',
            color: 'var(--text-muted)',
            marginTop: 12,
            marginBottom: 10,
          }}
        >
          Edges
        </p>
        {Object.entries(EDGE_COLORS).map(([type, color]) => (
          <div className="legend-item" key={type}>
            <span className={`legend-dot ${type}`} style={{ background: color }} />
            {type}
          </div>
        ))}
        <p
          style={{
            fontSize: '0.6875rem',
            color: 'var(--text-muted)',
            marginTop: 16,
            marginBottom: 4,
          }}
        >
          Interaction
        </p>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div>Click node — collapse</div>
          <div>Hover node — details</div>
          <div>Scroll — zoom</div>
          <div>Drag — pan</div>
        </div>
      </div>
    </div>
  );
};

export default GraphExplorer;
