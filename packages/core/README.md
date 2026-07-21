# @code-analyzer/core

> Foundation layer — configuration, logging, error hierarchy, i18n, metrics, and lifecycle management for the Code Analyzer platform.

[![npm](https://img.shields.io/npm/v/@code-analyzer/core?color=blue)](https://www.npmjs.com/package/@code-analyzer/core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)

## Overview

`@code-analyzer/core` provides the shared runtime services that every package in the monorepo relies on. It includes a layered configuration system with environment variable overrides, structured JSON logging with multiple transports, a typed error hierarchy with MCP serialization, internationalization with template interpolation, tag-based dimensional metrics collection, and a dependency-ordered component lifecycle manager. This package sits at Layer 1 of the architecture, depending only on `@code-analyzer/shared`.

### Architecture

```
@code-analyzer/core (Layer 1 - Foundation)
│
├── config/       — Layered config loading & validation
│   ├── defaults.ts       — getDefaultConfig()
│   ├── loader.ts         — loadConfig() with deep merge & env overrides
│   └── validator.ts      — validateConfig() with rich error reporting
│
├── logging/      — Structured logging
│   ├── logger.ts         — LoggerImpl, ConsoleTransport, FileTransport
│   └── formatter.ts      — formatJson, formatPretty, createLevelFilter
│
├── errors/       — Typed error hierarchy
│   └── hierarchy.ts      — CodeAnalyzerError + 9 specialized subclasses
│
├── i18n/         — Internationalization
│   ├── en.ts             — English message bundle (DEFAULT_MESSAGES)
│   └── translator.ts     — DefaultTranslator with shared singleton
│
├── metrics/      — Metrics collection
│   ├── collector.ts      — DefaultMetricsCollector (counter, histogram, gauge)
│   └── noop.ts           — NoopMetricsCollector
│
└── lifecycle/    — Component lifecycle
    └── index.ts          — LifecycleManager with topological sort
```

## Installation

```bash
npm install @code-analyzer/core
```

Requires Node.js >= 22.

## Key Exports

| Category | Exports | Description |
|----------|---------|-------------|
| **Config** | `getDefaultConfig`, `loadConfig`, `validateConfig`, `CodeAnalyzerConfig` | Layered config system with env var overrides |
| **Logging** | `createLogger`, `createNoopLogger`, `LoggerImpl`, `formatJson`, `formatPretty`, `createLevelFilter` | Structured logging with console & file transports |
| **Errors** | `CodeAnalyzerError`, `ConfigError`, `IOError`, `ParseError`, `ResolutionError`, `GraphIntegrityError`, `EmbeddingError`, `LLMProviderError`, `MCPProtocolError`, `RateLimitError` | Typed error hierarchy with JSON serialization |
| **i18n** | `DefaultTranslator`, `getTranslator`, `setTranslator`, `resetTranslator`, `DEFAULT_MESSAGES` | Template-based i18n with `{variable}` interpolation |
| **Metrics** | `DefaultMetricsCollector`, `NoopMetricsCollector`, `createMetrics` | Counter, histogram, and gauge metrics |
| **Lifecycle** | `LifecycleManager`, `Component`, `HealthStatus`, `HealthCheckResult` | Dependency-ordered init/shutdown/health-check |

## Usage

### Configuration Loading

The configuration system uses a 4-layer merge strategy: defaults → global config → project config → environment variables.

```typescript
import { loadConfig, getDefaultConfig, validateConfig } from '@code-analyzer/core';

// Layer 1: defaults
const defaults = getDefaultConfig();
// { maxFileSize: 10485760, maxFiles: 50000, parseWorkers: 2, ... }

// Layer 1-4: fully resolved config
const config = await loadConfig('/path/to/project');
// Merges: defaults → ~/.code-analyzer/config.json → .code-analyzer.json → env vars

// Validate the result
import { validateConfig } from '@code-analyzer/core';

const errors = validateConfig(config);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[${error.path}] ${error.message}`);
  }
}
```

Environment variables use the `CODE_ANALYZER_` prefix:

```bash
CODE_ANALYZER_PROJECT_ID=my-project
CODE_ANALYZER_PARSE_WORKERS=8
CODE_ANALYZER_MCP_MAX_RESULTS=50
CODE_ANALYZER_REVIEW_ENABLED=true
CODE_ANALYZER_EMBED_MODEL=text-embedding-3-small
```

### Structured Logging

```typescript
import { createLogger, createNoopLogger } from '@code-analyzer/core';

// Console logger with pretty format (default)
const logger = createLogger('pipeline', { minLevel: 'info' });
logger.info('Starting pipeline', { phaseCount: 18 });
logger.warn('Slow file detected', { filePath: 'src/big.ts', duration: 450 });
logger.error('Parse failed', new Error('Unexpected token'), { file: 'src/app.ts' });

// JSON format for log aggregation
const jsonLogger = createLogger('api', { format: 'json' });
jsonLogger.info('Request completed', { path: '/analyze', status: 200, duration: 120 });

// File transport for persistent logs
const fileLogger = createLogger('server', {
  enableFile: true,
  logDir: './logs',
});
fileLogger.info('Server started', { port: 3000 });

