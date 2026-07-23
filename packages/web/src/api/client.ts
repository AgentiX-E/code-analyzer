const API_BASE = 'http://localhost:3000';

export interface SearchResult {
  name: string;
  type: string;
  file: string;
  line: number;
  score: number;
  snippet?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  time_ms: number;
}

export interface StatusResponse {
  index: {
    nodes: number;
    edges: number;
    files: number;
  };
  recent: Array<{
    id: string;
    path: string;
    status: string;
    timestamp: string;
  }>;
  stats: {
    total_searches: number;
    avg_time_ms: number;
  };
  system: {
    node_version: string;
    os: string;
    memory_mb: number;
  };
}

export async function search(query: string, limit = 50): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/tools/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  return res.json();
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function analyze(path: string) {
  const res = await fetch(`${API_BASE}/tools/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return res.json();
}
