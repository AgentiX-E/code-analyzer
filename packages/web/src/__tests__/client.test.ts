// @code-analyzer/web — API Client Tests
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to mock fetch before importing the module
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Health endpoints
// ---------------------------------------------------------------------------

describe('getHealth', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should return health response on success', async () => {
    const healthData = {
      status: 'ok',
      timestamp: '2025-01-01T00:00:00Z',
      uptime: 123456,
      version: '0.1.0',
      name: 'code-analyzer',
      environment: 'production',
      checks: {
        server: { status: 'ok', uptime: 123456 },
        memory: { status: 'ok', heapUsedMB: 50, heapTotalMB: 200, rssMB: 150 },
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(healthData),
    });

    const result = await client.getHealth();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBe(123456);
    expect(result.checks.memory.heapUsedMB).toBe(50);
  });

  it('should throw ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ message: 'Server down' }),
    });

    try {
      await client.getHealth();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(client.ApiError);
      expect((err as client.ApiError).status).toBe(503);
      expect((err as client.ApiError).message).toBe('Server down');
    }
  });

  it('should throw NetworkError on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    try {
      await client.getHealth();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(client.NetworkError);
      expect((err as client.NetworkError).message).toBe('Connection refused');
    }
  });

  it('should throw NetworkError on non-Error fetch failure', async () => {
    mockFetch.mockRejectedValueOnce('just a string error');

    try {
      await client.getHealth();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(client.NetworkError);
      expect((err as client.NetworkError).message).toBe('Network request failed');
    }
  });

  it('should handle non-JSON error body gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('Not JSON')),
    });

    try {
      await client.getHealth();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(client.ApiError);
      expect((err as client.ApiError).message).toContain('HTTP 500');
    }
  });
});

describe('getApiHealth', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should fetch from /api/v1/health', async () => {
    mockFetch.mockResolvedValueOnce({
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

    await client.getApiHealth();
    const url = mockFetch.mock.calls[0]![0];
    expect(url).toContain('/api/v1/health');
  });
});

describe('getServiceInfo', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should return service info from root endpoint', async () => {
    const info = { service: 'code-analyzer', version: '0.1.0', docs: '/api/v1/tools/list', health: '/api/v1/health' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(info),
    });

    const result = await client.getServiceInfo();
    expect(result.service).toBe('code-analyzer');
    expect(result.version).toBe('0.1.0');
  });
});

// ---------------------------------------------------------------------------
// Tool endpoints
// ---------------------------------------------------------------------------

describe('getToolList', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should return tool list', async () => {
    const toolList = {
      total: 3,
      tools: [
        { name: 'search_code', description: 'Search code', category: 'analysis' },
        { name: 'analyze_repository', description: 'Analyze repo', category: 'all' },
        { name: 'index_status', description: 'Get status', category: 'all' },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(toolList),
    });

    const result = await client.getToolList();
    expect(result.total).toBe(3);
    expect(result.tools).toHaveLength(3);
    expect(result.tools[0]!.name).toBe('search_code');
  });

  it('should throw on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Error',
      json: () => Promise.resolve({ message: 'fail' }),
    });

    try {
      await client.getToolList();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(client.ApiError);
    }
  });
});

describe('callTool', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should call a tool with args', async () => {
    const response = {
      tool: 'search_code',
      success: true,
      isError: false,
      content: [{ type: 'text' as const, text: 'result' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const result = await client.callTool('search_code', { query: 'test' });
    expect(result.tool).toBe('search_code');
    expect(result.success).toBe(true);
    expect(result.content[0]!.text).toBe('result');

    // Verify request body
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.tool).toBe('search_code');
    expect(body.args.query).toBe('test');
  });

  it('should call a tool without args', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tool: 'list', success: true, content: [] }),
    });

    await client.callTool('list');
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args).toEqual({});
  });

  it('should handle tool error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'bad_tool',
          success: false,
          isError: true,
          content: [{ type: 'text', text: 'Tool not found' }],
        }),
    });

    const result = await client.callTool('bad_tool');
    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Domain-specific helpers
// ---------------------------------------------------------------------------

