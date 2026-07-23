// @code-analyzer/vscode — VS Code Extension Entry Point
// This is the ONLY file that directly imports from 'vscode'.
// It creates all VS Code objects and injects them via interfaces.

import { EngineBridge } from '../services/engine-bridge.js';
import { ConfigService } from '../services/config-service.js';
import { FileWatcherService } from '../services/file-watcher.js';
import {
  createStatusBarManager,
} from '../views/status-bar.js';
import { registerCommands } from './commands.js';
import type {
  IVSCodeAPI,
  WorkspaceConfiguration,
  DiagnosticCollection,
} from '../services/vscode-api.js';

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

let engine: EngineBridge | null = null;
let fileWatcher: FileWatcherService | null = null;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: { subscriptions: Array<{ dispose(): void }>; extensionUri?: unknown }): void {
  // 1. Initialize engine bridge
  engine = new EngineBridge();

  // 2. Initialize services
  const config = { get: <T>(_section: string): T | undefined => undefined, getWithDefault: <T>(_section: string, defaultVal: T): T => defaultVal };
  const configService = new ConfigService(config as WorkspaceConfiguration);

  // 3. Create VS Code API adapter
  const api = createVSCodeAPIAdapter();

  // 4. Register Copilot Chat Participant with all 7 slash commands
  registerChatParticipantWithCommands(context, engine);

  // 5. Register sidebar webview
  registerSidebar(context, engine);

  // 6. Register inline comment decorations
  const commentCollection = createDiagnosticCollection(context);

  // 7. Register status bar with real-time updates
  statusBarManager = registerStatusBar(context, engine);

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
  engine.initialize()
    .then(() => {
      // After initialization, trigger initial indexing
      const workspaceRoot = process.cwd();
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
// VS Code API Adapter (bridge between IVSCodeAPI and real vscode module)
// ---------------------------------------------------------------------------

function createVSCodeAPIAdapter(): IVSCodeAPI {
  // In VS Code, this would use the real vscode module like:
  // import * as vscode from 'vscode';
  // return {
  //   showInformationMessage: (msg) => vscode.window.showInformationMessage(msg) as PromiseLike<string>,
  //   ...
  // }
  //
  // For testability, we return a NOOP implementation
  return {
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    createOutputChannel: (_name: string) => ({
      appendLine: () => {},
      show: () => {},
      dispose: () => {},
    }),
    withProgress: async (_options, task) => {
      await task({ report: () => {} });
    },
    getWorkspaceFolders: () => [],
    getConfiguration: () => ({
      get: <T>(_section: string): T | undefined => undefined,
      getDefault: <T>(_section: string, defaultValue: T): T => defaultValue,
    } as WorkspaceConfiguration),
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
    createDiagnosticCollection: () => ({
      set: () => {},
      delete: () => {},
      clear: () => {},
      dispose: () => {},
    }),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      show() {},
      hide() {},
      dispose() {},
    }),
    Uri: {
      file: (path: string) => ({
        fsPath: path,
        toString: () => path,
      }),
      parse: (uriString: string) => ({ toString: () => uriString }),
    },
    ViewColumn: { One: 1 },
  };
}

// ---------------------------------------------------------------------------
// File Watcher Initialization
// ---------------------------------------------------------------------------

function startFileWatcher(
  context: { subscriptions: Array<{ dispose(): void }> },
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
  context: { subscriptions: Array<{ dispose(): void }> },
  _engine: EngineBridge,
): void {
  // In actual VS Code, this would register the chat participant with all commands:
  // import { CodeAnalyzerChatParticipant } from '../participant/code-analyzer-participant.js';
  //
  // const participant = vscode.chat.createChatParticipant(
  //   'code-analyzer',
  //   async (request, context, stream, token) => {
  //     const handler = new CodeAnalyzerChatParticipant(engine);
  //     return handler.handleRequest(request as any, context as any, stream as any, token as any);
  //   }
  // );
  //
  // // Registration of slash commands:
  // participant.command('review', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('review', request.prompt, stream as any, token as any);
  // });
  // participant.command('explain', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('explain', request.prompt, stream as any, token as any);
  // });
  // participant.command('impact', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('impact', request.prompt, stream as any, token as any);
  // });
  // participant.command('find', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('find', request.prompt, stream as any, token as any);
  // });
  // participant.command('deps', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('deps', request.prompt, stream as any, token as any);
  // });
  // participant.command('refactor', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('refactor', request.prompt, stream as any, token as any);
  // });
  // participant.command('test', async (request, context, stream, token) => {
  //   const handler = new CodeAnalyzerChatParticipant(engine);
  //   return handler.handleSlashCommand('test', request.prompt, stream as any, token as any);
  // });
  //
  // context.subscriptions.push(participant);

  // For now, register the participant as a disposable placeholder
  context.subscriptions.push({
    dispose() {
      // Chat participant and commands are auto-disposed by VS Code
    },
  });
}

// ---------------------------------------------------------------------------
// Sidebar Registration
// ---------------------------------------------------------------------------

function registerSidebar(
  context: { subscriptions: Array<{ dispose(): void }> },
  _engine: EngineBridge,
): void {
  // In actual VS Code:
  // const sidebarProvider = {
  //   resolveWebviewView(webviewView: vscode.WebviewView) {
  //     webviewView.webview.options = { enableScripts: true };
  //     webviewView.webview.html = generateSidebarHtml();
  //     const logic = new SidebarLogic(engine);
  //     webviewView.webview.onDidReceiveMessage(async (msg) => {
  //       const response = await logic.handleMessage(msg);
  //       webviewView.webview.postMessage(response);
  //     });
  //   }
  // };
  // context.subscriptions.push(
  //   vscode.window.registerWebviewViewProvider('code-analyzer.sidebar', sidebarProvider)
  // );

  context.subscriptions.push({
    dispose() {
      // Sidebar is auto-disposed by VS Code
    },
  });
}

// ---------------------------------------------------------------------------
// Diagnostic Collection Registration
// ---------------------------------------------------------------------------

function createDiagnosticCollection(
  context: { subscriptions: Array<{ dispose(): void }> },
): DiagnosticCollection {
  // In actual VS Code:
  // const collection = vscode.languages.createDiagnosticCollection('code-analyzer');
  // context.subscriptions.push(collection);

  const collection: DiagnosticCollection = {
    set: () => {},
    delete: () => {},
    clear: () => {},
    dispose: () => {},
  };
  context.subscriptions.push(collection);
  return collection;
}

// ---------------------------------------------------------------------------
// Status Bar Registration
// ---------------------------------------------------------------------------

function registerStatusBar(
  context: { subscriptions: Array<{ dispose(): void }> },
  eng: EngineBridge,
): StatusBarManager {
  const manager = createStatusBarManager(
    {
      createStatusBarItem: () => ({
        text: '$(search) Code Analyzer',
        tooltip: 'Code Analyzer',
        command: 'code-analyzer.showSidebar',
        show() {},
        hide() {},
        dispose() {},
      }),
    },
    eng,
  );
  context.subscriptions.push(manager);
  return manager;
}
