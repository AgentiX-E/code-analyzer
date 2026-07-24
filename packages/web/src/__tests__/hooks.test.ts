// @code-analyzer/web — Hooks Tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// useApiHealth
// ---------------------------------------------------------------------------

describe('useApiHealth', () => {
  it('should start with loading=true and data=null', async () => {
    // Don't resolve immediately — keep loading state
    let resolveFetch: (v: unknown) => void = () => {};
    const promise = new Promise((resolve) => { resolveFetch = resolve; });
    mockFetch.mockReturnValueOnce(promise);

    const { useApiHealth } = await import('../hooks/useApiHealth');
    const { result, unmount } = renderHook(() => useApiHealth(5000));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    // Resolve to clean up
    resolveFetch({
      ok: true,
      json: () => Promise.resolve({
        status: 'ok', timestamp: '', uptime: 0, version: '', name: '', environment: '',
        checks: {
          server: { status: 'ok', uptime: 0 },
          memory: { status: 'ok', heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 },
        },
      }),
    });
    await act(async () => { /* flush */ });
    unmount();
  });

  it('should set data on successful fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          timestamp: '2025-01-01T00:00:00Z',
          uptime: 1000,
          version: '0.1.0',
          name: 'test',
          environment: 'dev',
          checks: {
            server: { status: 'ok' as const, uptime: 1000 },
            memory: { status: 'ok' as const, heapUsedMB: 10, heapTotalMB: 100, rssMB: 50 },
          },
        }),
    });

    const { useApiHealth } = await import('../hooks/useApiHealth');
    const { result, unmount } = renderHook(() => useApiHealth(60000));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.status).toBe('ok');
    expect(result.current.data!.uptime).toBe(1000);
    expect(result.current.error).toBeNull();

    unmount();
  });

  it('should set error on failed fetch', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useApiHealth } = await import('../hooks/useApiHealth');
    const { result, unmount } = renderHook(() => useApiHealth(60000));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Network error');

    unmount();
  });

  it('should support refetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          timestamp: '',
          uptime: 0,
          version: '',
          name: '',
          environment: '',
          checks: {
            server: { status: 'ok' as const, uptime: 0 },
            memory: { status: 'ok' as const, heapUsedMB: 0, heapTotalMB: 0, rssMB: 0 },
          },
        }),
    });

    const { useApiHealth } = await import('../hooks/useApiHealth');
    const { result, unmount } = renderHook(() => useApiHealth(60000));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCount = mockFetch.mock.calls.length;

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(initialCount + 1);
    });

    unmount();
  });
});

// ---------------------------------------------------------------------------
// useToolList
// ---------------------------------------------------------------------------

describe('useToolList', () => {
  it('should fetch and group tools by category', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          total: 3,
          tools: [
            { name: 'search_code', description: 'Search', category: 'analysis' },
            { name: 'index_status', description: 'Status', category: 'all' },
            { name: 'review_pr', description: 'Review', category: 'analysis' },
          ],
        }),
    });

    const { useToolList } = await import('../hooks/useToolList');
    const { result } = renderHook(() => useToolList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toHaveLength(3);
    expect(result.current.byCategory['analysis']).toHaveLength(2);
    expect(result.current.byCategory['all']).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('should set error on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed'));

    const { useToolList } = await import('../hooks/useToolList');
    const { result } = renderHook(() => useToolList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed');
    expect(result.current.data).toEqual([]);
  });

  it('should handle empty tool list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ total: 0, tools: [] }),
    });

    const { useToolList } = await import('../hooks/useToolList');
    const { result } = renderHook(() => useToolList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toHaveLength(0);
    expect(result.current.byCategory).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// useSearch
// ---------------------------------------------------------------------------

describe('useSearch', () => {
  it('should not search for empty query', async () => {
    const { useSearch } = await import('../hooks/useSearch');
    const { result } = renderHook(() => useSearch('', { debounceMs: 100 }));

    // Empty query should not trigger loading
    expect(result.current.loading).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.hasSearched).toBe(false);
  });

  it('should search after debounce', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_code',
          success: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [{ name: 'testFn', type: 'function', file: 'test.ts', line: 1 }],
                total: 1,
                query: 'test',
              }),
            },
          ],
        }),
    });

    const { useSearch } = await import('../hooks/useSearch');
    const { result, rerender } = renderHook(
      ({ q }) => useSearch(q, { debounceMs: 10 }),
      { initialProps: { q: '' } },
    );

    // Start with empty
    expect(result.current.loading).toBe(false);

    // Change query
    rerender({ q: 'test' });
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 5000 });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]!.name).toBe('testFn');
    expect(result.current.total).toBe(1);
    expect(result.current.hasSearched).toBe(true);
  });

  it('should set error on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Search failed'));

    const { useSearch } = await import('../hooks/useSearch');
    const { result, rerender } = renderHook(
      ({ q }) => useSearch(q, { debounceMs: 10 }),
      { initialProps: { q: '' } },
    );

    rerender({ q: 'bad' });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 5000 });

    expect(result.current.error).toBe('Search failed');
    expect(result.current.results).toEqual([]);
  });

  it('should pass limit and projectId options', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_code',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ results: [], total: 0, query: 'x' }) }],
        }),
    });

    const { useSearch } = await import('../hooks/useSearch');
    const { rerender } = renderHook(
      ({ q, o }) => useSearch(q, o),
      { initialProps: { q: '', o: { debounceMs: 10, limit: 10, projectId: 'p1' } } },
    );

    rerender({ q: 'x', o: { debounceMs: 10, limit: 10, projectId: 'p1' } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    }, { timeout: 5000 });

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.query).toBe('x');
    expect(body.args['limit']).toBe(10);
    expect(body.args['projectId']).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// useGraphStats
