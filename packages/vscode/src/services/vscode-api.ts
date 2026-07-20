// @code-analyzer/vscode — VS Code API Abstraction
// Abstracts VS Code APIs so all components can be tested without VS Code.

export interface IVSCodeAPI {
  // Window
  showInformationMessage(message: string): PromiseLike<string | undefined>;
  showErrorMessage(message: string): PromiseLike<string | undefined>;
  showWarningMessage(message: string): PromiseLike<string | undefined>;
  showInputBox(options: { prompt: string }): PromiseLike<string | undefined>;
  showQuickPick(
    items: QuickPickItem[],
    options: { placeHolder: string },
  ): PromiseLike<QuickPickItem | undefined>;
  createOutputChannel(name: string): OutputChannel;
  withProgress(
    options: ProgressOptions,
    task: (progress: ProgressReporter) => PromiseLike<void>,
  ): PromiseLike<void>;

  // Workspace
  getWorkspaceFolders(): VSCodeWorkspaceFolder[] | undefined;
  getConfiguration(section: string): WorkspaceConfiguration;

  // Commands
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
  ): Disposable;
  executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown>;

  // Diagnostics
  createDiagnosticCollection(name: string): DiagnosticCollection;

  // Status Bar
  createStatusBarItem(
    alignment: StatusBarAlignment,
    priority: number,
  ): StatusBarItem;

  // Webview
  readonly Uri: {
    file(path: string): { fsPath: string; toString(): string };
    parse(uriString: string): { toString(): string };
  };

  readonly ViewColumn: {
    readonly One: number;
  };
}

// ---------------------------------------------------------------------------
// Output Channel
// ---------------------------------------------------------------------------

export interface OutputChannel {
  appendLine(value: string): void;
  show(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface VSCodeWorkspaceFolder {
  uri: { fsPath: string };
  name: string;
  index: number;
}

export interface WorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Quick Pick
// ---------------------------------------------------------------------------

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressOptions {
  location: number;
  title: string;
}

export interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

// ---------------------------------------------------------------------------
// Status Bar
// ---------------------------------------------------------------------------

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export interface StatusBarItem {
  text: string;
  tooltip: string;
  command: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface DiagnosticCollection {
  set(
    uri: { toString(): string },
    diagnostics: Diagnostic[],
  ): void;
  delete(uri: { toString(): string }): void;
  clear(): void;
  dispose(): void;
}

export interface Diagnostic {
  range: DiagnosticRange;
  message: string;
  severity: DiagnosticSeverity;
  source: string;
}

export interface DiagnosticRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}
