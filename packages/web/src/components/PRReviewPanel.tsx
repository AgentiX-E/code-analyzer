import React, { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  message: string;
  path: string;
  startLine: number;
  endLine?: number;
  suggestion?: string;
  category?: string;
}

interface CrossRepoImpact {
  repo: string;
  description: string;
  severity: 'warning' | 'failure' | 'notice';
}

interface PRReviewData {
  prNumber: number;
  title: string;
  repository: string;
  riskLevel: string;
  mergeRecommendation: string;
  issues: ReviewIssue[];
  crossRepoImpacts: CrossRepoImpact[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, string> = {
  critical: 'var(--accent-red, #f85149)',
  high: 'var(--accent-orange, #d29922)',
  medium: 'var(--accent-yellow, #e3b341)',
  low: 'var(--accent-green, #3fb950)',
  info: 'var(--accent-cyan, #58a6ff)',
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  approve: 'var(--accent-green, #3fb950)',
  'approve-with-caution': 'var(--accent-orange, #d29922)',
  'request-changes': 'var(--accent-red, #f85149)',
  block: 'var(--accent-red, #f85149)',
};

// ---------------------------------------------------------------------------
// PRReviewPanel Component
// ---------------------------------------------------------------------------

interface PRReviewPanelProps {
  data?: PRReviewData | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

const PRReviewPanel: React.FC<PRReviewPanelProps> = ({
  data,
  loading = false,
  error = null,
  onRefresh,
}) => {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  const filteredIssues = useCallback(() => {
    if (!data?.issues) return [];
    if (filterSeverity === 'all') return data.issues;
    return data.issues.filter((i) => i.severity === filterSeverity);
  }, [data, filterSeverity]);

  if (loading) {
    return (
      <div className="pr-review-panel">
        <div className="loading">Loading PR review data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pr-review-panel">
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="pr-review-panel">
        <div className="empty-state">
          <h3>PR Review</h3>
          <p className="text-muted">
            No PR selected. Use the search to find a PR or configure GitHub webhook
            integration to automatically review pull requests.
          </p>
          {onRefresh && (
            <button className="btn-secondary" onClick={onRefresh}>
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  const severityCounts = {
    critical: data.issues.filter((i) => i.severity === 'critical').length,
    high: data.issues.filter((i) => i.severity === 'high').length,
    medium: data.issues.filter((i) => i.severity === 'medium').length,
    low: data.issues.filter((i) => i.severity === 'low').length,
  };

  return (
    <div className="pr-review-panel">
      {/* Header */}
      <div className="pr-review-header">
        <div>
          <h2>
            PR #{data.prNumber}: {data.title}
          </h2>
          <div className="pr-meta">
            <span className="repo-badge">{data.repository}</span>
            <span
              className="risk-badge"
              style={{ color: RECOMMENDATION_COLORS[data.mergeRecommendation] ?? 'inherit' }}
            >
              {data.mergeRecommendation?.toUpperCase()}
            </span>
            <span className="risk-badge">{data.riskLevel?.toUpperCase()} Risk</span>
          </div>
        </div>
        <div className="pr-actions">
          {onRefresh && (
            <button className="btn-secondary" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="pr-review-summary">
        <div className="summary-stats">
          <div className={`summary-stat ${severityCounts.critical > 0 ? 'danger' : ''}`}>
            <span className="count">{severityCounts.critical}</span>
            <span className="label">Critical</span>
          </div>
          <div className={`summary-stat ${severityCounts.high > 0 ? 'warning' : ''}`}>
            <span className="count">{severityCounts.high}</span>
            <span className="label">High</span>
          </div>
          <div className="summary-stat">
            <span className="count">{severityCounts.medium}</span>
            <span className="label">Medium</span>
          </div>
          <div className="summary-stat">
            <span className="count">{severityCounts.low}</span>
            <span className="label">Low</span>
          </div>
        </div>
      </div>

      {/* Cross-Repo Impact */}
      {data.crossRepoImpacts && data.crossRepoImpacts.length > 0 && (
        <div className="section">
          <h3>Cross-Repository Impact ({data.crossRepoImpacts.length})</h3>
          <div className="impact-list">
            {data.crossRepoImpacts.map((impact, idx) => (
              <div key={idx} className={`impact-item impact-${impact.severity}`}>
                <span className="impact-repo">{impact.repo}</span>
                <span className="impact-desc">{impact.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues List */}
      <div className="section">
        <div className="section-header">
          <h3>Findings ({data.issues.length})</h3>
          <div className="filter-bar">
            {['all', 'critical', 'high', 'medium', 'low'].map((sev) => (
              <button
                key={sev}
                className={`filter-chip ${filterSeverity === sev ? 'active' : ''}`}
                onClick={() => setFilterSeverity(sev)}
              >
                {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="issues-list">
          {filteredIssues().map((issue) => (
            <div
              key={issue.id}
              className={`issue-card ${selectedIssue === issue.id ? 'expanded' : ''}`}
              onClick={() => setSelectedIssue(selectedIssue === issue.id ? null : issue.id)}
            >
              <div className="issue-header">
                <span
                  className="severity-dot"
                  style={{ backgroundColor: RISK_COLORS[issue.severity] ?? RISK_COLORS['info'] }}
                />
                <span className="issue-title">{issue.title}</span>
                <span className="issue-location">
                  {issue.path}:{issue.startLine}
                </span>
              </div>
              <p className="issue-message">{issue.message}</p>
              {selectedIssue === issue.id && (
                <div className="issue-details">
                  {issue.category && (
                    <span className="issue-category">Category: {issue.category}</span>
                  )}
                  {issue.suggestion && (
                    <div className="issue-suggestion">
                      <strong>Suggestion:</strong> {issue.suggestion}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="section">
          <h3>Actionable Recommendations</h3>
          <ul className="rec-list">
            {data.recommendations.map((rec, idx) => (
              <li key={idx} className="rec-item">{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PRReviewPanel;
