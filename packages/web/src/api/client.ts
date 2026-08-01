// @code-analyzer/web — API Client
// Type-safe client for the code-analyzer HTTP server API.

// @ts-expect-error Vite provides import.meta.env at build time
const API_BASE: string = import.meta.env?.VITE_API_BASE ?? '/api/v1';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body
    }
    const msg =
      (body as { message?: string })?.message ??
      `HTTP ${res.status}: ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Health types & API
// ---------------------------------------------------------------------------

export interface MemoryCheck {
  status: 'ok' | 'warn';
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  name: string;
  environment: string;
  checks: {
    server: { status: 'ok'; uptime: number };
    memory: MemoryCheck;
  };
}

export interface ServiceInfo {
  service: string;
  version: string;
  docs: string;
  health: string;
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export async function getApiHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(`${API_BASE}/health`);
}

export async function getServiceInfo(): Promise<ServiceInfo> {
  return request<ServiceInfo>('/');
}

// ---------------------------------------------------------------------------
// Tool types & API
// ---------------------------------------------------------------------------

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
}

export interface ToolListResponse {
  total: number;
  tools: ToolInfo[];
}

export interface ToolCallResultItem {
  type: 'text' | 'resource' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolCallResponse {
  tool: string;
  success: boolean;
  isError?: boolean;
  content: ToolCallResultItem[];
}

export async function getToolList(): Promise<ToolListResponse> {
  return request<ToolListResponse>(`${API_BASE}/tools/list`);
}

export async function callTool(
  tool: string,
  args?: Record<string, unknown>,
): Promise<ToolCallResponse> {
  return request<ToolCallResponse>(`${API_BASE}/tools/call`, {
    method: 'POST',
    body: JSON.stringify({ tool, args: args ?? {} }),
  });
}

// ---------------------------------------------------------------------------
// Domain-specific API helpers
// ---------------------------------------------------------------------------

export interface GraphStats {
  nodes: number;
  edges: number;
  files: number;
  projects?: string[];
}

/** Parse the content array from a tool call response into a string. */
function parseFirstText(content: ToolCallResultItem[]): string {
  for (const item of content) {
    if (item.type === 'text' && item.text) return item.text;
  }
  return '';
}

/** Try to parse tool response text as JSON, fall back to raw string. */
function parseToolJSON<T>(content: ToolCallResultItem[]): T | null {
  const text = parseFirstText(content);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function getIndexStatus(projectId?: string): Promise<GraphStats> {
  const res = await callTool('index_status', projectId ? { projectId } : {});
  const data = parseToolJSON<{
    nodes?: number;
    edges?: number;
    files?: number;
    projects?: string[];
    projectCount?: number;
  }>(res.content);

  if (data) {
    return {
      nodes: data.nodes ?? 0,
      edges: data.edges ?? 0,
      files: data.files ?? 0,
      projects: data.projects,
    };
  }

  // Fallback: try to parse from raw text
  const text = parseFirstText(res.content);
  return { nodes: 0, edges: 0, files: 0, projects: text ? [text] : [] };
}

export interface SearchResult {
  name: string;
  type: string;
  file: string;
  line: number;
  score?: number;
  snippet?: string;
  qualifiedName?: string;
}

export interface SearchResults {
  results: SearchResult[];
  total: number;
  query: string;
}

export async function searchCode(
  query: string,
  options?: { limit?: number; typeFilter?: string; projectId?: string },
): Promise<SearchResults> {
  const args: Record<string, unknown> = { query };
  if (options?.limit) args['limit'] = options.limit;
  if (options?.projectId) args['projectId'] = options.projectId;

  const res = await callTool('search_code', args);

  // Try to parse as structured response
  const data = parseToolJSON<SearchResults>(res.content);
  if (data) return data;

  // Fallback: build results from raw text
  return { results: [], total: 0, query };
}

export interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

export async function searchGraph(
  query: string,
  options?: { limit?: number; projectId?: string },
): Promise<GraphData> {
  const args: Record<string, unknown> = { query };
  if (options?.limit) args['limit'] = options.limit;
  if (options?.projectId) args['projectId'] = options.projectId;

  const res = await callTool('search_graph', args);
  const data = parseToolJSON<GraphData>(res.content);
  return data ?? { nodes: [], edges: [] };
}

export async function listProjects(): Promise<
  Array<{ id: string; name: string; path: string; status: string; timestamp?: string }>
> {
  const res = await callTool('list_projects');
  const data = parseToolJSON<
    Array<{ id: string; name: string; path: string; status: string; timestamp?: string }>
  >(res.content);
  return data ?? [];
}

export interface AnalyzeResult {
  projectId?: string;
  status: string;
  message?: string;
  nodes?: number;
  edges?: number;
  files?: number;
}

export async function analyzeRepository(
  path: string,
  options?: { projectName?: string },
): Promise<AnalyzeResult> {
  const args: Record<string, unknown> = { path };
  if (options?.projectName) args['projectName'] = options.projectName;

  const res = await callTool('analyze_repository', args);
  const data = parseToolJSON<AnalyzeResult>(res.content);
  return data ?? { status: 'unknown' };
}
