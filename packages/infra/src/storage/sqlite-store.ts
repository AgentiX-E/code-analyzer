// @code-analyzer/infra — SQLite Store (Stub)

import type { GraphNode, GraphEdge, PaginatedResult } from '@code-analyzer/shared';

export class SqliteStore {
  constructor(_dbPath: string = ':memory:') {}

  // Node operations
  async insertNode(_node: GraphNode): Promise<number> { return 0; }
  async insertNodes(_nodes: GraphNode[]): Promise<number[]> { return []; }
  async getNode(_id: number): Promise<GraphNode | null> { return null; }
  async queryNodes(_query: Record<string, unknown>): Promise<PaginatedResult<GraphNode>> {
    return { items: [], total: 0, offset: 0, limit: 20, hasMore: false };
  }

  // Edge operations
  async insertEdge(_edge: GraphEdge): Promise<number> { return 0; }
  async insertEdges(_edges: GraphEdge[]): Promise<number[]> { return []; }
  
  // FTS5
  async searchFts(_query: string, _limit: number = 20): Promise<GraphNode[]> { return []; }
  
  // Graph
  async bfs(_sourceId: number, _maxDepth: number): Promise<GraphNode[]> { return []; }
  async validateIntegrity(_projectId: string): Promise<{ violations: string[] }> {
    return { violations: [] };
  }
  
  // Transaction
  transaction<T>(_fn: () => T): T { return _fn(); }
  
  close(): void {}
}