describe('getIndexStatus', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should parse structured index status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 100, edges: 200, files: 50 }) }],
        }),
    });

    const result = await client.getIndexStatus();
    expect(result.nodes).toBe(100);
    expect(result.edges).toBe(200);
    expect(result.files).toBe(50);
  });

  it('should handle missing fields with zeros', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({}) }],
        }),
    });

    const result = await client.getIndexStatus();
    expect(result.nodes).toBe(0);
    expect(result.edges).toBe(0);
    expect(result.files).toBe(0);
  });

  it('should return zeros on unparseable content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: 'Not JSON' }],
        }),
    });

    const result = await client.getIndexStatus();
    expect(result.nodes).toBe(0);
    expect(result.edges).toBe(0);
    expect(result.files).toBe(0);
  });

  it('should handle empty content array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [],
        }),
    });

    const result = await client.getIndexStatus();
    expect(result.nodes).toBe(0);
    expect(result.edges).toBe(0);
    expect(result.files).toBe(0);
  });

  it('should pass projectId when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'index_status',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: 1, edges: 0, files: 1 }) }],
        }),
    });

    await client.getIndexStatus('my-project');
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.projectId).toBe('my-project');
  });
});

describe('searchCode', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should search with query and options', async () => {
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
                results: [{ name: 'foo', type: 'function', file: 'a.ts', line: 1 }],
                total: 1,
                query: 'foo',
              }),
            },
          ],
        }),
    });

    const result = await client.searchCode('foo', { limit: 10 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.name).toBe('foo');
    expect(result.total).toBe(1);

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.query).toBe('foo');
    expect(body.args['limit']).toBe(10);
  });

  it('should return empty results on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_code',
          success: true,
          content: [{ type: 'text', text: 'error occurred' }],
        }),
    });

    const result = await client.searchCode('nothing');
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('searchGraph', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should return graph data', async () => {
    const graphData = {
      nodes: [{ id: '1', label: 'App', type: 'class' }],
      edges: [{ source: '1', target: '2', type: 'import' }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_graph',
          success: true,
          content: [{ type: 'text', text: JSON.stringify(graphData) }],
        }),
    });

    const result = await client.searchGraph('*');
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0]!.label).toBe('App');
  });

  it('should return empty graph on unparseable content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_graph',
          success: true,
          content: [],
        }),
    });

    const result = await client.searchGraph('*');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should handle options without projectId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_graph',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: [], edges: [] }) }],
        }),
    });

    await client.searchGraph('*', { limit: 20 });
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args['limit']).toBe(20);
    expect(body.args['projectId']).toBeUndefined();
  });

  it('should pass projectId when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'search_graph',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ nodes: [], edges: [] }) }],
        }),
    });

    await client.searchGraph('*', { projectId: 'p1' });
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args['projectId']).toBe('p1');
  });
});

describe('listProjects', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should list projects', async () => {
    const projects = [{ id: '1', name: 'test', path: '/test', status: 'indexed' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'list_projects',
          success: true,
          content: [{ type: 'text', text: JSON.stringify(projects) }],
        }),
    });

    const result = await client.listProjects();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('test');
  });

  it('should return empty array when content is unparseable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'list_projects',
          success: true,
          content: [{ type: 'text', text: 'garbage' }],
        }),
    });

    const result = await client.listProjects();
    expect(result).toEqual([]);
  });
});

describe('analyzeRepository', () => {
  let client: typeof import('../api/client');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    client = await import('../api/client');
  });

  it('should analyze a repository', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'analyze_repository',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ projectId: 'p1', status: 'completed', nodes: 50, edges: 100, files: 10 }) }],
        }),
    });

    const result = await client.analyzeRepository('/path/to/repo', { projectName: 'my-repo' });
    expect(result.status).toBe('completed');
    expect(result.nodes).toBe(50);

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args.path).toBe('/path/to/repo');
    expect(body.args['projectName']).toBe('my-repo');
  });

  it('should return unknown status when content unparseable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'analyze_repository',
          success: true,
          content: [],
        }),
    });

    const result = await client.analyzeRepository('/bad');
    expect(result.status).toBe('unknown');
  });

  it('should analyze without projectName', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tool: 'analyze_repository',
          success: true,
          content: [{ type: 'text', text: JSON.stringify({ status: 'running' }) }],
        }),
    });

    await client.analyzeRepository('/path');
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
    expect(body.args['projectName']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('should be an instance of Error', async () => {
    const { ApiError } = await import('../api/client');
    const err = new ApiError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
  });
});

describe('NetworkError', () => {
  it('should be an instance of Error', async () => {
    const { NetworkError } = await import('../api/client');
    const err = new NetworkError('Offline');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe('Offline');
  });
});
