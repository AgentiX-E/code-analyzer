// @code-analyzer/vscode — VS Code Extension Commands
// All VS Code command registrations. This is one of the few files
// that directly imports from 'vscode'.

import type { EngineBridge } from '../services/engine-bridge.js';
import type {
  IVSCodeAPI,
  DiagnosticCollection,
} from '../services/vscode-api.js';
import { DiagnosticSeverity } from '../services/vscode-api.js';
import { CommentLogic } from '../providers/comment-provider.js';

export interface RegisteredDisposables {
  disposables: Array<{ dispose(): void }>;
}

export function registerCommands(
  api: IVSCodeAPI,
  engine: EngineBridge,
  _configService: unknown,
  commentCollection: DiagnosticCollection,
): RegisteredDisposables {
  const disposables: Array<{ dispose(): void }> = [];

  // Show sidebar
  disposables.push(
    api.registerCommand('code-analyzer.showSidebar', () => {
      api.executeCommand('workbench.view.extension.code-analyzer-sidebar');
    }),
  );

  // Analyze codebase
  disposables.push(
    api.registerCommand('code-analyzer.analyze', async () => {
      const folders = api.getWorkspaceFolders();
      const root = folders?.[0]?.uri?.fsPath;
      if (!root) {
        await api.showWarningMessage('No workspace folder found.');
        return;
      }

      await api.withProgress(
        { location: 10, title: 'Analyzing codebase...' },
        async (_progress) => {
          engine.setProjectId(root);
          await engine.initialize();
          await engine.indexWorkspace(root);
          await api.showInformationMessage('Code analysis complete');
        },
      );
    }),
  );

  // Review workspace
  disposables.push(
    api.registerCommand('code-analyzer.review', async () => {
      const comments = await engine.reviewWorkspace();
      if (comments.length === 0) {
        await api.showInformationMessage('No issues found');
        return;
      }

      // Show diagnostic decorations via the comment provider logic
      const commentLogic = new CommentLogic(engine);
      const diagnostics = commentLogic.mapCommentsToDiagnostics(comments);
      const grouped = commentLogic.groupByFile(diagnostics);

      commentCollection.clear();
      for (const [filePath, diags] of grouped) {
        const vsDiags = diags.map((d) => ({
          range: {
            startLine: d.range.startLine,
            startCharacter: d.range.startCharacter,
            endLine: d.range.endLine,
            endCharacter: d.range.endCharacter,
          },
          message: d.message,
          severity: d.severity === 'error'
            ? DiagnosticSeverity.Error
            : d.severity === 'warning'
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information,
          source: d.source,
        }));
        commentCollection.set({ toString: () => filePath }, vsDiags);
      }

      await api.showInformationMessage(
        `Found ${comments.length} issue(s)`,
      );
    }),
  );

  // Search codebase
  disposables.push(
    api.registerCommand('code-analyzer.search', async () => {
      const query = await api.showInputBox({
        prompt: 'Search codebase (symbols, files, types)',
      });
      if (!query) return;

      const results = await engine.search(query);
      if (results.length === 0) {
        await api.showInformationMessage(
          `No results found for "${query}"`,
        );
        return;
      }

      const items = results.map((r) => ({
        label: r.name,
        description: r.filePath,
        detail: r.label,
      }));
      const selected = await api.showQuickPick(items, {
        placeHolder: 'Select a symbol to navigate',
      });

      if (selected?.description) {
        // Would navigate to file in VS Code, but we can't with the interface
        await api.showInformationMessage(
          `Selected: ${selected.label} in ${selected.description}`,
        );
      }
    }),
  );

  // Show config
  disposables.push(
    api.registerCommand('code-analyzer.showConfig', () => {
      api.executeCommand('workbench.view.extension.code-analyzer-config');
    }),
  );

  return { disposables };
}
