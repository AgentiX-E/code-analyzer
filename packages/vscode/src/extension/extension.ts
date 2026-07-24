// @code-analyzer/vscode — VS Code Extension Entry Point
// This is the ONLY file that directly imports from 'vscode'.
// It creates all VS Code objects and injects them via interfaces.

import * as vscode from 'vscode';

import { EngineBridge } from '../services/engine-bridge.js';
import { ConfigService } from '../services/config-service.js';
import { FileWatcherService } from '../services/file-watcher.js';
import { createStatusBarManager } from '../views/status-bar.js';
import { registerCommands } from './commands.js';
import { CodeAnalyzerChatParticipant } from '../participant/code-analyzer-participant.js';
import {
  SidebarLogic,
  generateSidebarHtml,
} from '../providers/sidebar-provider.js';
import { ConfigLogic, generateConfigHtml } from '../providers/config-provider.js';
import { GraphExplorerLogic } from '../providers/graph-explorer.js';
import { ReviewDecorationLogic } from '../providers/review-decoration-provider.js';
import { GraphTreeDataProviderLogic, type TreeItemData } from '../providers/tree-view-provider.js';
import { CommentLogic } from '../providers/comment-provider.js';
import type {
  IVSCodeAPI,
  DiagnosticCollection,
  VSCodeWorkspaceFolder,
} from '../services/vscode-api.js';

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

let engine: EngineBridge | null = null;
let fileWatcher: FileWatcherService | null = null;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // 1. Initialize engine bridge with global storage path
  engine = new EngineBridge({
    globalStorageUri: context.globalStorageUri,
  });

  // 2. Initialize services with real VS Code configuration
  const configService = new ConfigService(
    vscode.workspace.getConfiguration('codeAnalyzer'),
  );

  // 3. Create VS Code API adapter wrapping real vscode module
  const api = createVSCodeAPIAdapter();

  // 4. Register Copilot Chat Participant with all 7 slash commands
  registerChatParticipantWithCommands(context, engine);

  // 5. Register sidebar webview
  registerSidebar(context, engine);

  // 5b. Register config webview
  registerConfigWebview(context, configService);

  // 6. Register inline comment decorations
  const commentCollection = createDiagnosticCollection(context);

  // 7. Register status bar with real-time updates
  registerStatusBar(context, engine);

  // 8. Register commands (all 14)
  const { disposables } = registerCommands(
    api,
    engine,
    configService,
    commentCollection,
  );
  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  // 9. Register CodeLens provider for review decorations
  registerCodeLensProvider(context, engine);

  // 10. Register Hover provider for review decorations
  registerHoverProvider(context, engine);

  // 11. Register reviewOnSave handler
  registerReviewOnSave(context, engine, commentCollection, configService);

  // 12. Register Graph Explorer TreeView
  registerGraphTreeView(context, engine);

  // 13. Start file watcher for incremental re-indexing
  fileWatcher = startFileWatcher(context, engine);

  // 10. Start background initialization
  engine
    .initialize()
    .then(() => {
      // After initialization, trigger initial indexing
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath
        ?? process.cwd();
      return engine!.indexWorkspace(workspaceRoot);
    })
    .catch(() => {
      // Silently handle initialization errors
    });

  // Register cleanup on deactivation
  context.subscriptions.push({
    dispose() {
      deactivate();
    },
  });
}

export function deactivate(): void {
  // Stop file watcher
  if (fileWatcher) {
    fileWatcher.dispose();
    fileWatcher = null;
  }

  // Dispose engine
  if (engine) {
    engine.dispose();
    engine = null;
  }

  // Cleanup is handled by disposables registered in context.subscriptions
}

// ---------------------------------------------------------------------------
// VS Code API Adapter — wraps the real vscode module behind IVSCodeAPI
// for testability of commands.ts and other consumers
// ---------------------------------------------------------------------------