// No-op logger for tests
const silentLogger = createNoopLogger('test');
silentLogger.info('This will not be logged');
```

### Error Hierarchy

```typescript
import {
  CodeAnalyzerError,
  ConfigError,
  IOError,
  ParseError,
  ResolutionError,
  GraphIntegrityError,
  EmbeddingError,
  LLMProviderError,
  MCPProtocolError,
  RateLimitError,
} from '@code-analyzer/core';

// Create typed errors with structured context
throw new ConfigError('Invalid project path', { projectId: 'proj-1', path: '/invalid' });
// Code: CA_CONFIG_ERROR
// Category: CONFIG

throw new ParseError('Unexpected token at line 42', {
  filePath: 'src/app.ts',
  line: 42,
  token: '=>',
});

// Serialize for MCP transport
const error = new RateLimitError('Rate limit exceeded', { retryAfter: 30 });
const json = error.toJSON();
// { name, code, category, message, timestamp, context, stack }

// Deserialize back
const restored = CodeAnalyzerError.fromJSON(json);
```

### Internationalization

```typescript
import { getTranslator, setTranslator, resetTranslator } from '@code-analyzer/core';

const t = getTranslator();

t.t('config.loading');
// "Loading configuration..."

t.t('config.loadedGlobal', { path: '/home/user/.code-analyzer/config.json' });
// "Merged global config from /home/user/.code-analyzer/config.json"

t.t('lifecycle.shutdownTimeout', { component: 'sqlite-store', timeout: 5000 });
// "Shutdown timed out for component "sqlite-store" after 5000ms"

// Use custom translator for testing
setTranslator({
  locale: 'en',
  t: (key) => `MOCKED: ${key}`,
  hasKey: () => true,
});
resetTranslator(); // Restore default
```

### Metrics Collection

```typescript
import { createMetrics } from '@code-analyzer/core';

const metrics = createMetrics();

// Counters
metrics.incrementCounter('files_processed');
metrics.incrementCounter('errors', 3, { category: 'parse' });

// Histograms (auto-bucketed: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s)
metrics.recordDuration('parse_time', 45, { language: 'typescript' });
metrics.recordDuration('parse_time', 120, { language: 'python' });

// Gauges
metrics.setGauge('active_workers', 4);
metrics.setGauge('memory_mb', process.memoryUsage().heapUsed / 1024 / 1024);

// Query
const count = metrics.getCounter('files_processed'); // number
const hist = metrics.getHistogram('parse_time', { language: 'typescript' });
// { values: [45], count: 1, sum: 45 }

metrics.reset(); // Clear all metrics
```

### Lifecycle Management

```typescript
import { LifecycleManager } from '@code-analyzer/core';

import type { Component, ComponentDescriptor } from '@code-analyzer/core';

// Define managed components
class DatabaseComponent implements Component {
  name = 'database';
  async init() { /* open connection */ }
  async shutdown() { /* close connection */ }
}

class CacheComponent implements Component {
  name = 'cache';
  async init() { /* warm cache */ }
  async shutdown() { /* flush cache */ }
}

// Register with dependency ordering (database must init first)
const manager = new LifecycleManager({
  shutdownTimeout: 10000,
  onInitError: (name, err) => console.error(`Init failed: ${name}`, err),
});

manager.register({ component: new DatabaseComponent() });
manager.register({ component: new CacheComponent(), dependsOn: ['database'] });

// Resolve initialization order (topological sort)
const order = manager.resolveInitOrder();
// ['database', 'cache']

// Initialize all components
const initialized = await manager.init();
console.log(`Initialized ${initialized} components`);
console.log(manager.isHealthy()); // true

// Register health checks
manager.registerHealthCheck('database', () => ({
  component: 'database',
  status: 'healthy',
  timestamp: new Date().toISOString(),
}));

// Health checks
const results = manager.healthCheck();
// [{ component: 'database', status: 'healthy', ... }, ...]

// Graceful shutdown (reverse order, with timeout per component)
const shutdown = await manager.shutdown();
```

## Configuration Reference

### LoggerOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minLevel` | `LogLevel` | `'info'` | Minimum log severity |
| `format` | `'json' \| 'pretty'` | `'pretty'` | Output format |
| `enableFile` | `boolean` | `false` | Enable file transport |
| `logDir` | `string` | `'./logs'` | File transport directory |
| `filters` | `LogFilter[]` | — | Additional log filters |
| `transports` | `LogTransport[]` | — | Custom transports |

### LifecycleOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shutdownTimeout` | `number` | `5000` | Max ms per component shutdown |
| `onInitError` | `(name, error) => void` | — | Init failure callback |

## Package Dependencies

```
@code-analyzer/shared (Layer 0)
  │
  └── @code-analyzer/core (Layer 1)
        │
        ├── @code-analyzer/infra    (Layer 2)
        ├── @code-analyzer/analyzer (Layer 3)
        ├── @code-analyzer/cli      (Layer 4)
        └── @code-analyzer/server   (Layer 4)
```

**Depends on:** `@code-analyzer/shared` (zero other external dependencies).

## License

MIT

## Contributing

See the [CONTRIBUTING.md](../../CONTRIBUTING.md) in the repository root for guidelines on contributing to this monorepo.
