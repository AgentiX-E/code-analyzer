// @code-analyzer/web — MetricCards Component
// Reusable metric card grid with loading/error/empty states, trend indicators,
// and responsive layout. Used across the dashboard for key performance indicators.

import React from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MetricCardData {
  /** Unique key for the card */
  id: string;
  /** Display label */
  label: string;
  /** Current value (formatted string) */
  value: string;
  /** Optional previous value for trend calculation */
  previousValue?: string;
  /** Trend direction: up (green), down (red), neutral (gray) */
  trend?: 'up' | 'down' | 'neutral';
  /** Optional icon character or emoji */
  icon?: string;
  /** Optional CSS accent color */
  accent?: string;
  /** Optional tooltip description */
  description?: string;
}

export interface MetricCardsProps {
  /** Metric data to display */
  metrics: MetricCardData[];
  /** Whether data is loading */
  loading?: boolean;
  /** Error message if any */
  error?: string | null;
  /** Whether data is empty (distinct from loading/error) */
  isEmpty?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Callback when retry button is clicked */
  onRetry?: () => void;
  /** Number of columns (default: 4) */
  columns?: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const TREND_ICONS: Record<string, string> = {
  up: '\u25B2',    // ▲
  down: '\u25BC',  // ▼
  neutral: '\u25C6', // ◆
};

const TREND_COLORS: Record<string, string> = {
  up: 'var(--success, #3fb950)',
  down: 'var(--error, #f85149)',
  neutral: 'var(--text-muted, #8b949e)',
};

const MetricCards: React.FC<MetricCardsProps> = ({
  metrics,
  loading = false,
  error = null,
  isEmpty = false,
  emptyMessage = 'No metrics available',
  onRetry,
  columns = 4,
}) => {
  // Loading state
  if (loading) {
    return (
      <div className="metric-cards" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="metric-card metric-card--loading">
            <div className="metric-card__skeleton metric-card__skeleton--label" />
            <div className="metric-card__skeleton metric-card__skeleton--value" />
            <div className="metric-card__skeleton metric-card__skeleton--trend" />
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="metric-cards metric-cards--error">
        <div className="error-state">
          <span className="error-state__icon" role="img" aria-label="Error">&#x26A0;</span>
          <p className="error-state__message">{error}</p>
          {onRetry && (
            <button className="btn btn-secondary" onClick={onRetry} type="button">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (isEmpty || metrics.length === 0) {
    return (
      <div className="metric-cards metric-cards--empty">
        <div className="empty-state">
          <p className="empty-state__message">{emptyMessage}</p>
          {onRetry && (
            <button className="btn btn-secondary" onClick={onRetry} type="button">
              Refresh
            </button>
          )}
        </div>
      </div>
    );
  }

  // Data state
  return (
    <div className="metric-cards" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className="metric-card"
          title={metric.description ?? metric.label}
          style={metric.accent ? { borderLeftColor: metric.accent } : undefined}
        >
          <div className="metric-card__header">
            <span className="metric-card__label">{metric.label}</span>
            {metric.icon && (
              <span className="metric-card__icon" role="img" aria-hidden="true">
                {metric.icon}
              </span>
            )}
          </div>
          <div className="metric-card__body">
            <span className="metric-card__value">{metric.value}</span>
            {metric.trend && (
              <span
                className="metric-card__trend"
                style={{ color: TREND_COLORS[metric.trend] ?? TREND_COLORS['neutral'] }}
              >
                {TREND_ICONS[metric.trend] ?? TREND_ICONS['neutral']}
              </span>
            )}
          </div>
          {metric.previousValue && (
            <div className="metric-card__footer">
              <span className="metric-card__previous">Previous: {metric.previousValue}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default MetricCards;