// ---------------------------------------------------------------------------

describe('useGraphStats', () => {
  it('should fetch graph stats', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 42, edges: 99, files: 7 }) }],
        }),
    });

    const { useGraphStats } = await import('../hooks/useGraphStats');
    const { result } = renderHook(() => useGraphStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.nodes).toBe(42);
    expect(result.current.data!.edges).toBe(99);
    expect(result.current.data!.files).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it('should pass projectId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 1, edges: 0, files: 1 }) }],
        }),
    });

    const { useGraphStats } = await import('../hooks/useGraphStats');
    renderHook(() => useGraphStats('my-proj'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.projectId).toBe('my-proj');
  });

  it('should work without projectId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 5, edges: 10, files: 2 }) }],
        }),
    });

    const { useGraphStats } = await import('../hooks/useGraphStats');
    const { result } = renderHook(() => useGraphStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data!.nodes).toBe(5);
  });

  it('should set error on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Stats unavailable'));

    const { useGraphStats } = await import('../hooks/useGraphStats');
    const { result } = renderHook(() => useGraphStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Stats unavailable');
    expect(result.current.data).toBeNull();
  });

  it('should support refetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 0, edges: 0, files: 0 }) }],
        }),
    });

    const { useGraphStats } = await import('../hooks/useGraphStats');
    const { result } = renderHook(() => useGraphStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCount = mockFetch.mock.calls.length;

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(initialCount + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// useAnalyze
// ---------------------------------------------------------------------------

describe('useAnalyze', () => {
  it('should analyze a repository on demand', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'analyze_repository',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ projectId: 'p1', status: 'completed', nodes: 10, edges: 20, files: 3 }) }],
        }),
    });

    const { useAnalyze } = await import('../hooks/useAnalyze');
    const { result } = renderHook(() => useAnalyze());

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    let analyzeResult: unknown;
    await act(async () => {
      analyzeResult = await result.current.analyze('/test/path');
    });

    expect(analyzeResult).not.toBeNull();
    expect((analyzeResult as Record<string, unknown>).status).toBe('completed');
    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.nodes).toBe(10);
  });

  it('should set error on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Analysis failed'));

    const { useAnalyze } = await import('../hooks/useAnalyze');
    const { result } = renderHook(() => useAnalyze());

    let analyzeResult: unknown;
    await act(async () => {
      analyzeResult = await result.current.analyze('/bad/path');
    });

    expect(analyzeResult).toBeNull();
    expect(result.current.error).toBe('Analysis failed');
  });

  it('should pass projectName', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'analyze_repository',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ status: 'completed' }) }],
        }),
    });

    const { useAnalyze } = await import('../hooks/useAnalyze');
    const { result } = renderHook(() => useAnalyze());

    await act(async () => {
      await result.current.analyze('/path', 'my-name');
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.path).toBe('/path');
    expect(body.args['projectName']).toBe('my-name');
  });
});