function createVSCodeAPIAdapter(): IVSCodeAPI {
  return {
    // Window
    showInformationMessage: (msg) =>
      Promise.resolve(vscode.window.showInformationMessage(msg)),
    showErrorMessage: (msg) =>
      Promise.resolve(vscode.window.showErrorMessage(msg)),
    showWarningMessage: (msg) =>
      Promise.resolve(vscode.window.showWarningMessage(msg)),
    showInputBox: (options) =>
      Promise.resolve(vscode.window.showInputBox(options)),
    showQuickPick: (items, options) =>
      Promise.resolve(
        vscode.window.showQuickPick(items as readonly vscode.QuickPickItem[], options),
      ),
    createOutputChannel: (name) => vscode.window.createOutputChannel(name),
    withProgress: async (options, task) => {
      await vscode.window.withProgress(
        options,
        (progress) => task({ report: (value) => progress.report(value) }),
      );
    },

    // Workspace
    getWorkspaceFolders: () =>
      vscode.workspace.workspaceFolders as
        | VSCodeWorkspaceFolder[]
        | undefined,
    getConfiguration: (section) =>
      vscode.workspace.getConfiguration(section),

    // Commands
    registerCommand: (command, callback) =>
      vscode.commands.registerCommand(command, callback as (...args: unknown[]) => unknown),
    executeCommand: async (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),

    // Diagnostics
    createDiagnosticCollection: (name) =>
      vscode.languages.createDiagnosticCollection(name) as unknown as DiagnosticCollection,

    // Status Bar
    createStatusBarItem: (alignment, priority) =>
      vscode.window.createStatusBarItem(
        alignment as unknown as vscode.StatusBarAlignment,
        priority,
      ) as unknown as any,

    // URI
    Uri: {
      file: (path: string) => vscode.Uri.file(path),
      parse: (uriString: string) => vscode.Uri.parse(uriString),
    },

    ViewColumn: {
      One: vscode.ViewColumn.One,
    },
  };
}

// ---------------------------------------------------------------------------
// File Watcher Initialization
// ---------------------------------------------------------------------------

function startFileWatcher(
  context: vscode.ExtensionContext,
  eng: EngineBridge,
): FileWatcherService {
  const watcher = new FileWatcherService(eng);
  watcher.start();
  context.subscriptions.push({ dispose() { watcher.dispose(); } });
  return watcher;
}

// ---------------------------------------------------------------------------
// Chat Participant Registration with 7 Slash Commands
// ---------------------------------------------------------------------------

function registerChatParticipantWithCommands(
  context: vscode.ExtensionContext,
  eng: EngineBridge,
): void {
  const participant = vscode.chat.createChatParticipant(
    'code-analyzer',
    async (request, _ctx, stream, token) => {
      const handler = new CodeAnalyzerChatParticipant(eng);
      return handler.handleRequest(request as any, _ctx as any, stream as any, token as any);
    },
  );

  // Register all 7 slash commands
  participant.command('review', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('review', request.prompt, stream as any, token as any);
  });

  participant.command('explain', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('explain', request.prompt, stream as any, token as any);
  });

  participant.command('impact', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('impact', request.prompt, stream as any, token as any);
  });

  participant.command('find', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('find', request.prompt, stream as any, token as any);
  });

  participant.command('deps', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('deps', request.prompt, stream as any, token as any);
  });

  participant.command('refactor', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('refactor', request.prompt, stream as any, token as any);
  });

  participant.command('test', async (request, _ctx, stream, token) => {
    const handler = new CodeAnalyzerChatParticipant(eng);
    return handler.handleSlashCommand('test', request.prompt, stream as any, token as any);
  });

  context.subscriptions.push(participant);
}

// ---------------------------------------------------------------------------
// Sidebar Registration
// ---------------------------------------------------------------------------

function registerSidebar(
  context: vscode.ExtensionContext,
  engine: EngineBridge,
): void {
  const sidebarLogic = new SidebarLogic(engine);
  const graphLogic = new GraphExplorerLogic(engine);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('code-analyzer.sidebar', {
      resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
          enableScripts: true,
        };
        webviewView.webview.html = generateSidebarHtml();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
          async (message: { command: string; [key: string]: unknown }) => {
            try {
              // Route graph-related messages to GraphExplorerLogic
              if (message.command === 'getGraphData') {
                const rootSymbol = message['rootSymbol'] as string | undefined;
                const graphData = await graphLogic.getGraphData(rootSymbol);
                webviewView.webview.postMessage({
                  command: 'graphData',
                  nodes: graphData.nodes,
                  edges: graphData.edges,
                });
                return;
              }
              if (message.command === 'getNodeDetail') {
                const nodeId = message['nodeId'] as number;
                const detail = await graphLogic.getNodeDetail(nodeId);
                webviewView.webview.postMessage({
                  command: 'nodeDetail',
                  detail,
                });
                return;
              }
              if (message.command === 'navigate') {
                const filePath = message['filePath'] as string;
                if (filePath) {
                  const uri = vscode.Uri.file(filePath);
                  await vscode.commands.executeCommand('vscode.open', uri);
                }
                return;
              }

              // Route everything else through SidebarLogic
              const response = await sidebarLogic.handleMessage(message);
              webviewView.webview.postMessage(response);
            } catch {
              webviewView.webview.postMessage({
                command: 'error',
                message: 'An internal error occurred',
              });
            }
          },
        );
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Diagnostic Collection Registration
// ---------------------------------------------------------------------------

function createDiagnosticCollection(
  context: vscode.ExtensionContext,
): DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection(
    'code-analyzer',
  ) as unknown as DiagnosticCollection;
  context.subscriptions.push(collection as unknown as { dispose(): void });
  return collection;
}

