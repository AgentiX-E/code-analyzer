// @code-analyzer/web — App Integration Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock hooks used by child components
vi.mock('../hooks', () => ({
  useApiHealth: vi.fn(() => ({
    data: null,
    loading: true,
    error: null,
    refetch: vi.fn(),
  })),
  useToolList: vi.fn(() => ({
    data: [],
    loading: false,
    error: null,
    byCategory: {},
    refetch: vi.fn(),
  })),
  useSearch: vi.fn(() => ({
    results: [],
    total: 0,
    loading: false,
    error: null,
    hasSearched: false,
  })),
  useGraphStats: vi.fn(() => ({
    data: null,
    loading: true,
    error: null,
    refetch: vi.fn(),
  })),
  useAnalyze: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    analyze: vi.fn(),
  })),
}));

import { useApiHealth, useGraphStats } from '../hooks';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App Integration', () => {
  it('should render all three tabs', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    // Find tab buttons by their text content (nav buttons)
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('should have active class on selected tab', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    const graphTab = screen.getByText('Graph');
    expect(graphTab.className).toContain('active');

    fireEvent.click(screen.getByText('Search'));
    expect(screen.getByText('Search').className).toContain('active');
    expect(screen.getByText('Graph').className).not.toContain('active');
  });

  it('should render Graph content by default', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    // GraphExplorer always shows Legend
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('should render Search content when tab clicked', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(screen.getByText('Search'));

    expect(screen.getByPlaceholderText('Search symbols, files, or types...')).toBeInTheDocument();
    // Graph legend should not be visible
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
  });

  it('should render Dashboard content when tab clicked', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'ok',
        timestamp: '',
        uptime: 0,
        version: '',
        name: '',
        environment: '',
        checks: {
          server: { status: 'ok', uptime: 0 },
          memory: { status: 'ok', heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 10, edges: 20, files: 5 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(screen.getByText('Dashboard'));

    await waitFor(() => {
      expect(screen.getByText('Server Status')).toBeInTheDocument();
    });
  });

  it('should toggle between tabs correctly', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    // Start at Graph
    expect(screen.getByText('Legend')).toBeInTheDocument();

    // Go to Search
    fireEvent.click(screen.getByText('Search'));
    expect(screen.getByPlaceholderText('Search symbols, files, or types...')).toBeInTheDocument();

    // Go back to Graph
    fireEvent.click(screen.getByText('Graph'));
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });
});
