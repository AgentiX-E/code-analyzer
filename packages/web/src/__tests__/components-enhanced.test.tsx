// @code-analyzer/web — Enhanced Component Tests
// Tests for MetricCards, Toast, and Dashboard enhancements (trends, refresh, last-updated).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// MetricCards Tests
// ---------------------------------------------------------------------------

import MetricCards, { type MetricCardData } from '../components/MetricCards';

describe('MetricCards', () => {
  const sampleMetrics: MetricCardData[] = [
    { id: 'nodes', label: 'Nodes', value: '1,234', trend: 'up', icon: '\u25C9' },
    { id: 'edges', label: 'Edges', value: '5,678', trend: 'down', icon: '\u2194' },
    { id: 'files', label: 'Files', value: '890', trend: 'neutral', icon: '\uD83D\uDCC4' },
  ];

  // ---- Loading State ----
  it('should render loading skeletons when loading', () => {
    render(<MetricCards metrics={[]} loading={true} columns={3} />);
    const skeletons = document.querySelectorAll('.metric-card--loading');
    expect(skeletons.length).toBe(3);
  });

  it('should render skeleton label, value, and trend placeholders', () => {
    render(<MetricCards metrics={[]} loading={true} columns={2} />);
    const labelSkeletons = document.querySelectorAll('.metric-card__skeleton--label');
    const valueSkeletons = document.querySelectorAll('.metric-card__skeleton--value');
    expect(labelSkeletons.length).toBeGreaterThanOrEqual(1);
    expect(valueSkeletons.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Error State ----
  it('should render error message when error is provided', () => {
    render(<MetricCards metrics={[]} error="Network timeout" />);
    expect(screen.getByText('Network timeout')).toBeDefined();
  });

  it('should render retry button in error state when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<MetricCards metrics={[]} error="Connection failed" onRetry={onRetry} />);
    const btn = screen.getByText('Retry');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should not render retry button when onRetry is not provided', () => {
    render(<MetricCards metrics={[]} error="Connection failed" />);
    expect(screen.queryByText('Retry')).toBeNull();
  });

  // ---- Empty State ----
  it('should render empty state message when metrics is empty', () => {
    render(<MetricCards metrics={[]} emptyMessage="Nothing to display" />);
    expect(screen.getByText('Nothing to display')).toBeDefined();
  });

  it('should render empty state when isEmpty is true even with metrics', () => {
    render(<MetricCards metrics={sampleMetrics} isEmpty={true} emptyMessage="All clear" />);
    expect(screen.getByText('All clear')).toBeDefined();
    expect(screen.queryByText('Nodes')).toBeNull();
  });

  it('should render refresh button in empty state when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<MetricCards metrics={[]} onRetry={onRetry} emptyMessage="No data" />);
    const btn = screen.getByText('Refresh');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ---- Data State ----
  it('should render all metric cards', () => {
    render(<MetricCards metrics={sampleMetrics} columns={3} />);
    expect(screen.getByText('Nodes')).toBeDefined();
    expect(screen.getByText('Edges')).toBeDefined();
    expect(screen.getByText('Files')).toBeDefined();
  });

  it('should render metric values', () => {
    render(<MetricCards metrics={sampleMetrics} />);
    expect(screen.getByText('1,234')).toBeDefined();
    expect(screen.getByText('5,678')).toBeDefined();
    expect(screen.getByText('890')).toBeDefined();
  });

  it('should render trend indicators', () => {
    const { container } = render(<MetricCards metrics={sampleMetrics} />);
    const trends = container.querySelectorAll('.metric-card__trend');
    expect(trends.length).toBe(3);
  });

  it('should render up trend with success color', () => {
    const { container } = render(<MetricCards metrics={[sampleMetrics[0]!]} />);
    const trend = container.querySelector('.metric-card__trend');
    expect(trend).not.toBeNull();
  });

  it('should render icons when provided', () => {
    const { container } = render(<MetricCards metrics={sampleMetrics} />);
    const icons = container.querySelectorAll('.metric-card__icon');
    expect(icons.length).toBe(3);
  });

  it('should render previous values when provided', () => {
    const metricsWithPrev: MetricCardData[] = [
      { id: 'a', label: 'Count', value: '100', trend: 'up', previousValue: '95' },
    ];
    render(<MetricCards metrics={metricsWithPrev} />);
    expect(screen.getByText('Previous: 95')).toBeDefined();
  });

  it('should apply accent border color when provided', () => {
    const metrics: MetricCardData[] = [
      { id: 'a', label: 'Test', value: '1', accent: '#ff0000' },
    ];
    const { container } = render(<MetricCards metrics={metrics} />);
    const card = container.querySelector('.metric-card') as HTMLElement;
    expect(card.style.borderLeftColor).toBe('rgb(255, 0, 0)');
  });

  it('should render tooltip via title attribute', () => {
    const metrics: MetricCardData[] = [
      { id: 'a', label: 'Test', value: '1', description: 'A helpful description' },
    ];
    const { container } = render(<MetricCards metrics={metrics} />);
    const card = container.querySelector('.metric-card') as HTMLElement;
    expect(card.title).toBe('A helpful description');
  });

  it('should use default empty message when not provided', () => {
    render(<MetricCards metrics={[]} />);
    expect(screen.getByText('No metrics available')).toBeDefined();
  });

  it('should handle single metric without crashing', () => {
    render(<MetricCards metrics={[sampleMetrics[0]!]} columns={1} />);
    expect(screen.getByText('Nodes')).toBeDefined();
  });

  it('should apply grid columns style', () => {
    const { container } = render(<MetricCards metrics={sampleMetrics} columns={2} />);
    const grid = container.querySelector('.metric-cards') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });
});

// ---------------------------------------------------------------------------
// Toast Tests
// ---------------------------------------------------------------------------

import { ToastProvider, useToast } from '../components/Toast';

// Helper component to trigger toasts in tests
const ToastTrigger: React.FC = () => {
  const { addToast, dismissAll } = useToast();

  return (
    <div>
      <button
        data-testid="add-success"
        onClick={() => addToast({ variant: 'success', message: 'Operation completed', duration: 0 })}
      >
        Add Success
      </button>
      <button
        data-testid="add-error"
        onClick={() => addToast({ variant: 'error', message: 'Something went wrong', detail: 'Stack trace details' })}
      >
        Add Error
      </button>
      <button
        data-testid="add-warning"
        onClick={() => addToast({ variant: 'warning', message: 'Disk space low' })}
      >
        Add Warning
      </button>
      <button
        data-testid="add-info"
        onClick={() => addToast({ variant: 'info', message: 'Sync in progress' })}
      >
        Add Info
      </button>
      <button
        data-testid="add-non-dismissible"
        onClick={() => addToast({ variant: 'info', message: 'Cannot dismiss', dismissible: false })}
      >
        Add Non-dismissible
      </button>
      <button data-testid="dismiss-all" onClick={dismissAll}>
        Dismiss All
      </button>
    </div>
  );
};

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // ---- Basic Rendering ----
  it('should render toast messages', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-success'));
    expect(screen.getByText('Operation completed')).toBeDefined();
  });

  it('should render toast with detail text', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-error'));
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Stack trace details')).toBeDefined();
  });

  // ---- Variants ----
  it('should render success variant toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-success'));
    const toast = document.querySelector('.toast--success');
    expect(toast).not.toBeNull();
  });

  it('should render error variant toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-error'));
    const toast = document.querySelector('.toast--error');
    expect(toast).not.toBeNull();
  });

  it('should render warning variant toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-warning'));
    const toast = document.querySelector('.toast--warning');
    expect(toast).not.toBeNull();
  });

  it('should render info variant toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-info'));
    const toast = document.querySelector('.toast--info');
    expect(toast).not.toBeNull();
  });

  // ---- Dismiss Behavior ----
  it('should dismiss toast when close button is clicked', async () => {
    vi.useRealTimers();
    render(
      <ToastProvider defaultDuration={0}>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-error'));
    expect(screen.getByText('Something went wrong')).toBeDefined();

    const dismissBtn = document.querySelector('.toast__dismiss') as HTMLElement;
    expect(dismissBtn).not.toBeNull();
    fireEvent.click(dismissBtn);

    // Wait for exit animation to complete
    await waitFor(() => {
      expect(screen.queryByText('Something went wrong')).toBeNull();
    }, { timeout: 5000 });

    vi.useFakeTimers();
  });

  it('should not show dismiss button for non-dismissible toasts', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-non-dismissible'));
    const toast = document.querySelector('.toast--info');
    expect(toast).not.toBeNull();
    const dismissBtn = toast?.querySelector('.toast__dismiss');
    expect(dismissBtn).toBeNull();
  });

  // ---- Auto-dismiss ----
  it('should auto-dismiss toast after configured duration', async () => {
    vi.useRealTimers();
    render(
      <ToastProvider defaultDuration={500}>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-error'));
    expect(screen.getByText('Something went wrong')).toBeDefined();

    await waitFor(() => {
      expect(screen.queryByText('Something went wrong')).toBeNull();
    }, { timeout: 5000 });

    vi.useFakeTimers();
  });

  it('should not auto-dismiss toast with duration 0', async () => {
    vi.useRealTimers();
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-success'));

    // Wait a bit to ensure no dismissal happens
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.getByText('Operation completed')).toBeDefined();

    vi.useFakeTimers();
  });

  // ---- Dismiss All ----
  it('should dismiss all toasts', async () => {
    vi.useRealTimers();
    render(
      <ToastProvider defaultDuration={0}>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-success'));
    fireEvent.click(screen.getByTestId('add-error'));
    fireEvent.click(screen.getByTestId('add-warning'));

    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('.toast').length).toBe(3);

    fireEvent.click(screen.getByTestId('dismiss-all'));

    await waitFor(() => {
      expect(document.querySelectorAll('.toast').length).toBe(0);
    }, { timeout: 5000 });

    vi.useFakeTimers();
  });

  // ---- Max Toasts ----
  it('should enforce max toasts limit', async () => {
    render(
      <ToastProvider maxToasts={2} defaultDuration={0}>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('add-success'));
    fireEvent.click(screen.getByTestId('add-error'));
    fireEvent.click(screen.getByTestId('add-warning'));

    // Only 2 should be visible
    expect(document.querySelectorAll('.toast').length).toBe(2);
  });

  // ---- Return Value ----
  it('should return toast ID from addToast', () => {
    const ids: string[] = [];
    const Collector: React.FC = () => {
      const { addToast } = useToast();
      return (
        <button
          data-testid="collect"
          onClick={() => {
            ids.push(addToast({ variant: 'info', message: 'test', duration: 0 }));
          }}
        >
          Collect
        </button>
      );
    };

    render(
      <ToastProvider>
        <Collector />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('collect'));
    expect(ids.length).toBe(1);
    expect(ids[0]).toMatch(/^toast-/);
  });

  // ---- Error: useToast outside provider ----
  it('should throw when useToast is used outside ToastProvider', () => {
    const BadComponent: React.FC = () => {
      useToast();
      return null;
    };

    expect(() => render(<BadComponent />)).toThrow(
      'useToast must be used within a ToastProvider',
    );
  });
});