// ---------------------------------------------------------------------------
// Status Bar Registration
// ---------------------------------------------------------------------------

function registerStatusBar(
  context: vscode.ExtensionContext,
  eng: EngineBridge,
): void {
  const manager = createStatusBarManager(
    {
      createStatusBarItem: (alignment, priority) =>
        vscode.window.createStatusBarItem(
          alignment as unknown as vscode.StatusBarAlignment,
          priority,
        ) as any,
    },
    eng,
  );
  context.subscriptions.push(manager);
}

// ---------------------------------------------------------------------------
// Config Webview Registration
// ---------------------------------------------------------------------------

function registerConfigWebview(
  context: vscode.ExtensionContext,
  configService: ConfigService,
): void {
  const configLogic = new ConfigLogic(configService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('code-analyzer.config', {
      resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
          enableScripts: true,
        };
        const currentConfig = configLogic.getConfig();
        webviewView.webview.html = generateConfigHtml(currentConfig);

        webviewView.webview.onDidReceiveMessage(
          async (message: { command: string; [key: string]: unknown }) => {
            try {
              if (message.command === 'saveConfig') {
                const config = message['config'] as Record<string, unknown> | undefined;
                if (config) {
                  const errors = configLogic.validate(config as any);
                  if (errors.length > 0) {
                    webviewView.webview.postMessage({
                      command: 'configError',
                      message: errors.join('; '),
                    });
                    return;
                  }
                  // Update VS Code configuration
                  for (const [key, value] of Object.entries(config)) {
                    await vscode.workspace
                      .getConfiguration('codeAnalyzer')
                      .update(key, value, vscode.ConfigurationTarget.Global);
                  }
                }
                webviewView.webview.postMessage({ command: 'configSaved' });
              } else if (message.command === 'resetConfig') {
                const defaults = configLogic.getDefaults();
                webviewView.webview.postMessage({
                  command: 'configDefaults',
                  config: defaults,
                });
              }
            } catch {
              webviewView.webview.postMessage({
                command: 'configError',
                message: 'Failed to save configuration',
              });
            }
          },
        );
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// CodeLens Provider Registration
// ---------------------------------------------------------------------------

function registerCodeLensProvider(
  context: vscode.ExtensionContext,
  _eng: EngineBridge,
): void {
  const reviewLogic = new ReviewDecorationLogic();

  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    {
      async provideCodeLenses(document) {
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const codeAnalyzerDiagnostics = diagnostics.filter(
          (d) => d.source === 'code-analyzer',
        );
        if (codeAnalyzerDiagnostics.length === 0) return [];

        const lenses: vscode.CodeLens[] = [];
        for (const diagnostic of codeAnalyzerDiagnostics) {
          const actions = reviewLogic.getCodeLensActions({
            severity: diagnostic.severity === vscode.DiagnosticSeverity.Error
              ? 'error'
              : diagnostic.severity === vscode.DiagnosticSeverity.Warning
                ? 'warning'
                : 'info',
            message: diagnostic.message,
            filePath: document.uri.fsPath,
            startLine: diagnostic.range.start.line,
            endLine: diagnostic.range.end.line,
          } as any);

          for (const action of actions) {
            const lens = new vscode.CodeLens(diagnostic.range, {
              title: action.title,
              command: action.command,
              tooltip: action.tooltip,
              arguments: [{
                filePath: document.uri.fsPath,
                startLine: diagnostic.range.start.line,
                endLine: diagnostic.range.end.line,
                message: diagnostic.message,
              }],
            });
            lenses.push(lens);
          }
        }
        return lenses;
      },
    },
  );

  context.subscriptions.push(codeLensProvider);
}

// ---------------------------------------------------------------------------
// Hover Provider Registration
// ---------------------------------------------------------------------------

function registerHoverProvider(
  context: vscode.ExtensionContext,
  _eng: EngineBridge,
): void {
  const reviewLogic = new ReviewDecorationLogic();

  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    {
      async provideHover(document, position) {
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const codeAnalyzerDiagnostics = diagnostics.filter(
          (d) => d.source === 'code-analyzer',
        );

        for (const diagnostic of codeAnalyzerDiagnostics) {
          if (diagnostic.range.contains(position)) {
            const hoverContent = reviewLogic.buildHoverContent({
              severity: diagnostic.severity === vscode.DiagnosticSeverity.Error
                ? 'error'
                : diagnostic.severity === vscode.DiagnosticSeverity.Warning
                  ? 'warning'
                  : 'info',
              message: diagnostic.message,
              title: diagnostic.message.split('\n')[0] ?? 'Issue',
              suggestions: [],
            } as any);

            const markdown = reviewLogic.buildHoverMarkdown(hoverContent);
            return new vscode.Hover(
              new vscode.MarkdownString(markdown),
              diagnostic.range,
            );
          }
        }
        return null;
      },
    },
  );

  context.subscriptions.push(hoverProvider);
}

// ---------------------------------------------------------------------------
// Review on Save
// ---------------------------------------------------------------------------

function registerReviewOnSave(
  context: vscode.ExtensionContext,
  eng: EngineBridge,
  commentCollection: DiagnosticCollection,
  _configService: ConfigService,
): void {
  const commentLogic = new CommentLogic(eng);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
      const ext = document.fileName.slice(document.fileName.lastIndexOf('.'));
      if (!supportedExtensions.includes(ext)) return;

      try {
        const comments = await eng.reviewWorkspace();
        const fileComments = comments.filter((c) => c.path === document.uri.fsPath);
        if (fileComments.length === 0) {
          commentCollection.delete({ toString: () => document.uri.fsPath } as any);
          return;
        }

        const diagnostics = commentLogic.mapCommentsToDiagnostics(fileComments);
        const vsDiags = diagnostics.map((d) => ({
          range: {
            startLine: d.range.startLine,
            startCharacter: d.range.startCharacter,
            endLine: d.range.endLine,
            endCharacter: d.range.endCharacter,
          },
          message: d.message,
          severity: d.severity === 'error'
            ? 0 : d.severity === 'warning' ? 1 : 2,
          source: d.source,
        }));
        commentCollection.set(
          { toString: () => document.uri.fsPath } as any,
          vsDiags as any,
        );
      } catch {
        // Silently handle review errors on save
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Graph Explorer Tree View Registration
// ---------------------------------------------------------------------------

function registerGraphTreeView(
  context: vscode.ExtensionContext,
  eng: EngineBridge,
): void {
  const treeLogic = new GraphTreeDataProviderLogic(eng);

  const treeDataProvider = vscode.window.registerTreeDataProvider(
    'code-analyzer.graphExplorer',
    {
      getTreeItem(element: TreeItemData): vscode.TreeItem {
        const iconPath = treeLogic.getIconForLabel(element.label);
        const treeItem = new vscode.TreeItem(
          element.label,
          element.children && element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        treeItem.id = element.id;
        treeItem.description = element.description;
        treeItem.tooltip = element.tooltip ?? element.label;
        treeItem.contextValue = element.contextValue ?? 'symbol';
        if (iconPath) {
          treeItem.iconPath = new vscode.ThemeIcon(iconPath);
        }
        if (element.command) {
          treeItem.command = element.command as vscode.Command;
        }
        return treeItem;
      },

      async getChildren(element?: TreeItemData): Promise<TreeItemData[]> {
        return treeLogic.getChildren(element?.id ?? 'root');
      },

      getParent(element: TreeItemData): vscode.ProviderResult<TreeItemData> {
        return treeLogic.getParent(element.id) as any;
      },
    },
  );

  context.subscriptions.push(treeDataProvider);
}
