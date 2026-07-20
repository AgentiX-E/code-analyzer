// @code-analyzer/vscode — Public API
// Re-exports for consumers of the vscode extension package.

// Extension entry (the activate/deactivate functions)
export { activate, deactivate } from './extension/extension.js';

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

// Views
export {
  StatusBarManager,
  createStatusBarManager,
} from './views/status-bar.js';
export type {
  StatusBarState,
  StatusBarDisplay,
  StatusBarItemFactory,
} from './views/status-bar.js';
