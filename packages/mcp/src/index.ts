// @code-analyzer/mcp — MCP Server (Stub)

export class CodeAnalyzerMCPServer {
  async startStdio(): Promise<void> { /* stub */ }
  async startHTTP(_port: number): Promise<void> { /* stub */ }
  async shutdown(): Promise<void> { /* stub */ }
}

export const MCP_TOOLS = [
  'analyze_repository', 'list_projects', 'delete_project', 'index_status',
  'search_graph', 'search_code', 'semantic_search', 'trace_call_path',
  'query_graph', 'get_code_snippet', 'get_architecture', 'get_graph_schema',
  'explore_symbol', 'find_implementations',
  'detect_changes', 'impact_analysis', 'route_map', 'check_cycles',
  'review_diff', 'review_file',
];
