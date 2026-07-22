# @code-analyzer/web

> Web dashboard for browsing code intelligence results — knowledge graph visualization, search interface, and reports viewer.

[![npm](https://img.shields.io/npm/v/@code-analyzer/web?color=blue)](https://www.npmjs.com/package/@code-analyzer/web)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-purple?logo=vite)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19.0-blue?logo=react)](https://react.dev/)

---

## Overview

`@code-analyzer/web` is the web-based presentation layer of Code Analyzer. It provides a standalone dashboard for teams to explore code intelligence results outside the editor — ideal for code reviews, architecture discussions, and onboarding. Built with React 19 and Vite 6, it consumes data from the `@code-analyzer/intelligence` engine through a browser-accessible API layer.

The package serves as a read-only viewer for indexed codebases, rendering search results, knowledge graphs, and analysis reports in a fully interactive SPA.

```
+-------------------------------------------------------------------+
|                       Web Dashboard                                |
|  +-------------------------------------------------------------+  |
|  |  Header: [Logo] Search Bar...........  [Settings] [User]   |  |
|  +-------------------------------------------------------------+  |
|  |  Navigation  | Main Content Area                             |  |
|  |              |                                                |  |
|  |  [Dashboard] |  +-----------------------------------------+  |  |
|  |  [Search]    |  |                                         |  |  |
|  |  [Graph]     |  |   Knowledge Graph / Search Results /    |  |  |
|  |  [Reports]   |  |   Analysis Reports                      |  |  |
|  |  [Settings]  |  |                                         |  |  |
|  |              |  +-----------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
|                                                                     |
|  +-------------------------------------------------------------+  |
|  |  API Layer (REST / WebSocket)                                |  |
|  |  @code-analyzer/intelligence  →  search, graph, reports      |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

> **Note**: This package is a placeholder scaffold. Full implementation is planned for Iteration 4. The core foundations — React 19 + Vite 6 toolchain, project structure, and dependency wiring — are established. The following documentation describes the intended architecture and how to develop against it.

---

## Installation

```bash
# From the monorepo root
npm install

# Or install this package individually
npm install @code-analyzer/web
```

The package is marked as `"private": true` in `package.json` — it is not published to npm as a standalone library. It is built and deployed as a web application artifact.

---

## Quick Start

### Development Server

```bash
cd packages/web
npm run dev
```

Starts the Vite development server (default: `http://localhost:5173`) with HMR enabled.

### Production Build

```bash
npm run build
```

Outputs optimized static assets to `dist/`:

```
dist/
├── index.html
├── assets/
│   ├── index-*.js
│   └── index-*.css
└── ...
```

### Preview Production Build

```bash
npm run preview
```

Serves the production build locally for verification before deployment.

### Type Checking

```bash
npm run typecheck
```

Runs `tsc --noEmit` to validate types across the entire project.

### Running Tests

```bash
npm test
```

Executes the Vitest test suite.

---

## API Reference

The web package exposes its entry point at `src/index.ts`. Currently a placeholder scaffold, the planned exports are:

### Entry Point

```typescript
// Current state: placeholder
export {};

// Planned (Iteration 4):
// export { App } from './App.js';
// export { GraphView } from './views/GraphView.js';
// export { SearchView } from './views/SearchView.js';
// export { ReportsView } from './views/ReportsView.js';
// export { useCodeIntelligence } from './hooks/useCodeIntelligence.js';
// export type { GraphData, SearchResult, AnalysisReport } from './types.js';
```

### Planned Component Architecture

The dashboard will organize around these feature areas:

| Component | Description |
|---|---|
| `App` | Root component with routing and layout |
| `DashboardView` | Overview page with key metrics and recent activity |
| `GraphView` | Interactive knowledge graph visualization using a force-directed or hierarchical layout |
| `SearchView` | Full-text and semantic search across symbols, files, and types |
| `ReportsView` | Analysis reports with charts, metrics, and export options |
| `SettingsView` | Dashboard configuration (theme, refresh interval, connected projects) |

### Planned Hooks

```typescript
// Intended API shape (Iteration 4)

import { useCodeIntelligence } from '@code-analyzer/web';

const { search, graphData, reports, isLoading, error } = useCodeIntelligence({
  apiEndpoint: '/api',
  projectId: 'my-project',
});

// Search symbols
const results = await search('authentication');

// Subscribe to graph updates
useEffect(() => {
  // graphData updates reactively
}, [graphData]);

// Fetch analysis reports
const report = await reports.getLatest('complexity');
```

### Planned Data Types

```typescript
interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'module';
    filePath: string;
    metrics?: Record<string, number>;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: 'calls' | 'extends' | 'implements' | 'imports' | 'references';
    weight?: number;
  }>;
}

interface SearchResult {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: string;
  score: number;
  snippet: string;
}

interface AnalysisReport {
  id: string;
  title: string;
  type: 'code_review' | 'impact' | 'complexity' | 'dependency';
  generatedAt: string;
  summary: string;
  findings: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    location?: { filePath: string; line: number };
  }>;
  metrics: Record<string, number>;
}
```

---

## Architecture

### Dependency Graph

```
@code-analyzer/web
  ├── react         ^19.0.0   (UI framework)
  ├── react-dom     ^19.0.0   (DOM renderer)
  ├── vite          ^6.0.0    (build tool, dev server)
  └── @vitejs/plugin-react  ^4.3.0  (React Fast Refresh)
```

The package consumes `@code-analyzer/intelligence` for search and `@code-analyzer/shared` for type definitions (planned for Iteration 4 wiring).

### Build Pipeline

```
src/
├── index.ts              (entry point)
├── App.tsx               (root component)
├── components/           (shared UI components)
├── views/                (page-level views)
│   ├── DashboardView.tsx
│   ├── GraphView.tsx
│   ├── SearchView.tsx
│   └── ReportsView.tsx
├── hooks/                (React hooks)
│   └── useCodeIntelligence.ts
├── services/             (API client layer)
├── types/                (TypeScript type definitions)
└── utils/                (utility functions)
```

### Data Flow

```
User Action (click, search, filter)
  → React Component (state update)
    → Hook (useCodeIntelligence)
      → API Service (fetch / WebSocket)
        → Backend (@code-analyzer/intelligence)
          → Storage (@code-analyzer/infra InMemoryGraphStore)

Response flows back through the same chain, with React re-rendering
based on state changes.
```

---

## Development

```bash
# Install dependencies (from monorepo root)
npm install

# Start dev server with HMR
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run typecheck

# Run tests
npm test

# Clean artifacts
npm run clean
```

### Browser Support

The dashboard targets modern evergreen browsers:

| Browser | Minimum Version |
|---|---|
| Chrome | 90+ |
| Firefox | 90+ |
| Safari | 15+ |
| Edge | 90+ |

---

## Deployment

### Static Hosting (Recommended)

The production build outputs static files suitable for any CDN or static host:

```bash
npm run build
# Deploy dist/ to your host:
# - Vercel: npx vercel dist
# - Netlify: npx netlify deploy --dir=dist
# - AWS S3 + CloudFront
# - Nginx (serve dist/ as document root)
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL for the intelligence API |
| `VITE_WS_URL` | `ws://localhost:8080` | WebSocket endpoint for live updates |
| `VITE_APP_TITLE` | `Code Analyzer` | Browser tab title |

---

## Dependencies

| Package | Version | Role |
|---|---|---|
| `react` | ^19.0.0 | UI component library |
| `react-dom` | ^19.0.0 | DOM renderer for React |
| `@code-analyzer/shared` | workspace:* | Shared type definitions (planned) |
| `@code-analyzer/intelligence` | workspace:* | Intelligence engine: search, review, analysis (planned) |

**Dev dependencies**: `@types/react` & `@types/react-dom` (19.x), `@vitejs/plugin-react` (4.3), TypeScript 5.6, Vite 6, Vitest 2.1.

---

## Roadmap

| Iteration | Feature | Status |
|---|---|---|
| 4 | Full web dashboard with GraphView, SearchView, ReportsView | Not started |
| 4 | `useCodeIntelligence` hook with API client | Not started |
| 4 | WebSocket support for live graph updates | Not started |
| 5 | Multi-project dashboard | Not started |
| 5 | Team collaboration features (shared views, annotations) | Not started |

---

## License

MIT — see [LICENSE](./LICENSE)

## Links

- [Code Analyzer Documentation](../docs)
- [Contributing Guide](../CONTRIBUTING.md)
- [VS Code Extension](../vscode) — editor-based companion
- [Issue Tracker](https://github.com/agentix/code-analyzer/issues)
