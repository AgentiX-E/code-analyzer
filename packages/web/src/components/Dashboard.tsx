import React, { useState, useCallback } from 'react';
import { useApiHealth, useGraphStats, useAnalyze } from '../hooks';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IndexStats {
  nodes: number;
  edges: number;
  files: number;
}

interface SystemInfo {
  nodeVersion: string;
  os: string;
  memoryMb: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatBytes = (mb: number): string => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

const formatUptime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const Dashboard: React.FC = () => {
  // Real API data
  const { data: health, loading: healthLoading, error: healthError } = useApiHealth(15_000);
  const { data: stats, loading: statsLoading, error: statsError } = useGraphStats();
  const { analyze, loading: analyzeLoading, error: analyzeError } = useAnalyze();

  const [searchCount, setSearchCount] = useState(0);

  // Determine loading state
  const loaded = !healthLoading && !statsLoading;

  // Compute system info from health data or use defaults
  const system: SystemInfo = health
    ? {
        nodeVersion: 'N/A',
        os: `${health.environment}`,
        memoryMb: health.checks.memory.rssMB,
      }
    : {
        nodeVersion: 'N/A',
        os: 'unknown',
        memoryMb: 0,
      };

  const index: IndexStats = stats
    ? { nodes: stats.nodes, edges: stats.edges, files: stats.files }
    : { nodes: 0, edges: 0, files: 0 };

  const handleNewAnalysis = useCallback(async () => {
    const path = prompt('Enter repository path to analyze:');
    if (!path) return;
    await analyze(path);
  }, [analyze]);

  const handleSearch = useCallback(() => {
    setSearchCount((prev) => prev + 1);
  }, []);

  // Error display
  const displayError = healthError ?? statsError ?? analyzeError;

  if (!loaded) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Connection status banner */}
      {displayError && (
        <div className="connection-banner" style={{
          background: 'var(--error-muted)',
          color: 'var(--error)',
          padding: '8px 16px',
          borderRadius: 'var(--radius)',
          marginBottom: 16,
          fontSize: '0.8125rem',
        }}>
          ⚠ Cannot connect to server: {displayError}. Showing offline data.
        </div>
      )}

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
        {/* Recent analyses / Server health */}
        <div className="card">
          <div className="card-header">
            <h3>Server Status</h3>
            {health && (
              <span
                className="badge"
                style={{
                  background: health.status === 'ok' ? 'var(--success-muted, #1a3a2a)' : 'var(--warning-muted, #3a2a1a)',
                  color: health.status === 'ok' ? 'var(--success, #3fb950)' : 'var(--warning, #d29922)',
                }}
              >
                {health.status}
              </span>
            )}
          </div>
          <div className="system-info">
            <div className="info-item">
              <span className="info-label">Uptime</span>
              <span className="info-value">{health ? formatUptime(health.uptime) : 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Version</span>
              <span className="info-value">{health?.version ?? 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Environment</span>
              <span className="info-value">{health?.environment ?? 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* System info */}
        <div className="card">
          <div className="card-header">
            <h3>System</h3>
          </div>
          <div className="system-info">
            <div className="info-item">
              <span className="info-label">Memory (RSS)</span>
              <span className="info-value">
                {system.memoryMb > 0 ? formatBytes(system.memoryMb) : 'N/A'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Heap Used</span>
              <span className="info-value">
                {health ? `${health.checks.memory.heapUsedMB} MB` : 'N/A'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Heap Total</span>
              <span className="info-value">
                {health ? `${health.checks.memory.heapTotalMB} MB` : 'N/A'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Memory Status</span>
              <span className="info-value" style={{
                color: health?.checks.memory.status === 'warn' ? 'var(--warning, #d29922)' : 'var(--success, #3fb950)',
              }}>
                {health?.checks.memory.status ?? 'N/A'}
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
            <button className="btn btn-primary" onClick={handleNewAnalysis} disabled={analyzeLoading}>
              {analyzeLoading ? 'Analyzing...' : 'New Analysis'}
            </button>
            <button className="btn" onClick={handleSearch}>
              Search Codebase
            </button>
            <button className="btn">View Report</button>
            <button className="btn">Export Data</button>
          </div>
          {analyzeError && (
            <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: 8 }}>
              Analysis error: {analyzeError}
            </p>
          )}
        </div>

        {/* Graph statistics */}
        <div className="card">
          <div className="card-header">
            <h3>Graph Statistics</h3>
          </div>
          <div className="system-info">
            <div className="info-item">
              <span className="info-label">Total Nodes</span>
              <span className="info-value">{index.nodes.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Total Edges</span>
              <span className="info-value">{index.edges.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Files Indexed</span>
              <span className="info-value">{index.files.toLocaleString()}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Density</span>
              <span className="info-value">
                {index.nodes > 0
                  ? (index.edges / (index.nodes * (index.nodes - 1))).toFixed(4)
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
