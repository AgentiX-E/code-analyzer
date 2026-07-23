# @code-analyzer/analyzer

> The Analysis Engine — the heart of code-analyzer. Parses source code into a unified knowledge graph using regex-based language providers, a DAG pipeline, scope resolution, and graph construction.

[![npm](https://img.shields.io/npm/v/@code-analyzer/analyzer?color=blue)](https://www.npmjs.com/package/@code-analyzer/analyzer)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

## Overview

`@code-analyzer/analyzer` is Layer 3 of the code-analyzer stack. It transforms raw source files into a structured knowledge graph through four core subsystems:

1. **Language Providers** — Regex-based parsers for 8 languages that extract symbols, references, imports, and metadata.
2. **Pipeline Orchestrator** — A DAG-driven 18-phase execution engine that processes files from raw scan through to embeddings.
3. **Scope Resolver** — A 3-tier resolution engine that links references to definitions across files, packages, and the global scope.
4. **Graph Builder** — Constructs the full `KnowledgeGraph` with nodes, edges, qname indices, and file indices.

### Architecture

```
Source Files (.ts/.py/.go/...)
       │
       ▼
┌──────────────────┐
│  LanguageProvider │  8 language-specific parsers
│  (regex engine)   │  extracting UnifiedCapture[]
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  UnifiedParser    │  Worker-pool parallel dispatch
│  + WorkerPool     │  across all discovered files
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  PipelineOrchestrator (18-phase DAG)              │
│                                                    │
│  scan → structure → parse → markdown → config     │
│  → crossFile → scopeResolution → routes → tools   │
│  → di → pruneLocalSymbols → communities           │
│  → processes → tests → dump → similarity          │
│  → semantic → embed                                │
│                                                    │
│  Execution: Kahn's algorithm topological sort     │
│  Validation: cycle detection, missing deps        │
└────────┬──────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐    ┌──────────────────┐
│  ScopeResolver    │    │  GraphBuilder     │
│  3-tier resolve   │    │  graph + validate │
└────────┬─────────┘    └────────┬──────────┘
         │                       │
         ▼                       ▼
    ResolvedReferences     KnowledgeGraph
    ResolvedCalls          (nodes + edges +
    ResolvedImports         qnameIndex)
```

## Installation

```bash
npm install @code-analyzer/analyzer
```

Requires Node.js >= 18.

## Quick Start

```typescript
import {
  PipelineOrchestrator,
  UnifiedParser,
  ScopeResolver,
  GraphBuilder,
  TypeScriptProvider,
  PythonProvider,
  GoProvider,
  JavaScriptProvider,
  createAllPhases,
} from '@code-analyzer/analyzer';
import { InMemoryGraphStore, WorkerPool } from '@code-analyzer/infra';

// 1. Set up language providers
const parser = new UnifiedParser([
  new TypeScriptProvider(),
  new PythonProvider(),
  new GoProvider(),
  new JavaScriptProvider(),
]);

// 2. Parse files in parallel using worker pool
const pool = new WorkerPool({ size: 4 });
const captures = await parser.parseFiles(discoveredFiles, pool);

// 3. Run the full 18-phase pipeline
const orchestor = new PipelineOrchestrator(createAllPhases(parser));
const result = await orchestor.execute({
  projectId: 'my-project',
  rootPath: '/path/to/project',
  captures,
});

// 4. Resolve references across the graph
const resolver = new ScopeResolver();
const scopeTrees = resolver.buildScopeTrees(result.graph);
const refs = resolver.resolveReferences(parsedFiles, scopeTrees, semanticModel);

// 5. Build and validate the graph
const store = new InMemoryGraphStore(':memory:');
const builder = new GraphBuilder(store);
const graph = builder.build(pipelineContext);
const integrity = builder.validate(graph);

console.log(`Graph: ${result.phases.length} phases, ${graph.nodes.size} nodes`);
console.log(`Status: ${result.status}, Duration: ${result.duration}ms`);
```

## API Documentation

### PipelineOrchestrator

The core execution engine that runs all 18 phases in DAG dependency order.

```typescript
import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';

const orchestor = new PipelineOrchestrator(createAllPhases(parser));

// Execute the full pipeline
const result: PipelineResult = await orchestor.execute(ctx);

// Validate the DAG for cycles/missing deps before execution
const validation: ValidationResult = orchestor.validatePipeline();
```

**PipelineResult fields:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `'complete' \| 'partial' \| 'failed'` | Overall pipeline status |
| `phases` | `PhaseResult[]` | Per-phase results with timing |
| `graph` | `KnowledgeGraph` | The constructed knowledge graph |
| `duration` | `number` | Total execution time in ms |
| `errors` | `PhaseError[]` | Errors encountered during execution |

### 18-Phase Pipeline

All phases implement the `ExecutablePhase` interface and are created via `createAllPhases(parser)`. The DAG uses Kahn's algorithm for topological sort with automatic phase skipping on dependency failure.

```
scan           — Discover all source files in project tree
structure      — Build file/directory hierarchy nodes
parse          — Run language providers on every file
markdown       — Extract documentation from .md files
config         — Parse package.json, tsconfig.json, docker-compose
crossFile      — Link symbols across file boundaries
scopeResolution— Resolve references with the ScopeResolver
routes         — Detect API routes and handler functions
tools          — Identify build tools, scripts, linters
di             — Map dependency injection providers/injectors
pruneLocalSymbols — Remove private symbols not needed externally
communities    — Group related symbols into community clusters
processes      — Discover CI/CD, Docker, and runtime processes
tests          — Map test files to their targets
dump           — Serialize the graph to the in-memory graph store
similarity     — Compute MinHash fingerprints for duplicate detection
semantic       — Build the semantic model from graph structure
embed          — Generate vector embeddings for all nodes
```

```typescript
import {
  ScanPhase, ParsePhase, ScopeResolutionPhase, EmbedPhase, createAllPhases,
} from '@code-analyzer/analyzer';

// Individual phase access
const scanPhase = new ScanPhase();
const parsePhase = new ParsePhase(parser);
const scopePhase = new ScopeResolutionPhase(resolver);
const embedPhase = new EmbedPhase(embedder);

// Check phase dependencies
console.log(parsePhase.dependencies); // ['scan', 'markdown']
```

### LanguageProvider Interface

Each language implements a standard interface for extraction.

```typescript
import type { LanguageProvider, ParsedImport } from '@code-analyzer/analyzer';
import { TypeScriptProvider, PythonProvider, GoProvider, JavaScriptProvider } from '@code-analyzer/analyzer';

const ts = new TypeScriptProvider();
console.log(ts.language);       // 'typescript'
console.log(ts.extensions);     // ['.ts', '.tsx']
console.log(ts.globs);          // ['**/*.ts', '**/*.tsx']

// Parse a file
const captures = ts.parse(sourceCode, '/path/to/file.ts');

// Extract imports specifically
const imports: ParsedImport[] = ts.extractImports(sourceCode);

// Check if a symbol is exported
const exported = ts.isExported(sourceCode, 'MyClass');

// Import semantics for scope resolution
console.log(ts.importSemantics); // { named: true, default: true, namespace: true, ... }
```

**Supported Languages (8):**

| Provider | Language | File Extensions |
|----------|----------|-----------------|
| `TypeScriptProvider` | TypeScript | `.ts`, `.tsx` |
| `JavaScriptProvider` | JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| `PythonProvider` | Python | `.py`, `.pyw`, `.pyi` |
| `GoProvider` | Go | `.go` |
| `JavaProvider` | Java | `.java` |
| `KotlinProvider` | Kotlin | `.kt`, `.kts` |
| `CSharpProvider` | C# | `.cs` |
| `RustProvider` | Rust | `.rs` |

### UnifiedParser

Routes files to the correct language provider and enables parallel parsing.

```typescript
import { UnifiedParser } from '@code-analyzer/analyzer';
import type { WorkerPool } from '@code-analyzer/infra';

const parser = new UnifiedParser([new TypeScriptProvider(), new GoProvider()]);

// Parse a single file
const captures = parser.parseFile({ filePath: '/src/app.ts', content: 'export const x = 1;' });

// Parse all files with worker pool parallelism
const pool: WorkerPool = /* ... */;
const allCaptures = await parser.parseFiles(discoveredFiles, pool);
// Map<string, UnifiedCapture[]>

// Look up a provider
const goProvider = parser.getProvider('go');
```

### ScopeResolver

Three-tier resolution: same-file -> cross-file (import) -> cross-package.

```typescript
import { ScopeResolver } from '@code-analyzer/analyzer';

const resolver = new ScopeResolver();

// Build scope trees from parsed files
const scopeTrees = resolver.buildScopeTrees(parsedFiles);

// Resolve all reference sites to their definitions
const refs: ResolvedReference[] = resolver.resolveReferences(parsedFiles, scopeTrees, model);

// Resolve function/method calls
const calls: ResolvedCall[] = resolver.resolveCalls(refs, model);

// Resolve imports to target files
const imports: ResolvedImport[] = resolver.resolveImports(parsedFiles, model);
```

**Resolution types:** `'same-file' | 'import' | 'global' | 'unresolved'`

### GraphBuilder

Constructs and validates the knowledge graph with integrity checking.

```typescript
import { GraphBuilder } from '@code-analyzer/analyzer';

const builder = new GraphBuilder(store);

// Build graph from pipeline context
const graph: KnowledgeGraph = builder.build(ctx);

// Validate graph integrity
const report: IntegrityReport = builder.validate(graph);
// { valid: true, nodeCount: 1500, edgeCount: 3200, orphanEdges: 0, ... }

// Persist to in-memory graph store
builder.dumpToStore(graph, 'my-project');
```

## Configuration Reference

### PipelineOrchestrator

No configuration constructor — phase construction is handled by `createAllPhases(parser)`.

### UnifiedParser

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `providers` | `LanguageProvider[]` | Yes | Language providers to register |

### ScopeResolver

No configuration needed — constructor takes no arguments.

### GraphBuilder

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `store` | `InMemoryGraphStore` | Yes | in-memory graph store for persistence |

## Package Dependency Tree

```
@code-analyzer/analyzer
├── @code-analyzer/shared (workspace:*)
│   └── Shared types: UnifiedCapture, KnowledgeGraph,
│       PipelineContext, NodeLabel, RelationshipType, etc.
├── @code-analyzer/core (workspace:*)
│   └── Core configuration and project model
└── @code-analyzer/infra (workspace:*)
    └── Infrastructure: InMemoryGraphStore, WorkerPool
```

## License

MIT — see the [root LICENSE](../../LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

## Related Documentation

- [Project README](../../README.md) — High-level architecture and monorepo structure
- [docs/](../../docs/) — Design documents, API reference, and guides
- `@code-analyzer/intelligence` — Semantic search, code review, and impact analysis layer
- `@code-analyzer/shared` — Shared types and constants
- `@code-analyzer/infra` — Infrastructure (in-memory graph store, worker pool)
