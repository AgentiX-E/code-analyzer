import React, { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossRepoStats {
  totalRepos: number;
  totalSymbols: number;
  crossRepoEdges: number;
  contractsCount: number;
  conflictsCount: number;
}

interface JsonGraphNode {
  id: string;
  label: string;
  type: string;
  stats: {
    totalNodes: number;
    exportedSymbols: number;
    crossRepoEdgesOut: number;
    crossRepoEdgesIn: number;
  };
}

interface JsonGraphEdge {
  source: string;
  target: string;
  type: string;
  count: number;
  weight: number;
}

interface JsonGraphData {
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  metadata: {
    groupId: string;
    totalEdges: number;
    byType: Record<string, number>;
    orphanCount: number;
    generatedAt: string;
  };
}

interface VersionEntry {
  repo: string;
  version?: string;
  dependencies: Record<string, string>;
}

interface IncompatiblePair {
  repoA: string;
  depA: string;
  repoB: string;
  depB: string;
  issue: string;
}

interface VersionCompatibilityData {
  groupId: string;
  repoVersions: VersionEntry[];
  incompatiblePairs: IncompatiblePair[];
  recommendations: string[];
}

interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultConfig: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchCrossRepoStats(): Promise<CrossRepoStats> {
  return fetch('/api/v1/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'cross_repo_stats', args: {} }),
  })
    .then((r) => r.json())
    .then((data) => ({
      totalRepos: data.totalRepos ?? 0,
      totalSymbols: data.totalSymbols ?? 0,
      crossRepoEdges: data.crossRepoEdges ?? 0,
      contractsCount: data.contractsCount ?? 0,
      conflictsCount: data.conflictsCount ?? 0,
    }))
    .catch(() => ({
      totalRepos: 0,
      totalSymbols: 0,
      crossRepoEdges: 0,
      contractsCount: 0,
      conflictsCount: 0,
    }));
}

function fetchGraphData(): Promise<JsonGraphData | null> {
  return fetch('/api/v1/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'cross_repo_graph', args: {} }),
  })
    .then((r) => r.json())
    .then((data) => data as JsonGraphData)
    .catch(() => null);
}

function fetchVersionCompatibility(): Promise<VersionCompatibilityData | null> {
  return fetch('/api/v1/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'version_compatibility', args: {} }),
  })
    .then((r) => r.json())
    .then((data) => data as VersionCompatibilityData)
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// Dependency Graph Mini Visualization
// ---------------------------------------------------------------------------

interface DepGraphProps {
  graph: JsonGraphData | null;
}

const DepGraphMini: React.FC<DepGraphProps> = ({ graph }) => {
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>
        No dependency graph data available. Index repos to visualize cross-repo dependencies.
      </div>
    );
  }

  const nodeColors = ['#4A90D9', '#50B86C', '#E8A838', '#D94A4A', '#8B5CF6', '#06B6D4'];
  const width = 600;
  const height = 300;
  const nodes = graph.nodes;
  const edges = graph.edges;

  // Simple circular layout
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2.5;

  const positions = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return {
      ...node,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      color: nodeColors[i % nodeColors.length]!,
    };
  });

  return (
    <div className="dep-graph-mini">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Edge labels */}
        {edges.map((edge, i) => {
          const src = positions.find((n) => n.id === edge.source);
          const tgt = positions.find((n) => n.id === edge.target);
          if (!src || !tgt) return null;
          const shortType = edge.type.replace('CROSS_REPO_', '').toLowerCase();
          return (
            <g key={`edge-${i}`}>
              <line
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke="#888" strokeWidth={Math.min(3, edge.weight / 10 + 1)}
                strokeDasharray={edge.type === 'CROSS_REPO_CALLS' ? '6,3' :
                  edge.type === 'CROSS_REPO_DEPENDS' ? '2,4' : 'none'}
              />
              <text
                x={(src.x + tgt.x) / 2}
                y={(src.y + tgt.y) / 2 - 5}
                fontSize="9" fill="#666" textAnchor="middle"
              >
                {shortType} ({edge.count})
              </text>
            </g>
          );
        })}
        {/* Nodes */}
        {positions.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={22} fill={`${node.color}44`} stroke={node.color} strokeWidth="2" />
            <text x={node.x} y={node.y + 4} fontSize="10" textAnchor="middle" fill={node.color} fontWeight="bold">
              {node.label.length > 12 ? node.label.slice(0, 10) + '..' : node.label}
            </text>
            <title>
              {`${node.label}\nNodes: ${node.stats.totalNodes}\nExported: ${node.stats.exportedSymbols}\nFan-out: ${node.stats.crossRepoEdgesOut}\nFan-in: ${node.stats.crossRepoEdgesIn}`}
            </title>
          </g>
        ))}
      </svg>
      <div className="graph-legend" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', fontSize: '0.75rem', marginTop: '0.5rem' }}>
        <span>— IMPORTS</span>
        <span style={{ textDecoration: 'underline', textDecorationStyle: 'dashed' }}>- - CALLS</span>
        <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted' }}>··· DEPENDS</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Version Compatibility Table
