import React, { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IndexStats {
  nodes: number;
  edges: number;
  files: number;
}

interface RecentAnalysis {
  id: string;
  path: string;
  status: 'completed' | 'running' | 'failed';
  timestamp: string;
}

interface SystemInfo {
  nodeVersion: string;
  os: string;
  memoryMb: number;
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_INDEX: IndexStats = {
  nodes: 1247,
  edges: 3892,
  files: 215,
};

const MOCK_RECENT: RecentAnalysis[] = [
  { id: '1', path: 'src/core/engine.ts', status: 'completed', timestamp: '2 minutes ago' },
  { id: '2', path: 'src/services/api.ts', status: 'completed', timestamp: '15 minutes ago' },
  { id: '3', path: 'src/components/Editor.tsx', status: 'completed', timestamp: '1 hour ago' },
  { id: '4', path: 'src/utils/transform.ts', status: 'completed', timestamp: '2 hours ago' },
  { id: '5', path: 'tests/integration/setup.ts', status: 'running', timestamp: 'just now' },
  { id: '6', path: 'src/legacy/compat.ts', status: 'failed', timestamp: '5 minutes ago' },
]; // eslint-disable-line no-unused-vars

const formatBytes = (mb: number): string => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const Dashboard: React.FC = () => {
  const [index, setIndex] = useState<IndexStats>(MOCK_INDEX);
  const [recent, setRecent] = useState<RecentAnalysis[]>(MOCK_RECENT);
  const [system] = useState<SystemInfo>({
    nodeVersion: 'v20.11.0',
    os: 'linux x64',
    memoryMb: 8192,
  });
  const [searchCount, setSearchCount] = useState(342);

  // Simulate loading
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 400);
    return () => clearTimeout(timer);
  }, []);

  if (!loaded) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  const handleNewAnalysis = () => {
    const newAnalysis: RecentAnalysis = {
      id: String(Date.now()),
      path: 'src/new-analysis.ts',
      status: 'running',
      timestamp: 'just now',
    };
    setRecent((prev) => [newAnalysis, ...prev.slice(0, 4)]);
    setIndex((prev) => ({ ...prev, files: prev.files + 1 }));
  };

  const handleSearch = () => {
    setSearchCount((prev) => prev + 1);
  };

  return (
    <div className="dashboard">
      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card nodes">
          <div className="stat-label">Nodes</div>
          <div className="stat-value">{index.nodes.toLocaleString()}</div>
        </div>
        <div className="stat-card edges">
          <div className="stat-label">Edges</div>
          <div className="stat-value">{index.edges.toLocaleString()}</div>
        </div>
        <div className="stat-card files">
          <div className="stat-label">Files</div>
          <div className="stat-value">{index.files.toLocaleString()}</div>
        </div>
        <div className="stat-card searches">
          <div className="stat-label">Total Searches</div>
          <div className="stat-value">{searchCount.toLocaleString()}</div>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Recent analyses */}
        <div className="card">
          <div className="card-header">
            <h3>Recent Analyses</h3>
            <span className="badge" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
              {recent.length}
            </span>
          </div>
          <ul className="recent-list">
            {recent.map((item) => (
              <li key={item.id}>
                <span className="recent-path" title={item.path}>
                  {item.path}
                </span>
                <div className="recent-meta">
                  <span className={`recent-status ${item.status}`}>{item.status}</span>
                  <span className="recent-time">{item.timestamp}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* System info */}
        <div className="card">
          <div className="card-header">
            <h3>System</h3>
          </div>
          <div className="system-info">
            <div className="info-item">
              <span className="info-label">Node.js</span>
              <span className="info-value">{system.nodeVersion}</span>
            </div>
            <div className="info-item">
              <span className="info-label">OS</span>
              <span className="info-value">{system.os}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Memory</span>
              <span className="info-value">{formatBytes(system.memoryMb)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Processed</span>
              <span className="info-value">
                {index.files} files
              </span>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <div className="card-header">
            <h3>Quick Actions</h3>
          </div>
          <div className="quick-actions">
            <button className="btn btn-primary" onClick={handleNewAnalysis}>
              New Analysis
            </button>
            <button className="btn" onClick={handleSearch}>
              Search Codebase
            </button>
            <button className="btn">View Report</button>
            <button className="btn">Export Data</button>
          </div>
        </div>

        {/* Search statistics */}
        <div className="card">
          <div className="card-header">
            <h3>Search Statistics</h3>
          </div>
          <div className="system-info">
            <div className="info-item">
              <span className="info-label">Total Searches</span>
              <span className="info-value">{searchCount.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Avg. Time</span>
              <span className="info-value">12.4 ms</span>
            </div>
            <div className="info-item">
              <span className="info-label">Cache Hits</span>
              <span className="info-value">87.3%</span>
            </div>
            <div className="info-item">
              <span className="info-label">Index Size</span>
              <span className="info-value">
                {index.nodes.toLocaleString()} nodes
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
