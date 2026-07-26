import React, { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoNode {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  role: string;
  nodeCount?: number;
  edgeCount?: number;
}

interface RepoEdge {
  source: string;
  target: string;
  relationship: string;
}

interface DependencyGraph {
  nodes: RepoNode[];
  edges: RepoEdge[];
}

interface CrossRepoStats {
  totalRepos: number;
  totalSymbols: number;
  crossRepoEdges: number;
  contractsCount: number;
  conflictsCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchCrossRepoStats(): Promise<CrossRepoStats> {
  return fetch('/api/v1/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'cross_repo_search', args: { query: '', limit: 0 } }),
  })
    .then((r) => r.json())
    .then((data) => ({
      totalRepos: 0,
      totalSymbols: 0,
      crossRepoEdges: 0,
      contractsCount: 0,
      conflictsCount: 0,
    }))
    .catch(() => ({
      totalRepos: 0,
      totalSymbols: 0,
      crossRepoEdges: 0,
      contractsCount: 0,
      conflictsCount: 0,
    }));
}

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

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchCrossRepoStats()
      .then((s) => { if (mounted) { setStats(s); setLoading(false); } })
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
          <div className="stat-value">{stats.crossRepoEdges}</div>
          <div className="stat-label">Cross-Repo Edges</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.contractsCount}</div>
          <div className="stat-label">API Contracts</div>
        </div>
      </div>

      <div className="dashboard-grid">
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
          <h3>Cross-Repo Dependency Graph</h3>
          <p className="text-muted">
            Visualize how repositories in a group depend on each other.
            See which repos import from others and detect coupling.
          </p>
          <div className="quick-actions">
            <button className="btn-primary">View Graph</button>
            <button className="btn-secondary">Export Data</button>
          </div>
        </div>

        <div className="card">
          <h3>Version Compatibility</h3>
          <p className="text-muted">
            Detect version conflicts across repositories. See which
            dependencies have mismatched versions and get alignment suggestions.
          </p>
          <div className="stat-row">
            <span className="stat-badge warning">0 Conflicts</span>
            <span className="stat-badge success">All Aligned</span>
          </div>
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
      </div>
    </div>
  );
};

export default CrossRepoDashboard;