// ---------------------------------------------------------------------------

interface VersionTableProps {
  data: VersionCompatibilityData | null;
}

const VersionCompatibilityTable: React.FC<VersionTableProps> = ({ data }) => {
  if (!data) {
    return (
      <div className="text-muted" style={{ padding: '1rem' }}>
        No version compatibility data. Create a repo group and index repos.
      </div>
    );
  }

  return (
    <div className="version-compat">
      {data.incompatiblePairs.length === 0 ? (
        <div className="stat-row">
          <span className="stat-badge success">0 Conflicts</span>
          <span className="stat-badge success">All Aligned</span>
        </div>
      ) : (
        <div>
          <div className="stat-row">
            <span className="stat-badge warning">{data.incompatiblePairs.length} Conflicts</span>
          </div>
          <table className="compact-table" style={{ width: '100%', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Repo A</th>
                <th>Dep A</th>
                <th>Repo B</th>
                <th>Dep B</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {data.incompatiblePairs.slice(0, 10).map((pair, i) => (
                <tr key={i}>
                  <td>{pair.repoA}</td>
                  <td><code>{pair.depA}</code></td>
                  <td>{pair.repoB}</td>
                  <td><code>{pair.depB}</code></td>
                  <td>{pair.issue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.recommendations.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <strong>Recommendations:</strong>
          <ul style={{ margin: '0.25rem 0', paddingLeft: '1.5rem', fontSize: '0.8rem' }}>
            {data.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Simple Rule Editor Panel
// ---------------------------------------------------------------------------

interface RuleEditorPanelProps {
  onClose?: () => void;
}

const RuleEditorPanel: React.FC<RuleEditorPanelProps> = ({ onClose }) => {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [ruleId, setRuleId] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [pattern, setPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/v1/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'rule_templates', args: {} }),
    })
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => {});
  }, []);

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (!templateId) {
      setDescription('');
      setSeverity('medium');
      setPattern('');
      return;
    }
    // Fetch template details
    fetch('/api/v1/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'rule_template', args: { templateId } }),
    })
      .then((r) => r.json())
      .then((tpl) => {
        setDescription(tpl.description ?? '');
        setSeverity(tpl.defaultConfig?.severity ?? 'medium');
        setPattern(tpl.defaultConfig?.checkConfig?.pattern ?? '');
      })
      .catch(() => {});
  };

  const handleSave = () => {
    if (!ruleId || !description) {
      setMessage('Rule ID and description are required.');
      return;
    }
    setSaving(true);
    setMessage('');

    fetch('/api/v1/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'create_custom_rule',
        args: {
          standardId: 'custom-project-standard',
          rule: {
            id: ruleId,
            description,
            checkType: 'regex',
            checkConfig: { pattern, flags: 'g' },
            severity,
            autoFixable: false,
          },
        },
      }),
    })
      .then((r) => r.json())
      .then(() => {
        setMessage(`Rule "${ruleId}" created successfully!`);
        setRuleId('');
        setDescription('');
      })
      .catch((e) => setMessage(`Error: ${e.message}`))
      .finally(() => setSaving(false));
  };

  return (
    <div className="rule-editor-panel" style={{ padding: '1rem', border: '1px solid #e0e0e0', borderRadius: '8px', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Custom Rule Editor</h4>
        {onClose && <button className="btn-secondary" onClick={onClose} style={{ fontSize: '0.8rem' }}>Close</button>}
      </div>

      {message && (
        <div className={message.startsWith('Error') ? 'error-banner' : 'success-banner'}
          style={{ margin: '0.5rem 0', padding: '0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>
          {message}
        </div>
      )}

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Template</label>
          <select
            value={selectedTemplate}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            style={{ width: '100%', padding: '0.4rem' }}
          >
            <option value="">-- Select template --</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Rule ID *</label>
          <input
            type="text"
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            placeholder="e.g. no-banned-imports"
            style={{ width: '100%', padding: '0.4rem' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Description *</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this rule checks..."
            style={{ width: '100%', padding: '0.4rem' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}
              style={{ width: '100%', padding: '0.4rem' }}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem' }}>Regex Pattern</label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. \bconsole\.log\b"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </div>
        </div>

        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: '0.5rem' }}
        >
          {saving ? 'Saving...' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CrossRepoDashboard Component
// ---------------------------------------------------------------------------

const CrossRepoDashboard: React.FC = () => {
  const [stats, setStats] = useState<CrossRepoStats>({
    totalRepos: 0,
    totalSymbols: 0,
    crossRepoEdges: 0,
    contractsCount: 0,
    conflictsCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<JsonGraphData | null>(null);
  const [versionData, setVersionData] = useState<VersionCompatibilityData | null>(null);
  const [showRuleEditor, setShowRuleEditor] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetchCrossRepoStats(),
      fetchGraphData(),
      fetchVersionCompatibility(),
    ])
      .then(([s, g, v]) => {
        if (mounted) {
          setStats(s);
          setGraphData(g);
          setVersionData(v);
          setLoading(false);
        }
      })
      .catch((e) => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="loading">Loading cross-repo data...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="cross-repo-dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalRepos}</div>
          <div className="stat-label">Monitored Repos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalSymbols}</div>
          <div className="stat-label">Symbols Indexed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{graphData?.metadata?.totalEdges ?? stats.crossRepoEdges}</div>
          <div className="stat-label">Cross-Repo Edges</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.contractsCount}</div>
          <div className="stat-label">API Contracts</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Cross-Repo Dependency Graph</h3>
          <DepGraphMini graph={graphData} />
          {graphData?.metadata.orphanCount && graphData.metadata.orphanCount > 0 && (
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
              {graphData.metadata.orphanCount} repos have no cross-repo connections.
            </p>
          )}
          <div className="quick-actions" style={{ marginTop: '0.5rem' }}>
            <button className="btn-primary">Refresh Graph</button>
            <button className="btn-secondary">Export DOT</button>
          </div>
        </div>

        <div className="card">
          <h3>Version Compatibility</h3>
          <VersionCompatibilityTable data={versionData} />
        </div>

        <div className="card">
          <h3>Repository Groups</h3>
          <p className="text-muted">
            Repo groups define related repositories that share dependencies,
            APIs, or domain boundaries. Create groups to enable cross-repo
            impact analysis and federated search.
          </p>
          <div className="quick-actions">
            <button className="btn-primary">+ Create Group</button>
            <button className="btn-secondary">Manage Groups</button>
          </div>
        </div>

        <div className="card">
          <h3>Edge Type Breakdown</h3>
          {graphData?.metadata.byType && Object.keys(graphData.metadata.byType).length > 0 ? (
            <div className="edge-type-list" style={{ fontSize: '0.85rem' }}>
              {Object.entries(graphData.metadata.byType).map(([type, count]) => (
                <div key={type} className="stat-row" style={{ marginBottom: '0.25rem' }}>
                  <span>{type.replace('CROSS_REPO_', '')}</span>
                  <span className="stat-badge">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No cross-repo edges detected yet.</p>
          )}
        </div>

        <div className="card">
          <h3>Recent Cross-Repo Activity</h3>
          <p className="text-muted">
            Track PRs and changes that span multiple repositories.
            Monitor cross-repo impact in real time.
          </p>
          <div className="activity-list">
            <div className="activity-item text-muted">
              No recent cross-repo activity
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Custom Standards Rules</h3>
          <p className="text-muted">
            Create and manage custom project standards rules for code review.
            Define regex patterns, severity levels, and fix suggestions.
          </p>
          <div className="quick-actions">
            <button className="btn-primary" onClick={() => setShowRuleEditor(!showRuleEditor)}>
              {showRuleEditor ? 'Hide Editor' : '+ New Rule'}
            </button>
            <button className="btn-secondary">View Rules</button>
          </div>
          {showRuleEditor && <RuleEditorPanel onClose={() => setShowRuleEditor(false)} />}
        </div>
      </div>
    </div>
  );
};

export default CrossRepoDashboard;
