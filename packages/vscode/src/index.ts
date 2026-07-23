// @code-analyzer/vscode — Public API
// Re-exports for consumers of the vscode extension package.
//
// NOTE: activate/deactivate are NOT exported here because they require
// the 'vscode' module which is only available inside the VS Code extension
// host. VS Code finds them via package.json "main" → dist/extension/extension.js.

// Participant
export {
  CodeAnalyzerChatParticipant,
} from './participant/code-analyzer-participant.js';
export type {
  ChatRequest,
  ChatContext,
  ChatResponseStream,
  ChatResult,
  CancellationToken,
  ClassifiedIntent,
  IntentType,
  AnalysisContext,
  SlashCommand,
  ComplexityMetrics,
  SymbolDetail,
  ImpactResult,
} from './participant/code-analyzer-participant.js';

// Engine Bridge
export { EngineBridge } from './services/engine-bridge.js';
export type {
  SearchResultItem,
  ReviewCommentItem,
  ChangedFileItem,
  ChangedSymbolItem,
  ImpactResultItem,
  TraceResultItem,
  StandardsResultItem,
  SymbolDetailItem,
  ComplexityMetricsItem,
  SearchResultWithScore,
  IndexingState,
} from './services/engine-bridge.js';

// VS Code API abstraction
export type {
  IVSCodeAPI,
  OutputChannel,
  VSCodeWorkspaceFolder,
  WorkspaceConfiguration,
  Disposable,
  QuickPickItem,
  ProgressOptions,
  ProgressReporter,
  StatusBarItem,
  DiagnosticCollection,
  Diagnostic,
  DiagnosticRange,
} from './services/vscode-api.js';
export {
  StatusBarAlignment,
  DiagnosticSeverity,
} from './services/vscode-api.js';

// Services
export { ConfigService } from './services/config-service.js';
export type { CodeAnalyzerConfig } from './services/config-service.js';
export { GitService } from './services/git-service.js';
export type { DiffInfo } from './services/git-service.js';
export { FileWatcherService, DEFAULT_WATCHER_CONFIG } from './services/file-watcher.js';
export type { WatcherConfig, FileSystemWatcher, WatcherFactory } from './services/file-watcher.js';

// Providers
export {
  SidebarLogic,
  generateSidebarHtml,
} from './providers/sidebar-provider.js';
export type {
  SidebarMessage,
  SidebarResponse,
} from './providers/sidebar-provider.js';

export {
  CommentLogic,
} from './providers/comment-provider.js';
export type {
  DiagnosticInfo,
  DecorationRange,
  DecoratedDiagnostic,
} from './providers/comment-provider.js';

export {
  ConfigLogic,
  generateConfigHtml,
} from './providers/config-provider.js';

export {
  GraphExplorerLogic,
} from './providers/graph-explorer.js';
export type {
  GraphNodeData,
  GraphEdgeData,
  GraphData,
} from './providers/graph-explorer.js';

export {
  ReviewDecorationLogic,
} from './providers/review-decoration-provider.js';
export type {
  DecorationSeverity,
  DecorationConfig,
  HoverContent,
  CodeLensAction,
  FileDecorationGroup,
} from './providers/review-decoration-provider.js';

export {
  GraphTreeDataProviderLogic,
} from './providers/tree-view-provider.js';
export type {
  TreeItemData,
  GraphTreeItem,
} from './providers/tree-view-provider.js';

// Views
export {
  StatusBarManager,
  createStatusBarManager,
} from './views/status-bar.js';
export type {
  StatusBarState,
  StatusBarDisplay,
  StatusBarItemFactory,
  StatusBarSnapshot,
} from './views/status-bar.js';
