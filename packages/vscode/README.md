# @code-analyzer/vscode

> VS Code extension providing Copilot Chat integration, interactive knowledge graph, inline code reviews, and impact analysis — all powered by the Code Analyzer engine.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=agentix.code-analyzer)
[![npm](https://img.shields.io/npm/v/@code-analyzer/vscode?color=blue)](https://www.npmjs.com/package/@code-analyzer/vscode)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.95.0-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js)](https://nodejs.org/)

---

## Overview

`@code-analyzer/vscode` is the VS Code extension presentation layer of Code Analyzer. It bridges the core engine packages (`shared`, `analyzer`, `intelligence`, `infra`) into the VS Code environment through three primary surfaces:

- **Copilot Chat Participant** (`@code-analyzer`) — a natural-language interface for code exploration, search, review, impact analysis, debugging, and refactoring, backed by 6 intent classifiers.
- **Code Intelligence Sidebar** — a webview-based interactive panel for symbol search, review findings, changed files, and project metadata.
- **Inline Diagnostics** — AI-powered review comments rendered as editor decorations and problem markers.

The extension activates on startup (`onStartupFinished`) and registers 5 commands, a chat participant, a sidebar webview provider, and a status bar indicator.

```
+-------------------------------------------------------------------+
|                        VS Code Window                              |
|  +-------------------------------------------------------------+  |
|  | Activity Bar             | Editor Area                      |  |
|  |  [Code Analyzer icon]    |  +---------------------------+   |  |
|  |                          |  | Copilot Chat              |   |  |
|  |                          |  |  @code-analyzer explore.. |   |  |
|  |                          |  +---------------------------+   |  |
|  |                          |  | Code (inline decorations) |   |  |
|  |  Sidebar                 |  |  // [CA] suggestion here  |   |  |
|  |  +--------------------+  |  +---------------------------+   |  |
|  |  | Code Intelligence  |  |                                   |  |
|  |  | [Search] [Review]   |  |                                   |  |
|  |  | Results...          |  |                                   |  |
|  |  +--------------------+  |                                   |  |
|  |                          |                                   |  |
|  |                          |  Status Bar: [check] Code Analyz..|  |
|  +-------------------------------------------------------------+  |
|                                                                     |
|  +-------------------------------------------------------------+  |
|  |                  EngineBridge (Facade)                        |  |
|  |    Search | Review | Standards | Impact | Change | Embed     |  |
|  +-------------------------------------------------------------+  |
|  |  @code-analyzer/shared  |  @code-analyzer/analyzer           |  |
|  |  @code-analyzer/intelligence  |  @code-analyzer/infra        |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

## Installation

### From VS Code Marketplace

Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`), search for **Code Analyzer**, and click **Install**.

Or install from the command line:

```bash
code --install-extension agentix.code-analyzer
```

### From a VSIX Package

```bash
# Build the extension first
cd packages/vscode
npm run build

# Package into VSIX (requires @vscode/vsce)
npx @vscode/vsce package

# Install the VSIX
code --install-extension code-analyzer-0.1.0.vsix
```

### Requirements

- **VS Code** 1.95.0 or later
- **Node.js** 18 or later (for dependency resolution)
- A workspace with a Git repository (for review and change detection features)

---

## Quick Start

### 1. Activate the Extension

After installation, the extension activates automatically. You'll see the **Code Analyzer** icon in the Activity Bar and a status bar indicator.

### 2. Analyze Your Codebase

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
Code Analyzer: Analyze Codebase
```

This triggers a full workspace index. The status bar shows `Analyzing...` with progress, then changes to a green checkmark when complete.

### 3. Use Copilot Chat with `@code-analyzer`

In the Copilot Chat panel, type any of these queries:

```
@code-analyzer explain UserService
@code-analyzer find all authentication functions
@code-analyzer review my changes
@code-analyzer what breaks if I rename this type?
@code-analyzer debug why loginHandler is failing
@code-analyzer refactor the payment module
```

The participant classifies the intent and enriches the chat context with symbols, call traces, review comments, and impact analysis before Copilot responds.

### 4. Explore from the Sidebar

Click the **Code Analyzer** icon in the Activity Bar. The sidebar opens with:
- Search input — find symbols by name
- Review Changes button — get AI review of uncommitted diffs
- Changed Files button — list modified files
- Project Info button — show current project ID

### 5. Run Inline Code Review

Command Palette → `Code Analyzer: Review Changes`

Review comments appear as inline decorations and in the Problems panel:

```
// [Code Analyzer] error: Potential null reference at this call site
// [Code Analyzer] warning: Function has too many parameters (8 > 5)
```

### 6. Configure Settings

Command Palette → `Code Analyzer: Configure Code Analyzer`

A webview opens with all extension settings: auto-index, index mode, max file size, review-on-save, inline decorations, and max search results.

---

## Commands

| Command ID | Title | Description |
|---|---|---|
| `code-analyzer.analyze` | Analyze Codebase | Index the entire workspace |
| `code-analyzer.review` | Review Changes | Run AI-powered code review on diffs |
| `code-analyzer.search` | Search Codebase | Search symbols by name |
| `code-analyzer.showSidebar` | Show Code Analyzer | Open the Code Intelligence sidebar |
| `code-analyzer.showConfig` | Configure Code Analyzer | Open the settings webview |

---

## API Reference

The package exports classes, interfaces, and types consumable by other VS Code extensions and test suites.

### EngineBridge — Core Facade

The `EngineBridge` is the primary facade that wires all core packages together. It manages initialization, indexing, search, review, impact analysis, and call tracing.

```typescript
import { EngineBridge } from '@code-analyzer/vscode';

const engine = new EngineBridge();

// Initialize all subsystems
await engine.initialize();

// Index a workspace
engine.setProjectId('/home/user/my-project');
await engine.indexWorkspace('/home/user/my-project');

// Search symbols
const results = await engine.search('UserService');
// results: Array<{ name: string; filePath: string; label: string }>

// Review uncommitted changes
const comments = await engine.reviewWorkspace();
// comments: Array<{ severity: string; title: string; path: string; startLine: number; endLine: number; message: string }>

// Detect changed symbols
const changes = await engine.detectChanges();
// changes: Array<{ name: string; riskLevel: string }>

// Analyze impact of a symbol
const impact = await engine.analyzeImpact('UserService');
// impact: { riskLevel: string; affectedSymbols: number }

// Trace call path (BFS up to depth 3)
const trace = await engine.traceCallPath('handleLogin');
// trace: Array<{ name: string; filePath: string }>

// Check coding standards
const standards = await engine.checkStandards('src/app.ts');
// standards: Array<{ passed: boolean; message: string }>

// Get changed files
const files = await engine.getChangedFiles();
// files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>

// Clean up
engine.dispose();
```

### CodeAnalyzerChatParticipant — Copilot Chat

The chat participant classifies user intent and gathers context before streaming metadata to Copilot.

```typescript
import { CodeAnalyzerChatParticipant } from '@code-analyzer/vscode';
import type {
  ChatRequest,
  ChatResponseStream,
  CancellationToken,
  ClassifiedIntent,
} from '@code-analyzer/vscode';

const participant = new CodeAnalyzerChatParticipant(engine);

const request: ChatRequest = { prompt: 'explain UserService' };
const context = { history: [] };
const token: CancellationToken = { isCancellationRequested: false };

// Stream context to Copilot
const result = await participant.handleRequest(request, context, stream, token);
// result.metadata.intent → 'explore'
```

**Intent classification** (`classifyIntent`):

```typescript
const intent: ClassifiedIntent = participant.classifyIntent('review my changes');
// { type: 'review', confidence: 0.9 }

const intent2 = participant.classifyIntent('what breaks if I rename User?');
// { type: 'impact', entity: 'User', confidence: 0.9 }

const intent3 = participant.classifyIntent('random text');
// { type: 'search', query: 'random text', confidence: 0.3 }
```

The 6 supported intent types:

| Intent | Trigger Patterns | Context Gathered |
|---|---|---|
| `explore` | "how does X work", "explain X", "what is X" | Search results + related symbols |
| `search` | "find X", "search for X", "where is X" | Search results |
| `review` | "review changes", "code review", "audit" | Changed files + review comments |
| `impact` | "what breaks if X", "impact of X" | Changed symbols + impact tree |
| `debug` | "why is X failing", "debug X", "fix X" | Call traces + related code |
| `refactor` | "refactor X", "rename X to", "extract X" | Implementations + callers |

### SidebarLogic — Webview Message Handler

```typescript
import { SidebarLogic, generateSidebarHtml } from '@code-analyzer/vscode';
import type { SidebarMessage, SidebarResponse } from '@code-analyzer/vscode';

const logic = new SidebarLogic(engine);

const response: SidebarResponse = await logic.handleMessage({
  command: 'search',
  query: 'UserService',
});
// { command: 'searchResults', results: [...] }

// Generate sidebar HTML (for webview provider)
const html = generateSidebarHtml();
```

### CommentLogic — Inline Diagnostics

```typescript
import { CommentLogic } from '@code-analyzer/vscode';
import type { DecoratedDiagnostic } from '@code-analyzer/vscode';

const commentLogic = new CommentLogic(engine);

// Get decorated diagnostics for all files
const diagnostics: DecoratedDiagnostic[] = await commentLogic.getDecoratedDiagnostics();

// Map raw comments to diagnostics (pure function)
const mapped = commentLogic.mapCommentsToDiagnostics(comments);

// Group by file for efficient VS Code diagnostic API usage
const grouped: Map<string, DecoratedDiagnostic[]> = commentLogic.groupByFile(mapped);
```

### ConfigService — Configuration Management

```typescript
import { ConfigService } from '@code-analyzer/vscode';
import type { CodeAnalyzerConfig } from '@code-analyzer/vscode';

// Create with VS Code workspace configuration
const configService = new ConfigService(vsCodeWorkspaceConfig);

const autoIndex: boolean = configService.get('autoIndex');
const maxSize: number = configService.get('maxFileSize');
const all: CodeAnalyzerConfig = configService.getAll();

// Static helpers
const defaults: CodeAnalyzerConfig = ConfigService.getDefaults();
const errors: string[] = ConfigService.validate({ maxSearchResults: 150 });
// ['maxSearchResults cannot exceed 100']

const merged = ConfigService.withDefaults({ indexMode: 'fast' });
```

### StatusBarManager — Status Bar Indicator

```typescript
import { StatusBarManager, createStatusBarManager } from '@code-analyzer/vscode';

// Factory pattern for VS Code integration
const manager = createStatusBarManager(statusBarFactory, engine);

manager.setIndexing(45);    // Shows: $(sync~spin) Analyzing... 45%
manager.setReady();          // Shows: $(check) Code Analyzer
manager.setError();          // Shows: $(error) Code Analyzer
manager.setIdle();           // Shows: $(search) Code Analyzer

const state: string = manager.getState(); // 'idle' | 'indexing' | 'ready' | 'error'
const progress: number = manager.getProgress(); // 0-100
```

### ConfigLogic — Configuration Webview

```typescript
import { ConfigLogic, generateConfigHtml } from '@code-analyzer/vscode';

const configLogic = new ConfigLogic(configService);
const config: CodeAnalyzerConfig = configLogic.getConfig();
const defaults: CodeAnalyzerConfig = configLogic.getDefaults();

// Generate configuration HTML for webview
const html = generateConfigHtml(config);
```

### GitService — Git Operations

```typescript
import { GitService } from '@code-analyzer/vscode';
import type { DiffInfo } from '@code-analyzer/vscode';

const git = new GitService();
const diffs: DiffInfo[] = await git.getWorkspaceDiff('/project');
const branch: string = await git.getCurrentBranch('/project');
const isDirty: boolean = await git.isDirty('/project');
const lastCommit: string = await git.getLastCommit('/project');
const branches: string[] = await git.listBranches('/project');
```

---

## Configuration

These settings are available in VS Code (`File → Preferences → Settings → Extensions → Code Analyzer`) or via the configuration webview.

| Setting | Type | Default | Description |
|---|---|---|---|
| `codeAnalyzer.autoIndex` | `boolean` | `true` | Auto-index the codebase when opening a project |
| `codeAnalyzer.indexMode` | `"full"` \| `"moderate"` \| `"fast"` | `"full"` | Depth of symbol analysis: full includes all relationships |
| `codeAnalyzer.maxFileSize` | `number` | `10485760` (10 MB) | Skip files larger than this value during analysis |
| `codeAnalyzer.excludePatterns` | `string[]` | `["node_modules/**", "dist/**", ".git/**", "build/**"]` | Glob patterns to exclude from indexing |
| `codeAnalyzer.reviewOnSave` | `boolean` | `false` | Run code review automatically when saving a file |
| `codeAnalyzer.showInlineDecorations` | `boolean` | `true` | Display review comments as inline editor annotations |
| `codeAnalyzer.maxSearchResults` | `number` | `20` | Maximum number of results returned in searches (1-100) |

Example `settings.json`:

```json
{
  "codeAnalyzer.autoIndex": true,
  "codeAnalyzer.indexMode": "full",
  "codeAnalyzer.maxFileSize": 5242880,
  "codeAnalyzer.excludePatterns": [
    "node_modules/**",
    "dist/**",
    ".git/**",
    "*.generated.ts"
  ],
  "codeAnalyzer.reviewOnSave": true,
  "codeAnalyzer.showInlineDecorations": true,
  "codeAnalyzer.maxSearchResults": 30
}
```

---

## Architecture Patterns

The extension follows a strict separation-of-concerns architecture:

1. **extension.ts** is the **only file** that directly references `vscode` APIs. All other modules consume the `IVSCodeAPI` interface for testability.
2. **EngineBridge** is the single facade over all 5 core packages — search, review, standards, impact analysis, change detection, and embedding.
3. **Providers** contain pure logic classes (e.g., `SidebarLogic`, `CommentLogic`, `ConfigLogic`) decoupled from VS Code webview/presentation concerns.
4. **Services** wrap cross-cutting infrastructure: `EngineBridge` (core facade), `ConfigService` (typed config), `GitService` (git operations).
5. **Views** manage VS Code UI state: `StatusBarManager` with 4 states (idle/indexing/ready/error).

---

## Dependencies

| Package | Role |
|---|---|
| `@code-analyzer/shared` | Shared types (`GitDiff`, etc.) |
| `@code-analyzer/infra` | Storage (`InMemoryGraphStore`) and git operations |
| `@code-analyzer/analyzer` | AST analysis pipeline (via EngineBridge) |
| `@code-analyzer/intelligence` | Search (`HybridSearchEngine`), review (`CodeReviewEngine`), standards, change detection, impact analysis, embeddings |

**Dev dependencies**: `@types/vscode` (1.95.0+), TypeScript 5.6, Vitest 2.1.

---

## Development

```bash
# Install dependencies (from monorepo root)
npm install

# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run typecheck

# Run tests
npm test

# Clean build artifacts
npm run clean
```

---

## License

MIT — see [LICENSE](./LICENSE)

## Links

- [Code Analyzer Documentation](../docs)
- [Contributing Guide](../CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Issue Tracker](https://github.com/agentix/code-analyzer/issues)
