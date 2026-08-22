# Web Dashboard

> Interactive web interface for code-analyzer — visualize knowledge graphs, search codebases, manage cross-repo analysis, and review pull requests.

## Quick Start

```bash
# Start the code-analyzer server
code-analyzer start

# In another terminal, start the web dashboard
cd packages/web
pnpm dev
```

The dashboard opens at `http://localhost:5173` with the dev server proxying API calls to the backend at `http://localhost:3000`.

## Views

### 1. Graph Explorer

Interactive force-directed visualization of the knowledge graph.

**Features:**

- **Pan & Zoom**: Drag to pan, scroll to zoom
- **Node Collapse**: Click nodes to collapse/expand their connections
- **Hover Tooltips**: Hover over nodes to see symbol details (name, file, type)
- **Legend**: Color-coded node types (Class, Function, Interface, etc.)
- **Fallback Data**: Demo graph displayed when the server is unavailable

**Implementation**: Custom SVG force-directed layout with repulsion, attraction, centering, and damping. Runs 200 iterations on load.

### 2. Search View

Full-text and semantic search across the indexed codebase.

**Features:**

- **Real-time Search**: 300ms debounced input with request cancellation
- **Type Filtering**: Client-side filtering by symbol type (Function, Class, Interface, etc.)
- **Relevance Scores**: Visual score bars for search results
- **Detail Panel**: Sticky side panel showing selected symbol details
- **Project Filtering**: Filter results by project ID

**Backend**: Uses the `search_code` MCP tool which combines BM25 keyword search with vector semantic search via Reciprocal Rank Fusion.

### 3. Dashboard

System overview with health monitoring and statistics.

**Features:**

- **Connection Status**: Real-time health check with configurable polling (default: 30s)
- **Stats Grid**: Nodes, edges, files, and search counts
- **Server Status**: Memory usage, uptime, version information
- **System Info**: Platform, Node.js version, hostname
- **Quick Actions**: View reports and export data
- **Graph Statistics**: Per-project breakdown of indexes

### 4. Cross-Repo Dashboard

Multi-repository analysis and management.

**Features:**

- **Stats Grid**: Monitored repos count, total symbols, cross-repo edges, API contracts
- **Repository Groups**: Create and manage groups of related repositories
- **Dependency Graph**: Visualize cross-repo dependencies
- **Version Compatibility**: Detect and resolve version conflicts across repos
- **Activity Feed**: Track cross-repo PRs and changes

### 5. PR Review Panel

Comprehensive pull request review interface.

**Features:**

- **PR Header**: PR number, title, repository, merge recommendation badge
- **Summary Stats**: Issue counts by severity (Critical/High/Medium/Low)
- **Cross-Repo Impact**: Dependencies and breaking changes across repositories
- **Findings List**: Expandable issue cards with severity indicators
- **Severity Filtering**: Filter issues by severity level
- **Suggestions**: Inline actionable recommendations
- **Recommendations**: Prioritized fix suggestions at the bottom

### 6. Repo Group Manager

Manage groups of related repositories for cross-repo analysis.

**Features:**

- **Sidebar**: List of all repo groups with create/delete actions
- **Create Form**: Inline form for creating new groups
- **Repo Management**: Add repos via GitHub URL or `owner/repo` format
- **Role Assignment**: Classify repos as Primary, Dependency, or Consumer
- **Actions**: Index all repos, sync from GitHub, export configuration

## API Client

The web dashboard communicates with the code-analyzer server via a typed API client (`packages/web/src/api/client.ts`):

```typescript
import { getHealth, searchCode, getIndexStatus } from '@code-analyzer/web';

// Check server health
const health = await getHealth();

// Search the codebase
const results = await searchCode('authentication', { limit: 20 });

// Get graph statistics
const stats = await getIndexStatus('my-project');
```

The client handles `NetworkError` and `ApiError` with typed error classes and proper HTTP status code handling.

## Hooks

| Hook            | Purpose                     | Type                   |
| --------------- | --------------------------- | ---------------------- |
| `useApiHealth`  | Monitor server health       | Polling (30s interval) |
| `useToolList`   | List available MCP tools    | Fetch-on-mount         |
| `useGraphStats` | Get graph index statistics  | Fetch-on-mount         |
| `useSearch`     | Debounced code search       | Debounced (300ms)      |
| `useAnalyze`    | Trigger repository analysis | On-demand action       |

## Styling

The dashboard uses a **dark theme** with CSS custom properties (24 design tokens):

- Background: `#0d1117` (primary), `#161b22` (secondary), `#21262d` (card)
- Text: `#e6edf3` (primary), `#8b949e` (secondary)
- Accent: `#58a6ff` (blue), semantic colors for success/warning/error
- Fonts: System font stack for UI, SF Mono / Fira Code for code
- Responsive: Breakpoints at 900px (tablet) and 600px (mobile)

## Building for Production

```bash
cd packages/web
pnpm build          # Builds to dist/
pnpm preview        # Preview production build locally
```

The production build is a static SPA served from `dist/`. Configure the API endpoint via the `VITE_API_BASE` environment variable.
