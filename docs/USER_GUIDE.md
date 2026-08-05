# Code Analyzer — User Guide

**Version**: 1.0.0  
**Author**: Lambertyan

## Quick Start

```bash
npm install -g @code-analyzer/cli
npx embed-code download
code-analyzer analyze ./your-project
code-analyzer mcp  # Start MCP server for AI agents
```

## MCP Server (45 tools)

Add to your AI agent config:
```json
{"mcpServers":{"code-analyzer":{"command":"npx","args":["@code-analyzer/mcp"]}}}
```

### Tool Categories
| Category | Tools | Description |
|----------|:---:|------|
| Indexing | 4 | analyze_repository, list_projects, delete_project, index_status |
| Querying | 10 | search_graph, search_code, semantic_search, trace_call_path, etc. |
| Change | 4 | detect_changes, impact_analysis, route_map, check_cycles |
| Review | 2 | review_diff, review_file |
| PR | 2 | review_pr, check_standards |
| Reports | 3 | generate_report, export_report, get_recommendations |
| Cross-Repo | 7 | cross_repo_search, cross_repo_trace, cross_repo_impact, etc. |
| Security | 3 | pdg_query, taint_analysis, explain_taint |
| Standards | 4 | list_standards, create_standard, manage_adr, install_skills |
| Intelligence | 5 | trend_analysis, hotspot_detection, refactor_suggestion, etc. |

## VS Code Extension

Copilot Chat Participant: `@code-analyzer /review`, `/explain`, `/impact`, `/find`, `/deps`, `/refactor`, `/test`, `/analyze`, `/coverage`, `/standards`

## CLI

```bash
code-analyzer analyze ./project    # Index a repository
code-analyzer search "function"    # Search knowledge graph
code-analyzer review ./src --diff  # Review staged changes
code-analyzer review-pr --from main --to feature
code-analyzer group create svcs    # Create cross-repo group
code-analyzer web --port 8080      # Start dashboard
```

## Code Review Rules (46+)
Security (10): SQL injection, XSS, command injection, path traversal, hardcoded secrets
Performance (7): N+1 queries, large allocations, sync I/O, inefficient loops
Maintainability (10): Function length, nesting depth, cyclomatic complexity
Style (7): Naming, formatting, import organization
Architecture (6): Circular deps, layer violations, god classes

## Security
- Taint Analysis: source -> sink vulnerability tracing
- Secret Scanner: 16 pattern categories + entropy detection
- PDG Queries: control/data dependence analysis

## Enterprise
- RBAC: 5 roles (viewer/auditor/developer/maintainer/admin), 26 permissions
- Audit: SHA-256 hash chain, tamper detection, JSON/CSV export
- Rate Limiting: Token bucket per key/tool

## Cross-Repository
```bash
code-analyzer group create my-services
code-analyzer group add my-services frontend ./frontend
code-analyzer group add my-services backend ./backend
code-analyzer group sync my-services
```

## Troubleshooting
- Index fails: check .gitignore and .code-analyzerignore
- Semantic search poor: run `npx embed-code download`
- MCP timeout: pre-index with `code-analyzer analyze`
- High memory: reduce cache sizes, disable embeddings for large repos
