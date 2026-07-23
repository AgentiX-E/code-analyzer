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
import { GraphTreeDataProviderLogic } from '../providers/tree-view-provider.js';
import type {
  IVSCodeAPI,
  DiagnosticCollection,
  VSCodeWorkspaceFolder,
} from '../services/vscode-api.js';
import { StatusBarAlignment } from '../services/vscode-api.js';

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

  // 8. Register commands (analyze, review, search, config)
  const { disposables } = registerCommands(
    api,
    engine,
    configService,
    commentCollection,
  );
  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  // 9. Start file watcher for incremental re-indexing
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
      ),

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
        ),
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
                const config = message.config as Record<string, unknown> | undefined;
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
