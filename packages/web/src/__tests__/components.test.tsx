// @code-analyzer/web — Component Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock the hooks module
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

import { useApiHealth, useGraphStats, useAnalyze, useSearch, useToolList } from '../hooks';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

describe('App', () => {
  it('should render header and tab navigation', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    expect(screen.getByText('Code Analyzer')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('should default to Graph tab', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    // GraphExplorer should be visible (has legend)
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('should switch to Search tab on click', async () => {
    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(screen.getByText('Search'));
    // Search view has the search input
    expect(screen.getByPlaceholderText('Search symbols, files, or types...')).toBeInTheDocument();
  });

  it('should switch to Dashboard tab on click', async () => {
    // Mock hooks for dashboard
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'ok',
        timestamp: '',
        uptime: 1000,
        version: '0.1.0',
        name: 'test',
        environment: 'dev',
        checks: {
          server: { status: 'ok', uptime: 1000 },
          memory: { status: 'ok', heapUsedMB: 10, heapTotalMB: 100, rssMB: 50 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 100, edges: 200, files: 50 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useAnalyze).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      analyze: vi.fn(),
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(screen.getByText('Dashboard'));
    await waitFor(() => {
      expect(screen.getByText('Server Status')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// GraphExplorer
// ---------------------------------------------------------------------------

describe('GraphExplorer', () => {
  it('should show loading state', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    render(<GraphExplorer />);

    expect(screen.getByText('Loading graph data...')).toBeInTheDocument();
  });

  it('should show error state', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: null,
      loading: false,
      error: 'Connection failed',
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    render(<GraphExplorer />);

    expect(screen.getByText('⚠ Failed to load graph')).toBeInTheDocument();
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('should show legend when loaded with fallback data', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 0, edges: 0, files: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    render(<GraphExplorer />);

    await waitFor(() => {
      expect(screen.getByText('Legend')).toBeInTheDocument();
    });
    expect(screen.getByText('Reset View')).toBeInTheDocument();
  });

  it('should render SVG with fallback nodes', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 0, edges: 0, files: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    const { container } = render(<GraphExplorer />);

    await waitFor(() => {
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  it('should show live data badge when API data available', async () => {
    // Mock graph stats with data and searchGraph fetch
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 100, edges: 200, files: 10 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Mock the searchGraph call that GraphExplorer makes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_graph',
          success: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                nodes: [
                  { id: 'a', label: 'TestNode', type: 'class' },
                  { id: 'b', label: 'OtherNode', type: 'function' },
                ],
                edges: [{ source: 'a', target: 'b', type: 'import' }],
              }),
            },
          ],
        }),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    render(<GraphExplorer />);

    // Wait for the live data badge to appear
    await waitFor(() => {
      expect(screen.getByText(/Live data/)).toBeInTheDocument();
    });
  });

  it('should reset view on Reset View button click', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 0, edges: 0, files: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    render(<GraphExplorer />);

    await waitFor(() => {
      expect(screen.getByText('Reset View')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset View'));
    // After reset, legend should still be visible
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('should show tooltip on node hover', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 0, edges: 0, files: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: GraphExplorer } = await import('../components/GraphExplorer');
    const { container } = render(<GraphExplorer />);

    await waitFor(() => {
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    // Find a node circle and hover over it
    const circles = container.querySelectorAll('circle');
    if (circles.length > 0) {
      fireEvent.mouseEnter(circles[0]!);
      await waitFor(() => {
        // Tooltip should show the node label
        const tooltips = container.querySelectorAll('.graph-tooltip');
        expect(tooltips.length).toBeGreaterThan(0);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// SearchView
// ---------------------------------------------------------------------------

describe('SearchView', () => {
  it('should render search input', async () => {
    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    expect(screen.getByPlaceholderText('Search symbols, files, or types...')).toBeInTheDocument();
  });

  it('should show initial empty state', async () => {
    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    expect(screen.getByText('Start typing to search the codebase')).toBeInTheDocument();
  });

  it('should show no results state', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [],
      total: 0,
      loading: false,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    // Need to trigger a search first by typing
    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText(/No results found/)).toBeInTheDocument();
    });
  });

  it('should show search results', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [
        { name: 'testFunc', type: 'function', file: 'test.ts', line: 42, score: 0.9, snippet: 'function test() {}' },
        { name: 'TestClass', type: 'class', file: 'test.ts', line: 10, score: 0.8 },
      ],
      total: 2,
      loading: false,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText('testFunc')).toBeInTheDocument();
      expect(screen.getByText('TestClass')).toBeInTheDocument();
      // "2 results found" has 2 inside <strong>, use function matcher
      expect(screen.getByText((content) => content.includes('result') && content.includes('found'))).toBeInTheDocument();
    });
  });

  it('should show detail panel on result click', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [
        { name: 'testFunc', type: 'function', file: 'test.ts', line: 42, score: 0.9, snippet: 'code here' },
      ],
      total: 1,
      loading: false,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText('testFunc')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('testFunc'));

    await waitFor(() => {
      // Detail panel should show type info — the type badge AND the detail panel label
      expect(screen.getByText('code here')).toBeInTheDocument();
    });
  });

  it('should show error state', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [],
      total: 0,
      loading: false,
      error: 'Search API unavailable',
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(/Search failed/)).toBeInTheDocument();
    });
  });

  it('should filter by type', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [
        { name: 'testFunc', type: 'function', file: 'a.ts', line: 1, score: 0.9 },
        { name: 'TestClass', type: 'class', file: 'b.ts', line: 1, score: 0.8 },
      ],
      total: 2,
      loading: false,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText('testFunc')).toBeInTheDocument();
    });

    // Change filter to classes
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'class' } });

    await waitFor(() => {
      expect(screen.queryByText('testFunc')).not.toBeInTheDocument();
      expect(screen.getByText('TestClass')).toBeInTheDocument();
    });
  });

  it('should show loading spinner while searching', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [],
      total: 0,
      loading: true,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'loading' } });

    await waitFor(() => {
      expect(screen.getByText('⏳')).toBeInTheDocument();
    });
  });

  it('should show filtered count when type filter reduces results', async () => {
    vi.mocked(useSearch).mockReturnValue({
      results: [
        { name: 'testFunc', type: 'function', file: 'a.ts', line: 1, score: 0.9 },
        { name: 'TestClass', type: 'class', file: 'b.ts', line: 1, score: 0.8 },
      ],
      total: 2,
      loading: false,
      error: null,
      hasSearched: true,
    });

    const { default: SearchView } = await import('../components/SearchView');
    render(<SearchView />);

    const input = screen.getByPlaceholderText('Search symbols, files, or types...');
    fireEvent.change(input, { target: { value: 'test' } });

    // Change to function filter
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'function' } });

    await waitFor(() => {
      expect(screen.getByText(/filtered from 2/)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'ok',
        timestamp: '2025-01-01T00:00:00Z',
        uptime: 3600000,
        version: '0.1.0',
        name: 'code-analyzer',
        environment: 'production',
        checks: {
          server: { status: 'ok', uptime: 3600000 },
          memory: { status: 'ok', heapUsedMB: 45, heapTotalMB: 200, rssMB: 128 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 1247, edges: 3892, files: 215 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    vi.mocked(useAnalyze).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      analyze: vi.fn(),
    });
  });

  it('should show loading spinner when loading', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();
  });

  it('should show stats grid with data', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      // Stats grid cards have unique labels
      expect(screen.getByText('Nodes')).toBeInTheDocument();
      expect(screen.getByText('Edges')).toBeInTheDocument();
      expect(screen.getByText('Files')).toBeInTheDocument();
    });

    // "1,247" appears in both stats grid and graph statistics card
    const nodeCounts = screen.getAllByText('1,247');
    expect(nodeCounts.length).toBeGreaterThanOrEqual(1);
    const edgeCounts = screen.getAllByText('3,892');
    expect(edgeCounts.length).toBeGreaterThanOrEqual(1);
  });

  it('should show server status badge', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Server Status')).toBeInTheDocument();
      // The badge "ok" is inside .badge span — use getAllByText
      const badges = screen.getAllByText('ok');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should show memory info', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Memory (RSS)')).toBeInTheDocument();
      expect(screen.getByText('128 MB')).toBeInTheDocument();
      expect(screen.getByText('45 MB')).toBeInTheDocument(); // heap used
    });
  });

  it('should show connection error banner', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: null,
      loading: false,
      error: 'Cannot reach server',
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Cannot connect to server/)).toBeInTheDocument();
      expect(screen.getByText(/Cannot reach server/)).toBeInTheDocument();
    });
  });

  it('should show Quick Actions', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Quick Actions')).toBeInTheDocument();
      expect(screen.getByText('New Analysis')).toBeInTheDocument();
      expect(screen.getByText('Search Codebase')).toBeInTheDocument();
    });
  });

  it('should show graph statistics', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Graph Statistics')).toBeInTheDocument();
      expect(screen.getByText('Total Nodes')).toBeInTheDocument();
      expect(screen.getByText('Total Edges')).toBeInTheDocument();
    });
  });

  it('should show N/A density when nodes is 0', async () => {
    vi.mocked(useGraphStats).mockReturnValue({
      data: { nodes: 0, edges: 0, files: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  it('should show analyze error', async () => {
    vi.mocked(useAnalyze).mockReturnValue({
      data: null,
      loading: false,
      error: 'Analysis failed!',
      analyze: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Analysis error/)).toBeInTheDocument();
    });
  });

  it('should increment search count on Search Codebase click', async () => {
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Search Codebase')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Search Codebase'));

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument(); // search count incremented
    });
  });

  it('should show degraded status when health is degraded', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'degraded',
        timestamp: '',
        uptime: 1000,
        version: '',
        name: '',
        environment: '',
        checks: {
          server: { status: 'ok', uptime: 1000 },
          memory: { status: 'warn', heapUsedMB: 190, heapTotalMB: 200, rssMB: 250 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('degraded')).toBeInTheDocument();
    });
  });

  it('should show memory warning status', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'ok',
        timestamp: '',
        uptime: 1000,
        version: '',
        name: '',
        environment: '',
        checks: {
          server: { status: 'ok', uptime: 1000 },
          memory: { status: 'warn', heapUsedMB: 190, heapTotalMB: 200, rssMB: 250 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('warn')).toBeInTheDocument();
    });
  });

  it('should handle cancel on New Analysis prompt', async () => {
    // prompt returns null when cancelled
    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('New Analysis')).toBeInTheDocument();
    });

    // Clicking New Analysis triggers prompt which returns null in jsdom
    fireEvent.click(screen.getByText('New Analysis'));
    // Should not crash — component handles null path gracefully
    await waitFor(() => {
      expect(screen.getByText('New Analysis')).toBeInTheDocument();
    });
  });

  it('should show N/A for system info when health is null', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      // With null health, memory should show N/A
      const naElements = screen.getAllByText('N/A');
      expect(naElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should show days in uptime for long-running server', async () => {
    vi.mocked(useApiHealth).mockReturnValue({
      data: {
        status: 'ok',
        timestamp: '',
        uptime: 90000000, // 25 hours
        version: '0.1.0',
        name: 'code-analyzer',
        environment: 'production',
        checks: {
          server: { status: 'ok', uptime: 90000000 },
          memory: { status: 'ok', heapUsedMB: 50, heapTotalMB: 200, rssMB: 100 },
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { default: Dashboard } = await import('../components/Dashboard');
    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/1d/)).toBeInTheDocument();
    });
  });
});
