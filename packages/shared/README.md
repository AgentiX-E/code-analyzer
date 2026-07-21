# @code-analyzer/shared

> Zero-dependency foundation layer — types, constants, and validation for the Code Analyzer knowledge graph platform.

[![npm](https://img.shields.io/npm/v/@code-analyzer/shared?color=blue)](https://www.npmjs.com/package/@code-analyzer/shared)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)

## Overview

`@code-analyzer/shared` is the foundational package upon which the entire Code Analyzer ecosystem is built. It provides the canonical type definitions for the knowledge graph, a unified capture tag system for tree-sitter AST extraction, pre-computed constant lookup tables, and comprehensive validation utilities. Every other package in the monorepo depends on these definitions, making `shared` the single source of truth for all domain types.

### Architecture

```
@code-analyzer/shared (Layer 0 - Foundation)
│
├── types/
│   ├── graph.ts          — Knowledge graph types (Node, Edge, Pipeline, Config, etc.)
│   └── capture-tags.ts   — Unified tree-sitter capture tag definitions
│
├── constants/index.ts    — Lookup tables (node tables, inverses, extensions, compatible edges)
│
└── validation/index.ts   — Graph, config, review, standard & report validators
```

## Installation

```bash
npm install @code-analyzer/shared
```

Requires Node.js >= 22.

## Key Exports

| Category | Exports | Description |
|----------|---------|-------------|
| **Node Labels** | `NODE_LABELS`, `NodeLabel` | 33 distinct code entity types (Class, Function, Interface, Route, etc.) |
| **Relationship Types** | `RELATIONSHIP_TYPES`, `RelationshipType` | 39 edge types (CONTAINS, CALLS, EXTENDS, DATA_FLOWS, TAINT_PATH, etc.) |
| **Capture Tags** | `CAPTURE_TAGS`, `CaptureTag`, `UnifiedCapture` | Language-agnostic AST capture tags |
| **Graph Primitives** | `GraphNode`, `GraphEdge`, `KnowledgeGraph`, `PipelinePhase`, `PipelineContext` | Core graph data structures |
| **Constants** | `NODE_TABLES`, `REL_INVERSES`, `LANGUAGE_EXTENSIONS`, `COMPATIBLE_EDGES` | Pre-computed lookup tables |
| **Validation** | `validateNodeProperties`, `validateEdgeCompatibility`, `validateConfig`, `validateReviewComment`, `validateStandard`, `validateReport` | Runtime validation utilities |
| **Guards** | `isNodeLabel`, `isRelationshipType`, `getLanguageFromFilename` | Type guard and utility functions |

## Usage

### Type Guards

```typescript
import { isNodeLabel, isRelationshipType, getLanguageFromFilename } from '@code-analyzer/shared';

// Validate node labels at runtime
if (isNodeLabel('Class')) {
  // TypeScript narrows to NodeLabel
}

// Detect language from file extension
const lang = getLanguageFromFilename('src/app.ts');
// lang === 'typescript'

const unknown = getLanguageFromFilename('README.md');
// unknown === null
```

### Graph Validation

```typescript
import { validateNodeProperties, validateEdgeCompatibility } from '@code-analyzer/shared';

// Validate node properties
const errors = validateNodeProperties('Class', {
  name: 'UserService',
  visibility: 'public',
});
// errors === [] (valid)

const bad = validateNodeProperties('File', {});
// [ 'Missing required property "filePath" for label "File"' ]

// Validate edge semantics
const valid = validateEdgeCompatibility('Class', 'Method', 'HAS_METHOD');
// valid === true

const invalid = validateEdgeCompatibility('File', 'Route', 'EXTENDS');
// invalid === false (EXTENDS only works between Class-Class, etc.)
```

### Configuration Validation

```typescript
import { validateConfig } from '@code-analyzer/shared';

const errors = validateConfig({
  projectId: 'my-project',
  rootPath: '/src',
  excludePatterns: ['node_modules/**'],
  includePatterns: [],
  maxFileSize: 10485760,
  maxFiles: 50000,
  parseWorkers: 4,
  ignorePaths: ['node_modules'],
});
// errors === [] (valid config)
```

### Knowledge Graph Types

```typescript
import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

// GraphNode has 20 fields including id, label, qualifiedName, filePath,
// signature, docstring, complexity, fingerprint, and rich NodeProperties
const node: GraphNode = {
  id: 1,
  projectId: 'proj-1',
  label: 'Function',
  name: 'calculateTotal',
  qualifiedName: 'src/utils.ts#calculateTotal',
  filePath: 'src/utils.ts',
  startLine: 42,
  endLine: 58,
  language: 'typescript',
  properties: { isAsync: false, visibility: 'public' },
  signature: 'calculateTotal(items: Item[]): number',
  docstring: 'Computes the total price of a collection of items.',
  complexity: 3,
  isExported: true,
  fingerprint: 'sha256:abc123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
```

## Configuration Reference

The `CodeAnalyzerConfig` interface defines the full configuration schema:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectId` | `string` | Yes | — | Unique project identifier |
| `rootPath` | `string` | Yes | — | Root directory of the project |
| `language` | `SupportedLanguage` | No | — | Target language |
| `excludePatterns` | `string[]` | Yes | — | Glob patterns to exclude |
| `includePatterns` | `string[]` | Yes | — | Glob patterns to include |
| `maxFileSize` | `number` | Yes | — | Max file size in bytes |
| `maxFiles` | `number` | Yes | — | Max files to process |
| `parseWorkers` | `number` | Yes | — | Parallel parsing workers |
| `cacheDir` | `string` | No | — | Cache directory path |
| `ignorePaths` | `string[]` | Yes | — | Directory names to ignore |
| `mcp` | `MCPServerConfig` | No | — | MCP server settings |
| `review` | `object` | No | — | Review engine settings |
| `embed` | `object` | No | — | Embedding model settings |
| `pruner` | `object` | No | — | Symbol pruning settings |

## Supported Languages

The package defines types for 18 languages, with 8 having file extension mappings:

| Language | Extensions |
|----------|------------|
| `typescript` | `.ts`, `.tsx`, `.mts`, `.cts` |
| `javascript` | `.js`, `.jsx`, `.mjs`, `.cjs` |
| `python` | `.py`, `.pyi`, `.pyx`, `.pxd` |
| `go` | `.go` |
| `java` | `.java` |
| `kotlin` | `.kt`, `.kts` |
| `csharp` | `.cs`, `.csx` |
| `rust` | `.rs` |
| `c` | `.c`, `.h` |
| `cpp` | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` |
| `php` | `.php`, `.phtml` |
| `ruby` | `.rb`, `.rake`, `.gemspec` |
| `swift` | `.swift` |
| `dart` | `.dart` |
| `lua` | `.lua` |
| `scala` | `.scala`, `.sc` |
| `zig` | `.zig` |
| `elixir` | `.ex`, `.exs` |

## Package Dependencies

```
@code-analyzer/shared (Layer 0 — zero external dependencies)
  ▲
  ├── @code-analyzer/core    (Layer 1)
  ├── @code-analyzer/infra   (Layer 2)
  ├── @code-analyzer/analyzer (Layer 3)
  ├── @code-analyzer/cli     (Layer 4)
  └── @code-analyzer/server  (Layer 4)
```

No other packages. No runtime dependencies. Pure TypeScript types, constants, and validation logic.

## License

MIT

## Contributing

See the [CONTRIBUTING.md](../../CONTRIBUTING.md) in the repository root for guidelines on contributing to this monorepo.
